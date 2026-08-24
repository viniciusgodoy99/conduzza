import { describe, expect, it } from "vitest";

import { exibirPrecoVinculo } from "@/lib/domain/pricing";

// Aceite da 2.2: "Coberto" aparece como rotulo, nao como R$ 0,00.

describe("os três estados de preço do vínculo", () => {
  it("coberto pelo convênio é RÓTULO, nunca moeda", () => {
    expect(
      exibirPrecoVinculo({ price_cents: null, covered_by_insurance: true }),
    ).toEqual({ kind: "coberto", text: "Coberto" });
  });

  it("zero de verdade aparece como R$ 0,00", () => {
    const resultado = exibirPrecoVinculo({
      price_cents: 0,
      covered_by_insurance: false,
    });
    expect(resultado.kind).toBe("valor");
    expect(resultado.text.replace(/ /g, " ")).toBe("R$ 0,00");
  });

  it("preço não informado é vazio, não zero", () => {
    expect(
      exibirPrecoVinculo({ price_cents: null, covered_by_insurance: false }),
    ).toEqual({ kind: "vazio", text: "" });
  });

  it("valor normal formata em reais", () => {
    const resultado = exibirPrecoVinculo({
      price_cents: 40000,
      covered_by_insurance: false,
    });
    expect(resultado.text.replace(/ /g, " ")).toBe("R$ 400,00");
  });

  it("coberto COM preço mostra o preço (coparticipação declarada)", () => {
    const resultado = exibirPrecoVinculo({
      price_cents: 5000,
      covered_by_insurance: true,
    });
    expect(resultado.kind).toBe("valor");
  });
});
