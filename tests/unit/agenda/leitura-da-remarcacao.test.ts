import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  fetchAgendaDia,
  fetchConsulta,
  fetchPendencias,
} from "@/lib/queries/agenda";

// Revisao da AG4, achado 1: a Agenda inteira dependia do embutido
// antiga:remarcacao_de(...) (o dia, o "Pendente de voce" e o tempo real);
// se o PostgREST recusasse o embutido, a Agenda nao abria em nenhuma
// clinica. Agora o dia e a consulta do tempo real leem so a coluna
// remarcacao_de, e a antiga vem numa leitura a parte, so na lista das
// pendencias e so quando ha remarcacao nela. A falha dessa leitura fica na
// remarcacao (erroNaAntiga); a lista e a pagina abrem do mesmo jeito.
// Contra um cliente do Supabase dublado; nada aqui e dado real.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";
const DA_IA = "c0c0c0c0-0000-4000-8000-0000000000b1";
const PROFISSIONAL = "1b1b1b1b-0000-4000-8000-000000000001";
const FUSO = "America/Fortaleza";

type Chamada = {
  tabela: string;
  colunas: string;
  filtros: [string, string, unknown][];
};

type Resposta = { data: unknown; error: unknown } | "lanca";

/** O cliente dublado: registra cada leitura e responde pela funcao do teste. */
function clienteDublado(responder: (chamada: Chamada) => Resposta) {
  const chamadas: Chamada[] = [];
  const from = (tabela: string) => {
    const chamada: Chamada = { tabela, colunas: "", filtros: [] };
    const executar = async () => {
      chamadas.push(chamada);
      const resposta = responder(chamada);
      if (resposta === "lanca") {
        throw new Error("rede");
      }
      return resposta;
    };
    const api: Record<string, unknown> = {};
    const filtro =
      (operador: string) =>
      (coluna: string, ...valores: unknown[]) => {
        chamada.filtros.push([
          operador,
          coluna,
          valores.length === 1 ? valores[0] : valores,
        ]);
        return api;
      };
    Object.assign(api, {
      select: (colunas: string) => {
        chamada.colunas = colunas;
        return api;
      },
      eq: filtro("eq"),
      in: filtro("in"),
      lt: filtro("lt"),
      gt: filtro("gt"),
      is: filtro("is"),
      not: filtro("not"),
      order: () => api,
      maybeSingle: async () => {
        const { data, error } = (await executar()) as {
          data: unknown;
          error: unknown;
        };
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then: <T>(
        ok: (valor: { data: unknown; error: unknown }) => T,
        falha?: (erro: unknown) => T,
      ) =>
        executar().then(
          (valor) => ok(valor as { data: unknown; error: unknown }),
          falha,
        ),
    });
    return api;
  };
  return {
    cliente: { from } as unknown as SupabaseClient,
    chamadas,
  };
}

function linhaDaConsulta(extra: Record<string, unknown>) {
  return {
    id: NOVA,
    unit_id: null,
    contact_id: "3d3d3d3d-0000-4000-8000-000000000001",
    professional_id: PROFISSIONAL,
    service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
    resource_id: null,
    starts_at: "2026-11-03T13:00:00.000Z",
    ends_at: "2026-11-03T13:30:00.000Z",
    status: "agendado",
    confirmation_channel: null,
    is_overbooking: false,
    created_by: "ia",
    approval_status: "pendente",
    send_confirmation: false,
    notes: null,
    remarcacao_de: ANTIGA,
    contact: { id: "c1", name: "Paciente de Teste", phone_e164: "5584900" },
    service_link: {
      id: "2c2c2c2c-0000-4000-8000-000000000001",
      duration_min: 30,
      procedure: { id: "p1", name: "Limpeza de pele" },
      insurance: null,
    },
    ...extra,
  };
}

const LINHA_DA_ANTIGA = {
  id: ANTIGA,
  starts_at: "2026-10-29T17:00:00.000Z",
  ends_at: "2026-10-29T17:30:00.000Z",
  status: "confirmado_paciente",
  professional_id: PROFISSIONAL,
};

const A_NOVA = linhaDaConsulta({});
const A_DA_IA = linhaDaConsulta({ id: DA_IA, remarcacao_de: null });

/** A leitura das pendencias (a lista) e a da antiga, pelas colunas. */
const ehDaAntiga = (chamada: Chamada) =>
  chamada.colunas === "id, starts_at, ends_at, status, professional_id";

describe("o dia e o tempo real não dependem da antiga (achado 1)", () => {
  it("a leitura do dia traz a ligação (a coluna), nunca a antiga embutida", async () => {
    // O PostgREST recusando qualquer embutido da antiga (a relacao fora do
    // cache do esquema): a Agenda abre do mesmo jeito.
    const { cliente, chamadas } = clienteDublado((chamada) =>
      /antiga|remarcacao_de\s*\(/.test(chamada.colunas)
        ? { data: null, error: { code: "PGRST200" } }
        : chamada.tabela === "appointment"
          ? { data: [A_NOVA], error: null }
          : { data: [], error: null },
    );
    const dia = await fetchAgendaDia(cliente, CLINICA, "2026-11-03", FUSO);
    const daConsulta = chamadas.find((c) => c.tabela === "appointment");
    expect(daConsulta?.colunas).toContain("remarcacao_de");
    expect(daConsulta?.colunas).not.toMatch(/antiga|remarcacao_de\s*\(/);
    expect(dia.consultas).toHaveLength(1);
    expect(dia.consultas[0]?.remarcacao_de).toBe(ANTIGA);
    // A do dia nao traz a antiga: o menu a le da lista das pendencias.
    expect("antiga" in (dia.consultas[0] ?? {})).toBe(false);
  });

  it("a consulta do tempo real (INSERT) também lê sem a antiga", async () => {
    const { cliente, chamadas } = clienteDublado((chamada) =>
      /antiga|remarcacao_de\s*\(/.test(chamada.colunas)
        ? { data: null, error: { code: "PGRST200" } }
        : { data: [A_NOVA], error: null },
    );
    const consulta = await fetchConsulta(cliente, NOVA);
    expect(consulta?.id).toBe(NOVA);
    expect(consulta?.remarcacao_de).toBe(ANTIGA);
    expect(chamadas[0]?.colunas).not.toMatch(/antiga|remarcacao_de\s*\(/);
  });
});

describe("a lista das pendências lê a antiga à parte", () => {
  it("uma leitura a mais, por id, pela clínica e só das colunas do cartão", async () => {
    const { cliente, chamadas } = clienteDublado((chamada) =>
      ehDaAntiga(chamada)
        ? { data: [LINHA_DA_ANTIGA], error: null }
        : { data: [A_NOVA, A_DA_IA], error: null },
    );
    const lista = await fetchPendencias(cliente, CLINICA);
    expect(chamadas).toHaveLength(2);
    const [daLista, daAntiga] = chamadas;
    expect(daLista?.colunas).not.toMatch(/antiga|remarcacao_de\s*\(/);
    expect(daAntiga?.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["in", "id", [ANTIGA]],
    ]);
    const nova = lista.find((c) => c.id === NOVA);
    expect(nova?.antiga).toEqual(LINHA_DA_ANTIGA);
    expect(nova?.erroNaAntiga).toBeUndefined();
    // A consulta da IA sem remarcacao nao ganha antiga nenhuma.
    const daIa = lista.find((c) => c.id === DA_IA);
    expect(daIa && "antiga" in daIa).toBe(false);
  });

  it("sem remarcação na lista, nenhuma leitura a mais", async () => {
    const { cliente, chamadas } = clienteDublado(() => ({
      data: [A_DA_IA],
      error: null,
    }));
    const lista = await fetchPendencias(cliente, CLINICA);
    expect(chamadas).toHaveLength(1);
    expect(lista).toHaveLength(1);
  });

  it("a leitura da antiga falha ou lança: a lista volta inteira, e só a remarcação diz que não carregou", async () => {
    for (const falha of [
      { data: null, error: { code: "57014" } },
      "lanca" as const,
    ]) {
      const { cliente } = clienteDublado((chamada) =>
        ehDaAntiga(chamada) ? falha : { data: [A_NOVA, A_DA_IA], error: null },
      );
      const lista = await fetchPendencias(cliente, CLINICA);
      expect(lista.map((c) => c.id)).toEqual([NOVA, DA_IA]);
      const nova = lista.find((c) => c.id === NOVA);
      expect(nova?.erroNaAntiga).toBe(true);
      expect(nova?.antiga).toBeNull();
      const daIa = lista.find((c) => c.id === DA_IA);
      expect(daIa?.erroNaAntiga).toBeUndefined();
    }
  });

  it("a antiga que não volta (a RLS não deixou ler, ou foi apagada) fica nula, sem erro", async () => {
    const { cliente } = clienteDublado((chamada) =>
      ehDaAntiga(chamada)
        ? { data: [], error: null }
        : { data: [A_NOVA], error: null },
    );
    const [nova] = await fetchPendencias(cliente, CLINICA);
    expect(nova?.antiga).toBeNull();
    expect(nova?.erroNaAntiga).toBeUndefined();
  });

  it("a lista em si que falha continua falhando (o painel mostra o de sempre)", async () => {
    const { cliente } = clienteDublado(() => ({
      data: null,
      error: { message: "falhou" },
    }));
    await expect(fetchPendencias(cliente, CLINICA)).rejects.toThrow("falhou");
  });
});
