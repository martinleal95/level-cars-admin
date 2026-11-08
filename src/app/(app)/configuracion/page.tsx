import type { Metadata } from "next";
import { requerirAdmin } from "@/lib/auth";
import { Encabezado, Seccion } from "@/components/ui";
import { FormConfig, AgregarItem, Alternar } from "./paneles";

export const metadata: Metadata = { title: "Configuración" };

type Item = { id: number; nombre: string; activo: boolean; detalle?: string };

function Lista({ items, tabla }: { items: Item[]; tabla: string }) {
  return (
    <ul className="mb-4 divide-y divide-acero-100">
      {items.map((i) => (
        <li key={i.id} className={`flex items-center justify-between gap-3 py-2.5 ${i.activo ? "" : "opacity-50"}`}>
          <span><span className="font-semibold">{i.nombre}</span>{i.detalle && <span className="text-sm text-acero-500"> · {i.detalle}</span>}</span>
          <Alternar tabla={tabla} id={i.id} activo={i.activo} />
        </li>
      ))}
    </ul>
  );
}

export default async function PaginaConfiguracion() {
  const { supabase } = await requerirAdmin();
  const [{ data: cfg }, { data: canales }, { data: financieras }, { data: motivos }] = await Promise.all([
    supabase.from("configuracion").select("*").eq("id", 1).single(),
    supabase.from("canales").select("id, nombre, activo").order("nombre"),
    supabase.from("financieras").select("id, nombre, activo, comision_base, comision_valor").order("nombre"),
    supabase.from("motivos_caja").select("id, nombre, activo, tipo, es_gasto_fijo").is("codigo", null).order("tipo").order("nombre"),
  ]);

  return (
    <>
      <Encabezado titulo="Configuración" descripcion="Plazos, alertas y listas que se usan en todo el sistema." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Seccion titulo="Plazos y alertas" className="lg:col-span-2">{cfg && <FormConfig c={cfg} />}</Seccion>
        <Seccion titulo="Canales de entrada">
          <Lista tabla="canales" items={canales ?? []} />
          <AgregarItem tabla="canales" placeholder="Nuevo canal" />
        </Seccion>
        <Seccion titulo="Financieras">
          <Lista tabla="financieras" items={(financieras ?? []).map((f) => ({
            ...f, detalle: f.comision_base ? (f.comision_base === "fijo" ? `comisión fija ${f.comision_valor}` : `comisión ${Number(f.comision_valor)}%`) : "sin comisión",
          }))} />
          <AgregarItem tabla="financieras" placeholder="Nueva financiera" />
        </Seccion>
        <Seccion titulo="Motivos de caja" className="lg:col-span-2">
          <p className="-mt-2 mb-3 text-sm text-acero-500">Los gastos fijos se restan en el resultado del mes, no en cada operación.</p>
          <Lista tabla="motivos_caja" items={(motivos ?? []).map((m) => ({
            ...m, detalle: m.tipo === "ingreso" ? "ingreso" : m.es_gasto_fijo ? "egreso · gasto fijo" : "egreso",
          }))} />
          <AgregarItem tabla="motivos_caja" placeholder="Nuevo motivo" />
        </Seccion>
      </div>
    </>
  );
}
