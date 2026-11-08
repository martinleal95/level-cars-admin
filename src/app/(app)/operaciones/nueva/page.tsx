import type { Metadata } from "next";
import { requerirAdmin } from "@/lib/auth";
import { hoyISO, type Moneda } from "@/lib/formato";
import { Encabezado } from "@/components/ui";
import { Asistente, type BienDisponible } from "./asistente";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function PaginaNuevaOperacion({ searchParams }: { searchParams: Promise<{ bien?: string }> }) {
  const { supabase } = await requerirAdmin();
  const { bien } = await searchParams;

  const [{ data: stock }, { data: reservas }, { data: personas }, { data: canales }, { data: financieras }] = await Promise.all([
    supabase.from("v_stock").select("id, marca, modelo, anio, dominio, origen, costo, moneda, precio_publicado, monto_acordado, acuerdo_moneda, gastos_ars, gastos_usd")
      .in("estado", ["en_stock", "reservado"]).order("marca"),
    supabase.from("reservas").select("bien_id, cliente_id, monto, moneda, cliente:personas(nombre)").eq("estado", "vigente"),
    supabase.from("personas").select("id, nombre, es_vendedor, es_referido").order("nombre"),
    supabase.from("canales").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("financieras").select("id, nombre, comision_base, comision_valor").eq("activo", true).order("nombre"),
  ]);

  const bienes: BienDisponible[] = (stock ?? []).map((b) => {
    const r = reservas?.find((x) => x.bien_id === b.id);
    return {
      id: b.id, marca: b.marca, modelo: b.modelo, anio: b.anio, dominio: b.dominio, origen: b.origen,
      costo: Number(b.costo), moneda: b.moneda as Moneda, precio_publicado: b.precio_publicado ? Number(b.precio_publicado) : null,
      monto_acordado: b.monto_acordado ? Number(b.monto_acordado) : null,
      acuerdo_moneda: (b.acuerdo_moneda ?? b.moneda) as Moneda,
      gastos: { ARS: Number(b.gastos_ars ?? 0), USD: Number(b.gastos_usd ?? 0) },
      reserva: r ? { cliente_id: r.cliente_id, monto: Number(r.monto), moneda: r.moneda as Moneda, cliente: (r.cliente as unknown as { nombre: string }).nombre } : null,
    };
  });

  return (
    <>
      <Encabezado titulo="Nueva venta" descripcion="Registrá la operación con todas sus formas de pago. La ganancia se calcula sola."
        volver={{ href: "/operaciones", label: "Operaciones" }} />
      <Asistente
        bienes={bienes}
        personas={(personas ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        vendedores={(personas ?? []).filter((p) => p.es_vendedor).map((p) => ({ id: p.id, nombre: p.nombre }))}
        canales={canales ?? []}
        financieras={financieras ?? []}
        bienInicial={bien ? Number(bien) : undefined}
        hoy={hoyISO()}
      />
    </>
  );
}
