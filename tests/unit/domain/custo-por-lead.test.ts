import { describe, expect, it } from "vitest";

import {
  DIAS_DE_FOLGA_DA_LEITURA,
  DIVISORES_DO_CUSTO_POR_LEAD,
  DIVISOR_DO_CUSTO_POR_LEAD,
  TEXTOS_DO_CUSTO_POR_LEAD,
  TEXTOS_DO_DIVISOR,
  avisoDeFusoDaConta,
  coberturaDoInvestimento,
  custoPorLeadCents,
  dicaAntesDaLeitura,
  dicaDoCustoPorLead,
  dicaLeituraAtrasada,
  estadoDoCustoPorLead,
  formatarAtualizadoEm,
  leadsDoDivisor,
  rodapeDoCustoPorLead,
  textoAtualizadoEm,
  textoDoCustoPorLead,
  variacaoDoCustoPorLead,
  type DivisorDoCustoPorLead,
} from "@/lib/domain/custo-por-lead";

import {
  INVESTIMENTO,
  campanhasDoPeriodo,
  campanhasPeriodizadas,
} from "../relatorios/dados-de-exemplo";

// Custo por lead (Fase 4): o estado do cartao, o mesmo texto do CSV, o
// divisor da decisao D2 (as tres opcoes) e a cobertura do investimento. So
// contagens e valores agregados, nenhum dado de paciente.

/** Texto sem o NBSP do Intl, para comparar com o que a tela le. */
function semNbsp(texto: string | null): string | null {
  return texto === null ? null : texto.replace(/ /g, " ");
}

describe("divisor do custo por lead (decisão D2)", () => {
  it("a constante segue a recomendação: leads de anúncio", () => {
    expect(DIVISOR_DO_CUSTO_POR_LEAD).toBe("leads_de_anuncio");
    expect(DIVISORES_DO_CUSTO_POR_LEAD).toEqual([
      "leads_de_anuncio",
      "leads_casados",
      "leads",
    ]);
  });

  it("cada divisor lê a sua contagem do banco", () => {
    const bloco = { leads: 486, leadsDeAnuncio: 162, leadsCasados: 150 };
    expect(leadsDoDivisor(bloco)).toBe(162);
    expect(leadsDoDivisor(bloco, "leads_de_anuncio")).toBe(162);
    expect(leadsDoDivisor(bloco, "leads_casados")).toBe(150);
    expect(leadsDoDivisor(bloco, "leads")).toBe(486);
  });

  it.each<[DivisorDoCustoPorLead, number, string]>([
    // R$ 4.860,00 / 162 = R$ 30,00
    ["leads_de_anuncio", 3000, "R$ 4.860,00 em 162 leads de anúncio"],
    // R$ 4.860,00 / 150 = R$ 32,40
    ["leads_casados", 3240, "R$ 4.860,00 em 150 leads ligados a campanhas"],
    // R$ 4.860,00 / 486 = R$ 10,00
    ["leads", 1000, "R$ 4.860,00 em 486 leads"],
  ])("divisor %s: custo de %i centavos e o rodapé certo", (divisor, custo, rodape) => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo(), divisor);
    expect(estado).toMatchObject({ tipo: "valor", custoCents: custo, divisor });
    expect(semNbsp(rodapeDoCustoPorLead(estado))).toBe(rodape);
  });

  it.each<[DivisorDoCustoPorLead, Parameters<typeof campanhasDoPeriodo>[1], string]>([
    ["leads_de_anuncio", { leadsDeAnuncio: 0, leadsCasados: 0 }, "Nenhum lead de anúncio"],
    ["leads_casados", { leadsCasados: 0 }, "Nenhum lead ligado a campanha"],
    ["leads", { leads: 0 }, "Nenhum lead no período"],
  ])("divisor %s zerado: o estado escrito, nunca divisão por zero", (divisor, extra, texto) => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo({}, extra), divisor);
    expect(estado).toEqual({ tipo: "sem-lead", investimentoCents: 486_000, divisor });
    expect(textoDoCustoPorLead(estado)).toBe(texto);
    expect(semNbsp(rodapeDoCustoPorLead(estado))).toBe(
      "R$ 4.860,00 investidos no período",
    );
  });

  it("com divisor de leads casados, faltar lead casado não esconde os leads de anúncio", () => {
    // 12 leads de anuncio, nenhum casado: o padrao mede, o alternativo nao.
    const bloco = campanhasDoPeriodo({}, { leadsDeAnuncio: 12, leadsCasados: 0 });
    expect(estadoDoCustoPorLead(bloco).tipo).toBe("valor");
    expect(estadoDoCustoPorLead(bloco, "leads_casados").tipo).toBe("sem-lead");
  });
});

describe("custoPorLeadCents", () => {
  it("arredonda ao centavo, metade para cima", () => {
    // 342.000 / 186 = 1838,70...
    expect(custoPorLeadCents(342_000, 186)).toBe(1839);
    expect(custoPorLeadCents(5, 2)).toBe(3);
    expect(custoPorLeadCents(100, 3)).toBe(33);
  });

  it("sem lead não há custo (null, nunca 0 nem infinito)", () => {
    expect(custoPorLeadCents(342_000, 0)).toBeNull();
    expect(custoPorLeadCents(0, 0)).toBeNull();
    expect(custoPorLeadCents(Number.NaN, 3)).toBeNull();
  });

  it("investimento zero com lead é custo zero medido", () => {
    expect(custoPorLeadCents(0, 10)).toBe(0);
  });
});

describe("coberturaDoInvestimento", () => {
  it("cada situação da leitura", () => {
    expect(coberturaDoInvestimento(null)).toBe("sem-acesso");
    expect(coberturaDoInvestimento(undefined)).toBe("sem-acesso");
    expect(coberturaDoInvestimento({ ...INVESTIMENTO, configurada: false })).toBe(
      "nao-configurado",
    );
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, lidoDesde: null, lidoAte: null }),
    ).toBe("aguardando-primeira-leitura");
    expect(coberturaDoInvestimento({ ...INVESTIMENTO, outraMoeda: true })).toBe(
      "outra-moeda",
    );
    expect(coberturaDoInvestimento({ ...INVESTIMENTO, moeda: "USD" })).toBe(
      "outra-moeda",
    );
    expect(coberturaDoInvestimento(INVESTIMENTO)).toBe("completa");
  });

  it("período que começa antes do primeiro dia lido não é medido; no mesmo dia é", () => {
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, lidoDesde: "2026-09-04" }),
    ).toBe("antes-da-leitura");
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, lidoDesde: "2026-09-03" }),
    ).toBe("completa");
  });

  it("sem uma das pontas da leitura, ainda não foi lido por inteiro", () => {
    expect(coberturaDoInvestimento({ ...INVESTIMENTO, lidoAte: null })).toBe(
      "aguardando-primeira-leitura",
    );
  });

  it("outra moeda vence a espera da primeira leitura (nunca vai ser medido em real)", () => {
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, moeda: "USD", lidoDesde: null }),
    ).toBe("outra-moeda");
  });

  it("sem configuração vence tudo, mesmo com dado antigo", () => {
    expect(
      coberturaDoInvestimento({
        ...INVESTIMENTO,
        configurada: false,
        moeda: "USD",
      }),
    ).toBe("nao-configurado");
  });
});

describe("leitura parada: o fim do período conta, com folga", () => {
  it("a folga é de 2 dias", () => {
    expect(DIAS_DE_FOLGA_DA_LEITURA).toBe(2);
  });

  it("até 2 dias antes do fim continua medido (antes do diário das 06:00, um dia de falha)", () => {
    for (const lidoAte of ["2026-10-02", "2026-10-01", "2026-09-30"]) {
      expect(coberturaDoInvestimento({ ...INVESTIMENTO, lidoAte })).toBe("completa");
    }
  });

  it("3 dias ou mais antes do fim: leitura atrasada", () => {
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, lidoAte: "2026-09-29" }),
    ).toBe("leitura-atrasada");
    expect(
      coberturaDoInvestimento({ ...INVESTIMENTO, lidoAte: "2026-09-13" }),
    ).toBe("leitura-atrasada");
  });

  it("período que termina no futuro mede até hoje, não até o fim", () => {
    const futuro = { ...INVESTIMENTO, diaAte: "2026-10-31", hoje: "2026-10-02" };
    expect(coberturaDoInvestimento({ ...futuro, lidoAte: "2026-10-02" })).toBe("completa");
    expect(coberturaDoInvestimento({ ...futuro, lidoAte: "2026-09-30" })).toBe("completa");
    expect(coberturaDoInvestimento({ ...futuro, lidoAte: "2026-09-29" })).toBe(
      "leitura-atrasada",
    );
  });

  it("período inteiro antes da parada continua medido", () => {
    expect(
      coberturaDoInvestimento({
        ...INVESTIMENTO,
        diaDe: "2026-08-04",
        diaAte: "2026-09-02",
        lidoAte: "2026-09-13",
        hoje: "2026-10-03",
      }),
    ).toBe("completa");
  });

  it("período antes do primeiro dia lido vence a leitura atrasada", () => {
    expect(
      coberturaDoInvestimento({
        ...INVESTIMENTO,
        lidoDesde: "2026-09-10",
        lidoAte: "2026-09-13",
      }),
    ).toBe("antes-da-leitura");
  });

  it("token vencido em 13/09: Ainda não medido com a data, nunca custo baixo demais", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({
        situacao: "com_problema",
        problema: "token_invalido",
        lidoAte: "2026-09-13",
        // So os dias lidos: R$ 1.000,00 em vez dos R$ 4.860,00 do periodo.
        investimentoCents: 100_000,
      }),
    );
    expect(estado).toEqual({
      tipo: "leitura-atrasada",
      lidoAte: "2026-09-13",
      comProblema: true,
    });
    expect(textoDoCustoPorLead(estado)).toBe("Ainda não medido");
    expect(dicaDoCustoPorLead(estado)).toBe(
      "O investimento foi lido até 13/09/2026. A leitura do investimento está com problema. Veja o motivo em Configurações, aba Anúncios da Meta.",
    );
    expect(rodapeDoCustoPorLead(estado)).toBeNull();
  });

  it("leitura parada sem problema registrado: só a data na dica", () => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo({ lidoAte: "2026-09-13" }));
    expect(estado).toMatchObject({ tipo: "leitura-atrasada", comProblema: false });
    expect(dicaDoCustoPorLead(estado)).toBe("O investimento foi lido até 13/09/2026.");
    expect(dicaLeituraAtrasada("2026-12-31")).toBe("O investimento foi lido até 31/12/2026.");
  });

  it("parada há semanas, sem gasto gravado no período: nunca Sem investimento no período", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({
        situacao: "com_problema",
        problema: "token_invalido",
        lidoAte: "2026-09-13",
        diaDe: "2026-09-21",
        diaAte: "2026-10-20",
        hoje: "2026-10-20",
        investimentoCents: 0,
      }),
    );
    expect(estado.tipo).toBe("leitura-atrasada");
    expect(textoDoCustoPorLead(estado)).not.toBe("Sem investimento no período");
  });

  it("sem variação: o anterior lido inteiro contra o atual pela metade não vira queda verde", () => {
    const campanhas = campanhasPeriodizadas({ lidoAte: "2026-09-13" });
    // O anterior (04/08 a 02/09) esta coberto; o atual nao.
    expect(estadoDoCustoPorLead(campanhas.anterior!).tipo).toBe("valor");
    expect(estadoDoCustoPorLead(campanhas.atual).tipo).toBe("leitura-atrasada");
    expect(variacaoDoCustoPorLead(campanhas)).toBeNull();
  });
});

describe("aviso de fuso da conta (clínica em America/Fortaleza)", () => {
  const TZ = "America/Fortaleza";
  const TEXTO =
    "Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.";

  it("o texto fixo", () => {
    expect(TEXTOS_DO_CUSTO_POR_LEAD.outroFuso).toBe(TEXTO);
  });

  it("São Paulo tem o mesmo deslocamento de Fortaleza: sem aviso", () => {
    expect(avisoDeFusoDaConta(INVESTIMENTO, TZ)).toBeNull();
    expect(
      avisoDeFusoDaConta({ ...INVESTIMENTO, fusoDaConta: TZ }, TZ),
    ).toBeNull();
    expect(
      avisoDeFusoDaConta(
        { ...INVESTIMENTO, fusoDaConta: "America/Fortaleza" },
        "America/Sao_Paulo",
      ),
    ).toBeNull();
  });

  it("conta de agência em Nova York ou Lisboa: avisa", () => {
    expect(
      avisoDeFusoDaConta({ ...INVESTIMENTO, fusoDaConta: "America/New_York" }, TZ),
    ).toBe(TEXTO);
    expect(
      avisoDeFusoDaConta({ ...INVESTIMENTO, fusoDaConta: "Europe/Lisbon" }, TZ),
    ).toBe(TEXTO);
  });

  it("horário de verão no meio do período: confere as duas pontas", () => {
    // Miquelon: UTC-2 ate 01/11/2026, UTC-3 depois (o mesmo de Fortaleza).
    expect(
      avisoDeFusoDaConta(
        {
          ...INVESTIMENTO,
          fusoDaConta: "America/Miquelon",
          diaDe: "2026-10-20",
          diaAte: "2026-11-10",
          lidoDesde: "2026-10-01",
          lidoAte: "2026-11-10",
          hoje: "2026-11-10",
        },
        TZ,
      ),
    ).toBe(TEXTO);
  });

  it("sem fuso gravado, fuso inválido ou fora da gestão: sem aviso", () => {
    expect(avisoDeFusoDaConta({ ...INVESTIMENTO, fusoDaConta: null }, TZ)).toBeNull();
    expect(avisoDeFusoDaConta({ ...INVESTIMENTO, fusoDaConta: "xx/yy" }, TZ)).toBeNull();
    expect(avisoDeFusoDaConta(null, TZ)).toBeNull();
    expect(avisoDeFusoDaConta(undefined, TZ)).toBeNull();
  });

  it("sem o período medido não há número para o fuso distorcer: sem aviso", () => {
    const novaYork = { ...INVESTIMENTO, fusoDaConta: "America/New_York" };
    expect(avisoDeFusoDaConta({ ...novaYork, lidoDesde: "2026-09-10" }, TZ)).toBeNull();
    expect(avisoDeFusoDaConta({ ...novaYork, lidoAte: "2026-09-13" }, TZ)).toBeNull();
    expect(avisoDeFusoDaConta({ ...novaYork, moeda: "USD" }, TZ)).toBeNull();
    expect(avisoDeFusoDaConta({ ...novaYork, configurada: false }, TZ)).toBeNull();
  });
});

describe("estadoDoCustoPorLead e os textos do contrato", () => {
  it("sem acesso: o bloco do investimento veio null do banco", () => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo(null));
    expect(estado).toEqual({ tipo: "sem-acesso" });
    expect(textoDoCustoPorLead(estado)).toBe("Sem acesso");
  });

  it("sem leitura configurada: Ainda não medido, com a dica de onde ligar", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({ configurada: false, situacao: null, lidoDesde: null }),
    );
    expect(estado.tipo).toBe("nao-configurado");
    expect(textoDoCustoPorLead(estado)).toBe("Ainda não medido");
    expect(dicaDoCustoPorLead(estado)).toBe(
      "Ligue a leitura do investimento em Configurações, aba Anúncios da Meta.",
    );
  });

  it("antes da primeira leitura: Ainda não medido, a leitura ainda não terminou", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({
        situacao: "nao_testada",
        lidoDesde: null,
        lidoAte: null,
        sincronizadoEm: null,
        investimentoCents: 0,
      }),
    );
    expect(estado).toEqual({ tipo: "aguardando-primeira-leitura", comProblema: false });
    expect(textoDoCustoPorLead(estado)).toBe("Ainda não medido");
    expect(dicaDoCustoPorLead(estado)).toBe(
      "A primeira leitura do investimento ainda não terminou.",
    );
  });

  it("primeira leitura com problema: a dica manda ver o motivo", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({
        situacao: "com_problema",
        problema: "token_invalido",
        lidoDesde: null,
      }),
    );
    expect(estado).toEqual({ tipo: "aguardando-primeira-leitura", comProblema: true });
    expect(dicaDoCustoPorLead(estado)).toBe(
      "A leitura do investimento está com problema. Veja o motivo em Configurações, aba Anúncios da Meta.",
    );
  });

  it("período antes da leitura: Ainda não medido, com o dia a partir do qual é lido", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({ lidoDesde: "2026-09-04" }),
    );
    expect(estado).toEqual({ tipo: "antes-da-leitura", lidoDesde: "2026-09-04" });
    expect(textoDoCustoPorLead(estado)).toBe("Ainda não medido");
    expect(dicaDoCustoPorLead(estado)).toBe(
      "O investimento é lido a partir de 04/09/2026.",
    );
    expect(dicaAntesDaLeitura("2026-12-31")).toBe(
      "O investimento é lido a partir de 31/12/2026.",
    );
  });

  it("outra moeda: Conta em outra moeda, sem número", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({ moeda: "USD", outraMoeda: true, investimentoCents: 0 }),
    );
    expect(estado).toEqual({ tipo: "outra-moeda" });
    expect(textoDoCustoPorLead(estado)).toBe("Conta em outra moeda");
    expect(rodapeDoCustoPorLead(estado)).toBe(
      "A conta de anúncios não usa real, e o valor não é convertido.",
    );
  });

  it("gasto em outra moeda no período, mesmo com a conta em real hoje, não soma", () => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo({ outraMoeda: true }));
    expect(estado.tipo).toBe("outra-moeda");
  });

  it("sem gasto: Sem investimento no período", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({ investimentoCents: 0, investimentoCasadoCents: 0 }),
    );
    expect(estado).toEqual({ tipo: "sem-investimento" });
    expect(textoDoCustoPorLead(estado)).toBe("Sem investimento no período");
    expect(rodapeDoCustoPorLead(estado)).toBeNull();
  });

  it("com valor: o número cheio e o rodapé com o investimento e os leads", () => {
    const estado = estadoDoCustoPorLead(campanhasDoPeriodo());
    expect(estado).toEqual({
      tipo: "valor",
      custoCents: 3000,
      investimentoCents: 486_000,
      leads: 162,
      divisor: "leads_de_anuncio",
    });
    expect(semNbsp(textoDoCustoPorLead(estado))).toBe("R$ 30,00");
    expect(semNbsp(rodapeDoCustoPorLead(estado))).toBe(
      "R$ 4.860,00 em 162 leads de anúncio",
    );
    expect(dicaDoCustoPorLead(estado)).toBeNull();
  });

  it("um lead de anúncio fica no singular", () => {
    const estado = estadoDoCustoPorLead(
      campanhasDoPeriodo({ investimentoCents: 342_000 }, { leadsDeAnuncio: 1 }),
    );
    expect(semNbsp(rodapeDoCustoPorLead(estado))).toBe(
      "R$ 3.420,00 em 1 lead de anúncio",
    );
  });

  it("nenhum texto fixo tem travessão nem meia-risca", () => {
    const textos = [
      ...Object.values(TEXTOS_DO_CUSTO_POR_LEAD),
      ...Object.values(TEXTOS_DO_DIVISOR).flatMap((t) => Object.values(t)),
      dicaAntesDaLeitura("2026-09-04"),
      dicaLeituraAtrasada("2026-09-13"),
      dicaDoCustoPorLead({
        tipo: "leitura-atrasada",
        lidoAte: "2026-09-13",
        comProblema: true,
      }) ?? "",
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});

describe("variacaoDoCustoPorLead", () => {
  it("compara os dois períodos medidos por inteiro, cair é bom", () => {
    const variacao = variacaoDoCustoPorLead(campanhasPeriodizadas());
    // Atual R$ 30,00 contra R$ 25,00 (R$ 4.000 / 160).
    expect(variacao).toEqual({
      atual: 3000,
      anterior: 2500,
      polaridade: "menor-melhor",
      comparadoCom: "período anterior",
    });
  });

  it("sem variação quando o anterior começa antes da leitura", () => {
    const campanhas = campanhasPeriodizadas();
    const comAnteriorParcial = {
      ...campanhas,
      anterior: campanhasDoPeriodo(
        { diaDe: "2026-08-04", lidoDesde: "2026-08-10" },
        { leadsDeAnuncio: 160 },
      ),
    };
    expect(variacaoDoCustoPorLead(comAnteriorParcial)).toBeNull();
  });

  it("sem variação sem período anterior, sem acesso ou com o atual sem lead", () => {
    expect(
      variacaoDoCustoPorLead({ atual: campanhasDoPeriodo(), anterior: null }),
    ).toBeNull();
    expect(variacaoDoCustoPorLead(campanhasPeriodizadas(null))).toBeNull();
    expect(
      variacaoDoCustoPorLead(
        campanhasPeriodizadas({}, { leadsDeAnuncio: 0 }),
      ),
    ).toBeNull();
  });

  it("a variação segue o divisor escolhido", () => {
    // leads: 4.860 / 486 = 10,00 contra 4.000 / 486 = 8,23
    const variacao = variacaoDoCustoPorLead(campanhasPeriodizadas(), "leads");
    expect(variacao).toMatchObject({ atual: 1000, anterior: 823 });
  });
});

describe("Atualizado em", () => {
  it("no fuso da clínica, nunca no do servidor", () => {
    expect(textoAtualizadoEm("2026-10-02T09:00:00.000Z", "America/Fortaleza")).toBe(
      "Atualizado em 02/10 às 06:00",
    );
    expect(textoAtualizadoEm("2026-10-02T09:00:00.000Z", "America/Manaus")).toBe(
      "Atualizado em 02/10 às 05:00",
    );
    // Formato do PostgREST (microssegundos e +00:00).
    expect(
      formatarAtualizadoEm("2026-10-03T02:30:00.123456+00:00", "America/Fortaleza"),
    ).toBe("02/10 às 23:30");
  });

  it("antes da primeira leitura (ou instante inválido), nada", () => {
    expect(textoAtualizadoEm(null, "America/Fortaleza")).toBeNull();
    expect(textoAtualizadoEm("ontem", "America/Fortaleza")).toBeNull();
  });
});
