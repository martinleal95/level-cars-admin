"use client";

import { Plus, Save, Eye, EyeOff } from "lucide-react";
import { Formulario, BotonEnviar } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { guardarConfiguracion, agregarItem, alternarItem } from "./acciones";

type Config = { plazo_consignacion_dias: number; dias_reserva: number; dias_alerta_stock: number; dias_alerta_financiacion: number };

export function FormConfig({ c }: { c: Config }) {
  const campos: [keyof Config, string, string][] = [
    ["plazo_consignacion_dias", "Plazo de consignación (días)", "Se usa si no ponés otra fecha al cargar el auto."],
    ["dias_reserva", "Duración de una reserva (días)", "Fecha límite sugerida para concretar."],
    ["dias_alerta_stock", "Alerta de stock antiguo (días)", "Avisa cuando un bien propio lleva mucho tiempo."],
    ["dias_alerta_financiacion", "Alerta de financiación sin cobrar (días)", "Avisa si la financiera no pagó."],
  ];
  return (
    <Formulario accion={guardarConfiguracion} className="grid gap-4 sm:grid-cols-2">
      {campos.map(([k, l, a]) => (
        <Campo key={k} etiqueta={l} htmlFor={k} ayuda={a}>
          <input id={k} name={k} type="number" min={1} defaultValue={c[k]} required className="campo cifra" />
        </Campo>
      ))}
      <div className="sm:col-span-2"><BotonEnviar><Save className="size-5" aria-hidden /> Guardar</BotonEnviar></div>
    </Formulario>
  );
}

export function AgregarItem({ tabla, placeholder }: { tabla: "canales" | "financieras" | "motivos_caja"; placeholder: string }) {
  return (
    <Formulario accion={agregarItem} limpiar className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tabla" value={tabla} />
      <input name="nombre" required maxLength={80} placeholder={placeholder} className="campo min-w-48 flex-1" aria-label={placeholder} />
      {tabla === "motivos_caja" && (
        <>
          <select name="tipo" className="campo w-auto" aria-label="Tipo"><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="es_gasto_fijo" className="size-5 accent-naranja-500" /> Gasto fijo</label>
        </>
      )}
      {tabla === "financieras" && (
        <>
          <select name="comision_base" className="campo w-auto" aria-label="Comisión habitual">
            <option value="">Sin comisión</option><option value="pct_precio">% del precio</option><option value="fijo">Monto fijo</option>
          </select>
          <input name="comision_valor" inputMode="decimal" placeholder="Valor" className="campo w-24" aria-label="Valor de la comisión" />
        </>
      )}
      <BotonEnviar><Plus className="size-5" aria-hidden /> Agregar</BotonEnviar>
    </Formulario>
  );
}

export function Alternar({ tabla, id, activo }: { tabla: string; id: number; activo: boolean }) {
  return (
    <Formulario accion={alternarItem}>
      <input type="hidden" name="tabla" value={tabla} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={String(!activo)} />
      <BotonEnviar variante="secundario" className="min-h-9 px-3 py-1.5" aria-label={activo ? "Ocultar" : "Mostrar"}>
        {activo ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {activo ? "Ocultar" : "Mostrar"}
      </BotonEnviar>
    </Formulario>
  );
}
