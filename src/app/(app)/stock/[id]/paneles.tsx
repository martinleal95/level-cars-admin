"use client";

import { useRef } from "react";
import { CalendarClock, Trash2, Undo2, Ban, Save, Receipt, Upload } from "lucide-react";
import { Formulario, BotonEnviar, Dialogo } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { SelectorFotos } from "@/components/selector-fotos";
import {
  reservarBien, cerrarReserva, retirarBien, subirFoto, borrarFoto, cargarGasto, editarBien, editarAcuerdo,
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
              <input id="r_monto" name="monto" inputMode="decimal" required className="campo cifra" />
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
              <input id="c_dev" name="monto_devuelto" inputMode="decimal" className="campo cifra" />
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
          <input id="g_monto" name="monto" inputMode="decimal" required className="campo cifra" />
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
  notas: string | null; costo: number; origen: string;
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
      <Campo etiqueta="Patente o IMEI" htmlFor="e_dom"><input id="e_dom" name="dominio" defaultValue={bien.dominio ?? ""} maxLength={40} className="campo uppercase" /></Campo>
      <Campo etiqueta="Kilometraje" htmlFor="e_km"><input id="e_km" name="kilometraje" type="number" defaultValue={bien.kilometraje ?? ""} className="campo" /></Campo>
      <Campo etiqueta="Color" htmlFor="e_color"><input id="e_color" name="color" defaultValue={bien.color ?? ""} maxLength={40} className="campo" /></Campo>
      <Campo etiqueta="Precio publicado" htmlFor="e_precio"><input id="e_precio" name="precio_publicado" inputMode="decimal" defaultValue={bien.precio_publicado ?? ""} className="campo cifra" /></Campo>
      {propio && (
        <Campo etiqueta="Costo" htmlFor="e_costo"><input id="e_costo" name="costo" inputMode="decimal" defaultValue={bien.costo} className="campo cifra" /></Campo>
      )}
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
      <Campo etiqueta="Monto acordado" htmlFor="a_monto"><input id="a_monto" name="monto_acordado" inputMode="decimal" defaultValue={acuerdo.monto_acordado} required className="campo cifra" /></Campo>
      <Campo etiqueta="Vence el" htmlFor="a_vence"><input id="a_vence" name="vence_el" type="date" min={hoy} defaultValue={acuerdo.vence_el ?? ""} className="campo" /></Campo>
      <Campo etiqueta="Comisión" htmlFor="a_base">
        <select id="a_base" name="comision_base" defaultValue={acuerdo.comision_base ?? ""} className="campo">
          <option value="">Sin definir</option><option value="fijo">Monto fijo</option><option value="pct_precio">% del precio</option>
        </select>
      </Campo>
      <Campo etiqueta="Valor" htmlFor="a_valor"><input id="a_valor" name="comision_valor" inputMode="decimal" defaultValue={acuerdo.comision_valor ?? ""} className="campo cifra" /></Campo>
      <div className="sm:col-span-2"><BotonEnviar variante="secundario"><Save className="size-5" aria-hidden /> Actualizar acuerdo</BotonEnviar></div>
    </Formulario>
  );
}
