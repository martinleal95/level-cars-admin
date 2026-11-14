-- =====================================================================
-- Level Cars · Migración 0010: corregir lo que se cargó mal.
--  * Corregir una operación: se anula y se vuelve a registrar con los datos
--    correctos en una sola transacción (queda el rastro de ambas).
--  * Cambiar el origen de un bien (propio / consignación / intermediación).
--  * Borrar un bien cargado por error (si no tiene historia).
--  * Editar todos los datos de un movimiento manual de caja.
-- =====================================================================

-- Rastro: la operación anulada apunta a la que la reemplazó.
alter table public.operaciones
  add column corregida_por bigint references public.operaciones (id);
create index operaciones_corregida_idx on public.operaciones (corregida_por);

-- ---------------------------------------------------------------------
-- Cambiar el origen de un bien que está en stock
-- p = { bien_id, origen, costo?, registrar_egreso?, medio?,
--       dueno_id?, monto_acordado?, comision_base?, comision_valor?, vence_el? }
-- ---------------------------------------------------------------------
create or replace function private.cambiar_origen_bien(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b         public.bienes%rowtype;
  v_origen  public.origen_bien := (p ->> 'origen')::public.origen_bien;
  v_dueno   bigint := nullif(p ->> 'dueno_id', '')::bigint;
  v_monto   numeric := nullif(p ->> 'monto_acordado', '')::numeric;
  v_costo   numeric := coalesce(nullif(p ->> 'costo', '')::numeric, 0);
  v_plazo   integer;
begin
  perform private.exigir_admin();

  select * into b from public.bienes where id = (p ->> 'bien_id')::bigint for update;
  if b.id is null then
    raise exception 'El bien no existe' using errcode = 'P0002';
  end if;
  if b.estado not in ('en_stock', 'reservado') then
    raise exception 'Solo se puede cambiar el origen de un bien que está en stock' using errcode = '22023';
  end if;
  if b.origen = 'parte_pago' or v_origen = 'parte_pago' then
    raise exception 'Un bien recibido como parte de pago se corrige desde su operación' using errcode = '22023';
  end if;
  if v_origen is null then
    raise exception 'Elegí el origen del bien' using errcode = '22023';
  end if;
  if v_costo < 0 then
    raise exception 'El costo no puede ser negativo' using errcode = '22023';
  end if;

  if v_origen in ('consignacion', 'intermediacion') then
    if v_dueno is null or not exists (select 1 from public.personas where id = v_dueno) then
      raise exception 'Indicá el dueño del bien' using errcode = '22023';
    end if;
    if v_monto is null or v_monto < 0 then
      raise exception 'Indicá el monto acordado con el dueño' using errcode = '22023';
    end if;
  end if;

  -- Deja de ser propio: el movimiento de compra ya no corresponde.
  if b.origen = 'compra' and v_origen <> 'compra' then
    update public.movimientos set anulado = true
     where bien_id = b.id and automatico and not anulado and operacion_id is null
       and motivo_id = private.motivo('compra_vehiculo');
  end if;

  update public.bienes
     set origen = v_origen,
         costo = case when v_origen = 'compra' then v_costo else 0 end,
         dueno_id = case when v_origen = 'compra' then null else v_dueno end
   where id = b.id;

  if v_origen = 'compra' then
    delete from public.acuerdos_terceros where bien_id = b.id;
    if b.origen <> 'compra' and v_costo > 0 and coalesce((p ->> 'registrar_egreso')::boolean, false) then
      insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion, bien_id, automatico)
      values (b.fecha_ingreso, 'egreso', private.motivo('compra_vehiculo'), v_costo, b.moneda,
              coalesce((p ->> 'medio')::public.medio_pago, 'efectivo'),
              'Compra de ' || b.marca || ' ' || b.modelo, b.id, true);
    end if;
  else
    select plazo_consignacion_dias into v_plazo from public.configuracion where id = 1;
    insert into public.acuerdos_terceros (bien_id, tipo, dueno_id, monto_acordado, moneda,
                                          comision_base, comision_valor, vence_el)
    values (b.id, v_origen, v_dueno, v_monto, b.moneda,
            nullif(p ->> 'comision_base', '')::public.base_comision,
            nullif(p ->> 'comision_valor', '')::numeric,
            coalesce(nullif(p ->> 'vence_el', '')::date,
                     case when v_origen = 'consignacion' then b.fecha_ingreso + v_plazo end))
    on conflict (bien_id) do update
       set tipo = excluded.tipo, dueno_id = excluded.dueno_id, monto_acordado = excluded.monto_acordado,
           moneda = excluded.moneda, comision_base = excluded.comision_base,
           comision_valor = excluded.comision_valor, vence_el = excluded.vence_el, estado = 'vigente';
    update public.personas
       set es_dueno = es_dueno or v_origen = 'consignacion',
           es_agenciero = es_agenciero or v_origen = 'intermediacion'
     where id = v_dueno;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Corregir una operación: anular + (corregir el bien) + registrar de nuevo
-- p = { motivo, bien?: {...como cambiar_origen_bien}, operacion: {...como registrar_operacion} }
-- ---------------------------------------------------------------------
create or replace function private.corregir_operacion(p_operacion_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       public.operaciones%rowtype;
  v_nueva bigint;
  v_motivo text := nullif(btrim(p ->> 'motivo'), '');
begin
  perform private.exigir_admin();

  select * into o from public.operaciones where id = p_operacion_id for update;
  if o.id is null then
    raise exception 'La operación no existe' using errcode = 'P0002';
  end if;
  if o.anulada then
    raise exception 'La operación ya está anulada: no se puede corregir' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'operacion') <> 'object' then
    raise exception 'Faltan los datos corregidos de la operación' using errcode = '22023';
  end if;
  if char_length(coalesce(v_motivo, '')) > 400 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001';
  end if;

  perform private.anular_operacion(o.id, 'Corrección: ' || coalesce(v_motivo, 'datos mal cargados'));

  if jsonb_typeof(p -> 'bien') = 'object' then
    perform private.cambiar_origen_bien((p -> 'bien') || jsonb_build_object('bien_id', o.bien_id));
  end if;

  v_nueva := private.registrar_operacion((p -> 'operacion') || jsonb_build_object('bien_id', o.bien_id));

  update public.operaciones set corregida_por = v_nueva where id = o.id;
  return v_nueva;
end;
$$;

-- ---------------------------------------------------------------------
-- Borrar un bien cargado por error (sin ventas, reservas ni gastos).
-- Devuelve las rutas de sus fotos para borrarlas del almacenamiento.
-- ---------------------------------------------------------------------
create or replace function private.borrar_bien(p_bien_id bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  b       public.bienes%rowtype;
  v_fotos text[];
begin
  perform private.exigir_admin();

  select * into b from public.bienes where id = p_bien_id for update;
  if b.id is null then
    raise exception 'El bien no existe' using errcode = 'P0002';
  end if;
  if b.origen = 'parte_pago' then
    raise exception 'Un bien recibido como parte de pago se corrige desde su operación' using errcode = '22023';
  end if;
  if b.estado <> 'en_stock' then
    raise exception 'Solo se puede borrar un bien que está en stock, sin reserva' using errcode = '22023';
  end if;
  if exists (select 1 from public.operaciones where bien_id = b.id) then
    raise exception 'El bien tiene ventas registradas (aunque estén anuladas): retiralo en lugar de borrarlo'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.reservas where bien_id = b.id) then
    raise exception 'El bien tuvo reservas: retiralo en lugar de borrarlo' using errcode = '22023';
  end if;
  if exists (select 1 from public.movimientos where bien_id = b.id and not automatico and not anulado) then
    raise exception 'El bien tiene gastos cargados: borralos primero desde Caja' using errcode = '22023';
  end if;

  select coalesce(array_agg(ruta), '{}') into v_fotos from public.bien_fotos where bien_id = b.id;
  delete from public.movimientos where bien_id = b.id and (automatico or anulado);
  delete from public.bien_fotos where bien_id = b.id;
  delete from public.bienes where id = b.id;   -- el acuerdo se borra en cascada
  return v_fotos;
end;
$$;

-- API pública (SECURITY INVOKER) y permisos
create function public.cambiar_origen_bien(p jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.cambiar_origen_bien(p) $$;

create function public.corregir_operacion(p_operacion_id bigint, p jsonb) returns bigint
language sql security invoker set search_path = ''
as $$ select private.corregir_operacion(p_operacion_id, p) $$;

create function public.borrar_bien(p_bien_id bigint) returns text[]
language sql security invoker set search_path = ''
as $$ select private.borrar_bien(p_bien_id) $$;

do $$
declare
  f text;
begin
  foreach f in array array['cambiar_origen_bien(jsonb)', 'corregir_operacion(bigint, jsonb)', 'borrar_bien(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Movimientos manuales: se pueden editar todos sus datos.
-- Los automáticos siguen protegidos por el disparador.
-- ---------------------------------------------------------------------
grant update (monto, moneda, motivo_id, persona_id, bien_id) on public.movimientos to authenticated;

create or replace function private.proteger_movimientos_automaticos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_codigo text;
begin
  if not old.automatico or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  select codigo into v_codigo from public.motivos_caja where id = old.motivo_id;
  if new.fecha is distinct from old.fecha
     or new.medio is distinct from old.medio
     or new.descripcion is distinct from old.descripcion
     or new.monto is distinct from old.monto
     or new.moneda is distinct from old.moneda
     or new.motivo_id is distinct from old.motivo_id
     or new.persona_id is distinct from old.persona_id
     or new.bien_id is distinct from old.bien_id
     or not (old.pendiente and not new.pendiente)
     or (v_codigo = 'cobro_venta' and old.operacion_id is not null) then
    raise exception 'Este movimiento lo generó el sistema y no se puede modificar a mano.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Bienes fuera de la agencia (se ofrecen por redes u otros canales y no
-- están físicamente en el local). Se venden igual que el resto.
-- ---------------------------------------------------------------------
alter table public.bienes add column en_agencia boolean not null default true;
grant update (en_agencia) on public.bienes to authenticated;

create or replace function private.crear_bien(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origen   public.origen_bien := (p ->> 'origen')::public.origen_bien;
  v_moneda   public.moneda := coalesce((p ->> 'moneda')::public.moneda, 'ARS');
  v_dueno    bigint := nullif(p ->> 'dueno_id', '')::bigint;
  v_id       bigint;
  v_plazo    integer;
  v_fecha    date := coalesce(nullif(p ->> 'fecha_ingreso', '')::date, current_date);
begin
  perform private.exigir_admin();

  if v_origen = 'parte_pago' then
    raise exception 'Los bienes recibidos como parte de pago se crean al registrar la operación'
      using errcode = '22023';
  end if;

  if v_origen in ('consignacion', 'intermediacion') then
    if v_dueno is null or not exists (select 1 from public.personas where id = v_dueno) then
      raise exception 'Indicá el dueño del bien' using errcode = '22023';
    end if;
    if nullif(p ->> 'monto_acordado', '') is null then
      raise exception 'Indicá el monto acordado con el dueño' using errcode = '22023';
    end if;
  end if;

  insert into public.bienes (
    tipo, marca, modelo, version, anio, dominio, kilometraje, color,
    origen, costo, moneda, precio_publicado, fecha_ingreso, dueno_id, notas, en_agencia
  ) values (
    (p ->> 'tipo')::public.tipo_bien,
    private.texto(p, 'marca', 60),
    private.texto(p, 'modelo', 80),
    private.texto(p, 'version', 80),
    nullif(p ->> 'anio', '')::integer,
    upper(private.texto(p, 'dominio', 40)),
    nullif(p ->> 'kilometraje', '')::integer,
    private.texto(p, 'color', 40),
    v_origen,
    case when v_origen = 'compra' then coalesce(nullif(p ->> 'costo', '')::numeric, 0) else 0 end,
    v_moneda,
    nullif(p ->> 'precio_publicado', '')::numeric,
    v_fecha,
    case when v_origen in ('consignacion', 'intermediacion') then v_dueno end,
    private.texto(p, 'notas', 2000),
    coalesce((p ->> 'en_agencia')::boolean, true)
  ) returning id into v_id;

  if v_origen in ('consignacion', 'intermediacion') then
    select plazo_consignacion_dias into v_plazo from public.configuracion where id = 1;
    insert into public.acuerdos_terceros (
      bien_id, tipo, dueno_id, monto_acordado, moneda, comision_base, comision_valor, vence_el, notas
    ) values (
      v_id, v_origen, v_dueno,
      (p ->> 'monto_acordado')::numeric,
      v_moneda,
      nullif(p ->> 'comision_base', '')::public.base_comision,
      nullif(p ->> 'comision_valor', '')::numeric,
      coalesce(nullif(p ->> 'vence_el', '')::date,
               case when v_origen = 'consignacion' then v_fecha + v_plazo end),
      private.texto(p, 'notas_acuerdo', 2000)
    );
  end if;

  if v_origen = 'compra' and coalesce(nullif(p ->> 'costo', '')::numeric, 0) > 0
     and coalesce((p ->> 'registrar_egreso')::boolean, false) then
    insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion, bien_id, automatico)
    values (v_fecha, 'egreso', private.motivo('compra_vehiculo'), (p ->> 'costo')::numeric, v_moneda,
            coalesce((p ->> 'medio')::public.medio_pago, 'efectivo'),
            'Compra de ' || private.texto(p, 'marca', 60) || ' ' || private.texto(p, 'modelo', 80),
            v_id, true);
  end if;

  return v_id;
end;
$$;


-- v_stock usa b.*: se recrea para incluir la nueva columna.
drop view public.v_stock;
create view public.v_stock
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
       (select f.ruta from public.bien_fotos f where f.bien_id = b.id order by f.orden, f.id limit 1) as foto,
       coalesce((select sum(m.monto) from public.movimientos m
                 join public.motivos_caja mc on mc.id = m.motivo_id
                 where m.bien_id = b.id and m.tipo = 'egreso' and m.operacion_id is null
                   and m.reserva_id is null and not m.anulado and not mc.es_gasto_fijo
                   and mc.codigo is distinct from 'compra_vehiculo'
                   and m.moneda = 'ARS'), 0) as gastos_ars,
       coalesce((select sum(m.monto) from public.movimientos m
                 join public.motivos_caja mc on mc.id = m.motivo_id
                 where m.bien_id = b.id and m.tipo = 'egreso' and m.operacion_id is null
                   and m.reserva_id is null and not m.anulado and not mc.es_gasto_fijo
                   and mc.codigo is distinct from 'compra_vehiculo'
                   and m.moneda = 'USD'), 0) as gastos_usd,
       a.moneda as acuerdo_moneda
from public.bienes b
left join public.personas d on d.id = b.dueno_id
left join public.acuerdos_terceros a on a.bien_id = b.id;
grant select on public.v_stock to authenticated;
revoke all on public.v_stock from anon;
