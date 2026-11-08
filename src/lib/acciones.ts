import "server-only";
import { z } from "zod";
import { parsearNumero } from "@/lib/numero";

/** Resultado estándar que devuelven las server actions a los formularios. */
export type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string };

/**
 * Traduce un error de Postgres/Supabase a un mensaje para el usuario sin
 * filtrar detalles internos. Los mensajes de las funciones de negocio ya
 * están en castellano y pensados para mostrarse (códigos 22023 / P0001 / P0002).
 */
export function mensajeError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Ocurrió un error inesperado.";
  const code = error.code ?? "";
  if (code === "42501") return "No tenés permiso para hacer esto.";
  if (code === "23505") return "Ya existe un registro con esos datos.";
  if (code === "23503") return "No se puede borrar porque está en uso.";
  if (code === "23514") return "Algún dato no es válido. Revisá el formulario.";
  // Solo los códigos que usan las funciones de negocio para sus mensajes en castellano.
  // Los errores internos de Postgres (22P02, 22003, ...) no se muestran tal cual.
  if (code === "22023" || code === "P0002" || code === "P0001") {
    return error.message ?? "Dato inválido.";
  }
  if (code === "22001") return "Algún texto es demasiado largo.";
  if (code.startsWith("22")) return "Algún dato no es válido. Revisá el formulario.";
  console.error("Error de base de datos", code);
  return "No se pudo guardar. Probá de nuevo.";
}

export function erroresZod(error: z.ZodError): string {
  const primero = error.issues[0];
  return primero?.message ?? "Revisá los datos del formulario.";
}

// ---------- helpers de validación de formularios ----------
const vacioANull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const texto = (max: number, nombre: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ message: `Completá ${nombre}` }).min(1, `Completá ${nombre}`).max(max, `${nombre} es demasiado largo`),
  );

export const textoOpcional = (max: number) =>
  z.preprocess(
    vacioANull,
    z.string().trim().max(max, "Texto demasiado largo").nullable().optional(),
  );

export const monto = (nombre: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? parsearNumero(v) : v),
    z
      .number({ message: `${nombre} debe ser un número` })
      .positive(`${nombre} debe ser mayor a cero`)
      .max(999_999_999_999, `${nombre} es demasiado grande`),
  );

export const montoOpcional = z.preprocess(
  (v) => {
    const s = vacioANull(v);
    return typeof s === "string" ? parsearNumero(s) : s;
  },
  z.number({ message: "Monto inválido" }).min(0, "El monto no puede ser negativo").max(999_999_999_999).nullable().optional(),
);

export const enteroOpcional = (min: number, max: number) =>
  z.preprocess(vacioANull, z.coerce.number().int().min(min).max(max).nullable().optional());

export const id = z.coerce.number().int().positive();
export const idOpcional = z.preprocess(vacioANull, z.coerce.number().int().positive().nullable().optional());
export const fechaISO = z.preprocess(
  vacioANull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable().optional(),
);
export const moneda = z.enum(["ARS", "USD"]);
export const casilla = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export function datosFormulario(fd: FormData) {
  const o: Record<string, FormDataEntryValue> = {};
  fd.forEach((v, k) => {
    if (!k.startsWith("$")) o[k] = v;
  });
  return o;
}
