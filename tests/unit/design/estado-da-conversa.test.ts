import { CircleDashed, Hand } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSA_SEM_ATENDENTE,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  PATIENT_TAG,
  TOKEN_META_STATUS,
  estadoVisualDaConversa,
  type StatusDefinition,
} from "@/lib/design/status";

// Estado visual da conversa (achados 13 e 19 da revisao de liberacao): um
// helper so para o cartao da lista e o cabecalho do fio.

const EU = "user-eu";
const COLEGA = "user-colega";
const nomes = { [EU]: "Rafaela Lima", [COLEGA]: "Carlos Eduardo Nunes" };
const contexto = { viewerId: EU, authorNames: nomes };

describe("aguardando_humano depende de awaiting_reply", () => {
  it("com o paciente esperando: 'Aguardando você', mão âmbar", () => {
    const estado = estadoVisualDaConversa(
      {
        status: "aguardando_humano",
        awaiting_reply: true,
        assignee_user_id: null,
      },
      contexto,
    );
    expect(estado.definition).toBe(CONVERSATION_STATUS.aguardando_humano);
    expect(estado.definition.icon).toBe(Hand);
  });

  it("respondida pelo celular (ou aberta pela régua): 'Sem atendente', neutro", () => {
    const estado = estadoVisualDaConversa(
      {
        status: "aguardando_humano",
        awaiting_reply: false,
        assignee_user_id: null,
      },
      contexto,
    );
    expect(estado.definition).toBe(CONVERSA_SEM_ATENDENTE);
    expect(estado.definition.label).toBe("Sem atendente");
    expect(estado.definition.tone).toBe("neutral");
    expect(estado.definition.icon).toBe(CircleDashed);
  });
});

describe("em atendimento diz quem atende", () => {
  it("quem está vendo é 'Você', com as próprias iniciais", () => {
    const estado = estadoVisualDaConversa(
      { status: "em_atendimento", awaiting_reply: false, assignee_user_id: EU },
      contexto,
    );
    expect(estado.label).toBe("Você");
    expect(estado.avatarInitials).toBe("RL");
  });

  it("colega: primeiro nome no cartão e iniciais da primeira e da última palavra", () => {
    const estado = estadoVisualDaConversa(
      {
        status: "em_atendimento",
        awaiting_reply: true,
        assignee_user_id: COLEGA,
      },
      contexto,
    );
    expect(estado.label).toBe("Carlos");
    expect(estado.avatarInitials).toBe("CN");
  });

  it("no cabeçalho do fio, o nome inteiro", () => {
    const estado = estadoVisualDaConversa(
      {
        status: "em_atendimento",
        awaiting_reply: false,
        assignee_user_id: COLEGA,
      },
      { ...contexto, nomeCompleto: true },
    );
    expect(estado.label).toBe("Carlos Eduardo Nunes");
  });

  it("responsável sem nome no mapa não inventa nome", () => {
    const estado = estadoVisualDaConversa(
      {
        status: "em_atendimento",
        awaiting_reply: false,
        assignee_user_id: "outro",
      },
      contexto,
    );
    expect(estado.label).toBe("Em atendimento");
    expect(estado.avatarInitials).toBe("AT");
  });
});

describe("os outros status passam direto do mapa", () => {
  it("IA atendendo e Resolvida", () => {
    for (const status of ["ia_atendendo", "resolvida"] as const) {
      const estado = estadoVisualDaConversa(
        { status, awaiting_reply: false, assignee_user_id: null },
        contexto,
      );
      expect(estado.definition).toBe(CONVERSATION_STATUS[status]);
      expect(estado.label).toBeUndefined();
    }
  });
});

describe("'Sem atendente' respeita a tabela de ícones", () => {
  const TODOS: StatusDefinition[] = [
    ...Object.values(APPOINTMENT_STATUS),
    ...Object.values(CONVERSATION_STATUS),
    ...Object.values(FUNNEL_STAGE),
    ...Object.values(CONTACT_RECENCY),
    ...Object.values(PATIENT_TAG),
    ...Object.values(CONVERSAO_STATUS),
    ...Object.values(TOKEN_META_STATUS),
    ...Object.values(CONSENT_STATUS),
  ];

  it("o ícone dele nunca aparece em outro tom", () => {
    for (const definicao of TODOS) {
      if (definicao.icon === CONVERSA_SEM_ATENDENTE.icon) {
        expect(definicao.tone).toBe(CONVERSA_SEM_ATENDENTE.tone);
      }
    }
  });

  it("não repete a forma de nenhum status de conversa", () => {
    const formas = Object.values(CONVERSATION_STATUS).map((d) => d.icon);
    expect(formas).not.toContain(CONVERSA_SEM_ATENDENTE.icon);
  });
});
