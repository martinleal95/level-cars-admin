import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { etiquetas } from "@/lib/formato";

export function Encabezado({
  titulo, descripcion, children, volver,
}: {
  titulo: string;
  descripcion?: string;
  children?: React.ReactNode;
  volver?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {volver && (
        <Link href={volver.href} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-acero-500 hover:text-naranja-600">
          ← {volver.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-grafito-900 sm:text-3xl">{titulo}</h1>
          {descripcion && <p className="mt-1 text-sm text-acero-500">{descripcion}</p>}
        </div>
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function Seccion({ titulo, children, accion, className = "" }: {
  titulo?: string; children: React.ReactNode; accion?: React.ReactNode; className?: string;
}) {
  return (
    <section className={`tarjeta min-w-0 p-4 sm:p-6 ${className}`}>
      {(titulo || accion) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {titulo && <h2 className="text-lg font-bold">{titulo}</h2>}
          {accion}
        </div>
      )}
      {children}
    </section>
  );
}

export function Vacio({ icono: Icono, titulo, texto, children }: {
  icono: LucideIcon; titulo: string; texto?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-naranja-50 text-naranja-500">
        <Icono className="size-7" aria-hidden />
      </div>
      <p className="font-display text-lg font-bold">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-sm text-acero-500">{texto}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

const coloresEstado: Record<string, string> = {
  en_stock: "bg-emerald-100 text-emerald-800",
  reservado: "bg-amber-100 text-amber-800",
  vendido: "bg-sky-100 text-sky-800",
  retirado: "bg-acero-200 text-acero-500",
};

export function InsigniaEstado({ estado }: { estado: keyof typeof etiquetas.estado }) {
  return <span className={`insignia ${coloresEstado[estado]}`}>{etiquetas.estado[estado]}</span>;
}

const coloresOrigen: Record<string, string> = {
  compra: "bg-grafito-900 text-white",
  parte_pago: "bg-grafito-700 text-white",
  consignacion: "bg-violet-100 text-violet-800",
  intermediacion: "bg-naranja-100 text-naranja-700",
};

export function InsigniaOrigen({ origen }: { origen: keyof typeof etiquetas.origen }) {
  return <span className={`insignia ${coloresOrigen[origen]}`}>{etiquetas.origen[origen]}</span>;
}

export function Dato({ etiqueta, children, destacado }: {
  etiqueta: string; children: React.ReactNode; destacado?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-acero-500 uppercase">{etiqueta}</dt>
      <dd className={`mt-0.5 ${destacado ? "font-display text-xl font-extrabold" : "font-medium"}`}>{children}</dd>
    </div>
  );
}

export function Kpi({ titulo, valor, detalle, icono: Icono, tono = "neutro" }: {
  titulo: string; valor: React.ReactNode; detalle?: React.ReactNode; icono: LucideIcon;
  tono?: "neutro" | "naranja" | "verde" | "rojo";
}) {
  const tonos = {
    neutro: "bg-acero-100 text-grafito-700",
    naranja: "bg-naranja-50 text-naranja-600",
    verde: "bg-emerald-50 text-emerald-700",
    rojo: "bg-red-50 text-red-600",
  };
  return (
    <div className="tarjeta p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-acero-500">{titulo}</p>
        <span className={`flex size-9 items-center justify-center rounded-lg ${tonos[tono]}`}>
          <Icono className="size-5" aria-hidden />
        </span>
      </div>
      <p className="cifra mt-2 font-display text-2xl font-extrabold">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-acero-500">{detalle}</p>}
    </div>
  );
}

export function Campo({ etiqueta, htmlFor, ayuda, children, className = "" }: {
  etiqueta: string; htmlFor: string; ayuda?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="etiqueta">{etiqueta}</label>
      {children}
      {ayuda && <p className="ayuda">{ayuda}</p>}
    </div>
  );
}
