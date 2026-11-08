/**
 * Interpreta números escritos a la argentina o con punto decimal:
 *   "1.500.000"  -> 1500000     "1.500.000,50" -> 1500000.5
 *   "2,5"        -> 2.5         "2.5"          -> 2.5
 *   "1.500"      -> 1500        (grupo de miles)
 *   "0.500"      -> 0.5         (un cero adelante nunca es grupo de miles)
 * Devuelve NaN si no es un número.
 */
export function parsearNumero(entrada: string | number | null | undefined): number {
  if (typeof entrada === "number") return entrada;
  if (entrada == null) return NaN;
  let s = String(entrada).trim().replace(/\s|\$|US/g, "");
  if (s === "") return NaN;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
