import { describe, expect, it } from "vitest";

import {
  FILTROS_DA_URL,
  casaBusca,
  casaSituacao,
  filtroDeSituacaoDaUrl,
  recencia,
  semResposta24h,
  type ConversaFiltravel,
} from "@/lib/domain/filtros-da-conversa";

// Filtros da lista do Atendimento (achados 13, 20 e 109 da revisao de
// liberacao). O chip conta e filtra o MESMO conjunto, o "Ha mais de 24h" usa
// o criterio da contagem do Inicio, e a busca por telefone compara digitos
// pela chave canonica.

const AGORA = Date.parse("2026-09-24T15:00:00Z");
const horasAtras = (horas: number) =>
  new Date(AGORA - horas * 3_600_000).toISOString();

function conversa(parcial: Partial<ConversaFiltravel> = {}): ConversaFiltravel {
  return {
    status: "aguardando_humano",
    awaiting_reply: true,
    last_inbound_at: horasAtras(1),
    last_message_at: horasAtras(1),
    contact: { name: "Maria Clara Souza", phone_e164: "+5585999998888" },
    ...parcial,
  };
}

describe("sem resposta há mais de 24h (mesmo critério de fetchProximasAcoes)", () => {
  it("conta quem espera resposta há mais de 24h, em qualquer status aberto", () => {
    for (const status of [
      "aguardando_humano",
      "em_atendimento",
      "ia_atendendo",
    ] as const) {
      expect(
        semResposta24h(
          conversa({ status, last_inbound_at: horasAtras(25) }),
          AGORA,
        ),
      ).toBe(true);
    }
  });

  it("fica de fora: respondida, resolvida, recente ou sem fala do paciente", () => {
    expect(
      semResposta24h(
        conversa({ awaiting_reply: false, last_inbound_at: horasAtras(30) }),
        AGORA,
      ),
    ).toBe(false);
    expect(
      semResposta24h(
        conversa({ status: "resolvida", last_inbound_at: horasAtras(30) }),
        AGORA,
      ),
    ).toBe(false);
    expect(
      semResposta24h(conversa({ last_inbound_at: horasAtras(23) }), AGORA),
    ).toBe(false);
    expect(semResposta24h(conversa({ last_inbound_at: null }), AGORA)).toBe(
      false,
    );
  });

  it("exatamente 24h ainda não conta (o SQL usa menor que)", () => {
    expect(
      semResposta24h(conversa({ last_inbound_at: horasAtras(24) }), AGORA),
    ).toBe(false);
  });
});

describe("chip de situação", () => {
  it("'Aguardando você' é só quem espera resposta, não o status puro", () => {
    expect(
      casaSituacao(
        conversa({ awaiting_reply: true }),
        "aguardando_humano",
        AGORA,
      ),
    ).toBe(true);
    expect(
      casaSituacao(
        conversa({ awaiting_reply: false }),
        "aguardando_humano",
        AGORA,
      ),
    ).toBe(false);
  });

  it("os outros status contam por status puro", () => {
    expect(
      casaSituacao(
        conversa({ status: "em_atendimento", awaiting_reply: false }),
        "em_atendimento",
        AGORA,
      ),
    ).toBe(true);
    expect(
      casaSituacao(conversa({ status: "resolvida" }), "em_atendimento", AGORA),
    ).toBe(false);
  });

  it("o recorte de 24h atravessa status", () => {
    expect(
      casaSituacao(
        conversa({ status: "em_atendimento", last_inbound_at: horasAtras(48) }),
        "sem_resposta_24h",
        AGORA,
      ),
    ).toBe(true);
  });
});

describe("filtro pela URL", () => {
  it("só aceita os dois filtros do Início e traduz para o chip", () => {
    expect(FILTROS_DA_URL).toEqual(["aguardando", "sem_resposta_24h"]);
    expect(filtroDeSituacaoDaUrl("aguardando")).toBe("aguardando_humano");
    expect(filtroDeSituacaoDaUrl("sem_resposta_24h")).toBe("sem_resposta_24h");
  });
});

describe("ordem de recebimento", () => {
  it("usa a fala do paciente e cai para a última atividade", () => {
    expect(recencia(conversa({ last_inbound_at: horasAtras(2) }))).toBe(
      AGORA - 2 * 3_600_000,
    );
    expect(
      recencia(
        conversa({ last_inbound_at: null, last_message_at: horasAtras(3) }),
      ),
    ).toBe(AGORA - 3 * 3_600_000);
    expect(
      recencia(conversa({ last_inbound_at: null, last_message_at: null })),
    ).toBe(0);
  });
});

describe("busca por nome", () => {
  const contato = { name: "João Pedro Araújo", phone_e164: "+5585999998888" };

  it("ignora acento e caixa", () => {
    expect(casaBusca(contato, "joao")).toBe(true);
    expect(casaBusca(contato, "ARAUJO")).toBe(true);
    expect(casaBusca(contato, "  pedro ")).toBe(true);
    expect(casaBusca(contato, "Maria")).toBe(false);
  });

  it("termo vazio casa tudo", () => {
    expect(casaBusca(contato, "")).toBe(true);
    expect(casaBusca(contato, "   ")).toBe(true);
  });
});

describe("busca por telefone (achado 20)", () => {
  const comNove = { name: "Ana", phone_e164: "+5585999998888" };
  // Como o WhatsApp entrega muitos celulares: SEM o nono digito.
  const semNove = { name: "Bia", phone_e164: "+558599998888" };

  it("acha com máscara, do jeito que está no papel", () => {
    expect(casaBusca(comNove, "(85) 99999-8888")).toBe(true);
    expect(casaBusca(comNove, "99999-8888")).toBe(true);
    expect(casaBusca(comNove, "(85) 99999")).toBe(true);
    expect(casaBusca(comNove, "+55 85 99999-8888")).toBe(true);
  });

  it("acha com e sem o nono dígito, nos dois sentidos", () => {
    // gravado sem o 9, digitado com o 9
    expect(casaBusca(semNove, "(85) 99999-8888")).toBe(true);
    expect(casaBusca(semNove, "99999-8888")).toBe(true);
    // gravado com o 9, digitado sem o 9
    expect(casaBusca(comNove, "(85) 9999-8888")).toBe(true);
    expect(casaBusca(comNove, "85 9999-88")).toBe(true);
    expect(casaBusca(comNove, "9999-8888")).toBe(true);
  });

  it("acha só pelo final do número", () => {
    expect(casaBusca(comNove, "8888")).toBe(true);
    expect(casaBusca(semNove, "8888")).toBe(true);
  });

  it("não acha número de outra pessoa", () => {
    expect(casaBusca(comNove, "(85) 98888-7777")).toBe(false);
    expect(casaBusca(comNove, "(11) 99999-8888")).toBe(false);
  });

  it("menos de 3 dígitos não busca telefone", () => {
    expect(casaBusca(comNove, "9")).toBe(false);
    expect(casaBusca(comNove, "88")).toBe(false);
  });

  it("termo com letra é só nome", () => {
    expect(casaBusca(comNove, "ana 8888")).toBe(false);
  });
});
