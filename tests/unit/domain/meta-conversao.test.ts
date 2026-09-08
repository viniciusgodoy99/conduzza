import { describe, expect, it } from "vitest";

import {
  EVENTOS_META_PADRAO,
  ehEventoPadrao,
  rotuloDoEvento,
} from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// O catalogo alimenta o Select do mapa de conversao e, depois, o payload do
// CAPI (R4). O nome do evento e o que a Meta recebe LITERALMENTE, entao um
// typo aqui viraria evento desconhecido na conta de anuncios da clinica.

describe("catálogo de eventos da Meta", () => {
  it("tem os 17 eventos padrão, sem duplicata", () => {
    expect(EVENTOS_META_PADRAO).toHaveLength(17);
    const nomes = EVENTOS_META_PADRAO.map((evento) => evento.nome);
    expect(new Set(nomes).size).toBe(17);
  });

  it("os nomes são os literais que a Meta espera, sensíveis a maiúsculas", () => {
    // Amostra dos que o produto sugere (docs/06 D2): errar a caixa aqui
    // mandaria um evento que a Meta não reconhece como padrão.
    for (const nome of ["Lead", "Schedule", "Purchase", "Contact"]) {
      expect(ehEventoPadrao(nome)).toBe(true);
    }
    expect(ehEventoPadrao("purchase")).toBe(false);
    expect(ehEventoPadrao("QualquerCoisa")).toBe(false);
  });

  it("todo evento padrão tem rótulo em linguagem de recepção", () => {
    for (const evento of EVENTOS_META_PADRAO) {
      expect(evento.rotulo.length).toBeGreaterThan(3);
    }
  });

  it("evento personalizado exibe o próprio nome", () => {
    expect(rotuloDoEvento("MinhaConversaoCustom")).toBe("MinhaConversaoCustom");
    expect(rotuloDoEvento("Purchase")).toBe("Compra (Purchase)");
  });
});

describe("conversão de dinheiro do formulário", () => {
  it("ida e volta preserva os centavos", () => {
    expect(reaisParaCentavos(centavosParaReais(25000))).toBe(25000);
    expect(centavosParaReais(25000)).toBe("250,00");
  });

  it("aceita os jeitos que a recepção digita", () => {
    expect(reaisParaCentavos("250,00")).toBe(25000);
    expect(reaisParaCentavos("250")).toBe(25000);
    expect(reaisParaCentavos("1.250,50")).toBe(125050);
    expect(reaisParaCentavos(" 90,9 ")).toBe(9090);
  });

  it("vazio e inválido viram null, nunca zero", () => {
    // null e "sem valor" sao coisas diferentes de "custa zero": a constraint
    // do banco exige centavos no modo fixo, e o formulario usa o null para
    // pedir o valor de novo.
    expect(reaisParaCentavos("")).toBeNull();
    expect(reaisParaCentavos("abc")).toBeNull();
    expect(reaisParaCentavos("-10")).toBeNull();
    expect(centavosParaReais(null)).toBe("");
  });
});
