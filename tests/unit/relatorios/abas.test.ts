import { describe, expect, it } from "vitest";

import {
  ABAS_DE_RESULTADOS,
  resolverAbaDeResultados,
} from "@/lib/queries/relatorios";

// As 4 vistas de Resultados da Fase 3 e o alias das 5 abas antigas: link
// salvo, favorito e o atalho de outras telas continuam abrindo a vista que
// recebeu o conteudo, nunca uma tela vazia.

describe("ABAS_DE_RESULTADOS", () => {
  it("são as 4 vistas do design, nesta ordem", () => {
    expect(ABAS_DE_RESULTADOS.map((aba) => aba.chave)).toEqual([
      "geral",
      "marketing",
      "comercial",
      "ia",
    ]);
    expect(ABAS_DE_RESULTADOS.map((aba) => aba.rotulo)).toEqual([
      "Visão geral",
      "Marketing",
      "Comercial",
      "Agente de IA",
    ]);
  });
});

describe("resolverAbaDeResultados", () => {
  it("aceita as chaves novas como vieram", () => {
    expect(resolverAbaDeResultados("geral")).toBe("geral");
    expect(resolverAbaDeResultados("marketing")).toBe("marketing");
    expect(resolverAbaDeResultados("comercial")).toBe("comercial");
    expect(resolverAbaDeResultados("ia")).toBe("ia");
  });

  it("leva as chaves antigas para a vista que recebeu o conteúdo", () => {
    expect(resolverAbaDeResultados("origem")).toBe("marketing");
    expect(resolverAbaDeResultados("agendamentos")).toBe("comercial");
    expect(resolverAbaDeResultados("confirmacao")).toBe("comercial");
    expect(resolverAbaDeResultados("custos")).toBe("ia");
  });

  it("sem aba, ou com aba desconhecida, abre a Visão geral", () => {
    expect(resolverAbaDeResultados(undefined)).toBe("geral");
    expect(resolverAbaDeResultados(null)).toBe("geral");
    expect(resolverAbaDeResultados("")).toBe("geral");
    expect(resolverAbaDeResultados("painel")).toBe("geral");
    expect(resolverAbaDeResultados("GERAL")).toBe("geral");
    expect(resolverAbaDeResultados("constructor")).toBe("geral");
  });
});
