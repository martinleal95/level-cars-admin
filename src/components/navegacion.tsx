"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { SECCIONES } from "./secciones";

function activa(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function MenuLateral() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones" className="flex flex-col gap-1">
      {SECCIONES.map(({ href, label, icono: Icono }) => {
        const on = activa(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              on
                ? "bg-naranja-500 text-white shadow-lg shadow-naranja-500/25"
                : "text-acero-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icono className="size-5 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

const MOVIL = [SECCIONES[0], SECCIONES[1], null, SECCIONES[3], SECCIONES[5]] as const;

/** Barra inferior para el celular, con el botón de nueva venta en el centro. */
export function BarraInferior() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-grafito-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {MOVIL.map((s) =>
          s === null ? (
            <li key="nueva" className="flex justify-center">
              <Link
                href="/operaciones/nueva"
                aria-label="Nueva venta"
                className="-mt-5 flex size-14 items-center justify-center rounded-2xl bg-naranja-500 text-white shadow-lg shadow-naranja-500/40 ring-4 ring-grafito-900 transition active:scale-95"
              >
                <Plus className="size-7" aria-hidden />
              </Link>
            </li>
          ) : (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={activa(pathname, s.href) ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                  activa(pathname, s.href) ? "text-naranja-400" : "text-acero-400"
                }`}
              >
                <s.icono className="size-6" aria-hidden />
                {s.label}
              </Link>
            </li>
          ),
        )}
      </ul>
      <span className="sr-only">{MOVIL.length} accesos</span>
    </nav>
  );
}
