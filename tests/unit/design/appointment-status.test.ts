import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_STATUS,
  type AppointmentStatus,
} from "@/lib/design/status";

// Fase 2: crava os 10 pares status/tom do agendamento (brief 3.5, com a
// excecao documentada de na_recepcao/em_atendimento). Regressao aqui muda a
// cor de TODA a agenda em silencio.

const ESPERADO: Record<AppointmentStatus, string> = {
  agendado: "neutral",
  aguardando_confirmacao: "warning",
  confirmado_paciente: "success",
  confirmado_recepcao: "success",
  na_recepcao: "warning",
  em_atendimento: "info",
  compareceu: "success",
  cancelado_paciente: "alert",
  cancelado_clinica: "alert",
  faltou: "alert",
};

describe("os 10 status de agendamento", () => {
  it.each(Object.entries(ESPERADO))("%s tem tom %s", (status, tone) => {
    expect(APPOINTMENT_STATUS[status as AppointmentStatus].tone).toBe(tone);
  });

  it("todo status tem as 3 camadas: ícone, rótulo e tom", () => {
    for (const definicao of Object.values(APPOINTMENT_STATUS)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
      expect(definicao.tone.length).toBeGreaterThan(2);
    }
  });

  it("o chip diferencia as duas confirmações pelo rótulo e pelo ícone", () => {
    const paciente = APPOINTMENT_STATUS.confirmado_paciente;
    const recepcao = APPOINTMENT_STATUS.confirmado_recepcao;
    expect(paciente.label).not.toBe(recepcao.label);
    expect(paciente.icon).not.toBe(recepcao.icon);
  });

  it("dentro do mesmo tom, nunca o mesmo ícone (regra das 3 camadas)", () => {
    const porTom = new Map<string, Set<unknown>>();
    for (const definicao of Object.values(APPOINTMENT_STATUS)) {
      const conjunto = porTom.get(definicao.tone) ?? new Set();
      expect(conjunto.has(definicao.icon)).toBe(false);
      conjunto.add(definicao.icon);
      porTom.set(definicao.tone, conjunto);
    }
  });
});
