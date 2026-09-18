import { describe, expect, it } from "vitest";

import { formatarDuracao } from "@/components/relatorios/aba-ia";
import { variacaoPercentual } from "@/components/relatorios/cartao-kpi";
import { janelaDoPeriodo } from "@/lib/queries/relatorios";

// A matematica do periodo e da variacao: e ela que garante que o delta do
// painel compara janelas de MESMA duracao em dias civis da clinica, e que
// nenhum numero vira "+infinito por cento" quando a base e zero.

const TZ = "America/Fortaleza"; // UTC-3 fixo, sem horario de verao

describe("janelaDoPeriodo", () => {
  it("converte dias civis da clínica em limites UTC semiabertos", () => {
    const janela = janelaDoPeriodo(TZ, "2026-09-01", "2026-09-30");
    // 00:00 de 01/09 em Fortaleza = 03:00 UTC
    expect(janela.de).toBe("2026-09-01T03:00:00.000Z");
    // fim EXCLUSIVO: 00:00 de 01/10 local
    expect(janela.ate).toBe("2026-10-01T03:00:00.000Z");
  });

  it("o período anterior é contíguo e tem a mesma duração em dias civis", () => {
    const janela = janelaDoPeriodo(TZ, "2026-09-01", "2026-09-30");
    // 30 dias: o anterior comeca em 02/08 e termina exatamente onde o
    // atual comeca (fim implicito = janela.de)
    expect(janela.deAnterior).toBe("2026-08-02T03:00:00.000Z");
  });

  it("atravessa virada de mês e de ano sem perder dia", () => {
    const janela = janelaDoPeriodo(TZ, "2026-01-05", "2026-01-05");
    // 1 dia: o anterior e o dia 04 inteiro
    expect(janela.deAnterior).toBe("2026-01-04T03:00:00.000Z");
    expect(janela.de).toBe("2026-01-05T03:00:00.000Z");
    const virada = janelaDoPeriodo(TZ, "2026-01-01", "2026-01-10");
    expect(virada.deAnterior).toBe("2025-12-22T03:00:00.000Z");
  });
});

describe("variacaoPercentual", () => {
  it("calcula subida e queda", () => {
    expect(variacaoPercentual(120, 100)).toBeCloseTo(20);
    expect(variacaoPercentual(80, 100)).toBeCloseTo(-20);
    expect(variacaoPercentual(100, 100)).toBe(0);
  });

  it("base zero não vira infinito: devolve null e a tela diz 'sem base'", () => {
    expect(variacaoPercentual(4, 0)).toBeNull();
    expect(variacaoPercentual(0, 0)).toBeNull();
  });
});

describe("formatarDuracao", () => {
  it("formata na linguagem do brief (min e h)", () => {
    expect(formatarDuracao(null)).toBe("sem dados");
    expect(formatarDuracao(30)).toBe("menos de 1 min");
    expect(formatarDuracao(540)).toBe("9 min");
    expect(formatarDuracao(80 * 60)).toBe("1h20");
    expect(formatarDuracao(3 * 60 * 60)).toBe("3h");
    expect(formatarDuracao(3 * 24 * 60 * 60)).toBe("3 dias");
  });
});
