import { describe, expect, it } from "vitest";

import {
  dataCurtaNaClinica,
  dataNaClinica,
  horaNaClinica,
  rotuloDoDia,
} from "@/components/atendimento/fuso-da-clinica";
import { estadoDoConsentimento } from "@/lib/queries/conversations";

// Achado 21: as horas do Atendimento saiam no fuso do navegador. Aqui o
// relogio da clinica manda, qualquer que seja o fuso de quem roda o teste.

const FORTALEZA = "America/Fortaleza"; // UTC-3 fixo
const MANAUS = "America/Manaus"; // UTC-4 fixo

describe("hora e data no fuso da clínica", () => {
  it("01:30Z é 22:30 do dia anterior em Fortaleza", () => {
    expect(horaNaClinica("2026-09-23T01:30:00Z", FORTALEZA)).toBe("22:30");
    expect(dataCurtaNaClinica("2026-09-23T01:30:00Z", FORTALEZA)).toBe("22/09");
    expect(dataNaClinica("2026-09-23T01:30:00Z", FORTALEZA)).toBe("22/09/2026");
  });

  it("o mesmo instante muda de hora com o fuso da clínica", () => {
    expect(horaNaClinica("2026-09-23T12:00:00Z", MANAUS)).toBe("08:00");
  });
});

describe("rótulo do separador de dia", () => {
  const agora = new Date("2026-09-24T15:00:00Z"); // quinta, 12:00 em Fortaleza

  it("hoje e ontem pelo calendário da clínica", () => {
    expect(rotuloDoDia("2026-09-24T09:00:00Z", FORTALEZA, agora)).toBe("Hoje");
    // 02:00Z de 24/09 ainda é 23/09 em Fortaleza: ontem, não hoje.
    expect(rotuloDoDia("2026-09-24T02:00:00Z", FORTALEZA, agora)).toBe("Ontem");
  });

  it("dia da semana sem o '-feira' e com inicial maiúscula", () => {
    expect(rotuloDoDia("2026-09-22T15:00:00Z", FORTALEZA, agora)).toBe(
      "Terça, 22 de setembro",
    );
  });

  it("outro ano leva o ano junto", () => {
    expect(rotuloDoDia("2025-12-30T15:00:00Z", FORTALEZA, agora)).toBe(
      "Terça, 30 de dezembro de 2025",
    );
  });
});

describe("estado da autorização de mensagens", () => {
  it("separa autorizado, revogado e nunca autorizou", () => {
    expect(estadoDoConsentimento(null)).toBe("sem_autorizacao");
    expect(
      estadoDoConsentimento({
        source: "conversa",
        granted_at: "2026-09-01T10:00:00Z",
        revoked_at: null,
      }),
    ).toBe("autorizado");
    expect(
      estadoDoConsentimento({
        source: "conversa",
        granted_at: "2026-09-01T10:00:00Z",
        revoked_at: "2026-09-10T10:00:00Z",
      }),
    ).toBe("revogado");
  });
});
