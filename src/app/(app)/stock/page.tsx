import type { Metadata } from "next";
import Link from "next/link";
import { Car, Plus, Search, Bike, Smartphone, Package } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { enlacesFotos } from "@/lib/fotos";
import { dinero, type Moneda } from "@/lib/formato";
import { Encabezado, Vacio, InsigniaEstado, InsigniaOrigen } from "@/components/ui";

export const metadata: Metadata = { title: "Stock" };

const FILTROS = [
  { valor: "disponibles", label: "Disponibles" },
  { valor: "reservado", label: "Reservados" },
  { valor: "terceros", label: "De terceros" },
  { valor: "vendido", label: "Vendidos" },
  { valor: "retirado", label: "Retirados" },
] as const;

const ICONOS = { auto: Car, moto: Bike, celular: Smartphone, otro: Package };

type Fila = {
  id: number; tipo: keyof typeof ICONOS; marca: string; modelo: string; version: string | null;
  anio: number | null; dominio: string | null; kilometraje: number | null; origen: "compra" | "parte_pago" | "consignacion" | "intermediacion";
  estado: "en_stock" | "reservado" | "vendido" | "retirado"; costo: number; moneda: Moneda;
  precio_publicado: number | null; dias_en_stock: number; dueno: string | null; monto_acordado: number | null; foto: string | null;
};

export default async function PaginaStock({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; q?: string }>;
}) {
  const { supabase } = await requerirAdmin();
  const { ver = "disponibles", q = "" } = await searchParams;

  let consulta = supabase.from("v_stock").select("*").order("fecha_ingreso", { ascending: false }).limit(500);
  if (ver === "disponibles") consulta = consulta.in("estado", ["en_stock", "reservado"]);
  else if (ver === "terceros") consulta = consulta.in("estado", ["en_stock", "reservado"]).in("origen", ["consignacion", "intermediacion"]);
  else if (["reservado", "vendido", "retirado"].includes(ver)) consulta = consulta.eq("estado", ver);

  const { data } = await consulta;
  // La búsqueda se hace en el servidor sobre los resultados (sin armar filtros con texto del usuario).
  const busqueda = q.trim().toLowerCase().slice(0, 60);
  const filas = ((data ?? []) as Fila[]).filter((b) =>
    !busqueda || `${b.marca} ${b.modelo} ${b.version ?? ""} ${b.dominio ?? ""} ${b.anio ?? ""}`.toLowerCase().includes(busqueda),
  );
  const fotos = await enlacesFotos(supabase, filas.map((f) => f.foto));

  return (
    <>
      <Encabezado titulo="Stock" descripcion={`${filas.length} ${filas.length === 1 ? "bien" : "bienes"}`}>
        <Link href="/stock/nuevo" className="btn-primario">
          <Plus className="size-5" aria-hidden /> Cargar bien
        </Link>
      </Encabezado>

      <div className="mb-5 space-y-3">
        <form className="relative" role="search">
          <input type="hidden" name="ver" value={ver} />
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-acero-400" aria-hidden />
          <input name="q" defaultValue={q} maxLength={60} placeholder="Buscar por marca, modelo, patente o año"
            className="campo pl-11" aria-label="Buscar en el stock" />
        </form>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {FILTROS.map((f) => (
            <Link key={f.valor} href={{ pathname: "/stock", query: { ver: f.valor, ...(q ? { q } : {}) } }}
              aria-current={ver === f.valor ? "true" : undefined}
              className={`insignia shrink-0 px-4 py-2 text-sm transition ${
                ver === f.valor ? "bg-grafito-900 text-white" : "bg-white text-grafito-700 ring-1 ring-acero-300 hover:bg-acero-100"
              }`}>
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {filas.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono={Car} titulo="No hay bienes para mostrar" texto="Cargá el primer vehículo para empezar a registrar operaciones.">
            <Link href="/stock/nuevo" className="btn-primario"><Plus className="size-5" aria-hidden /> Cargar bien</Link>
          </Vacio>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((b) => {
            const Icono = ICONOS[b.tipo];
            const url = b.foto ? fotos.get(b.foto) : undefined;
            return (
              <li key={b.id}>
                <Link href={`/stock/${b.id}`} className="tarjeta group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-xl">
                  <div className="relative aspect-[16/10] bg-grafito-800">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal
                      <img src={url} alt="" className="size-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-acero-500">
                        <Icono className="size-14" aria-hidden />
                      </div>
                    )}
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      <InsigniaEstado estado={b.estado} />
                      {b.origen !== "compra" && <InsigniaOrigen origen={b.origen} />}
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="truncate font-display text-lg font-bold">{b.marca} {b.modelo}</p>
                    <p className="truncate text-sm text-acero-500">
                      {[b.version, b.anio, b.kilometraje != null ? `${b.kilometraje.toLocaleString("es-AR")} km` : null, b.dominio]
                        .filter(Boolean).join(" · ") || "Sin datos adicionales"}
                    </p>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-xs text-acero-500">Precio publicado</p>
                        <p className="cifra font-display text-xl font-extrabold text-naranja-600">
                          {b.precio_publicado ? dinero(b.precio_publicado, b.moneda) : "—"}
                        </p>
                      </div>
                      <p className={`text-xs font-semibold ${b.dias_en_stock > 90 && b.estado === "en_stock" ? "text-red-600" : "text-acero-500"}`}>
                        {b.dias_en_stock} días
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
