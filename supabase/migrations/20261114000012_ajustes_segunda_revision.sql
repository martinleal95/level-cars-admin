-- Ajustes de la segunda revisión externa.
--  * Un bien retirado (al anular una venta) no se puede volver a asociar como "ya recibido".
--  * Al corregir, un pago que ya estaba hecho conserva también su fecha real.

create or replace function pg_temp.reemplazar(p_def text, p_buscar text, p_nuevo text) returns text
language plpgsql as $$
begin
  if (length(p_def) - length(replace(p_def, p_buscar, ''))) / length(p_buscar) <> 1 then
    raise exception 'Migración 0012: no se encontró una sola vez el texto: %', left(p_buscar, 80);
  end if;
  return replace(p_def, p_buscar, p_nuevo);
end;
$$;

do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('private.registrar_operacion(jsonb)'::regprocedure);
  v_def := pg_temp.reemplazar(v_def,
    $t$        if bx.costo <> v_monto_pago or bx.moneda <> v_moneda_pago then$t$,
    $t$        if bx.estado = 'retirado' then
          raise exception 'El % % ya salió del stock: no se puede volver a tomar como parte de pago',
            bx.marca, bx.modelo using errcode = '22023';
        end if;
        if bx.costo <> v_monto_pago or bx.moneda <> v_moneda_pago then$t$);
  execute v_def;

  v_def := pg_get_functiondef('private.corregir_operacion(bigint, jsonb)'::regprocedure);
  v_def := pg_temp.reemplazar(v_def, 'select v.id, v.medio into v_viejo', 'select v.id, v.medio, v.fecha into v_viejo');
  v_def := pg_temp.reemplazar(v_def,
    'update public.movimientos set pendiente = false, medio = v_viejo.medio where id = m.id;',
    'update public.movimientos set pendiente = false, medio = v_viejo.medio, fecha = v_viejo.fecha where id = m.id;');
  execute v_def;
end;
$mig$;
