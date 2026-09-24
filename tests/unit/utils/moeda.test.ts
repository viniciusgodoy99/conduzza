import { describe, expect, it } from "vitest";

import {
  centavosParaReais,
  formatarCentavos,
  lerReais,
  reaisParaCentavos,
} from "@/lib/utils/moeda";

// Achado 34: o conversor apagava TODO ponto, entao "250.00" (teclado ou
// navegador em ingles, teclado numerico do celular) era gravado como
// R$ 25.000,00 sem aviso. Agora ponto seguido de 1 ou 2 digitos no fim e
// decimal, grupos de 3 digitos sao milhar, e o resto e invalido.

describe("lerReais", () => {
  it("le o formato brasileiro com virgula decimal", () => {
    expect(lerReais("250,00")).toBe(25000);
    expect(lerReais("1.250,50")).toBe(125050);
    expect(lerReais("1250,5")).toBe(125050);
    expect(lerReais("0,99")).toBe(99);
    expect(lerReais("1.000.000,00")).toBe(100000000);
  });

  it("le ponto seguido de 1 ou 2 digitos no fim como decimal", () => {
    expect(lerReais("250.00")).toBe(25000);
    expect(lerReais("120.50")).toBe(12050);
    expect(lerReais("120.5")).toBe(12050);
    expect(lerReais("1200.00")).toBe(120000);
  });

  it("le grupos de 3 digitos separados por ponto como milhar", () => {
    expect(lerReais("1.200")).toBe(120000);
    expect(lerReais("1.200.000")).toBe(120000000);
  });

  it("le reais inteiros e aceita o prefixo R$ e espacos", () => {
    expect(lerReais("250")).toBe(25000);
    expect(lerReais(" 90,9 ")).toBe(9090);
    expect(lerReais("R$ 250,00")).toBe(25000);
    expect(lerReais("r$250.00")).toBe(25000);
  });

  it("distingue vazio (null) de invalido (undefined)", () => {
    expect(lerReais("")).toBeNull();
    expect(lerReais("   ")).toBeNull();
    expect(lerReais("R$ ")).toBeNull();
    expect(lerReais("abc")).toBeUndefined();
    expect(lerReais("-10")).toBeUndefined();
    expect(lerReais("12,")).toBeUndefined();
  });

  it("recusa formas ambiguas em vez de adivinhar", () => {
    // "1,250" pode ser mil duzentos e cinquenta (ingles) ou 1,25 com um
    // digito a mais: nenhum dos dois e gravado sem a pessoa confirmar.
    expect(lerReais("1,250")).toBeUndefined();
    expect(lerReais("12.3456")).toBeUndefined();
    expect(lerReais("1.2.3")).toBeUndefined();
    expect(lerReais("1.25,50")).toBeUndefined();
    expect(lerReais("1,250.00")).toBeUndefined();
  });
});

describe("reaisParaCentavos (compatibilidade)", () => {
  it("devolve null para vazio e para invalido", () => {
    expect(reaisParaCentavos("")).toBeNull();
    expect(reaisParaCentavos("abc")).toBeNull();
    expect(reaisParaCentavos("250.00")).toBe(25000);
  });

  it("faz ida e volta com centavosParaReais", () => {
    expect(reaisParaCentavos(centavosParaReais(25000))).toBe(25000);
    expect(reaisParaCentavos(centavosParaReais(125050))).toBe(125050);
  });
});

describe("formatarCentavos", () => {
  it("mostra a previa no formato da clinica", () => {
    expect(formatarCentavos(lerReais("250.00") ?? 0)).toMatch(/250,00/);
    expect(formatarCentavos(lerReais("1.200") ?? 0)).toMatch(/1\.200,00/);
  });
});
