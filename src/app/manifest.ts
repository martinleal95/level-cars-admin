import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Level Cars · Gestión",
    short_name: "Level Cars",
    description: "Administración de operaciones de Level Cars",
    start_url: "/",
    display: "standalone",
    background_color: "#16181c",
    theme_color: "#16181c",
    lang: "es-AR",
    icons: [{ src: "/marca/level-cars_isotipo_color-para-fondo-oscuro.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
