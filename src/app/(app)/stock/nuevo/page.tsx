import type { Metadata } from "next";
import { requerirAdmin } from "@/lib/auth";
import { hoyISO } from "@/lib/formato";
import { Encabezado } from "@/components/ui";
import { FormularioBien } from "./formulario";

export const metadata: Metadata = { title: "Cargar bien" };

export default async function PaginaNuevoBien({ searchParams }: { searchParams: Promise<{ vender?: string }> }) {
  const { supabase } = await requerirAdmin();
  const { vender } = await searchParams;
  const { data: personas } = await supabase.from("personas").select("id, nombre").order("nombre");

  return (
    <>
      <Encabezado titulo={vender ? "Cargar el bien que se vende" : "Cargar bien"}
        descripcion={vender ? "Cargá los datos mínimos y al guardar volvés a la venta con el bien ya elegido." : "Auto, moto, celular u otro bien, esté en la agencia o no."}
        volver={vender ? { href: "/operaciones/nueva", label: "Nueva venta" } : { href: "/stock", label: "Stock" }} />
      <FormularioBien personas={personas ?? []} hoy={hoyISO()} vender={!!vender} />
    </>
  );
}
