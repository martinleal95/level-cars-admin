// Secciones de la app. Módulo compartido (servidor y cliente): no lleva "use client".
import {
  LayoutDashboard, Car, Handshake, Wallet, Users, BarChart3, Settings,
} from "lucide-react";

export const SECCIONES = [
  { href: "/", label: "Inicio", icono: LayoutDashboard },
  { href: "/stock", label: "Stock", icono: Car },
  { href: "/operaciones", label: "Operaciones", icono: Handshake },
  { href: "/caja", label: "Caja", icono: Wallet },
  { href: "/personas", label: "Personas", icono: Users },
  { href: "/reportes", label: "Reportes", icono: BarChart3 },
  { href: "/configuracion", label: "Configuración", icono: Settings },
] as const;
