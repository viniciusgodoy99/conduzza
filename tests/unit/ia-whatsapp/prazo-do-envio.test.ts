import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  PRAZO_MAXIMO_DO_ENVIO_MS,
  PRAZO_MINIMO_DO_ENVIO_MS,
  prazoDoEnvioMs,
  RESERVA_DAS_GRAVACOES_MS,
  RESERVA_DO_ENVIO_MS,
} = await import("@/lib/jobs/responder-com-ia");

// 11/11/2026: o uazapi respondeu depois de 10 s com a resposta da IA ja
// entregue; o envio virou "incerto" e a conversa saiu da IA. O envio da IA
// passa a esperar o que sobrou do turno, entre 10 e 25 s.
describe("prazoDoEnvioMs", () => {
  it("no aperto, os 10 s de sempre; com folga, o que sobrou; nunca mais que 25 s", () => {
    expect(prazoDoEnvioMs(RESERVA_DO_ENVIO_MS)).toBe(PRAZO_MINIMO_DO_ENVIO_MS);
    // o caso de 11/11: o turno levou 24 s e sobravam 31 s
    expect(prazoDoEnvioMs(31_000)).toBe(24_000);
    expect(prazoDoEnvioMs(55_000)).toBe(PRAZO_MAXIMO_DO_ENVIO_MS);
  });

  it("com folga, o envio e as gravacoes ainda cabem no que sobrou", () => {
    for (let restante = 17_000; restante <= 60_000; restante += 1_000) {
      // 3 s da espera do slot (send.ts) + o prazo + as gravacoes
      expect(
        3_000 + prazoDoEnvioMs(restante) + RESERVA_DAS_GRAVACOES_MS,
        String(restante),
      ).toBeLessThanOrEqual(restante);
    }
  });
});
