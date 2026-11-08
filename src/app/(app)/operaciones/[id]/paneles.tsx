"use client";

import { Ban, CheckCheck } from "lucide-react";
import { Formulario, BotonEnviar, Dialogo } from "@/components/formulario";
import { Campo } from "@/components/ui";
import { anularOperacion, marcarFinanciacionCobrada } from "../acciones";

export function BotonAnular({ operacionId }: { operacionId: number }) {
  return (
    <Dialogo boton="Anular" titulo="Anular operación" variante="peligro" icono={<Ban className="size-5" aria-hidden />}>
      {(cerrar) => (
        <Formulario accion={anularOperacion} alGuardar={cerrar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={operacionId} />
          <p className="text-sm text-acero-500">
            Usalo solo si la operación se cargó mal. El bien vuelve al stock, los movimientos de caja se anulan
            y los bienes recibidos como parte de pago salen del stock.
          </p>
          <Campo etiqueta="Motivo" htmlFor="an_motivo">
            <textarea id="an_motivo" name="motivo" required maxLength={500} rows={2} className="campo" />
          </Campo>
          <BotonEnviar variante="peligro" className="w-full">Anular operación</BotonEnviar>
        </Formulario>
      )}
    </Dialogo>
  );
}

export function BotonFinanciacionCobrada({ pagoId }: { pagoId: number }) {
  return (
    <Formulario accion={marcarFinanciacionCobrada}>
      <input type="hidden" name="pago_id" value={pagoId} />
      <BotonEnviar variante="exito" className="min-h-9 px-3 py-1.5"><CheckCheck className="size-4" aria-hidden /> Marcar cobrada</BotonEnviar>
    </Formulario>
  );
}
