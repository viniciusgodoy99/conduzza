import { describe, expect, it } from "vitest";

import {
  linhasDoCsv,
  montarExportavelDaAba,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AbaDeResultados,
  FunilDoPeriodo,
} from "@/lib/queries/relatorios";

import {
  ATENDIMENTO,
  CONVERSOES,
  FATURAMENTO,
  FUNIL,
  agenda,
} from "./dados-de-exemplo";

// A exportacao da Tela 11 (CSV e impressao) por aba, em secoes. A regra que
// mais importa: valor em reais so para admin e gestor. Para recepcao,
// leitura (e qualquer papel sem podeVerValores) nenhuma celula leva "R$",
// mesmo que um valor chegue por engano na entrada.

const ABAS: AbaDeResultados[] = ["geral", "marketing", "comercial", "ia"];

function entrada(
  aba: AbaDeResultados,
  extra: Partial<EntradaDaExportacao> = {},
): EntradaDaExportacao {
  return {
    aba,
    podeVerValores: false,
    canalOficial: false,
    funil: { atual: FUNIL, anterior: FUNIL },
    agenda: { atual: agenda(null), anterior: agenda(null) },
    atendimento: { atual: ATENDIMENTO, anterior: null },
    serie: [
      { dia: "2026-09-01", leads: 10, agendadas: 4 },
      { dia: "2026-09-02", leads: 0, agendadas: 0 },
    ],
    linhaDeBase: {
      ratePercent: 18,
      measuredFrom: "2026-07-01",
      measuredTo: "2026-07-30",
      note: null,
      createdAt: "2026-08-01T12:00:00Z",
    },
    objetivo: { percentual: 35.5, atualizadoEm: "2026-10-01T12:00:00Z" },
    conversoes: CONVERSOES,
    dimensaoOrigem: "canal",
    dimensaoAgenda: "profissional",
    ...extra,
  };
}

function todasAsCelulas(aba: AbaDeResultados, extra: Partial<EntradaDaExportacao>) {
  return linhasDoCsv(montarExportavelDaAba(entrada(aba, extra))).flat();
}

describe("montarExportavelDaAba: valores em reais", () => {
  it.each(ABAS)(
    "recepção (sem podeVerValores) não recebe nenhum R$ na aba %s",
    (aba) => {
      // Mesmo que o faturamento e a receita chegassem na entrada, nada sai.
      const celulas = todasAsCelulas(aba, {
        podeVerValores: false,
        canalOficial: true,
        faturamento: { atual: FATURAMENTO, anterior: null },
        agenda: { atual: agenda(15_000), anterior: null },
      });
      expect(celulas.length).toBeGreaterThan(0);
      expect(celulas.filter((celula) => celula.includes("R$"))).toEqual([]);
      expect(celulas).not.toContain("Faturamento estimado");
      expect(celulas).not.toContain("Custo por lead");
      expect(celulas).not.toContain("Custo do período");
      expect(celulas).not.toContain("Receita associada às recuperadas");
      expect(celulas).not.toContain("Valor já enviado");
    },
  );

  it("admin e gestor recebem o faturamento com o valor cheio", () => {
    const celulas = todasAsCelulas("geral", {
      podeVerValores: true,
      faturamento: { atual: FATURAMENTO, anterior: null },
    });
    const indice = celulas.indexOf("Faturamento estimado");
    expect(indice).toBeGreaterThan(-1);
    // Cheio, nunca o compacto do cartao ("R$ 284 mil").
    expect(celulas[indice + 1]).toBe("R$\u00a0284.000,00");
    expect(celulas).toContain("Custo por lead");
  });

  it.each(["geral", "comercial"] as const)(
    "faturamento sem preço para somar sai igual ao cartão na aba %s, nunca R$ 0,00",
    (aba) => {
      const semPreco = todasAsCelulas(aba, {
        podeVerValores: true,
        faturamento: {
          atual: { ...FATURAMENTO, comparecimentos: 1, valorCents: 0, comValor: 0, cobertas: 0, semPreco: 1 },
          anterior: null,
        },
      });
      // lastIndexOf: no Comercial "Faturamento estimado" tambem e titulo de secao
      const i = semPreco.lastIndexOf("Faturamento estimado");
      expect(semPreco[i + 1]).toBe("Sem preço para somar");
      expect(semPreco.filter((celula) => celula.includes("R$"))).toEqual([]);
      expect(semPreco[semPreco.indexOf("Comparecimentos sem preço cadastrado") + 1]).toBe("1");

      const soCobertas = todasAsCelulas(aba, {
        podeVerValores: true,
        faturamento: {
          atual: { ...FATURAMENTO, comparecimentos: 2, valorCents: 0, comValor: 0, cobertas: 2, semPreco: 0 },
          anterior: null,
        },
      });
      expect(soCobertas[soCobertas.lastIndexOf("Faturamento estimado") + 1]).toBe("Sem preço para somar");

      const nenhum = todasAsCelulas(aba, {
        podeVerValores: true,
        faturamento: {
          atual: { ...FATURAMENTO, comparecimentos: 0, valorCents: 0, comValor: 0, cobertas: 0, semPreco: 0 },
          anterior: null,
        },
      });
      expect(nenhum[nenhum.lastIndexOf("Faturamento estimado") + 1]).toBe("Nenhum comparecimento");
    },
  );

  it("receita das recuperadas nula (banco recusou) não vira R$ 0,00", () => {
    const celulas = todasAsCelulas("comercial", {
      podeVerValores: true,
      faturamento: null,
      agenda: { atual: agenda(null), anterior: null },
    });
    expect(celulas).not.toContain("Receita associada às recuperadas");
    expect(celulas).not.toContain("Faturamento estimado");
    expect(celulas.filter((celula) => celula.includes("R$"))).toEqual([]);
  });

  it("custo por mensagem só aparece com canal oficial", () => {
    expect(
      todasAsCelulas("ia", { podeVerValores: true, canalOficial: false }),
    ).not.toContain("Custo do período");
    expect(
      todasAsCelulas("ia", { podeVerValores: true, canalOficial: true }),
    ).toContain("Custo do período");
  });
});

describe("montarExportavelDaAba: seções e números", () => {
  it("a Visão geral leva indicadores, série, origem, funil, confirmação, agente e campanhas", () => {
    const exportavel = montarExportavelDaAba(entrada("geral"));
    expect(exportavel.titulo).toBe("Resultados: visão geral");
    expect(exportavel.secoes.map((secao) => secao.titulo)).toEqual([
      "Indicadores do período",
      "Leads x consultas agendadas",
      "Origem dos leads",
      "Funil comercial (leads que chegaram no período)",
      "Confirmação de consulta",
      "Agente de IA",
      "Campanhas",
    ]);
    const indicadores = exportavel.secoes[0]!.linhas;
    // 312 / 486 = 64,197...% com 1 casa.
    expect(indicadores).toContainEqual(["Taxa de conversão", "64,2%"]);
    expect(indicadores).toContainEqual(["Objetivo de conversão", "35,5%"]);
    const serie = exportavel.secoes[1]!.linhas;
    expect(serie[1]).toEqual(["01/09/2026", "10", "4"]);
  });

  it("Comercial usa a dimensão ativa no detalhe da agenda", () => {
    const exportavel = montarExportavelDaAba(
      entrada("comercial", { dimensaoAgenda: "status" }),
    );
    const detalhe = exportavel.secoes.find(
      (secao) => secao.titulo === "Detalhe da agenda",
    );
    expect(detalhe?.linhas[1]).toEqual(["Compareceu", "30", "", ""]);
  });

  it("Marketing troca o detalhe entre canal e campanha", () => {
    const porCampanha = montarExportavelDaAba(
      entrada("marketing", { dimensaoOrigem: "campanha" }),
    );
    const detalhe = porCampanha.secoes.find(
      (secao) => secao.titulo === "Detalhe por campanha",
    );
    expect(detalhe?.linhas.map((linha) => linha[0])).toEqual([
      "Origem",
      "Check-up 2026",
      "Sem campanha",
    ]);
  });

  it("taxa sem denominador sai como 'sem dados', nunca 0%", () => {
    const vazio: FunilDoPeriodo = {
      ...FUNIL,
      leads: 0,
      coorte: { leads: 0, agendaram: 0, compareceram: 0 },
      porCanal: [],
      porCampanha: [],
    };
    const exportavel = montarExportavelDaAba(
      entrada("geral", { funil: { atual: vazio, anterior: null } }),
    );
    expect(exportavel.secoes[0]!.linhas).toContainEqual([
      "Taxa de conversão",
      "sem dados",
    ]);
  });
});

describe("linhasDoCsv", () => {
  it("abre cada seção com o título e separa com uma linha vazia", () => {
    const linhas = linhasDoCsv({
      titulo: "x",
      secoes: [
        { titulo: "A", linhas: [["c1"], ["1"]] },
        { titulo: "B", linhas: [["c2"], ["2"]] },
      ],
    });
    expect(linhas).toEqual([["A"], ["c1"], ["1"], [], ["B"], ["c2"], ["2"]]);
  });
});
