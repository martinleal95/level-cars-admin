"use client";

import {
  createContext, startTransition, useActionState, useContext, useEffect, useRef, useState,
} from "react";
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

export type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string };
type Accion = (prev: Resultado | null, fd: FormData) => Promise<Resultado>;

/** Clases escritas completas para que Tailwind las detecte (no armar con `btn-${x}`). */
const VARIANTE = {
  primario: "btn-primario",
  exito: "btn-exito",
  peligro: "btn-peligro",
  aviso: "btn-aviso",
  secundario: "btn-secundario",
} as const;
type Variante = keyof typeof VARIANTE;

/** Indica a BotonEnviar que el formulario se está enviando. */
const Enviando = createContext(false);
export const ProveedorEnvio = Enviando.Provider;

/**
 * Envía el formulario a la server action sin usar `action={...}`:
 * React 19 limpia los campos después de cada envío con `action`, y así
 * se perdían los datos cuando el servidor devolvía un error.
 */
export function useEnvio(accion: Accion) {
  const [estado, despachar, pendiente] = useActionState<Resultado | null, FormData>(accion, null);
  const alEnviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendiente) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => despachar(fd));
  };
  return { estado, alEnviar, pendiente };
}

/**
 * Formulario con server action: muestra el error o la confirmación
 * debajo, y opcionalmente se limpia al guardar.
 */
export function Formulario({
  accion, children, className = "", limpiar = false, alGuardar,
}: {
  accion: Accion; children: React.ReactNode; className?: string; limpiar?: boolean; alGuardar?: () => void;
}) {
  const { estado, alEnviar, pendiente } = useEnvio(accion);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado?.ok) {
      if (limpiar) ref.current?.reset();
      alGuardar?.();
    }
  }, [estado, limpiar, alGuardar]);

  return (
    <form ref={ref} onSubmit={alEnviar} className={className}>
      <ProveedorEnvio value={pendiente}>{children}</ProveedorEnvio>
      <Aviso estado={estado} />
    </form>
  );
}

export function Aviso({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  if (estado.ok) {
    return estado.mensaje ? (
      <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden /> {estado.mensaje}
      </p>
    ) : null;
  }
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden /> {estado.error}
    </p>
  );
}

export function BotonEnviar({
  children, variante = "primario", className = "", ...props
}: {
  children: React.ReactNode;
  variante?: Variante;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const pending = useContext(Enviando);
  return (
    <button type="submit" disabled={pending || props.disabled} className={`${VARIANTE[variante]} ${className}`} {...props}>
      {pending && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Botón que abre un diálogo de confirmación antes de una acción
 * importante (anular, retirar, cerrar reserva). El contenido del
 * diálogo es un formulario con su propia server action.
 */
export function Dialogo({
  boton, titulo, children, variante = "secundario", icono,
}: {
  boton: string; titulo: string; children: (cerrar: () => void) => React.ReactNode;
  variante?: Variante; icono?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => setAbierto(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <>
      <button type="button" className={VARIANTE[variante]} onClick={() => setAbierto(true)}>
        {icono}{boton}
      </button>
      <dialog
        ref={ref}
        onClose={() => setAbierto(false)}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-2xl backdrop:bg-grafito-950/60 backdrop:backdrop-blur-sm"
      >
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{titulo}</h2>
            <button type="button" onClick={cerrar} className="btn-fantasma -m-2 min-h-0 p-2" aria-label="Cerrar">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {abierto && children(cerrar)}
        </div>
      </dialog>
    </>
  );
}
