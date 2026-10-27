import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CAMADAS_DO_FILTRO,
  CATEGORIAS_CLINICAS,
  CATEGORIAS_DE_CONFORMIDADE,
  CATEGORIAS_DO_VERIFICADOR,
  CATEGORIAS_DOS_FATOS,
  GATILHOS_DE_ENTRADA,
  GATILHOS_DO_CLASSIFICADOR,
} from "@/lib/domain/conformidade/categorias";

// Espelho do banco: ai_decision_log tem CHECK com exatamente estas listas
// (migration 20261006100000; as quatro dos fatos do turno na 20261027110000).
// Mudou aqui, muda la, com migration nova.

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
      "acao_nao_executada",
      "cobertura_nao_verificada",
      "horario_nao_verificado",
      "endereco_nao_verificado",
      "formato_invalido",
      "falha_verificador",
    ]);
  });

  it("as quatro dos fatos do turno sao so da regra (o modelo nunca julga fato)", () => {
    expect(CATEGORIAS_DOS_FATOS).toEqual([
      "acao_nao_executada",
      "cobertura_nao_verificada",
      "horario_nao_verificado",
      "endereco_nao_verificado",
    ]);
    for (const categoria of CATEGORIAS_DOS_FATOS) {
      expect(CATEGORIAS_DO_VERIFICADOR).not.toContain(categoria);
      expect(CATEGORIAS_DE_CONFORMIDADE).toContain(categoria);
    }
  });

  it("o CHECK de ai_decision_log.compliance_rule na migration 20261027110000 tem exatamente estas categorias", () => {
    const sql = readFileSync(
      "supabase/migrations/20261027110000_categorias_de_fatos.sql",
      "utf8",
    );
    const check =
      /add constraint ai_decision_log_compliance_rule_valida\s+check \(compliance_rule is null or compliance_rule in \(([^)]*)\)\)\s+not valid;/i.exec(
        sql,
      );
    expect(check).not.toBeNull();
    const valores = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect([...valores].sort()).toEqual([...CATEGORIAS_DE_CONFORMIDADE].sort());
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
