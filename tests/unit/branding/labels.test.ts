import { describe, expect, it } from "vitest";

import { DEFAULT_LABELS, createT, pluralize } from "@/lib/branding/labels";

describe("pluralize (pt-BR)", () => {
  it.each([
    ["profissional", "profissionais"],
    ["procedimento", "procedimentos"],
    ["paciente", "pacientes"],
    ["consulta", "consultas"],
    ["advogado", "advogados"],
    ["cliente", "clientes"],
    ["serviço", "serviços"],
    ["sessão", "sessões"],
    ["doutor", "doutores"],
    ["Advogado", "Advogados"],
  ])("%s vira %s", (singular, plural) => {
    expect(pluralize(singular)).toBe(plural);
  });
});

describe("createT", () => {
  it("usa o label da clínica quando existe", () => {
    const t = createT({ profissional: "advogado" });
    expect(t("profissional")).toBe("advogado");
    expect(t("profissional", { plural: true })).toBe("advogados");
    expect(t("profissional", { plural: true, capitalize: true })).toBe(
      "Advogados",
    );
  });

  it("cai no padrão quando a chave falta ou está vazia", () => {
    const t = createT({ profissional: "  " });
    expect(t("profissional")).toBe(DEFAULT_LABELS.profissional);
    expect(t("paciente", { capitalize: true })).toBe("Paciente");
  });

  it("funciona sem labels nenhum", () => {
    const t = createT(null);
    expect(t("consulta", { plural: true, capitalize: true })).toBe("Consultas");
  });

  it("o caso do aceite: advogado muda a interface inteira", () => {
    const t = createT({
      profissional: "advogado",
      procedimento: "serviço",
      paciente: "cliente",
      consulta: "reunião",
    });
    expect(t("paciente", { plural: true, capitalize: true })).toBe("Clientes");
    expect(t("procedimento", { plural: true })).toBe("serviços");
    expect(t("consulta", { plural: true })).toBe("reuniões");
  });
});
