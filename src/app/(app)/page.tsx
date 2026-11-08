import Link from "next/link";
import {
  TrendingUp, Car, CalendarClock, AlertTriangle, HandCoins, Plus, Wallet, ArrowRight, BellRing, CheckCircle2,
} from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { dinero, fecha, hoyISO, type Moneda } from "@/lib/formato";
import { Kpi, Seccion } from "@/components/ui";

const ICONO_ALERTA: Record<string, typeof AlertTriangle> = {
  consignacion_vencida: CalendarClock,
  reserva_vencida: CalendarClock,
  financiacion_pendiente: HandCoins,
  pago_pendiente: Wallet,
  stock_antiguo: Car,
};

export default async function PaginaInicio() {
  const { supabase, nombre } = await requerirAdmin();
  const hoy = hoyISO();
  const mesActual = `${hoy.slice(0, 7)}-01`;

  const [{ data: resultado }, { data: alertas }, { count: enStock }, { count: reservados }, { data: ultimas }] = await Promise.all([
    supabase.from("v_resultado_mensual").select("*").eq("mes", mesActual),
    supabase.from("v_alertas").select("*").order("fecha").limit(30),
    supabase.from("bienes").select("id", { count: "exact", head: true }).eq("estado", "en_stock"),
    supabase.from("bienes").select("id", { count: "exact", head: true }).eq("estado", "reservado"),
    supabase.from("v_operaciones").select("id, fecha, marca, modelo, cliente, moneda, ganancia_neta").eq("anulada", false)
      .order("fecha", { ascending: false }).order("id", { ascending: false }).limit(5),
  ]);

  const res = (m: Moneda) => resultado?.find((r) => r.moneda === m);
  const usd = res("USD");
  const ars = res("ARS");
  const operacionesMes = Number(usd?.operaciones ?? 0) + Number(ars?.operaciones ?? 0);
  const saludo = new Date().toLocaleString("es-AR", { hour: "numeric", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
  const h = Number(saludo);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-acero-500">{h < 13 ? "Buen día" : h < 20 ? "Buenas tardes" : "Buenas noches"},</p>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{nombre.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/stock/nuevo" className="btn-secundario"><Car className="size-5" aria-hidden /> Cargar bien</Link>
          <Link href="/operaciones/nueva" className="btn-primario"><Plus className="size-5" aria-hidden /> Nueva venta</Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="tarjeta col-span-2 bg-grafito-900 p-5 text-white lg:col-span-2">
          <div className="flex items-start justify-between">
            <p className="text-sm font-semibold text-acero-400">Resultado del mes</p>
            <TrendingUp className="size-6 text-naranja-400" aria-hidden />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            {/* Solo las monedas con movimiento; si no hay ninguno, $ 0 */}
            {Number(usd?.resultado ?? 0) !== 0 && (
              <p className="cifra font-display text-3xl font-extrabold text-naranja-400">{dinero(usd?.resultado ?? 0, "USD")}</p>
            )}
            {(Number(ars?.resultado ?? 0) !== 0 || Number(usd?.resultado ?? 0) === 0) && (
              <p className={`cifra font-display font-extrabold ${Number(usd?.resultado ?? 0) !== 0 ? "text-xl text-acero-200" : "text-3xl text-naranja-400"}`}>
                {dinero(ars?.resultado ?? 0, "ARS")}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-acero-400">Ganancia de operaciones + señas retenidas − gastos fijos</p>
        </div>
        <Kpi titulo="Ventas del mes" valor={operacionesMes} icono={HandCoins} tono="naranja" />
        <Kpi titulo="En stock" valor={enStock ?? 0} detalle={`${reservados ?? 0} reservados`} icono={Car} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Seccion titulo="Para atender" className="lg:col-span-3"
          accion={alertas?.length ? <span className="insignia bg-naranja-500 text-white">{alertas.length}</span> : undefined}>
          {alertas?.length ? (
            <ul className="divide-y divide-acero-100">
              {alertas.map((a, i) => {
                const Icono = ICONO_ALERTA[a.tipo] ?? BellRing;
                const href = a.operacion_id ? `/operaciones/${a.operacion_id}` : a.bien_id ? `/stock/${a.bien_id}` : "/caja?pendientes=1";
                return (
                  <li key={`${a.tipo}-${i}`}>
                    <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-acero-50">
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${a.tipo.includes("vencida") ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                        <Icono className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{a.titulo}</span>
                        <span className="block truncate text-sm text-acero-500">{a.detalle}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-acero-400" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 py-6 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-5" aria-hidden /> Todo al día. No hay nada pendiente.
            </p>
          )}
        </Seccion>

        <Seccion titulo="Últimas ventas" className="lg:col-span-2" accion={<Link href="/operaciones" className="text-sm font-semibold text-naranja-600">Ver todas</Link>}>
          {ultimas?.length ? (
            <ul className="divide-y divide-acero-100">
              {ultimas.map((o) => (
                <li key={o.id}>
                  <Link href={`/operaciones/${o.id}`} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{o.marca} {o.modelo}</span>
                      <span className="block truncate text-sm text-acero-500">{o.cliente} · {fecha(o.fecha)}</span>
                    </span>
                    <span className={`cifra font-bold ${Number(o.ganancia_neta) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{dinero(o.ganancia_neta, o.moneda as Moneda)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-acero-500">Todavía no hay ventas registradas.</p>
          )}
        </Seccion>
      </div>
    </>
  );
}
