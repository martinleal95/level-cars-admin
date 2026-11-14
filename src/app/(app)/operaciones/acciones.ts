"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requerirAdmin } from "@/lib/auth";
import { type Resultado, mensajeError, erroresZod, id, texto, textoOpcional, enteroOpcional, montoOpcional, idOpcional, moneda as monedaZ } from "@/lib/acciones";

const num = z.coerce.number().finite();
// OJO: en las uniones va primero z.null(). z.coerce convierte null en 0, y así un
// "sin indicar" se guardaba como cero (p. ej. el monto para el dueño).
const idNulo = z.union([z.null(), z.coerce.number().int().positive()]).optional();
const textoCorto = (max: number) => z.string().trim().max(max).optional().nullable();

const bienRecibido = z.object({
  tipo: z.enum(["auto", "moto", "celular", "otro"]),
  marca: z.string().trim().min(1, "Completá la marca del bien recibido").max(60),
  modelo: z.string().trim().min(1, "Completá el modelo del bien recibido").max(80),
  version: textoCorto(80),
  anio: z.union([z.null(), z.coerce.number().int().min(1900).max(2100)]).optional(),
  dominio: textoCorto(40),
  kilometraje: z.union([z.null(), z.coerce.number().int().min(0)]).optional(),
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
  z.object({
    tipo: z.literal("bien"), monto: num.positive("Indicá el valor del bien recibido"), moneda: monedaPago,
    bien: bienRecibido.optional(),
    // Solo al corregir: el bien ya se había recibido en esta misma venta y se conserva.
    bien_existente_id: z.number().int().positive().optional(),
  }).refine((p) => !!p.bien !== !!p.bien_existente_id, "Faltan los datos del bien recibido"),
]);

const comision = z
  .object({
    sentido: z.enum(["pagada", "cobrada"]),
    persona_id: idNulo,
    financiera_id: idNulo,
    base: z.enum(["fijo", "pct_precio", "pct_ganancia"]),
    medio: z.enum(["efectivo", "banco"]).optional(),
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
  cotizacion: z.union([z.null(), num.positive("La cotización debe ser mayor a cero")]).optional(),
  monto_tercero: z.union([z.null(), num.min(0)]).optional(),
  dinero_por_agencia: z.boolean().default(true),
  medio_tercero: z.enum(["efectivo", "banco"]).optional(),
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
  if (d.data.pagos.some((p) => p.tipo === "bien" && p.bien_existente_id)) return { ok: false, error: "Datos inválidos." };

  const { data, error } = await supabase.rpc("registrar_operacion", { p: d.data });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/", "layout");
  redirect(`/operaciones/${data}?nueva=1`);
}

const correccion = z.object({
  operacion_id: id,
  motivo: texto(400, "qué estaba mal"),
  bien: z.union([
    z.null(),
    z.object({
      origen: z.literal("compra"),
      costo: num.min(0, "El costo no puede ser negativo").max(999_999_999_999),
      registrar_egreso: z.boolean().default(false),
      medio: z.enum(["efectivo", "banco"]).default("efectivo"),
    }),
    z.object({
      origen: z.enum(["consignacion", "intermediacion"]),
      dueno_id: z.coerce.number({ message: "Elegí el dueño del bien" }).int().positive("Elegí el dueño del bien"),
      monto_acordado: num.min(0, "El monto acordado no puede ser negativo").max(999_999_999_999),
    }),
  ]).optional(),
  operacion,
});

/** Corrige una venta: anula la original y registra la correcta en una sola transacción. */
export async function corregirOperacion(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  let crudo: unknown;
  try {
    const texto = String(fd.get("payload") ?? "");
    if (texto.length > 100_000) return { ok: false, error: "Datos demasiado grandes." };
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, error: "Datos inválidos." };
  }
  const d = correccion.safeParse(crudo);
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { operacion_id, motivo, bien, operacion: datos } = d.data;

  const { data, error } = await supabase.rpc("corregir_operacion", {
    p_operacion_id: operacion_id,
    p: { motivo, ...(bien ? { bien } : {}), operacion: datos },
  });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/", "layout");
  redirect(`/operaciones/${data}?corregida=1`);
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

// ---------- Altas rápidas desde la pantalla de venta ----------
type Rapido<T> = ({ ok: true } & T) | { ok: false; error: string };

const personaRapida = z.object({ nombre: texto(120, "el nombre"), telefono: textoOpcional(40), rol: z.enum(["cliente", "referido"]).default("cliente") });

/** Alta rápida de un cliente o de un referido desde la venta: nombre y contacto. */
export async function crearPersonaRapida(datos: unknown): Promise<Rapido<{ id: number; nombre: string }>> {
  const { supabase } = await requerirAdmin();
  const d = personaRapida.safeParse(datos);
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { data, error } = await supabase.from("personas")
    .insert({ nombre: d.data.nombre, telefono: d.data.telefono ?? null, es_cliente: d.data.rol === "cliente", es_referido: d.data.rol === "referido" })
    .select("id, nombre").single();
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/personas");
  return { ok: true, id: data.id, nombre: data.nombre };
}

const bienRapido = z
  .object({
    tipo: z.enum(["auto", "moto", "celular", "otro"], { message: "Elegí el tipo de bien" }),
    marca: texto(60, "la marca"),
    modelo: texto(80, "el modelo"),
    anio: enteroOpcional(1900, 2100),
    dominio: textoOpcional(40),
    origen: z.enum(["compra", "consignacion", "intermediacion"], { message: "Elegí de quién es" }),
    moneda: monedaZ,
    costo: montoOpcional,
    precio_publicado: montoOpcional,
    en_agencia: z.boolean(),
    dueno_id: idOpcional,
    dueno_nuevo: z.object({ nombre: texto(120, "el nombre del dueño"), telefono: textoOpcional(40) }).nullable().optional(),
    monto_acordado: montoOpcional,
  })
  .superRefine((d, ctx) => {
    if (d.origen !== "compra") {
      if (!d.dueno_id && !d.dueno_nuevo) ctx.addIssue({ code: "custom", message: "Elegí el dueño del bien" });
      if (d.monto_acordado == null) ctx.addIssue({ code: "custom", message: "Indicá el monto acordado con el dueño" });
    }
  });

/** Alta rápida de un bien desde la venta. Si el dueño es nuevo, se crea junto con el bien. */
export async function crearBienRapido(datos: unknown): Promise<Rapido<{ id: number; dueno: { id: number; nombre: string } | null }>> {
  const { supabase } = await requerirAdmin();
  const d = bienRapido.safeParse(datos);
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { dueno_nuevo, ...resto } = d.data;

  let dueno: { id: number; nombre: string } | null = null;
  if (resto.origen !== "compra" && !resto.dueno_id && dueno_nuevo) {
    const { data, error } = await supabase.from("personas")
      .insert({
        nombre: dueno_nuevo.nombre, telefono: dueno_nuevo.telefono ?? null,
        es_dueno: resto.origen === "consignacion", es_agenciero: resto.origen === "intermediacion",
      })
      .select("id, nombre").single();
    if (error) return { ok: false, error: mensajeError(error) };
    dueno = data;
    resto.dueno_id = data.id;
  }

  const { data: bienId, error } = await supabase.rpc("crear_bien", { p: resto });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/stock");
  revalidatePath("/personas");
  return { ok: true, id: Number(bienId), dueno };
}
