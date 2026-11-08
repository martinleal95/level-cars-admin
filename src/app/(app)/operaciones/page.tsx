import type { Metadata } from "next";
import Link from "next/link";
import { Handshake, Plus } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { dinero, fecha, type Moneda } from "@/lib/formato";
import { Encabezado, Vacio, InsigniaOrigen } from "@/components/ui";

export const metadata: Metadata = { title: "Operaciones" };

export default async function PaginaOperaciones({ searchParams }: { searchParams: Promise<{ mes?: string; anuladas?: string }> }) {
  const { supabase } = await requerirAdmin();
  const { mes, anuladas } = await searchParams;
  const mesValido = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : null;

  let consulta = supabase.from("v_operaciones").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }).limit(300);
  if (!anuladas) consulta = consulta.eq("anulada", false);
  if (mesValido) {
    const [a, m] = mesValido.split("-").map(Number);
    const fin = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
    consulta = consulta.gte("fecha", `${mesValido}-01`).lt("fecha", fin);
  }
  const { data } = await consulta;
  const ops = data ?? [];

  return (
    <>
      <Encabezado titulo="Operaciones" descripcion="Todas las ventas con su desglose.">
        <Link href="/operaciones/nueva" className="btn-primario"><Plus className="size-5" aria-hidden /> Nueva venta</Link>
      </Encabezado>

      <form className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="mes" className="etiqueta">Mes</label>
          <input id="mes" name="mes" type="month" defaultValue={mesValido ?? ""} className="campo" />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="anuladas" value="1" defaultChecked={!!anuladas} className="size-5 accent-naranja-500" /> Ver anuladas
        </label>
        <button className="btn-secundario">Filtrar</button>
      </form>

      {ops.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono={Handshake} titulo="Todavía no hay operaciones" texto="Cuando registres una venta, vas a ver acá su ganancia y su desglose.">
            <Link href="/operaciones/nueva" className="btn-primario"><Plus className="size-5" aria-hidden /> Registrar venta</Link>
          </Vacio>
        </div>
      ) : (
        <>
          {/* Celular: tarjetas */}
          <ul className="space-y-3 md:hidden">
            {ops.map((o) => (
              <li key={o.id}>
                <Link href={`/operaciones/${o.id}`} className={`tarjeta block p-4 ${o.anulada ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{o.marca} {o.modelo}</p>
                      <p className="truncate text-sm text-acero-500">{o.cliente} · {fecha(o.fecha)}</p>
                    </div>
                    <p className={`cifra font-display text-lg font-extrabold ${Number(o.ganancia_neta) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {dinero(o.ganancia_neta, o.moneda as Moneda)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <InsigniaOrigen origen={o.tipo_operacion} />
                    {o.canal && <span className="insignia bg-acero-100 text-grafito-700">{o.canal}</span>}
                    {o.anulada && <span className="insignia bg-red-100 text-red-700">Anulada</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {/* Escritorio: tabla */}
          <div className="tarjeta hidden overflow-x-auto md:block">
            <table className="tabla">
              <thead>
                <tr><th>Fecha</th><th>Bien</th><th>Cliente</th><th>Tipo</th><th>Canal</th><th className="text-right">Precio</th><th className="text-right">Ganancia</th></tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} className={o.anulada ? "opacity-50" : ""}>
                    <td className="whitespace-nowrap">{fecha(o.fecha)}</td>
                    <td><Link href={`/operaciones/${o.id}`} className="font-semibold hover:text-naranja-600">{o.marca} {o.modelo}</Link>{o.anulada && <span className="insignia ml-2 bg-red-100 text-red-700">Anulada</span>}</td>
                    <td>{o.cliente}</td>
                    <td><InsigniaOrigen origen={o.tipo_operacion} /></td>
                    <td className="text-acero-500">{o.canal ?? "—"}</td>
                    <td className="cifra text-right">{dinero(o.precio_venta, o.moneda as Moneda)}</td>
                    <td className={`cifra text-right font-bold ${Number(o.ganancia_neta) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{dinero(o.ganancia_neta, o.moneda as Moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
