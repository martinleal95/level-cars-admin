-- =====================================================================
-- Level Cars · Migración 0009: segunda revisión externa.
--  * Tolerancia de redondeo proporcional a las conversiones (no 0,99).
--  * El pago de seña guarda su moneda y monto originales.
--  * Costo 0 en un bien propio anula su movimiento de compra.
--  * La protección de movimientos automáticos aplica a todo rol que no sea
--    dueño o de servicio (no solo a "authenticated").
-- =====================================================================

update public.operacion_pagos p
   set moneda_pago = r.moneda, monto_pago = r.monto
  from public.reservas r
 where p.tipo = 'sena' and p.reserva_id = r.id and p.moneda_pago is null;

create or replace function private.sincronizar_bien()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.moneda is distinct from old.moneda and old.origen in ('consignacion', 'intermediacion') then
    raise exception 'La moneda de un bien de terceros la define el acuerdo con el dueño'
      using errcode = '22023';
  end if;
  if (new.costo is distinct from old.costo or new.moneda is distinct from old.moneda)
     and old.origen = 'compra' then
    if coalesce(new.costo, 0) > 0 then
      update public.movimientos
         set monto = new.costo, moneda = new.moneda
       where bien_id = new.id and automatico and not anulado and operacion_id is null
         and motivo_id = private.motivo('compra_vehiculo');
    else
      update public.movimientos
         set anulado = true
       where bien_id = new.id and automatico and not anulado and operacion_id is null
         and motivo_id = private.motivo('compra_vehiculo');
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.proteger_movimientos_automaticos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_codigo text;
begin
  -- Las funciones del sistema corren como dueño; service_role es de confianza.
  if not old.automatico or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  select codigo into v_codigo from public.motivos_caja where id = old.motivo_id;
  if new.fecha is distinct from old.fecha
     or new.medio is distinct from old.medio
     or new.descripcion is distinct from old.descripcion
     or not (old.pendiente and not new.pendiente)
     or (v_codigo = 'cobro_venta' and old.operacion_id is not null) then
    raise exception 'Este movimiento lo generó el sistema y no se puede modificar a mano.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.registrar_operacion(p jsonb)
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
  v_moneda_pago   public.moneda;
  v_monto_pago    numeric;
  v_conversiones  integer := 0;
  v_pago_id       bigint;
  v_com_inter     numeric;
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
    insert into public.operacion_pagos (operacion_id, tipo, monto, moneda_pago, monto_pago, reserva_id)
    values (v_op, 'sena', v_sena, r.moneda, r.monto, r.id);
    update public.reservas set estado = 'concretada', operacion_id = v_op, cerrada_en = now()
     where id = r.id;
    update public.movimientos set operacion_id = v_op
     where reserva_id = r.id and tipo = 'ingreso';
    v_suma_pagos := v_sena;
  end if;

  -- Pagos -----------------------------------------------------------------
  for v_pago in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]'::jsonb)) loop
    v_tipo_pago := (v_pago ->> 'tipo')::public.tipo_pago;
    -- Cada pago puede venir en su propia moneda (p. ej. auto en dólares pagado
    -- en parte con pesos). Se guarda el monto original y su equivalente.
    v_moneda_pago := coalesce(nullif(v_pago ->> 'moneda', '')::public.moneda, v_moneda);
    v_monto_pago := (v_pago ->> 'monto')::numeric;
    if v_monto_pago is null or v_monto_pago <= 0 then
      raise exception 'Cada pago debe tener un monto mayor a cero' using errcode = '22023';
    end if;
    if v_tipo_pago = 'sena' then
      raise exception 'La seña se toma sola de la reserva vigente' using errcode = '22023';
    end if;
    if v_tipo_pago = 'bien' and not v_por_agencia then
      raise exception 'Con el dinero directo al agenciero no se pueden recibir bienes como parte de pago. Elegí que el dinero pase por la agencia.'
        using errcode = '22023';
    end if;
    v_monto := private.convertir(v_monto_pago, v_moneda_pago, v_moneda, v_cot);
    if v_moneda_pago <> v_moneda then v_conversiones := v_conversiones + 1; end if;
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
        'parte_pago', v_monto_pago, v_moneda_pago, v_fecha,
        concat_ws(E'\n', private.texto(v_pago -> 'bien', 'notas', 1500),
                  'Recibido como parte de pago en la operación #' || v_op)
      ) returning id into v_nuevo_bien;
      insert into public.operacion_pagos (operacion_id, tipo, monto, moneda_pago, monto_pago, bien_recibido_id)
      values (v_op, 'bien', v_monto, v_moneda_pago, v_monto_pago, v_nuevo_bien);

    elsif v_tipo_pago = 'financiacion' then
      if not exists (select 1 from public.financieras where id = (v_pago ->> 'financiera_id')::bigint) then
        raise exception 'Elegí la financiera' using errcode = '22023';
      end if;
      v_cobrado := coalesce((v_pago ->> 'cobrado')::boolean, false);
      insert into public.operacion_pagos (operacion_id, tipo, monto, moneda_pago, monto_pago, financiera_id, cobrado)
      values (v_op, 'financiacion', v_monto, v_moneda_pago, v_monto_pago, (v_pago ->> 'financiera_id')::bigint, v_cobrado)
      returning id into v_pago_id;
      if v_por_agencia then
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, pago_id, pendiente, automatico)
        values (v_fecha, 'ingreso', private.motivo('cobro_venta'), v_monto_pago, v_moneda_pago, 'banco',
                v_desc || ' (financiación)', b.id, v_op, v_pago_id, not v_cobrado, true);
      end if;

    else  -- efectivo / transferencia
      insert into public.operacion_pagos (operacion_id, tipo, monto, moneda_pago, monto_pago)
      values (v_op, v_tipo_pago, v_monto, v_moneda_pago, v_monto_pago)
      returning id into v_pago_id;
      if v_por_agencia then
        insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                        bien_id, operacion_id, pago_id, persona_id, automatico)
        values (v_fecha, 'ingreso', private.motivo('cobro_venta'), v_monto_pago, v_moneda_pago,
                case when v_tipo_pago = 'transferencia' then 'banco' else 'efectivo' end::public.medio_pago,
                v_desc, b.id, v_op, v_pago_id, v_cliente, true);
      end if;
    end if;
  end loop;

  -- Cada conversión de moneda puede redondear medio centavo: se tolera solo eso.
  if abs(v_suma_pagos - v_precio) > 0.01 * (v_conversiones + 1) then
    raise exception 'Los pagos suman % y el precio de venta es %. Tienen que coincidir.',
      to_char(v_suma_pagos, 'FM999G999G999G990D00'), to_char(v_precio, 'FM999G999G999G990D00')
      using errcode = '22023';
  end if;

  -- Intermediación con pago directo al agenciero: el comprador le paga a él.
  -- La agencia solo tiene la seña (si hubo): se descuenta de su comisión, o
  -- si la seña supera la comisión, queda pendiente devolverle la diferencia.
  if not v_por_agencia then
    v_com_inter := v_precio - v_tercero - v_sena;
    if v_com_inter > 0.01 then
      insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                      bien_id, operacion_id, persona_id, pendiente, automatico)
      values (v_fecha, 'ingreso', private.motivo('comision_intermediacion'), v_com_inter,
              v_moneda, 'efectivo', 'Comisión por intermediación: ' || b.marca || ' ' || b.modelo,
              b.id, v_op, b.dueno_id, true, true);
    elsif v_com_inter < -0.01 then
      insert into public.movimientos (fecha, tipo, motivo_id, monto, moneda, medio, descripcion,
                                      bien_id, operacion_id, persona_id, pendiente, automatico)
      values (v_fecha, 'egreso', private.motivo('pago_tercero'), -v_com_inter, v_moneda, 'efectivo',
              'Saldo de seña para el agenciero: ' || b.marca || ' ' || b.modelo,
              b.id, v_op, b.dueno_id, true, true);
    end if;
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

