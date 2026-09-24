import "server-only";

import type { CSSProperties } from "react";

// Cor primaria do white-label como CSS custom properties injetadas no <html>
// pelo servidor (docs/03 secao 8): nada de recompilar Tailwind por cliente.
// A marca padrao (lime Conduzza) NAO e injetada: o globals.css cuida dela com
// os pares claro/escuro validados em contraste. Cor custom de clinica e
// aplicada como veio; a validacao de contraste no editor de marca e da Tela
// 12 (Fase 5), risco aceito e registrado no plano.
//
// Conduzza Design System (docs/06 secao 4.8): alem da primaria, a cor custom
// gera os derivados (hover, suave, texto, indicador, foco, barra de dado) com
// color-mix sobre tokens do tema (--surface-1, --text-strong). Como o estilo
// fica no proprio <html>, que recebe a classe .dark, os derivados mudam junto
// com o tema. A familia da IA (tom ai) continua lime fixo.

// O lime antigo (#A8D318, default da coluna clinic_branding.primary_color) e o
// lime novo do DS (#B2E54F) sao a marca padrao: nenhum dos dois e injetado,
// senao toda clinica pintaria o lime antigo por cima do novo.
const DEFAULT_PRIMARY = new Set(["#a8d318", "#b2e54f"]);
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
}

export function brandStyleFor(
  primaryColor: string | null | undefined,
): CSSProperties | undefined {
  if (!primaryColor || !HEX_PATTERN.test(primaryColor)) {
    return undefined;
  }
  if (DEFAULT_PRIMARY.has(primaryColor.toLowerCase())) {
    return undefined;
  }
  // Texto sobre cor clara usa a tinta da marca (ink-900 do DS)
  const foreground = luminance(primaryColor) > 0.45 ? "#051813" : "#ffffff";
  return {
    "--primary": primaryColor,
    "--primary-hover": `color-mix(in oklab, ${primaryColor} 90%, black)`,
    "--primary-foreground": foreground,
    "--primary-soft": `color-mix(in srgb, ${primaryColor} 12%, var(--surface-1))`,
    "--primary-soft-hover": `color-mix(in srgb, ${primaryColor} 20%, var(--surface-1))`,
    "--primary-text": `color-mix(in oklab, ${primaryColor} 55%, var(--text-strong))`,
    "--primary-edge": `color-mix(in oklab, ${primaryColor} 70%, var(--text-strong))`,
    "--focus": "var(--primary-text)",
    "--chart-bar": "var(--primary-edge)",
    "--ring": primaryColor,
    "--sidebar-active-bar": primaryColor,
    "--sidebar-active-bg": `color-mix(in srgb, ${primaryColor} 16%, transparent)`,
    "--sidebar-active-text": `color-mix(in srgb, ${primaryColor} 45%, white)`,
    "--sidebar-primary": primaryColor,
    "--sidebar-primary-foreground": foreground,
    "--sidebar-ring": primaryColor,
  } as CSSProperties;
}
