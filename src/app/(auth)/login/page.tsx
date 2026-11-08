import type { Metadata } from "next";
import Image from "next/image";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Ingresar" };

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const aviso = error === "sin-acceso" ? "Tu usuario no tiene acceso al sistema." : undefined;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-grafito-900 px-4">
      {/* Fondo con la geometría de la marca */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] rotate-12 rounded-[4rem] bg-naranja-500/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 size-[24rem] rounded-full bg-acero-200/5 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <Image
          src="/marca/level-cars_principal_color-para-fondo-oscuro.svg"
          alt="Level Cars"
          width={4024}
          height={1145}
          priority
          className="mx-auto mb-10 h-auto w-64"
        />
        <div className="rounded-2xl bg-grafito-800/80 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur sm:p-8">
          <h1 className="mb-1 text-xl font-bold text-white">Panel de gestión</h1>
          <p className="mb-6 text-sm text-acero-400">Ingresá con tu cuenta de administrador.</p>
          <FormularioLogin avisoInicial={aviso} />
        </div>
      </div>
    </main>
  );
}
