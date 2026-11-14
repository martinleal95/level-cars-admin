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
  s = s.replace(/,$/, "");
  if (s === "") return NaN;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Da formato a un importe mientras se escribe: puntos cada tres cifras y
 * coma para los decimales ("1000000" -> "1.000.000", "1250,5" -> "1.250,5").
 * Solo deja dígitos y una coma, así el resultado siempre se puede leer.
 */
export function formatearImporte(texto: string, decimales = 2, borrando = false): string {
  // Un punto escrito (o pegado) con 0 a 2 cifras detrás es un decimal ("2.5", "1250.50"):
  // se pasa a coma en vez de descartarlo, que multiplicaría el importe por 10 o 100.
  // Al borrar no se aplica: de "1.234" se quita el 4 y queda "1.23" = 123, no 1,23.
  if (!borrando && /^\d+\.\d{0,2}$/.test(texto)) texto = texto.replace(".", ",");
  const limpio = texto.replace(/[^\d,]/g, "");
  const coma = limpio.indexOf(",");
  const entero = (coma === -1 ? limpio : limpio.slice(0, coma))
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (coma === -1) return entero;
  return `${entero || "0"},${limpio.slice(coma + 1).replace(/,/g, "").slice(0, decimales)}`;
}

/** Un número guardado, escrito como lo escribe el usuario ("17.000.000", "1.250,5"). */
export function numeroATexto(valor: number | string | null | undefined): string {
  if (valor == null || valor === "") return "";
  const x = Number(valor);
  if (!Number.isFinite(x)) return "";
  // Se arma a mano (no con toLocaleString) para no depender de los datos de idioma del servidor.
  const [entero, dec = ""] = Math.abs(x).toFixed(4).replace(/0+$/, "").split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${x < 0 ? "-" : ""}${miles}${dec ? "," + dec : ""}`;
}

/**
 * Patente con guiones entre letras y números, en mayúsculas:
 * "abc123" -> "ABC-123" (vieja), "ab123cd" -> "AB-123-CD" (nueva),
 * "a123bcd" -> "A-123-BCD" (moto). Un IMEI (solo números) queda igual.
 */
export function formatearPatente(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/([A-Z])(?=\d)|(\d)(?=[A-Z])/g, "$1$2-")
    .slice(0, 40);
}
