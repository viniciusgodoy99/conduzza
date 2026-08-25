import { describe, expect, it } from "vitest";

import {
  agruparPorEtapa,
  compararPorProximaAcao,
  consentimentoVigenteDeLinhas,
  filtrarLeads,
  LOST_REASONS,
  recencyDe,
  type LeadFiltravel,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";

// Aceite da Tela 4: recencia do badge, consentimento pela linha mais
// recente, ordem de proxima acao e agrupamento do Kanban.

const HORA_MS = 60 * 60 * 1000;
const agora = new Date("2026-08-25T12:00:00Z");

function haMs(ms: number): string {
  return new Date(agora.getTime() - ms).toISOString();
}

describe("recencyDe", () => {
  it("sem contato nenhum devolve null e o badge some", () => {
    expect(recencyDe(null, agora)).toBeNull();
  });

  it("fronteira exata das 4h ainda esta em dia; um ms alem, esfriando", () => {
    expect(recencyDe(haMs(4 * HORA_MS), agora)).toBe("em_dia");
    expect(recencyDe(haMs(4 * HORA_MS + 1), agora)).toBe("esfriando");
  });

  it("fronteira exata das 24h ainda esta esfriando; um ms alem, frio", () => {
    expect(recencyDe(haMs(24 * HORA_MS), agora)).toBe("esfriando");
    expect(recencyDe(haMs(24 * HORA_MS + 1), agora)).toBe("frio");
  });

  it("contato de agora ha pouco esta em dia", () => {
    expect(recencyDe(haMs(30 * 60 * 1000), agora)).toBe("em_dia");
  });
});

describe("consentimentoVigenteDeLinhas", () => {
  const ativaAntiga: LinhaConsent = {
    channel: "whatsapp",
    granted_at: "2026-01-10T10:00:00Z",
    revoked_at: null,
  };
  const revogadaRecente: LinhaConsent = {
    channel: "whatsapp",
    granted_at: "2026-05-01T10:00:00Z",
    revoked_at: "2026-06-01T10:00:00Z",
  };

  it("caso do bug antigo: linha antiga ativa NAO mascara revogacao mais recente", () => {
    // Filtrar por "ativa" antes de ordenar devolveria true aqui, e disparo
    // sem autorizacao e exatamente o que a regra 3.3 proibe.
    expect(consentimentoVigenteDeLinhas([ativaAntiga, revogadaRecente])).toBe(
      false,
    );
    expect(consentimentoVigenteDeLinhas([revogadaRecente, ativaAntiga])).toBe(
      false,
    );
  });

  it("o inverso vale: revogada antiga com reconsentimento recente e true", () => {
    const revogadaAntiga: LinhaConsent = {
      channel: "whatsapp",
      granted_at: "2026-01-10T10:00:00Z",
      revoked_at: "2026-02-01T10:00:00Z",
    };
    const ativaRecente: LinhaConsent = {
      channel: "whatsapp",
      granted_at: "2026-05-01T10:00:00Z",
      revoked_at: null,
    };
    expect(consentimentoVigenteDeLinhas([revogadaAntiga, ativaRecente])).toBe(
      true,
    );
  });

  it("sem linha nenhuma de whatsapp e false", () => {
    expect(consentimentoVigenteDeLinhas([])).toBe(false);
    expect(
      consentimentoVigenteDeLinhas([
        {
          channel: "email",
          granted_at: "2026-07-01T10:00:00Z",
          revoked_at: null,
        },
      ]),
    ).toBe(false);
  });

  it("linha de outro canal nao interfere na decisao do whatsapp", () => {
    const emailRecente: LinhaConsent = {
      channel: "email",
      granted_at: "2026-08-01T10:00:00Z",
      revoked_at: null,
    };
    expect(
      consentimentoVigenteDeLinhas([
        ativaAntiga,
        revogadaRecente,
        emailRecente,
      ]),
    ).toBe(false);
  });
});

describe("compararPorProximaAcao", () => {
  it("nunca contatado (null) vem antes de qualquer contatado", () => {
    expect(
      compararPorProximaAcao(
        { last_contact_at: null },
        { last_contact_at: "2026-08-25T10:00:00Z" },
      ),
    ).toBeLessThan(0);
    expect(
      compararPorProximaAcao(
        { last_contact_at: "2026-08-25T10:00:00Z" },
        { last_contact_at: null },
      ),
    ).toBeGreaterThan(0);
    expect(
      compararPorProximaAcao(
        { last_contact_at: null },
        { last_contact_at: null },
      ),
    ).toBe(0);
  });

  it("entre contatados, o contato mais antigo vem primeiro (asc)", () => {
    const lista = [
      { last_contact_at: "2026-08-25T10:00:00Z" },
      { last_contact_at: null },
      { last_contact_at: "2026-08-20T10:00:00Z" },
    ];
    const ordenada = [...lista].sort(compararPorProximaAcao);
    expect(ordenada.map((l) => l.last_contact_at)).toEqual([
      null,
      "2026-08-20T10:00:00Z",
      "2026-08-25T10:00:00Z",
    ]);
  });
});

function lead(parcial: Partial<LeadFiltravel>): LeadFiltravel {
  return {
    funnel_stage: "novo",
    source_channel: null,
    owner_user_id: null,
    first_contact_at: "2026-08-20T10:00:00Z",
    last_contact_at: null,
    ...parcial,
  };
}

describe("agruparPorEtapa", () => {
  it("toda etapa existe no resultado, mesmo vazia", () => {
    const grupos = agruparPorEtapa([]);
    expect(Object.keys(grupos).sort()).toEqual(
      [
        "novo",
        "em_contato",
        "aguardando_resposta",
        "agendou",
        "compareceu",
        "perdido",
      ].sort(),
    );
    expect(grupos.perdido).toEqual([]);
  });

  it("cada grupo sai ordenado por proxima acao", () => {
    const a = lead({
      funnel_stage: "em_contato",
      last_contact_at: "2026-08-25T10:00:00Z",
    });
    const b = lead({ funnel_stage: "em_contato", last_contact_at: null });
    const c = lead({
      funnel_stage: "em_contato",
      last_contact_at: "2026-08-20T10:00:00Z",
    });
    const grupos = agruparPorEtapa([a, b, c]);
    expect(grupos.em_contato).toEqual([b, c, a]);
    expect(grupos.novo).toEqual([]);
  });
});

describe("filtrarLeads", () => {
  const leads = [
    lead({
      funnel_stage: "novo",
      source_channel: "trafego_pago",
      owner_user_id: "u1",
      first_contact_at: "2026-08-10T12:00:00Z",
    }),
    lead({
      funnel_stage: "perdido",
      source_channel: "indicacao",
      owner_user_id: "u2",
      first_contact_at: "2026-08-20T12:00:00Z",
    }),
  ];

  it("filtra por etapa, origem e responsavel", () => {
    expect(filtrarLeads(leads, { etapa: "perdido" })).toEqual([leads[1]]);
    expect(filtrarLeads(leads, { origem: "trafego_pago" })).toEqual([leads[0]]);
    expect(filtrarLeads(leads, { responsavel: "u2" })).toEqual([leads[1]]);
    expect(filtrarLeads(leads, {})).toEqual(leads);
  });

  it("periodo inclusivo sobre first_contact_at", () => {
    expect(
      filtrarLeads(leads, {
        deISO: "2026-08-15T00:00:00Z",
        ateISO: "2026-08-21T00:00:00Z",
      }),
    ).toEqual([leads[1]]);
    expect(filtrarLeads(leads, { ateISO: "2026-08-10T12:00:00Z" })).toEqual([
      leads[0],
    ]);
  });
});

describe("LOST_REASONS", () => {
  it("cobre os codigos do check do banco, com rotulo de interface", () => {
    expect(LOST_REASONS.map((m) => m.codigo)).toEqual([
      "preco",
      "distancia",
      "horario",
      "nao_respondeu",
      "agendou_em_outro_lugar",
      "outro",
    ]);
  });
});
