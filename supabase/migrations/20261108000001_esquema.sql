-- =====================================================================
-- Level Cars · Sistema de operaciones
-- Migración 0001: esquema, seguridad por filas (RLS), auditoría.
--
-- Principios:
--   * Solo los usuarios listados en public.administradores (y activos)
--     pueden leer o escribir datos. El rol anónimo no tiene acceso a nada.
--   * Las operaciones que tocan varias tablas (alta de bien, venta,
--     reservas) se hacen únicamente mediante funciones transaccionales,
--     nunca con INSERT/UPDATE directos desde el cliente.
--   * Toda modificación queda registrada en public.auditoria.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.tipo_bien        as enum ('auto', 'moto', 'celular', 'otro');
create type public.origen_bien      as enum ('compra', 'parte_pago', 'consignacion', 'intermediacion');
create type public.estado_bien      as enum ('en_stock', 'reservado', 'vendido', 'retirado');
create type public.moneda           as enum ('ARS', 'USD');
create type public.tipo_pago        as enum ('efectivo', 'transferencia', 'bien', 'financiacion', 'sena');
create type public.tipo_movimiento  as enum ('ingreso', 'egreso');
create type public.base_comision    as enum ('fijo', 'pct_precio', 'pct_ganancia');
create type public.estado_reserva   as enum ('vigente', 'concretada', 'retenida', 'devuelta_parcial', 'devuelta_total');
create type public.estado_acuerdo   as enum ('vigente', 'vendido', 'retirado');
create type public.medio_pago       as enum ('efectivo', 'banco');
create type public.sentido_comision as enum ('pagada', 'cobrada');

-- ---------------------------------------------------------------------
-- Administradores y verificación de permisos
-- ---------------------------------------------------------------------
create table public.administradores (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 1 and 80),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create or replace function private.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administradores a
    where a.user_id = (select auth.uid())
      and a.activo
  );
$$;

revoke all on function private.es_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.es_admin() to authenticated;

create or replace function private.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.exigir_admin() from public;
grant execute on function private.exigir_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Configuración y catálogos
-- ---------------------------------------------------------------------
create table public.configuracion (
  id                         smallint primary key default 1 check (id = 1),
  plazo_consignacion_dias    integer not null default 60 check (plazo_consignacion_dias between 1 and 730),
  dias_reserva               integer not null default 7  check (dias_reserva between 1 and 120),
  dias_alerta_stock          integer not null default 90 check (dias_alerta_stock between 1 and 1000),
  dias_alerta_financiacion   integer not null default 15 check (dias_alerta_financiacion between 1 and 365),
  actualizado_en             timestamptz not null default now()
);
insert into public.configuracion (id) values (1);

create table public.canales (
  id      bigint generated always as identity primary key,
  nombre  text not null unique check (char_length(nombre) between 1 and 60),
  activo  boolean not null default true
);

create table public.financieras (
  id              bigint generated always as identity primary key,
  nombre          text not null unique check (char_length(nombre) between 1 and 80),
  comision_base   public.base_comision,
  comision_valor  numeric(12,4) check (comision_valor >= 0),
  activo          boolean not null default true,
  check (comision_base <> 'pct_ganancia' or comision_base is null)
);

create table public.motivos_caja (
  id             bigint generated always as identity primary key,
  nombre         text not null check (char_length(nombre) between 1 and 60),
  tipo           public.tipo_movimiento not null,
  es_gasto_fijo  boolean not null default false,
  codigo         text unique,              -- motivos que usa el sistema internamente
  activo         boolean not null default true,
  unique (nombre, tipo)
);

-- ---------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------
create table public.personas (
  id            bigint generated always as identity primary key,
  nombre        text not null check (char_length(nombre) between 1 and 120),
  telefono      text check (char_length(telefono) <= 40),
  dni           text check (char_length(dni) <= 20),
  email         text check (char_length(email) <= 120),
  notas         text check (char_length(notas) <= 2000),
  es_cliente    boolean not null default false,
  es_dueno      boolean not null default false,
  es_vendedor   boolean not null default false,
  es_referido   boolean not null default false,
  es_agenciero  boolean not null default false,
  creado_en     timestamptz not null default now(),
  creado_por    uuid default auth.uid()
);
create index personas_nombre_idx on public.personas (lower(nombre));

-- ---------------------------------------------------------------------
-- Bienes (stock)
-- ---------------------------------------------------------------------
create table public.bienes (
  id                bigint generated always as identity primary key,
  tipo              public.tipo_bien not null,
  marca             text not null check (char_length(marca) between 1 and 60),
  modelo            text not null check (char_length(modelo) between 1 and 80),
  version           text check (char_length(version) <= 80),
  anio              integer check (anio between 1900 and 2100),
  dominio           text check (char_length(dominio) <= 40),       -- patente o IMEI
  kilometraje       integer check (kilometraje >= 0),
  color             text check (char_length(color) <= 40),
  origen            public.origen_bien not null,
  costo             numeric(14,2) not null default 0 check (costo >= 0),
  moneda            public.moneda not null default 'ARS',
  precio_publicado  numeric(14,2) check (precio_publicado >= 0),
  fecha_ingreso     date not null default current_date,
  estado            public.estado_bien not null default 'en_stock',
  dueno_id          bigint references public.personas (id),
  notas             text check (char_length(notas) <= 2000),
  creado_en         timestamptz not null default now(),
  creado_por        uuid default auth.uid(),
  actualizado_en    timestamptz not null default now(),
  -- los bienes de terceros no tienen costo para la agencia y siempre tienen dueño
  check (origen in ('compra', 'parte_pago') or (dueno_id is not null and costo = 0))
);
create index bienes_estado_idx on public.bienes (estado);
create index bienes_dueno_idx on public.bienes (dueno_id);

create table public.bien_fotos (
  id         bigint generated always as identity primary key,
  bien_id    bigint not null references public.bienes (id) on delete cascade,
  ruta       text not null unique check (char_length(ruta) <= 300),
  orden      integer not null default 0,
  creado_en  timestamptz not null default now()
);
create index bien_fotos_bien_idx on public.bien_fotos (bien_id);

-- Acuerdos con terceros: consignación e intermediación
create table public.acuerdos_terceros (
  id              bigint generated always as identity primary key,
  bien_id         bigint not null unique references public.bienes (id) on delete cascade,
  tipo            public.origen_bien not null check (tipo in ('consignacion', 'intermediacion')),
  dueno_id        bigint not null references public.personas (id),
  monto_acordado  numeric(14,2) not null check (monto_acordado >= 0),   -- lo que espera recibir el dueño
  moneda          public.moneda not null,
  comision_base   public.base_comision,      -- comisión pactada (si la venta sale por debajo, o en intermediación)
  comision_valor  numeric(12,4) check (comision_valor >= 0),
  vence_el        date,
  estado          public.estado_acuerdo not null default 'vigente',
  notas           text check (char_length(notas) <= 2000),
  creado_en       timestamptz not null default now()
);
create index acuerdos_dueno_idx on public.acuerdos_terceros (dueno_id);

-- ---------------------------------------------------------------------
-- Operaciones de venta
-- ---------------------------------------------------------------------
create table public.operaciones (
  id                    bigint generated always as identity primary key,
  bien_id               bigint not null references public.bienes (id),
  cliente_id            bigint not null references public.personas (id),
  canal_id              bigint references public.canales (id),
  vendedor_id           bigint references public.personas (id),
  fecha                 date not null default current_date,
  precio_venta          numeric(14,2) not null check (precio_venta > 0),
  moneda                public.moneda not null,
  cotizacion            numeric(14,4) check (cotizacion > 0),         -- pesos por dólar
  costo_bien            numeric(14,2) not null default 0 check (costo_bien >= 0),
  monto_tercero         numeric(14,2) not null default 0 check (monto_tercero >= 0),
  dinero_por_agencia    boolean not null default true,
  gastos_bien           numeric(14,2) not null default 0 check (gastos_bien >= 0),
  comisiones_pagadas    numeric(14,2) not null default 0 check (comisiones_pagadas >= 0),
  comisiones_cobradas   numeric(14,2) not null default 0 check (comisiones_cobradas >= 0),
  ganancia_neta         numeric(14,2) generated always as (
                          precio_venta - costo_bien - monto_tercero - gastos_bien
                          - comisiones_pagadas + comisiones_cobradas
                        ) stored,
  notas                 text check (char_length(notas) <= 2000),
  anulada               boolean not null default false,
  motivo_anulacion      text check (char_length(motivo_anulacion) <= 500),
  creado_en             timestamptz not null default now(),
  creado_por            uuid default auth.uid()
);
create unique index operaciones_bien_activa_idx on public.operaciones (bien_id) where not anulada;
create index operaciones_fecha_idx on public.operaciones (fecha);
create index operaciones_bien_idx on public.operaciones (bien_id);
create index operaciones_cliente_idx on public.operaciones (cliente_id);
create index operaciones_canal_idx on public.operaciones (canal_id);
create index operaciones_vendedor_idx on public.operaciones (vendedor_id);

create table public.operacion_pagos (
  id                bigint generated always as identity primary key,
  operacion_id      bigint not null references public.operaciones (id) on delete cascade,
  tipo              public.tipo_pago not null,
  monto             numeric(14,2) not null check (monto > 0),
  bien_recibido_id  bigint references public.bienes (id),
  financiera_id     bigint references public.financieras (id),
  reserva_id        bigint,
  cobrado           boolean not null default true,
  check (tipo <> 'bien' or bien_recibido_id is not null),
  check (tipo <> 'financiacion' or financiera_id is not null)
);
create index operacion_pagos_op_idx on public.operacion_pagos (operacion_id);
create index operacion_pagos_bien_idx on public.operacion_pagos (bien_recibido_id);
create index operacion_pagos_fin_idx on public.operacion_pagos (financiera_id);
create index operacion_pagos_res_idx on public.operacion_pagos (reserva_id);

create table public.operacion_comisiones (
  id             bigint generated always as identity primary key,
  operacion_id   bigint not null references public.operaciones (id) on delete cascade,
  sentido        public.sentido_comision not null,
  persona_id     bigint references public.personas (id),
  financiera_id  bigint references public.financieras (id),
  base           public.base_comision not null,
  valor          numeric(12,4) not null check (valor >= 0),
  monto          numeric(14,2) not null check (monto >= 0),
  descripcion    text check (char_length(descripcion) <= 200),
  check (persona_id is not null or financiera_id is not null)
);
create index operacion_comisiones_op_idx on public.operacion_comisiones (operacion_id);
create index operacion_comisiones_persona_idx on public.operacion_comisiones (persona_id);
create index operacion_comisiones_fin_idx on public.operacion_comisiones (financiera_id);

-- ---------------------------------------------------------------------
-- Reservas (señas)
-- ---------------------------------------------------------------------
create table public.reservas (
  id              bigint generated always as identity primary key,
  bien_id         bigint not null references public.bienes (id),
  cliente_id      bigint not null references public.personas (id),
  monto           numeric(14,2) not null check (monto > 0),
  moneda          public.moneda not null,
  fecha           date not null default current_date,
  vence_el        date not null,
  estado          public.estado_reserva not null default 'vigente',
  monto_devuelto  numeric(14,2) not null default 0 check (monto_devuelto >= 0),
  motivo_cierre   text check (char_length(motivo_cierre) <= 500),
  cerrada_en      timestamptz,
  operacion_id    bigint references public.operaciones (id),
  creado_en       timestamptz not null default now(),
  check (monto_devuelto <= monto),
  check (vence_el >= fecha)
);
create unique index reservas_bien_vigente_idx on public.reservas (bien_id) where estado = 'vigente';
create index reservas_bien_idx on public.reservas (bien_id);
create index reservas_cliente_idx on public.reservas (cliente_id);
create index reservas_op_idx on public.reservas (operacion_id);

alter table public.operacion_pagos
  add constraint operacion_pagos_reserva_fk foreign key (reserva_id) references public.reservas (id);

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
create table public.movimientos (
  id            bigint generated always as identity primary key,
  fecha         date not null default current_date,
  tipo          public.tipo_movimiento not null,
  motivo_id     bigint not null references public.motivos_caja (id),
  monto         numeric(14,2) not null check (monto > 0),
  moneda        public.moneda not null default 'ARS',
  medio         public.medio_pago not null default 'efectivo',
  descripcion   text check (char_length(descripcion) <= 500),
  bien_id       bigint references public.bienes (id),
  operacion_id  bigint references public.operaciones (id),
  reserva_id    bigint references public.reservas (id),
  persona_id    bigint references public.personas (id),
  pendiente     boolean not null default false,
  automatico    boolean not null default false,   -- generado por una operación o reserva
  anulado       boolean not null default false,
  creado_en     timestamptz not null default now(),
  creado_por    uuid default auth.uid()
);
create index movimientos_fecha_idx on public.movimientos (fecha);
create index movimientos_bien_idx on public.movimientos (bien_id);
create index movimientos_operacion_idx on public.movimientos (operacion_id);
create index movimientos_motivo_idx on public.movimientos (motivo_id);
create index movimientos_reserva_idx on public.movimientos (reserva_id);
create index movimientos_persona_idx on public.movimientos (persona_id);

-- Un movimiento manual no puede tener un tipo distinto al de su motivo
create or replace function private.validar_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.tipo_movimiento;
begin
  select tipo into v_tipo from public.motivos_caja where id = new.motivo_id;
  if v_tipo is null or v_tipo <> new.tipo then
    raise exception 'El motivo no corresponde al tipo de movimiento' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger movimientos_validar
  before insert or update of motivo_id, tipo on public.movimientos
  for each row execute function private.validar_movimiento();

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.auditoria (
  id            bigint generated always as identity primary key,
  tabla         text not null,
  registro_id   text,
  accion        text not null,
  antes         jsonb,
  despues       jsonb,
  usuario       uuid default auth.uid(),
  en            timestamptz not null default now()
);
create index auditoria_en_idx on public.auditoria (en desc);

create or replace function private.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auditoria (tabla, registro_id, accion, antes, despues)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'user_id'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'administradores', 'configuracion', 'canales', 'financieras', 'motivos_caja',
    'personas', 'bienes', 'bien_fotos', 'acuerdos_terceros', 'operaciones',
    'operacion_pagos', 'operacion_comisiones', 'reservas', 'movimientos'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.registrar_auditoria()',
      t || '_auditoria', t);
  end loop;
end;
$$;

-- actualizado_en automático
create or replace function private.tocar_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger bienes_actualizado before update on public.bienes
  for each row execute function private.tocar_actualizado();
create trigger configuracion_actualizado before update on public.configuracion
  for each row execute function private.tocar_actualizado();

-- =====================================================================
-- Seguridad: privilegios y RLS
-- =====================================================================

-- Sin acceso para anónimos, en ninguna tabla.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- Autenticados: se parte de cero y se otorga lo mínimo.
revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- Escritura directa permitida (siempre filtrada por RLS = solo admins)
grant insert, update, delete on public.canales, public.financieras, public.motivos_caja,
                                public.personas to authenticated;
grant update (plazo_consignacion_dias, dias_reserva, dias_alerta_stock, dias_alerta_financiacion)
  on public.configuracion to authenticated;
-- En bienes solo se editan los datos descriptivos; estado y origen cambian por funciones.
grant update (marca, modelo, version, anio, dominio, kilometraje, color, precio_publicado, notas, costo, moneda)
  on public.bienes to authenticated;
grant insert, delete on public.bien_fotos to authenticated;
grant update (monto_acordado, comision_base, comision_valor, vence_el, notas)
  on public.acuerdos_terceros to authenticated;
-- Movimientos manuales de caja
grant insert, delete on public.movimientos to authenticated;
grant update (fecha, medio, descripcion, pendiente) on public.movimientos to authenticated;
grant update (notas) on public.operaciones to authenticated;

-- RLS en todas las tablas
do $$
declare
  t text;
begin
  foreach t in array array[
    'administradores', 'configuracion', 'canales', 'financieras', 'motivos_caja',
    'personas', 'bienes', 'bien_fotos', 'acuerdos_terceros', 'operaciones',
    'operacion_pagos', 'operacion_comisiones', 'reservas', 'movimientos', 'auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- Cada usuario solo ve su propia fila de administrador (para saber si tiene acceso).
create policy administradores_ver_propio on public.administradores
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Tablas con acceso total para administradores
do $$
declare
  t text;
begin
  foreach t in array array[
    'configuracion', 'canales', 'financieras', 'motivos_caja', 'personas',
    'bien_fotos', 'acuerdos_terceros', 'operaciones',
    'operacion_pagos', 'operacion_comisiones', 'reservas'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select private.es_admin())) with check ((select private.es_admin()))',
      t || '_admin', t);
  end loop;
end;
$$;

-- Bienes: lectura total; edición solo mientras siguen en stock o reservados.
create policy bienes_ver on public.bienes
  for select to authenticated using ((select private.es_admin()));
create policy bienes_editar on public.bienes
  for update to authenticated
  using ((select private.es_admin()) and estado in ('en_stock', 'reservado'))
  with check ((select private.es_admin()) and estado in ('en_stock', 'reservado'));

-- Movimientos: los admins ven todo; solo pueden crear, editar o borrar los manuales.
create policy movimientos_ver on public.movimientos
  for select to authenticated using ((select private.es_admin()));
create policy movimientos_crear on public.movimientos
  for insert to authenticated
  with check ((select private.es_admin()) and not automatico and operacion_id is null
              and reserva_id is null and not anulado);
create policy movimientos_editar on public.movimientos
  for update to authenticated
  using ((select private.es_admin()) and not anulado)
  with check ((select private.es_admin()) and not anulado);
create policy movimientos_borrar on public.movimientos
  for delete to authenticated
  using ((select private.es_admin()) and not automatico);

-- Auditoría: solo lectura para admins (se escribe desde el disparador).
create policy auditoria_ver on public.auditoria
  for select to authenticated using ((select private.es_admin()));
