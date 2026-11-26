import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { brandStyleFor } from "@/lib/branding/brand-style";

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
