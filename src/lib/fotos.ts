import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Genera enlaces firmados y temporales (1 hora) para fotos privadas. */
export async function enlacesFotos(supabase: SupabaseClient, rutas: (string | null | undefined)[]) {
  const validas = [...new Set(rutas.filter((r): r is string => !!r))];
  const mapa = new Map<string, string>();
  if (!validas.length) return mapa;
  const { data } = await supabase.storage.from("fotos-bienes").createSignedUrls(validas, 3600);
  data?.forEach((d) => {
    if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
  });
  return mapa;
}
