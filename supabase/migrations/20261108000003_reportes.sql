-- =====================================================================
-- Level Cars · Migración 0003: vistas de reportes y alertas.
-- Todas usan security_invoker, así respetan la RLS de quien consulta.
-- =====================================================================

create or replace view public.v_operaciones
with (security_invoker = true) as
select
  o.id,
  o.fecha,
  o.bien_id,
  b.tipo        as bien_tipo,
  b.marca,
  b.modelo,
  b.anio,
  b.dominio,
  b.origen      as tipo_operacion,
  o.cliente_id,
  c.nombre      as cliente,
  o.canal_id,
  ca.nombre     as canal,
  o.vendedor_id,
  v.nombre      as vendedor,
  o.precio_venta,
  o.moneda,
  o.cotizacion,
  o.costo_bien,
  o.monto_tercero,
  o.gastos_bien,
  o.comisiones_pagadas,
  o.comisiones_cobradas,
  o.ganancia_neta,
  o.dinero_por_agencia,
  o.anulada,
  o.notas,
  exists (select 1 from public.operacion_pagos p where p.operacion_id = o.id and p.tipo = 'bien')         as con_parte_pago,
  exists (select 1 from public.operacion_pagos p where p.operacion_id = o.id and p.tipo = 'financiacion') as con_financiacion
from public.operaciones o
join public.bienes b on b.id = o.bien_id
join public.personas c on c.id = o.cliente_id
left join public.canales ca on ca.id = o.canal_id
left join public.personas v on v.id = o.vendedor_id;

-- Resultado por mes y moneda: ganancia de operaciones menos gastos fijos
create or replace view public.v_resultado_mensual
with (security_invoker = true) as
with ops as (
  select date_trunc('month', fecha)::date as mes, moneda,
         count(*) as operaciones,
         sum(precio_venta) as ventas,
         sum(ganancia_neta) as ganancia_operaciones
  from public.operaciones
  where not anulada
  group by 1, 2
),
fijos as (
  select date_trunc('month', m.fecha)::date as mes, m.moneda, sum(m.monto) as gastos_fijos
  from public.movimientos m
  join public.motivos_caja mc on mc.id = m.motivo_id
  where m.tipo = 'egreso' and mc.es_gasto_fijo and not m.anulado
  group by 1, 2
),
senas as (
  select date_trunc('month', cerrada_en)::date as mes, moneda,
         sum(monto - monto_devuelto) as senas_retenidas
  from public.reservas
  where estado in ('retenida', 'devuelta_parcial')
  group by 1, 2
)
select
  coalesce(o.mes, f.mes, s.mes)          as mes,
  coalesce(o.moneda, f.moneda, s.moneda) as moneda,
  coalesce(o.operaciones, 0)             as operaciones,
  coalesce(o.ventas, 0)                  as ventas,
  coalesce(o.ganancia_operaciones, 0)    as ganancia_operaciones,
  coalesce(s.senas_retenidas, 0)         as senas_retenidas,
  coalesce(f.gastos_fijos, 0)            as gastos_fijos,
  coalesce(o.ganancia_operaciones, 0) + coalesce(s.senas_retenidas, 0) - coalesce(f.gastos_fijos, 0) as resultado
from ops o
full join fijos f on f.mes = o.mes and f.moneda = o.moneda
full join senas s on s.mes = coalesce(o.mes, f.mes) and s.moneda = coalesce(o.moneda, f.moneda);

-- Caja: saldo por moneda y medio (sin pendientes ni anulados)
create or replace view public.v_saldo_caja
with (security_invoker = true) as
select moneda, medio,
       sum(case when tipo = 'ingreso' then monto else -monto end) as saldo
from public.movimientos
where not pendiente and not anulado
group by moneda, medio;

-- Alertas para el inicio
create or replace view public.v_alertas
with (security_invoker = true) as
with cfg as (select * from public.configuracion where id = 1)
select 'consignacion_vencida'::text as tipo,
       'Consignación vencida: ' || b.marca || ' ' || b.modelo as titulo,
       'Venció el ' || to_char(a.vence_el, 'DD/MM/YYYY') || '. Avisá al dueño o renová el plazo.' as detalle,
       b.id as bien_id, null::bigint as operacion_id, null::bigint as reserva_id,
       a.vence_el as fecha
from public.acuerdos_terceros a
join public.bienes b on b.id = a.bien_id
where a.estado = 'vigente' and a.vence_el is not null and a.vence_el < current_date
  and b.estado in ('en_stock', 'reservado')
union all
select 'reserva_vencida',
       'Reserva vencida: ' || b.marca || ' ' || b.modelo,
       'Venció el ' || to_char(r.vence_el, 'DD/MM/YYYY') || '. Concretá la venta o cerrá la reserva.',
       b.id, null, r.id, r.vence_el
from public.reservas r
join public.bienes b on b.id = r.bien_id
where r.estado = 'vigente' and r.vence_el < current_date
union all
select 'financiacion_pendiente',
       'Financiación sin cobrar: ' || b.marca || ' ' || b.modelo,
       'Operación del ' || to_char(o.fecha, 'DD/MM/YYYY') || ' con ' || f.nombre || '.',
       b.id, o.id, null, o.fecha
from public.operacion_pagos p
join public.operaciones o on o.id = p.operacion_id
join public.bienes b on b.id = o.bien_id
join public.financieras f on f.id = p.financiera_id
cross join cfg
where p.tipo = 'financiacion' and not p.cobrado and not o.anulada
  and o.fecha < current_date - cfg.dias_alerta_financiacion
union all
select 'pago_pendiente',
       case when m.tipo = 'egreso' then 'Pago pendiente: ' else 'Cobro pendiente: ' end || mc.nombre,
       coalesce(m.descripcion, '') || coalesce(' · ' || pe.nombre, ''),
       m.bien_id, m.operacion_id, null, m.fecha
from public.movimientos m
join public.motivos_caja mc on mc.id = m.motivo_id
left join public.personas pe on pe.id = m.persona_id
where m.pendiente and not m.anulado
  and mc.codigo is distinct from 'cobro_venta'   -- las financiaciones tienen su propia alerta
union all
select 'stock_antiguo',
       'Mucho tiempo en stock: ' || b.marca || ' ' || b.modelo,
       'Lleva ' || (current_date - b.fecha_ingreso) || ' días en la agencia.',
       b.id, null, null, b.fecha_ingreso
from public.bienes b
cross join cfg
where b.estado = 'en_stock' and b.origen in ('compra', 'parte_pago')
  and b.fecha_ingreso < current_date - cfg.dias_alerta_stock;

-- Stock con días en la agencia y gastos cargados
create or replace view public.v_stock
with (security_invoker = true) as
select b.*,
       current_date - b.fecha_ingreso as dias_en_stock,
       d.nombre as dueno,
       a.monto_acordado, a.vence_el as acuerdo_vence_el,
       coalesce((select sum(m.monto) from public.movimientos m
                 join public.motivos_caja mc on mc.id = m.motivo_id
                 where m.bien_id = b.id and m.tipo = 'egreso' and m.operacion_id is null
                   and m.reserva_id is null and not m.anulado and not mc.es_gasto_fijo
                   and mc.codigo is distinct from 'compra_vehiculo'
                   and m.moneda = b.moneda), 0) as gastos_misma_moneda,
       (select f.ruta from public.bien_fotos f where f.bien_id = b.id order by f.orden, f.id limit 1) as foto
from public.bienes b
left join public.personas d on d.id = b.dueno_id
left join public.acuerdos_terceros a on a.bien_id = b.id;

grant select on public.v_operaciones, public.v_resultado_mensual, public.v_saldo_caja,
                public.v_alertas, public.v_stock to authenticated;
revoke all on public.v_operaciones, public.v_resultado_mensual, public.v_saldo_caja,
              public.v_alertas, public.v_stock from anon;
