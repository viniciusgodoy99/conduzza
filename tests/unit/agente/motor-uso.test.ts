import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  custoEmMicrodolar,
  lerPrecos,
  linhasDoUso,
  precoDoModelo,
  registrarUso,
  type PrecoDoModelo,
} from "@/lib/agente/uso";

// Livro de gasto da IA (lib/agente/uso.ts): custo em microdolar a partir de
// llm_preco (arredondado para cima), preco desconhecido conservador, uma
// linha por chamada e erro ao gravar que nunca derruba a resposta. Os precos
// abaixo sao os de llm_preco em 06/10/2026 (gpt-6-luna e gpt-6.1-sol).

const LUNA: PrecoDoModelo = {
  modelo: "gpt-6-luna",
  entrada: 100_000,
  saida: 500_000,
  cacheLeitura: 10_000,
  cacheEscrita: 125_000,
};
const SOL: PrecoDoModelo = {
  modelo: "gpt-6.1-sol",
  entrada: 2_000_000,
  saida: 10_000_000,
  cacheLeitura: 100_000,
  cacheEscrita: 2_500_000,
};
const PRECOS = [LUNA, SOL];

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custoEmMicrodolar", () => {
  it("soma cada parte vezes o preço por milhão e arredonda para cima", () => {
    // 1.000 de entrada (0,1 US$/M) = 100; 200 de saída (0,5/M) = 100;
    // 3.000 lidos (0,01/M) = 30; 0 gravados.
    expect(
      custoEmMicrodolar(
        {
          tokensEntrada: 1_000,
          tokensSaida: 200,
          tokensCacheLidos: 3_000,
          tokensCacheGravados: 0,
        },
        LUNA,
      ),
    ).toBe(230);
    // 1 token de entrada custa 0,1 microdólar: vira 1, nunca 0.
    expect(
      custoEmMicrodolar(
        {
          tokensEntrada: 1,
          tokensSaida: 0,
          tokensCacheLidos: 0,
          tokensCacheGravados: 0,
        },
        LUNA,
      ),
    ).toBe(1);
  });

  it("ignora contagem negativa, fracionada ou que não é número", () => {
    expect(
      custoEmMicrodolar(
        {
          tokensEntrada: -5,
          tokensSaida: Number.NaN,
          tokensCacheLidos: 0,
          tokensCacheGravados: 0,
        },
        LUNA,
      ),
    ).toBe(0);
  });
});

describe("precoDoModelo", () => {
  it("usa o igual, depois o prefixo conhecido", () => {
    expect(precoDoModelo(PRECOS, "gpt-6-luna")?.preco).toBe(LUNA);
    expect(precoDoModelo(PRECOS, "gpt-6-luna-2026-10-01")).toEqual({
      preco: LUNA,
      conhecido: true,
    });
  });

  it("modelo desconhecido usa o maior preço de cada parte (conservador)", () => {
    const achado = precoDoModelo(PRECOS, "gpt-7-novo");
    expect(achado?.conhecido).toBe(false);
    expect(achado?.preco).toMatchObject({
      entrada: SOL.entrada,
      saida: SOL.saida,
      cacheLeitura: SOL.cacheLeitura,
      cacheEscrita: SOL.cacheEscrita,
    });
    expect(precoDoModelo([], "gpt-6-luna")).toBeNull();
  });
});

describe("linhasDoUso", () => {
  it("uma linha por chamada, com papel, origem e custo, sem texto", () => {
    const { linhas, semPreco } = linhasDoUso({
      clinicId: CLINICA,
      origem: "simulador",
      precos: PRECOS,
      usos: [
        {
          papel: "classificador",
          modelo: "gpt-6-luna",
          uso: {
            tokensEntrada: 500,
            tokensSaida: 20,
            tokensCacheLidos: 0,
            tokensCacheGravados: 0,
          },
        },
        {
          papel: "agente",
          modelo: "x".repeat(150),
          uso: {
            tokensEntrada: 10,
            tokensSaida: 10,
            tokensCacheLidos: 0,
            tokensCacheGravados: 0,
          },
        },
      ],
    });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({
      clinic_id: CLINICA,
      conversation_id: null,
      job_id: null,
      origem: "simulador",
      papel: "classificador",
      modelo: "gpt-6-luna",
      tokens_entrada: 500,
      tokens_saida: 20,
      tokens_cache_lidos: 0,
      tokens_cache_gravados: 0,
      custo_microdolar: 60,
    });
    expect(linhas[1]?.modelo).toHaveLength(100);
    expect(semPreco).toEqual(["x".repeat(100)]);
  });
});

describe("registrarUso", () => {
  function adminFalso(resposta: { error: { code: string } | null }) {
    const insert = vi.fn(async () => resposta);
    const from = vi.fn(() => ({ insert }));
    return { cliente: { from } as unknown as SupabaseClient, insert, from };
  }

  const USO = {
    papel: "agente" as const,
    modelo: "gpt-6-luna",
    uso: {
      tokensEntrada: 100,
      tokensSaida: 50,
      tokensCacheLidos: 0,
      tokensCacheGravados: 0,
    },
  };

  it("grava todas as linhas em ia_uso de uma vez", async () => {
    const admin = adminFalso({ error: null });
    const r = await registrarUso(admin.cliente, {
      clinicId: CLINICA,
      origem: "simulador",
      precos: PRECOS,
      usos: [USO, { ...USO, papel: "verificador" }],
    });
    expect(r).toEqual({ gravadas: 2 });
    expect(admin.from).toHaveBeenCalledWith("ia_uso");
    expect(admin.insert).toHaveBeenCalledTimes(1);
  });

  it("sem uso, não grava nada", async () => {
    const admin = adminFalso({ error: null });
    expect(
      await registrarUso(admin.cliente, {
        clinicId: CLINICA,
        origem: "simulador",
        precos: PRECOS,
        usos: [],
      }),
    ).toEqual({ gravadas: 0 });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("erro ao gravar não lança e o log só leva clínica, contagem e código", async () => {
    const escrito: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
      escrito.push(String(linha));
      return true;
    });
    const admin = adminFalso({ error: { code: "42501" } });
    const r = await registrarUso(admin.cliente, {
      clinicId: CLINICA,
      origem: "simulador",
      precos: PRECOS,
      usos: [USO],
    });
    expect(r).toEqual({ gravadas: 0 });
    const log = escrito.join("");
    expect(log).toContain("ia_uso_nao_gravado");
    expect(log).toContain("42501");

    const lancando = {
      from: () => ({
        insert: () => {
          throw new Error("conteúdo qualquer do paciente");
        },
      }),
    } as unknown as SupabaseClient;
    await expect(
      registrarUso(lancando, {
        clinicId: CLINICA,
        origem: "simulador",
        precos: PRECOS,
        usos: [USO],
      }),
    ).resolves.toEqual({ gravadas: 0 });
    expect(escrito.join("")).not.toContain("paciente");
  });
});

describe("lerPrecos", () => {
  function clienteCom(resposta: { data: unknown; error: unknown }) {
    return {
      from: () => ({ select: async () => resposta }),
    } as unknown as SupabaseClient;
  }

  it("lê bigint como número ou texto", async () => {
    const precos = await lerPrecos(
      clienteCom({
        data: [
          {
            modelo: "gpt-6-luna",
            entrada_microdolar_por_milhao: "100000",
            saida_microdolar_por_milhao: 500000,
            cache_leitura_microdolar_por_milhao: "10000",
            cache_escrita_microdolar_por_milhao: 125000,
          },
        ],
        error: null,
      }),
    );
    expect(precos).toEqual([LUNA]);
  });

  it("erro ou tabela vazia lança (o simulador não roda sem custo)", async () => {
    await expect(
      lerPrecos(clienteCom({ data: null, error: { code: "500" } })),
    ).rejects.toThrow();
    await expect(
      lerPrecos(clienteCom({ data: [], error: null })),
    ).rejects.toThrow();
  });
});
