import { describe, expect, it } from "vitest";

import { EXECUCAO_STATUS } from "@/components/configuracoes/automacoes-de-fluxo/status-da-execucao";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  ATIVIDADE_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  IA_AGENDA_STATUS,
  PATIENT_TAG,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import { STATUS_DE_EXECUCAO } from "@/lib/domain/automacoes-de-fluxo";

// Situacao das execucoes do historico de automacoes de fluxo: 3 camadas em
// todo status e a regra global "um icone, uma cor" contra todos os mapas do
// produto (docs/06 secao 4.6, C18).

const TODOS: StatusDefinition[] = [
  ...Object.values(APPOINTMENT_STATUS),
  ...Object.values(CONVERSATION_STATUS),
  ...Object.values(FUNNEL_STAGE),
  ...Object.values(CONTACT_RECENCY),
  ...Object.values(PATIENT_TAG),
  ...Object.values(APPOINTMENT_FLAG),
  ...Object.values(RECORD_STATUS),
  ...Object.values(REGUA_STATUS),
  ...Object.values(WHATSAPP_CONNECTION_STATUS),
  ...Object.values(ACCESS_LEVEL_STATUS),
  ...Object.values(IA_AGENDA_STATUS),
  ...Object.values(CONVERSAO_STATUS),
  ...Object.values(TOKEN_META_STATUS),
  ...Object.values(CONSENT_STATUS),
  ...Object.values(ATIVIDADE_STATUS),
];

describe("EXECUCAO_STATUS", () => {
  it("cobre todo status do banco, com ícone, rótulo e cor", () => {
    expect(Object.keys(EXECUCAO_STATUS).sort()).toEqual(
      [...STATUS_DE_EXECUCAO].sort(),
    );
    for (const definicao of Object.values(EXECUCAO_STATUS)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(0);
      expect(definicao.tone).toBeTruthy();
    }
  });

  it("cada status tem forma própria (não só a cor muda)", () => {
    const icones = Object.values(EXECUCAO_STATUS).map((d) => d.icon);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it("um ícone, uma cor: nada colide com os mapas do produto", () => {
    for (const definicao of Object.values(EXECUCAO_STATUS)) {
      for (const outro of TODOS) {
        if (outro.icon === definicao.icon) {
          expect(outro.tone).toBe(definicao.tone);
        }
      }
    }
  });
});
