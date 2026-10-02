import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { fetchMetricasDePacientes } from "@/lib/queries/pacientes";

// O fetcher da RPC metricas_de_pacientes (Fase 3): a linha unica da clinica,
// primeiro_comparecimento null preservado (o tipo gerado diz string), e
// erro, linha faltando ou coluna estranha LANCANDO, para os cartoes
// mostrarem o erro em vez de zero.

function cliente(resposta: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => resposta);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const LINHA_DE_PACIENTES = {
  ativos: 1248,
  ativos_30d_atras: 1214,
  novos_no_mes: 86,
  retorno_base: 200,
  retorno_voltaram: 82,
  sem_contato_6m: 212,
  primeiro_comparecimento: "2024-01-10T13:00:00+00:00",
};

describe("fetchMetricasDePacientes", () => {
  it("chama a RPC da clinica e devolve a linha", async () => {
    const { supabase, rpc } = cliente({
      data: [LINHA_DE_PACIENTES],
      error: null,
    });
    await expect(fetchMetricasDePacientes(supabase, "c1")).resolves.toEqual(
      LINHA_DE_PACIENTES,
    );
    expect(rpc).toHaveBeenCalledWith("metricas_de_pacientes", {
      p_clinic_id: "c1",
    });
  });

  it("clinica sem comparecimento: zeros e primeiro_comparecimento null", async () => {
    const { supabase } = cliente({
      data: [
        {
          ativos: 0,
          ativos_30d_atras: 0,
          novos_no_mes: 0,
          retorno_base: 0,
          retorno_voltaram: 0,
          sem_contato_6m: 0,
          primeiro_comparecimento: null,
        },
      ],
      error: null,
    });
    const metricas = await fetchMetricasDePacientes(supabase, "c1");
    expect(metricas.primeiro_comparecimento).toBeNull();
    expect(metricas.ativos).toBe(0);
  });

  it("erro, linha faltando ou coluna estranha lancam", async () => {
    await expect(
      fetchMetricasDePacientes(
        cliente({ data: null, error: { message: "permission denied" } })
          .supabase,
        "c1",
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      fetchMetricasDePacientes(
        cliente({ data: [], error: null }).supabase,
        "c1",
      ),
    ).rejects.toThrow();
    await expect(
      fetchMetricasDePacientes(
        cliente({
          data: [{ ...LINHA_DE_PACIENTES, ativos: "muitos" }],
          error: null,
        }).supabase,
        "c1",
      ),
    ).rejects.toThrow("ativos");
  });
});
