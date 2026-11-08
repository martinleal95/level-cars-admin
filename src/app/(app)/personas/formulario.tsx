"use client";

import { Save, UserPlus } from "lucide-react";
import { Formulario, BotonEnviar, Dialogo } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { guardarPersona } from "./acciones";

export type Persona = {
  id?: number; nombre?: string; telefono?: string | null; dni?: string | null; email?: string | null; notas?: string | null;
  es_cliente?: boolean; es_dueno?: boolean; es_vendedor?: boolean; es_referido?: boolean; es_agenciero?: boolean;
};

const ROLES = [
  ["es_cliente", "Cliente"], ["es_dueno", "Dueño (consignación)"], ["es_agenciero", "Agenciero"],
  ["es_vendedor", "Vendedor"], ["es_referido", "Referido"],
] as const;

function Campos({ p, cerrar }: { p: Persona; cerrar: () => void }) {
  const k = p.id ?? "nueva";
  return (
    <Formulario accion={guardarPersona} alGuardar={cerrar} className="space-y-4">
      {p.id && <input type="hidden" name="id" value={p.id} />}
      <Campo etiqueta="Nombre y apellido" htmlFor={`n_${k}`}>
        <input id={`n_${k}`} name="nombre" defaultValue={p.nombre} required maxLength={120} className="campo" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Teléfono" htmlFor={`t_${k}`}>
          <input id={`t_${k}`} name="telefono" type="tel" defaultValue={p.telefono ?? ""} maxLength={40} className="campo" />
        </Campo>
        <Campo etiqueta="DNI" htmlFor={`d_${k}`}>
          <input id={`d_${k}`} name="dni" inputMode="numeric" defaultValue={p.dni ?? ""} maxLength={20} className="campo" />
        </Campo>
      </div>
      <Campo etiqueta="Email" htmlFor={`e_${k}`}>
        <input id={`e_${k}`} name="email" type="email" defaultValue={p.email ?? ""} maxLength={120} className="campo" />
      </Campo>
      <fieldset>
        <legend className="etiqueta">Rol</legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map(([campo, label]) => (
            <label key={campo} className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-acero-300 has-[:checked]:bg-naranja-50 has-[:checked]:text-naranja-700 has-[:checked]:ring-naranja-500">
              <input type="checkbox" name={campo} defaultChecked={p[campo]} className="accent-naranja-500" /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Campo etiqueta="Notas" htmlFor={`no_${k}`}>
        <textarea id={`no_${k}`} name="notas" rows={2} defaultValue={p.notas ?? ""} maxLength={2000} className="campo" />
      </Campo>
      <BotonEnviar className="w-full"><Save className="size-5" aria-hidden /> Guardar</BotonEnviar>
    </Formulario>
  );
}

export function NuevaPersona() {
  return (
    <Dialogo boton="Agregar persona" titulo="Nueva persona" variante="primario" icono={<UserPlus className="size-5" aria-hidden />}>
      {(cerrar) => <Campos p={{ es_cliente: true }} cerrar={cerrar} />}
    </Dialogo>
  );
}

export function EditarPersona({ persona }: { persona: Persona }) {
  return (
    <Dialogo boton="Editar" titulo={`Editar a ${persona.nombre}`} variante="secundario">
      {(cerrar) => <Campos p={persona} cerrar={cerrar} />}
    </Dialogo>
  );
}
