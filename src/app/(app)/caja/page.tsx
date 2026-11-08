import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, Landmark, Banknote } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { dinero, fecha, hoyISO, type Moneda } from "@/lib/formato";
import { Encabezado, Vacio, Kpi } from "@/components/ui";
import { BotonesMovimiento, BotonPagado, BotonBorrar } from "./paneles";

export const metadata: Metadata = { title: "Caja" };

type Nombre = { nombre: string; codigo?: string | null } | null;

export default async function PaginaCaja({ searchParams }: { searchParams: Promise<{ mes?: string; pendientes?: string }> }) {
  const { supabase } = await requerirAdmin();
  const { mes, pendientes } = await searchParams;
  const hoy = hoyISO();
  const mesValido = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : hoy.slice(0, 7);

  let consulta = supabase.from("movimientos")
    .select("id, fecha, tipo, monto, moneda, medio, descripcion, pendiente, automatico, anulado, operacion_id, bien_id, motivo:motivos_caja(nombre, codigo), persona:personas(nombre)")
    .eq("anulado", false).order("fecha", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (pendientes) {
    consulta = consulta.eq("pendiente", true);
  } else {
    const [a, m] = mesValido.split("-").map(Number);
    const fin = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
    consulta = consulta.gte("fecha", `${mesValido}-01`).lt("fecha", fin);
  }

  const [{ data: movs }, { data: saldos }, { data: motivos }, { data: personas }, { count: cantPend }] = await Promise.all([
    consulta,
    supabase.from("v_saldo_caja").select("*"),
    supabase.from("motivos_caja").select("id, nombre, tipo, es_gasto_fijo").eq("activo", true).is("codigo", null).order("nombre"),
    supabase.from("personas").select("id, nombre").order("nombre"),
    supabase.from("movimientos").select("id", { count: "exact", head: true }).eq("pendiente", true).eq("anulado", false),
  ]);

  const saldo = (mon: Moneda, medio: string) => Number(saldos?.find((s) => s.moneda === mon && s.medio === medio)?.saldo ?? 0);
  const lista = movs ?? [];
  const totales = (["ARS", "USD"] as Moneda[]).map((mon) => ({
    mon,
    ing: lista.filter((x) => x.moneda === mon && x.tipo === "ingreso" && !x.pendiente).reduce((s, x) => s + Number(x.monto), 0),
    egr: lista.filter((x) => x.moneda === mon && x.tipo === "egreso" && !x.pendiente).reduce((s, x) => s + Number(x.monto), 0),
  }));

  return (
    <>
      <Encabezado titulo="Caja" descripcion="Ingresos y egresos con su motivo.">
        <BotonesMovimiento motivos={motivos ?? []} personas={personas ?? []} hoy={hoy} />
      </Encabezado>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Efectivo en pesos" valor={dinero(saldo("ARS", "efectivo"), "ARS")} icono={Banknote} />
        <Kpi titulo="Banco en pesos" valor={dinero(saldo("ARS", "banco"), "ARS")} icono={Landmark} />
        <Kpi titulo="Efectivo en dólares" valor={dinero(saldo("USD", "efectivo"), "USD")} icono={Banknote} tono="verde" />
        <Kpi titulo="Banco en dólares" valor={dinero(saldo("USD", "banco"), "USD")} icono={Landmark} tono="verde" />
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <Link href="/caja" className={`insignia px-4 py-2 text-sm ${!pendientes ? "bg-grafito-900 text-white" : "bg-white ring-1 ring-acero-300"}`}>Movimientos del mes</Link>
          <Link href="/caja?pendientes=1" className={`insignia px-4 py-2 text-sm ${pendientes ? "bg-grafito-900 text-white" : "bg-white ring-1 ring-acero-300"}`}>
            Pendientes {cantPend ? <span className="ml-1 rounded-full bg-naranja-500 px-1.5 text-white">{cantPend}</span> : null}
          </Link>
        </div>
        {!pendientes && (
          <form className="flex items-end gap-2">
            <input name="mes" type="month" defaultValue={mesValido} className="campo" aria-label="Mes" />
            <button className="btn-secundario">Ver</button>
          </form>
        )}
      </div>

      {!pendientes && (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {totales.filter((t) => t.ing || t.egr).map((t) => (
            <p key={t.mon}>
              <span className="text-acero-500">{t.mon}:</span>{" "}
              <span className="cifra font-semibold text-emerald-700">+{dinero(t.ing, t.mon)}</span>{" "}
              <span className="cifra font-semibold text-red-600">−{dinero(t.egr, t.mon)}</span>{" "}
              <span className="cifra font-bold">= {dinero(t.ing - t.egr, t.mon)}</span>
            </p>
          ))}
        </div>
      )}

      {lista.length === 0 ? (
        <div className="tarjeta"><Vacio icono={Wallet} titulo={pendientes ? "No hay pendientes" : "No hay movimientos este mes"} /></div>
      ) : (
        <ul className="tarjeta divide-y divide-acero-100">
          {lista.map((mv) => (
            <li key={mv.id} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${mv.tipo === "ingreso" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {mv.tipo === "ingreso" ? "↓" : "↑"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-semibold">{(mv.motivo as unknown as Nombre)?.nombre}</p>
                  <span className={`cifra shrink-0 font-display text-lg font-bold whitespace-nowrap ${mv.tipo === "ingreso" ? "text-emerald-700" : "text-red-600"}`}>
                    {mv.tipo === "ingreso" ? "+" : "−"}{dinero(mv.monto, mv.moneda as Moneda)}
                  </span>
                </div>
                <p className="truncate text-sm text-acero-500">
                  {mv.pendiente && <span className="insignia mr-1.5 bg-amber-100 text-amber-800">Pendiente</span>}
                  {fecha(mv.fecha)} · {mv.medio === "banco" ? "Banco" : "Efectivo"}
                  {(mv.persona as unknown as Nombre)?.nombre && ` · ${(mv.persona as unknown as Nombre)!.nombre}`}
                  {mv.descripcion && ` · ${mv.descripcion}`}
                  {mv.operacion_id && <> · <Link href={`/operaciones/${mv.operacion_id}`} className="font-semibold text-naranja-600">operación #{mv.operacion_id}</Link></>}
                </p>
                {(mv.pendiente || !mv.automatico) && (
                  <div className="mt-2 flex justify-end gap-2 empty:hidden">
                    {mv.pendiente && !((mv.motivo as unknown as Nombre)?.codigo === "cobro_venta" && mv.operacion_id) && <BotonPagado id={mv.id} tipo={mv.tipo} />}
                    {!mv.automatico && <BotonBorrar id={mv.id} />}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
