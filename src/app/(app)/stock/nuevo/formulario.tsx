"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Handshake, Repeat, Save } from "lucide-react";
import { Formulario, BotonEnviar } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { crearBien } from "../acciones";

type Persona = { id: number; nombre: string };
const ORIGENES = [
  { valor: "compra", titulo: "Propio", texto: "La agencia lo compró", icono: Building2 },
  { valor: "consignacion", titulo: "Consignación", texto: "De un dueño, está en la agencia", icono: Handshake },
  { valor: "intermediacion", titulo: "Intermediación", texto: "De otro agenciero, se cobra comisión", icono: Repeat },
] as const;

export function FormularioBien({ personas, hoy }: { personas: Persona[]; hoy: string }) {
  const [origen, setOrigen] = useState<(typeof ORIGENES)[number]["valor"]>("compra");
  const terceros = origen !== "compra";

  return (
    <Formulario accion={crearBien} className="space-y-6">
      <fieldset className="tarjeta p-4 sm:p-6">
        <legend className="sr-only">Origen del bien</legend>
        <p className="mb-3 text-lg font-bold">¿De quién es?</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {ORIGENES.map((o) => (
            <label key={o.valor}
              className={`flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-2 transition ${
                origen === o.valor ? "bg-naranja-50 ring-naranja-500" : "ring-acero-200 hover:ring-acero-300"
              }`}>
              <input type="radio" name="origen" value={o.valor} checked={origen === o.valor}
                onChange={() => setOrigen(o.valor)} className="sr-only" />
              <o.icono className={`mt-0.5 size-6 shrink-0 ${origen === o.valor ? "text-naranja-600" : "text-acero-400"}`} aria-hidden />
              <span>
                <span className="block font-bold">{o.titulo}</span>
                <span className="block text-sm text-acero-500">{o.texto}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="tarjeta grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        <p className="text-lg font-bold sm:col-span-2 lg:col-span-3">Datos del bien</p>
        <Campo etiqueta="Tipo" htmlFor="tipo">
          <select id="tipo" name="tipo" className="campo" defaultValue="auto" required>
            <option value="auto">Auto</option><option value="moto">Moto</option>
            <option value="celular">Celular</option><option value="otro">Otro</option>
          </select>
        </Campo>
        <Campo etiqueta="Marca" htmlFor="marca">
          <input id="marca" name="marca" className="campo" required maxLength={60} placeholder="Ej: Toyota" />
        </Campo>
        <Campo etiqueta="Modelo" htmlFor="modelo">
          <input id="modelo" name="modelo" className="campo" required maxLength={80} placeholder="Ej: Corolla" />
        </Campo>
        <Campo etiqueta="Versión" htmlFor="version">
          <input id="version" name="version" className="campo" maxLength={80} placeholder="Ej: XEI 2.0 CVT" />
        </Campo>
        <Campo etiqueta="Año" htmlFor="anio">
          <input id="anio" name="anio" type="number" inputMode="numeric" min={1900} max={2100} className="campo" />
        </Campo>
        <Campo etiqueta="Patente o IMEI" htmlFor="dominio">
          <input id="dominio" name="dominio" className="campo uppercase" maxLength={40} />
        </Campo>
        <Campo etiqueta="Kilometraje" htmlFor="kilometraje">
          <input id="kilometraje" name="kilometraje" type="number" inputMode="numeric" min={0} className="campo" />
        </Campo>
        <Campo etiqueta="Color" htmlFor="color">
          <input id="color" name="color" className="campo" maxLength={40} />
        </Campo>
        <Campo etiqueta="Fecha de ingreso" htmlFor="fecha_ingreso">
          <input id="fecha_ingreso" name="fecha_ingreso" type="date" defaultValue={hoy} max={hoy} className="campo" />
        </Campo>
      </section>

      <section className="tarjeta grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        <p className="text-lg font-bold sm:col-span-2 lg:col-span-3">Precios</p>
        <Campo etiqueta="Moneda" htmlFor="moneda">
          <select id="moneda" name="moneda" className="campo" defaultValue="USD">
            <option value="USD">Dólares (US$)</option><option value="ARS">Pesos ($)</option>
          </select>
        </Campo>
        {!terceros && (
          <Campo etiqueta="Costo de compra" htmlFor="costo" ayuda="Lo que pagó la agencia por el bien.">
            <input id="costo" name="costo" inputMode="decimal" className="campo cifra" placeholder="0" />
          </Campo>
        )}
        <Campo etiqueta="Precio publicado" htmlFor="precio_publicado">
          <input id="precio_publicado" name="precio_publicado" inputMode="decimal" className="campo cifra" placeholder="0" />
        </Campo>
        {!terceros && (
          <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-3">
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input type="checkbox" name="registrar_egreso" className="size-5 accent-naranja-500" />
              Registrar la compra como egreso de caja
            </label>
            <select name="medio" className="campo max-w-xs" defaultValue="efectivo" aria-label="Medio de pago de la compra">
              <option value="efectivo">Pagado en efectivo</option><option value="banco">Pagado por banco</option>
            </select>
          </div>
        )}
      </section>

      {terceros && (
        <section className="tarjeta grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
          <p className="text-lg font-bold sm:col-span-2 lg:col-span-3">
            Acuerdo con el {origen === "consignacion" ? "dueño" : "agenciero"}
          </p>
          <Campo etiqueta={origen === "consignacion" ? "Dueño" : "Agenciero"} htmlFor="dueno_id"
            ayuda={personas.length ? undefined : "Primero cargalo en Personas."}>
            <select id="dueno_id" name="dueno_id" className="campo" required defaultValue="">
              <option value="" disabled>Elegí una persona</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Monto que espera recibir" htmlFor="monto_acordado"
            ayuda="Lo que se le paga al dueño cuando se vende.">
            <input id="monto_acordado" name="monto_acordado" inputMode="decimal" required className="campo cifra" />
          </Campo>
          <Campo etiqueta="Vence el" htmlFor="vence_el"
            ayuda={origen === "consignacion" ? "Si lo dejás vacío se usa el plazo de Configuración." : "Opcional."}>
            <input id="vence_el" name="vence_el" type="date" min={hoy} className="campo" />
          </Campo>
          <Campo etiqueta="Comisión pactada" htmlFor="comision_base"
            ayuda={origen === "consignacion" ? "Para cuando la venta sale por debajo del monto acordado." : "Lo que cobra la agencia."}>
            <select id="comision_base" name="comision_base" className="campo" defaultValue="">
              <option value="">Sin definir</option>
              <option value="fijo">Monto fijo</option>
              <option value="pct_precio">% del precio</option>
            </select>
          </Campo>
          <Campo etiqueta="Valor de la comisión" htmlFor="comision_valor">
            <input id="comision_valor" name="comision_valor" inputMode="decimal" className="campo cifra" />
          </Campo>
        </section>
      )}

      <section className="tarjeta p-4 sm:p-6">
        <Campo etiqueta="Notas" htmlFor="notas">
          <textarea id="notas" name="notas" rows={3} maxLength={2000} className="campo" placeholder="Estado, detalles, service, etc." />
        </Campo>
      </section>

      <div className="sticky bottom-20 z-10 flex justify-end gap-3 lg:bottom-4">
        <Link href="/stock" className="btn-secundario">Cancelar</Link>
        <BotonEnviar className="shadow-lg"><Save className="size-5" aria-hidden /> Guardar bien</BotonEnviar>
      </div>
    </Formulario>
  );
}
