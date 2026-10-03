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
  campanhasPeriodizadas,
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
    // Dado da GESTAO de proposito (com investimento): para quem nao pode ver
    // valores, nada em reais pode sair mesmo que o dado chegue por engano.
    campanhas: campanhasPeriodizadas(),
    timezone: "America/Fortaleza",
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
      expect(celulas).not.toContain("Investimento no período");
      expect(celulas).not.toContain("Investimento");
      expect(celulas).not.toContain("Investimento atualizado em");
      expect(celulas.some((celula) => celula.startsWith("Investimento sem lead casado"))).toBe(false);
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
        // So o faturamento: o investimento da Meta tem os proprios testes.
        campanhas: undefined,
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

  it("Marketing troca o detalhe entre canal e campanha (as linhas da tabela Campanhas)", () => {
    const porCampanha = montarExportavelDaAba(
      entrada("marketing", { dimensaoOrigem: "campanha" }),
    );
    const detalhe = porCampanha.secoes.find(
      (secao) => secao.titulo === "Detalhe por campanha",
    );
    // Fase 4: casado por id (campanhas_do_periodo), a campanha sem lead
    // nao entra no detalhe e "Sem campanha" fecha a soma dos 486 leads.
    expect(detalhe?.linhas).toEqual([
      ["Origem", "Leads", "Agendaram", "Compareceram", "Comparecimento"],
      ["Implante Dentário", "120", "80", "60", "50,0%"],
      ["Campanha 120000000000000020", "30", "20", "10", "33,3%"],
      ["Check-up 2026", "186", "112", "90", "48,4%"],
      ["Sem campanha", "150", "100", "90", "60,0%"],
    ]);
  });

  it("detalhe por campanha sem as campanhas carregadas fica fora, nunca vazio falso", () => {
    const exportavel = montarExportavelDaAba(
      entrada("marketing", { dimensaoOrigem: "campanha", campanhas: undefined }),
    );
    const titulos = exportavel.secoes.map((secao) => secao.titulo);
    expect(titulos).not.toContain("Detalhe por campanha");
    expect(titulos).not.toContain("Campanhas");
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

describe("montarExportavelDaAba: investimento da Meta (Fase 4)", () => {
  function secao(aba: AbaDeResultados, titulo: string, extra: Partial<EntradaDaExportacao>) {
    return montarExportavelDaAba(entrada(aba, extra)).secoes.find(
      (s) => s.titulo === titulo,
    );
  }

  function semNbsp(linhas: string[][] | undefined): string[][] {
    return (linhas ?? []).map((linha) =>
      linha.map((celula) => celula.replace(/\u00a0/g, " ")),
    );
  }

  it.each(["geral", "marketing"] as const)(
    "admin na aba %s: custo por lead, investimento, divisor e quando foi lido",
    (aba) => {
      const indicadores = semNbsp(
        secao(aba, "Indicadores do período", { podeVerValores: true })?.linhas,
      );
      expect(indicadores).toContainEqual(["Custo por lead", "R$ 30,00"]);
      expect(indicadores).toContainEqual(["Investimento no período", "R$ 4.860,00"]);
      expect(indicadores).toContainEqual(["Leads de anúncio", "162"]);
      expect(indicadores).toContainEqual(["Investimento lido a partir de", "04/08/2026"]);
      expect(indicadores).toContainEqual(["Investimento lido até", "02/10/2026"]);
      // No fuso da clinica (America/Fortaleza): 09:00 UTC = 06:00.
      expect(indicadores).toContainEqual(["Investimento atualizado em", "02/10 às 06:00"]);
      // Conta em America/Sao_Paulo: o mesmo deslocamento, sem aviso de fuso.
      expect(indicadores.map((linha) => linha[0])).not.toContain("Fuso do investimento");
    },
  );

  it("leitura parada: Ainda não medido no custo e no investimento, até quando foi lido, Não medido nas células", () => {
    const extra = {
      podeVerValores: true,
      campanhas: campanhasPeriodizadas({
        situacao: "com_problema",
        problema: "token_invalido",
        lidoAte: "2026-09-13",
        investimentoCents: 100_000,
      }),
    };
    const indicadores = secao("geral", "Indicadores do período", extra)?.linhas;
    expect(indicadores).toContainEqual(["Custo por lead", "Ainda não medido"]);
    expect(indicadores).toContainEqual(["Investimento no período", "Ainda não medido"]);
    expect(indicadores).toContainEqual(["Investimento lido até", "13/09/2026"]);
    const campanhas = secao("geral", "Campanhas", extra)?.linhas;
    expect(campanhas?.[1]).toEqual([
      "Implante Dentário",
      "Não medido",
      "120",
      "Não medido",
      "80",
      "66,7%",
    ]);
    expect(
      campanhas?.flat().some((celula) => celula.startsWith("Investimento sem lead casado")),
    ).toBe(false);
  });

  it("conta em outro fuso: a linha Fuso do investimento só para a gestão", () => {
    const campanhas = campanhasPeriodizadas({ fusoDaConta: "America/New_York" });
    const indicadores = secao("geral", "Indicadores do período", {
      podeVerValores: true,
      campanhas,
    })?.linhas;
    expect(indicadores).toContainEqual([
      "Fuso do investimento",
      "Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.",
    ]);
    const daRecepcao = todasAsCelulas("geral", { podeVerValores: false, campanhas });
    expect(daRecepcao).not.toContain("Fuso do investimento");
    // Sem fuso da clinica, nada de aviso (nunca o fuso do servidor).
    const semFuso = secao("geral", "Indicadores do período", {
      podeVerValores: true,
      campanhas,
      timezone: undefined,
    })?.linhas;
    expect(semFuso?.map((linha) => linha[0])).not.toContain("Fuso do investimento");
  });

  it("admin: a tabela Campanhas com as colunas e as células do contrato", () => {
    const linhas = semNbsp(
      secao("geral", "Campanhas", { podeVerValores: true })?.linhas,
    );
    expect(linhas).toEqual([
      ["Campanha", "Investimento", "Leads", "Custo por lead", "Agendados", "Conversão"],
      ["Implante Dentário", "R$ 3.420,00", "120", "R$ 28,50", "80", "66,7%"],
      ["Campanha 120000000000000020", "R$ 600,00", "30", "R$ 20,00", "20", "66,7%"],
      ["Remarketing Botox", "R$ 500,00", "0", "Sem leads", "0", "sem dados"],
      ["Check-up 2026", "Fora da Meta", "186", "Fora da Meta", "112", "60,2%"],
      ["Investimento sem lead casado: R$ 500,00 em 1 campanha"],
      ["Leads sem campanha: 150 de 486"],
      ["Leads de anúncio sem campanha reconhecida: 12"],
    ]);
  });

  it("recepção: a tabela sem as colunas em reais, com a nota e sem a campanha de 0 lead", () => {
    const linhas = secao("marketing", "Campanhas", { podeVerValores: false })?.linhas;
    expect(linhas).toEqual([
      ["Campanha", "Leads", "Agendados", "Conversão"],
      ["Implante Dentário", "120", "80", "66,7%"],
      ["Campanha 120000000000000020", "30", "20", "66,7%"],
      ["Check-up 2026", "186", "112", "60,2%"],
      ["Leads sem campanha: 150 de 486"],
      ["Leads de anúncio sem campanha reconhecida: 12"],
      ["Investimento e custo por lead: só administrador e gestor."],
    ]);
  });

  it("recepção com o retrato que o banco devolve (investimento null): nenhum R$ no CSV", () => {
    const campanhas = campanhasPeriodizadas(null);
    const celulas = todasAsCelulas("geral", { podeVerValores: false, campanhas });
    expect(celulas.filter((celula) => celula.includes("R$"))).toEqual([]);
    expect(celulas).not.toContain("Custo por lead");
  });

  it("gestor que o banco tratou como sem acesso (investimento null): nada em reais", () => {
    const celulas = todasAsCelulas("geral", {
      podeVerValores: true,
      faturamento: null,
      agenda: { atual: agenda(null), anterior: null },
      campanhas: campanhasPeriodizadas(null),
    });
    expect(celulas.filter((celula) => celula.includes("R$"))).toEqual([]);
    expect(celulas).not.toContain("Custo por lead");
    expect(celulas).toContain("Investimento e custo por lead: só administrador e gestor.");
  });

  it("sem leitura configurada: Ainda não medido no custo e Não medido nas células da Meta", () => {
    const extra = {
      podeVerValores: true,
      campanhas: campanhasPeriodizadas({ configurada: false, lidoDesde: null, sincronizadoEm: null }),
    };
    const indicadores = secao("geral", "Indicadores do período", extra)?.linhas;
    expect(indicadores).toContainEqual(["Custo por lead", "Ainda não medido"]);
    expect(indicadores).toContainEqual(["Investimento no período", "Ainda não medido"]);
    expect(indicadores?.map((linha) => linha[0])).not.toContain("Investimento atualizado em");
    const campanhas = secao("geral", "Campanhas", extra)?.linhas;
    expect(campanhas?.[1]).toEqual([
      "Implante Dentário",
      "Não medido",
      "120",
      "Não medido",
      "80",
      "66,7%",
    ]);
    // Sem medida, a conferencia em reais some (nao vira R$ 0,00).
    expect(campanhas?.flat().some((celula) => celula.startsWith("Investimento sem lead casado"))).toBe(false);
  });

  it("outra moeda: o mesmo texto do cartão, sem número", () => {
    const indicadores = secao("geral", "Indicadores do período", {
      podeVerValores: true,
      campanhas: campanhasPeriodizadas({ moeda: "USD", outraMoeda: true }),
    })?.linhas;
    expect(indicadores).toContainEqual(["Custo por lead", "Conta em outra moeda"]);
    expect(indicadores).toContainEqual(["Investimento no período", "Conta em outra moeda"]);
  });

  it("período antes da leitura: Ainda não medido e o dia a partir do qual é lido", () => {
    const indicadores = secao("geral", "Indicadores do período", {
      podeVerValores: true,
      campanhas: campanhasPeriodizadas({ lidoDesde: "2026-09-20" }),
    })?.linhas;
    expect(indicadores).toContainEqual(["Custo por lead", "Ainda não medido"]);
    expect(indicadores).toContainEqual(["Investimento lido a partir de", "20/09/2026"]);
  });

  it("sem fuso informado, o Atualizado em fica fora (nunca no fuso do servidor)", () => {
    const indicadores = secao("geral", "Indicadores do período", {
      podeVerValores: true,
      timezone: undefined,
    })?.linhas;
    expect(indicadores?.map((linha) => linha[0])).not.toContain("Investimento atualizado em");
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
