"use client";

import type { ChangeEvent, InputHTMLAttributes } from "react";
import { formatearImporte, formatearPatente, numeroATexto } from "@/lib/numero";

/** Aplica el formato al campo y deja el cursor donde estaba (contando solo los caracteres que importan). */
function reformatear(el: HTMLInputElement, formato: (v: string) => string, cuenta: RegExp) {
  const todos = new RegExp(cuenta.source, "g");
  const antes = (el.value.slice(0, el.selectionStart ?? el.value.length).match(todos) ?? []).length;
  const nuevo = formato(el.value);
  if (nuevo === el.value) return;
  el.value = nuevo;
  let pos = 0;
  for (let vistos = 0; pos < nuevo.length && vistos < antes; pos++) if (cuenta.test(nuevo[pos])) vistos++;
  try { el.setSelectionRange(pos, pos); } catch { /* algunos navegadores no lo permiten en ciertos tipos */ }
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "type">;

/**
 * Campo de importe: pone los puntos de miles mientras se escribe
 * ("1000000" se ve "1.000.000"), para no tener que contar ceros.
 * `inicial` es un número guardado; `value` es el texto ya formateado.
 */
export function EntradaImporte({ inicial, decimales = 2, onChange, ...props }: Props & { inicial?: number | string | null; decimales?: number }) {
  const alCambiar = (e: ChangeEvent<HTMLInputElement>) => {
    const borrando = String((e.nativeEvent as InputEvent).inputType ?? "").startsWith("delete");
    reformatear(e.currentTarget, (v) => formatearImporte(v, decimales, borrando), /[\d,]/);
    onChange?.(e);
  };
  return (
    <input type="text" inputMode="decimal" autoComplete="off" {...props}
      {...(props.value === undefined ? { defaultValue: numeroATexto(inicial) } : {})} onChange={alCambiar} />
  );
}

/** Campo de patente (o IMEI): mayúsculas y guiones entre letras y números. */
export function EntradaPatente({ inicial, onChange, ...props }: Props & { inicial?: string | null }) {
  const alCambiar = (e: ChangeEvent<HTMLInputElement>) => {
    reformatear(e.currentTarget, formatearPatente, /[A-Z0-9]/i);
    onChange?.(e);
  };
  return (
    <input type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} {...props}
      {...(props.value === undefined ? { defaultValue: formatearPatente(inicial ?? "") } : {})} onChange={alCambiar} />
  );
}
