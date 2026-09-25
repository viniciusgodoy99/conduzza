import { describe, expect, it } from "vitest";

import {
  dadosDaClinicaSchema,
  ehFusoDoBrasil,
  FUSOS_DO_BRASIL,
} from "@/components/configuracoes/dados-da-clinica";

// Aba "Clinica" das Configuracoes (achado 123 da revisao de liberacao): o
// mesmo schema vale para a tela e para a Server Action. O nome vai para as
// mensagens do paciente e o fuso move a regua e a agenda, entao a lista de
// fusos e fechada.

describe("fusos do Brasil", () => {
  it("são os 16 fusos IANA do Brasil, sem repetição", () => {
    const valores = FUSOS_DO_BRASIL.map((fuso) => fuso.valor);
    expect(valores).toHaveLength(16);
    expect(new Set(valores).size).toBe(16);
    expect(valores).toContain("America/Fortaleza");
    expect(valores).toContain("America/Sao_Paulo");
    expect(valores).toContain("America/Manaus");
    expect(valores).toContain("America/Rio_Branco");
    expect(valores).toContain("America/Noronha");
  });

  it("todo fuso da lista é reconhecido pelo Intl (nenhum nome inventado)", () => {
    for (const { valor } of FUSOS_DO_BRASIL) {
      expect(
        () => new Intl.DateTimeFormat("pt-BR", { timeZone: valor }),
      ).not.toThrow();
    }
  });

  it("nenhum rótulo tem travessão nem meia-risca", () => {
    for (const { rotulo } of FUSOS_DO_BRASIL) {
      expect(rotulo).not.toMatch(/[—–]/);
    }
  });

  it("reconhece só fuso da lista", () => {
    expect(ehFusoDoBrasil("America/Cuiaba")).toBe(true);
    expect(ehFusoDoBrasil("UTC")).toBe(false);
    expect(ehFusoDoBrasil("America/New_York")).toBe(false);
    expect(ehFusoDoBrasil("america/fortaleza")).toBe(false);
  });
});

describe("dadosDaClinicaSchema", () => {
  it("aceita nome e fuso válidos e tira os espaços das pontas", () => {
    const resultado = dadosDaClinicaSchema.safeParse({
      nome: "  Clínica Sorriso  ",
      timezone: "America/Campo_Grande",
    });
    expect(resultado.success).toBe(true);
    expect(resultado.data).toEqual({
      nome: "Clínica Sorriso",
      timezone: "America/Campo_Grande",
    });
  });

  it("recusa nome com menos de 2 letras depois do trim", () => {
    const resultado = dadosDaClinicaSchema.safeParse({
      nome: "  A ",
      timezone: "America/Fortaleza",
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa nome com mais de 80 caracteres", () => {
    expect(
      dadosDaClinicaSchema.safeParse({
        nome: "x".repeat(81),
        timezone: "America/Fortaleza",
      }).success,
    ).toBe(false);
    expect(
      dadosDaClinicaSchema.safeParse({
        nome: "x".repeat(80),
        timezone: "America/Fortaleza",
      }).success,
    ).toBe(true);
  });

  it("recusa fuso fora da lista do Brasil", () => {
    for (const timezone of ["UTC", "Europe/Lisbon", "", "America/Fortaleza "]) {
      expect(
        dadosDaClinicaSchema.safeParse({ nome: "Clínica", timezone }).success,
      ).toBe(false);
    }
  });
});
