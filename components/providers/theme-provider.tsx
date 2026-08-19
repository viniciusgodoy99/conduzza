"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Escuro por padrao, claro obrigatorio, alternavel por chave (brief secao 3.1).
// Sem tema de sistema: o padrao do produto e o escuro.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
