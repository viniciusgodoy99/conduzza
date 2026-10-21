import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  ambienteDaIaLigado,
  iaLiberadaNoAmbiente,
  lerClinicasHabilitadasDaIa,
  lerConfigDaIa,
  lerConfigDaIaDoBanco,
  TAMANHO_MINIMO_DO_SEGREDO_DO_IDENTIFICADOR,
} from "@/lib/ia/liberacao";
import { identificadorDeSeguranca } from "@/lib/integrations/llm/openai";

// Travas de ambiente da IA (T1 e T2, Fase 3 E0), sem banco de verdade e sem
// chave real. Desde 13/10/2026 o ambiente so diz "producao com chave";
// ligar e escolher a clinica e no sistema. Desde a onda 1 (20/10/2026) a
// lista das clinicas (T2) saiu do codigo: e lida do banco
// (ia_clinicas_da_fase_controlada, que le ia_clinica_habilitada), e aqui o
// banco e um duble que so responde essa funcao.
// A chave abaixo e um texto qualquer: nenhum teste chama a OpenAI.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const CONDUZZA_TESTE = "f0c115dd-e98c-4767-a1bb-93d517844852";
const SALUD_CARE = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
const ALEATORIA = "3f2b8c1e-9d4a-4b7e-8c2f-1a6d5e9b0c7d";

const SEGREDO = "s".repeat(40);

const LIGADO = {
  VERCEL_ENV: "production",
  OPENAI_API_KEY: "chave-de-mentira",
  IA_SEGREDO_DO_IDENTIFICADOR: SEGREDO,
} as const;

/** A lista como o banco devolveria hoje (as duas da semeadura). */
const LISTA_DO_BANCO = [TESTE123, CONDUZZA_TESTE];

type Resposta = { data: unknown; error: unknown };

/** Duble do cliente: so a RPC da lista, com as chamadas registradas. */
function bancoDaLista(resposta: Resposta | (() => Promise<Resposta>)) {
  const chamadas: Array<{ nome: string; args: unknown }> = [];
  const cliente = {
    rpc: async (nome: string, args?: unknown) => {
      chamadas.push({ nome, args });
      return typeof resposta === "function" ? resposta() : resposta;
    },
  } as unknown as SupabaseClient;
  return { cliente, chamadas };
}

describe("T1: producao da Vercel com a chave e o segredo do identificador", () => {
  it("liga com VERCEL_ENV=production, a chave e o segredo, com a lista lida do banco", () => {
    const config = lerConfigDaIa(LISTA_DO_BANCO, LIGADO);
    expect(config.ligado).toBe(true);
    expect(config.clinicas).toEqual([TESTE123, CONDUZZA_TESTE]);
    expect(ambienteDaIaLigado(LIGADO)).toBe(true);
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
    // Revisao do E3 (T3): sem o segredo do identificador todo turno falha
    // em sem_identificador; a aba e a Tela 6 nao podem dizer que esta de pe.
    [
      "sem o segredo do identificador",
      { IA_SEGREDO_DO_IDENTIFICADOR: undefined },
    ],
    ["segredo vazio", { IA_SEGREDO_DO_IDENTIFICADOR: "" }],
    ["segredo curto (31)", { IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(31) }],
    [
      "segredo curto com espacos nas pontas",
      { IA_SEGREDO_DO_IDENTIFICADOR: `  ${"s".repeat(31)}  ` },
    ],
  ])("desligada: %s (a lista do banco nem conta)", (_caso, troca) => {
    const ambiente = { ...LIGADO, ...troca };
    const config = lerConfigDaIa(LISTA_DO_BANCO, ambiente);
    expect(config.ligado).toBe(false);
    expect(config.clinicas).toEqual([]);
    expect(ambienteDaIaLigado(ambiente)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, CONDUZZA_TESTE)).toBe(false);
  });

  it("ambiente vazio: desligada", () => {
    const config = lerConfigDaIa(LISTA_DO_BANCO, {});
    expect(config).toEqual({ ligado: false, clinicas: [] });
  });

  it("sem o ambiente le process.env (aqui nunca ligada: os testes nao rodam em producao)", () => {
    expect(process.env.VERCEL_ENV).not.toBe("production");
    expect(lerConfigDaIa(LISTA_DO_BANCO).ligado).toBe(false);
    expect(ambienteDaIaLigado()).toBe(false);
  });

  it("nunca devolve o valor da chave nem o do segredo", () => {
    const config = lerConfigDaIa(LISTA_DO_BANCO, LIGADO);
    expect(JSON.stringify(config)).not.toContain(LIGADO.OPENAI_API_KEY);
    expect(JSON.stringify(config)).not.toContain(SEGREDO);
  });

  it("o minimo do segredo e o mesmo do safety_identifier: liga exatamente quando o identificador existe", () => {
    for (const tamanho of [0, 31, 32, 64]) {
      const segredo = "s".repeat(tamanho);
      const ligado = lerConfigDaIa(LISTA_DO_BANCO, {
        ...LIGADO,
        IA_SEGREDO_DO_IDENTIFICADOR: segredo,
      }).ligado;
      const identificador = identificadorDeSeguranca({
        clinicId: TESTE123,
        contactId: CONDUZZA_TESTE,
        segredo,
      });
      expect(ligado).toBe(identificador !== null);
      expect(ligado).toBe(
        tamanho >= TAMANHO_MINIMO_DO_SEGREDO_DO_IDENTIFICADOR,
      );
    }
  });
});

describe("T2: so as clinicas que o banco habilita", () => {
  it("fora da lista, nunca: a salud-care e uma uuid aleatoria; a caixa e as pontas nao importam", () => {
    const config = lerConfigDaIa(LISTA_DO_BANCO, LIGADO);
    expect(iaLiberadaNoAmbiente(config, SALUD_CARE)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, ALEATORIA)).toBe(false);
    expect(iaLiberadaNoAmbiente(config, TESTE123.toUpperCase())).toBe(true);
    expect(iaLiberadaNoAmbiente(config, ` ${TESTE123} `)).toBe(true);
  });

  it("a lista e dado: a clinica que o super admin habilita passa sem mudar codigo, e a desligada sai", () => {
    const depois = lerConfigDaIa([TESTE123, SALUD_CARE], LIGADO);
    expect(iaLiberadaNoAmbiente(depois, SALUD_CARE)).toBe(true);
    expect(iaLiberadaNoAmbiente(depois, CONDUZZA_TESTE)).toBe(false);
  });

  it("lista vazia (nenhuma clinica em teste): nenhuma passa, mesmo com T1", () => {
    const config = lerConfigDaIa([], LIGADO);
    expect(config).toEqual({ ligado: true, clinicas: [] });
    expect(iaLiberadaNoAmbiente(config, TESTE123)).toBe(false);
  });

  it("normaliza a lista: so uuid, minusculas, sem repeticao, na ordem recebida", () => {
    const config = lerConfigDaIa(
      [
        CONDUZZA_TESTE.toUpperCase(),
        "",
        "nao-e-uuid",
        TESTE123,
        ` ${CONDUZZA_TESTE} `,
      ],
      LIGADO,
    );
    expect(config.clinicas).toEqual([CONDUZZA_TESTE, TESTE123]);
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
      expect(lerConfigDaIa(LISTA_DO_BANCO, { ...LIGADO, ...antigas })).toEqual(
        lerConfigDaIa(LISTA_DO_BANCO, LIGADO),
      );
    }
    expect(
      lerConfigDaIa(LISTA_DO_BANCO, {
        IA_AGENTE_LIGADO: "sim",
        IA_CLINICAS_LIBERADAS: TESTE123,
      }).ligado,
    ).toBe(false);
  });

  it("o resultado nao muda depois de lido", () => {
    const config = lerConfigDaIa(LISTA_DO_BANCO, LIGADO);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.clinicas)).toBe(true);
    expect(() => (config.clinicas as string[]).push(SALUD_CARE)).toThrow();
  });
});

describe("lerClinicasHabilitadasDaIa: a lista do banco", () => {
  it("chama ia_clinicas_da_fase_controlada sem argumento e devolve a lista normalizada e congelada", async () => {
    const { cliente, chamadas } = bancoDaLista({
      data: [TESTE123.toUpperCase(), CONDUZZA_TESTE, TESTE123],
      error: null,
    });
    const lista = await lerClinicasHabilitadasDaIa(cliente);
    expect(lista).toEqual([TESTE123, CONDUZZA_TESTE]);
    expect(Object.isFrozen(lista)).toBe(true);
    expect(chamadas).toEqual([
      { nome: "ia_clinicas_da_fase_controlada", args: undefined },
    ]);
  });

  it("vazia no banco: lista vazia (nao e erro)", async () => {
    const { cliente } = bancoDaLista({ data: [], error: null });
    expect(await lerClinicasHabilitadasDaIa(cliente)).toEqual([]);
  });

  it("item fora do formato nunca vira clinica liberada", async () => {
    const { cliente } = bancoDaLista({
      data: [null, 42, "abc", { id: TESTE123 }, CONDUZZA_TESTE],
      error: null,
    });
    expect(await lerClinicasHabilitadasDaIa(cliente)).toEqual([CONDUZZA_TESTE]);
  });

  it.each([
    ["erro do banco", { data: null, error: { code: "57014" } }],
    ["permissao negada", { data: null, error: { code: "42501" } }],
    ["resposta que nao e lista", { data: TESTE123, error: null }],
    ["resposta nula", { data: null, error: null }],
  ])("%s: LANCA (quem chama fecha)", async (_caso, resposta) => {
    const { cliente } = bancoDaLista(resposta);
    await expect(lerClinicasHabilitadasDaIa(cliente)).rejects.toThrow(
      "lista de clinicas da IA ilegivel",
    );
  });

  it("falha de rede (a RPC rejeita): lanca tambem", async () => {
    const { cliente } = bancoDaLista(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    await expect(lerClinicasHabilitadasDaIa(cliente)).rejects.toThrow();
  });
});

describe("lerConfigDaIaDoBanco: T1 e T2 de uma vez", () => {
  it("sem T1 nem le o banco: desligada", async () => {
    const { cliente, chamadas } = bancoDaLista({
      data: LISTA_DO_BANCO,
      error: null,
    });
    const config = await lerConfigDaIaDoBanco(cliente, {
      ...LIGADO,
      VERCEL_ENV: "preview",
    });
    expect(config).toEqual({ ligado: false, clinicas: [] });
    expect(chamadas).toEqual([]);
  });

  it("com T1: a lista do banco", async () => {
    const { cliente, chamadas } = bancoDaLista({
      data: [SALUD_CARE],
      error: null,
    });
    const config = await lerConfigDaIaDoBanco(cliente, LIGADO);
    expect(config).toEqual({ ligado: true, clinicas: [SALUD_CARE] });
    expect(chamadas).toHaveLength(1);
  });

  it("com T1 e a lista ilegivel: lanca (nada e liberado por lista nao lida)", async () => {
    const { cliente } = bancoDaLista({ data: null, error: { code: "08006" } });
    await expect(lerConfigDaIaDoBanco(cliente, LIGADO)).rejects.toThrow();
  });
});
