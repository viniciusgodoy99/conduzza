import { describe, expect, it } from "vitest";

import {
  CAMADAS_DO_FILTRO,
  CATEGORIAS_CLINICAS,
  CATEGORIAS_DE_CONFORMIDADE,
  CATEGORIAS_DO_VERIFICADOR,
  GATILHOS_DE_ENTRADA,
  GATILHOS_DO_CLASSIFICADOR,
} from "@/lib/domain/conformidade/categorias";

// Espelho do banco: ai_decision_log tem CHECK com exatamente estas listas
// (migration 20261006100000). Mudou aqui, muda la, com migration nova.

describe("categorias do filtro", () => {
  it("lista fechada, na ordem de prioridade", () => {
    expect(CATEGORIAS_DE_CONFORMIDADE).toEqual([
      "triagem",
      "diagnostico",
      "orientacao_clinica",
      "medicamento",
      "dosagem",
      "promessa_resultado",
      "oferta_casada",
      "antes_depois",
      "preco_nao_verificado",
      "formato_invalido",
      "falha_verificador",
    ]);
  });

  it("as oito do CFM sao o que o verificador julga, mais o formato", () => {
    expect(CATEGORIAS_CLINICAS).toHaveLength(8);
    expect(CATEGORIAS_DO_VERIFICADOR).toEqual([
      ...CATEGORIAS_CLINICAS,
      "formato_invalido",
    ]);
  });

  it("camadas", () => {
    expect(CAMADAS_DO_FILTRO).toEqual(["regra", "modelo", "falha"]);
  });
});

describe("gatilhos de entrada", () => {
  it("lista fechada", () => {
    expect([...GATILHOS_DE_ENTRADA].sort()).toEqual(
      [
        "sintoma",
        "assunto_clinico",
        "pedido_humano",
        "insatisfacao",
        "menor_de_idade",
        "valor_fora_da_tabela",
        "manipulacao",
        "midia",
        "mensagem_longa",
      ].sort(),
    );
  });

  it("o classificador nao ve midia nem mensagem longa", () => {
    expect(GATILHOS_DO_CLASSIFICADOR).not.toContain("midia");
    expect(GATILHOS_DO_CLASSIFICADOR).not.toContain("mensagem_longa");
  });
});
