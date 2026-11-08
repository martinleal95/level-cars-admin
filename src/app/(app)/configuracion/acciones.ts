"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requerirAdmin } from "@/lib/auth";
import { type Resultado, mensajeError, erroresZod, texto, id, casilla, montoOpcional, datosFormulario } from "@/lib/acciones";

const dias = (min: number, max: number, nombre: string) =>
  z.coerce.number({ message: `${nombre} debe ser un número` }).int().min(min, `${nombre}: mínimo ${min}`).max(max, `${nombre}: máximo ${max}`);

const esquemaConfig = z.object({
  plazo_consignacion_dias: dias(1, 730, "Plazo de consignación"),
  dias_reserva: dias(1, 120, "Días de reserva"),
  dias_alerta_stock: dias(1, 1000, "Alerta de stock"),
  dias_alerta_financiacion: dias(1, 365, "Alerta de financiación"),
});

export async function guardarConfiguracion(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaConfig.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { error } = await supabase.from("configuracion").update(d.data).eq("id", 1);
  if (error) return { ok: false, error: mensajeError(error) };
  revalidatePath("/", "layout");
  return { ok: true, mensaje: "Configuración guardada." };
}

const TABLAS = { canales: 60, financieras: 80, motivos_caja: 60 } as const;
type Tabla = keyof typeof TABLAS;
const tabla = z.enum(["canales", "financieras", "motivos_caja"]);

export async function agregarItem(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const t = tabla.safeParse(fd.get("tabla"));
  if (!t.success) return { ok: false, error: "Lista inválida." };
  const nombre = texto(TABLAS[t.data as Tabla], "el nombre").safeParse(fd.get("nombre"));
  if (!nombre.success) return { ok: false, error: erroresZod(nombre.error) };

  let fila: Record<string, unknown> = { nombre: nombre.data };
  if (t.data === "motivos_caja") {
    const extra = z.object({ tipo: z.enum(["ingreso", "egreso"]), es_gasto_fijo: casilla }).safeParse(datosFormulario(fd));
    if (!extra.success) return { ok: false, error: erroresZod(extra.error) };
    fila = { ...fila, ...extra.data, es_gasto_fijo: extra.data.tipo === "egreso" && extra.data.es_gasto_fijo };
  }
  if (t.data === "financieras") {
    const extra = z.object({
      comision_base: z.preprocess((v) => (v === "" ? null : v), z.enum(["fijo", "pct_precio"]).nullable()),
      comision_valor: montoOpcional,
    }).safeParse(datosFormulario(fd));
    if (!extra.success) return { ok: false, error: erroresZod(extra.error) };
    fila = { ...fila, ...extra.data };
  }

  const { error } = await supabase.from(t.data).insert(fila);
  if (error) return { ok: false, error: mensajeError(error) };
  revalidatePath("/configuracion");
  return { ok: true, mensaje: "Agregado." };
}

export async function alternarItem(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const t = tabla.safeParse(fd.get("tabla"));
  const itemId = id.safeParse(fd.get("id"));
  const activo = fd.get("activo") === "true";
  if (!t.success || !itemId.success) return { ok: false, error: "Dato inválido." };

  const { error } = await supabase.from(t.data).update({ activo }).eq("id", itemId.data);
  if (error) return { ok: false, error: mensajeError(error) };
  revalidatePath("/configuracion");
  return { ok: true };
}
