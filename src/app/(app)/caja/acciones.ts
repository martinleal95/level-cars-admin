"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requerirAdmin } from "@/lib/auth";
import { type Resultado, mensajeError, erroresZod, id, idOpcional, monto, moneda, fechaISO, textoOpcional, datosFormulario } from "@/lib/acciones";

const esquema = z.object({
  tipo: z.enum(["ingreso", "egreso"]),
  motivo_id: id,
  monto: monto("El monto"),
  moneda,
  medio: z.enum(["efectivo", "banco"]),
  fecha: fechaISO,
  descripcion: textoOpcional(500),
  persona_id: idOpcional,
});

export async function registrarMovimiento(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquema.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { error } = await supabase.from("movimientos").insert({ ...d.data, fecha: d.data.fecha ?? undefined });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/caja");
  revalidatePath("/");
  return { ok: true, mensaje: "Movimiento registrado." };
}

type Cliente = Awaited<ReturnType<typeof requerirAdmin>>["supabase"];

/** Si el gasto es de un bien ya vendido, la ganancia de esa venta no se recalcula sola. */
async function avisoVenta(supabase: Cliente, bienId: number | null | undefined) {
  if (!bienId) return "";
  const { data } = await supabase.from("operaciones").select("id").eq("bien_id", bienId).eq("anulada", false).maybeSingle();
  return data ? ` Este gasto es de un bien ya vendido: para que la ganancia de la operación #${data.id} lo refleje, entrá a esa operación y usá «Corregir».` : "";
}

const esquemaEdicion = esquema.omit({ tipo: true }).extend({ movimiento_id: id });

/** Edita un movimiento cargado a mano. Los automáticos se corrigen desde su operación. */
export async function editarMovimiento(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaEdicion.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { movimiento_id, fecha, persona_id, ...resto } = d.data;

  const { data, error } = await supabase.from("movimientos")
    .update({ ...resto, persona_id: persona_id ?? null, ...(fecha ? { fecha } : {}) })
    .eq("id", movimiento_id).eq("automatico", false).eq("anulado", false).select("id, bien_id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "Solo se pueden editar movimientos cargados a mano." };

  revalidatePath("/", "layout");
  return { ok: true, mensaje: `Movimiento actualizado.${await avisoVenta(supabase, data[0].bien_id)}` };
}

export async function marcarPagado(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const movId = id.safeParse(fd.get("movimiento_id"));
  if (!movId.success) return { ok: false, error: "Movimiento inválido." };

  // Las financiaciones se marcan desde la operación, para mantener todo sincronizado.
  const { data: mov } = await supabase.from("movimientos")
    .select("id, operacion_id, motivo:motivos_caja(codigo)").eq("id", movId.data).single();
  if ((mov?.motivo as unknown as { codigo: string | null } | null)?.codigo === "cobro_venta" && mov?.operacion_id) {
    return { ok: false, error: "Esta financiación se marca como cobrada desde la operación." };
  }

  const { data, error } = await supabase.from("movimientos").update({ pendiente: false })
    .eq("id", movId.data).eq("pendiente", true).select("id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "El movimiento ya estaba resuelto." };

  revalidatePath("/caja");
  revalidatePath("/");
  return { ok: true, mensaje: "Listo." };
}

export async function borrarMovimiento(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const movId = id.safeParse(fd.get("movimiento_id"));
  if (!movId.success) return { ok: false, error: "Movimiento inválido." };

  const { data, error } = await supabase.from("movimientos").delete().eq("id", movId.data).eq("automatico", false).select("id, bien_id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "Solo se pueden borrar movimientos cargados a mano." };

  revalidatePath("/", "layout");
  const aviso = await avisoVenta(supabase, data[0].bien_id);
  return aviso ? { ok: true, mensaje: `Movimiento borrado.${aviso}` } : { ok: true };
}
