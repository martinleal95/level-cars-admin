import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Exige un usuario logueado que además figure como administrador activo.
 * Se llama al comienzo de cada página y de cada server action: la base de
 * datos vuelve a verificarlo con RLS, así hay doble control.
 */
export const requerirAdmin = cache(async () => {
  const supabase = await crearClienteServidor();
  // Token verificado por firma (rápido). Igual la base revisa en cada consulta,
  // con RLS, que el usuario figure como administrador activo.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: admin } = await supabase
    .from("administradores")
    .select("nombre, activo")
    .eq("user_id", userId)
    .maybeSingle();

  if (!admin?.activo) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-acceso");
  }

  return { supabase, userId, nombre: admin.nombre as string };
});
