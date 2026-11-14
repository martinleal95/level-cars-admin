"use client";

import { useRef, useState } from "react";
import { CalendarClock, Trash2, Undo2, Ban, Save, Receipt, Upload } from "lucide-react";
import { Formulario, BotonEnviar, Dialogo } from "@/components/formulario";
import { EntradaImporte, EntradaPatente } from "@/components/entradas";
import { Campo } from "@/components/ui";
import { SelectorFotos } from "@/components/selector-fotos";
import {
  reservarBien, cerrarReserva, retirarBien, subirFoto, borrarFoto, cargarGasto, editarBien, editarAcuerdo,
  cambiarOrigenBien, borrarBien,
} from "../acciones";

type Persona = { id: number; nombre: string };
type Motivo = { id: number; nombre: string };

export function BotonReservar({ bienId, clientes, moneda, venceSugerido, hoy }: {
  bienId: number; clientes: Persona[]; moneda: string; venceSugerido: string; hoy: string;
}) {
  return (
    <Dialogo boton="Reservar con seña" titulo="Reservar con seña" variante="aviso"
      icono={<CalendarClock className="size-5" aria-hidden />}>
      {(cerrar) => (
        <Formulario accion={reservarBien} alGuardar={cerrar} className="space-y-4">
          <input type="hidden" name="bien_id" value={bienId} />
          <Campo etiqueta="Cliente" htmlFor="r_cliente" ayuda={clientes.length ? undefined : "Primero cargá el cliente en Personas."}>
            <select id="r_cliente" name="cliente_id" className="campo" required defaultValue="">
              <option value="" disabled>Elegí el cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Seña" htmlFor="r_monto">
              <EntradaImporte id="r_monto" name="monto" required className="campo cifra" />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor="r_moneda">
              <select id="r_moneda" name="moneda" defaultValue={moneda} className="campo">
                <option value="USD">US$</option><option value="ARS">$</option>
              </select>
            </Campo>
            <Campo etiqueta="Cobrada en" htmlFor="r_medio">
              <select id="r_medio" name="medio" className="campo"><option value="efectivo">Efectivo</option><option value="banco">Banco</option></select>
            </Campo>
            <Campo etiqueta="Vence el" htmlFor="r_vence">
              <input id="r_vence" name="vence_el" type="date" min={hoy} defaultValue={venceSugerido} className="campo" />
            </Campo>
          </div>
          <BotonEnviar variante="aviso" className="w-full">Confirmar reserva</BotonEnviar>
        </Formulario>
      )}
    </Dialogo>
  );
}

export function BotonCerrarReserva({ bienId, reservaId }: { bienId: number; reservaId: number }) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <Dialogo boton="La venta no se concretó" titulo="Cerrar la reserva" variante="secundario"
      icono={<Undo2 className="size-5" aria-hidden />}>
      {(cerrar) => (
        <Formulario accion={cerrarReserva} alGuardar={cerrar} className="space-y-4">
          <input type="hidden" name="bien_id" value={bienId} />
          <input type="hidden" name="reserva_id" value={reservaId} />
          <Campo etiqueta="¿Qué pasa con la seña?" htmlFor="c_res">
            <select id="c_res" name="resultado" ref={ref} className="campo" defaultValue="retenida">
              <option value="retenida">Queda para la agencia</option>
              <option value="devuelta_parcial">Se devuelve una parte</option>
              <option value="devuelta_total">Se devuelve completa</option>
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto devuelto" htmlFor="c_dev" ayuda="Solo si se devuelve una parte.">
              <EntradaImporte id="c_dev" name="monto_devuelto" className="campo cifra" />
            </Campo>
            <Campo etiqueta="Devuelto por" htmlFor="c_medio">
              <select id="c_medio" name="medio" className="campo"><option value="efectivo">Efectivo</option><option value="banco">Banco</option></select>
            </Campo>
          </div>
          <Campo etiqueta="Motivo" htmlFor="c_motivo">
            <textarea id="c_motivo" name="motivo" required maxLength={500} rows={2} className="campo" />
          </Campo>
          <BotonEnviar className="w-full">Cerrar reserva</BotonEnviar>
        </Formulario>
      )}
    </Dialogo>
  );
}

export function BotonRetirar({ bienId, tercero }: { bienId: number; tercero: boolean }) {
  return (
    <Dialogo boton="Retirar" titulo="Retirar del stock" variante="peligro" icono={<Ban className="size-5" aria-hidden />}>
      {(cerrar) => (
        <Formulario accion={retirarBien} alGuardar={cerrar} className="space-y-4">
          <input type="hidden" name="bien_id" value={bienId} />
          <p className="text-sm text-acero-500">
            {tercero ? "El dueño se lleva el bien y el acuerdo queda cerrado." : "El bien sale del stock sin una venta."} Esta acción no se puede deshacer.
          </p>
          <Campo etiqueta="Motivo" htmlFor="ret_motivo">
            <textarea id="ret_motivo" name="motivo" required maxLength={500} rows={2} className="campo" />
          </Campo>
          <BotonEnviar variante="peligro" className="w-full">Retirar definitivamente</BotonEnviar>
        </Formulario>
      )}
    </Dialogo>
  );
}

export function SubirFoto({ bienId }: { bienId: number }) {
  return (
    <Formulario accion={subirFoto} limpiar className="space-y-3">
      <input type="hidden" name="bien_id" value={bienId} />
      <SelectorFotos compacto />
      <BotonEnviar><Upload className="size-5" aria-hidden /> Subir fotos</BotonEnviar>
    </Formulario>
  );
}

export function BorrarFoto({ fotoId }: { fotoId: number }) {
  return (
    <Formulario accion={borrarFoto}>
      <input type="hidden" name="foto_id" value={fotoId} />
      <BotonEnviar variante="peligro" className="min-h-0 p-2" aria-label="Borrar foto"
        onClick={(e) => { if (!confirm("¿Borrar esta foto?")) e.preventDefault(); }}>
        <Trash2 className="size-4" aria-hidden />
      </BotonEnviar>
    </Formulario>
  );
}

export function FormularioGasto({ bienId, motivos, moneda, hoy }: {
  bienId: number; motivos: Motivo[]; moneda: string; hoy: string;
}) {
  return (
    <Formulario accion={cargarGasto} limpiar className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="bien_id" value={bienId} />
      <Campo etiqueta="Concepto" htmlFor="g_motivo">
        <select id="g_motivo" name="motivo_id" required className="campo" defaultValue="">
          <option value="" disabled>Elegí</option>
          {motivos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Campo etiqueta="Monto" htmlFor="g_monto">
          <EntradaImporte id="g_monto" name="monto" required className="campo cifra" />
        </Campo>
        <Campo etiqueta="Moneda" htmlFor="g_moneda">
          <select id="g_moneda" name="moneda" defaultValue={moneda === "USD" ? "ARS" : moneda} className="campo">
            <option value="ARS">$</option><option value="USD">US$</option>
          </select>
        </Campo>
      </div>
      <Campo etiqueta="Pagado por" htmlFor="g_medio">
        <select id="g_medio" name="medio" className="campo"><option value="efectivo">Efectivo</option><option value="banco">Banco</option></select>
      </Campo>
      <Campo etiqueta="Fecha" htmlFor="g_fecha">
        <input id="g_fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} className="campo" />
      </Campo>
      <Campo etiqueta="Detalle" htmlFor="g_desc" className="sm:col-span-2">
        <input id="g_desc" name="descripcion" maxLength={500} className="campo" placeholder="Ej: cambio de cubiertas" />
      </Campo>
      <div className="sm:col-span-2">
        <BotonEnviar><Receipt className="size-5" aria-hidden /> Cargar gasto</BotonEnviar>
      </div>
    </Formulario>
  );
}

type BienEditable = {
  id: number; tipo: string; marca: string; modelo: string; version: string | null; anio: number | null;
  dominio: string | null; kilometraje: number | null; color: string | null; precio_publicado: number | null;
  notas: string | null; costo: number; origen: string; en_agencia: boolean;
};

export function FormularioEditar({ bien }: { bien: BienEditable }) {
  const propio = bien.origen === "compra" || bien.origen === "parte_pago";
  return (
    <Formulario accion={editarBien} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="id" value={bien.id} />
      <input type="hidden" name="tipo" value={bien.tipo} />
      <Campo etiqueta="Marca" htmlFor="e_marca"><input id="e_marca" name="marca" defaultValue={bien.marca} required maxLength={60} className="campo" /></Campo>
      <Campo etiqueta="Modelo" htmlFor="e_modelo"><input id="e_modelo" name="modelo" defaultValue={bien.modelo} required maxLength={80} className="campo" /></Campo>
      <Campo etiqueta="Versión" htmlFor="e_version"><input id="e_version" name="version" defaultValue={bien.version ?? ""} maxLength={80} className="campo" /></Campo>
      <Campo etiqueta="Año" htmlFor="e_anio"><input id="e_anio" name="anio" type="number" defaultValue={bien.anio ?? ""} className="campo" /></Campo>
      <Campo etiqueta="Patente o IMEI" htmlFor="e_dom"><EntradaPatente id="e_dom" name="dominio" inicial={bien.dominio} className="campo" /></Campo>
      <Campo etiqueta="Kilometraje" htmlFor="e_km"><input id="e_km" name="kilometraje" type="number" defaultValue={bien.kilometraje ?? ""} className="campo" /></Campo>
      <Campo etiqueta="Color" htmlFor="e_color"><input id="e_color" name="color" defaultValue={bien.color ?? ""} maxLength={40} className="campo" /></Campo>
      <Campo etiqueta="Precio publicado" htmlFor="e_precio"><EntradaImporte id="e_precio" name="precio_publicado" inicial={bien.precio_publicado} className="campo cifra" /></Campo>
      {propio && (
        <Campo etiqueta="Costo" htmlFor="e_costo"><EntradaImporte id="e_costo" name="costo" inicial={bien.costo} className="campo cifra" /></Campo>
      )}
      <Campo etiqueta="¿Dónde está?" htmlFor="e_ubic">
        <select id="e_ubic" name="en_agencia" defaultValue={String(bien.en_agencia)} className="campo">
          <option value="true">En la agencia</option><option value="false">Fuera de la agencia</option>
        </select>
      </Campo>
      <Campo etiqueta="Notas" htmlFor="e_notas" className="sm:col-span-2 lg:col-span-3">
        <textarea id="e_notas" name="notas" rows={3} maxLength={2000} defaultValue={bien.notas ?? ""} className="campo" />
      </Campo>
      <div className="sm:col-span-2 lg:col-span-3">
        <BotonEnviar><Save className="size-5" aria-hidden /> Guardar cambios</BotonEnviar>
      </div>
    </Formulario>
  );
}

export function FormularioAcuerdo({ bienId, acuerdo, hoy }: {
  bienId: number; hoy: string;
  acuerdo: { monto_acordado: number; vence_el: string | null; comision_base: string | null; comision_valor: number | null };
}) {
  return (
    <Formulario accion={editarAcuerdo} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="bien_id" value={bienId} />
      <Campo etiqueta="Monto acordado" htmlFor="a_monto"><EntradaImporte id="a_monto" name="monto_acordado" inicial={acuerdo.monto_acordado} required className="campo cifra" /></Campo>
      <Campo etiqueta="Vence el" htmlFor="a_vence"><input id="a_vence" name="vence_el" type="date" min={hoy} defaultValue={acuerdo.vence_el ?? ""} className="campo" /></Campo>
      <Campo etiqueta="Comisión" htmlFor="a_base">
        <select id="a_base" name="comision_base" defaultValue={acuerdo.comision_base ?? ""} className="campo">
          <option value="">Sin definir</option><option value="fijo">Monto fijo</option><option value="pct_precio">% del precio</option>
        </select>
      </Campo>
      <Campo etiqueta="Valor" htmlFor="a_valor"><EntradaImporte id="a_valor" name="comision_valor" inicial={acuerdo.comision_valor} className="campo cifra" /></Campo>
      <div className="sm:col-span-2"><BotonEnviar variante="secundario"><Save className="size-5" aria-hidden /> Actualizar acuerdo</BotonEnviar></div>
    </Formulario>
  );
}

type Origen = "compra" | "consignacion" | "intermediacion";

export function FormularioOrigen({ bienId, origen, moneda, costo, duenoId, montoAcordado, personas }: {
  bienId: number; origen: string; moneda: string; costo: number; duenoId: number | null; montoAcordado: number | null; personas: Persona[];
}) {
  const [nuevo, setNuevo] = useState<Origen>(origen as Origen);
  const simbolo = moneda === "USD" ? "US$" : "$";
  return (
    <Formulario accion={cambiarOrigenBien} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="bien_id" value={bienId} />
      <Campo etiqueta="Origen correcto" htmlFor="o_origen" className="sm:col-span-2">
        <select id="o_origen" name="origen" className="campo" value={nuevo} onChange={(e) => setNuevo(e.target.value as Origen)}>
          <option value="compra">Propio (lo compró la agencia)</option>
          <option value="consignacion">Consignación (de un dueño)</option>
          <option value="intermediacion">Intermediación (de otro agenciero)</option>
        </select>
      </Campo>
      {nuevo === "compra" ? (
        <>
          <Campo etiqueta={`Costo de compra (${simbolo})`} htmlFor="o_costo">
            <EntradaImporte id="o_costo" name="costo" inicial={origen === "compra" ? costo : null} required className="campo cifra" />
          </Campo>
          {origen !== "compra" && (
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input type="checkbox" name="registrar_egreso" className="size-5 accent-naranja-500" /> Registrar la compra en caja
              </label>
              <select name="medio" className="campo" defaultValue="efectivo" aria-label="Medio de pago de la compra">
                <option value="efectivo">Pagado en efectivo</option><option value="banco">Pagado por banco</option>
              </select>
            </div>
          )}
        </>
      ) : (
        <>
          <Campo etiqueta={nuevo === "consignacion" ? "Dueño" : "Agenciero"} htmlFor="o_dueno" ayuda={personas.length ? undefined : "Primero cargalo en Personas."}>
            <select id="o_dueno" name="dueno_id" className="campo" required defaultValue={duenoId ?? ""}>
              <option value="" disabled>Elegí una persona</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={`Monto acordado (${simbolo})`} htmlFor="o_monto" ayuda="Lo que se le paga cuando se vende.">
            <EntradaImporte id="o_monto" name="monto_acordado" inicial={montoAcordado} required className="campo cifra" />
          </Campo>
          {origen === "compra" && <p className="text-sm text-acero-500 sm:col-span-2">Si la compra se había registrado en caja, ese egreso se anula.</p>}
        </>
      )}
      <div className="sm:col-span-2">
        <BotonEnviar disabled={nuevo === origen}
          onClick={(e) => { if (!confirm(origen === "compra" ? "El bien deja de ser propio. Si su compra estaba registrada en caja, ese egreso se anula. ¿Guardar?" : "Se cambia de quién es el bien y el acuerdo con su dueño. ¿Guardar?")) e.preventDefault(); }}>
          <Save className="size-5" aria-hidden /> Guardar origen
        </BotonEnviar>
      </div>
    </Formulario>
  );
}

export function BotonBorrarBien({ bienId }: { bienId: number }) {
  return (
    <Dialogo boton="Borrar bien" titulo="Borrar este bien" variante="peligro" icono={<Trash2 className="size-5" aria-hidden />}>
      {() => (
        <Formulario accion={borrarBien} className="space-y-4">
          <input type="hidden" name="bien_id" value={bienId} />
          <p className="text-sm text-acero-500">
            Se borra el bien con sus fotos y, si se había registrado, el egreso de caja por su compra: queda como si nunca
            se hubiera cargado. Usalo solo si fue un error de carga:
            si el bien existió y se fue, usá «Retirar». No se puede deshacer.
          </p>
          <BotonEnviar variante="peligro" className="w-full">Borrar definitivamente</BotonEnviar>
        </Formulario>
      )}
    </Dialogo>
  );
}
