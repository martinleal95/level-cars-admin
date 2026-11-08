import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Level Cars · Gestión", template: "%s · Level Cars" },
  description: "Sistema de administración de operaciones de Level Cars",
  robots: { index: false, follow: false },
  applicationName: "Level Cars",
  appleWebApp: { capable: true, title: "Level Cars", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#16181c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${montserrat.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
