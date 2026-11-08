import type { Metadata } from "next";
import { requerirAdmin } from "@/lib/auth";
import { hoyISO } from "@/lib/formato";
import { Encabezado } from "@/components/ui";
import { FormularioBien } from "./formulario";

export const metadata: Metadata = { title: "Cargar bien" };

export default async function PaginaNuevoBien() {
  const { supabase } = await requerirAdmin();
  const { data: personas } = await supabase
    .from("personas").select("id, nombre").or("es_dueno.eq.true,es_agenciero.eq.true").order("nombre");

  return (
    <>
      <Encabezado titulo="Cargar bien" descripcion="Auto, moto, celular u otro bien que entra al stock."
        volver={{ href: "/stock", label: "Stock" }} />
      <FormularioBien personas={personas ?? []} hoy={hoyISO()} />
    </>
  );
}
