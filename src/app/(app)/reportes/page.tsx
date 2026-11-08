import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { dinero, mes as nombreMes, etiquetas, hoyISO, type Moneda } from "@/lib/formato";
import { Encabezado, Seccion, Vacio } from "@/components/ui";

export const metadata: Metadata = { title: "Reportes" };

type Op = {
  fecha: string; moneda: Moneda; ganancia_neta: number; precio_venta: number; canal: string | null; vendedor: string | null;
  tipo_operacion: keyof typeof etiquetas.origen; con_parte_pago: boolean; con_financiacion: boolean;
};

function agrupar(ops: Op[], clave: (o: Op) => string) {
  const mapa = new Map<string, { cantidad: number; ganancia: number; ventas: number }>();
  for (const o of ops) {
    const k = clave(o);
    const a = mapa.get(k) ?? { cantidad: 0, ganancia: 0, ventas: 0 };
    a.cantidad += 1; a.ganancia += Number(o.ganancia_neta); a.ventas += Number(o.precio_venta);
    mapa.set(k, a);
  }
  return [...mapa.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.ganancia - a.ganancia);
}

function Barras({ filas, moneda }: { filas: { nombre: string; cantidad: number; ganancia: number }[]; moneda: Moneda }) {
  const max = Math.max(...filas.map((f) => Math.abs(f.ganancia)), 1);
  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.nombre}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="font-semibold">{f.nombre} <span className="font-normal text-acero-500">· {f.cantidad} {f.cantidad === 1 ? "venta" : "ventas"}</span></span>
            <span className={`cifra font-bold ${f.ganancia >= 0 ? "" : "text-red-600"}`}>{dinero(f.ganancia, moneda)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-acero-100">
            <div className={`h-full rounded-full ${f.ganancia >= 0 ? "bg-naranja-500" : "bg-red-500"}`} style={{ width: `${(Math.abs(f.ganancia) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function PaginaReportes({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; moneda?: string }> }) {
  const { supabase } = await requerirAdmin();
  const sp = await searchParams;
  const hoy = hoyISO();
  const desde = sp.desde && /^\d{4}-\d{2}-\d{2}$/.test(sp.desde) ? sp.desde : `${hoy.slice(0, 4)}-01-01`;
  const hasta = sp.hasta && /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta) ? sp.hasta : hoy;
  const moneda: Moneda = sp.moneda === "ARS" ? "ARS" : "USD";

  const [{ data: opsDb }, { data: mensual }] = await Promise.all([
    supabase.from("v_operaciones").select("fecha, moneda, ganancia_neta, precio_venta, canal, vendedor, tipo_operacion, con_parte_pago, con_financiacion")
      .eq("anulada", false).eq("moneda", moneda).gte("fecha", desde).lte("fecha", hasta).limit(5000),
    supabase.from("v_resultado_mensual").select("*").eq("moneda", moneda).gte("mes", desde.slice(0, 8) + "01").lte("mes", hasta).order("mes", { ascending: false }),
  ]);
  const ops = (opsDb ?? []) as Op[];

  const total = ops.reduce((s, o) => s + Number(o.ganancia_neta), 0);
  const ventas = ops.reduce((s, o) => s + Number(o.precio_venta), 0);
  const porCanal = agrupar(ops, (o) => o.canal ?? "Sin indicar");
  const porTipo = agrupar(ops, (o) => etiquetas.origen[o.tipo_operacion]);
  const porVendedor = agrupar(ops, (o) => o.vendedor ?? "Sin vendedor");
  const porForma = agrupar(ops, (o) => [o.con_parte_pago && "Con parte de pago", o.con_financiacion && "Con financiación"].filter(Boolean).join(" + ") || "Contado");

  return (
    <>
      <Encabezado titulo="Reportes" descripcion="Dónde está la ganancia: por canal, por tipo de operación y por vendedor." />

      <form className="tarjeta mb-6 flex flex-wrap items-end gap-3 p-4">
        <div><label htmlFor="desde" className="etiqueta">Desde</label><input id="desde" name="desde" type="date" defaultValue={desde} className="campo" /></div>
        <div><label htmlFor="hasta" className="etiqueta">Hasta</label><input id="hasta" name="hasta" type="date" defaultValue={hasta} className="campo" /></div>
        <div>
          <label htmlFor="moneda" className="etiqueta">Moneda</label>
          <select id="moneda" name="moneda" defaultValue={moneda} className="campo"><option value="USD">Dólares</option><option value="ARS">Pesos</option></select>
        </div>
        <button className="btn-primario">Ver</button>
      </form>

      {ops.length === 0 && !mensual?.length ? (
        <div className="tarjeta"><Vacio icono={BarChart3} titulo="Sin operaciones en este período" texto="Probá con otro rango de fechas o con la otra moneda." /></div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="tarjeta bg-grafito-900 p-5 text-white">
              <p className="text-sm font-semibold text-acero-400">Ganancia de operaciones</p>
              <p className="cifra mt-1 font-display text-3xl font-extrabold text-naranja-400">{dinero(total, moneda)}</p>
            </div>
            <div className="tarjeta p-5"><p className="text-sm font-semibold text-acero-500">Ventas</p><p className="cifra mt-1 font-display text-3xl font-extrabold">{dinero(ventas, moneda)}</p></div>
            <div className="tarjeta p-5"><p className="text-sm font-semibold text-acero-500">Operaciones</p><p className="cifra mt-1 font-display text-3xl font-extrabold">{ops.length}</p></div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Seccion titulo="Por canal de entrada"><Barras filas={porCanal} moneda={moneda} /></Seccion>
            <Seccion titulo="Por tipo de operación"><Barras filas={porTipo} moneda={moneda} /></Seccion>
            <Seccion titulo="Por vendedor"><Barras filas={porVendedor} moneda={moneda} /></Seccion>
            <Seccion titulo="Por forma de pago"><Barras filas={porForma} moneda={moneda} /></Seccion>
          </div>

          <Seccion titulo="Resultado mensual">
            <p className="-mt-2 mb-4 text-sm text-acero-500">Ganancia de operaciones + señas retenidas − gastos fijos (alquiler, sueldos, servicios).</p>
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Mes</th><th className="text-right">Ventas</th><th className="text-right">Ganancia ops.</th><th className="text-right">Señas ret.</th><th className="text-right">Gastos fijos</th><th className="text-right">Resultado</th></tr></thead>
                <tbody>
                  {(mensual ?? []).map((r) => (
                    <tr key={r.mes}>
                      <td className="capitalize">{nombreMes(r.mes)}</td>
                      <td className="cifra text-right">{r.operaciones}</td>
                      <td className="cifra text-right">{dinero(r.ganancia_operaciones, moneda)}</td>
                      <td className="cifra text-right">{dinero(r.senas_retenidas, moneda)}</td>
                      <td className="cifra text-right text-red-600">−{dinero(r.gastos_fijos, moneda)}</td>
                      <td className={`cifra text-right font-bold ${Number(r.resultado) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{dinero(r.resultado, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        </div>
      )}
    </>
  );
}
