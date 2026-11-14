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

-- ================= 5. Correcciones (migración 0010) =================
-- Caso real: se vendió como propio un auto que era de consignación
select public.crear_bien('{"tipo":"auto","marca":"Toyota","modelo":"Etios","origen":"compra","costo":"17000000","moneda":"ARS","registrar_egreso":true}') as etios \gset
select public.registrar_operacion(jsonb_build_object('bien_id', :etios, 'cliente_id', :cli1, 'precio_venta', 20000000, 'moneda', 'ARS',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',20000000)))) as op_mal \gset
select public.corregir_operacion(:op_mal, jsonb_build_object(
  'motivo', 'Era consignación',
  'bien', jsonb_build_object('origen','consignacion','dueno_id',(select id from public.personas where nombre='Dueño Consig'),'monto_acordado',18500000),
  'operacion', jsonb_build_object('cliente_id', :cli1, 'precio_venta', 20000000, 'moneda', 'ARS',
     'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',20000000))))) as op_bien \gset
select pg_temp.check((select anulada and corregida_por = :op_bien from public.operaciones where id = :op_mal), 'la original queda anulada y apunta a la nueva');
select pg_temp.check((select ganancia_neta from public.operaciones where id = :op_bien) = 1500000, 'corregida: gana 1,5M (consignación)');
select pg_temp.check((select origen = 'consignacion' and estado = 'vendido' and costo = 0 from public.bienes where id = :etios), 'el bien quedó como consignación vendido');
select pg_temp.check((select count(*) from public.movimientos m join public.motivos_caja mc on mc.id = m.motivo_id
                      where m.bien_id = :etios and mc.codigo = 'compra_vehiculo' and not m.anulado) = 0, 'la compra mal cargada quedó anulada');
select pg_temp.check((select count(*) from public.movimientos m join public.motivos_caja mc on mc.id = m.motivo_id
                      where m.operacion_id = :op_bien and mc.codigo = 'pago_tercero' and m.monto = 18500000) = 1, 'queda pendiente el pago al dueño');
select pg_temp.check((select estado from public.acuerdos_terceros where bien_id = :etios) = 'vendido', 'acuerdo vendido');
select pg_temp.esperar_error(format($q$select public.corregir_operacion(%s, '{"operacion":{}}')$q$, :op_mal), 'ya está anulada');
-- Si la corrección falla, no queda nada a medias
select pg_temp.esperar_error(format($q$select public.corregir_operacion(%s, jsonb_build_object('operacion', jsonb_build_object('cliente_id', %s,
  'precio_venta', 20000000, 'moneda', 'ARS', 'pagos', '[]'::jsonb)))$q$, :op_bien, :cli1), 'Tienen que coincidir');
select pg_temp.check((select not anulada from public.operaciones where id = :op_bien), 'una corrección fallida no anula nada');

-- Cambiar origen en stock: intermediación -> propio, y vuelta
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Ford','modelo','Ka','origen','intermediacion','en_agencia',false,
  'dueno_id',(select id from public.personas where nombre='Agenciero'),'monto_acordado',8000,'moneda','USD')) as ka \gset
select pg_temp.check((select not en_agencia from public.bienes where id = :ka), 'bien fuera de la agencia');
select public.cambiar_origen_bien(jsonb_build_object('bien_id', :ka, 'origen','compra','costo',7500,'registrar_egreso',true));
select pg_temp.check((select origen = 'compra' and costo = 7500 and dueno_id is null from public.bienes where id = :ka), 'pasó a propio');
select pg_temp.check((select count(*) from public.acuerdos_terceros where bien_id = :ka) = 0, 'sin acuerdo');
select pg_temp.check((select count(*) from public.movimientos where bien_id = :ka and automatico and not anulado) = 1, 'compra registrada');

-- Borrar un bien cargado por error
select pg_temp.check(public.borrar_bien(:ka) = '{}', 'bien borrado');
select pg_temp.check((select count(*) from public.bienes where id = :ka) = 0, 'ya no existe');
select pg_temp.esperar_error(format('select public.borrar_bien(%s)', :etios), 'en stock');

-- Movimiento manual: se edita todo; uno automático no cambia de monto
insert into public.movimientos (tipo, motivo_id, monto, moneda) values ('egreso', (select id from public.motivos_caja where nombre='Publicidad'), 100, 'ARS') returning id as mman \gset
update public.movimientos set monto = 150, moneda = 'USD', motivo_id = (select id from public.motivos_caja where nombre='Alquiler') where id = :mman;
select pg_temp.check((select monto = 150 and moneda = 'USD' from public.movimientos where id = :mman), 'movimiento manual editado');
select pg_temp.esperar_error(format($q$update public.movimientos set monto = 1 where operacion_id = %s$q$, :op_bien), 'generó el sistema');

-- ================= 6. Revisión de las correcciones (migración 0011) =================
-- Venta con moto recibida y comisión ya pagada; después se corrige el precio de la comisión no, solo el canal.
select public.crear_bien('{"tipo":"auto","marca":"Chevrolet","modelo":"Onix","origen":"compra","costo":"8000","moneda":"USD"}') as onix \gset
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :onix, 'cliente_id', :cli1, 'precio_venta', 10000, 'moneda', 'USD',
  'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',7000),
     jsonb_build_object('tipo','bien','monto',3000,'bien', jsonb_build_object('tipo','moto','marca','Honda','modelo','Wave'))),
  'comisiones', jsonb_build_array(
     jsonb_build_object('sentido','pagada','persona_id',(select id from public.personas where nombre='Vendedor'),'base','fijo','valor',100)))) as opx \gset
select bien_recibido_id as wave from public.operacion_pagos where operacion_id = :opx and tipo = 'bien' \gset
update public.bienes set precio_publicado = 3500, color = 'Rojo' where id = :wave;
update public.movimientos set pendiente = false
 where operacion_id = :opx and pendiente and motivo_id = (select id from public.motivos_caja where codigo = 'comision_pagada');
-- La moto recibida se vende: igual se tiene que poder corregir la venta original
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :wave, 'cliente_id', :cli2, 'precio_venta', 3500, 'moneda', 'USD',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','efectivo','monto',3500)))) as op_wave \gset
-- No se puede cambiar el valor de un bien recibido que ya se vendió, ni quitarlo de la venta
select pg_temp.esperar_error(format($q$select public.corregir_operacion(%s, jsonb_build_object('motivo','x','operacion', jsonb_build_object(
  'cliente_id', %s, 'precio_venta', 10000, 'moneda', 'USD', 'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',6000),
     jsonb_build_object('tipo','bien','monto',4000,'bien_existente_id',%s)))))$q$, :opx, :cli1, :wave), 'ya se vendió');
select pg_temp.esperar_error(format($q$select public.corregir_operacion(%s, jsonb_build_object('motivo','x','operacion', jsonb_build_object(
  'cliente_id', %s, 'precio_venta', 10000, 'moneda', 'USD', 'pagos', jsonb_build_array(
     jsonb_build_object('tipo','efectivo','monto',10000)))))$q$, :opx, :cli1), 'no se puede quitar');
select pg_temp.check((select not anulada from public.operaciones where id = :opx), 'la corrección fallida no anuló nada');
-- Corrección válida: pasa a consignación, la moto y la comisión pagada se conservan
select public.corregir_operacion(:opx, jsonb_build_object('motivo', 'era consignación',
  'bien', jsonb_build_object('origen','consignacion','dueno_id',(select id from public.personas where nombre='Dueño Consig'),'monto_acordado',9000),
  'operacion', jsonb_build_object('cliente_id', :cli1, 'precio_venta', 10000, 'moneda', 'USD',
    'pagos', jsonb_build_array(
       jsonb_build_object('tipo','efectivo','monto',7000),
       jsonb_build_object('tipo','bien','monto',3000,'bien_existente_id', :wave)),
    'comisiones', jsonb_build_array(
       jsonb_build_object('sentido','pagada','persona_id',(select id from public.personas where nombre='Vendedor'),'base','fijo','valor',100))))) as opx2 \gset
select pg_temp.check((select bien_recibido_id from public.operacion_pagos where operacion_id = :opx2 and tipo = 'bien') = :wave, 'la moto recibida es la misma');
select pg_temp.check((select estado = 'vendido' and color = 'Rojo' from public.bienes where id = :wave), 'la moto conserva su estado y sus datos');
select pg_temp.check((select not anulada from public.operaciones where id = :op_wave), 'la venta de la moto no se tocó');
select pg_temp.check((select count(*) from public.bienes where marca = 'Honda' and modelo = 'Wave') = 1, 'no se duplicó la moto');
select pg_temp.check((select not pendiente from public.movimientos
  where operacion_id = :opx2 and motivo_id = (select id from public.motivos_caja where codigo = 'comision_pagada')), 'la comisión pagada sigue pagada');
select pg_temp.check((select pendiente and monto = 9000 from public.movimientos
  where operacion_id = :opx2 and motivo_id = (select id from public.motivos_caja where codigo = 'pago_tercero')), 'el pago al dueño queda pendiente');
select pg_temp.check((select ganancia_neta from public.operaciones where id = :opx2) = 900, 'gana 900 tras corregir');
-- El historial conserva el origen que tenía cada versión
select pg_temp.check((select tipo_operacion from public.v_operaciones where id = :opx) = 'compra', 'la original figura como propia');
select pg_temp.check((select tipo_operacion from public.v_operaciones where id = :opx2) = 'consignacion', 'la corregida figura como consignación');
-- Un bien ajeno no se puede colar como "ya recibido"
select pg_temp.esperar_error(format($q$select public.registrar_operacion(jsonb_build_object('bien_id', %s, 'cliente_id', %s,
  'precio_venta', 100, 'moneda', 'USD', 'pagos', jsonb_build_array(jsonb_build_object('tipo','bien','monto',100,'bien_existente_id',%s))))$q$, :fz, :cli1, :wave), 'no corresponde a esta venta');
-- Cambiar entre consignación e intermediación conserva la comisión pactada
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Kia','modelo','Rio','origen','consignacion',
  'dueno_id',(select id from public.personas where nombre='Dueño Consig'),'monto_acordado',5000,'moneda','USD','comision_base','pct_precio','comision_valor',5)) as rio \gset
select public.cambiar_origen_bien(jsonb_build_object('bien_id', :rio, 'origen','intermediacion',
  'dueno_id',(select id from public.personas where nombre='Agenciero'),'monto_acordado',5200));
select pg_temp.check((select tipo = 'intermediacion' and monto_acordado = 5200 and comision_valor = 5 from public.acuerdos_terceros where bien_id = :rio), 'acuerdo conserva la comisión');
-- Los motivos del sistema no sirven para movimientos manuales
select pg_temp.esperar_error($q$insert into public.movimientos (tipo, motivo_id, monto) values ('ingreso', (select id from public.motivos_caja where codigo='cobro_venta'), 10)$q$, 'lo usa el sistema');
select pg_temp.esperar_error(format($q$update public.movimientos set motivo_id = (select id from public.motivos_caja where codigo='comision_pagada') where id = %s$q$, :mman), 'lo usa el sistema');
select pg_temp.esperar_error(format($q$update public.movimientos set bien_id = %s where id = %s$q$, :fz, :mman), 'permission denied');

-- ================= 7. Caja: el medio se elige al pagar (migración 0013) =================
select public.crear_bien(jsonb_build_object('tipo','auto','marca','Toyota','modelo','Etios','origen','consignacion',
  'dueno_id',(select id from public.personas where nombre='Dueño Consig'),'monto_acordado',17000,'moneda','USD')) as etios \gset
select public.registrar_operacion(jsonb_build_object(
  'bien_id', :etios, 'cliente_id', :cli1, 'precio_venta', 20000, 'moneda', 'USD',
  'pagos', jsonb_build_array(jsonb_build_object('tipo','transferencia','monto',20000)),
  'comisiones', jsonb_build_array(jsonb_build_object('sentido','pagada','persona_id',(select id from public.personas where nombre='Vendedor'),'base','fijo','valor',1000)))) as op_etios \gset
select m.id as pago_dueno from public.movimientos m join public.motivos_caja mc on mc.id = m.motivo_id
 where m.operacion_id = :op_etios and mc.codigo = 'pago_tercero' \gset
select pg_temp.esperar_error(format('select public.resolver_movimiento(%s, null)', :pago_dueno), 'efectivo o por banco');
select public.resolver_movimiento(:pago_dueno, 'banco');
select pg_temp.check((select not pendiente and medio = 'banco' from public.movimientos where id = :pago_dueno), 'pago al dueño resuelto por banco');
select pg_temp.esperar_error(format('select public.resolver_movimiento(%s, %L)', :pago_dueno, 'efectivo'), 'ya estaba resuelto');
select m.id as com_etios from public.movimientos m join public.motivos_caja mc on mc.id = m.motivo_id
 where m.operacion_id = :op_etios and mc.codigo = 'comision_pagada' \gset
select public.resolver_movimiento(:com_etios, 'efectivo');
select public.cambiar_medio_movimiento(:com_etios, 'banco');
select pg_temp.check((select medio = 'banco' from public.movimientos where id = :com_etios), 'medio corregido');
select pg_temp.esperar_error(format($q$select public.cambiar_medio_movimiento((select id from public.movimientos where operacion_id = %s and monto = 20000), 'efectivo')$q$, :op_etios), 'no se cambia');

-- Auditoría registrada
select pg_temp.check((select count(*) from public.auditoria) > 20, 'auditoría registrada');

reset role;
rollback;
\echo 'TODAS LAS PRUEBAS PASARON'
