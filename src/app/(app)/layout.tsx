import Image from "next/image";
import Link from "next/link";
import { LogOut, Plus, Menu } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { cerrarSesion } from "../(auth)/login/acciones";
import { MenuLateral, BarraInferior } from "@/components/navegacion";
import { SECCIONES } from "@/components/secciones";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { nombre } = await requerirAdmin();

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Menú lateral (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-grafito-900 px-4 py-6 lg:flex">
        <Link href="/" className="mb-8 block px-2">
          <Image src="/marca/level-cars_principal_color-para-fondo-oscuro.svg" alt="Level Cars"
            width={4024} height={1145} priority className="h-auto w-44" />
        </Link>
        <Link href="/operaciones/nueva" className="btn-primario mb-6 w-full">
          <Plus className="size-5" aria-hidden /> Nueva venta
        </Link>
        <MenuLateral />
        <div className="mt-auto border-t border-white/10 pt-4">
          <p className="truncate px-2 text-xs text-acero-400">Sesión de</p>
          <p className="mb-3 truncate px-2 text-sm font-semibold text-white">{nombre}</p>
          <form action={cerrarSesion}>
            <button className="btn w-full justify-start text-acero-300 hover:bg-white/5 hover:text-white">
              <LogOut className="size-5" aria-hidden /> Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      {/* Encabezado (celular) */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-grafito-900 px-4 py-3 lg:hidden">
        <Link href="/" aria-label="Inicio">
          <Image src="/marca/level-cars_una-linea_color-para-fondo-oscuro.svg" alt="Level Cars"
            width={6017} height={795} priority className="h-6 w-auto" />
        </Link>
        <details className="relative">
          <summary className="btn-fantasma list-none text-acero-200 hover:bg-white/10 [&::-webkit-details-marker]:hidden" aria-label="Más opciones">
            <Menu className="size-6" aria-hidden />
          </summary>
          <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white p-2 shadow-2xl ring-1 ring-grafito-900/10">
            {SECCIONES.map((s) => (
              <Link key={s.href} href={s.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-grafito-800 hover:bg-acero-100">
                <s.icono className="size-5 text-acero-500" aria-hidden /> {s.label}
              </Link>
            ))}
            <form action={cerrarSesion} className="mt-1 border-t border-acero-200 pt-1">
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">
                <LogOut className="size-5" aria-hidden /> Cerrar sesión
              </button>
            </form>
          </div>
        </details>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      <BarraInferior />
    </div>
  );
}
