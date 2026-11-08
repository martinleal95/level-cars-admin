-- =====================================================================
-- Level Cars · Migración 0002: funciones de negocio transaccionales.
--
-- Todas son SECURITY DEFINER con search_path vacío, verifican que quien
-- llama sea administrador y validan cada dato recibido. Así las reglas
-- de negocio viven en la base de datos y no se pueden saltear desde el
-- navegador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function private.convertir(
  p_monto numeric, p_de public.moneda, p_a public.moneda, p_cotizacion numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_monto is null or p_monto = 0 or p_de = p_a then
    return coalesce(p_monto, 0);
  end if;
  if p_cotizacion is null or p_cotizacion <= 0 then
    raise exception 'Falta la cotización del dólar para convertir montos entre pesos y dólares'
      using errcode = '22023';
  end if;
  if p_de = 'USD' and p_a = 'ARS' then
    return round(p_monto * p_cotizacion, 2);
  end if;
  return round(p_monto / p_cotizacion, 2);
end;
$$;

create or replace function private.motivo(p_codigo text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.motivos_caja where codigo = p_codigo;
$$;

create or replace function private.calcular_comision(
  p_base public.base_comision, p_valor numeric, p_precio numeric, p_ganancia_bruta numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_valor is null or p_valor < 0 then
    raise exception 'Valor de comisión inválido' using errcode = '22023';
  end if;
  if p_base in ('pct_precio', 'pct_ganancia') and p_valor > 100 then
    raise exception 'Un porcentaje de comisión no puede superar 100' using errcode = '22023';
  end if;
  return round(case p_base
    when 'fijo'         then p_valor
    when 'pct_precio'   then p_precio * p_valor / 100
    when 'pct_ganancia' then greatest(p_ganancia_bruta, 0) * p_valor / 100
  end, 2);
end;
$$;

create or replace function private.texto(p jsonb, k text, maxlen int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p ->> k), '');
begin
  if v is not null and char_length(v) > maxlen then
    raise exception 'El campo % es demasiado largo', k using errcode = '22001';
  end if;
  return v;
end;
$$;

revoke all on function private.convertir(numeric, public.moneda, public.moneda, numeric) from public;
revoke all on function private.motivo(text) from public;
revoke all on function private.calcular_comision(public.base_comision, numeric, numeric, numeric) from public;
revoke all on function private.texto(jsonb, text, int) from public;

-- ---------------------------------------------------------------------
-- Alta de bien (con acuerdo si es de un tercero)
-- ---------------------------------------------------------------------
create or replace function public.crear_bien(p jsonb)
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
    origen, costo, moneda, precio_publicado, fecha_ingreso, dueno_id, notas
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
    private.texto(p, 'notas', 2000)
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

-- ---------------------------------------------------------------------
-- Retirar un bien (el dueño se lo lleva, o baja de stock)
-- ---------------------------------------------------------------------
create or replace function public.retirar_bien(p_bien_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado public.estado_bien;
begin
  perform private.exigir_admin();
  if char_length(coalesce(p_motivo, '')) > 500 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001';
  end if;

  select estado into v_estado from public.bienes where id = p_bien_id for update;
  if v_estado is null then
    raise exception 'El bien no existe' using errcode = 'P0002';
  end if;
  if v_estado <> 'en_stock' then
    raise exception 'Solo se puede retirar un bien que está en stock (sin reserva vigente)'
      using errcode = '22023';
  end if;

  update public.bienes
     set estado = 'retirado',
         notas = concat_ws(E'\n', notas, 'Retirado: ' || nullif(btrim(p_motivo), ''))
   where id = p_bien_id;
  update public.acuerdos_terceros set estado = 'retirado' where bien_id = p_bien_id and estado = 'vigente';
end;
$$;

-- ---------------------------------------------------------------------
-- Reservas (señas)
-- ---------------------------------------------------------------------
create or replace function public.crear_reserva(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bien     bigint := (p ->> 'bien_id')::bigint;
  v_cliente  bigint := (p ->> 'cliente_id')::bigint;
  v_monto    numeric := (p ->> 'monto')::numeric;
  v_moneda   public.moneda := coalesce((p ->> 'moneda')::public.moneda, 'ARS');
  v_fecha    date := coalesce(nullif(p ->> 'fecha', '')::date, current_date);
  v_vence    date;
  v_dias     integer;
  v_estado   public.estado_bien;
  v_id       bigint;
begin
  perform private.exigir_admin();

  select estado into v_estado from public.bienes where id = v_bien for update;
  if v_estado is null then
    raise exception 'El bien no existe' using errcode = 'P0002';
  end if;
  if v_estado <> 'en_stock' then
    raise exception 'El bien no está disponible para reservar' using errcode = '22023';
  end if;
  if not exists (select 1 from public.personas where id = v_cliente) then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la seña debe ser mayor a cero' using errcode = '22023';
  end if;

  select dias_reserva into v_dias from public.configuracion where id = 1;
  v_vence := coalesce(nullif(p ->> 'vence_el', '')::date, v_fecha + v_dias);

  insert into public.reservas (bien_id, cliente_id, monto, moneda, fecha, vence_el)
  values (v_bien, v_cliente, v_monto, v_moneda, v_fecha, v_vence)
  returning id into v_id;

  insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                  bien_id, reserva_id, persona_id, automatico)
  values (v_fecha, 'ingreso', private.motivo('sena'), v_monto, v_moneda,
          coalesce((p ->> 'medio')::public.medio_pago, 'efectivo'),
          'Seña de reserva', v_bien, v_id, v_cliente, true);

  update public.bienes set estado = 'reservado' where id = v_bien;
  update public.personas set es_cliente = true where id = v_cliente;
  return v_id;
end;
$$;

create or replace function public.cerrar_reserva(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         bigint := (p ->> 'reserva_id')::bigint;
  v_resultado  public.estado_reserva := (p ->> 'resultado')::public.estado_reserva;
  v_devuelto   numeric := coalesce(nullif(p ->> 'monto_devuelto', '')::numeric, 0);
  r            public.reservas%rowtype;
begin
  perform private.exigir_admin();

  select * into r from public.reservas where id = v_id for update;
  if r.id is null then
    raise exception 'La reserva no existe' using errcode = 'P0002';
  end if;
  if r.estado <> 'vigente' then
    raise exception 'La reserva ya está cerrada' using errcode = '22023';
  end if;
  if v_resultado not in ('retenida', 'devuelta_parcial', 'devuelta_total') then
    raise exception 'Resultado inválido' using errcode = '22023';
  end if;

  v_devuelto := case v_resultado
    when 'retenida' then 0
    when 'devuelta_total' then r.monto
    else v_devuelto
  end;
  if v_resultado = 'devuelta_parcial' and (v_devuelto <= 0 or v_devuelto >= r.monto) then
    raise exception 'En una devolución parcial el monto devuelto debe ser mayor a cero y menor a la seña'
      using errcode = '22023';
  end if;
  if nullif(btrim(p ->> 'motivo'), '') is null then
    raise exception 'Escribí el motivo del cierre de la reserva' using errcode = '22023';
  end if;

  update public.reservas
     set estado = v_resultado,
         monto_devuelto = v_devuelto,
         motivo_cierre = private.texto(p, 'motivo', 500),
         cerrada_en = now()
   where id = v_id;

  if v_devuelto > 0 then
    insert into public.movimientos (tipo, motivo_id, monto, moneda, medio, descripcion,
                                    bien_id, reserva_id, persona_id, automatico)
    values ('egreso', private.motivo('devolucion_sena'), v_devuelto, r.moneda,
            coalesce((p ->> 'medio')::public.medio_pago, 'efectivo'),
            'Devolución de seña', r.bien_id, r.id, r.cliente_id, true);
  end if;

  update public.bienes set estado = 'en_stock' where id = r.bien_id and estado = 'reservado';
end;
$$;

-- ---------------------------------------------------------------------
-- Registrar una operación de venta
--
-- p = {
--   bien_id, cliente_id, canal_id?, vendedor_id?, fecha?, precio_venta,
--   moneda, cotizacion?, monto_tercero?, dinero_por_agencia?, notas?,
--   pagos: [ { tipo: efectivo|transferencia|financiacion|bien, monto,
--              medio?, financiera_id?, cobrado?,
--              bien?: { tipo, marca, modelo, version?, anio?, dominio?,
--                       kilometraje?, color?, notas? } } ],
--   comisiones: [ { sentido: pagada|cobrada, persona_id?, financiera_id?,
--                   base, valor, descripcion? } ]
-- }
-- La seña de una reserva vigente del mismo cliente se suma sola como pago.
-- ---------------------------------------------------------------------
create or replace function public.registrar_operacion(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  b               public.bienes%rowtype;
  a               public.acuerdos_terceros%rowtype;
  r               public.reservas%rowtype;
  v_cliente       bigint := (p ->> 'cliente_id')::bigint;
  v_precio        numeric := (p ->> 'precio_venta')::numeric;
  v_moneda        public.moneda := (p ->> 'moneda')::public.moneda;
  v_cot           numeric := nullif(p ->> 'cotizacion', '')::numeric;
  v_fecha         date := coalesce(nullif(p ->> 'fecha', '')::date, current_date);
  v_por_agencia   boolean := coalesce((p ->> 'dinero_por_agencia')::boolean, true);
  v_costo         numeric := 0;
  v_tercero       numeric := 0;
  v_gastos        numeric := 0;
  v_sena          numeric := 0;
  v_suma_pagos    numeric := 0;
  v_bruta         numeric;
  v_com_pag       numeric := 0;
  v_com_cob       numeric := 0;
  v_monto         numeric;
  v_op            bigint;
  v_nuevo_bien    bigint;
  v_pago          jsonb;
  v_com           jsonb;
  v_tipo_pago     public.tipo_pago;
  v_cobrado       boolean;
  v_desc          text;
begin
  perform private.exigir_admin();

  -- Validaciones básicas -------------------------------------------------
  if v_precio is null or v_precio <= 0 then
    raise exception 'El precio de venta debe ser mayor a cero' using errcode = '22023';
  end if;
  if v_moneda is null then
    raise exception 'Indicá la moneda de la operación' using errcode = '22023';
  end if;
  if not exists (select 1 from public.personas where id = v_cliente) then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;
  if nullif(p ->> 'canal_id', '') is not null
     and not exists (select 1 from public.canales where id = (p ->> 'canal_id')::bigint) then
    raise exception 'El canal no existe' using errcode = 'P0002';
  end if;
  if nullif(p ->> 'vendedor_id', '') is not null
     and not exists (select 1 from public.personas where id = (p ->> 'vendedor_id')::bigint) then
    raise exception 'El vendedor no existe' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p -> 'pagos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p -> 'comisiones', '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de pagos o comisiones inválido' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p -> 'pagos', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p -> 'comisiones', '[]'::jsonb)) > 20 then
    raise exception 'Demasiados pagos o comisiones en una sola operación' using errcode = '22023';
  end if;

  -- Bien ---------------------------------------------------------------
  select * into b from public.bienes where id = (p ->> 'bien_id')::bigint for update;
  if b.id is null then
    raise exception 'El bien no existe' using errcode = 'P0002';
  end if;
  if b.estado not in ('en_stock', 'reservado') then
    raise exception 'El bien no está disponible para la venta' using errcode = '22023';
  end if;

  -- Reserva vigente ----------------------------------------------------
  if b.estado = 'reservado' then
    select * into r from public.reservas where bien_id = b.id and estado = 'vigente' for update;
    if r.id is not null and r.cliente_id <> v_cliente then
      raise exception 'El bien está reservado por otro cliente. Cerrá esa reserva primero.'
        using errcode = '22023';
    end if;
    if r.id is not null then
      v_sena := private.convertir(r.monto, r.moneda, v_moneda, v_cot);
    end if;
  end if;

  -- Costo, pago a terceros y gastos -------------------------------------
  if b.origen in ('compra', 'parte_pago') then
    v_costo := private.convertir(b.costo, b.moneda, v_moneda, v_cot);
    v_por_agencia := true;
  else
    select * into a from public.acuerdos_terceros where bien_id = b.id for update;
    v_tercero := coalesce(
      nullif(p ->> 'monto_tercero', '')::numeric,
      private.convertir(a.monto_acordado, a.moneda, v_moneda, v_cot)
    );
    if v_tercero < 0 or v_tercero > v_precio then
      raise exception 'El monto para el dueño debe estar entre cero y el precio de venta'
        using errcode = '22023';
    end if;
    if b.origen = 'consignacion' then
      v_por_agencia := true;
    end if;
  end if;

  select coalesce(sum(private.convertir(m.monto, m.moneda, v_moneda, v_cot)), 0)
    into v_gastos
    from public.movimientos m
    join public.motivos_caja mc on mc.id = m.motivo_id
   where m.bien_id = b.id
     and m.tipo = 'egreso'
     and m.operacion_id is null
     and m.reserva_id is null
     and not m.anulado
     and not mc.es_gasto_fijo
     and coalesce(mc.codigo, '') <> 'compra_vehiculo';   -- la compra ya es el costo

  v_bruta := v_precio - v_costo - v_tercero - v_gastos;

  -- Cabecera de la operación (los totales se completan al final) ---------
  insert into public.operaciones (
    bien_id, cliente_id, canal_id, vendedor_id, fecha, precio_venta, moneda, cotizacion,
    costo_bien, monto_tercero, dinero_por_agencia, gastos_bien, notas
  ) values (
    b.id, v_cliente,
    nullif(p ->> 'canal_id', '')::bigint,
    nullif(p ->> 'vendedor_id', '')::bigint,
    v_fecha, v_precio, v_moneda, v_cot,
    v_costo, v_tercero, v_por_agencia, v_gastos,
    private.texto(p, 'notas', 2000)
  ) returning id into v_op;

  v_desc := 'Venta de ' || b.marca || ' ' || b.modelo;

  -- Seña -----------------------------------------------------------------
  if r.id is not null then
    insert into public.operacion_pagos (operacion_id, tipo, monto, reserva_id)
    values (v_op, 'sena', v_sena, r.id);
    update public.reservas set estado = 'concretada', operacion_id = v_op, cerrada_en = now()
     where id = r.id;
    update public.movimientos set operacion_id = v_op
     where reserva_id = r.id and tipo = 'ingreso';
    v_suma_pagos := v_sena;
  end if;

  -- Pagos -----------------------------------------------------------------
  for v_pago in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]'::jsonb)) loop
    v_tipo_pago := (v_pago ->> 'tipo')::public.tipo_pago;
    v_monto := (v_pago ->> 'monto')::numeric;
    if v_monto is null or v_monto <= 0 then
      raise exception 'Cada pago debe tener un monto mayor a cero' using errcode = '22023';
    end if;
    if v_tipo_pago = 'sena' then
      raise exception 'La seña se toma sola de la reserva vigente' using errcode = '22023';
    end if;
    v_suma_pagos := v_suma_pagos + v_monto;

    if v_tipo_pago = 'bien' then
      if jsonb_typeof(v_pago -> 'bien') <> 'object' then
        raise exception 'Faltan los datos del bien recibido' using errcode = '22023';
      end if;
      insert into public.bienes (tipo, marca, modelo, version, anio, dominio, kilometraje, color,
                                 origen, costo, moneda, fecha_ingreso, notas)
      values (
        (v_pago -> 'bien' ->> 'tipo')::public.tipo_bien,
        private.texto(v_pago -> 'bien', 'marca', 60),
        private.texto(v_pago -> 'bien', 'modelo', 80),
        private.texto(v_pago -> 'bien', 'version', 80),
        nullif(v_pago -> 'bien' ->> 'anio', '')::integer,
        upper(private.texto(v_pago -> 'bien', 'dominio', 40)),
        nullif(v_pago -> 'bien' ->> 'kilometraje', '')::integer,
        private.texto(v_pago -> 'bien', 'color', 40),
        'parte_pago', v_monto, v_moneda, v_fecha,
        concat_ws(E'\n', private.texto(v_pago -> 'bien', 'notas', 1500),
                  'Recibido como parte de pago en la operación #' || v_op)
      ) returning id into v_nuevo_bien;
      insert into public.operacion_pagos (operacion_id, tipo, monto, bien_recibido_id)
      values (v_op, 'bien', v_monto, v_nuevo_bien);

    elsif v_tipo_pago = 'financiacion' then
      if not exists (select 1 from public.financieras where id = (v_pago ->> 'financiera_id')::bigint) then
        raise exception 'Elegí la financiera' using errcode = '22023';
      end if;
      v_cobrado := coalesce((v_pago ->> 'cobrado')::boolean, false);
      insert into public.operacion_pagos (operacion_id, tipo, monto, financiera_id, cobrado)
      values (v_op, 'financiacion', v_monto, (v_pago ->> 'financiera_id')::bigint, v_cobrado);
      if v_por_agencia then
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, pendiente, automatico)
        values (v_fecha, 'ingreso', private.motivo('cobro_venta'), v_monto, v_moneda, 'banco',
                v_desc || ' (financiación)', b.id, v_op, not v_cobrado, true);
      end if;

    else  -- efectivo / transferencia
      insert into public.operacion_pagos (operacion_id, tipo, monto)
      values (v_op, v_tipo_pago, v_monto);
      if v_por_agencia then
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, persona_id, automatico)
        values (v_fecha, 'ingreso', private.motivo('cobro_venta'), v_monto, v_moneda,
                case when v_tipo_pago = 'transferencia' then 'banco' else 'efectivo' end::public.medio_pago,
                v_desc, b.id, v_op, v_cliente, true);
      end if;
    end if;
  end loop;

  if abs(v_suma_pagos - v_precio) > 0.01 then
    raise exception 'Los pagos suman % y el precio de venta es %. Tienen que coincidir.',
      to_char(v_suma_pagos, 'FM999G999G999G990D00'), to_char(v_precio, 'FM999G999G999G990D00')
      using errcode = '22023';
  end if;

  -- Intermediación con pago directo al agenciero: solo entra la comisión
  if not v_por_agencia and v_precio - v_tercero > 0 then
    insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                    bien_id, operacion_id, persona_id, pendiente, automatico)
    values (v_fecha, 'ingreso', private.motivo('comision_intermediacion'), v_precio - v_tercero,
            v_moneda, 'efectivo', 'Comisión por intermediación: ' || b.marca || ' ' || b.modelo,
            b.id, v_op, b.dueno_id, true, true);
  end if;

  -- Pago al dueño (consignación / intermediación con dinero por la agencia)
  if v_por_agencia and v_tercero > 0 then
    insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                    bien_id, operacion_id, persona_id, pendiente, automatico)
    values (v_fecha, 'egreso', private.motivo('pago_tercero'), v_tercero, v_moneda, 'efectivo',
            'Pago al dueño: ' || b.marca || ' ' || b.modelo, b.id, v_op, b.dueno_id, true, true);
  end if;

  -- Comisiones ------------------------------------------------------------
  for v_com in select * from jsonb_array_elements(coalesce(p -> 'comisiones', '[]'::jsonb)) loop
    if nullif(v_com ->> 'persona_id', '') is null and nullif(v_com ->> 'financiera_id', '') is null then
      raise exception 'Cada comisión debe indicar una persona o una financiera' using errcode = '22023';
    end if;
    if nullif(v_com ->> 'persona_id', '') is not null
       and not exists (select 1 from public.personas where id = (v_com ->> 'persona_id')::bigint) then
      raise exception 'La persona de la comisión no existe' using errcode = 'P0002';
    end if;
    if nullif(v_com ->> 'financiera_id', '') is not null
       and not exists (select 1 from public.financieras where id = (v_com ->> 'financiera_id')::bigint) then
      raise exception 'La financiera de la comisión no existe' using errcode = 'P0002';
    end if;

    v_monto := private.calcular_comision(
      (v_com ->> 'base')::public.base_comision, (v_com ->> 'valor')::numeric, v_precio, v_bruta);

    insert into public.operacion_comisiones (operacion_id, sentido, persona_id, financiera_id,
                                             base, valor, monto, descripcion)
    values (v_op, (v_com ->> 'sentido')::public.sentido_comision,
            nullif(v_com ->> 'persona_id', '')::bigint,
            nullif(v_com ->> 'financiera_id', '')::bigint,
            (v_com ->> 'base')::public.base_comision, (v_com ->> 'valor')::numeric,
            v_monto, private.texto(v_com, 'descripcion', 200));

    if v_monto > 0 then
      if (v_com ->> 'sentido') = 'pagada' then
        v_com_pag := v_com_pag + v_monto;
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, persona_id, pendiente, automatico)
        values (v_fecha, 'egreso', private.motivo('comision_pagada'), v_monto, v_moneda, 'efectivo',
                'Comisión: ' || v_desc, b.id, v_op,
                nullif(v_com ->> 'persona_id', '')::bigint, true, true);
      else
        v_com_cob := v_com_cob + v_monto;
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, persona_id, pendiente, automatico)
        values (v_fecha, 'ingreso', private.motivo('comision_cobrada'), v_monto, v_moneda, 'banco',
                'Comisión cobrada: ' || v_desc, b.id, v_op,
                nullif(v_com ->> 'persona_id', '')::bigint, true, true);
      end if;
    end if;
  end loop;

  update public.operaciones
     set comisiones_pagadas = v_com_pag, comisiones_cobradas = v_com_cob
   where id = v_op;

  -- Estados ---------------------------------------------------------------
  update public.bienes set estado = 'vendido' where id = b.id;
  update public.acuerdos_terceros set estado = 'vendido' where bien_id = b.id and estado = 'vigente';
  update public.personas set es_cliente = true where id = v_cliente;

  return v_op;
end;
$$;

-- ---------------------------------------------------------------------
-- Anular una operación (error de carga). Deja todo como estaba.
-- ---------------------------------------------------------------------
create or replace function public.anular_operacion(p_operacion_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.operaciones%rowtype;
begin
  perform private.exigir_admin();

  if nullif(btrim(p_motivo), '') is null or char_length(p_motivo) > 500 then
    raise exception 'Escribí el motivo de la anulación (hasta 500 caracteres)' using errcode = '22023';
  end if;

  select * into o from public.operaciones where id = p_operacion_id for update;
  if o.id is null then
    raise exception 'La operación no existe' using errcode = 'P0002';
  end if;
  if o.anulada then
    raise exception 'La operación ya está anulada' using errcode = '22023';
  end if;

  -- Los bienes recibidos como parte de pago no pueden haberse vendido o reservado
  if exists (
    select 1 from public.operacion_pagos op
    join public.bienes bb on bb.id = op.bien_recibido_id
    where op.operacion_id = o.id and bb.estado <> 'en_stock'
  ) then
    raise exception 'Un bien recibido en esta operación ya se vendió o reservó. Anulá primero esa operación.'
      using errcode = '22023';
  end if;

  update public.operaciones set anulada = true, motivo_anulacion = btrim(p_motivo) where id = o.id;

  -- Movimientos automáticos de la operación (excepto la seña, que vuelve a su reserva)
  update public.movimientos set anulado = true
   where operacion_id = o.id and automatico and reserva_id is null;
  update public.movimientos set operacion_id = null
   where operacion_id = o.id and reserva_id is not null;

  -- Bienes recibidos como parte de pago: salen del stock
  update public.bienes set estado = 'retirado',
         notas = concat_ws(E'\n', notas, 'Anulada la operación #' || o.id)
   where id in (select bien_recibido_id from public.operacion_pagos
                where operacion_id = o.id and bien_recibido_id is not null);

  -- Reserva: vuelve a estar vigente
  update public.reservas set estado = 'vigente', operacion_id = null, cerrada_en = null
   where operacion_id = o.id;

  update public.bienes
     set estado = case when exists (select 1 from public.reservas
                                    where bien_id = o.bien_id and estado = 'vigente')
                       then 'reservado'::public.estado_bien else 'en_stock'::public.estado_bien end
   where id = o.bien_id;
  update public.acuerdos_terceros set estado = 'vigente' where bien_id = o.bien_id and estado = 'vendido';
end;
$$;

-- ---------------------------------------------------------------------
-- Marcar una financiación como cobrada
-- ---------------------------------------------------------------------
create or replace function public.marcar_financiacion_cobrada(p_pago_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op bigint;
begin
  perform private.exigir_admin();
  update public.operacion_pagos set cobrado = true
   where id = p_pago_id and tipo = 'financiacion' and not cobrado
   returning operacion_id into v_op;
  if v_op is null then
    raise exception 'Pago no encontrado o ya cobrado' using errcode = 'P0002';
  end if;
  update public.movimientos set pendiente = false
   where operacion_id = v_op and pendiente and automatico
     and motivo_id = private.motivo('cobro_venta');
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.crear_bien(jsonb)',
    'public.retirar_bien(bigint, text)',
    'public.crear_reserva(jsonb)',
    'public.cerrar_reserva(jsonb)',
    'public.registrar_operacion(jsonb)',
    'public.anular_operacion(bigint, text)',
    'public.marcar_financiacion_cobrada(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- Motivos de caja que usa el sistema
insert into public.motivos_caja (nombre, tipo, codigo, es_gasto_fijo) values
  ('Cobro de venta',              'ingreso', 'cobro_venta', false),
  ('Seña',                        'ingreso', 'sena', false),
  ('Comisión cobrada',            'ingreso', 'comision_cobrada', false),
  ('Comisión por intermediación', 'ingreso', 'comision_intermediacion', false),
  ('Otro ingreso',                'ingreso', null, false),
  ('Compra de vehículo',          'egreso',  'compra_vehiculo', false),
  ('Pago a dueño',                'egreso',  'pago_tercero', false),
  ('Comisión pagada',             'egreso',  'comision_pagada', false),
  ('Devolución de seña',          'egreso',  'devolucion_sena', false),
  ('Gestoría y transferencia',    'egreso',  null, false),
  ('Arreglos y mecánica',         'egreso',  null, false),
  ('Lavado y preparación',        'egreso',  null, false),
  ('Publicidad',                  'egreso',  null, false),
  ('Alquiler',                    'egreso',  null, true),
  ('Servicios',                   'egreso',  null, true),
  ('Sueldos',                     'egreso',  null, true),
  ('Otro egreso',                 'egreso',  null, false);

insert into public.canales (nombre) values
  ('Facebook'), ('Facebook Marketplace'), ('Instagram'), ('WhatsApp'),
  ('Recomendado'), ('Se acercó a la agencia'), ('Otra agencia'), ('Web propia');

-- Los motivos del sistema no se pueden borrar ni renombrar
create or replace function private.proteger_motivos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.codigo is not null then
    if tg_op = 'DELETE' or new.codigo is distinct from old.codigo
       or new.tipo <> old.tipo or new.es_gasto_fijo <> old.es_gasto_fijo then
      raise exception 'Este motivo lo usa el sistema y no se puede modificar' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and new.codigo is not null then
    raise exception 'No se puede asignar un código de sistema' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger motivos_proteger before update or delete on public.motivos_caja
  for each row execute function private.proteger_motivos();

-- Un usuario no puede crear motivos con código de sistema
alter table public.motivos_caja add constraint motivos_codigo_sistema
  check (codigo is null or codigo in ('cobro_venta', 'sena', 'comision_cobrada', 'comision_intermediacion',
                                      'compra_vehiculo', 'pago_tercero', 'comision_pagada', 'devolucion_sena'));
revoke insert on public.motivos_caja from authenticated;
grant insert (nombre, tipo, es_gasto_fijo, activo) on public.motivos_caja to authenticated;
revoke update on public.motivos_caja from authenticated;
grant update (nombre, activo) on public.motivos_caja to authenticated;
