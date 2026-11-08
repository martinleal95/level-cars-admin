"use client";

import { startTransition, useActionState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { iniciarSesion, type EstadoLogin } from "./acciones";

export function FormularioLogin({ avisoInicial }: { avisoInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(iniciarSesion, {
    error: avisoInicial,
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        // sin action={...}: React 19 borraría el email tras un error
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => accion(fd));
      }}
    >
      <div>
        <label htmlFor="email" className="etiqueta text-acero-200">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          className="campo" placeholder="tu@email.com" />
      </div>
      <div>
        <label htmlFor="password" className="etiqueta text-acero-200">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="campo" />
      </div>
      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
          {estado.error}
        </p>
      )}
      <button type="submit" disabled={pendiente} className="btn-primario w-full text-base">
        {pendiente ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
        Ingresar
      </button>
    </form>
  );
}
