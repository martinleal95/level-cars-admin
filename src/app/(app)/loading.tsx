// Se muestra al instante mientras carga cada pantalla, así la navegación se siente inmediata.
export default function Cargando() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Cargando">
      <div className="mb-2 h-8 w-48 rounded-lg bg-acero-200" />
      <div className="mb-6 h-4 w-72 max-w-full rounded bg-acero-200/70" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-white shadow-tarjeta" />)}
      </div>
      <div className="mt-5 space-y-3 rounded-xl bg-white p-4 shadow-tarjeta">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-acero-100" />)}
      </div>
    </div>
  );
}
