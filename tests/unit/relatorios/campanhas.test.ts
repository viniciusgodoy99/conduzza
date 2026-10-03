import { describe, expect, it } from "vitest";

import {
  CELULA_FORA_DA_META,
  CELULA_NAO_MEDIDO,
  CELULA_SEM_LEADS,
  NOTA_DOS_VALORES_DAS_CAMPANHAS,
  TEXTOS_DO_VAZIO_DAS_CAMPANHAS,
  campanhasComValores,
  estadoVazioDasCampanhas,
  montarCampanhas,
  montarDetalheDeOrigem,
  rodapesDasCampanhas,
} from "@/lib/domain/exportacao-de-resultados";
import type { FunilDoPeriodo } from "@/lib/queries/relatorios";

import { FUNIL, campanhasDoPeriodo } from "./dados-de-exemplo";

// Tabela Campanhas e detalhe por campanha (Fase 4): linhas de
// campanhas_do_periodo, colunas em reais so para a gestao, celulas de estado
// no lugar de um R$ 0,00 falso e as linhas de conferencia.

const sem = (texto: string) => texto.replace(/ /g, " ");

describe("montarCampanhas", () => {
  it("gestão com o período inteiro lido: investimento e custo por lead de cada campanha", () => {
    const linhas = montarCampanhas(campanhasDoPeriodo(), true);
    expect(linhas.map((linha) => linha.chave)).toEqual([
      "meta:120000000000000010",
      "meta:120000000000000020",
      "meta:120000000000000030",
      "texto:Check-up 2026",
    ]);
    const [implante, semNome, semLead, texto] = linhas;
    expect(implante).toMatchObject({ rotulo: "Implante Dentário", leads: 120, agendaram: 80 });
    expect(sem(implante!.investimento!.texto)).toBe("R$ 3.420,00");
    // 342.000 / 120 = 2.850 centavos
    expect(sem(implante!.custoPorLead!.texto)).toBe("R$ 28,50");
    expect(implante!.investimento!.estado).toBe(false);
    // Campanha sem nome na Meta: o id.
    expect(semNome!.rotulo).toBe("Campanha 120000000000000020");
    expect(semLead!.custoPorLead).toEqual({ texto: CELULA_SEM_LEADS, estado: true });
    expect(texto!.investimento).toEqual({ texto: CELULA_FORA_DA_META, estado: true });
    expect(texto!.custoPorLead).toEqual({ texto: CELULA_FORA_DA_META, estado: true });
    expect(implante!.conversao).toBe("66,7%");
  });

  it.each([
    ["sem leitura configurada", { configurada: false, lidoDesde: null }],
    ["antes da primeira leitura", { lidoDesde: null, lidoAte: null, sincronizadoEm: null }],
    ["período antes do primeiro dia lido", { lidoDesde: "2026-09-10" }],
    [
      "leitura parada antes do fim do período",
      { situacao: "com_problema" as const, problema: "token_invalido", lidoAte: "2026-09-13" },
    ],
    ["conta em outra moeda", { moeda: "USD", outraMoeda: true }],
  ])("%s: Não medido nas linhas da Meta, nunca R$ 0,00", (_caso, investimento) => {
    const linhas = montarCampanhas(campanhasDoPeriodo(investimento), true);
    const meta = linhas.filter((linha) => linha.chave.startsWith("meta:"));
    for (const linha of meta) {
      expect(linha.investimento).toEqual({ texto: CELULA_NAO_MEDIDO, estado: true });
    }
    expect(meta[0]!.custoPorLead).toEqual({ texto: CELULA_NAO_MEDIDO, estado: true });
    // Campanha de 0 lead continua "Sem leads" no custo.
    expect(meta[2]!.custoPorLead).toEqual({ texto: CELULA_SEM_LEADS, estado: true });
    expect(linhas.flatMap((linha) => [linha.investimento?.texto, linha.custoPorLead?.texto])
      .filter((texto) => texto?.includes("R$"))).toEqual([]);
  });

  it("recepção: sem colunas em reais e sem a campanha de 0 lead, mesmo com o dado chegando", () => {
    const linhas = montarCampanhas(campanhasDoPeriodo(), false);
    expect(linhas.map((linha) => linha.rotulo)).toEqual([
      "Implante Dentário",
      "Campanha 120000000000000020",
      "Check-up 2026",
    ]);
    for (const linha of linhas) {
      expect(linha.investimento).toBeNull();
      expect(linha.custoPorLead).toBeNull();
    }
  });

  it("gestão que o banco tratou como sem acesso (investimento null): sem colunas", () => {
    const campanhas = campanhasDoPeriodo(null);
    expect(campanhasComValores(campanhas, true)).toBe(false);
    expect(montarCampanhas(campanhas, true).every((linha) => linha.investimento === null)).toBe(true);
  });
});

describe("rodapesDasCampanhas", () => {
  it("gestão: investimento sem lead casado, leads sem campanha e de anúncio sem campanha", () => {
    expect(rodapesDasCampanhas(campanhasDoPeriodo(), true).map(sem)).toEqual([
      "Investimento sem lead casado: R$ 500,00 em 1 campanha",
      "Leads sem campanha: 150 de 486",
      "Leads de anúncio sem campanha reconhecida: 12",
    ]);
  });

  it("plural das campanhas sem lead", () => {
    const linhas = rodapesDasCampanhas(
      campanhasDoPeriodo({ campanhasSemLead: 2, investimentoSemLeadCents: 120_000 }),
      true,
    );
    expect(sem(linhas[0]!)).toBe("Investimento sem lead casado: R$ 1.200,00 em 2 campanhas");
  });

  it("recepção: só as contagens, nada em reais", () => {
    const linhas = rodapesDasCampanhas(campanhasDoPeriodo(), false);
    expect(linhas).toEqual([
      "Leads sem campanha: 150 de 486",
      "Leads de anúncio sem campanha reconhecida: 12",
    ]);
    expect(NOTA_DOS_VALORES_DAS_CAMPANHAS).toBe(
      "Investimento e custo por lead: só administrador e gestor.",
    );
  });

  it("sem medida completa, nenhuma conferência em reais", () => {
    const linhas = rodapesDasCampanhas(campanhasDoPeriodo({ lidoDesde: "2026-09-10" }), true);
    expect(linhas.some((linha) => linha.includes("R$"))).toBe(false);
    const parada = rodapesDasCampanhas(campanhasDoPeriodo({ lidoAte: "2026-09-13" }), true);
    expect(parada.some((linha) => linha.includes("R$"))).toBe(false);
  });

  it("nenhuma campanha sem lead, nenhum lead de anúncio solto e nenhum lead: nada", () => {
    expect(
      rodapesDasCampanhas(
        campanhasDoPeriodo(
          { campanhasSemLead: 0, investimentoSemLeadCents: 0 },
          { leads: 0, leadsSemCampanha: 0, leadsDeAnuncioSemCampanha: 0, linhas: [] },
        ),
        true,
      ),
    ).toEqual([]);
  });
});

describe("estadoVazioDasCampanhas", () => {
  it("sem lead no período: Nenhum lead no período", () => {
    expect(estadoVazioDasCampanhas({ leads: 0 })).toEqual({
      titulo: "Nenhum lead no período",
      descricao:
        "As campanhas aparecem quando os primeiros contatos chegarem no período escolhido.",
    });
  });

  it("com leads, mas nenhum com campanha: nunca diz que não houve lead", () => {
    const vazio = estadoVazioDasCampanhas({ leads: 246 });
    expect(vazio).toEqual({
      titulo: "Nenhum lead com campanha no período",
      descricao:
        "Os leads deste período chegaram sem campanha reconhecida. A contagem está logo abaixo.",
    });
    expect(vazio.titulo).not.toBe("Nenhum lead no período");
  });

  it("os textos do vazio não têm travessão nem meia-risca", () => {
    for (const vazio of Object.values(TEXTOS_DO_VAZIO_DAS_CAMPANHAS)) {
      expect(vazio.titulo).not.toMatch(/[—–]/);
      expect(vazio.descricao).not.toMatch(/[—–]/);
    }
  });
});

describe("montarDetalheDeOrigem por campanha", () => {
  it("as linhas da tabela com lead, mais Sem campanha que fecha a coorte", () => {
    const linhas = montarDetalheDeOrigem(FUNIL, "campanha", campanhasDoPeriodo());
    expect(linhas).toEqual([
      { rotulo: "Implante Dentário", leads: 120, agendaram: 80, compareceram: 60, comparecimento: "50,0%" },
      { rotulo: "Campanha 120000000000000020", leads: 30, agendaram: 20, compareceram: 10, comparecimento: "33,3%" },
      { rotulo: "Check-up 2026", leads: 186, agendaram: 112, compareceram: 90, comparecimento: "48,4%" },
      { rotulo: "Sem campanha", leads: 150, agendaram: 100, compareceram: 90, comparecimento: "60,0%" },
    ]);
    // Invariante: as linhas somam os leads do funil.
    expect(linhas!.reduce((soma, linha) => soma + linha.leads, 0)).toBe(FUNIL.leads);
  });

  it("retratos que não batem (um lead chegou entre as duas leituras): célula vazia, nunca número errado", () => {
    const funilDepois: FunilDoPeriodo = {
      ...FUNIL,
      leads: 487,
      coorte: { leads: 487, agendaram: 313, compareceram: 250 },
    };
    const semCampanha = montarDetalheDeOrigem(funilDepois, "campanha", campanhasDoPeriodo())!.at(-1);
    expect(semCampanha).toEqual({
      rotulo: "Sem campanha",
      leads: 150,
      agendaram: null,
      compareceram: null,
      comparecimento: "",
    });
  });

  it("sem as campanhas carregadas: null (carregando), nunca lista vazia", () => {
    expect(montarDetalheDeOrigem(FUNIL, "campanha", undefined)).toBeNull();
    // Por canal nao depende delas.
    expect(montarDetalheDeOrigem(FUNIL, "canal", undefined)?.length).toBe(2);
  });

  it("todos os leads em campanha: sem a linha Sem campanha", () => {
    const linhas = montarDetalheDeOrigem(
      FUNIL,
      "campanha",
      campanhasDoPeriodo({}, { leadsSemCampanha: 0 }),
    );
    expect(linhas?.map((linha) => linha.rotulo)).not.toContain("Sem campanha");
  });
});
