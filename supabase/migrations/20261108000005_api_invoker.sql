-- =====================================================================
-- Level Cars · Migración 0005: la API pública solo expone funciones
-- SECURITY INVOKER. La lógica con privilegios vive en el esquema
-- privado (no expuesto) y sigue exigiendo que quien llama sea admin.
-- =====================================================================

alter function public.crear_bien(jsonb)                   set schema private;
alter function public.retirar_bien(bigint, text)          set schema private;
alter function public.crear_reserva(jsonb)                set schema private;
alter function public.cerrar_reserva(jsonb)               set schema private;
alter function public.registrar_operacion(jsonb)          set schema private;
alter function public.anular_operacion(bigint, text)      set schema private;
alter function public.marcar_financiacion_cobrada(bigint) set schema private;

create function public.crear_bien(p jsonb) returns bigint
language sql security invoker set search_path = ''
as $$ select private.crear_bien(p) $$;

create function public.retirar_bien(p_bien_id bigint, p_motivo text) returns void
language sql security invoker set search_path = ''
as $$ select private.retirar_bien(p_bien_id, p_motivo) $$;

create function public.crear_reserva(p jsonb) returns bigint
language sql security invoker set search_path = ''
as $$ select private.crear_reserva(p) $$;

create function public.cerrar_reserva(p jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.cerrar_reserva(p) $$;

create function public.registrar_operacion(p jsonb) returns bigint
language sql security invoker set search_path = ''
as $$ select private.registrar_operacion(p) $$;

create function public.anular_operacion(p_operacion_id bigint, p_motivo text) returns void
language sql security invoker set search_path = ''
as $$ select private.anular_operacion(p_operacion_id, p_motivo) $$;

create function public.marcar_financiacion_cobrada(p_pago_id bigint) returns void
language sql security invoker set search_path = ''
as $$ select private.marcar_financiacion_cobrada(p_pago_id) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'crear_bien(jsonb)', 'retirar_bien(bigint, text)', 'crear_reserva(jsonb)',
    'cerrar_reserva(jsonb)', 'registrar_operacion(jsonb)', 'anular_operacion(bigint, text)',
    'marcar_financiacion_cobrada(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end;
$$;
