import { describe, expect, it } from "vitest";

import { gerarCsv, neutralizarFormula, parseCsv } from "@/lib/utils/csv";

// Injecao de formula no CSV (revisao de 20/10/2026): celula de texto que
// comeca com =, +, -, @, tabulacao ou CR vira formula quando a planilha abre
// o arquivo. O gerarCsv e o de TODA exportacao (Resultados, Agenda e as
// linhas recusadas da importacao), entao a neutralizacao vale para todas:
// o titulo do anuncio vem da mensagem e o nome do paciente vem do WhatsApp.

describe("neutralizarFormula", () => {
  it("texto que começa como fórmula ganha um apóstrofo na frente", () => {
    for (const celula of [
      '=HYPERLINK("https://exemplo.invalid";"Clique aqui")',
      "=1+1",
      "+Saúde",
      "+55 promo",
      "-30% na limpeza de pele",
      "@SOMA(A1:A2)",
      "\tcom tabulação",
      "\rcom retorno",
      "-",
      "+",
    ]) {
      expect(neutralizarFormula(celula), celula).toBe(`'${celula}`);
    }
  });

  it("número e percentual não são texto: ficam como estão", () => {
    for (const celula of [
      "-5",
      "+3",
      "12,5%",
      "-12,5%",
      "1.234",
      "0,0%",
      "+5585999990001",
      "100",
    ]) {
      expect(neutralizarFormula(celula), celula).toBe(celula);
    }
  });

  it("texto comum não muda", () => {
    for (const celula of [
      "Maria Silva",
      "Limpeza de pele com 30% de desconto",
      "R$ 1.234,56",
      "Sem anúncio da Meta",
      "",
      " =espaço antes",
    ]) {
      expect(neutralizarFormula(celula), celula).toBe(celula);
    }
  });
});

describe("gerarCsv neutraliza toda exportação", () => {
  it("a linha da Agenda com nome forjado sai como texto; o telefone fica", () => {
    const csv = gerarCsv([
      ["Hora", "Paciente", "Telefone", "Duração (min)"],
      ["09:00", '=HYPERLINK("https://exemplo.invalid";"oi")', "+5585999990001", "30"],
      ["10:00", "@Maria", "+5585999990002", "45"],
    ]);
    const linhas = csv.replace(/^﻿/, "").split("\r\n");
    expect(linhas[1]).toBe(
      `09:00;"'=HYPERLINK(""https://exemplo.invalid"";""oi"")";+5585999990001;30`,
    );
    expect(linhas[2]).toBe("10:00;'@Maria;+5585999990002;45");
  });

  it("célula que começa com CR ou tabulação: apóstrofo e aspas", () => {
    const csv = gerarCsv([["\r=1+1", "\t=1+1"]]);
    expect(csv).toBe(`﻿"'\r=1+1";'\t=1+1`);
  });

  it("a ida e volta preserva o texto, com o apóstrofo que a planilha mostra", () => {
    const { linhas } = parseCsv(gerarCsv([["Título"], ["+Saúde; promo"]]));
    expect(linhas).toEqual([["Título"], ["'+Saúde; promo"]]);
  });
});
