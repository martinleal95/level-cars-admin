-- =====================================================================
-- Level Cars · Migración 0011: ajustes de la revisión externa sobre las
-- correcciones (0010).
--  * Al corregir una venta se conservan los bienes recibidos como parte de
--    pago (con sus fotos, gastos e historia) y lo que ya estaba pagado.
--  * Cada operación guarda el origen que tenía el bien al venderse.
--  * Los motivos del sistema no se pueden usar en movimientos manuales.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Origen del bien al momento de la venta (para que el historial de una
--    operación anulada no cambie si después se corrige el bien).
-- ---------------------------------------------------------------------
alter table public.operaciones add column origen public.origen_bien;
update public.operaciones o set origen = b.origen from public.bienes b where b.id = o.bien_id;
alter table public.operaciones alter column origen set not null;

create function private.operacion_fijar_origen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select origen into new.origen from public.bienes where id = new.bien_id;
  return new;
end;
$$;
revoke execute on function private.operacion_fijar_origen() from public, anon, authenticated;

create trigger operaciones_fijar_origen
  before insert on public.operaciones
  for each row execute function private.operacion_fijar_origen();

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
  o.origen      as tipo_operacion,
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

-- ---------------------------------------------------------------------
-- 2) Las funciones grandes se ajustan sobre su definición vigente (así no
--    se repiten cientos de líneas). Cada reemplazo se verifica.
-- ---------------------------------------------------------------------
create or replace function pg_temp.reemplazar(p_def text, p_buscar text, p_nuevo text) returns text
language plpgsql as $$
begin
  if (length(p_def) - length(replace(p_def, p_buscar, ''))) / length(p_buscar) <> 1 then
    raise exception 'Migración 0011: no se encontró una sola vez el texto: %', left(p_buscar, 80);
  end if;
  return replace(p_def, p_buscar, p_nuevo);
end;
$$;

do $mig$
declare
  v_def text;
begin
  -- 2a) anular_operacion_interna: igual que anular_operacion, pero puede
  --     conservar en el stock algunos bienes recibidos (los que siguen en
  --     la operación corregida).
  v_def := pg_get_functiondef('private.anular_operacion(bigint, text)'::regprocedure);
  v_def := pg_temp.reemplazar(v_def,
    'private.anular_operacion(p_operacion_id bigint, p_motivo text)',
    'private.anular_operacion_interna(p_operacion_id bigint, p_motivo text, p_conservar bigint[])');
  v_def := pg_temp.reemplazar(v_def,
    $t$where op.operacion_id = o.id and bb.estado <> 'en_stock'$t$,
    $t$where op.operacion_id = o.id and bb.estado <> 'en_stock' and bb.id <> all (p_conservar)$t$);
  v_def := pg_temp.reemplazar(v_def,
    $t$where operacion_id = o.id and bien_recibido_id is not null);$t$,
    $t$where operacion_id = o.id and bien_recibido_id is not null
                  and bien_recibido_id <> all (p_conservar));$t$);
  execute v_def;

  -- 2b) registrar_operacion: un pago con bien puede referirse a un bien que
  --     ya se había recibido en una versión anterior (anulada) de esta venta.
  v_def := pg_get_functiondef('private.registrar_operacion(jsonb)'::regprocedure);
  v_def := pg_temp.reemplazar(v_def,
    $t$  v_com_inter     numeric;$t$,
    $t$  v_com_inter     numeric;
  bx              public.bienes%rowtype;$t$);
  v_def := pg_temp.reemplazar(v_def,
    $t$      if jsonb_typeof(v_pago -> 'bien') <> 'object' then$t$,
    $t$      if nullif(v_pago ->> 'bien_existente_id', '') is not null then
        select * into bx from public.bienes
         where id = (v_pago ->> 'bien_existente_id')::bigint for update;
        if bx.id is null or bx.origen <> 'parte_pago'
           or not exists (select 1 from public.operacion_pagos op
                          join public.operaciones oo on oo.id = op.operacion_id
                          where op.bien_recibido_id = bx.id and oo.bien_id = b.id and oo.anulada)
           or exists (select 1 from public.operacion_pagos op
                      join public.operaciones oo on oo.id = op.operacion_id
                      where op.bien_recibido_id = bx.id and not oo.anulada) then
          raise exception 'El bien recibido no corresponde a esta venta' using errcode = '22023';
        end if;
        if bx.costo <> v_monto_pago or bx.moneda <> v_moneda_pago then
          if bx.estado = 'vendido' then
            raise exception 'El % % que se recibió como parte de pago ya se vendió: no se puede cambiar el valor al que se tomó',
              bx.marca, bx.modelo using errcode = '22023';
          end if;
          update public.bienes set costo = v_monto_pago, moneda = v_moneda_pago where id = bx.id;
        end if;
        v_nuevo_bien := bx.id;
      else
      if jsonb_typeof(v_pago -> 'bien') <> 'object' then$t$);
  v_def := pg_temp.reemplazar(v_def,
    $t$      ) returning id into v_nuevo_bien;$t$,
    $t$      ) returning id into v_nuevo_bien;
      end if;$t$);
  execute v_def;

  -- 2c) cambiar_origen_bien: si no se informa comisión o vencimiento, se
  --     conservan los que ya tenía el acuerdo.
  v_def := pg_get_functiondef('private.cambiar_origen_bien(jsonb)'::regprocedure);
  v_def := pg_temp.reemplazar(v_def,
    $t$moneda = excluded.moneda, comision_base = excluded.comision_base,
           comision_valor = excluded.comision_valor, vence_el = excluded.vence_el, estado = 'vigente';$t$,
    $t$moneda = excluded.moneda,
           comision_base = case when p ? 'comision_base' then excluded.comision_base else acuerdos_terceros.comision_base end,
           comision_valor = case when p ? 'comision_valor' then excluded.comision_valor else acuerdos_terceros.comision_valor end,
           vence_el = case when p ? 'vence_el' then excluded.vence_el
                           else coalesce(acuerdos_terceros.vence_el, excluded.vence_el) end,
           estado = 'vigente';$t$);
  execute v_def;
end;
$mig$;

revoke all on function private.anular_operacion_interna(bigint, text, bigint[]) from public, anon, authenticated;

create or replace function private.anular_operacion(p_operacion_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.anular_operacion_interna(p_operacion_id, p_motivo, '{}'::bigint[]);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Corregir una operación, conservando lo que no cambió.
-- ---------------------------------------------------------------------
create or replace function private.corregir_operacion(p_operacion_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o           public.operaciones%rowtype;
  v_nueva     bigint;
  v_motivo    text := nullif(btrim(p ->> 'motivo'), '');
  v_conservar bigint[];
  v_usados    bigint[] := '{}';
  m           record;
  v_viejo     record;
  bx          public.bienes%rowtype;
begin
  perform private.exigir_admin();

  select * into o from public.operaciones where id = p_operacion_id for update;
  if o.id is null then
    raise exception 'La operación no existe' using errcode = 'P0002';
  end if;
  if o.anulada then
    raise exception 'La operación ya está anulada: no se puede corregir' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'operacion') is distinct from 'object'
     or jsonb_typeof(coalesce(p -> 'operacion' -> 'pagos', '[]'::jsonb)) <> 'array' then
    raise exception 'Faltan los datos corregidos de la operación' using errcode = '22023';
  end if;
  if char_length(coalesce(v_motivo, '')) > 400 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001';
  end if;

  -- Bienes recibidos que siguen en la venta corregida: no se tocan.
  select coalesce(array_agg(op.bien_recibido_id), '{}') into v_conservar
    from public.operacion_pagos op
   where op.operacion_id = o.id and op.bien_recibido_id is not null
     and op.bien_recibido_id in (
       select nullif(x ->> 'bien_existente_id', '')::bigint
         from jsonb_array_elements(coalesce(p -> 'operacion' -> 'pagos', '[]'::jsonb)) x);

  -- Un bien recibido que se quita de la venta sale del stock: tiene que estar libre.
  select bb.* into bx
    from public.operacion_pagos op
    join public.bienes bb on bb.id = op.bien_recibido_id
   where op.operacion_id = o.id and bb.estado <> 'en_stock' and bb.id <> all (v_conservar)
   limit 1;
  if bx.id is not null then
    raise exception 'El % % que se recibió como parte de pago ya se vendió o reservó: no se puede quitar de esta venta',
      bx.marca, bx.modelo using errcode = '22023';
  end if;

  perform private.anular_operacion_interna(
    o.id, 'Corrección: ' || coalesce(v_motivo, 'datos mal cargados'), v_conservar);

  if jsonb_typeof(p -> 'bien') = 'object' then
    perform private.cambiar_origen_bien((p -> 'bien') || jsonb_build_object('bien_id', o.bien_id));
  end if;

  v_nueva := private.registrar_operacion((p -> 'operacion') || jsonb_build_object('bien_id', o.bien_id));

  -- Lo que ya estaba pagado o cobrado (comisiones, pago al dueño) sigue así
  -- si quedó igual: misma persona, mismo motivo, mismo monto y moneda.
  for m in
    select id, motivo_id, persona_id, monto, moneda
      from public.movimientos
     where operacion_id = v_nueva and automatico and pendiente and not anulado and pago_id is null
     order by id
  loop
    select v.id, v.medio into v_viejo
      from public.movimientos v
     where v.operacion_id = o.id and v.automatico and v.anulado and not v.pendiente
       and v.pago_id is null and v.reserva_id is null
       and v.motivo_id = m.motivo_id and v.persona_id is not distinct from m.persona_id
       and v.monto = m.monto and v.moneda = m.moneda
       and v.id <> all (v_usados)
     order by v.id
     limit 1;
    if v_viejo.id is not null then
      update public.movimientos set pendiente = false, medio = v_viejo.medio where id = m.id;
      v_usados := v_usados || v_viejo.id;
    end if;
  end loop;

  update public.operaciones set corregida_por = v_nueva where id = o.id;
  return v_nueva;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Movimientos manuales: no pueden usar los motivos del sistema
--    (cobro de venta, comisiones, compra...) ni cambiar de bien.
-- ---------------------------------------------------------------------
revoke update (bien_id) on public.movimientos from authenticated;

create or replace function private.validar_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo   public.tipo_movimiento;
  v_codigo text;
begin
  select tipo, codigo into v_tipo, v_codigo from public.motivos_caja where id = new.motivo_id;
  if v_tipo is null or v_tipo <> new.tipo then
    raise exception 'El motivo no corresponde al tipo de movimiento' using errcode = '22023';
  end if;
  if v_codigo is not null and not new.automatico then
    raise exception 'Ese motivo lo usa el sistema: elegí otro para un movimiento manual' using errcode = '22023';
  end if;
  return new;
end;
$$;
