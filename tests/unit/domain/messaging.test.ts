import { describe, expect, it } from "vitest";

import { canSendDecision, windowState } from "@/lib/domain/messaging";

describe("canSendDecision", () => {
  it("sem consentimento ativo é recusado, mesmo com conta conectada", () => {
    expect(
      canSendDecision({ consentActive: false, accountStatus: "conectado" }),
    ).toEqual({ allowed: false, reason: "sem_consentimento" });
  });

  it("com consentimento mas desconectado é recusado", () => {
    expect(
      canSendDecision({ consentActive: true, accountStatus: "desconectado" }),
    ).toEqual({ allowed: false, reason: "desconectado" });
    expect(
      canSendDecision({ consentActive: true, accountStatus: null }),
    ).toEqual({ allowed: false, reason: "desconectado" });
  });

  it("consentimento ativo e conta conectada libera", () => {
    expect(
      canSendDecision({ consentActive: true, accountStatus: "conectado" }),
    ).toEqual({ allowed: true });
  });
});

describe("windowState (janela de 24h, canal oficial)", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("sem janela registrada", () => {
    expect(windowState(null, now).phase).toBe("sem_janela");
  });

  it("ok acima de 4 horas", () => {
    expect(windowState("2026-08-19T18:00:00Z", now).phase).toBe("ok");
  });

  it("âmbar abaixo de 4 horas (limite exato)", () => {
    expect(windowState("2026-08-19T15:59:59Z", now).phase).toBe("atencao");
    expect(windowState("2026-08-19T16:00:00Z", now).phase).toBe("ok");
  });

  it("alerta abaixo de 1 hora (limite exato)", () => {
    expect(windowState("2026-08-19T12:59:59Z", now).phase).toBe("alerta");
    expect(windowState("2026-08-19T13:00:00Z", now).phase).toBe("atencao");
  });

  it("expirada quando passou", () => {
    const state = windowState("2026-08-19T11:59:59Z", now);
    expect(state.phase).toBe("expirada");
    expect(state.remainingMs).toBe(0);
  });
});
