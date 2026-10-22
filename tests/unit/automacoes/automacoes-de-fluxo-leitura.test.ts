import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  AUTOMACAO_SELECT,
  fetchAutomacoesDeFluxo,
  fetchHistoricoDeAutomacoes,
  HISTORICO_SELECT,
} from "@/lib/queries/automacoes-de-fluxo";

// As leituras da aba Automacoes de fluxo. O codigo da onda 4 sobe DEPOIS das
// migrations 20261024100000 e 20261024110000 (ordem decidida pelo
// coordenador em 22/10/2026) e depende delas: a regra vem com as filhas (o
// "Se" e o "Faz") numa ida so, e o historico com o retrato por acao. Sem a B
// (o embed das filhas da PGRST200, a coluna combinar da 42703) a leitura e
// erro como outro qualquer e a aba mostra o proprio estado de erro: falha
// fechada, sem cair nas colunas de antes, que nao tem as condicoes nem a
// ordem das acoes (correcao de 22/10/2026).

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
    "sem a migration B (%s): erro, sem cair nas colunas de antes (a aba diz que não carregou)",
    async (codigo) => {
      const { supabase, pedidos } = cliente(() => ({
        data: null,
        error: { code: codigo, message: "sem a B" },
      }));
      await expect(fetchAutomacoesDeFluxo(supabase, CLINICA)).rejects.toThrow(
        "sem a B",
      );
      expect(pedidos).toEqual([AUTOMACAO_SELECT]);
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

  it("com a migration B: o retrato por ação na ordem da posição", async () => {
    const { supabase, pedidos } = cliente(() => ({
      data: [
        {
          ...EXECUCAO,
          acao: null,
          acoes: [
            {
              posicao: 2,
              acao: "etiquetar",
              status: "pulada",
              motivo: "ja_tinha_etiqueta",
              para_etapa: null,
              etiqueta: null,
              etiqueta_nome: null,
              executada_em: null,
            },
            {
              posicao: 1,
              acao: "criar_atividade",
              status: "executada",
              motivo: null,
              para_etapa: null,
              etiqueta: null,
              etiqueta_nome: null,
              executada_em: "2026-10-21T21:00:00Z",
            },
          ],
        },
      ],
      error: null,
    }));
    const [execucao] = await fetchHistoricoDeAutomacoes(
      supabase,
      CLINICA,
      null,
    );
    expect(pedidos).toEqual([HISTORICO_SELECT]);
    expect(execucao?.contato).toBe("Lead");
    expect(execucao?.acoes.map((acao) => acao.posicao)).toEqual([1, 2]);
  });

  it("sem a migration B (PGRST200): erro, sem cair no histórico de antes", async () => {
    const { supabase, pedidos } = cliente(() => ({
      data: null,
      error: { code: "PGRST200", message: "sem a B" },
    }));
    await expect(
      fetchHistoricoDeAutomacoes(supabase, CLINICA, null),
    ).rejects.toThrow("sem a B");
    expect(pedidos).toEqual([HISTORICO_SELECT]);
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
