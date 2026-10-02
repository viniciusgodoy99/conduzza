import { describe, expect, it } from "vitest";

import {
  formatarPercentual,
  formatarReaisCompacto,
  formatarReaisCompleto,
  percentualDe,
} from "@/lib/domain/formato-compacto";

// Reais compactos do cartao de metrica: "R$ 284 mil" no lugar de
// "R$ 284.000,00" para nao estourar o cartao a 1366px, com o valor cheio
// disponivel para o rotulo acessivel e o CSV. O espaco e o NBSP do Intl.

const N = "\u00a0";

describe("formatarReaisCompacto", () => {
  it("abaixo de 10 mil vai cheio", () => {
    expect(formatarReaisCompacto(985000)).toBe(`R$${N}9.850,00`);
    expect(formatarReaisCompacto(999999)).toBe(`R$${N}9.999,99`);
    expect(formatarReaisCompacto(0)).toBe(`R$${N}0,00`);
  });

  it("mil com 1 casa abaixo de 100 mil, inteiro acima", () => {
    expect(formatarReaisCompacto(1000000)).toBe(`R$${N}10${N}mil`);
    expect(formatarReaisCompacto(1248000)).toBe(`R$${N}12,5${N}mil`);
    expect(formatarReaisCompacto(28400000)).toBe(`R$${N}284${N}mil`);
    expect(formatarReaisCompacto(28460000)).toBe(`R$${N}285${N}mil`);
  });

  it("milhão e bilhão", () => {
    expect(formatarReaisCompacto(123456700)).toBe(`R$${N}1,2${N}mi`);
    expect(formatarReaisCompacto(100000000)).toBe(`R$${N}1${N}mi`);
    expect(formatarReaisCompacto(300000000000)).toBe(`R$${N}3${N}bi`);
  });

  it("arredondamento que passa de 1.000 sobe de escala", () => {
    expect(formatarReaisCompacto(99996000)).toBe(`R$${N}1${N}mi`);
  });

  it("negativo leva o sinal ASCII na frente", () => {
    expect(formatarReaisCompacto(-1248000)).toBe(`-R$${N}12,5${N}mil`);
  });

  it("nunca usa k nem travessão", () => {
    for (const centavos of [1000000, 28400000, 123456700, 300000000000]) {
      expect(formatarReaisCompacto(centavos)).not.toMatch(/k|\u2014|\u2013/);
    }
  });
});

describe("formatarReaisCompleto", () => {
  it("é o valor cheio do Intl", () => {
    expect(formatarReaisCompleto(28400000)).toBe(`R$${N}284.000,00`);
  });
});

describe("formatarPercentual e percentualDe", () => {
  it("1 casa, sem o símbolo", () => {
    expect(formatarPercentual(64.24)).toBe("64,2");
    expect(formatarPercentual(64)).toBe("64,0");
    expect(formatarPercentual(100)).toBe("100,0");
  });

  it("sem denominador não é 0%", () => {
    expect(percentualDe(3, 0)).toBeNull();
    expect(percentualDe(1, 4)).toBe(25);
  });
});
