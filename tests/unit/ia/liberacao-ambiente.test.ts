import { describe, expect, it } from "vitest";

import {
  CLINICAS_DA_FASE_CONTROLADA,
  iaLiberadaNoAmbiente,
  lerConfigDaIa,
} from "@/lib/ia/liberacao";

// Travas de ambiente da IA (T1 e T2, Fase 3 E0), sem banco e sem chave real.
// A chave abaixo e um texto qualquer: nenhum teste chama a Anthropic.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const CONDUZZA_TESTE = "f0c115dd-e98c-4767-a1bb-93d517844852";
const SALUD_CARE = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
const ALEATORIA = "3f2b8c1e-9d4a-4b7e-8c2f-1a6d5e9b0c7d";

const LIGADO = {
  IA_AGENTE_LIGADO: "sim",
  VERCEL_ENV: "production",
  ANTHROPIC_API_KEY: "chave-de-mentira",
  IA_CLINICAS_LIBERADAS: `${TESTE123},${CONDUZZA_TESTE}`,
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

describe("T1: interruptor de ambiente", () => {
  it("liga so com IA_AGENTE_LIGADO=sim, VERCEL_ENV=production e a chave", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(config.ligado).toBe(true);
    expect(config.clinicas).toEqual([TESTE123, CONDUZZA_TESTE]);
  });

  it.each([
    ["sem IA_AGENTE_LIGADO", { IA_AGENTE_LIGADO: undefined }],
    ["IA_AGENTE_LIGADO=SIM", { IA_AGENTE_LIGADO: "SIM" }],
    ["IA_AGENTE_LIGADO=true", { IA_AGENTE_LIGADO: "true" }],
    ["IA_AGENTE_LIGADO=1", { IA_AGENTE_LIGADO: "1" }],
    ["IA_AGENTE_LIGADO com espaco", { IA_AGENTE_LIGADO: " sim" }],
    ["IA_AGENTE_LIGADO=nao", { IA_AGENTE_LIGADO: "nao" }],
    ["sem VERCEL_ENV", { VERCEL_ENV: undefined }],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
    ["VERCEL_ENV=Production", { VERCEL_ENV: "Production" }],
    ["sem chave", { ANTHROPIC_API_KEY: undefined }],
    ["chave vazia", { ANTHROPIC_API_KEY: "" }],
    ["chave so com espacos", { ANTHROPIC_API_KEY: "   " }],
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
    expect(JSON.stringify(config)).not.toContain(LIGADO.ANTHROPIC_API_KEY);
  });
});

describe("T2: lista do ambiente cruzada com a constante", () => {
  it("o ambiente estreita: so uma das duas", () => {
    const config = lerConfigDaIa({
      ...LIGADO,
      IA_CLINICAS_LIBERADAS: CONDUZZA_TESTE,
    });
    expect(config.clinicas).toEqual([CONDUZZA_TESTE]);
    expect(iaLiberadaNoAmbiente(config, CONDUZZA_TESTE)).toBe(true);
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(false);
  });

  it("o ambiente nunca amplia: a salud-care e uma uuid aleatoria ficam de fora", () => {
    const config = lerConfigDaIa({
      ...LIGADO,
      IA_CLINICAS_LIBERADAS: `${SALUD_CARE},${ALEATORIA},${TESTE123}`,
    });
    expect(config.clinicas).toEqual([TESTE123]);
    expect(iaLiberadaNoAmbiente(config, SALUD_CARE)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, ALEATORIA)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(true);
  });

  it("so a salud-care no ambiente: nenhuma clinica", () => {
    const config = lerConfigDaIa({
      ...LIGADO,
      IA_CLINICAS_LIBERADAS: SALUD_CARE,
    });
    expect(config.ligado).toBe(true);
    expect(config.clinicas).toEqual([]);
    expect(iaLiberadaNoAmbiente(config, SALUD_CARE)).toBe(false);
  });

  it.each([
    ["texto qualquer", `${TESTE123},teste123`],
    ["uuid truncada", `${TESTE123},${CONDUZZA_TESTE.slice(0, 30)}`],
    ["uuid com chaves", `${TESTE123},{${CONDUZZA_TESTE}}`],
    ["ponto e virgula no lugar da virgula", `${TESTE123};${CONDUZZA_TESTE}`],
    ["espaco no meio", `${TESTE123} ${CONDUZZA_TESTE}`],
    ["uuid sem hifens", CONDUZZA_TESTE.replaceAll("-", "")],
  ])("valor que nao e uuid derruba a lista inteira: %s", (_caso, valor) => {
    const config = lerConfigDaIa({ ...LIGADO, IA_CLINICAS_LIBERADAS: valor });
    expect(config.clinicas).toEqual([]);
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, CONDUZZA_TESTE)).toBe(false);
  });

  it("lista vazia ou ausente: ligada sem nenhuma clinica", () => {
    for (const valor of [undefined, "", " ", ",", " , "]) {
      const config = lerConfigDaIa({ ...LIGADO, IA_CLINICAS_LIBERADAS: valor });
      expect(config.ligado).toBe(true);
      expect(config.clinicas).toEqual([]);
    }
  });

  it("aceita espacos, maiusculas e repeticao, sem duplicar", () => {
    const config = lerConfigDaIa({
      ...LIGADO,
      IA_CLINICAS_LIBERADAS: ` ${TESTE123.toUpperCase()} ,${TESTE123},, ${CONDUZZA_TESTE} `,
    });
    expect(config.clinicas).toEqual([TESTE123, CONDUZZA_TESTE]);
    expect(iaLiberadaNoAmbiente(config, TESTE123.toUpperCase())).toBe(true);
  });

  it("nenhuma combinacao do ambiente sai da constante", () => {
    const candidatas = [TESTE123, CONDUZZA_TESTE, SALUD_CARE, ALEATORIA];
    for (let mascara = 0; mascara < 1 << candidatas.length; mascara++) {
      const escolhidas = candidatas.filter((_, i) => mascara & (1 << i));
      const config = lerConfigDaIa({
        ...LIGADO,
        IA_CLINICAS_LIBERADAS: escolhidas.join(","),
      });
      for (const id of config.clinicas) {
        expect(CLINICAS_DA_FASE_CONTROLADA).toContain(id);
      }
      expect(config.clinicas).not.toContain(SALUD_CARE);
      expect(config.clinicas).not.toContain(ALEATORIA);
    }
  });

  it("o resultado nao muda depois de lido", () => {
    const config = lerConfigDaIa(LIGADO);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.clinicas)).toBe(true);
  });
});
