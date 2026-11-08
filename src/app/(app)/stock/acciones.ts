"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requerirAdmin } from "@/lib/auth";
import {
  type Resultado, mensajeError, erroresZod, texto, textoOpcional, montoOpcional, monto,
  enteroOpcional, id, idOpcional, fechaISO, moneda, casilla, datosFormulario,
} from "@/lib/acciones";

const tipoBien = z.enum(["auto", "moto", "celular", "otro"], { message: "Elegí el tipo de bien" });
const base = z.enum(["fijo", "pct_precio", "pct_ganancia"]);

const datosBien = {
  tipo: tipoBien,
  marca: texto(60, "la marca"),
  modelo: texto(80, "el modelo"),
  version: textoOpcional(80),
  anio: enteroOpcional(1900, 2100),
  dominio: textoOpcional(40),
  kilometraje: enteroOpcional(0, 5_000_000),
  color: textoOpcional(40),
  precio_publicado: montoOpcional,
  notas: textoOpcional(2000),
};

const esquemaNuevo = z
  .object({
    ...datosBien,
    origen: z.enum(["compra", "consignacion", "intermediacion"], { message: "Elegí el origen" }),
    moneda,
    costo: montoOpcional,
    registrar_egreso: casilla,
    medio: z.enum(["efectivo", "banco"]).default("efectivo"),
    fecha_ingreso: fechaISO,
    dueno_id: idOpcional,
    monto_acordado: montoOpcional,
    comision_base: z.preprocess((v) => (v === "" ? null : v), base.nullable().optional()),
    comision_valor: montoOpcional,
    vence_el: fechaISO,
  })
  .superRefine((d, ctx) => {
    if (d.origen !== "compra") {
      if (!d.dueno_id) ctx.addIssue({ code: "custom", message: "Elegí el dueño del bien" });
      if (d.monto_acordado == null) ctx.addIssue({ code: "custom", message: "Indicá el monto acordado con el dueño" });
    }
    if (d.comision_base && d.comision_base !== "fijo" && (d.comision_valor ?? 0) > 100) {
      ctx.addIssue({ code: "custom", message: "El porcentaje no puede superar 100" });
    }
  });

export async function crearBien(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaNuevo.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { data, error } = await supabase.rpc("crear_bien", { p: d.data });
  if (error) return { ok: false, error: mensajeError(error) };

  // Las fotos van después de crear el bien; si alguna falla, el bien igual queda
  // creado y se avisa en su ficha para reintentar desde ahí.
  const archivos = fd.getAll("fotos").filter((a): a is File => a instanceof File && a.size > 0);
  const fotos = archivos.length ? await guardarFotos(supabase, Number(data), archivos) : null;

  revalidatePath("/stock");
  redirect(`/stock/${data}${fotos?.error ? "?fotos=error" : ""}`);
}

const esquemaEditar = z.object({
  id,
  ...datosBien,
  costo: montoOpcional,
});

export async function editarBien(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaEditar.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { id: bienId, costo, ...resto } = d.data;

  const { data: actual } = await supabase.from("bienes").select("origen").eq("id", bienId).single();
  const cambios = {
    ...resto,
    dominio: resto.dominio?.toUpperCase() ?? null,
    ...(actual && ["compra", "parte_pago"].includes(actual.origen) && costo != null ? { costo } : {}),
  };

  const { data, error } = await supabase.from("bienes").update(cambios).eq("id", bienId).select("id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "Solo se pueden editar bienes en stock o reservados." };

  revalidatePath(`/stock/${bienId}`);
  revalidatePath("/stock");
  return { ok: true, mensaje: "Cambios guardados." };
}

const esquemaGasto = z.object({
  bien_id: id,
  motivo_id: id,
  monto: monto("El monto"),
  moneda,
  medio: z.enum(["efectivo", "banco"]),
  fecha: fechaISO,
  descripcion: textoOpcional(500),
});

export async function cargarGasto(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaGasto.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { error } = await supabase.from("movimientos").insert({
    ...d.data,
    tipo: "egreso",
    fecha: d.data.fecha ?? undefined,
  });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath(`/stock/${d.data.bien_id}`);
  return { ok: true, mensaje: "Gasto cargado." };
}

const esquemaReserva = z.object({
  bien_id: id,
  cliente_id: id,
  monto: monto("La seña"),
  moneda,
  medio: z.enum(["efectivo", "banco"]),
  vence_el: fechaISO,
});

export async function reservarBien(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaReserva.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { error } = await supabase.rpc("crear_reserva", { p: d.data });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath(`/stock/${d.data.bien_id}`);
  revalidatePath("/stock");
  return { ok: true, mensaje: "Reserva registrada." };
}

const esquemaCierre = z.object({
  bien_id: id,
  reserva_id: id,
  resultado: z.enum(["retenida", "devuelta_parcial", "devuelta_total"]),
  monto_devuelto: montoOpcional,
  medio: z.enum(["efectivo", "banco"]),
  motivo: texto(500, "el motivo"),
});

export async function cerrarReserva(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaCierre.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { bien_id, ...p } = d.data;

  const { error } = await supabase.rpc("cerrar_reserva", { p });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath(`/stock/${bien_id}`);
  revalidatePath("/stock");
  return { ok: true, mensaje: "Reserva cerrada." };
}

const esquemaRetiro = z.object({ bien_id: id, motivo: texto(500, "el motivo") });

export async function retirarBien(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaRetiro.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const { error } = await supabase.rpc("retirar_bien", { p_bien_id: d.data.bien_id, p_motivo: d.data.motivo });
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath(`/stock/${d.data.bien_id}`);
  revalidatePath("/stock");
  return { ok: true, mensaje: "Bien retirado del stock." };
}

const esquemaAcuerdo = z.object({
  bien_id: id,
  monto_acordado: monto("El monto acordado"),
  vence_el: fechaISO,
  comision_base: z.preprocess((v) => (v === "" ? null : v), base.nullable().optional()),
  comision_valor: montoOpcional,
});

export async function editarAcuerdo(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const d = esquemaAcuerdo.safeParse(datosFormulario(fd));
  if (!d.success) return { ok: false, error: erroresZod(d.error) };
  const { bien_id, ...cambios } = d.data;

  const { error } = await supabase.from("acuerdos_terceros").update(cambios)
    .eq("bien_id", bien_id).eq("estado", "vigente");
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath(`/stock/${bien_id}`);
  return { ok: true, mensaje: "Acuerdo actualizado." };
}

// ---------------- Fotos ----------------
const TIPOS_FOTO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_FOTO = 5 * 1024 * 1024;

/** Verifica la "firma" real del archivo, no solo lo que dice el navegador. */
function firmaValida(bytes: Uint8Array, tipo: string) {
  if (tipo === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (tipo === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (tipo === "image/webp")
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

type Cliente = Awaited<ReturnType<typeof requerirAdmin>>["supabase"];
const MAX_FOTOS_POR_BIEN = 20;
const MAX_FOTOS_POR_ENVIO = 8;

/**
 * Valida y guarda las fotos de un bien. Devuelve cuántas se guardaron y,
 * si alguna falló, el motivo de la primera falla.
 */
async function guardarFotos(supabase: Cliente, bienId: number, archivos: File[]) {
  const validos = archivos.filter((a) => a instanceof File && a.size > 0);
  if (validos.length > MAX_FOTOS_POR_ENVIO) {
    return { guardadas: 0, error: `Subí hasta ${MAX_FOTOS_POR_ENVIO} fotos por vez.` };
  }
  const { count } = await supabase.from("bien_fotos").select("id", { count: "exact", head: true }).eq("bien_id", bienId);
  let orden = count ?? 0;
  let guardadas = 0;
  let error: string | undefined;

  for (const archivo of validos) {
    if (orden >= MAX_FOTOS_POR_BIEN) { error ??= `Máximo ${MAX_FOTOS_POR_BIEN} fotos por bien.`; break; }
    if (archivo.size > MAX_FOTO) { error ??= "Alguna foto supera los 5 MB."; continue; }
    const ext = TIPOS_FOTO[archivo.type];
    if (!ext) { error ??= "Formato no permitido. Usá JPG, PNG o WEBP."; continue; }
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    if (!firmaValida(bytes, archivo.type)) { error ??= "Algún archivo no es una imagen válida."; continue; }

    // Nombre generado por el servidor: nunca se usa el nombre del archivo original.
    const ruta = `${bienId}/${crypto.randomUUID()}.${ext}`;
    const { error: errSubida } = await supabase.storage
      .from("fotos-bienes")
      .upload(ruta, bytes, { contentType: archivo.type, upsert: false });
    if (errSubida) { error ??= "No se pudo subir alguna foto."; continue; }

    const { error: errFila } = await supabase.from("bien_fotos").insert({ bien_id: bienId, ruta, orden });
    if (errFila) {
      await supabase.storage.from("fotos-bienes").remove([ruta]);
      error ??= mensajeError(errFila);
      continue;
    }
    orden++;
    guardadas++;
  }
  return { guardadas, error };
}

export async function subirFoto(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const bienId = id.safeParse(fd.get("bien_id"));
  if (!bienId.success) return { ok: false, error: "Bien inválido." };
  const archivos = fd.getAll("fotos").filter((a): a is File => a instanceof File && a.size > 0);
  if (archivos.length === 0) return { ok: false, error: "Elegí al menos una foto." };

  const { guardadas, error } = await guardarFotos(supabase, bienId.data, archivos);
  if (guardadas > 0) revalidatePath(`/stock/${bienId.data}`);
  if (error) return { ok: false, error: guardadas ? `Se subieron ${guardadas}. ${error}` : error };
  return { ok: true, mensaje: guardadas === 1 ? "Foto agregada." : `${guardadas} fotos agregadas.` };
}

export async function borrarFoto(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const fotoId = id.safeParse(fd.get("foto_id"));
  if (!fotoId.success) return { ok: false, error: "Foto inválida." };

  const { data: foto } = await supabase.from("bien_fotos").select("ruta, bien_id").eq("id", fotoId.data).single();
  if (!foto) return { ok: false, error: "La foto no existe." };

  const { error } = await supabase.from("bien_fotos").delete().eq("id", fotoId.data);
  if (error) return { ok: false, error: mensajeError(error) };
  await supabase.storage.from("fotos-bienes").remove([foto.ruta]);

  revalidatePath(`/stock/${foto.bien_id}`);
  return { ok: true };
}
