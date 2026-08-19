import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Verificacao automatizada de contraste (aceite da tarefa 0.3).
// Parseia os tokens de app/globals.css e afirma os pares que o proprio brief
// de telas (docs/02 secao 3) anota: texto >= 4.5:1, semanticas >= 4.5:1 e
// borda de campo/controle >= 3.0:1, nos dois temas. Se um token mudar e
// quebrar contraste, este teste quebra.

type TokenMap = Record<string, string>;

function parseBlock(css: string, selector: string): TokenMap {
  const blockMatch = css.match(
    new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\}`),
  );
  if (!blockMatch?.[1]) {
    throw new Error(`Bloco ${selector} não encontrado no globals.css`);
  }
  const tokens: TokenMap = {};
  for (const declaration of blockMatch[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const name = declaration[1];
    const value = declaration[2];
    if (name && value) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

function resolveToken(tokens: TokenMap, name: string, depth = 0): string {
  if (depth > 10) {
    throw new Error(`Referência circular ao resolver --${name}`);
  }
  const value = tokens[name];
  if (!value) {
    throw new Error(`Token --${name} não definido`);
  }
  const reference = value.match(/^var\(--([\w-]+)\)$/);
  if (reference?.[1]) {
    return resolveToken(tokens, reference[1], depth + 1);
  }
  return value;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Valor não é hex de 6 dígitos: ${hex}`);
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// Luminancia relativa, formula da WCAG 2.2
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf-8");
const themes = {
  claro: parseBlock(css, ":root"),
  escuro: parseBlock(css, ".dark"),
};

const TEXT_TOKENS = ["foreground", "text-secondary", "text-tertiary"];
const SEMANTIC_TOKENS = [
  "primary",
  "success",
  "warning",
  "alert",
  "neutral",
  "highlight",
];
// A pior superficie de leitura de cada tema: no escuro o texto aparece ate
// sobre a Superficie 4 (modal); no claro as superficies sao brancas.
const WORST_TEXT_SURFACE = { claro: "surface-2", escuro: "surface-4" } as const;
const SEMANTIC_SURFACE = { claro: "surface-2", escuro: "surface-2" } as const;
// Base validada pelo brief para a borda de controle: no escuro contra o fundo
// da aplicacao (3,30:1 anotado na secao 3.2), no claro contra a superficie
// branca onde os campos vivem.
const CONTROL_SURFACE = { claro: "surface-1", escuro: "background" } as const;

describe.each(Object.entries(themes))("tema %s", (themeName, tokens) => {
  const theme = themeName as keyof typeof WORST_TEXT_SURFACE;

  it.each(TEXT_TOKENS)("texto --%s tem 4.5:1 na pior superfície", (token) => {
    const ratio = contrastRatio(
      resolveToken(tokens, token),
      resolveToken(tokens, WORST_TEXT_SURFACE[theme]),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SEMANTIC_TOKENS)(
    "semântica --%s tem 4.5:1 sobre a superfície de card",
    (token) => {
      const ratio = contrastRatio(
        resolveToken(tokens, token),
        resolveToken(tokens, SEMANTIC_SURFACE[theme]),
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("borda de campo (--input) tem 3.0:1 sobre a base validada no brief", () => {
    const ratio = contrastRatio(
      resolveToken(tokens, "input"),
      resolveToken(tokens, CONTROL_SURFACE[theme]),
    );
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });

  it("texto sobre a primária (--primary-foreground) tem 4.5:1", () => {
    const ratio = contrastRatio(
      resolveToken(tokens, "primary-foreground"),
      resolveToken(tokens, "primary"),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // A formula exata do StatusChip: fundo = tinta da cor base sobre o card
  // (color-mix in srgb com --chip-tint), texto e icone na variante forte.
  it.each(SEMANTIC_TOKENS)(
    "chip de --%s: variante forte tem 4.5:1 sobre o fundo tingido",
    (token) => {
      const tintValue = resolveToken(tokens, "chip-tint");
      const tint = Number(tintValue.replace("%", "")) / 100;
      expect(tint).toBeGreaterThan(0);
      const base = hexToRgb(resolveToken(tokens, token));
      const card = hexToRgb(resolveToken(tokens, "card"));
      const mixed = `#${base
        .map((channel, index) => {
          const cardChannel = card[index] ?? 0;
          return Math.round(channel * tint + cardChannel * (1 - tint))
            .toString(16)
            .padStart(2, "0");
        })
        .join("")}`;
      const ratio = contrastRatio(
        resolveToken(tokens, `${token}-strong`),
        mixed,
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("texto sobre a destrutiva (--destructive-foreground) tem 4.5:1", () => {
    const ratio = contrastRatio(
      resolveToken(tokens, "destructive-foreground"),
      resolveToken(tokens, "destructive"),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
