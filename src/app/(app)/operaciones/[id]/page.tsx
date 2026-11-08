import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Car } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { dinero, fecha, etiquetas, type Moneda } from "@/lib/formato";
import { Encabezado, Seccion, Dato, InsigniaOrigen } from "@/components/ui";
import { BotonAnular, BotonFinanciacionCobrada } from "./paneles";

export const metadata: Metadata = { title: "Operación" };

type Nombre = { nombre: string } | null;

export default async function PaginaOperacion({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { id: idTexto } = await params;
  const { nueva } = await searchParams;
  const opId = Number(idTexto);
  if (!Number.isSafeInteger(opId) || opId <= 0) notFound();

  const { supabase } = await requerirAdmin();
  const [{ data: o }, { data: pagos }, { data: comisiones }, { data: movs }] = await Promise.all([
    supabase.from("v_operaciones").select("*").eq("id", opId).maybeSingle(),
    supabase.from("operacion_pagos").select("*, financiera:financieras(nombre), bien:bienes!operacion_pagos_bien_recibido_id_fkey(id, marca, modelo)").eq("operacion_id", opId).order("id"),
    supabase.from("operacion_comisiones").select("*, persona:personas(nombre), financiera:financieras(nombre)").eq("operacion_id", opId).order("id"),
    supabase.from("movimientos").select("id, tipo, monto, moneda, pendiente, anulado, descripcion, motivo:motivos_caja(nombre)").eq("operacion_id", opId).order("id"),
  ]);
  if (!o) notFound();
  const m = o.moneda as Moneda;
  const tercero = o.tipo_operacion === "consignacion" || o.tipo_operacion === "intermediacion";

  const filas: [string, number, "+" | "−"][] = [
    ["Precio de venta", Number(o.precio_venta), "+"],
    ...(!tercero ? [["Costo del bien", Number(o.costo_bien), "−"] as [string, number, "−"]] : []),
    ...(tercero ? [[o.tipo_operacion === "consignacion" ? "Pago al dueño" : "Pago al agenciero", Number(o.monto_tercero), "−"] as [string, number, "−"]] : []),
    ...(Number(o.gastos_bien) > 0 ? [["Gastos del bien", Number(o.gastos_bien), "−"] as [string, number, "−"]] : []),
    ...(Number(o.comisiones_pagadas) > 0 ? [["Comisiones pagadas", Number(o.comisiones_pagadas), "−"] as [string, number, "−"]] : []),
    ...(Number(o.comisiones_cobradas) > 0 ? [["Comisiones cobradas", Number(o.comisiones_cobradas), "+"] as [string, number, "+"]] : []),
  ];

  return (
    <>
      {nueva && !o.anulada && (
        <div role="status" className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-lg">
          <CheckCircle2 className="size-6" aria-hidden /> Venta registrada. Los movimientos de caja ya se generaron.
        </div>
      )}
      <Encabezado titulo={`${o.marca} ${o.modelo}`} descripcion={`Operación #${o.id} · ${fecha(o.fecha)}`} volver={{ href: "/operaciones", label: "Operaciones" }}>
        <Link href={`/stock/${o.bien_id}`} className="btn-secundario"><Car className="size-5" aria-hidden /> Ver bien</Link>
        {!o.anulada && <BotonAnular operacionId={o.id} />}
      </Encabezado>

      {o.anulada && (
        <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">Esta operación está anulada.</p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Seccion titulo="Desglose de la ganancia">
            <dl className="divide-y divide-acero-100">
              {filas.map(([l, v, s]) => (
                <div key={l} className="flex justify-between gap-3 py-2.5">
                  <dt className="text-acero-500">{l}</dt>
                  <dd className={`cifra font-semibold ${s === "−" ? "text-red-600" : ""}`}>{s === "−" ? "− " : ""}{dinero(v, m)}</dd>
                </div>
              ))}
              <div className="flex items-end justify-between gap-3 pt-4">
                <dt className="font-display text-lg font-bold">Ganancia neta</dt>
                <dd className={`cifra font-display text-3xl font-extrabold ${Number(o.ganancia_neta) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{dinero(o.ganancia_neta, m)}</dd>
              </div>
            </dl>
            {o.cotizacion && <p className="ayuda mt-3">Cotización usada: {dinero(o.cotizacion, "ARS")} por dólar.</p>}
          </Seccion>

          <Seccion titulo="Formas de pago">
            <ul className="divide-y divide-acero-100">
              {(pagos ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{etiquetas.tipoPago[p.tipo as keyof typeof etiquetas.tipoPago]}</p>
                    <p className="text-sm text-acero-500">
                      {p.tipo === "financiacion" && (p.financiera as Nombre)?.nombre}
                      {p.tipo === "bien" && p.bien && (
                        <Link href={`/stock/${(p.bien as { id: number }).id}`} className="font-semibold text-naranja-600 hover:underline">
                          {(p.bien as { marca: string }).marca} {(p.bien as { modelo: string }).modelo} → ver en stock
                        </Link>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {p.tipo === "financiacion" && (p.cobrado
                      ? <span className="insignia bg-emerald-100 text-emerald-800">Cobrada</span>
                      : !o.anulada && <BotonFinanciacionCobrada pagoId={p.id} />)}
                    <span className="text-right">
                      <span className="cifra block font-bold">{dinero(p.monto_pago ?? p.monto, (p.moneda_pago ?? m) as Moneda)}</span>
                      {p.moneda_pago && p.moneda_pago !== m && <span className="cifra block text-xs text-acero-500">≈ {dinero(p.monto, m)}</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Seccion>

          {(comisiones?.length ?? 0) > 0 && (
            <Seccion titulo="Comisiones">
              <ul className="divide-y divide-acero-100">
                {comisiones!.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">{(c.persona as Nombre)?.nombre ?? (c.financiera as Nombre)?.nombre}</p>
                      <p className="text-sm text-acero-500">
                        {c.sentido === "pagada" ? "Paga la agencia" : "Cobra la agencia"} · {etiquetas.base[c.base as keyof typeof etiquetas.base]}
                        {c.base !== "fijo" && ` (${Number(c.valor)}%)`}
                      </p>
                    </div>
                    <span className={`cifra font-bold ${c.sentido === "pagada" ? "text-red-600" : "text-emerald-700"}`}>
                      {c.sentido === "pagada" ? "− " : "+ "}{dinero(c.monto, m)}
                    </span>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </div>

        <div className="space-y-5">
          <Seccion titulo="Datos">
            <dl className="space-y-3">
              <Dato etiqueta="Tipo"><InsigniaOrigen origen={o.tipo_operacion} /></Dato>
              <Dato etiqueta="Cliente">{o.cliente}</Dato>
              <Dato etiqueta="Canal">{o.canal ?? "Sin indicar"}</Dato>
              <Dato etiqueta="Vendedor">{o.vendedor ?? "Sin vendedor"}</Dato>
              {o.tipo_operacion === "intermediacion" && (
                <Dato etiqueta="Dinero del comprador">{o.dinero_por_agencia ? "Pasó por la agencia" : "Directo al agenciero"}</Dato>
              )}
              {o.notas && <Dato etiqueta="Notas"><span className="whitespace-pre-line">{o.notas}</span></Dato>}
            </dl>
          </Seccion>

          <Seccion titulo="Movimientos de caja">
            <ul className="space-y-2 text-sm">
              {(movs ?? []).map((mv) => (
                <li key={mv.id} className={`flex items-start justify-between gap-3 ${mv.anulado ? "line-through opacity-50" : ""}`}>
                  <span>
                    {(mv.motivo as unknown as Nombre)?.nombre}
                    {mv.pendiente && !mv.anulado && <span className="insignia ml-1.5 bg-amber-100 text-amber-800">Pendiente</span>}
                  </span>
                  <span className={`cifra font-semibold ${mv.tipo === "egreso" ? "text-red-600" : "text-emerald-700"}`}>
                    {mv.tipo === "egreso" ? "−" : "+"}{dinero(mv.monto, mv.moneda as Moneda)}
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/caja?pendientes=1" className="mt-4 inline-block text-sm font-semibold text-naranja-600 hover:underline">Ver pendientes en Caja →</Link>
          </Seccion>
        </div>
      </div>
    </>
  );
}
