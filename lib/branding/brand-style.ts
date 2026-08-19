import "server-only";

import type { CSSProperties } from "react";

// Cor primaria do white-label como CSS custom properties injetadas no <html>
// pelo servidor (docs/03 secao 8): nada de recompilar Tailwind por cliente.
// A marca padrao (lime Conduzza) NAO e injetada: o globals.css cuida dela com
// os pares claro/escuro validados em contraste. Cor custom de clinica e
// aplicada como veio; a validacao de contraste no editor de marca e da Tela
// 12 (Fase 5), risco aceito e registrado no plano.

const DEFAULT_PRIMARY = "#a8d318";
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
  if (primaryColor.toLowerCase() === DEFAULT_PRIMARY) {
    return undefined;
  }
  const foreground = luminance(primaryColor) > 0.45 ? "#10160a" : "#ffffff";
  return {
    "--primary": primaryColor,
    "--primary-hover": primaryColor,
    "--primary-foreground": foreground,
    "--ring": primaryColor,
    "--sidebar-active-bar": primaryColor,
    "--sidebar-active-bg": `color-mix(in srgb, ${primaryColor} 16%, transparent)`,
    "--sidebar-active-text": `color-mix(in srgb, ${primaryColor} 45%, white)`,
    "--sidebar-primary": primaryColor,
  } as CSSProperties;
}
