"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Identidade do handoff Conduzza: o app abre no tema claro, com o escuro
// disponivel na chave. Decisao do dono do produto em 19/08/2026, substituindo
// o "escuro por padrao" do brief. Sem tema de sistema.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
