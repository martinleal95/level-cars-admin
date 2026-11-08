"use client";

import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Check, Trash2 } from "lucide-react";
import { Formulario, BotonEnviar, Dialogo } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { registrarMovimiento, marcarPagado, borrarMovimiento } from "./acciones";

type Motivo = { id: number; nombre: string; tipo: "ingreso" | "egreso"; es_gasto_fijo: boolean };
type Persona = { id: number; nombre: string };

function FormMovimiento({ tipo, motivos, personas, hoy, cerrar }: {
  tipo: "ingreso" | "egreso"; motivos: Motivo[]; personas: Persona[]; hoy: string; cerrar: () => void;
}) {
  const [t] = useState(tipo);
  return (
    <Formulario accion={registrarMovimiento} alGuardar={cerrar} className="space-y-4">
      <input type="hidden" name="tipo" value={t} />
      <Campo etiqueta="Motivo" htmlFor="mv_motivo">
        <select id="mv_motivo" name="motivo_id" required defaultValue="" className="campo">
          <option value="" disabled>Elegí</option>
          {motivos.filter((m) => m.tipo === t).map((m) => (
            <option key={m.id} value={m.id}>{m.nombre}{m.es_gasto_fijo ? " (gasto fijo)" : ""}</option>
          ))}
        </select>
      </Campo>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Campo etiqueta="Monto" htmlFor="mv_monto"><input id="mv_monto" name="monto" inputMode="decimal" required className="campo cifra" /></Campo>
        <Campo etiqueta="Moneda" htmlFor="mv_moneda">
          <select id="mv_moneda" name="moneda" className="campo"><option value="ARS">$</option><option value="USD">US$</option></select>
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Medio" htmlFor="mv_medio">
          <select id="mv_medio" name="medio" className="campo"><option value="efectivo">Efectivo</option><option value="banco">Banco</option></select>
        </Campo>
        <Campo etiqueta="Fecha" htmlFor="mv_fecha"><input id="mv_fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} className="campo" /></Campo>
      </div>
      <Campo etiqueta="Persona (opcional)" htmlFor="mv_persona">
        <select id="mv_persona" name="persona_id" defaultValue="" className="campo">
          <option value="">Ninguna</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Detalle" htmlFor="mv_desc"><input id="mv_desc" name="descripcion" maxLength={500} className="campo" /></Campo>
      <BotonEnviar variante={t === "ingreso" ? "exito" : "peligro"} className="w-full">
        Registrar {t}
      </BotonEnviar>
    </Formulario>
  );
}

export function BotonesMovimiento(props: { motivos: Motivo[]; personas: Persona[]; hoy: string }) {
  return (
    <>
      <Dialogo boton="Ingreso" titulo="Registrar ingreso" variante="exito" icono={<ArrowDownCircle className="size-5" aria-hidden />}>
        {(cerrar) => <FormMovimiento tipo="ingreso" cerrar={cerrar} {...props} />}
      </Dialogo>
      <Dialogo boton="Egreso" titulo="Registrar egreso" variante="peligro" icono={<ArrowUpCircle className="size-5" aria-hidden />}>
        {(cerrar) => <FormMovimiento tipo="egreso" cerrar={cerrar} {...props} />}
      </Dialogo>
    </>
  );
}

export function BotonPagado({ id, tipo }: { id: number; tipo: "ingreso" | "egreso" }) {
  return (
    <Formulario accion={marcarPagado}>
      <input type="hidden" name="movimiento_id" value={id} />
      <BotonEnviar variante="exito" className="min-h-9 px-3 py-1.5">
        <Check className="size-4" aria-hidden /> {tipo === "egreso" ? "Pagado" : "Cobrado"}
      </BotonEnviar>
    </Formulario>
  );
}

export function BotonBorrar({ id }: { id: number }) {
  return (
    <Formulario accion={borrarMovimiento}>
      <input type="hidden" name="movimiento_id" value={id} />
      <BotonEnviar variante="secundario" className="min-h-9 px-2 py-1.5 text-red-600" aria-label="Borrar movimiento"
        onClick={(e) => { if (!confirm("¿Borrar este movimiento?")) e.preventDefault(); }}>
        <Trash2 className="size-4" aria-hidden />
      </BotonEnviar>
    </Formulario>
  );
}
