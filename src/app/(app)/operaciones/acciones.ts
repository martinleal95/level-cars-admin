"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requerirAdmin } from "@/lib/auth";
import { type Resultado, mensajeError, erroresZod, id, texto } from "@/lib/acciones";

const num = z.coerce.number().finite();
const idNulo = z.union([z.coerce.number().int().positive(), z.null()]).optional();
const textoCorto = (max: number) => z.string().trim().max(max).optional().nullable();

const bienRecibido = z.object({
  tipo: z.enum(["auto", "moto", "celular", "otro"]),
  marca: z.string().trim().min(1, "Completá la marca del bien recibido").max(60),
  modelo: z.string().trim().min(1, "Completá el modelo del bien recibido").max(80),
  version: textoCorto(80),
  anio: z.union([z.coerce.number().int().min(1900).max(2100), z.null()]).optional(),
  dominio: textoCorto(40),
  kilometraje: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  color: textoCorto(40),
  notas: textoCorto(1500),
});

const monedaPago = z.enum(["ARS", "USD"]).optional();
const pago = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("efectivo"), monto: num.positive("Cada pago debe ser mayor a cero"), moneda: monedaPago }),
  z.object({ tipo: z.literal("transferencia"), monto: num.positive("Cada pago debe ser mayor a cero"), moneda: monedaPago }),
  z.object({
    tipo: z.literal("financiacion"), monto: num.positive("Cada pago debe ser mayor a cero"), moneda: monedaPago,
    financiera_id: z.coerce.number({ message: "Elegí la financiera" }).int().positive("Elegí la financiera"),
    cobrado: z.boolean().default(false),
  }),
  z.object({ tipo: z.literal("bien"), monto: num.positive("Indicá el valor del bien recibido"), moneda: monedaPago, bien: bienRecibido }),
]);

const comision = z
  .object({
    sentido: z.enum(["pagada", "cobrada"]),
    persona_id: idNulo,
    financiera_id: idNulo,
    base: z.enum(["fijo", "pct_precio", "pct_ganancia"]),
    valor: num.min(0, "El valor de la comisión no puede ser negativo"),
    descripcion: textoCorto(200),
  })
  .refine((c) => c.persona_id || c.financiera_id, "Cada comisión debe indicar una persona o una financiera")
  .refine((c) => c.base === "fijo" || c.valor <= 100, "Un porcentaje no puede superar 100");

const operacion = z.object({
  bien_id: z.coerce.number().int().positive("Elegí el bien que se vende"),
  cliente_id: z.coerce.number({ message: "Elegí el cliente" }).int().positive("Elegí el cliente"),
  canal_id: idNulo,
  vendedor_id: idNulo,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  precio_venta: num.positive("El precio de venta debe ser mayor a cero").max(999_999_999_999),
  moneda: z.enum(["ARS", "USD"]),
  cotizacion: z.union([num.positive("La cotización debe ser mayor a cero"), z.null()]).optional(),
  monto_tercero: z.union([num.min(0), z.null()]).optional(),
  dinero_por_agencia: z.boolean().default(true),
  notas: textoCorto(2000),
  pagos: z.array(pago).max(20),
  comisiones: z.array(comision).max(20),
});

export async function registrarOperacion(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  let crudo: unknown;
  try {
    const texto = String(fd.get("payload") ?? "");
    if (texto.length > 100_000) return { ok: false, error: "Datos demasiado grandes." };
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, error: "Datos inválidos." };
  }
  const d = operacion.safeParse(crudo);
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { data, error } = await supabase.rpc("registrar_operacion", { p: d.data });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/", "layout");
  redirect(`/operaciones/${data}?nueva=1`);
}

const anulacion = z.object({ operacion_id: id, motivo: texto(500, "el motivo") });

export async function anularOperacion(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = anulacion.safeParse({ operacion_id: fd.get("operacion_id"), motivo: fd.get("motivo") });
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { error } = await supabase.rpc("anular_operacion", { p_operacion_id: d.data.operacion_id, p_motivo: d.data.motivo });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/", "layout");
  return { ok: true, mensaje: "Operación anulada." };
}

export async function marcarFinanciacionCobrada(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const pagoId = id.safeParse(fd.get("pago_id"));
  if (!pagoId.success) return { ok: false, error: "Pago inválido." };

  const { error } = await supabase.rpc("marcar_financiacion_cobrada", { p_pago_id: pagoId.data });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/", "layout");
  return { ok: true, mensaje: "Financiación marcada como cobrada." };
}
