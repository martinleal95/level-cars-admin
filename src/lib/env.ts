// Lectura validada de las variables de entorno públicas de Supabase.
// Falla temprano y con un mensaje claro si faltan.

function requerida(nombre: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}. Revisá .env.example.`);
  }
  return valor;
}

export function supabaseEnv() {
  const url = requerida("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = requerida(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const esSupabase = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url);
  const esLocal = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(url);
  if (!esSupabase && !esLocal) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no tiene el formato esperado.");
  }
  if (key.startsWith("sb_secret_") || key.includes("service_role")) {
    throw new Error("Nunca uses la clave secreta de Supabase en la aplicación.");
  }
  return { url, key };
}
