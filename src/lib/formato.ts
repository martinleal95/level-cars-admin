export type Moneda = "ARS" | "USD";

const formatos: Record<Moneda, Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
};

export function dinero(valor: number | string | null | undefined, moneda: Moneda = "ARS") {
  const n = Number(valor ?? 0);
  return formatos[moneda].format(Number.isFinite(n) ? n : 0).replace("US$", "US$ ");
}

export function fecha(valor: string | null | undefined) {
  if (!valor) return "—";
  // Las fechas "YYYY-MM-DD" se muestran sin conversión de zona horaria.
  const [a, m, d] = valor.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function mes(valor: string) {
  const [a, m] = valor.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

export const etiquetas = {
  tipoBien: { auto: "Auto", moto: "Moto", celular: "Celular", otro: "Otro" },
  origen: {
    compra: "Propio (compra)",
    parte_pago: "Propio (parte de pago)",
    consignacion: "Consignación",
    intermediacion: "Intermediación",
  },
  estado: { en_stock: "En stock", reservado: "Reservado", vendido: "Vendido", retirado: "Retirado" },
  tipoPago: {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    bien: "Bien como parte de pago",
    financiacion: "Financiación",
    sena: "Seña",
  },
  base: { fijo: "Monto fijo", pct_precio: "% del precio", pct_ganancia: "% de la ganancia" },
  reserva: {
    vigente: "Vigente",
    concretada: "Concretada",
    retenida: "Seña retenida",
    devuelta_parcial: "Devuelta en parte",
    devuelta_total: "Devuelta completa",
  },
} as const;

export function hoyISO() {
  // fecha local de Argentina
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}
