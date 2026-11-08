"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

const esquema = z.object({
  email: z.string().trim().toLowerCase().email("Ingresá un email válido").max(120),
  password: z.string().min(1, "Ingresá tu contraseña").max(200),
});

export type EstadoLogin = { error?: string };

export async function iniciarSesion(_: EstadoLogin, fd: FormData): Promise<EstadoLogin> {
  const datos = esquema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!datos.success) return { error: datos.error.issues[0]?.message };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword(datos.data);
  // Mensaje genérico: no revela si el email existe.
  if (error) return { error: "Email o contraseña incorrectos." };

  redirect("/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
