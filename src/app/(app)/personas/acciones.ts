"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requerirAdmin } from "@/lib/auth";
import { type Resultado, mensajeError, erroresZod, texto, textoOpcional, casilla, id, datosFormulario } from "@/lib/acciones";

const esquema = z.object({
  nombre: texto(120, "el nombre"),
  telefono: textoOpcional(40),
  dni: textoOpcional(20),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().trim().email("Email inválido").max(120).nullable().optional()),
  notas: textoOpcional(2000),
  es_cliente: casilla,
  es_dueno: casilla,
  es_vendedor: casilla,
  es_referido: casilla,
  es_agenciero: casilla,
});

export async function guardarPersona(_: Resultado | null, fd: FormData): Promise<Resultado> {
  const { supabase } = await requerirAdmin();
  const datos = datosFormulario(fd);
  const d = esquema.safeParse(datos);
  if (!d.success) return { ok: false, error: erroresZod(d.error) };

  const personaId = datos.id ? id.safeParse(datos.id) : null;
  if (personaId && !personaId.success) return { ok: false, error: "Persona inválida." };

  const { error } = personaId?.success
    ? await supabase.from("personas").update(d.data).eq("id", personaId.data)
    : await supabase.from("personas").insert(d.data);
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/personas");
  return { ok: true, mensaje: personaId ? "Datos actualizados." : `${d.data.nombre} fue agregado.` };
}
