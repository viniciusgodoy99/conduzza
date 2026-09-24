import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock,
  TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import { initialsOf } from "@/components/atendimento/contact-avatar";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
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
import { ACCESS_LABELS } from "@/lib/domain/permissions";

// Adocao do design system (docs/06 secao 4.6): os mapas novos de estado das
// telas de cadastro, automacao e configuracao seguem a mesma regra das 3
// camadas dos mapas antigos, e a regra global "um icone, uma cor" passa a
// valer para TODOS os mapas juntos.

const MAPAS_NOVOS = {
  RECORD_STATUS,
  REGUA_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  ACCESS_LEVEL_STATUS,
  IA_AGENDA_STATUS,
  CONVERSAO_STATUS,
  TOKEN_META_STATUS,
  CONSENT_STATUS,
};

const TODOS: StatusDefinition[] = [
  ...Object.values(APPOINTMENT_STATUS),
  ...Object.values(CONVERSATION_STATUS),
  ...Object.values(FUNNEL_STAGE),
  ...Object.values(CONTACT_RECENCY),
  ...Object.values(PATIENT_TAG),
  ...Object.values(APPOINTMENT_FLAG),
  ...Object.values(MAPAS_NOVOS).flatMap((mapa) => Object.values(mapa)),
];

describe("mapas novos de estado", () => {
  it.each(Object.entries(MAPAS_NOVOS))(
    "%s tem as 3 camadas em toda chave",
    (_nome, mapa) => {
      for (const definicao of Object.values(mapa)) {
        expect(definicao.icon).not.toBeNull();
        expect(definicao.label.length).toBeGreaterThan(2);
        expect(definicao.tone.length).toBeGreaterThan(2);
      }
    },
  );

  it("dentro de cada mapa, nenhum ícone se repete", () => {
    for (const mapa of Object.values(MAPAS_NOVOS)) {
      const icones = Object.values(mapa).map((definicao) => definicao.icon);
      expect(new Set(icones).size).toBe(icones.length);
    }
  });

  it("os rótulos do WhatsApp são os do painel de conexão (e2e confere Desconectado)", () => {
    expect(WHATSAPP_CONNECTION_STATUS.desconectado.label).toBe("Desconectado");
    expect(WHATSAPP_CONNECTION_STATUS.conectado.label).toBe("Conectado");
    expect(WHATSAPP_CONNECTION_STATUS.desconectado.tone).toBe("alert");
    expect(WHATSAPP_CONNECTION_STATUS.conectando.iconClassName).toContain(
      "motion-safe:animate-spin",
    );
  });

  it("o nível de acesso usa o texto de ACCESS_LABELS sem mudar", () => {
    for (const [acesso, definicao] of Object.entries(ACCESS_LEVEL_STATUS)) {
      expect(definicao.label).toBe(
        ACCESS_LABELS[acesso as keyof typeof ACCESS_LABELS],
      );
    }
  });

  it("consentimento revogado é alerta, nunca neutro", () => {
    expect(CONSENT_STATUS.revogado.tone).toBe("alert");
    expect(CONSENT_STATUS.autorizado.tone).toBe("success");
  });
});

describe("regra global dos dicionários, com os mapas novos", () => {
  it("nenhum ícone aparece em dois tons diferentes", () => {
    const tomPorIcone = new Map<unknown, string>();
    for (const definicao of TODOS) {
      if (definicao.icon === null) {
        continue;
      }
      const tomVisto = tomPorIcone.get(definicao.icon);
      if (tomVisto !== undefined) {
        expect(tomVisto).toBe(definicao.tone);
      }
      tomPorIcone.set(definicao.icon, definicao.tone);
    }
  });

  it("ícones reservados: CircleCheck só success, CirclePause e CircleDashed só neutral", () => {
    for (const definicao of TODOS) {
      if (definicao.icon === CircleCheck) {
        expect(definicao.tone).toBe("success");
      }
      if (definicao.icon === CirclePause || definicao.icon === CircleDashed) {
        expect(definicao.tone).toBe("neutral");
      }
    }
  });

  it("TriangleAlert é só do Faltou e Clock só do Aguardando", () => {
    const comTriangulo = TODOS.filter((d) => d.icon === TriangleAlert);
    expect(comTriangulo).toEqual([APPOINTMENT_STATUS.faltou]);
    const comRelogio = TODOS.filter((d) => d.icon === Clock);
    expect(comRelogio).toEqual([APPOINTMENT_STATUS.aguardando_confirmacao]);
  });
});

describe("iniciais do avatar de contato", () => {
  it("usa a primeira e a última palavra do nome", () => {
    expect(initialsOf("Maria Clara Souza", "5585999990000")).toBe("MS");
    expect(initialsOf("ana", "5585999990000")).toBe("A");
    expect(initialsOf("  João   Pedro  ", "5585999990000")).toBe("JP");
  });

  it("sem nome, os 2 últimos dígitos do telefone", () => {
    expect(initialsOf(null, "5585999991234")).toBe("34");
    expect(initialsOf("   ", "5585999991234")).toBe("34");
  });
});
