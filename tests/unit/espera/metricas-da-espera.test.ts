import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { fetchMetricasDaEspera } from "@/lib/queries/espera";

// O fetcher da RPC metricas_da_espera (Fase 3): uma linha so, contagens
// normalizadas, null que significa algo (receita sem permissao, tempo sem
// vaga preenchida) preservado, e erro ou linha faltando LANCANDO, para a
// tela mostrar o erro em vez de zero. Substitui a leitura antiga em duas
// idas, que engolia o erro da segunda.

function cliente(resposta: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => resposta);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const LINHA_DA_ESPERA = {
  vagas_oferecidas: 34,
  vagas_preenchidas: 24,
  vagas_em_andamento: 2,
  vagas_canceladas: 1,
  vagas_esgotadas: 7,
  primeira_onda_base: 25,
  primeira_onda_aceita: 17,
  tempo_medio_min: 160,
  receita_cents: 1_234_500,
  vagas_com_valor: 22,
  vagas_cobertas: 1,
  vagas_sem_preco: 1,
};

describe("fetchMetricasDaEspera", () => {
  it("chama a RPC da clinica e normaliza a linha", async () => {
    const { supabase, rpc } = cliente({ data: [LINHA_DA_ESPERA], error: null });
    await expect(fetchMetricasDaEspera(supabase, "c1")).resolves.toEqual({
      vagasOferecidas: 34,
      vagasPreenchidas: 24,
      vagasEmAndamento: 2,
      vagasCanceladas: 1,
      vagasEsgotadas: 7,
      primeiraOndaBase: 25,
      primeiraOndaAceita: 17,
      tempoMedioMin: 160,
      receitaCents: 1_234_500,
      vagasComValor: 22,
      vagasCobertas: 1,
      vagasSemPreco: 1,
    });
    expect(rpc).toHaveBeenCalledWith("metricas_da_espera", {
      p_clinic_id: "c1",
    });
  });

  it("receita e tempo null continuam null (sem permissao nao vira zero)", async () => {
    const { supabase } = cliente({
      data: [
        {
          ...LINHA_DA_ESPERA,
          receita_cents: null,
          tempo_medio_min: null,
          vagas_com_valor: null,
          vagas_cobertas: null,
          vagas_sem_preco: null,
        },
      ],
      error: null,
    });
    const metricas = await fetchMetricasDaEspera(supabase, "c1");
    expect(metricas.receitaCents).toBeNull();
    expect(metricas.tempoMedioMin).toBeNull();
    expect(metricas.vagasComValor).toBeNull();
    expect(metricas.vagasCobertas).toBeNull();
    expect(metricas.vagasSemPreco).toBeNull();
  });

  it("bigint que chegar como texto vira numero", async () => {
    const { supabase } = cliente({
      data: [{ ...LINHA_DA_ESPERA, receita_cents: "9007199254740" }],
      error: null,
    });
    const metricas = await fetchMetricasDaEspera(supabase, "c1");
    expect(metricas.receitaCents).toBe(9_007_199_254_740);
  });

  it("erro da RPC lanca", async () => {
    const { supabase } = cliente({
      data: null,
      error: { message: "function metricas_da_espera does not exist" },
    });
    await expect(fetchMetricasDaEspera(supabase, "c1")).rejects.toThrow(
      "does not exist",
    );
  });

  it("sem linha ou com coluna estranha lanca, nunca devolve zero", async () => {
    await expect(
      fetchMetricasDaEspera(cliente({ data: [], error: null }).supabase, "c1"),
    ).rejects.toThrow();
    await expect(
      fetchMetricasDaEspera(
        cliente({
          data: [{ ...LINHA_DA_ESPERA, vagas_preenchidas: null }],
          error: null,
        }).supabase,
        "c1",
      ),
    ).rejects.toThrow("vagas_preenchidas");
  });
});
