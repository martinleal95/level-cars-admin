-- Caja: el medio (efectivo / banco) de un pago o cobro pendiente se elige al
-- momento de resolverlo, porque recién ahí se sabe de dónde salió o a dónde
-- entró la plata. También se puede corregir el medio de uno ya resuelto.

-- Marca como pagado/cobrado un movimiento pendiente, indicando el medio real.
create or replace function private.resolver_movimiento(p_id bigint, p_medio public.medio_pago)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.movimientos%rowtype;
  v_codigo text;
begin
  perform private.exigir_admin();
  if p_medio is null then
    raise exception 'Elegí si fue en efectivo o por banco' using errcode = '22023';
  end if;
  select * into m from public.movimientos where id = p_id for update;
  if m.id is null then
    raise exception 'El movimiento no existe' using errcode = 'P0002';
  end if;
  if m.anulado or not m.pendiente then
    raise exception 'El movimiento ya estaba resuelto' using errcode = '22023';
  end if;
  select codigo into v_codigo from public.motivos_caja where id = m.motivo_id;
  if v_codigo = 'cobro_venta' and m.operacion_id is not null then
    raise exception 'Esta financiación se marca como cobrada desde la operación' using errcode = '22023';
  end if;
  update public.movimientos set pendiente = false, medio = p_medio where id = m.id;
end;
$$;

-- Corrige el medio de un movimiento automático ya resuelto (p. ej. una comisión
-- que se pagó por transferencia y quedó como efectivo).
create or replace function private.cambiar_medio_movimiento(p_id bigint, p_medio public.medio_pago)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.movimientos%rowtype;
  v_codigo text;
begin
  perform private.exigir_admin();
  if p_medio is null then
    raise exception 'Elegí si fue en efectivo o por banco' using errcode = '22023';
  end if;
  select * into m from public.movimientos where id = p_id for update;
  if m.id is null then
    raise exception 'El movimiento no existe' using errcode = 'P0002';
  end if;
  if m.anulado then
    raise exception 'El movimiento está anulado' using errcode = '22023';
  end if;
  select codigo into v_codigo from public.motivos_caja where id = m.motivo_id;
  if m.automatico and m.operacion_id is not null and v_codigo in ('cobro_venta') then
    raise exception 'El cobro de una venta no se cambia: corregí la operación' using errcode = '22023';
  end if;
  update public.movimientos set medio = p_medio where id = m.id;
end;
$$;

create function public.resolver_movimiento(p_id bigint, p_medio public.medio_pago) returns void
language sql security invoker set search_path = ''
as $$ select private.resolver_movimiento(p_id, p_medio) $$;

create function public.cambiar_medio_movimiento(p_id bigint, p_medio public.medio_pago) returns void
language sql security invoker set search_path = ''
as $$ select private.cambiar_medio_movimiento(p_id, p_medio) $$;

do $$
declare
  f text;
begin
  foreach f in array array['resolver_movimiento(bigint, public.medio_pago)', 'cambiar_medio_movimiento(bigint, public.medio_pago)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end;
$$;
