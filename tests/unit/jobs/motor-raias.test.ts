import { describe, expect, it } from "vitest";

import { raiasDoAmbiente } from "@/lib/jobs/motor";

// Quantas raias o claim de envio traz por passagem (contrato da Fase 3, fila
// por raia, docs/07). MOTOR_MAX_CLINICAS passou a contar raias, com padrao 8.
// Um valor torto no ambiente nao pode virar um claim recusado a cada
// passagem (NaN ou zero no p_max_clinicas): cai no padrao.

describe("raias por passagem do motor", () => {
  it("sem a variável, o padrão é 8", () => {
    expect(raiasDoAmbiente(undefined)).toBe(8);
  });

  it("inteiro positivo vale como veio", () => {
    expect(raiasDoAmbiente("4")).toBe(4);
    expect(raiasDoAmbiente("12")).toBe(12);
  });

  it.each(["", "  ", "0", "-3", "2.5", "oito", "NaN"])(
    "valor torto (%j) cai no padrão",
    (valor) => {
      expect(raiasDoAmbiente(valor)).toBe(8);
    },
  );
});
