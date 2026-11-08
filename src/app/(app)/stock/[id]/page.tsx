import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HandCoins, Pencil, FileText } from "lucide-react";
import { requerirAdmin } from "@/lib/auth";
import { enlacesFotos } from "@/lib/fotos";
import { dinero, fecha, etiquetas, hoyISO, type Moneda } from "@/lib/formato";
import { Encabezado, Seccion, Dato, InsigniaEstado, InsigniaOrigen } from "@/components/ui";
import {
  BotonReservar, BotonCerrarReserva, BotonRetirar, SubirFoto, BorrarFoto, FormularioGasto, FormularioEditar, FormularioAcuerdo,
} from "./paneles";

export const metadata: Metadata = { title: "Detalle del bien" };

export default async function PaginaBien({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ fotos?: string }>;
}) {
  const { id: idTexto } = await params;
  const { fotos: avisoFotos } = await searchParams;
  const bienId = Number(idTexto);
  if (!Number.isSafeInteger(bienId) || bienId <= 0) notFound();

  const { supabase } = await requerirAdmin();
  const [{ data: bien }, { data: fotosDb }, { data: acuerdo }, { data: reserva }, { data: gastos },
    { data: operacion }, { data: clientes }, { data: motivos }, { data: cfg }] = await Promise.all([
    supabase.from("v_stock").select("*").eq("id", bienId).maybeSingle(),
    supabase.from("bien_fotos").select("id, ruta").eq("bien_id", bienId).order("orden"),
    supabase.from("acuerdos_terceros").select("*, dueno:personas(nombre, telefono)").eq("bien_id", bienId).maybeSingle(),
    supabase.from("reservas").select("*, cliente:personas(nombre)").eq("bien_id", bienId).eq("estado", "vigente").maybeSingle(),
    supabase.from("movimientos").select("id, fecha, monto, moneda, descripcion, motivo:motivos_caja(nombre)")
      .eq("bien_id", bienId).eq("tipo", "egreso").is("operacion_id", null).is("reserva_id", null).eq("anulado", false)
      .order("fecha", { ascending: false }),
    supabase.from("operaciones").select("id, fecha, precio_venta, moneda, ganancia_neta").eq("bien_id", bienId).eq("anulada", false).maybeSingle(),
    supabase.from("personas").select("id, nombre").order("nombre"),
    supabase.from("motivos_caja").select("id, nombre").eq("tipo", "egreso").eq("es_gasto_fijo", false).eq("activo", true)
      .is("codigo", null).order("nombre"),
    supabase.from("configuracion").select("dias_reserva").eq("id", 1).single(),
  ]);

  if (!bien) notFound();
  const fotos = await enlacesFotos(supabase, (fotosDb ?? []).map((f) => f.ruta));
  const m = bien.moneda as Moneda;
  const activo = bien.estado === "en_stock" || bien.estado === "reservado";
  const tercero = bien.origen === "consignacion" || bien.origen === "intermediacion";
  const hoy = hoyISO();
  const venceSugerido = new Date(Date.parse(hoy) + (cfg?.dias_reserva ?? 7) * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <Encabezado titulo={`${bien.marca} ${bien.modelo}`}
        descripcion={[bien.version, bien.anio, bien.dominio].filter(Boolean).join(" · ") || etiquetas.tipoBien[bien.tipo as keyof typeof etiquetas.tipoBien]}
        volver={{ href: "/stock", label: "Stock" }}>
        {activo && (
          <Link href={`/operaciones/nueva?bien=${bien.id}`} className="btn-primario">
            <HandCoins className="size-5" aria-hidden /> Vender
          </Link>
        )}
        {bien.estado === "en_stock" && (
          <BotonReservar bienId={bien.id} clientes={clientes ?? []} moneda={m} venceSugerido={venceSugerido} hoy={hoy} />
        )}
        {bien.estado === "en_stock" && <BotonRetirar bienId={bien.id} tercero={tercero} />}
        {operacion && (
          <Link href={`/operaciones/${operacion.id}`} className="btn-secundario">
            <FileText className="size-5" aria-hidden /> Ver operación
          </Link>
        )}
      </Encabezado>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Seccion>
            <div className="mb-4 flex flex-wrap gap-2">
              <InsigniaEstado estado={bien.estado} />
              <InsigniaOrigen origen={bien.origen} />
              <span className="insignia bg-acero-100 text-grafito-700">{bien.dias_en_stock} días en la agencia</span>
            </div>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Dato etiqueta="Precio publicado" destacado>{bien.precio_publicado ? dinero(bien.precio_publicado, m) : "—"}</Dato>
              {!tercero && <Dato etiqueta="Costo" destacado>{dinero(bien.costo, m)}</Dato>}
              {tercero && <Dato etiqueta="Acordado con dueño" destacado>{dinero(bien.monto_acordado, m)}</Dato>}
              <Dato etiqueta="Gastos cargados">
                {Number(bien.gastos_usd) === 0 && Number(bien.gastos_ars) === 0 ? dinero(0, m) : (
                  <>
                    {Number(bien.gastos_usd) > 0 && <span className="block">{dinero(bien.gastos_usd, "USD")}</span>}
                    {Number(bien.gastos_ars) > 0 && <span className="block">{dinero(bien.gastos_ars, "ARS")}</span>}
                  </>
                )}
              </Dato>
              <Dato etiqueta="Ingreso">{fecha(bien.fecha_ingreso)}</Dato>
              <Dato etiqueta="Kilometraje">{bien.kilometraje != null ? `${bien.kilometraje.toLocaleString("es-AR")} km` : "—"}</Dato>
              <Dato etiqueta="Color">{bien.color ?? "—"}</Dato>
              <Dato etiqueta="Tipo">{etiquetas.tipoBien[bien.tipo as keyof typeof etiquetas.tipoBien]}</Dato>
            </dl>
            {bien.notas && <p className="mt-4 whitespace-pre-line rounded-lg bg-acero-50 p-3 text-sm text-grafito-700">{bien.notas}</p>}
          </Seccion>

          <Seccion titulo="Fotos" accion={fotosDb?.length ? <span className="text-sm font-semibold text-acero-500">{fotosDb.length}</span> : undefined}>
            {avisoFotos === "error" && (
              <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">
                El bien se guardó, pero alguna foto no se pudo subir. Probá de nuevo desde acá.
              </p>
            )}
            {fotosDb?.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {fotosDb.map((f) => (
                  <li key={f.id} className="group relative overflow-hidden rounded-lg bg-acero-100">
                    {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal */}
                    <img src={fotos.get(f.ruta)} alt={`Foto de ${bien.marca} ${bien.modelo}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                    {activo && <div className="absolute top-2 right-2"><BorrarFoto fotoId={f.id} /></div>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-acero-500">Todavía no hay fotos. Podés sacarlas con el celular o elegirlas de la galería.</p>
            )}
            {activo && <div className="mt-4 border-t border-acero-100 pt-4"><SubirFoto bienId={bien.id} /></div>}
          </Seccion>

          <Seccion titulo="Gastos del bien">
            <p className="-mt-2 mb-4 text-sm text-acero-500">Se restan de la ganancia cuando se vende.</p>
            {gastos?.length ? (
              <ul className="mb-5 divide-y divide-acero-100">
                {gastos.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>
                      <span className="font-semibold">{(g.motivo as unknown as { nombre: string } | null)?.nombre}</span>
                      {g.descripcion && <span className="text-acero-500"> · {g.descripcion}</span>}
                      <span className="block text-xs text-acero-500">{fecha(g.fecha)}</span>
                    </span>
                    <span className="cifra font-semibold text-red-600">−{dinero(g.monto, g.moneda as Moneda)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {activo && <FormularioGasto bienId={bien.id} motivos={motivos ?? []} moneda={m} hoy={hoy} />}
          </Seccion>

          {activo && (
            <details className="tarjeta group p-4 sm:p-6">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-bold [&::-webkit-details-marker]:hidden">
                <Pencil className="size-5 text-acero-400" aria-hidden /> Editar datos
              </summary>
              <div className="mt-4">
                <FormularioEditar bien={bien} />
              </div>
            </details>
          )}
        </div>

        <div className="space-y-5">
          {reserva && (
            <Seccion titulo="Reserva vigente" className="ring-2 ring-amber-400">
              <dl className="mb-4 space-y-3">
                <Dato etiqueta="Cliente">{(reserva.cliente as unknown as { nombre: string }).nombre}</Dato>
                <Dato etiqueta="Seña" destacado>{dinero(reserva.monto, reserva.moneda as Moneda)}</Dato>
                <Dato etiqueta="Vence">
                  <span className={reserva.vence_el < hoy ? "font-bold text-red-600" : ""}>{fecha(reserva.vence_el)}</span>
                </Dato>
              </dl>
              <p className="mb-3 text-xs text-acero-500">Al vender a este cliente, la seña se descuenta sola.</p>
              <BotonCerrarReserva bienId={bien.id} reservaId={reserva.id} />
            </Seccion>
          )}

          {acuerdo && (
            <Seccion titulo={acuerdo.tipo === "consignacion" ? "Consignación" : "Intermediación"}>
              <dl className="mb-4 space-y-3">
                <Dato etiqueta={acuerdo.tipo === "consignacion" ? "Dueño" : "Agenciero"}>
                  {(acuerdo.dueno as unknown as { nombre: string }).nombre}
                  {(acuerdo.dueno as unknown as { telefono: string | null }).telefono && (
                    <span className="block text-sm text-acero-500">{(acuerdo.dueno as unknown as { telefono: string }).telefono}</span>
                  )}
                </Dato>
                <Dato etiqueta="Espera recibir" destacado>{dinero(acuerdo.monto_acordado, acuerdo.moneda as Moneda)}</Dato>
                <Dato etiqueta="Comisión pactada">
                  {acuerdo.comision_base
                    ? `${etiquetas.base[acuerdo.comision_base as keyof typeof etiquetas.base]}: ${acuerdo.comision_base === "fijo" ? dinero(acuerdo.comision_valor, acuerdo.moneda as Moneda) : `${acuerdo.comision_valor}%`}`
                    : "Sin definir"}
                </Dato>
                <Dato etiqueta="Vence">
                  <span className={acuerdo.vence_el && acuerdo.vence_el < hoy && activo ? "font-bold text-red-600" : ""}>{fecha(acuerdo.vence_el)}</span>
                </Dato>
              </dl>
              {activo && acuerdo.estado === "vigente" && (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-naranja-600">Modificar acuerdo</summary>
                  <div className="mt-3"><FormularioAcuerdo bienId={bien.id} acuerdo={acuerdo} hoy={hoy} /></div>
                </details>
              )}
            </Seccion>
          )}

          {operacion && (
            <Seccion titulo="Vendido">
              <dl className="space-y-3">
                <Dato etiqueta="Fecha">{fecha(operacion.fecha)}</Dato>
                <Dato etiqueta="Precio">{dinero(operacion.precio_venta, operacion.moneda as Moneda)}</Dato>
                <Dato etiqueta="Ganancia neta" destacado>
                  <span className={Number(operacion.ganancia_neta) >= 0 ? "text-emerald-700" : "text-red-600"}>
                    {dinero(operacion.ganancia_neta, operacion.moneda as Moneda)}
                  </span>
                </Dato>
              </dl>
            </Seccion>
          )}
        </div>
      </div>
    </>
  );
}
