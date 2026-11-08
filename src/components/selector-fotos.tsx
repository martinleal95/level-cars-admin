"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";

const LADO_MAX = 1600;
const CALIDAD = 0.82;
export const MAX_FOTOS_POR_ENVIO = 8;
// Tope del envío completo (el servidor acepta hasta 4 MB por pedido).
const MAX_BYTES_ENVIO = 3.8 * 1024 * 1024;

/**
 * Achica la foto en el navegador antes de subirla (las del celular pesan
 * varios MB): lado mayor de 1600 px, JPEG. Así sube rápido y entra en el
 * límite. Si el navegador no puede leerla, se manda tal cual y el servidor
 * decide.
 */
async function achicar(archivo: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    lienzo.getContext("2d")!.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", CALIDAD));
    if (!blob || blob.size >= archivo.size) return archivo;
    return new File([blob], archivo.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return archivo;
  }
}

/** Campo para elegir fotos (cámara o galería) con vista previa. */
export function SelectorFotos({ nombre = "fotos", compacto = false }: { nombre?: string; compacto?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [previas, setPrevias] = useState<string[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => () => previas.forEach((u) => URL.revokeObjectURL(u)), [previas]);

  // Si el formulario se limpia después de guardar, se borran las vistas previas.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const alLimpiar = () => setPrevias([]);
    form.addEventListener("reset", alLimpiar);
    return () => form.removeEventListener("reset", alLimpiar);
  }, []);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    let elegidas = Array.from(input.files ?? []);
    setAviso("");
    if (elegidas.length > MAX_FOTOS_POR_ENVIO) {
      setAviso(`Se toman las primeras ${MAX_FOTOS_POR_ENVIO} fotos. Podés subir más después.`);
      elegidas = elegidas.slice(0, MAX_FOTOS_POR_ENVIO);
    }
    setProcesando(true);
    const achicadas = await Promise.all(elegidas.map(achicar));
    const listas: File[] = [];
    let total = 0;
    for (const f of achicadas) {
      if (total + f.size > MAX_BYTES_ENVIO) {
        setAviso("Algunas fotos no entraron en este envío por su tamaño. Subilas después desde la ficha del bien.");
        continue;
      }
      total += f.size;
      listas.push(f);
    }
    const dt = new DataTransfer();
    listas.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    setPrevias(listas.map((f) => URL.createObjectURL(f)));
    setProcesando(false);
  }

  function quitar(i: number) {
    const input = ref.current;
    if (!input?.files) return;
    const dt = new DataTransfer();
    Array.from(input.files).forEach((f, j) => j !== i && dt.items.add(f));
    input.files = dt.files;
    setPrevias((p) => p.filter((_, j) => j !== i));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`btn-secundario cursor-pointer ${compacto ? "" : "w-full sm:w-auto"}`}>
          {procesando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : previas.length ? <ImagePlus className="size-5" aria-hidden /> : <Camera className="size-5" aria-hidden />}
          {previas.length ? "Cambiar fotos" : "Sacar o elegir fotos"}
          {/* Sin "capture": el celular ofrece cámara o galería. */}
          <input ref={ref} type="file" name={nombre} accept="image/*" multiple className="sr-only" onChange={alElegir} />
        </label>
        {previas.length > 0 && (
          <span className="text-sm font-semibold text-acero-500">{previas.length} {previas.length === 1 ? "foto lista" : "fotos listas"}</span>
        )}
      </div>
      {aviso && <p className="ayuda">{aviso}</p>}
      {previas.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {previas.map((u, i) => (
            <li key={u} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-acero-100 ring-1 ring-acero-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
              <img src={u} alt={`Foto ${i + 1}`} className="size-full object-cover" />
              <button type="button" onClick={() => quitar(i)} aria-label={`Quitar foto ${i + 1}`}
                className="absolute top-1 right-1 rounded-full bg-grafito-900/70 p-1 text-white hover:bg-grafito-900">
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
