import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Verificacao automatizada de contraste (aceite da tarefa 0.3, WCAG AA do
// CLAUDE.md). Parseia os tokens de app/globals.css, compoe cores rgba sobre a
// superficie de base e afirma: texto >= 4.5:1, pares de chip >= 4.5:1, borda
// de campo >= 3.0:1, sidebar >= 4.5:1, nos dois temas. Se um token mudar e
// quebrar contraste, este teste quebra.
//
// Regras de uso que o teste codifica:
// - Texto primario e secundario valem ate a Superficie 5 (linha selecionada).
// - Texto terciario so pode aparecer ate a Superficie 3.

type TokenMap = Record<string, string>;
type Rgba = { r: number; g: number; b: number; a: number };

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

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex?.[1]) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgba?.[1] && rgba[2] && rgba[3]) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`Cor não reconhecida: ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) {
    return fg;
  }
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

// Resolve um token para cor opaca, compondo rgba sobre a cadeia de base.
function opaque(tokens: TokenMap, name: string, baseNames: string[]): Rgba {
  const color = parseColor(resolveToken(tokens, name));
  if (color.a >= 1) {
    return color;
  }
  const [base, ...rest] = baseNames;
  if (!base) {
    throw new Error(`--${name} é translúcido e não há base para compor`);
  }
  return over(color, opaque(tokens, base, rest));
}

// Luminancia relativa, formula da WCAG 2.2
function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

function ratioOf(fg: Rgba, bg: Rgba): number {
  const l1 = luminance(over(fg, bg));
  const l2 = luminance(bg);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function contrast(
  tokens: TokenMap,
  fgName: string,
  bgName: string,
  bgBase: string[] = ["background"],
): number {
  const bg = opaque(tokens, bgName, bgBase);
  const fg = parseColor(resolveToken(tokens, fgName));
  return ratioOf(fg, bg);
}

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf-8");
const themes = {
  claro: parseBlock(css, ":root"),
  escuro: parseBlock(css, ".dark"),
};
// Sidebar e fixa nos dois temas e definida so no :root
const sidebarTokens = themes.claro;

const TONES = ["ai", "info", "success", "warning", "alert", "neutral"];

describe.each(Object.entries(themes))("tema %s", (_themeName, tokens) => {
  it.each(["foreground", "text-secondary"])(
    "texto --%s tem 4.5:1 até a Superfície 5",
    (token) => {
      expect(contrast(tokens, token, "surface-5")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("texto terciário tem 4.5:1 até a Superfície 3", () => {
    expect(
      contrast(tokens, "text-tertiary", "surface-3"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)("chip de --%s: texto tem 4.5:1 sobre o fundo", (toneName) => {
    expect(
      contrast(tokens, `${toneName}-text`, `${toneName}-bg`),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto sobre a primária (--primary-foreground) tem 4.5:1", () => {
    expect(
      contrast(tokens, "primary-foreground", "primary"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto sobre a destrutiva tem 4.5:1", () => {
    expect(
      contrast(tokens, "destructive-foreground", "destructive"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("borda de campo (--input) tem 3.0:1 sobre a superfície de card", () => {
    expect(contrast(tokens, "input", "surface-2")).toBeGreaterThanOrEqual(3.0);
  });
});

describe("sidebar fixa (os dois temas)", () => {
  it("texto da sidebar tem 4.5:1", () => {
    expect(
      contrast(sidebarTokens, "sidebar-foreground", "sidebar"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("rótulo de grupo tem 4.5:1", () => {
    expect(
      contrast(sidebarTokens, "sidebar-muted", "sidebar"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("item ativo tem 4.5:1 sobre o fundo ativo", () => {
    expect(
      contrast(sidebarTokens, "sidebar-active-text", "sidebar-active-bg", [
        "sidebar",
      ]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("badge de não lidas tem 4.5:1", () => {
    expect(
      contrast(sidebarTokens, "sidebar-badge-text", "sidebar-badge"),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
