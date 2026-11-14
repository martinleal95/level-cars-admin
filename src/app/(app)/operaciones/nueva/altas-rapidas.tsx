"use client";

import { useState, useTransition } from "react";
import { PackagePlus, UserPlus } from "lucide-react";
import { Dialogo } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { EntradaImporte, EntradaPatente } from "@/components/entradas";
import { parsearNumero } from "@/lib/numero";
import type { Moneda } from "@/lib/formato";
import { crearBienRapido, crearPersonaRapida } from "../acciones";
import type { BienDisponible } from "./asistente";

type Opcion = { id: number; nombre: string };
type Origen = "compra" | "consignacion" | "intermediacion";

/** Estas altas viven dentro del formulario de la venta: sin <form> propio y sin que Enter envíe la venta. */
const sinEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault(); };

function Fallo({ texto }: { texto: string }) {
  return texto ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700">{texto}</p> : null;
}

/** Alta rápida de un cliente (nombre, contacto y canal por el que llegó) o de un referido (nombre y contacto). */
export function NuevoClienteRapido({ canales, rol = "cliente", onCreado }: {
  canales: Opcion[]; rol?: "cliente" | "referido"; onCreado: (persona: Opcion, canalId: string) => void;
}) {
  const titulo = rol === "referido" ? "Referido nuevo" : "Cliente nuevo";
  return (
    <Dialogo boton={titulo} titulo={titulo} variante="secundario" icono={<UserPlus className="size-5" aria-hidden />}>
      {(cerrar) => <FormCliente canales={canales} rol={rol} onCreado={(p, c) => { onCreado(p, c); cerrar(); }} />}
    </Dialogo>
  );
}

function FormCliente({ canales, rol, onCreado }: { canales: Opcion[]; rol: "cliente" | "referido"; onCreado: (p: Opcion, canalId: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [canal, setCanal] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await crearPersonaRapida({ nombre, telefono, rol });
      if (!r.ok) return setError(r.error);
      onCreado({ id: r.id, nombre: r.nombre }, canal);
    });
  }

  return (
    <div className="space-y-4" onKeyDown={sinEnter}>
      <Campo etiqueta="Nombre y apellido" htmlFor="rc_nombre">
        <input id="rc_nombre" className="campo" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </Campo>
      <Campo etiqueta="Teléfono / WhatsApp" htmlFor="rc_tel">
        <input id="rc_tel" type="tel" className="campo" value={telefono} maxLength={40} onChange={(e) => setTelefono(e.target.value)} />
      </Campo>
      {rol === "cliente" && (
        <Campo etiqueta="Canal por el que llegó" htmlFor="rc_canal">
          <select id="rc_canal" className="campo" value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option value="">Sin indicar</option>
            {canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
      )}
      <Fallo texto={error} />
      <button type="button" className="btn-primario w-full" disabled={pendiente || !nombre.trim()} onClick={guardar}>
        {pendiente ? "Guardando..." : rol === "referido" ? "Guardar y agregar su comisión" : "Guardar y usar en la venta"}
      </button>
    </div>
  );
}

/** Alta rápida de un bien: lo mínimo para venderlo (el resto se completa después en Stock). */
export function NuevoBienRapido({ personas, onCreado }: {
  personas: Opcion[]; onCreado: (bien: BienDisponible, dueno: Opcion | null) => void;
}) {
  return (
    <Dialogo boton="Agregar un bien nuevo" titulo="Bien nuevo" variante="secundario" icono={<PackagePlus className="size-5" aria-hidden />}>
      {(cerrar) => <FormBien personas={personas} onCreado={(b, d) => { onCreado(b, d); cerrar(); }} />}
    </Dialogo>
  );
}

function FormBien({ personas, onCreado }: { personas: Opcion[]; onCreado: (b: BienDisponible, d: Opcion | null) => void }) {
  const [tipo, setTipo] = useState("auto");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [dominio, setDominio] = useState("");
  const [origen, setOrigen] = useState<Origen>("intermediacion");
  const [enAgencia, setEnAgencia] = useState(false);
  const [moneda, setMoneda] = useState<Moneda>("USD");
  const [costo, setCosto] = useState("");
  const [acordado, setAcordado] = useState("");
  const [precioPub, setPrecioPub] = useState("");
  const [duenoId, setDuenoId] = useState("");
  const [duenoNombre, setDuenoNombre] = useState("");
  const [duenoTel, setDuenoTel] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();
  const terceros = origen !== "compra";
  const duenoNuevo = terceros && duenoId === "nuevo";

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await crearBienRapido({
        tipo, marca, modelo, anio, dominio, origen, moneda, en_agencia: enAgencia,
        costo: terceros ? "" : costo, precio_publicado: precioPub,
        dueno_id: terceros && !duenoNuevo ? duenoId : "",
        dueno_nuevo: duenoNuevo ? { nombre: duenoNombre, telefono: duenoTel } : null,
        monto_acordado: terceros ? acordado : "",
      });
      if (!r.ok) return setError(r.error);
      const num = (v: string) => { const x = parsearNumero(v); return Number.isFinite(x) ? x : 0; };
      onCreado({
        id: r.id, marca: marca.trim(), modelo: modelo.trim(), anio: anio ? Number(anio) : null, dominio: dominio ? dominio.toUpperCase() : null,
        origen, costo: terceros ? 0 : num(costo), moneda, precio_publicado: precioPub ? num(precioPub) : null,
        monto_acordado: terceros ? num(acordado) : null, acuerdo_moneda: moneda, gastos: { ARS: 0, USD: 0 }, reserva: null,
      }, r.dueno ? { id: r.dueno.id, nombre: r.dueno.nombre } : null);
    });
  }

  const listo = !!marca.trim() && !!modelo.trim() && (!terceros || (acordado.trim() !== "" && (duenoNuevo ? !!duenoNombre.trim() : !!duenoId)));

  return (
    <div className="space-y-4" onKeyDown={sinEnter}>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Tipo" htmlFor="rb_tipo">
          <select id="rb_tipo" className="campo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="auto">Auto</option><option value="moto">Moto</option><option value="celular">Celular</option><option value="otro">Otro</option>
          </select>
        </Campo>
        <Campo etiqueta="Año" htmlFor="rb_anio">
          <input id="rb_anio" inputMode="numeric" className="campo" value={anio} maxLength={4} onChange={(e) => setAnio(e.target.value.replace(/\D/g, ""))} />
        </Campo>
        <Campo etiqueta="Marca" htmlFor="rb_marca">
          <input id="rb_marca" className="campo" value={marca} maxLength={60} placeholder="Ej: Toyota" onChange={(e) => setMarca(e.target.value)} autoFocus />
        </Campo>
        <Campo etiqueta="Modelo" htmlFor="rb_modelo">
          <input id="rb_modelo" className="campo" value={modelo} maxLength={80} placeholder="Ej: Corolla" onChange={(e) => setModelo(e.target.value)} />
        </Campo>
        <Campo etiqueta="Patente o IMEI" htmlFor="rb_dom" className="col-span-2">
          <EntradaPatente id="rb_dom" className="campo" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="ABC-123 o AB-123-CD" />
        </Campo>
      </div>

      <fieldset>
        <legend className="etiqueta">¿De quién es?</legend>
        <select aria-label="Origen del bien" className="campo" value={origen}
          onChange={(e) => { const o = e.target.value as Origen; setOrigen(o); if (o === "compra") setEnAgencia(true); }}>
          <option value="compra">Propio (lo compró la agencia)</option>
          <option value="consignacion">Consignación (de un dueño)</option>
          <option value="intermediacion">Intermediación (de otra agencia o particular)</option>
        </select>
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="size-5 accent-naranja-500" checked={!enAgencia} disabled={origen === "compra"} onChange={(e) => setEnAgencia(!e.target.checked)} />
        No está en la agencia (se ofrece por redes u otros canales)
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Moneda" htmlFor="rb_moneda">
          <select id="rb_moneda" className="campo" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
            <option value="USD">Dólares (US$)</option><option value="ARS">Pesos ($)</option>
          </select>
        </Campo>
        <Campo etiqueta="Precio publicado" htmlFor="rb_precio">
          <EntradaImporte id="rb_precio" className="campo cifra" value={precioPub} onChange={(e) => setPrecioPub(e.target.value)} />
        </Campo>
        {!terceros ? (
          <Campo etiqueta="Costo de compra" htmlFor="rb_costo" className="col-span-2">
            <EntradaImporte id="rb_costo" className="campo cifra" value={costo} onChange={(e) => setCosto(e.target.value)} />
          </Campo>
        ) : (
          <>
            <Campo etiqueta={origen === "consignacion" ? "Dueño" : "Agenciero o dueño"} htmlFor="rb_dueno">
              <select id="rb_dueno" className="campo" value={duenoId} onChange={(e) => setDuenoId(e.target.value)}>
                <option value="" disabled>Elegí</option>
                <option value="nuevo">+ Persona nueva</option>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Monto acordado" htmlFor="rb_acordado" ayuda="Lo que se le paga al venderlo.">
              <EntradaImporte id="rb_acordado" className="campo cifra" value={acordado} onChange={(e) => setAcordado(e.target.value)} />
            </Campo>
            {duenoNuevo && (
              <>
                <Campo etiqueta="Nombre del dueño" htmlFor="rb_dn">
                  <input id="rb_dn" className="campo" value={duenoNombre} maxLength={120} onChange={(e) => setDuenoNombre(e.target.value)} />
                </Campo>
                <Campo etiqueta="Teléfono del dueño" htmlFor="rb_dt">
                  <input id="rb_dt" type="tel" className="campo" value={duenoTel} maxLength={40} onChange={(e) => setDuenoTel(e.target.value)} />
                </Campo>
              </>
            )}
          </>
        )}
      </div>
      <p className="ayuda">Fotos y el resto de los datos los completás después desde Stock.</p>
      <Fallo texto={error} />
      <button type="button" className="btn-primario w-full" disabled={pendiente || !listo} onClick={guardar}>
        {pendiente ? "Guardando..." : "Guardar y usar en la venta"}
      </button>
    </div>
  );
}
