"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote, Landmark, CarFront, Building, Plus, Trash2, CheckCircle2, Percent, Info, PencilLine,
} from "lucide-react";
import { Aviso, BotonEnviar, ProveedorEnvio, useEnvio } from "@/components/formulario";
import { EntradaImporte } from "@/components/entradas";
import { Campo } from "@/components/ui";
import { dinero, type Moneda } from "@/lib/formato";
import { parsearNumero, numeroATexto, formatearPatente } from "@/lib/numero";
import { registrarOperacion, corregirOperacion } from "../acciones";

export type BienDisponible = {
  id: number; marca: string; modelo: string; anio: number | null; dominio: string | null;
  origen: "compra" | "parte_pago" | "consignacion" | "intermediacion"; costo: number; moneda: Moneda;
  precio_publicado: number | null; monto_acordado: number | null; acuerdo_moneda: Moneda;
  gastos: Record<Moneda, number>;
  reserva: { cliente_id: number; monto: number; moneda: Moneda; cliente: string } | null;
};
type Opcion = { id: number; nombre: string };
type Origen = "compra" | "consignacion" | "intermediacion";

/** Datos de una operación ya cargada, para corregirla. */
export type Inicial = {
  clienteId: string; canalId: string; vendedorId: string; fecha: string; moneda: Moneda; precio: string;
  cotizacion: string; montoTercero: string; porAgencia: boolean; notas: string;
  medioTercero?: MedioCaja;
  pagos: Omit<Pago, "clave">[]; comisiones: Omit<Comision, "clave">[];
  /** Pagos de la operación que ya se marcaron como hechos (comisiones, pago al dueño). */
  pagados: { concepto: string; monto: number; moneda: Moneda }[];
};

type TipoPago = "efectivo" | "transferencia" | "financiacion" | "bien";
export type Pago = {
  clave: number; tipo: TipoPago; monto: string; moneda: Moneda; financiera_id: string; cobrado: boolean;
  /** Bien que ya se recibió en esta venta (al corregir): se conserva tal cual está en el stock. */
  existente?: { id: number; vendido: boolean };
  bien: { tipo: string; marca: string; modelo: string; anio: string; dominio: string; kilometraje: string };
};
type MedioCaja = "efectivo" | "banco";
export type Comision = { clave: number; sentido: "pagada" | "cobrada"; quien: string; base: "fijo" | "pct_precio" | "pct_ganancia"; valor: string; medio: MedioCaja };

const TIPOS_PAGO: { tipo: TipoPago; label: string; icono: typeof Banknote }[] = [
  { tipo: "efectivo", label: "Efectivo", icono: Banknote },
  { tipo: "transferencia", label: "Transferencia", icono: Landmark },
  { tipo: "financiacion", label: "Financiación", icono: Building },
  { tipo: "bien", label: "Vehículo / bien", icono: CarFront },
];

/** Convierte texto con formato argentino ("1.500.000,50") a número. */
function n(v: string | number | null | undefined) {
  const x = parsearNumero(v);
  return Number.isFinite(x) ? x : 0;
}

/** Un importe escrito es válido si está vacío o se puede leer como número. */
const legible = (v: string) => v.trim() === "" || Number.isFinite(parsearNumero(v));

function convertir(monto: number, de: Moneda, a: Moneda, cot: number) {
  if (!monto || de === a) return monto;
  if (!cot) return NaN;
  return de === "USD" ? monto * cot : monto / cot;
}

let siguiente = 1;
const pagoNuevo = (tipo: TipoPago, moneda: Moneda): Pago => ({
  clave: siguiente++, tipo, monto: "", moneda, financiera_id: "", cobrado: false,
  bien: { tipo: "moto", marca: "", modelo: "", anio: "", dominio: "", kilometraje: "" },
});

export function Asistente({ bienes, personas, vendedores, canales, financieras, bienInicial, hoy, inicial, correccion }: {
  bienes: BienDisponible[]; personas: Opcion[]; vendedores: Opcion[]; canales: Opcion[];
  financieras: (Opcion & { comision_base: string | null; comision_valor: number | null })[];
  bienInicial?: number; hoy: string;
  /** Modo corrección: la operación que se reemplaza y sus datos actuales. */
  inicial?: Inicial; correccion?: { operacionId: number };
}) {
  const { estado, alEnviar, pendiente } = useEnvio(correccion ? corregirOperacion : registrarOperacion);

  const [bienId, setBienId] = useState<number | null>(bienInicial && bienes.some((b) => b.id === bienInicial) ? bienInicial : null);
  const bienCargado = bienes.find((b) => b.id === bienId) ?? null;
  const [clienteId, setClienteId] = useState<string>(inicial?.clienteId ?? (bienCargado?.reserva ? String(bienCargado.reserva.cliente_id) : ""));
  const [canalId, setCanalId] = useState(inicial?.canalId ?? "");
  const [vendedorId, setVendedorId] = useState(inicial?.vendedorId ?? "");
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy);
  const [moneda, setMoneda] = useState<Moneda>(inicial?.moneda ?? bienCargado?.moneda ?? "USD");
  const [precio, setPrecio] = useState(inicial?.precio ?? (bienCargado?.precio_publicado ? numeroATexto(bienCargado.precio_publicado) : ""));
  const [cotizacion, setCotizacion] = useState(inicial?.cotizacion ?? "");
  const [montoTercero, setMontoTercero] = useState(inicial?.montoTercero ?? "");
  const [porAgencia, setPorAgencia] = useState(inicial?.porAgencia ?? true);
  const [pagos, setPagos] = useState<Pago[]>(() =>
    inicial?.pagos.length ? inicial.pagos.map((x) => ({ ...x, clave: siguiente++ })) : [pagoNuevo("efectivo", bienCargado?.moneda ?? "USD")]);
  const [comisiones, setComisiones] = useState<Comision[]>(() => (inicial?.comisiones ?? []).map((c) => ({ ...c, clave: siguiente++ })));
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [medioTercero, setMedioTercero] = useState<MedioCaja>(inicial?.medioTercero ?? "efectivo");

  // Corrección del origen del bien (solo en modo corrección).
  const [motivo, setMotivo] = useState("");
  const [origenNuevo, setOrigenNuevo] = useState<Origen | "">("");
  const [duenoId, setDuenoId] = useState("");
  const [acordadoNuevo, setAcordadoNuevo] = useState("");
  const [costoNuevo, setCostoNuevo] = useState("");
  const [egresoCompra, setEgresoCompra] = useState(false);
  const [medioCompra, setMedioCompra] = useState<"efectivo" | "banco">("efectivo");
  const cambiaOrigen = !!origenNuevo && !!bienCargado && origenNuevo !== bienCargado.origen;

  // El bien tal como va a quedar: todo el cálculo usa el origen corregido.
  const bien = useMemo<BienDisponible | null>(() => {
    if (!bienCargado || !cambiaOrigen) return bienCargado;
    return origenNuevo === "compra"
      ? { ...bienCargado, origen: "compra", costo: n(costoNuevo), monto_acordado: null }
      : { ...bienCargado, origen: origenNuevo as Origen, costo: 0, monto_acordado: n(acordadoNuevo), acuerdo_moneda: bienCargado.moneda };
  }, [bienCargado, cambiaOrigen, origenNuevo, costoNuevo, acordadoNuevo]);

  function elegirOrigen(o: Origen | "") {
    setOrigenNuevo(o);
    // Si vuelve al origen que tenía, recupera lo que estaba cargado en la operación.
    const original = o === bienCargado?.origen;
    setMontoTercero(original ? inicial?.montoTercero ?? "" : "");
    setPorAgencia(original ? inicial?.porAgencia ?? true : true);
  }

  function elegirBien(id: number) {
    const b = bienes.find((x) => x.id === id)!;
    setBienId(id);
    setMoneda(b.moneda);
    setPrecio(b.precio_publicado ? numeroATexto(b.precio_publicado) : "");
    setMontoTercero("");
    setPorAgencia(true);
    // los pagos que nadie tocó pasan a la moneda del bien
    setPagos((ps) => ps.map((x) => (x.monto ? x : { ...x, moneda: b.moneda })));
    if (b.reserva) setClienteId(String(b.reserva.cliente_id));
  }

  const tercero = bien?.origen === "consignacion" || bien?.origen === "intermediacion";
  const cot = n(cotizacion);
  const otra: Moneda = moneda === "USD" ? "ARS" : "USD";
  // La cotización hace falta si algo está en otra moneda que la venta:
  // costo o acuerdo, seña, gastos del bien o alguno de los pagos.
  const necesitaCot = !!bien && (
    (tercero ? !montoTercero && bien.acuerdo_moneda !== moneda : bien.moneda !== moneda)
    || (!!bien.reserva && bien.reserva.moneda !== moneda)
    || bien.gastos[otra] > 0
    || pagos.some((x) => x.moneda !== moneda)
  );
  const enVenta = (x: Pago) => convertir(n(x.monto), x.moneda, moneda, cot);

  const calc = useMemo(() => {
    if (!bien) return null;
    const p = n(precio);
    const sena = bien.reserva ? convertir(bien.reserva.monto, bien.reserva.moneda, moneda, cot) : 0;
    const costo = tercero ? 0 : convertir(bien.costo, bien.moneda, moneda, cot);
    const terceroMonto = tercero ? (montoTercero ? n(montoTercero) : convertir(bien.monto_acordado ?? 0, bien.acuerdo_moneda, moneda, cot)) : 0;
    const gastos = bien.gastos[moneda] + convertir(bien.gastos[otra], otra, moneda, cot);
    const bruta = p - costo - terceroMonto - gastos;
    let pagadas = 0, cobradas = 0;
    for (const c of comisiones) {
      const v = n(c.valor);
      const m = c.base === "fijo" ? v : c.base === "pct_precio" ? (p * v) / 100 : (Math.max(bruta, 0) * v) / 100;
      if (c.sentido === "pagada") pagadas += m; else cobradas += m;
    }
    const sumaPagos = sena + pagos.reduce((s, x) => s + convertir(n(x.monto), x.moneda, moneda, cot), 0);
    return { p, sena, costo, terceroMonto, gastos, bruta, pagadas, cobradas, neta: bruta - pagadas + cobradas, sumaPagos, falta: p - sumaPagos };
  }, [bien, precio, moneda, otra, cot, tercero, montoTercero, comisiones, pagos]);

  const operacion = useMemo(() => (bien ? {
    bien_id: bien.id,
    cliente_id: clienteId ? Number(clienteId) : 0,
    canal_id: canalId ? Number(canalId) : null,
    vendedor_id: vendedorId ? Number(vendedorId) : null,
    fecha,
    precio_venta: n(precio),
    moneda,
    cotizacion: cot || null,
    monto_tercero: tercero && montoTercero ? n(montoTercero) : null,
    dinero_por_agencia: bien.origen === "intermediacion" ? porAgencia : true,
    medio_tercero: tercero ? medioTercero : undefined,
    notas: notas || null,
    pagos: pagos.map((x) =>
      x.tipo === "financiacion" ? { tipo: x.tipo, monto: n(x.monto), moneda: x.moneda, financiera_id: Number(x.financiera_id) || 0, cobrado: x.cobrado }
      : x.tipo === "bien" && x.existente ? { tipo: x.tipo, monto: n(x.monto), moneda: x.moneda, bien_existente_id: x.existente.id }
      : x.tipo === "bien" ? { tipo: x.tipo, monto: n(x.monto), moneda: x.moneda, bien: {
          tipo: x.bien.tipo, marca: x.bien.marca, modelo: x.bien.modelo,
          anio: x.bien.anio ? Number(x.bien.anio) : null, dominio: x.bien.dominio || null,
          kilometraje: x.bien.kilometraje ? Number(x.bien.kilometraje) : null } }
      : { tipo: x.tipo, monto: n(x.monto), moneda: x.moneda }),
    comisiones: comisiones.map((c) => {
      const [clase, idq] = c.quien.split(":");
      return {
        sentido: c.sentido, base: c.base, valor: n(c.valor), medio: c.medio,
        persona_id: clase === "p" ? Number(idq) : null, financiera_id: clase === "f" ? Number(idq) : null,
      };
    }),
  } : {}), [bien, clienteId, canalId, vendedorId, fecha, precio, moneda, cot, tercero, montoTercero, porAgencia, medioTercero, notas, pagos, comisiones]);

  const payload = useMemo(() => JSON.stringify(!correccion ? operacion : {
    operacion_id: correccion.operacionId,
    motivo,
    bien: !cambiaOrigen ? null : origenNuevo === "compra"
      ? { origen: "compra", costo: n(costoNuevo), registrar_egreso: egresoCompra, medio: medioCompra }
      : { origen: origenNuevo, dueno_id: Number(duenoId) || 0, monto_acordado: n(acordadoNuevo) },
    operacion,
  }), [correccion, operacion, motivo, cambiaOrigen, origenNuevo, costoNuevo, egresoCompra, medioCompra, duenoId, acordadoNuevo]);

  const actualizarPago = (clave: number, cambio: Partial<Pago>) =>
    setPagos((ps) => ps.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)));
  const actualizarComision = (clave: number, cambio: Partial<Comision>) =>
    setComisiones((cs) => cs.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)));

  function completarSaldo(clave: number) {
    if (!calc) return;
    const otros = calc.sena + pagos.filter((x) => x.clave !== clave).reduce((s, x) => s + enVenta(x), 0);
    const pago = pagos.find((x) => x.clave === clave)!;
    const resto = convertir(Math.max(calc.p - otros, 0), moneda, pago.moneda, cot);
    if (!Number.isFinite(resto)) return;
    actualizarPago(clave, { monto: numeroATexto(Math.round(resto * 100) / 100) });
  }

  // igual que el servidor: medio centavo de redondeo por cada pago convertido
  const tolerancia = 0.01 * (pagos.filter((x) => x.moneda !== moneda).length + 1);
  const origenListo = !cambiaOrigen || (origenNuevo === "compra" ? costoNuevo.trim() !== "" : !!duenoId && acordadoNuevo.trim() !== "");
  // Un importe mal escrito ("17,000,000") no se toma como cero: bloquea el guardado.
  const importesOk = [precio, cotizacion, montoTercero, costoNuevo, acordadoNuevo, ...pagos.map((x) => x.monto), ...comisiones.map((c) => c.valor)].every(legible);
  const cubre = !!calc && Math.abs(calc.falta) < tolerancia;
  const listo = !!bien && !!clienteId && n(precio) > 0 && cubre && (!necesitaCot || cot > 0) && importesOk
    && (!correccion || (motivo.trim().length > 0 && origenListo));

  function confirmarEnvio(e: React.FormEvent<HTMLFormElement>) {
    if (correccion && !window.confirm("Se guarda la venta corregida y la original queda anulada en el historial. Los movimientos de caja se rehacen con los datos nuevos. ¿Guardar la corrección?")) {
      e.preventDefault();
      return;
    }
    alEnviar(e);
  }

  return (
    <form onSubmit={confirmarEnvio} className="grid gap-5 lg:grid-cols-3">
      <ProveedorEnvio value={pendiente}>
      <input type="hidden" name="payload" value={payload} />
      <div className="space-y-5 lg:col-span-2">
        {/* 1. Bien */}
        <section className="tarjeta p-4 sm:p-6">
          <Paso n={1} titulo="¿Qué se vende?" />
          {bienes.length === 0 ? (
            <p className="text-sm text-acero-500">No hay bienes disponibles. <Link href="/stock/nuevo?vender=1" className="font-semibold text-naranja-600">Cargá uno</Link>.</p>
          ) : (
            <select className="campo" value={bienId ?? ""} onChange={(e) => elegirBien(Number(e.target.value))} aria-label="Bien que se vende" required disabled={!!correccion}>
              <option value="" disabled>Elegí un bien del stock</option>
              {bienes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.marca} {b.modelo}{b.anio ? ` ${b.anio}` : ""}{b.dominio ? ` · ${b.dominio}` : ""}{b.reserva ? " · RESERVADO" : ""}
                </option>
              ))}
            </select>
          )}
          {bien && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-acero-50 p-3 text-sm">
              <span><b>Origen:</b> {bien.origen === "compra" || bien.origen === "parte_pago" ? "Propio" : bien.origen === "consignacion" ? "Consignación" : "Intermediación"}</span>
              {!tercero && <span><b>Costo:</b> {dinero(bien.costo, bien.moneda)}</span>}
              {tercero && <span><b>Acordado con dueño:</b> {dinero(bien.monto_acordado, bien.acuerdo_moneda)}</span>}
              {(["USD", "ARS"] as const).filter((m) => bien.gastos[m] > 0).map((m) => (
                <span key={m}><b>Gastos:</b> {dinero(bien.gastos[m], m)}</span>
              ))}
              {bien.reserva && <span className="font-semibold text-amber-700">Reservado por {bien.reserva.cliente} con {dinero(bien.reserva.monto, bien.reserva.moneda)}</span>}
            </div>
          )}
          {!correccion && bienes.length > 0 && (
            <p className="ayuda">
              ¿No está en la lista? Si es un auto de otra agencia o de un particular que no tenés en el local,{" "}
              <Link href="/stock/nuevo?vender=1" className="font-semibold text-naranja-600 hover:underline">cargalo acá</Link> y volvés directo a esta venta.
            </p>
          )}
          {correccion && bienCargado && bienCargado.origen !== "parte_pago" && (
            <div className="mt-4 rounded-xl p-4 ring-1 ring-acero-200">
              <p className="font-bold">¿El origen del bien estaba mal cargado?</p>
              <p className="ayuda mt-0 mb-3">Si lo cargaste como propio y era de un tercero (o al revés), corregilo acá. La ganancia se recalcula.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Origen correcto" htmlFor="origen_nuevo">
                  <select id="origen_nuevo" className="campo" value={origenNuevo || bienCargado.origen} onChange={(e) => elegirOrigen(e.target.value as Origen)}>
                    <option value="compra">Propio (lo compró la agencia)</option>
                    <option value="consignacion">Consignación (de un dueño)</option>
                    <option value="intermediacion">Intermediación (de otro agenciero)</option>
                  </select>
                </Campo>
                {cambiaOrigen && origenNuevo === "compra" && (
                  <>
                    <Campo etiqueta={`Costo de compra (${bienCargado.moneda === "USD" ? "US$" : "$"})`} htmlFor="costo_nuevo">
                      <EntradaImporte id="costo_nuevo" aria-invalid={!legible(costoNuevo)} className="campo cifra" value={costoNuevo} onChange={(e) => setCostoNuevo(e.target.value)} required />
                    </Campo>
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                      <label className="flex items-center gap-3 text-sm font-semibold">
                        <input type="checkbox" className="size-5 accent-naranja-500" checked={egresoCompra} onChange={(e) => setEgresoCompra(e.target.checked)} />
                        Registrar la compra como egreso de caja
                      </label>
                      {egresoCompra && (
                        <select className="campo max-w-52" value={medioCompra} onChange={(e) => setMedioCompra(e.target.value as "efectivo" | "banco")} aria-label="Medio de pago de la compra">
                          <option value="efectivo">Pagado en efectivo</option><option value="banco">Pagado por banco</option>
                        </select>
                      )}
                    </div>
                  </>
                )}
                {cambiaOrigen && origenNuevo !== "compra" && (
                  <>
                    <Campo etiqueta={origenNuevo === "consignacion" ? "Dueño" : "Agenciero"} htmlFor="dueno_nuevo" ayuda={personas.length ? undefined : "Primero cargalo en Personas."}>
                      <select id="dueno_nuevo" className="campo" value={duenoId} onChange={(e) => setDuenoId(e.target.value)} required>
                        <option value="" disabled>Elegí una persona</option>
                        {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </Campo>
                    <Campo etiqueta={`Monto acordado (${bienCargado.moneda === "USD" ? "US$" : "$"})`} htmlFor="acordado_nuevo" ayuda="Lo que se le paga cuando se vende.">
                      <EntradaImporte id="acordado_nuevo" aria-invalid={!legible(acordadoNuevo)} className="campo cifra" value={acordadoNuevo} onChange={(e) => setAcordadoNuevo(e.target.value)} required />
                    </Campo>
                    {bienCargado.origen === "compra" && (
                      <p className="text-sm text-acero-500 sm:col-span-2">El egreso por la compra que se había generado en caja se anula.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 2. Cliente */}
        <section className="tarjeta grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
          <div className="sm:col-span-2"><Paso n={2} titulo="¿A quién y cómo llegó?" /></div>
          <Campo etiqueta="Cliente" htmlFor="cliente"
            ayuda={bien?.reserva ? "Es quien dejó la seña. Para venderle a otra persona, primero cerrá la reserva." : personas.length ? undefined : "Primero cargalo en Personas."}>
            <select id="cliente" className="campo" value={clienteId} onChange={(e) => setClienteId(e.target.value)} required disabled={!!bien?.reserva}>
              <option value="" disabled>Elegí el cliente</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Canal por donde llegó" htmlFor="canal">
            <select id="canal" className="campo" value={canalId} onChange={(e) => setCanalId(e.target.value)}>
              <option value="">Sin indicar</option>
              {canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Vendedor" htmlFor="vendedor">
            <select id="vendedor" className="campo" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              <option value="">Sin vendedor</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Fecha" htmlFor="fecha">
            <input id="fecha" type="date" className="campo" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
          </Campo>
        </section>

        {/* 3. Precio */}
        <section className="tarjeta grid gap-4 p-4 sm:grid-cols-3 sm:p-6">
          <div className="sm:col-span-3"><Paso n={3} titulo="Precio de venta" /></div>
          <Campo etiqueta="Precio" htmlFor="precio" className="sm:col-span-2">
            <EntradaImporte id="precio" aria-invalid={!legible(precio)} className="campo cifra text-lg font-bold" value={precio} onChange={(e) => setPrecio(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Moneda" htmlFor="moneda">
            <select id="moneda" className="campo" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
              <option value="USD">Dólares (US$)</option><option value="ARS">Pesos ($)</option>
            </select>
          </Campo>
          {necesitaCot && (
            <Campo etiqueta="Cotización del dólar" htmlFor="cot" ayuda="Pesos por dólar, para convertir costos, gastos, señas y pagos en otra moneda." className="sm:col-span-3">
              <EntradaImporte id="cot" decimales={4} aria-invalid={!legible(cotizacion)} className="campo cifra max-w-xs" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} required />
            </Campo>
          )}
          {tercero && !cambiaOrigen && (
            <Campo etiqueta={`Monto para el ${bien?.origen === "consignacion" ? "dueño" : "agenciero"}`} htmlFor="tercero"
              ayuda="Si lo dejás vacío se usa el monto acordado. Si la venta sale por debajo, poné lo que se arregló." className="sm:col-span-2">
              <EntradaImporte id="tercero" aria-invalid={!legible(montoTercero)} className="campo cifra" value={montoTercero}
                placeholder={bien && Number.isFinite(convertir(bien.monto_acordado ?? 0, bien.acuerdo_moneda, moneda, cot)) ? dinero(convertir(bien.monto_acordado ?? 0, bien.acuerdo_moneda, moneda, cot), moneda) : ""}
                onChange={(e) => setMontoTercero(e.target.value)} />
            </Campo>
          )}
          {tercero && (
            <Campo etiqueta={`El pago al ${bien?.origen === "consignacion" ? "dueño" : "agenciero"} sale por`} htmlFor="medio_tercero" className="sm:col-span-1"
              ayuda="Podés cambiarlo después, al marcarlo como pagado.">
              <select id="medio_tercero" className="campo" value={medioTercero} onChange={(e) => setMedioTercero(e.target.value as MedioCaja)}>
                <option value="efectivo">Efectivo</option><option value="banco">Banco / transferencia</option>
              </select>
            </Campo>
          )}
          {bien?.origen === "intermediacion" && (
            <fieldset className="sm:col-span-3">
              <legend className="etiqueta">¿Por dónde pasa el dinero del comprador?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[[true, "Por la agencia", "Se registra el cobro total y el pago al agenciero."],
                  [false, "Directo al agenciero", "Solo se registra la comisión de la agencia, descontando la seña si la tiene la agencia. No admite bienes como parte de pago."]].map(([v, t, d]) => (
                  <label key={String(v)} className={`cursor-pointer rounded-xl p-3 ring-2 ${porAgencia === v ? "bg-naranja-50 ring-naranja-500" : "ring-acero-200"}`}>
                    <input type="radio" className="sr-only" checked={porAgencia === v} onChange={() => setPorAgencia(v as boolean)} />
                    <span className="block font-bold">{t as string}</span>
                    <span className="block text-sm text-acero-500">{d as string}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </section>

        {/* 4. Pagos */}
        <section className="tarjeta p-4 sm:p-6">
          <Paso n={4} titulo="¿Cómo paga?" />
          {bien?.reserva && calc && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">
              <span className="font-semibold text-amber-800">Seña ya cobrada</span>
              <span className="cifra font-bold">{Number.isNaN(calc.sena) ? "Falta cotización" : dinero(calc.sena, moneda)}</span>
            </div>
          )}
          <ul className="space-y-3">
            {pagos.map((x) => {
              const Icono = TIPOS_PAGO.find((t) => t.tipo === x.tipo)!.icono;
              return (
                <li key={x.clave} className="rounded-xl p-3 ring-1 ring-acero-200 sm:p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <Campo etiqueta="Forma de pago" htmlFor={`pt_${x.clave}`} className="min-w-40 flex-1">
                      <div className="relative">
                        <Icono className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-acero-400" aria-hidden />
                        <select id={`pt_${x.clave}`} className="campo pl-10" value={x.tipo} disabled={!!x.existente}
                          onChange={(e) => actualizarPago(x.clave, { tipo: e.target.value as TipoPago })}>
                          {TIPOS_PAGO.filter((t) => t.tipo !== "bien" || x.tipo === "bien" || !(bien?.origen === "intermediacion" && !porAgencia))
                            .map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
                        </select>
                      </div>
                    </Campo>
                    <Campo etiqueta={x.tipo === "bien" ? "Valor que se le toma" : "Monto"} htmlFor={`pm_${x.clave}`} className="min-w-40 flex-1">
                      <div className="flex">
                        <select aria-label="Moneda del pago" className="campo w-24 shrink-0 rounded-r-none border-r-0 px-2" value={x.moneda}
                          disabled={x.existente?.vendido}
                          onChange={(e) => actualizarPago(x.clave, { moneda: e.target.value as Moneda })}>
                          <option value="USD">US$</option><option value="ARS">$</option>
                        </select>
                        <EntradaImporte id={`pm_${x.clave}`} className="campo cifra min-w-0 rounded-l-none" value={x.monto} readOnly={x.existente?.vendido}
                          aria-invalid={!legible(x.monto)} onChange={(e) => actualizarPago(x.clave, { monto: e.target.value })} required />
                      </div>
                    </Campo>
                    {!x.existente?.vendido && <button type="button" className="btn-secundario" onClick={() => completarSaldo(x.clave)}>Completar saldo</button>}
                    {(pagos.length > 1 || !!bien?.reserva) && !x.existente?.vendido && (
                      <button type="button" className="btn-fantasma text-red-600" aria-label="Quitar pago" onClick={() => setPagos((ps) => ps.filter((p) => p.clave !== x.clave))}>
                        <Trash2 className="size-5" aria-hidden />
                      </button>
                    )}
                  </div>
                  {x.tipo === "financiacion" && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <Campo etiqueta="Financiera" htmlFor={`pf_${x.clave}`} className="min-w-48 flex-1">
                        <select id={`pf_${x.clave}`} className="campo" value={x.financiera_id} onChange={(e) => actualizarPago(x.clave, { financiera_id: e.target.value })} required>
                          <option value="" disabled>Elegí</option>
                          {financieras.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                        </select>
                      </Campo>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" className="size-5 accent-emerald-600" checked={x.cobrado} onChange={(e) => actualizarPago(x.clave, { cobrado: e.target.checked })} />
                        Ya la pagó la financiera
                      </label>
                    </div>
                  )}
                  {x.tipo === "bien" && x.existente && (
                    <p className="mt-3 rounded-lg bg-acero-50 p-3 text-sm text-grafito-700">
                      <b>{x.bien.marca} {x.bien.modelo}</b>: ya está cargado en el stock y se conserva con sus fotos, gastos e historial.{" "}
                      {x.existente.vendido
                        ? "Como ya se vendió, no se puede cambiar el valor al que se tomó ni quitarlo de esta venta."
                        : "Podés cambiar el valor al que se tomó. Si lo quitás de esta venta, sale del stock."}{" "}
                      <Link href={`/stock/${x.existente.id}`} className="font-semibold text-naranja-600 hover:underline">Ver el bien</Link>
                    </p>
                  )}
                  {x.tipo === "bien" && !x.existente && (
                    <div className="mt-3 grid gap-3 rounded-lg bg-acero-50 p-3 sm:grid-cols-3">
                      <p className="text-sm font-semibold text-acero-500 sm:col-span-3">Entra al stock como bien propio, con este valor como costo.</p>
                      <Campo etiqueta="Tipo" htmlFor={`bt_${x.clave}`}>
                        <select id={`bt_${x.clave}`} className="campo" value={x.bien.tipo} onChange={(e) => actualizarPago(x.clave, { bien: { ...x.bien, tipo: e.target.value } })}>
                          <option value="auto">Auto</option><option value="moto">Moto</option><option value="celular">Celular</option><option value="otro">Otro</option>
                        </select>
                      </Campo>
                      {(["marca", "modelo", "anio", "dominio", "kilometraje"] as const).map((k) => (
                        <Campo key={k} etiqueta={{ marca: "Marca", modelo: "Modelo", anio: "Año", dominio: "Patente / IMEI", kilometraje: "Kilometraje" }[k]} htmlFor={`b${k}_${x.clave}`}>
                          <input id={`b${k}_${x.clave}`} className="campo" value={x.bien[k]} required={k === "marca" || k === "modelo"}
                            inputMode={k === "anio" || k === "kilometraje" ? "numeric" : undefined}
                            onChange={(e) => actualizarPago(x.clave, { bien: { ...x.bien, [k]: k === "dominio" ? formatearPatente(e.target.value) : e.target.value } })} />
                        </Campo>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIPOS_PAGO.filter((t) => t.tipo !== "bien" || !(bien?.origen === "intermediacion" && !porAgencia)).map((t) => (
              <button key={t.tipo} type="button" className="btn-secundario" onClick={() => setPagos((ps) => [...ps, pagoNuevo(t.tipo, moneda)])}>
                <Plus className="size-4" aria-hidden /> {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* 5. Comisiones */}
        <section className="tarjeta p-4 sm:p-6">
          <Paso n={5} titulo="Comisiones" opcional />
          {comisiones.length > 0 && (
            <ul className="mb-3 space-y-3">
              {comisiones.map((c) => (
                <li key={c.clave} className="flex flex-wrap items-end gap-3 rounded-xl p-3 ring-1 ring-acero-200">
                  <Campo etiqueta="Tipo" htmlFor={`cs_${c.clave}`} className="min-w-36 flex-1">
                    <select id={`cs_${c.clave}`} className="campo" value={c.sentido} onChange={(e) => actualizarComision(c.clave, { sentido: e.target.value as Comision["sentido"], quien: "", medio: e.target.value === "cobrada" ? "banco" : "efectivo" })}>
                      <option value="pagada">La paga la agencia</option><option value="cobrada">La cobra la agencia</option>
                    </select>
                  </Campo>
                  <Campo etiqueta={c.sentido === "pagada" ? "A quién" : "Quién la paga"} htmlFor={`cq_${c.clave}`} className="min-w-44 flex-1">
                    <select id={`cq_${c.clave}`} className="campo" value={c.quien} onChange={(e) => actualizarComision(c.clave, { quien: e.target.value })} required>
                      <option value="" disabled>Elegí</option>
                      {c.sentido === "cobrada" && <optgroup label="Financieras">{financieras.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.nombre}</option>)}</optgroup>}
                      <optgroup label="Personas">{personas.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.nombre}</option>)}</optgroup>
                    </select>
                  </Campo>
                  <Campo etiqueta="Cálculo" htmlFor={`cb_${c.clave}`} className="min-w-40 flex-1">
                    <select id={`cb_${c.clave}`} className="campo" value={c.base} onChange={(e) => actualizarComision(c.clave, { base: e.target.value as Comision["base"] })}>
                      <option value="fijo">Monto fijo</option><option value="pct_precio">% del precio</option><option value="pct_ganancia">% de la ganancia</option>
                    </select>
                  </Campo>
                  <Campo etiqueta={c.sentido === "pagada" ? "Se paga por" : "Se cobra por"} htmlFor={`cmd_${c.clave}`} className="min-w-36 flex-1">
                    <select id={`cmd_${c.clave}`} className="campo" value={c.medio} onChange={(e) => actualizarComision(c.clave, { medio: e.target.value as MedioCaja })}>
                      <option value="efectivo">Efectivo</option><option value="banco">Banco / transferencia</option>
                    </select>
                  </Campo>
                  <Campo etiqueta={c.base === "fijo" ? "Monto" : "Porcentaje"} htmlFor={`cv_${c.clave}`} className="w-32">
                    <div className="relative">
                      <EntradaImporte id={`cv_${c.clave}`} className="campo cifra pr-8" value={c.valor} onChange={(e) => actualizarComision(c.clave, { valor: e.target.value })} required />
                      {c.base !== "fijo" && <Percent className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-acero-400" aria-hidden />}
                    </div>
                  </Campo>
                  <button type="button" className="btn-fantasma text-red-600" aria-label="Quitar comisión" onClick={() => setComisiones((cs) => cs.filter((x) => x.clave !== c.clave))}>
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secundario" onClick={() => setComisiones((cs) => [...cs, { clave: siguiente++, sentido: "pagada", quien: vendedorId ? `p:${vendedorId}` : "", base: "pct_ganancia", valor: "", medio: "efectivo" }])}>
              <Plus className="size-4" aria-hidden /> Comisión a pagar (vendedor, referido)
            </button>
            <button type="button" className="btn-secundario" onClick={() => setComisiones((cs) => [...cs, { clave: siguiente++, sentido: "cobrada", quien: "", base: "pct_precio", valor: "", medio: "banco" }])}>
              <Plus className="size-4" aria-hidden /> Comisión a cobrar (financiera)
            </button>
          </div>
          <Campo etiqueta="Notas" htmlFor="notas" className="mt-5">
            <textarea id="notas" rows={2} maxLength={2000} className="campo" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>
        </section>
      </div>

      {/* Resumen en vivo */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-xl bg-grafito-900 text-white shadow-xl">
          <div className="p-5">
            <p className="text-sm font-semibold text-acero-400">Resumen de la operación</p>
            {calc && bien ? (
              <>
                <dl className="mt-4 space-y-2 text-sm">
                  <Fila l="Precio de venta" v={dinero(calc.p, moneda)} />
                  {!tercero && <Fila l="Costo del bien" v={`− ${fmt(calc.costo, moneda)}`} />}
                  {tercero && <Fila l="Para el dueño" v={`− ${fmt(calc.terceroMonto, moneda)}`} />}
                  {calc.gastos > 0 && <Fila l="Gastos del bien" v={`− ${fmt(calc.gastos, moneda)}`} />}
                  {calc.pagadas > 0 && <Fila l="Comisiones pagadas" v={`− ${fmt(calc.pagadas, moneda)}`} />}
                  {calc.cobradas > 0 && <Fila l="Comisiones cobradas" v={`+ ${fmt(calc.cobradas, moneda)}`} />}
                </dl>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold text-acero-400 uppercase">Ganancia neta estimada</p>
                  <p className={`cifra font-display text-3xl font-extrabold ${calc.neta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number.isNaN(calc.neta) ? "Falta cotización" : dinero(calc.neta, moneda)}
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-acero-400">Elegí el bien para ver el resumen.</p>
            )}
          </div>
          {calc && bien && (
            <div className={`px-5 py-3 text-sm font-semibold ${cubre ? "bg-emerald-600" : "bg-naranja-500"}`}>
              {cubre ? (
                <span className="flex items-center gap-2"><CheckCircle2 className="size-5" aria-hidden /> Los pagos cubren el precio</span>
              ) : calc.falta > 0 ? (
                <>Faltan {fmt(calc.falta, moneda)} en pagos</>
              ) : (
                <>Los pagos superan el precio por {fmt(-calc.falta, moneda)}</>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 flex gap-2 text-xs text-acero-500">
          <Info className="size-4 shrink-0" aria-hidden /> El cálculo final lo hace el sistema al confirmar, con los gastos y la cotización cargados.
        </p>
        {correccion && (
          <div className="tarjeta mt-4 p-4">
            <Campo etiqueta="¿Qué estaba mal?" htmlFor="motivo" ayuda="Queda guardado en el historial de la operación.">
              <textarea id="motivo" rows={2} maxLength={400} className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required
                placeholder="Ej: el auto era en consignación, no propio" />
            </Campo>
            {(inicial?.pagados.length ?? 0) > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <p className="font-semibold">Ya marcaste como pagado:</p>
                <ul className="mt-1 list-disc pl-5">
                  {inicial!.pagados.map((x, i) => <li key={i}>{x.concepto}: {dinero(x.monto, x.moneda)}</li>)}
                </ul>
                <p className="mt-1">Si el monto no cambia, sigue como pagado. Si cambia, queda pendiente por el monto nuevo: revisalo en Caja.</p>
              </div>
            )}
          </div>
        )}
        {!importesOk && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700">
            Hay un importe que no se puede leer. Escribilo con punto para los miles y coma para los decimales, por ejemplo 17.000.000 o 1.250,50.
          </p>
        )}
        <Aviso estado={estado} />
        <BotonEnviar className="mt-4 w-full py-3.5 text-base" disabled={!listo}>
          {correccion ? <><PencilLine className="size-5" aria-hidden /> Guardar corrección</> : <><CheckCircle2 className="size-5" aria-hidden /> Confirmar venta</>}
        </BotonEnviar>
      </aside>
      </ProveedorEnvio>
    </form>
  );
}

function fmt(v: number, m: Moneda) {
  return Number.isNaN(v) ? "—" : dinero(v, m);
}

function Fila({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-acero-300">{l}</dt>
      <dd className="cifra font-semibold">{v}</dd>
    </div>
  );
}

function Paso({ n: num, titulo, opcional }: { n: number; titulo: string; opcional?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-full bg-grafito-900 font-display text-sm font-bold text-white">{num}</span>
      <h2 className="text-lg font-bold">{titulo}</h2>
      {opcional && <span className="insignia bg-acero-100 text-acero-500">Opcional</span>}
    </div>
  );
}
