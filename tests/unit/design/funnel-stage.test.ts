import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUS,
  CONTACT_RECENCY,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  PATIENT_TAG,
  type FunnelStage,
  type StatusDefinition,
} from "@/lib/design/status";

// Fase 4: crava as 6 etapas do funil (spec 5.3), o badge de recencia do
// cartao de lead e as etiquetas derivadas do paciente. Mesma disciplina do
// teste dos 10 status: regressao aqui muda a cor do Kanban em silencio.

const ESPERADO: Record<FunnelStage, string> = {
  novo: "neutral",
  em_contato: "info",
  aguardando_resposta: "warning",
  agendou: "success",
  compareceu: "success",
  perdido: "alert",
};

describe("as 6 etapas do funil", () => {
  it.each(Object.entries(ESPERADO))("%s tem tom %s", (stage, tone) => {
    expect(FUNNEL_STAGE[stage as FunnelStage].tone).toBe(tone);
  });

  it("toda etapa tem as 3 camadas: ícone, rótulo e tom", () => {
    for (const definicao of Object.values(FUNNEL_STAGE)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
      expect(definicao.tone.length).toBeGreaterThan(2);
    }
  });

  it("compareceu do funil usa o MESMO ícone e tom do compareceu da agenda", () => {
    // Mesma semantica, mesma forma, mesma cor: consistencia intencional.
    expect(FUNNEL_STAGE.compareceu.icon).toBe(
      APPOINTMENT_STATUS.compareceu.icon,
    );
    expect(FUNNEL_STAGE.compareceu.tone).toBe(
      APPOINTMENT_STATUS.compareceu.tone,
    );
  });
});

describe("recência e etiquetas de paciente", () => {
  it("os 3 níveis de recência têm as 3 camadas", () => {
    for (const definicao of Object.values(CONTACT_RECENCY)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
    }
  });

  it("as etiquetas de paciente têm as 3 camadas", () => {
    for (const definicao of Object.values(PATIENT_TAG)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
    }
  });
});

describe("regra global dos dicionários", () => {
  it("nenhum ícone aparece em dois tons diferentes, considerando todos os dicionários", () => {
    const todos: StatusDefinition[] = [
      ...Object.values(APPOINTMENT_STATUS),
      ...Object.values(CONVERSATION_STATUS),
      ...Object.values(FUNNEL_STAGE),
      ...Object.values(CONTACT_RECENCY),
      ...Object.values(PATIENT_TAG),
    ];
    const tomPorIcone = new Map<unknown, string>();
    for (const definicao of todos) {
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
});
