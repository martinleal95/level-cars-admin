-- En la venta se puede elegir el medio (efectivo / banco) de cada comisión y del
-- pago al dueño. Si no se indica, queda como antes: comisiones a pagar y pago al
-- dueño en efectivo, comisiones a cobrar por banco.

create or replace function pg_temp.reemplazar(p_def text, p_buscar text, p_nuevo text) returns text
language plpgsql as $$
begin
  if (length(p_def) - length(replace(p_def, p_buscar, ''))) / length(p_buscar) <> 1 then
    raise exception 'Migración 0014: no se encontró una sola vez el texto: %', left(p_buscar, 80);
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
    $t$private.motivo('pago_tercero'), v_tercero, v_moneda, 'efectivo',$t$,
    $t$private.motivo('pago_tercero'), v_tercero, v_moneda,
            coalesce(nullif(p ->> 'medio_tercero', '')::public.medio_pago, 'efectivo'),$t$);
  v_def := pg_temp.reemplazar(v_def,
    $t$private.motivo('comision_pagada'), v_monto, v_moneda, 'efectivo',$t$,
    $t$private.motivo('comision_pagada'), v_monto, v_moneda,
                coalesce(nullif(v_com ->> 'medio', '')::public.medio_pago, 'efectivo'),$t$);
  v_def := pg_temp.reemplazar(v_def,
    $t$private.motivo('comision_cobrada'), v_monto, v_moneda, 'banco',$t$,
    $t$private.motivo('comision_cobrada'), v_monto, v_moneda,
                coalesce(nullif(v_com ->> 'medio', '')::public.medio_pago, 'banco'),$t$);
  execute v_def;
end;
$mig$;
