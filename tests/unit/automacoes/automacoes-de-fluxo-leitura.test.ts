import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  AUTOMACAO_SELECT,
  AUTOMACAO_SELECT_DE_ANTES,
  fetchAutomacoesDeFluxo,
  fetchHistoricoDeAutomacoes,
  HISTORICO_SELECT,
  HISTORICO_SELECT_DE_ANTES,
} from "@/lib/queries/automacoes-de-fluxo";

// As leituras da aba Automacoes de fluxo com o banco SEM a migration
// 20261024110000 (revisao de 21/10/2026). O contrato (secao 8) publica o
// codigo do follow-up depois da migration A e antes da B, e o codigo das
// automacoes vai junto: sem a B, o embed das tabelas filhas da PGRST200 e a
// coluna combinar da 42703. A aba nao pode quebrar: a regra le as colunas
// de antes (a acao dela na posicao 1, sem condicao, combinar todas) e o
// historico sai sem o retrato por acao. Com a B, a leitura de sempre; outro
// erro continua sendo erro.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const REGRA = "a1111111-1111-4111-8111-111111111111";

type Erro = { code: string; message: string } | null;
type Resposta = { data: unknown; error: Erro };

/** Cliente de mentira: responde pela lista de colunas pedida. */
function cliente(responder: (colunas: string) => Resposta) {
  const pedidos: string[] = [];
  const supabase = {
    from: () => ({
      select: (colunas: string) => {
        pedidos.push(colunas);
        const cadeia: Record<string, unknown> = {};
        for (const metodo of ["eq", "order", "limit"]) {
          cadeia[metodo] = () => cadeia;
        }
        cadeia.then = (ok: (valor: Resposta) => unknown) =>
          Promise.resolve(responder(colunas)).then(ok);
        return cadeia;
      },
    }),
  };
  return { supabase: supabase as unknown as SupabaseClient, pedidos };
}

const BASE = {
  id: REGRA,
  nome: "Criar atividade em Follow 1",
  ativa: true,
  gatilho: "tempo_na_etapa",
  etapa: "follow_1",
  espera_minutos: 1440,
  vigente_desde: "2026-10-20T20:54:00Z",
  created_at: "2026-10-20T20:54:00Z",
  updated_at: "2026-10-20T20:54:00Z",
};

const DE_ANTES = {
  ...BASE,
  acao: "criar_atividade",
  etapa_destino: null,
  motivo_perda: null,
  etiqueta: null,
  atividade_titulo: "Ligar",
  atividade_prazo_dias: 0,
  nota_texto: null,
};

describe("fetchAutomacoesDeFluxo", () => {
  it("com a migration B: a regra composta, numa ida", async () => {
    const { supabase, pedidos } = cliente(() => ({
      data: [
        {
          ...BASE,
          combinar: "qualquer",
          condicoes: [{ posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiq" }],
          acoes: [
            {
              posicao: 1,
              acao: "criar_atividade",
              etapa_destino: null,
              motivo_perda: null,
              etiqueta: null,
              atividade_titulo: "Ligar",
              atividade_prazo_dias: 0,
              nota_texto: null,
            },
          ],
        },
      ],
      error: null,
    }));
    const [regra] = await fetchAutomacoesDeFluxo(supabase, CLINICA);
    expect(pedidos).toEqual([AUTOMACAO_SELECT]);
    expect(regra).toMatchObject({ combinar: "qualquer" });
    expect(regra?.condicoes).toHaveLength(1);
  });

  it.each(["PGRST200", "42703"])(
    "sem a migration B (%s): as colunas de antes, a ação na posição 1, sem condição",
    async (codigo) => {
      const { supabase, pedidos } = cliente((colunas) =>
        colunas === AUTOMACAO_SELECT
          ? { data: null, error: { code: codigo, message: "sem a B" } }
          : { data: [DE_ANTES], error: null },
      );
      expect(await fetchAutomacoesDeFluxo(supabase, CLINICA)).toEqual([
        {
          ...BASE,
          combinar: "todas",
          condicoes: [],
          acoes: [
            {
              posicao: 1,
              acao: "criar_atividade",
              etapa_destino: null,
              motivo_perda: null,
              etiqueta: null,
              atividade_titulo: "Ligar",
              atividade_prazo_dias: 0,
              nota_texto: null,
            },
          ],
        },
      ]);
      expect(pedidos).toEqual([AUTOMACAO_SELECT, AUTOMACAO_SELECT_DE_ANTES]);
    },
  );

  it("outro erro continua sendo erro (a aba diz que não carregou)", async () => {
    const { supabase, pedidos } = cliente(() => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    }));
    await expect(fetchAutomacoesDeFluxo(supabase, CLINICA)).rejects.toThrow(
      "statement timeout",
    );
    expect(pedidos).toEqual([AUTOMACAO_SELECT]);
  });
});

describe("fetchHistoricoDeAutomacoes", () => {
  const EXECUCAO = {
    id: "e1111111-1111-4111-8111-111111111111",
    automacao_id: REGRA,
    status: "executada",
    motivo: null,
    de_etapa: "follow_1",
    para_etapa: null,
    acao: "criar_atividade",
    etiqueta: null,
    etiqueta_nome: null,
    executada_em: "2026-10-21T21:00:00Z",
    created_at: "2026-10-21T20:59:00Z",
    contact: { name: "Lead" },
  };

  it("sem a migration B: sai sem o retrato por ação, pelo retrato do pai", async () => {
    const { supabase, pedidos } = cliente((colunas) =>
      colunas === HISTORICO_SELECT
        ? { data: null, error: { code: "PGRST200", message: "sem a B" } }
        : { data: [EXECUCAO], error: null },
    );
    const [execucao] = await fetchHistoricoDeAutomacoes(
      supabase,
      CLINICA,
      null,
    );
    expect(pedidos).toEqual([HISTORICO_SELECT, HISTORICO_SELECT_DE_ANTES]);
    expect(execucao).toMatchObject({
      acao: "criar_atividade",
      contato: "Lead",
      acoes: [],
    });
  });

  it("outro erro continua sendo erro", async () => {
    const { supabase } = cliente(() => ({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }));
    await expect(
      fetchHistoricoDeAutomacoes(supabase, CLINICA, REGRA),
    ).rejects.toThrow("permission denied");
  });
});
