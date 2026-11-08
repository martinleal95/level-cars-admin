-- Endurecimiento tras la auditoría externa.

-- 1) Los movimientos automáticos (generados por ventas, señas, compras) no se
--    editan a mano. Desde la app solo se permite marcar como pagada una
--    comisión u otro pendiente; las financiaciones se cobran con
--    marcar_financiacion_cobrada (que corre como dueño, no como authenticated).
create or replace function private.proteger_movimientos_automaticos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_codigo text;
begin
  if not old.automatico or current_user <> 'authenticated' then
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

create trigger movimientos_proteger_automaticos
  before update on public.movimientos
  for each row execute function private.proteger_movimientos_automaticos();

-- 2) Defensa en profundidad: las funciones de trigger no se pueden ejecutar directamente.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;
