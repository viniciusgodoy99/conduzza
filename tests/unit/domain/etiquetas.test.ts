import { describe, expect, it } from "vitest";

import {
  DIAS_INATIVIDADE_PADRAO,
  estaInativo,
  LIMIAR_RISCO_DE_FALTA,
  temRiscoDeFalta,
} from "@/lib/domain/etiquetas";

// Aceite da 4.1: etiquetas derivadas de risco de falta e inatividade.

const DIA_MS = 24 * 60 * 60 * 1000;

describe("temRiscoDeFalta", () => {
  it("1 falta ainda nao e risco", () => {
    expect(temRiscoDeFalta(0)).toBe(false);
    expect(temRiscoDeFalta(1)).toBe(false);
  });

  it("2 faltas e o limiar exato", () => {
    expect(LIMIAR_RISCO_DE_FALTA).toBe(2);
    expect(temRiscoDeFalta(2)).toBe(true);
  });

  it("3 faltas continua em risco", () => {
    expect(temRiscoDeFalta(3)).toBe(true);
  });
});

describe("estaInativo", () => {
  const agora = new Date("2026-08-25T12:00:00Z");

  it("fronteira exata dos 90 dias NAO e inativo; um ms alem, e", () => {
    expect(DIAS_INATIVIDADE_PADRAO).toBe(90);
    const exatos90 = new Date(agora.getTime() - 90 * DIA_MS);
    expect(
      estaInativo({
        temConsultaFutura: false,
        ultimaConsultaEm: exatos90,
        agora,
      }),
    ).toBe(false);
    const passou = new Date(agora.getTime() - 90 * DIA_MS - 1);
    expect(
      estaInativo({
        temConsultaFutura: false,
        ultimaConsultaEm: passou,
        agora,
      }),
    ).toBe(true);
  });

  it("consulta futura zera a inatividade, nao importa o passado", () => {
    const haMuitoTempo = new Date(agora.getTime() - 400 * DIA_MS);
    expect(
      estaInativo({
        temConsultaFutura: true,
        ultimaConsultaEm: haMuitoTempo,
        agora,
      }),
    ).toBe(false);
  });

  it("paciente sem consulta nenhuma NAO e inativo (nunca foi ativo)", () => {
    expect(
      estaInativo({
        temConsultaFutura: false,
        ultimaConsultaEm: null,
        agora,
      }),
    ).toBe(false);
  });

  it("diasLimite customizado respeita a mesma fronteira", () => {
    const ha30Dias = new Date(agora.getTime() - 30 * DIA_MS);
    expect(
      estaInativo({
        temConsultaFutura: false,
        ultimaConsultaEm: ha30Dias,
        agora,
        diasLimite: 30,
      }),
    ).toBe(false);
    const ha31Dias = new Date(agora.getTime() - 31 * DIA_MS);
    expect(
      estaInativo({
        temConsultaFutura: false,
        ultimaConsultaEm: ha31Dias,
        agora,
        diasLimite: 30,
      }),
    ).toBe(true);
  });
});
