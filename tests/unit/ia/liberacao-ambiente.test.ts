import { describe, expect, it } from "vitest";

import {
  CLINICAS_DA_FASE_CONTROLADA,
  iaLiberadaNoAmbiente,
  lerConfigDaIa,
} from "@/lib/ia/liberacao";

// Travas de ambiente da IA (T1 e T2, Fase 3 E0), sem banco e sem chave real.
// Desde 13/10/2026 o ambiente so diz "producao com chave"; ligar e escolher
// a clinica e no sistema.
// A chave abaixo e um texto qualquer: nenhum teste chama a OpenAI.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const CONDUZZA_TESTE = "f0c115dd-e98c-4767-a1bb-93d517844852";
const SALUD_CARE = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
const ALEATORIA = "3f2b8c1e-9d4a-4b7e-8c2f-1a6d5e9b0c7d";

const LIGADO = {
  VERCEL_ENV: "production",
  OPENAI_API_KEY: "chave-de-mentira",
} as const;

describe("CLINICAS_DA_FASE_CONTROLADA", () => {
  it("tem exatamente as duas clinicas do dono, e nunca a salud-care", () => {
    expect([...CLINICAS_DA_FASE_CONTROLADA]).toEqual([
      TESTE123,
      CONDUZZA_TESTE,
    ]);
    expect(CLINICAS_DA_FASE_CONTROLADA).not.toContain(SALUD_CARE);
  });

  it("nao muda em tempo de execucao", () => {
    expect(Object.isFrozen(CLINICAS_DA_FASE_CONTROLADA)).toBe(true);
    expect(() =>
      (CLINICAS_DA_FASE_CONTROLADA as string[]).push(SALUD_CARE),
    ).toThrow();
    expect(CLINICAS_DA_FASE_CONTROLADA).toHaveLength(2);
  });
});

describe("T1: producao da Vercel com a chave", () => {
  it("liga com VERCEL_ENV=production e a chave, com as duas clinicas da lista fechada", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(config.ligado).toBe(true);
    expect(config.clinicas).toEqual([TESTE123, CONDUZZA_TESTE]);
  });

  it.each([
    ["sem VERCEL_ENV", { VERCEL_ENV: undefined }],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
    ["VERCEL_ENV=Production", { VERCEL_ENV: "Production" }],
    ["sem chave", { OPENAI_API_KEY: undefined }],
    ["chave vazia", { OPENAI_API_KEY: "" }],
    ["chave so com espacos", { OPENAI_API_KEY: "   " }],
    [
      "so a chave da transcricao (UAZAPI_OPENAI_KEY) nao liga",
      { OPENAI_API_KEY: undefined, UAZAPI_OPENAI_KEY: "chave-da-uazapi" },
    ],
    [
      "chave antiga da Anthropic nao liga mais",
      { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: "chave-antiga" },
    ],
  ])("desligada: %s", (_caso, troca) => {
    const config = lerConfigDaIa({ ...LIGADO, ...troca });
    expect(config.ligado).toBe(false);
    expect(config.clinicas).toEqual([]);
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, CONDUZZA_TESTE)).toBe(false);
  });

  it("ambiente vazio: desligada", () => {
    const config = lerConfigDaIa({});
    expect(config).toEqual({ ligado: false, clinicas: [] });
  });

  it("sem argumento le process.env (aqui nunca ligada: os testes nao rodam em producao)", () => {
    expect(process.env.VERCEL_ENV).not.toBe("production");
    expect(lerConfigDaIa().ligado).toBe(false);
  });

  it("nunca devolve o valor da chave", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(JSON.stringify(config)).not.toContain(LIGADO.OPENAI_API_KEY);
  });
});

describe("T2: so a lista fechada do codigo", () => {
  it("fora da lista, nunca: a salud-care e uma uuid aleatoria", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(iaLiberadaNoAmbiente(config, SALUD_CARE)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, ALEATORIA)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, TESTE123.toUpperCase())).toBe(true);
  });

  it("as variaveis antigas (IA_AGENTE_LIGADO e IA_CLINICAS_LIBERADAS) nao mudam nada", () => {
    // Decisao do dono em 13/10/2026: ligar, desligar e escolher a clinica e
    // no sistema (interruptor geral e liberacao por clinica, no banco).
    for (const antigas of [
      { IA_AGENTE_LIGADO: "nao" },
      { IA_AGENTE_LIGADO: "sim" },
      { IA_CLINICAS_LIBERADAS: "" },
      { IA_CLINICAS_LIBERADAS: CONDUZZA_TESTE },
      { IA_CLINICAS_LIBERADAS: `${SALUD_CARE},${ALEATORIA}` },
    ]) {
      expect(lerConfigDaIa({ ...LIGADO, ...antigas })).toEqual(
        lerConfigDaIa(LIGADO),
      );
    }
    expect(
      lerConfigDaIa({
        IA_AGENTE_LIGADO: "sim",
        IA_CLINICAS_LIBERADAS: TESTE123,
      }).ligado,
    ).toBe(false);
  });

  it("o resultado nao muda depois de lido", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.clinicas)).toBe(true);
  });
});
