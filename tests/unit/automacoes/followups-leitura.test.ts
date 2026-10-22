import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchFollowups } from "@/lib/queries/automacoes";
import { fetchReguasDeFollowup } from "@/lib/queries/leads";

import {
  bancoFalso,
  type ChamadaDeTabela,
  type Resposta,
} from "../jobs/banco-falso";

// As leituras das reguas de follow-up por etiqueta (onda 4, item 16), com o
// cliente do Supabase trocado por um duble que responde por tabela e por
// RPC. O que se prova aqui:
//   - a tela le o filtro de cada regua (etiquetas, modo e ordem) e as
//     contagens de hoje numa RPC so (alcance_das_reguas_de_followup), sem
//     contar paciente no codigo;
//   - banco sem a migration 20261024100000 (42703, a coluna nao existe): o
//     codigo sobe depois dela e falha fechado, sem ler as reguas sem o
//     filtro (correcao de 22/10/2026): a aba mostra o erro, e Leads confirma
//     toda mudanca de etapa dizendo que nao deu para conferir;
//   - contagem que falha (ou vem com outra forma) vira "nao carregou", nunca
//     numero inventado; a estimativa cai na contagem da etapa inteira;
//   - em Leads, as reguas ligadas com passo, na ordem da precedencia de cada
//     etapa (com etiqueta antes da geral).

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const GERAL = "a1111111-1111-4111-8111-111111111111";
const PSIQUIATRIA = "b2222222-2222-4222-8222-222222222222";

const SEM_COLUNA: Resposta = {
  data: null,
  error: { code: "42703", message: "column cadence.etiquetas does not exist" },
};

/** As colunas pedidas no select desta chamada. */
function colunas(chamada: ChamadaDeTabela): string {
  return String(
    chamada.metodos.find((metodo) => metodo.metodo === "select")?.args[0] ?? "",
  );
}

const LINHA_DA_GERAL = {
  id: GERAL,
  name: "Follow-up de Em contato",
  active: true,
  send_window_start: "08:00:00",
  send_window_end: "18:00:00",
  send_weekdays: [1, 2, 3, 4, 5],
  trigger_stage: "em_contato",
  created_at: "2026-10-24T12:00:00+00:00",
};
const LINHA_DA_PSIQUIATRIA = {
  ...LINHA_DA_GERAL,
  id: PSIQUIATRIA,
  name: "Psiquiatria",
  active: false,
};

function banco(opcoes: {
  /** O banco ainda sem as colunas do filtro. */
  semFiltro?: boolean;
  alcance?: Resposta;
  /** A contagem de entradas da etapa (o plano B da estimativa). */
  entradasDaEtapa?: number;
}) {
  return bancoFalso({
    tabelas: {
      cadence: (chamada) => {
        const pedidas = colunas(chamada);
        if (pedidas.includes("etiquetas")) {
          return opcoes.semFiltro
            ? SEM_COLUNA
            : {
                data: [
                  {
                    ...LINHA_DA_GERAL,
                    etiquetas: [],
                    etiquetas_modo: "qualquer",
                    prioridade: 0,
                  },
                  {
                    ...LINHA_DA_PSIQUIATRIA,
                    etiquetas: ["Psiquiatria"],
                    etiquetas_modo: "todas",
                    prioridade: 2,
                  },
                ],
                error: null,
              };
        }
        return { data: [LINHA_DA_GERAL, LINHA_DA_PSIQUIATRIA], error: null };
      },
      funnel_stage_def: () => ({
        data: [{ chave: "em_contato", nome: "Em contato" }],
        error: null,
      }),
      cadence_step: () => ({ data: [], error: null }),
      cadence_run: () => ({ data: [], error: null }),
      contact: () =>
        ({
          data: null,
          error: null,
          count: opcoes.entradasDaEtapa ?? 0,
        }) as Resposta,
    },
    rpcs: {
      alcance_das_reguas_de_followup: () =>
        opcoes.alcance ?? {
          data: {
            reguas: [
              {
                id: GERAL,
                casam: 10,
                recebem: 8,
                sem_autorizacao: 1,
                entradas_30d: 6,
              },
              {
                id: PSIQUIATRIA,
                casam: 2,
                recebem: 0,
                sem_autorizacao: 0,
                entradas_30d: 1,
              },
            ],
            etapas: [{ chave: "em_contato", sem_regua: 0 }],
          },
          error: null,
        },
    },
  });
}

describe("fetchFollowups", () => {
  it("o filtro de cada régua e as contagens de hoje, numa RPC só", async () => {
    const b = banco({});
    const dados = await fetchFollowups(b.admin, CLINICA);
    expect(b.chamadasDe("alcance_das_reguas_de_followup")).toEqual([
      { p_clinic_id: CLINICA },
    ]);
    expect(dados.semReguaPorEtapa).toEqual({ em_contato: 0 });
    const psiquiatria = dados.reguas.find((regua) => regua.id === PSIQUIATRIA);
    expect(psiquiatria).toMatchObject({
      etiquetas: ["Psiquiatria"],
      etiquetas_modo: "todas",
      prioridade: 2,
      etapa_nome: "Em contato",
      eventos30d: 1,
      alcance: { casam: 2, recebem: 0, sem_autorizacao: 0, entradas_30d: 1 },
    });
    expect(dados.reguas.find((regua) => regua.id === GERAL)?.alcance).toEqual({
      casam: 10,
      recebem: 8,
      sem_autorizacao: 1,
      entradas_30d: 6,
    });
    // Nenhum contato e lido para contar (a conta e do banco).
    expect(b.tabelas.filter((t) => t.tabela === "contact")).toEqual([]);
  });

  it("banco sem a migration (42703): falha fechada, sem ler as réguas sem o filtro", async () => {
    const b = banco({ semFiltro: true, alcance: SEM_COLUNA });
    await expect(fetchFollowups(b.admin, CLINICA)).rejects.toThrow(
      "column cadence.etiquetas does not exist",
    );
    // Uma leitura so de cadence, com o filtro: nenhuma segunda tentativa.
    const leituras = b.tabelas.filter((t) => t.tabela === "cadence");
    expect(leituras.map(colunas).map((c) => c.includes("etiquetas"))).toEqual([
      true,
    ]);
  });

  it("contagem que falha: nulo, e a estimativa cai na etapa inteira", async () => {
    const b = banco({
      alcance: { data: null, error: { code: "57014", message: "timeout" } },
      entradasDaEtapa: 14,
    });
    const dados = await fetchFollowups(b.admin, CLINICA);
    expect(dados.semReguaPorEtapa).toBeNull();
    expect(dados.reguas.map((regua) => regua.alcance)).toEqual([null, null]);
    expect(dados.reguas.map((regua) => regua.eventos30d)).toEqual([14, 14]);
    // Uma contagem por etapa, nao por regua.
    expect(b.tabelas.filter((t) => t.tabela === "contact")).toHaveLength(1);
  });

  it("contagem com outra forma: também não carregou (nunca número inventado)", async () => {
    const b = banco({
      alcance: { data: { reguas: [{ id: GERAL, casam: "10" }] }, error: null },
    });
    const dados = await fetchFollowups(b.admin, CLINICA);
    expect(dados.semReguaPorEtapa).toBeNull();
    expect(dados.reguas.every((regua) => regua.alcance === null)).toBe(true);
  });

  it("outro erro na leitura das réguas lança (a tela mostra o erro)", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence: () => ({
          data: null,
          error: { code: "42501", message: "permission denied" },
        }),
      },
    });
    await expect(fetchFollowups(b.admin, CLINICA)).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("fetchReguasDeFollowup (Leads)", () => {
  const passo = { cadence_step: [{ id: "passo" }] };

  it("as ligadas com passo, na ordem da precedência de cada etapa", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence: () => ({
          data: [
            {
              id: "g",
              trigger_stage: "em_contato",
              name: "Geral",
              created_at: "2026-10-24T12:00:00Z",
              etiquetas: [],
              etiquetas_modo: "qualquer",
              prioridade: 0,
              ...passo,
            },
            {
              id: "o",
              trigger_stage: "em_contato",
              name: "Odonto",
              created_at: "2026-10-24T12:00:00Z",
              etiquetas: ["Odontologia"],
              etiquetas_modo: "todas",
              prioridade: 2,
              ...passo,
            },
            {
              id: "p",
              trigger_stage: "em_contato",
              name: "Psiquiatria",
              created_at: "2026-10-24T12:00:00Z",
              etiquetas: ["Psiquiatria"],
              etiquetas_modo: "qualquer",
              prioridade: 1,
              ...passo,
            },
            {
              id: "x",
              trigger_stage: "novo",
              name: "Sem passo",
              created_at: "2026-10-24T12:00:00Z",
              etiquetas: [],
              etiquetas_modo: "qualquer",
              prioridade: 0,
              cadence_step: [],
            },
          ],
          error: null,
        }),
      },
    });
    expect(await fetchReguasDeFollowup(b.admin, CLINICA)).toEqual([
      {
        etapa: "em_contato",
        nome: "Psiquiatria",
        etiquetas: ["Psiquiatria"],
        etiquetas_modo: "qualquer",
      },
      {
        etapa: "em_contato",
        nome: "Odonto",
        etiquetas: ["Odontologia"],
        etiquetas_modo: "todas",
      },
      {
        etapa: "em_contato",
        nome: "Geral",
        etiquetas: [],
        etiquetas_modo: "qualquer",
      },
    ]);
  });

  it("banco sem a migration (42703): falha fechada (a tela diz que não deu para conferir)", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence: (chamada) =>
          colunas(chamada).includes("etiquetas")
            ? SEM_COLUNA
            : {
                data: [
                  {
                    id: "g",
                    trigger_stage: "em_contato",
                    name: "Geral",
                    created_at: "2026-10-24T12:00:00Z",
                    ...passo,
                  },
                ],
                error: null,
              },
      },
    });
    await expect(fetchReguasDeFollowup(b.admin, CLINICA)).rejects.toThrow(
      "column cadence.etiquetas does not exist",
    );
    expect(b.tabelas.filter((t) => t.tabela === "cadence")).toHaveLength(1);
  });
});
