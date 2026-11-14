import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requerirAdmin } from "@/lib/auth";
import { hoyISO, type Moneda } from "@/lib/formato";
import { Encabezado } from "@/components/ui";
import { Asistente, type BienDisponible, type Inicial } from "../../nueva/asistente";

export const metadata: Metadata = { title: "Corregir operación" };

// Como lo escribe el usuario: punto para los miles y coma para los decimales.
const texto = (v: unknown) => (v == null ? "" : Number(v).toLocaleString("es-AR", { maximumFractionDigits: 4 }));

export default async function PaginaCorregir({ params }: { params: Promise<{ id: string }> }) {
  const { id: idTexto } = await params;
  const opId = Number(idTexto);
  if (!Number.isSafeInteger(opId) || opId <= 0) notFound();

  const { supabase } = await requerirAdmin();
  const { data: o } = await supabase.from("operaciones").select("*").eq("id", opId).maybeSingle();
  if (!o) notFound();
  if (o.anulada) redirect(`/operaciones/${opId}`);

  const [{ data: b }, { data: reserva }, { data: pagos }, { data: comisiones }, { data: personas }, { data: canales }, { data: financieras }, { data: pagados }] = await Promise.all([
    supabase.from("v_stock").select("id, marca, modelo, anio, dominio, origen, costo, moneda, precio_publicado, monto_acordado, acuerdo_moneda, gastos_ars, gastos_usd")
      .eq("id", o.bien_id).single(),
    supabase.from("reservas").select("cliente_id, monto, moneda, cliente:personas(nombre)").eq("operacion_id", opId).maybeSingle(),
    supabase.from("operacion_pagos")
      .select("tipo, monto, monto_pago, moneda_pago, financiera_id, cobrado, bien:bienes!operacion_pagos_bien_recibido_id_fkey(id, estado, tipo, marca, modelo, anio, dominio, kilometraje)")
      .eq("operacion_id", opId).order("id"),
    supabase.from("operacion_comisiones").select("sentido, persona_id, financiera_id, base, valor").eq("operacion_id", opId).order("id"),
    supabase.from("personas").select("id, nombre, es_vendedor").order("nombre"),
    supabase.from("canales").select("id, nombre").or(`activo.eq.true${o.canal_id ? `,id.eq.${Number(o.canal_id)}` : ""}`).order("nombre"),
    supabase.from("financieras").select("id, nombre, comision_base, comision_valor").order("nombre"),
    // Comisiones y pagos al dueño que ya se marcaron como hechos
    supabase.from("movimientos").select("monto, moneda, motivo:motivos_caja(nombre), persona:personas(nombre)")
      .eq("operacion_id", opId).eq("automatico", true).eq("anulado", false).eq("pendiente", false).is("pago_id", null).is("reserva_id", null).order("id"),
  ]);
  if (!b) notFound();

  const moneda = o.moneda as Moneda;
  const tercero = b.origen === "consignacion" || b.origen === "intermediacion";
  const bien: BienDisponible = {
    id: b.id, marca: b.marca, modelo: b.modelo, anio: b.anio, dominio: b.dominio, origen: b.origen,
    costo: Number(b.costo), moneda: b.moneda as Moneda, precio_publicado: b.precio_publicado ? Number(b.precio_publicado) : null,
    monto_acordado: b.monto_acordado != null ? Number(b.monto_acordado) : null,
    acuerdo_moneda: (b.acuerdo_moneda ?? b.moneda) as Moneda,
    gastos: { ARS: Number(b.gastos_ars ?? 0), USD: Number(b.gastos_usd ?? 0) },
    reserva: reserva ? {
      cliente_id: reserva.cliente_id, monto: Number(reserva.monto), moneda: reserva.moneda as Moneda,
      cliente: (reserva.cliente as unknown as { nombre: string }).nombre,
    } : null,
  };

  type BienRecibido = { id: number; estado: string; tipo: string; marca: string; modelo: string; anio: number | null; dominio: string | null; kilometraje: number | null } | null;
  const inicial: Inicial = {
    clienteId: String(o.cliente_id),
    canalId: o.canal_id ? String(o.canal_id) : "",
    vendedorId: o.vendedor_id ? String(o.vendedor_id) : "",
    fecha: o.fecha,
    moneda,
    precio: texto(o.precio_venta),
    cotizacion: texto(o.cotizacion),
    montoTercero: tercero ? texto(o.monto_tercero) : "",
    porAgencia: o.dinero_por_agencia,
    notas: o.notas ?? "",
    // La seña no se vuelve a cargar: sigue atada a la reserva y se descuenta sola.
    pagos: (pagos ?? []).filter((p) => p.tipo !== "sena").map((p) => {
      const r = p.bien as unknown as BienRecibido;
      return {
        tipo: p.tipo as "efectivo" | "transferencia" | "financiacion" | "bien",
        monto: texto(p.monto_pago ?? p.monto),
        moneda: (p.moneda_pago ?? moneda) as Moneda,
        financiera_id: p.financiera_id ? String(p.financiera_id) : "",
        cobrado: p.tipo === "financiacion" ? p.cobrado : false,
        existente: r ? { id: r.id, vendido: r.estado !== "en_stock" } : undefined,
        bien: {
          tipo: r?.tipo ?? "moto", marca: r?.marca ?? "", modelo: r?.modelo ?? "",
          anio: r?.anio ? String(r.anio) : "", dominio: r?.dominio ?? "", kilometraje: r?.kilometraje != null ? String(r.kilometraje) : "",
        },
      };
    }),
    comisiones: (comisiones ?? []).map((c) => ({
      sentido: c.sentido as "pagada" | "cobrada",
      quien: c.persona_id ? `p:${c.persona_id}` : `f:${c.financiera_id}`,
      base: c.base as "fijo" | "pct_precio" | "pct_ganancia",
      valor: texto(c.valor),
    })),
    pagados: (pagados ?? []).map((x) => {
      const persona = (x.persona as unknown as { nombre: string } | null)?.nombre;
      return {
        concepto: `${(x.motivo as unknown as { nombre: string } | null)?.nombre ?? "Pago"}${persona ? ` a ${persona}` : ""}`,
        monto: Number(x.monto), moneda: x.moneda as Moneda,
      };
    }),
  };

  return (
    <>
      <Encabezado titulo={`Corregir venta de ${b.marca} ${b.modelo}`}
        descripcion={`Operación #${opId}. Cambiá lo que esté mal: la operación original queda anulada en el historial y se registra la correcta en su lugar.`}
        volver={{ href: `/operaciones/${opId}`, label: "Volver a la operación" }} />
      <Asistente
        bienes={[bien]}
        bienInicial={bien.id}
        personas={(personas ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        vendedores={(personas ?? []).filter((p) => p.es_vendedor || p.id === o.vendedor_id).map((p) => ({ id: p.id, nombre: p.nombre }))}
        canales={canales ?? []}
        financieras={financieras ?? []}
        hoy={hoyISO()}
        inicial={inicial}
        correccion={{ operacionId: opId }}
      />
    </>
  );
}
