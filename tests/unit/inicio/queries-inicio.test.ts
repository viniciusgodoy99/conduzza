import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  fetchFunilDaJornada,
  fetchResumoDoDia,
  janelasDoResumo,
  lerFunilDaJornada,
  lerResumoDoDia,
} from "@/lib/queries/inicio";

// Dados do Inicio (Fase 3): as janelas que a RPC resumo_do_dia recebe saem
// do dia CIVIL da clinica (regra 3.6), inclusive na virada de horario de
// verao; resposta null (trava do profissional) ou fora do formato LANCA,
// nunca vira zero.

const FORTALEZA = "America/Fortaleza";

const DIAS = [
  "2026-09-26",
  "2026-09-27",
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
];

function respostaValida() {
  return {
    hoje: {
      total: 147,
      confirmadas: 128,
      aguardando: 19,
      canceladas: 3,
      unidades: 2,
    },
    semana_passada: { total: 130, confirmadas: 110 },
    ultimo_disparo: "2026-10-02T12:02:30.123456+00:00",
    por_dia: [7, 6, 5, 4, 3, 2, 1].map((ordem) => ({
      ordem,
      total: ordem * 10,
    })),
  };
}

describe("janelasDoResumo", () => {
  it("monta D-6 a D e o mesmo dia da semana passada no fuso da clínica", () => {
    const { dias, argumentos } = janelasDoResumo(FORTALEZA, "2026-10-02");
    expect(dias).toEqual(DIAS);
    expect(argumentos.p_inicios).toEqual([
      "2026-09-26T03:00:00.000Z",
      "2026-09-27T03:00:00.000Z",
      "2026-09-28T03:00:00.000Z",
      "2026-09-29T03:00:00.000Z",
      "2026-09-30T03:00:00.000Z",
      "2026-10-01T03:00:00.000Z",
      "2026-10-02T03:00:00.000Z",
    ]);
    expect(argumentos.p_fim).toBe("2026-10-03T03:00:00.000Z");
    expect(argumentos.p_semana_passada_de).toBe("2026-09-25T03:00:00.000Z");
    expect(argumentos.p_semana_passada_ate).toBe("2026-09-26T03:00:00.000Z");
  });

  it("soma dias civis, não 24h: a meia-noite local muda de UTC no horário de verão", () => {
    // Nova York sai do horario de verao em 01/11/2026 as 02:00.
    const { argumentos } = janelasDoResumo("America/New_York", "2026-11-03");
    expect(argumentos.p_inicios).toEqual([
      "2026-10-28T04:00:00.000Z",
      "2026-10-29T04:00:00.000Z",
      "2026-10-30T04:00:00.000Z",
      "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
      "2026-11-03T05:00:00.000Z",
    ]);
    expect(argumentos.p_fim).toBe("2026-11-04T05:00:00.000Z");
    expect(argumentos.p_semana_passada_de).toBe("2026-10-27T04:00:00.000Z");
    expect(argumentos.p_semana_passada_ate).toBe("2026-10-28T04:00:00.000Z");
  });

  it("vira o mês e o ano sem pular dia", () => {
    const { dias } = janelasDoResumo(FORTALEZA, "2027-01-02");
    expect(dias).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});

describe("lerResumoDoDia", () => {
  it("traduz a resposta e põe cada barra no seu dia pela ordem", () => {
    const resumo = lerResumoDoDia(respostaValida(), DIAS);
    expect(resumo.dia).toBe("2026-10-02");
    expect(resumo.hoje).toEqual({
      total: 147,
      confirmadas: 128,
      aguardando: 19,
      canceladas: 3,
      unidades: 2,
    });
    expect(resumo.semanaPassada).toEqual({ total: 130, confirmadas: 110 });
    expect(resumo.ultimoDisparo).toBe("2026-10-02T12:02:30.123456+00:00");
    // A RPC mandou fora de ordem: ordem 1 = D-6, ordem 7 = hoje.
    expect(resumo.porDia).toEqual(
      DIAS.map((dia, indice) => ({ dia, total: (indice + 1) * 10 })),
    );
  });

  it("sem disparo hoje, ultimoDisparo é null", () => {
    const resumo = lerResumoDoDia(
      { ...respostaValida(), ultimo_disparo: null },
      DIAS,
    );
    expect(resumo.ultimoDisparo).toBeNull();
  });

  it("null (trava do profissional) lança, nunca vira zero", () => {
    expect(() => lerResumoDoDia(null, DIAS)).toThrow(
      "Recorte indisponível para este perfil (resumo_do_dia).",
    );
  });

  it("dia faltando no por_dia lança em vez de virar barra zerada", () => {
    const resposta = respostaValida();
    resposta.por_dia = resposta.por_dia.filter((linha) => linha.ordem !== 3);
    expect(() => lerResumoDoDia(resposta, DIAS)).toThrow(
      "Resposta fora do formato esperado (resumo_do_dia).",
    );
  });

  it("contagem que não é número lança", () => {
    const resposta = {
      ...respostaValida(),
      hoje: { ...respostaValida().hoje, total: "147" },
    };
    expect(() => lerResumoDoDia(resposta, DIAS)).toThrow(
      "Resposta fora do formato esperado (resumo_do_dia).",
    );
  });

  it("bloco ausente e data ilegível lançam", () => {
    const semHoje: Record<string, unknown> = { ...respostaValida() };
    delete semHoje.hoje;
    expect(() => lerResumoDoDia(semHoje, DIAS)).toThrow();
    expect(() =>
      lerResumoDoDia(
        { ...respostaValida(), ultimo_disparo: "ontem de tarde" },
        DIAS,
      ),
    ).toThrow();
  });
});

describe("lerFunilDaJornada", () => {
  const etapas = [
    { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10, total: 38 },
    {
      chave: "em_contato",
      nome: "Em contato",
      papel: null,
      posicao: 20,
      total: 0,
    },
    {
      chave: "perdido",
      nome: "Perdido",
      papel: "perdido",
      posicao: 60,
      total: 4,
    },
  ];

  it("mantém a ordem do banco e o zero da etapa vazia", () => {
    expect(lerFunilDaJornada(etapas)).toEqual(etapas);
  });

  it("lista vazia é jornada sem etapa visível, não erro", () => {
    expect(lerFunilDaJornada([])).toEqual([]);
  });

  it("null (trava do profissional) lança", () => {
    expect(() => lerFunilDaJornada(null)).toThrow(
      "Recorte indisponível para este perfil (funil_da_jornada).",
    );
  });

  it("papel desconhecido ou total ausente lança", () => {
    expect(() =>
      lerFunilDaJornada([{ ...etapas[0], papel: "vendeu" }]),
    ).toThrow();
    expect(() =>
      lerFunilDaJornada([{ ...etapas[0], total: undefined }]),
    ).toThrow();
  });
});

type ChamadaDeRpc = { nome: string; argumentos: Record<string, unknown> };

function clienteFalso(resposta: { data: unknown; error: unknown }) {
  const chamadas: ChamadaDeRpc[] = [];
  const cliente = {
    rpc: async (nome: string, argumentos: Record<string, unknown>) => {
      chamadas.push({ nome, argumentos });
      return resposta;
    },
  } as unknown as SupabaseClient;
  return { cliente, chamadas };
}

describe("fetchResumoDoDia", () => {
  it("tira o dia de hoje do instante no fuso da clínica e chama a RPC", async () => {
    // 02:30 UTC de 03/10 ainda e 02/10 em Fortaleza (23:30).
    const agora = new Date("2026-10-03T02:30:00.000Z");
    const { cliente, chamadas } = clienteFalso({
      data: respostaValida(),
      error: null,
    });
    const resumo = await fetchResumoDoDia(
      cliente,
      "clinica-a",
      FORTALEZA,
      agora,
    );
    expect(resumo.dia).toBe("2026-10-02");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.nome).toBe("resumo_do_dia");
    expect(chamadas[0]?.argumentos).toEqual({
      p_clinic_id: "clinica-a",
      ...janelasDoResumo(FORTALEZA, "2026-10-02").argumentos,
    });
  });

  it("erro do banco lança", async () => {
    const { cliente } = clienteFalso({
      data: null,
      error: { message: "falhou" },
    });
    await expect(
      fetchResumoDoDia(cliente, "clinica-a", FORTALEZA, new Date()),
    ).rejects.toThrow("falhou");
  });
});

describe("fetchFunilDaJornada", () => {
  it("chama a RPC com a clínica e lança no null", async () => {
    const { cliente, chamadas } = clienteFalso({ data: null, error: null });
    await expect(fetchFunilDaJornada(cliente, "clinica-a")).rejects.toThrow(
      "Recorte indisponível",
    );
    expect(chamadas[0]).toEqual({
      nome: "funil_da_jornada",
      argumentos: { p_clinic_id: "clinica-a" },
    });
  });
});
