import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AgenFlux — Seu escritório de agentes", description: "Escritório virtual local para acompanhar e delegar tarefas reais do Codex." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
