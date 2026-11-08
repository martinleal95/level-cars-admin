-- =====================================================================
-- Level Cars · Migración 0008: correcciones de la revisión externa.
--  * Cada pago de una venta puede tener su propia moneda.
--  * Cada financiación se marca cobrada por separado.
--  * Intermediación con pago directo: la seña se descuenta de la comisión.
--  * Bloqueos en orden fijo (anular / cerrar reserva) para evitar carreras.
--  * Fechas y meses en hora de Argentina.
--  * Editar el costo de un bien propio actualiza su movimiento de compra.
-- =====================================================================

-- Fechas en hora de Argentina (current_date, agrupación por mes, etc.)
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Argentina/Buenos_Aires');
end $$;
set timezone to 'America/Argentina/Buenos_Aires';

-- Moneda original de cada pago (monto queda expresado en la moneda de la venta)
alter table public.operacion_pagos
  add column moneda_pago public.moneda,
  add column monto_pago  numeric(14,2) check (monto_pago > 0);
update public.operacion_pagos p
   set moneda_pago = o.moneda, monto_pago = p.monto
  from public.operaciones o
 where o.id = p.operacion_id and p.moneda_pago is null;

-- Vínculo de cada cobro automático con su pago
alter table public.movimientos
  add column pago_id bigint references public.operacion_pagos (id);
alter table public.movimientos
  add constraint movimientos_pago_solo_automatico check (pago_id is null or automatico);
create index movimientos_pago_idx on public.movimientos (pago_id);
update public.movimientos m
   set pago_id = p.id
  from public.operacion_pagos p
 where p.operacion_id = m.operacion_id and m.automatico and m.pago_id is null
   and m.motivo_id = private.motivo('cobro_venta')
   and p.tipo in ('efectivo', 'transferencia', 'financiacion')
   and m.monto = p.monto
   and (select count(*) from public.operacion_pagos p2
         where p2.operacion_id = p.operacion_id and p2.tipo = p.tipo and p2.monto = p.monto) = 1;

-- Bienes: la moneda de uno de terceros no cambia (la manda el acuerdo), y el
-- costo de uno propio mantiene sincronizado su movimiento de compra.
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
    update public.movimientos
       set monto = new.costo, moneda = new.moneda
     where bien_id = new.id and automatico and not anulado and operacion_id is null
       and motivo_id = private.motivo('compra_vehiculo');
  end if;
  return new;
end;
$$;
revoke execute on function private.sincronizar_bien() from public, anon, authenticated;
create trigger bienes_sincronizar
  before update on public.bienes
  for each row execute function private.sincronizar_bien();

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
  v_hubo_conv     boolean := false;
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
    v_hubo_conv := v_hubo_conv or v_moneda_pago <> v_moneda;
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

  -- Con conversión de moneda se tolera el redondeo (menos de una unidad).
  if abs(v_suma_pagos - v_precio) > (case when v_hubo_conv then 0.99 else 0.01 end) then
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

create or replace function private.anular_operacion(p_operacion_id bigint, p_motivo text)
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

  -- Bloquea el bien vendido y los recibidos (en orden fijo) antes de revisarlos,
  -- para que nadie los venda o reserve mientras se anula.
  perform 1 from public.bienes where id = o.bien_id for update;
  perform 1 from public.bienes
   where id in (select bien_recibido_id from public.operacion_pagos
                where operacion_id = o.id and bien_recibido_id is not null)
   order by id for update;

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

create or replace function private.cerrar_reserva(p jsonb)
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

  -- Mismo orden de bloqueo que registrar_operacion: primero el bien, después la reserva.
  perform 1 from public.bienes where id = (select bien_id from public.reservas where id = v_id) for update;
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

create or replace function private.marcar_financiacion_cobrada(p_pago_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op bigint;
begin
  perform private.exigir_admin();
  update public.operacion_pagos op set cobrado = true
   where op.id = p_pago_id and op.tipo = 'financiacion' and not op.cobrado
     and exists (select 1 from public.operaciones o where o.id = op.operacion_id and not o.anulada)
   returning op.operacion_id into v_op;
  if v_op is null then
    raise exception 'Pago no encontrado o ya cobrado' using errcode = 'P0002';
  end if;
  -- Solo el movimiento de ESTA financiación (puede haber varias en la operación)
  update public.movimientos set pendiente = false
   where pago_id = p_pago_id and pendiente and automatico;
end;
$$;

-- Stock: gastos por moneda y moneda del acuerdo (para el resumen de la venta)
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
