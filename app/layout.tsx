import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { brandStyleFor } from "@/lib/branding/brand-style";

// Tipografia do Conduzza Design System: Manrope na interface, JetBrains Mono
// em todo numero, hora, telefone e valor (alinha colunas e evita erro de
// leitura). As duas sao variaveis (Manrope 200 a 800, JetBrains Mono 100 a
// 800), por isso sem weight. Os nomes de variavel nao mudam: o @theme do
// globals.css continua igual.
const manrope = Manrope({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
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
      className={`${manrope.variable} ${jetbrainsMono.variable}`}
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
