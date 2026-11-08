import type { Metadata } from "next";
import Link from "next/link";
import { Users, Phone, Search } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { Encabezado, Vacio } from "@/components/ui";
import { NuevaPersona, EditarPersona, type Persona } from "./formulario";

export const metadata: Metadata = { title: "Personas" };

const FILTROS = [
  ["todos", "Todos"], ["es_cliente", "Clientes"], ["es_dueno", "Dueños"], ["es_agenciero", "Agencieros"],
  ["es_vendedor", "Vendedores"], ["es_referido", "Referidos"],
] as const;

const ROLES: [keyof Persona, string, string][] = [
  ["es_cliente", "Cliente", "bg-sky-100 text-sky-800"],
  ["es_dueno", "Dueño", "bg-violet-100 text-violet-800"],
  ["es_agenciero", "Agenciero", "bg-naranja-100 text-naranja-700"],
  ["es_vendedor", "Vendedor", "bg-emerald-100 text-emerald-800"],
  ["es_referido", "Referido", "bg-amber-100 text-amber-800"],
];

/** Convierte un teléfono a enlace de WhatsApp (solo dígitos). */
function whatsapp(tel: string) {
  const digitos = tel.replace(/\D/g, "");
  return digitos.length >= 8 ? `https://wa.me/${digitos}` : null;
}

export default async function PaginaPersonas({ searchParams }: { searchParams: Promise<{ rol?: string; q?: string }> }) {
  const { supabase } = await requerirAdmin();
  const { rol = "todos", q = "" } = await searchParams;

  let consulta = supabase.from("personas").select("*").order("nombre").limit(1000);
  const filtro = FILTROS.find(([v]) => v === rol)?.[0];
  if (filtro && filtro !== "todos") consulta = consulta.eq(filtro, true);
  const { data } = await consulta;

  const busqueda = q.trim().toLowerCase().slice(0, 60);
  const personas = ((data ?? []) as Required<Persona>[]).filter((p) =>
    !busqueda || `${p.nombre} ${p.telefono ?? ""} ${p.dni ?? ""}`.toLowerCase().includes(busqueda));

  return (
    <>
      <Encabezado titulo="Personas" descripcion="Clientes, dueños, agencieros, vendedores y referidos.">
        <NuevaPersona />
      </Encabezado>

      <div className="mb-5 space-y-3">
        <form className="relative" role="search">
          <input type="hidden" name="rol" value={rol} />
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-acero-400" aria-hidden />
          <input name="q" defaultValue={q} maxLength={60} placeholder="Buscar por nombre, teléfono o DNI" className="campo pl-11" aria-label="Buscar personas" />
        </form>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {FILTROS.map(([v, l]) => (
            <Link key={v} href={{ pathname: "/personas", query: { rol: v } }}
              className={`insignia shrink-0 px-4 py-2 text-sm ${rol === v ? "bg-grafito-900 text-white" : "bg-white text-grafito-700 ring-1 ring-acero-300 hover:bg-acero-100"}`}>
              {l}
            </Link>
          ))}
        </div>
      </div>

      {personas.length === 0 ? (
        <div className="tarjeta"><Vacio icono={Users} titulo="No hay personas cargadas" texto="Agregá clientes, dueños y vendedores para usarlos en las operaciones." /></div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((p) => {
            const wa = p.telefono ? whatsapp(p.telefono) : null;
            return (
              <li key={p.id} className="tarjeta flex flex-col p-4">
                <p className="font-display text-lg font-bold">{p.nombre}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ROLES.filter(([c]) => p[c]).map(([c, l, color]) => <span key={c} className={`insignia ${color}`}>{l}</span>)}
                </div>
                <div className="mt-3 space-y-1 text-sm text-acero-500">
                  {p.telefono && <p className="flex items-center gap-2"><Phone className="size-4" aria-hidden /> {p.telefono}</p>}
                  {p.dni && <p>DNI {p.dni}</p>}
                </div>
                <div className="mt-4 flex gap-2">
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-exito flex-1">WhatsApp</a>
                  )}
                  <EditarPersona persona={p} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
