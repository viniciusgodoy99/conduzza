import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acertarGasto,
  chamadaPodeTerSidoCobrada,
  custoMaximoDaChamada,
  FOLGA_DA_CHAMADA,
  reservarGasto,
  tokensNoMaximo,
  usoEstimadoDaRodada,
  usoEstimadoDoClassificador,
  usoEstimadoDoVerificador,
} from "@/lib/agente/gasto";
import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  MAX_TOKENS_DO_CLASSIFICADOR,
  POLITICA_DO_CLASSIFICADOR,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  MAX_TOKENS_DO_VERIFICADOR,
  POLITICA_DO_VERIFICADOR,
} from "@/lib/integrations/llm/verificador";

// O gasto reservado antes do turno e acertado depois (lib/agente/gasto.ts,
// revisao de 06/10/2026, achados 7, 15 e 21): contas que so erram para
// cima, a RPC de reserva (NULL = teto) e o acerto com uma linha por
// chamada. Banco falso; nada de texto em log.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const RESERVA = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";
const PRECO = {
  modelo: "gpt-6-luna",
  entrada: 100_000,
  saida: 500_000,
  cacheLeitura: 10_000,
  cacheEscrita: 125_000,
};

function adminQueResponde(resposta: { data: unknown; error: unknown }) {
  const rpc = vi.fn<(nome: string, args: unknown) => Promise<typeof resposta>>(
    async () => resposta,
  );
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estimativas (só erram para cima)", () => {
  it("um token por byte em UTF-8, nunca menos", () => {
    expect(tokensNoMaximo("abc")).toBe(3);
    expect(tokensNoMaximo("ção")).toBe(5);
    expect(tokensNoMaximo("💊")).toBe(4);
  });

  it("classificador e verificador: a política, o envelope, a folga e o teto de saída", () => {
    const classificador = usoEstimadoDoClassificador(["Oi, tudo bem?"]);
    expect(classificador.tokensSaida).toBe(MAX_TOKENS_DO_CLASSIFICADOR);
    expect(classificador.tokensEntrada).toBeGreaterThan(
      tokensNoMaximo(POLITICA_DO_CLASSIFICADOR) + FOLGA_DA_CHAMADA,
    );
    const pior = usoEstimadoDoVerificador(null, ["Oi"]);
    const comRascunho = usoEstimadoDoVerificador("Temos sim.", ["Oi"]);
    expect(pior.tokensSaida).toBe(MAX_TOKENS_DO_VERIFICADOR);
    expect(pior.tokensEntrada).toBeGreaterThanOrEqual(
      tokensNoMaximo(POLITICA_DO_VERIFICADOR) + LIMITE_DO_RASCUNHO * 4,
    );
    expect(pior.tokensEntrada).toBeGreaterThan(comRascunho.tokensEntrada);
  });

  it("rodada do agente: o corpo inteiro e o teto de saída", () => {
    const corpo = { instructions: "x".repeat(5_000), input: [] };
    const uso = usoEstimadoDaRodada(corpo, 2_048);
    expect(uso.tokensEntrada).toBeGreaterThanOrEqual(5_000);
    expect(uso.tokensSaida).toBe(2_048);
  });

  it("custo máximo usa o maior preço de entrada (o cache gravado é mais caro)", () => {
    const custo = custoMaximoDaChamada(
      {
        tokensEntrada: 1_000_000,
        tokensSaida: 0,
        tokensCacheLidos: 0,
        tokensCacheGravados: 0,
      },
      "gpt-6-luna",
      [PRECO],
    );
    expect(custo).toBe(PRECO.cacheEscrita);
    expect(
      custoMaximoDaChamada(
        {
          tokensEntrada: 0,
          tokensSaida: 1,
          tokensCacheLidos: 0,
          tokensCacheGravados: 0,
        },
        "gpt-6-luna",
        [PRECO],
      ),
    ).toBe(1);
    expect(
      custoMaximoDaChamada(
        {
          tokensEntrada: 1,
          tokensSaida: 1,
          tokensCacheLidos: 0,
          tokensCacheGravados: 0,
        },
        "gpt-6-luna",
        [],
      ),
    ).toBeNull();
  });

  it("só a chamada que nem saiu ou que a API recusou antes fica de fora", () => {
    for (const motivo of [
      "sem_cliente",
      "modelo_invalido",
      "requisicao_invalida",
      "autenticacao",
      "permissao",
      "nao_encontrado",
      "prazo",
      "contexto_truncado",
    ]) {
      expect(chamadaPodeTerSidoCobrada(motivo), motivo).toBe(false);
    }
    for (const motivo of [
      "timeout",
      "conexao",
      "abortado",
      "limite",
      "servidor",
      "desconhecida",
      "saida_invalida",
      undefined,
    ]) {
      expect(chamadaPodeTerSidoCobrada(motivo), String(motivo)).toBe(true);
    }
  });
});

describe("reservarGasto", () => {
  it("devolve o id da reserva, pedida pela service role com o custo inteiro", async () => {
    const { admin, rpc } = adminQueResponde({ data: RESERVA, error: null });
    expect(
      await reservarGasto(admin, {
        clinicId: CLINICA,
        origem: "simulador",
        custoMicrodolar: 1234.2,
      }),
    ).toEqual({ tipo: "reservado", id: RESERVA });
    expect(rpc).toHaveBeenCalledWith("reservar_gasto_da_ia", {
      p_clinic_id: CLINICA,
      p_origem: "simulador",
      p_custo_microdolar: 1235,
    });
  });

  it("NULL é o teto; erro, lixo ou custo inválido é falha fechada", async () => {
    expect(
      await reservarGasto(adminQueResponde({ data: null, error: null }).admin, {
        clinicId: CLINICA,
        origem: "simulador",
        custoMicrodolar: 10,
      }),
    ).toEqual({ tipo: "teto" });
    for (const resposta of [
      { data: null, error: { code: "42883" } },
      { data: "nao-e-uuid", error: null },
      { data: 7, error: null },
    ]) {
      expect(
        await reservarGasto(adminQueResponde(resposta).admin, {
          clinicId: CLINICA,
          origem: "simulador",
          custoMicrodolar: 10,
        }),
      ).toEqual({ tipo: "erro" });
    }
    const { admin, rpc } = adminQueResponde({ data: RESERVA, error: null });
    for (const custo of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(
        await reservarGasto(admin, {
          clinicId: CLINICA,
          origem: "simulador",
          custoMicrodolar: custo,
        }),
      ).toEqual({ tipo: "erro" });
    }
    expect(rpc).not.toHaveBeenCalled();
    const lancou = {
      rpc: async () => {
        throw new Error("rede");
      },
    } as unknown as SupabaseClient;
    expect(
      await reservarGasto(lancou, {
        clinicId: CLINICA,
        origem: "simulador",
        custoMicrodolar: 10,
      }),
    ).toEqual({ tipo: "erro" });
  });
});

describe("acertarGasto", () => {
  const usos = [
    {
      papel: "classificador" as const,
      modelo: "gpt-6-luna",
      uso: {
        tokensEntrada: 100,
        tokensSaida: 10,
        tokensCacheLidos: 0,
        tokensCacheGravados: 0,
      },
    },
    {
      papel: "agente" as const,
      modelo: "gpt-6-luna",
      uso: {
        tokensEntrada: 2_000,
        tokensSaida: 300,
        tokensCacheLidos: 1_000,
        tokensCacheGravados: 0,
      },
    },
  ];

  it("troca a reserva por uma linha por chamada, no formato de ia_uso", async () => {
    const { admin, rpc } = adminQueResponde({ data: null, error: null });
    expect(
      await acertarGasto(admin, {
        reservaId: RESERVA,
        clinicId: CLINICA,
        origem: "simulador",
        usos,
        precos: [PRECO],
      }),
    ).toBe(true);
    const [nome, args] = rpc.mock.calls[0] ?? [];
    expect(nome).toBe("acertar_gasto_da_ia");
    const { p_reserva, p_linhas } = args as {
      p_reserva: string;
      p_linhas: Record<string, unknown>[];
    };
    expect(p_reserva).toBe(RESERVA);
    expect(p_linhas.map((l) => [l.papel, l.origem, l.clinic_id])).toEqual([
      ["classificador", "simulador", CLINICA],
      ["agente", "simulador", CLINICA],
    ]);
    expect(p_linhas[1]).toMatchObject({
      tokens_entrada: 2_000,
      tokens_cache_lidos: 1_000,
      custo_microdolar: 360,
    });
  });

  it("sem chamada nenhuma, só solta a reserva", async () => {
    const { admin, rpc } = adminQueResponde({ data: null, error: null });
    await acertarGasto(admin, {
      reservaId: RESERVA,
      clinicId: CLINICA,
      origem: "simulador",
      usos: [],
      precos: [PRECO],
    });
    expect(rpc).toHaveBeenCalledWith("acertar_gasto_da_ia", {
      p_reserva: RESERVA,
      p_linhas: [],
    });
  });

  it("erro não lança: a reserva fica (conservador) e o log só leva clínica, contagem e código", async () => {
    const { admin } = adminQueResponde({
      data: null,
      error: { code: "P0002", message: "texto qualquer do banco" },
    });
    expect(
      await acertarGasto(admin, {
        reservaId: RESERVA,
        clinicId: CLINICA,
        origem: "simulador",
        usos,
        precos: [PRECO],
      }),
    ).toBe(false);
    const log = escrito.join("");
    expect(log).toContain('"evento":"ia_uso_nao_acertado"');
    expect(log).toContain('"count":2');
    expect(log).toContain('"error_code":"P0002"');
    expect(log).not.toContain("texto qualquer");
  });
});
