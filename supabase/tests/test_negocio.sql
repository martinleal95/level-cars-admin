-- Pruebas de seguridad y de reglas de negocio. Se ejecutan dentro de una
-- transacción que se deshace al final. Falla con error ante cualquier problema.
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'intruso@test');
insert into public.administradores (user_id, nombre) values ('00000000-0000-0000-0000-00000000000a', 'Admin');

create or replace function pg_temp.esperar_error(sql text, patron text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm !~* patron then
      raise exception 'Error inesperado para [%]: %', sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Se esperaba un error para: %', sql;
end $$;
grant execute on function pg_temp.esperar_error(text, text) to anon, authenticated;

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALLÓ: %', msg; end if;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;

-- ================= 1. Anónimo: sin acceso =================
set local role anon;
select pg_temp.esperar_error('select * from public.bienes', 'permission denied');
select pg_temp.esperar_error('select * from public.v_operaciones', 'permission denied');
select pg_temp.esperar_error($q$select public.crear_bien('{}')$q$, 'permission denied');
reset role;

-- ================= 2. Usuario logueado que NO es admin =================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.canales) = 0, 'intruso no ve canales');
select pg_temp.check((select count(*) from public.administradores) = 0, 'intruso no ve admins');
select pg_temp.esperar_error($q$insert into public.personas (nombre) values ('x')$q$, 'row-level security');
select pg_temp.esperar_error($q$select public.crear_bien('{"tipo":"auto","marca":"a","modelo":"b","origen":"compra"}')$q$, 'No autorizado');
select pg_temp.esperar_error($q$insert into public.administradores (user_id, nombre) values ('00000000-0000-0000-0000-00000000000b','yo')$q$, 'permission denied');
reset role;

-- ================= 3. Admin: flujo completo =================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select pg_temp.check((select count(*) from public.administradores) = 1, 'admin se ve a sí mismo');
select pg_temp.esperar_error($q$update public.administradores set activo = true$q$, 'permission denied');
select pg_temp.esperar_error($q$insert into public.auditoria (tabla, accion) values ('x','y')$q$, 'permission denied');
select pg_temp.esperar_error($q$insert into public.operaciones (bien_id, cliente_id, precio_venta, moneda) values (1,1,1,'ARS')$q$, 'permission denied');
select pg_temp.esperar_error($q$update public.bienes set estado = 'vendido'$q$, 'permission denied');
select pg_temp.esperar_error($q$insert into public.motivos_caja (nombre, tipo, codigo) values ('x','ingreso','sena')$q$, 'permission denied');

insert into public.personas (nombre, es_cliente) values ('Cliente Uno', true);
insert into public.personas (nombre, es_vendedor) values ('Vendedor', true);
insert into public.personas (nombre, es_dueno) values ('Dueño Consig', true);
insert into public.personas (nombre, es_agenciero) values ('Agenciero', true);
insert into public.personas (nombre, es_cliente) values ('Cliente Dos', true);
insert into public.financieras (nombre, comision_base, comision_valor) values ('Financiera X', 'pct_precio', 2);
select id as cli1 from public.personas where nombre = 'Cliente Uno' \gset
select id as cli2 from public.personas where nombre = 'Cliente Dos' \gset

-- Ejemplo de Martin: auto 7M vendido en 10M con moto en 3M + 7M efectivo
select public.crear_bien('{"tipo":"auto","marca":"Ford","modelo":"Focus","anio":"2018","origen":"compra","costo":"7000000","moneda":"ARS","registrar_egreso":true}') as auto1 \gset
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :auto1, 'cliente_id', (select id from public.personas where nombre='Cliente Uno'),
  'canal_id', (select id from public.canales where nombre='Facebook'),
  'precio_venta', 10000000, 'moneda', 'ARS',
  'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',7000000),
     jsonb_build_object('tipo','bien','monto',3000000,'bien', jsonb_build_object('tipo','moto','marca','Honda','modelo','CB190')))
)) as op1 \gset
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op1) = 3000000, 'ganancia auto = 3M');
select pg_temp.check((select estado from public.bienes where id = :auto1) = 'vendido', 'auto vendido');
select id as moto from public.bienes where origen = 'parte_pago' \gset
select pg_temp.check((select costo from public.bienes where id = :moto) = 3000000, 'moto costo 3M');

-- La moto se vende en 3.2M
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :moto, 'cliente_id', (select id from public.personas where nombre='Cliente Dos'),
  'precio_venta', 3200000, 'moneda', 'ARS',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',3200000))
)) as op2 \gset
select pg_temp.check((select sum(ganancia_neta) from public.operaciones where not anulada) = 3200000, 'ganancia total 3.2M');
select pg_temp.check((select sum(monto) from public.movimientos where tipo='ingreso' and not anulado) = 10200000, 'ingresos 10.2M');

-- No se puede vender dos veces
select pg_temp.esperar_error(format($q$select public.registrar_operacion('{"bien_id":%s,"cliente_id":%s,"precio_venta":1,"moneda":"ARS","pagos":[{"tipo":"efectivo","monto":1}]}')$q$, :auto1, :cli1), 'no está disponible');

-- Pagos que no suman el precio
select public.crear_bien('{"tipo":"auto","marca":"VW","modelo":"Gol","origen":"compra","costo":"5000","moneda":"USD"}') as auto2 \gset
select pg_temp.esperar_error(format($q$select public.registrar_operacion('{"bien_id":%s,"cliente_id":%s,"precio_venta":8000,"moneda":"USD","pagos":[{"tipo":"efectivo","monto":7000}]}')$q$, :auto2, :cli1), 'Tienen que coincidir');
-- Monedas distintas sin cotización
select pg_temp.esperar_error(format($q$select public.registrar_operacion('{"bien_id":%s,"cliente_id":%s,"precio_venta":8000000,"moneda":"ARS","pagos":[{"tipo":"efectivo","monto":8000000}]}')$q$, :auto2, :cli1), 'cotización');

-- Gasto imputado + comisión de vendedor (10% de la ganancia) + financiación con comisión
insert into public.movimientos (tipo, motivo_id, monto, moneda, bien_id)
values ('egreso', (select id from public.motivos_caja where nombre='Arreglos y mecánica'), 200, 'USD', :auto2);
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :auto2, 'cliente_id', (select id from public.personas where nombre='Cliente Uno'),
  'vendedor_id', (select id from public.personas where nombre='Vendedor'),
  'precio_venta', 8000, 'moneda', 'USD',
  'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',3000),
     jsonb_build_object('tipo','financiacion','monto',5000,'financiera_id',(select id from public.financieras limit 1))),
  'comisiones', jsonb_build_array(
     jsonb_build_object('sentido','pagada','persona_id',(select id from public.personas where nombre='Vendedor'),'base','pct_ganancia','valor',10),
     jsonb_build_object('sentido','cobrada','financiera_id',(select id from public.financieras limit 1),'base','pct_precio','valor',2))
)) as op3 \gset
-- bruta = 8000-5000-200 = 2800; vendedor 280; financiera 160 -> neta 2680
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op3) = 2680, 'ganancia con comisiones = 2680');
select pg_temp.check((select count(*) from public.v_alertas where tipo='pago_pendiente') >= 2, 'alertas de pagos pendientes');

-- Consignación vendida por encima del monto acordado
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Fiat','modelo','Cronos','origen','consignacion',
  'dueno_id',(select id from public.personas where nombre='Dueño Consig'),'monto_acordado',6000,'moneda','USD')) as consig \gset
select pg_temp.check((select vence_el from public.acuerdos_terceros where bien_id = :consig) = current_date + 60, 'vencimiento consignación');
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :consig, 'cliente_id', :cli1, 'precio_venta', 6800, 'moneda', 'USD',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','transferencia','monto',6800)))) as op4 \gset
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op4) = 800, 'consignación gana 800');

-- Intermediación con pago directo al agenciero
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Toyota','modelo','Hilux','origen','intermediacion',
  'dueno_id',(select id from public.personas where nombre='Agenciero'),'monto_acordado',30000,'moneda','USD')) as inter \gset
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :inter, 'cliente_id', :cli1, 'precio_venta', 31000, 'moneda', 'USD', 'dinero_por_agencia', false,
  'pagos', jsonb_build_array(jsonb_build_object('tipo','transferencia','monto',31000)))) as op5 \gset
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op5) = 1000, 'intermediación gana 1000');
select pg_temp.check((select count(*) from public.movimientos where operacion_id = :op5) = 1, 'intermediación directa: solo un movimiento');

-- Reserva: seña, venta con descuento de seña
select public.crear_bien('{"tipo":"auto","marca":"Peugeot","modelo":"208","origen":"compra","costo":"10000","moneda":"USD"}') as auto3 \gset
select public.crear_reserva(jsonb_build_object('bien_id', :auto3, 'cliente_id', :cli1, 'monto', 500, 'moneda', 'USD')) as res1 \gset
select pg_temp.check((select estado from public.bienes where id = :auto3) = 'reservado', 'bien reservado');
select pg_temp.esperar_error(format($q$select public.registrar_operacion('{"bien_id":%s,"cliente_id":%s,"precio_venta":12000,"moneda":"USD","pagos":[{"tipo":"efectivo","monto":12000}]}')$q$, :auto3, :cli2), 'reservado por otro');
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :auto3, 'cliente_id', :cli1, 'precio_venta', 12000, 'moneda', 'USD',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',11500)))) as op6 \gset
select pg_temp.check((select estado from public.reservas where id = :res1) = 'concretada', 'reserva concretada');

-- Anular la operación: la reserva vuelve a vigente y el bien a reservado
select public.anular_operacion(:op6, 'Error de carga');
select pg_temp.check((select estado from public.reservas where id = :res1) = 'vigente', 'reserva vigente tras anular');
select pg_temp.check((select estado from public.bienes where id = :auto3) = 'reservado', 'bien reservado tras anular');

-- Cerrar la reserva devolviendo una parte
select public.cerrar_reserva(jsonb_build_object('reserva_id', :res1, 'resultado', 'devuelta_parcial', 'monto_devuelto', 200, 'motivo', 'Caso excepcional'));
select pg_temp.check((select estado from public.bienes where id = :auto3) = 'en_stock', 'bien vuelve a stock');
select pg_temp.check((select senas_retenidas from public.v_resultado_mensual where moneda='USD') = 300, 'seña retenida 300');

-- La anulación de la operación 1 no se permite porque la moto ya se vendió
select pg_temp.esperar_error(format('select public.anular_operacion(%s, %L)', :op1, 'x'), 'ya se vendió');

-- Movimientos automáticos no se pueden borrar ni crear a mano
select pg_temp.esperar_error($q$insert into public.movimientos (tipo, motivo_id, monto, automatico) values ('ingreso', 1, 10, true)$q$, 'row-level security');
with d as (delete from public.movimientos where automatico returning 1) select pg_temp.check(count(*) = 0, 'no borra automáticos') from d;
-- Motivo y tipo deben coincidir
select pg_temp.esperar_error($q$insert into public.movimientos (tipo, motivo_id, monto) values ('ingreso', (select id from public.motivos_caja where nombre='Alquiler'), 10)$q$, 'no corresponde');
-- Motivos del sistema protegidos
select pg_temp.esperar_error($q$delete from public.motivos_caja where codigo = 'sena'$q$, 'no se puede modificar');
-- Bien vendido no se edita
with u as (update public.bienes set notas = 'x' where id = :auto1 returning 1) select pg_temp.check(count(*) = 0, 'no edita bien vendido') from u;

-- ================= 4. Correcciones de la revisión externa =================
-- (a) Auto en dólares con un gasto en pesos, pagado en parte con pesos
select public.crear_bien('{"tipo":"auto","marca":"VW","modelo":"Amarok","origen":"compra","costo":"10000","moneda":"USD","registrar_egreso":true}') as amarok \gset
insert into public.movimientos (tipo, motivo_id, monto, moneda, bien_id)
values ('egreso', (select id from public.motivos_caja where nombre='Gestoría y transferencia'), 300000, 'ARS', :amarok);
select pg_temp.esperar_error(format($q$select public.registrar_operacion(jsonb_build_object('bien_id', %s, 'cliente_id', %s,
  'precio_venta', 12000, 'moneda', 'USD', 'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',12000))))$q$, :amarok, :cli2), 'cotización');
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :amarok, 'cliente_id', :cli2, 'precio_venta', 12000, 'moneda', 'USD', 'cotizacion', 1000,
  'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',5000000,'moneda','ARS'),
     jsonb_build_object('tipo','efectivo','monto',7000,'moneda','USD')))) as op7 \gset
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op7) = 1700, 'USD con gasto ARS: gana 1700');
select pg_temp.check((select count(*) from public.movimientos where operacion_id = :op7 and moneda = 'ARS' and monto = 5000000) = 1, 'cobro en pesos queda en pesos');
select pg_temp.check((select count(*) from public.movimientos where operacion_id = :op7 and moneda = 'USD' and monto = 7000) = 1, 'cobro en dólares queda en dólares');
-- Editar el costo de un bien propio actualiza su movimiento de compra
select public.crear_bien('{"tipo":"moto","marca":"Yamaha","modelo":"FZ","origen":"compra","costo":"1000","moneda":"USD","registrar_egreso":true}') as fz \gset
update public.bienes set costo = 1200 where id = :fz;
select pg_temp.check((select monto from public.movimientos where bien_id = :fz and automatico) = 1200, 'compra sincronizada con el costo');

-- (b) Dos financiaciones: se cobra una sola
select public.crear_bien('{"tipo":"auto","marca":"Fiat","modelo":"Cronos","origen":"compra","costo":"5000","moneda":"USD"}') as cronos \gset
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :cronos, 'cliente_id', :cli2, 'precio_venta', 8000, 'moneda', 'USD',
  'pagos', jsonb_build_array(
     jsonb_build_object('tipo','financiacion','monto',4000,'financiera_id',(select id from public.financieras limit 1)),
     jsonb_build_object('tipo','financiacion','monto',4000,'financiera_id',(select id from public.financieras limit 1))))) as op8 \gset
select public.marcar_financiacion_cobrada((select min(id) from public.operacion_pagos where operacion_id = :op8));
select pg_temp.check((select count(*) from public.movimientos where operacion_id = :op8 and pendiente) = 1, 'la otra financiación sigue pendiente');
-- Un cobro automático no se edita a mano (ni se marca pagada una financiación por fuera)
select pg_temp.esperar_error(format($q$update public.movimientos set pendiente = false where operacion_id = %s and pendiente$q$, :op8), 'generó el sistema');
select pg_temp.esperar_error(format($q$update public.movimientos set fecha = fecha - 1 where operacion_id = %s$q$, :op7), 'generó el sistema');
-- No se cobra una financiación de una operación anulada
select public.anular_operacion(:op8, 'prueba');
select pg_temp.esperar_error(format('select public.marcar_financiacion_cobrada(%s)', (select max(id) from public.operacion_pagos where operacion_id = :op8)), 'ya cobrado');

-- (c) Intermediación directa con seña mayor que la comisión: queda saldo para el agenciero
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Toyota','modelo','Corolla','origen','intermediacion',
  'dueno_id',(select id from public.personas where nombre='Agenciero'),'monto_acordado',30000,'moneda','USD')) as inter2 \gset
select public.crear_reserva(jsonb_build_object('bien_id', :inter2, 'cliente_id', :cli2, 'monto', 2000, 'moneda', 'USD')) as res2 \gset
select pg_temp.esperar_error(format($q$select public.registrar_operacion(jsonb_build_object('bien_id', %s, 'cliente_id', %s,
  'precio_venta', 31000, 'moneda', 'USD', 'dinero_por_agencia', false, 'pagos', jsonb_build_array(
    jsonb_build_object('tipo','transferencia','monto',19000),
    jsonb_build_object('tipo','bien','monto',10000,'bien', jsonb_build_object('tipo','moto','marca','X','modelo','Y')))))$q$, :inter2, :cli2), 'directo al agenciero');
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :inter2, 'cliente_id', :cli2, 'precio_venta', 31000, 'moneda', 'USD', 'dinero_por_agencia', false,
  'pagos', jsonb_build_array(jsonb_build_object('tipo','transferencia','monto',29000)))) as op9 \gset
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op9) = 1000, 'intermediación con seña gana 1000');
select pg_temp.check((select monto from public.movimientos m join public.motivos_caja mc on mc.id = m.motivo_id
                      where m.operacion_id = :op9 and mc.codigo = 'pago_tercero' and m.pendiente) = 1000, 'saldo de seña 1000 para el agenciero');

-- (d) Segunda revisión: tolerancia de redondeo y costo cero
select public.crear_bien('{"tipo":"auto","marca":"Renault","modelo":"Kangoo","origen":"compra","costo":"5000","moneda":"USD"}') as kangoo \gset
select pg_temp.esperar_error(format($q$select public.registrar_operacion(jsonb_build_object('bien_id', %s, 'cliente_id', %s,
  'precio_venta', 8000, 'moneda', 'USD', 'cotizacion', 1000,
  'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',7999020,'moneda','ARS'))))$q$, :kangoo, :cli2), 'Tienen que coincidir');
update public.bienes set costo = 0 where id = :fz;
select pg_temp.check((select anulado from public.movimientos where bien_id = :fz and automatico), 'costo 0 anula la compra');

-- Auditoría registrada
select pg_temp.check((select count(*) from public.auditoria) > 20, 'auditoría registrada');

reset role;
rollback;
\echo 'TODAS LAS PRUEBAS PASARON'
