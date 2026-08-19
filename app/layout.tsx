import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { brandStyleFor } from "@/lib/branding/brand-style";

// Tipografia do handoff: Inter Tight para a interface, IBM Plex Mono para
// numeros, telefones, horas e valores (alinha colunas e evita erro de leitura).
const interTight = Inter_Tight({
  variable: "--font-app-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Conduzza Clínicas",
  description: "Recepcionista de IA no WhatsApp da sua clínica",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // White-label (tarefa 0.7): a cor primaria da clinica ativa entra como CSS
  // custom property no <html>, direto do servidor. Sem sessao ou com a marca
  // padrao, o globals.css manda.
  const context = await getSessionContext();
  const brandStyle = brandStyleFor(context?.active?.primaryColor);

  return (
    <html
      lang="pt-BR"
      className={`${interTight.variable} ${ibmPlexMono.variable}`}
      style={brandStyle}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
