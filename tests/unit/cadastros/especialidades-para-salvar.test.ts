import { describe, expect, it } from "vitest";

import { especialidadesParaSalvar } from "@/lib/domain/profissionais";

// Relato do dono (02/10/2026): digitar a especialidade e clicar em Salvar
// sem apertar Enter deixava o profissional "Sem especialidade".

describe("especialidadesParaSalvar", () => {
  it("o que ficou digitado sem Enter entra na lista", () => {
    expect(especialidadesParaSalvar([], "  Dermatologia ")).toEqual([
      "Dermatologia",
    ]);
    expect(especialidadesParaSalvar(["Estética"], "Dermatologia")).toEqual([
      "Estética",
      "Dermatologia",
    ]);
  });

  it("campo vazio ou repetido não muda a lista", () => {
    expect(especialidadesParaSalvar(["Estética"], "   ")).toEqual(["Estética"]);
    expect(especialidadesParaSalvar(["Estética"], "Estética")).toEqual([
      "Estética",
    ]);
  });

  it("não altera a lista recebida", () => {
    const adicionadas = ["Estética"];
    especialidadesParaSalvar(adicionadas, "Dermatologia");
    expect(adicionadas).toEqual(["Estética"]);
  });
});
