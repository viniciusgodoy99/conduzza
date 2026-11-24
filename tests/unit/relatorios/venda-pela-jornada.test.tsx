import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  COMO_MARCAR_ETAPA_DE_VENDA,
  NOTA_DAS_VENDAS_DAS_CAMPANHAS,
  NOTA_SEM_ETAPA_DE_VENDA_NAS_CAMPANHAS,
  TEXTO_SEM_ETAPA_DE_VENDA,
  TEXTO_SEM_VALOR_PARA_SOMAR,
  TEXTO_SEM_VENDA,
  estadoDasVendas,
  linhasDoCsv,
  montarCampanhas,
  montarExportavelDaAba,
  rodapesDasCampanhas,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";
import {
  fetchCampanhasDoPeriodo,
  fetchVendasDoPeriodo,
  type VendasDoPeriodo,
} from "@/lib/queries/relatorios";

import { FUNIL, agenda, campanhasDoPeriodo } from "./dados-de-exemplo";

// Venda pela Jornada (decisao do dono de 23/11/2026): os cartoes Vendas e
// Valor das vendas (aba Comercial), as colunas da tabela Campanhas e a
// exportacao. O SQL (o gatilho, a RLS e as RPCs) e provado pelos testes de
// banco (tests/integration/venda-pela-jornada e tests/rls/venda-pela-jornada),
// que so rodam com a migration 20261123110000 aplicada.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { CartoesDeVendas, DICA_SEM_ACESSO_AS_VENDAS } =
  await import("@/components/relatorios/cartoes-de-valor");

/** Texto sem tags, com espacos (inclusive o NBSP do Intl) normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const vendas = (extra: Partial<VendasDoPeriodo> = {}): VendasDoPeriodo => ({
  temEtapaDeVenda: true,
  vendas: 5,
  valorCents: 125_000,
  semValor: 0,
  ...extra,
});

function cartoes(
  dado: VendasDoPeriodo | null | undefined,
  extra: { podeVerValores?: boolean; erro?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <CartoesDeVendas
      podeVerValores={extra.podeVerValores ?? true}
      vendas={dado}
      erro={extra.erro}
      tentarDeNovo={<button type="button">Tentar de novo</button>}
    />,
  );
}

describe("cartões Vendas e Valor das vendas", () => {
  it("com valor: a contagem e a soma, separadas do faturamento", () => {
    const lido = texto(cartoes(vendas()));
    expect(lido).toContain("Vendas 5 entradas numa etapa de venda da Jornada");
    expect(lido).toContain("Valor das vendas R$ 1.250,00 De 5 vendas");
    expect(lido).not.toContain("Faturamento");
  });

  it("parte sem valor: Fora da soma, N vendas sem valor", () => {
    const lido = texto(cartoes(vendas({ semValor: 2, valorCents: 75_000 })));
    expect(lido).toContain("R$ 750,00");
    expect(lido).toContain("Fora da soma: 2 vendas sem valor");
  });

  it("só vendas sem valor: Sem valor para somar, nunca R$ 0,00", () => {
    const html = cartoes(vendas({ vendas: 1, semValor: 1, valorCents: 0 }));
    expect(html).not.toContain("R$");
    expect(texto(html)).toContain(
      `${TEXTO_SEM_VALOR_PARA_SOMAR} 1 venda sem valor`,
    );
  });

  it("sem venda no período: Vendas 0 e Valor Nenhuma venda no período", () => {
    const lido = texto(cartoes(vendas({ vendas: 0, valorCents: 0 })));
    expect(lido).toContain("Vendas 0");
    expect(lido).toContain(TEXTO_SEM_VENDA);
  });

  it("nenhuma etapa marcada: explica como marcar e leva à Jornada", () => {
    const html = cartoes(
      vendas({ temEtapaDeVenda: false, vendas: 0, valorCents: 0 }),
    );
    const lido = texto(html);
    expect(lido.match(new RegExp(TEXTO_SEM_ETAPA_DE_VENDA, "g"))?.length).toBe(
      2,
    );
    expect(lido).toContain(COMO_MARCAR_ETAPA_DE_VENDA);
    expect(html).toContain('href="/configuracoes?aba=jornada"');
    expect(lido).toContain("Abrir a Jornada");
    // O atalho tem 40px de altura (h-10).
    expect(html).toMatch(
      /<a[^>]*class="[^"]*h-10[^"]*"[^>]*href="\/configuracoes\?aba=jornada"|<a[^>]*href="\/configuracoes\?aba=jornada"[^>]*class="[^"]*h-10/,
    );
  });

  it("etapa desmarcada depois das vendas: os números de antes continuam", () => {
    const lido = texto(cartoes(vendas({ temEtapaDeVenda: false })));
    expect(lido).toContain("Vendas 5");
    expect(lido).not.toContain(TEXTO_SEM_ETAPA_DE_VENDA);
  });

  it("carregando, erro (um Tentar de novo só) e sem acesso", () => {
    expect(cartoes(undefined).match(/data-estado="carregando"/g)?.length).toBe(
      2,
    );

    const erro = cartoes(undefined, { erro: true });
    expect(erro.match(/data-estado="erro"/g)?.length).toBe(2);
    expect(erro.match(/Tentar de novo/g)?.length).toBe(1);

    for (const html of [
      cartoes(vendas(), { podeVerValores: false }),
      cartoes(null),
    ]) {
      expect(html).not.toContain("R$");
      expect(html.match(/Sem acesso/g)?.length).toBe(2);
      expect(html).toContain(`data-dica="${DICA_SEM_ACESSO_AS_VENDAS}"`);
      expect(texto(html)).not.toContain("5");
    }
  });

  it("estadoDasVendas: o mesmo estado no cartão e no CSV", () => {
    expect(estadoDasVendas(vendas())).toBe("com-valor");
    expect(estadoDasVendas(vendas({ vendas: 0 }))).toBe("sem-venda");
    expect(estadoDasVendas(vendas({ vendas: 0, temEtapaDeVenda: false }))).toBe(
      "sem-etapa",
    );
    expect(estadoDasVendas(vendas({ vendas: 2, semValor: 2 }))).toBe(
      "sem-valor",
    );
  });

  it("nenhum travessão nos textos novos", () => {
    for (const frase of [
      TEXTO_SEM_ETAPA_DE_VENDA,
      COMO_MARCAR_ETAPA_DE_VENDA,
      TEXTO_SEM_VENDA,
      TEXTO_SEM_VALOR_PARA_SOMAR,
      NOTA_DAS_VENDAS_DAS_CAMPANHAS,
      NOTA_SEM_ETAPA_DE_VENDA_NAS_CAMPANHAS,
      DICA_SEM_ACESSO_AS_VENDAS,
      texto(cartoes(vendas({ temEtapaDeVenda: false, vendas: 0 }))),
    ]) {
      expect(frase).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("tabela Campanhas: Vendas e Valor das vendas", () => {
  it("gestão: a contagem, a soma com a nota das sem valor e Nenhuma venda", () => {
    const linhas = montarCampanhas(campanhasDoPeriodo(), true);
    const porRotulo = Object.fromEntries(
      linhas.map((linha) => [linha.rotulo, linha]),
    );
    expect(porRotulo["Implante Dentário"]?.vendas).toEqual({
      texto: "4",
      estado: false,
    });
    expect(
      porRotulo["Implante Dentário"]?.valorDasVendas?.texto.replace(/\s/g, " "),
    ).toBe("R$ 10.000,00");
    expect(porRotulo["Check-up 2026"]?.valorDasVendas?.nota).toBe(
      "1 venda sem valor",
    );
    expect(porRotulo["Remarketing Botox"]?.valorDasVendas).toEqual({
      texto: "Nenhuma venda",
      estado: true,
    });
  });

  it("todas sem valor: Sem valor para somar; banco sem o campo: Não medido", () => {
    const campanhas = campanhasDoPeriodo();
    campanhas.linhas[0] = {
      ...campanhas.linhas[0]!,
      vendas: 2,
      valorDasVendasCents: 0,
      vendasSemValor: 2,
    };
    campanhas.linhas[1] = {
      ...campanhas.linhas[1]!,
      vendas: null,
      valorDasVendasCents: null,
      vendasSemValor: null,
    };
    const [todasSem, antigo] = montarCampanhas(campanhas, true);
    expect(todasSem?.valorDasVendas).toEqual({
      texto: TEXTO_SEM_VALOR_PARA_SOMAR,
      estado: true,
      nota: "2 vendas sem valor",
    });
    expect(antigo?.vendas?.texto).toBe("Não medido");
    expect(antigo?.valorDasVendas?.texto).toBe("Não medido");
  });

  it("recepção: as colunas nem existem", () => {
    for (const linha of montarCampanhas(campanhasDoPeriodo(), false)) {
      expect(linha.vendas).toBeNull();
      expect(linha.valorDasVendas).toBeNull();
    }
  });

  it("uma campanha só com venda no período (0 lead) entra para a gestão", () => {
    const campanhas = campanhasDoPeriodo();
    campanhas.linhas.push({
      chave: "meta:999",
      tipo: "meta",
      metaCampaignId: "999",
      rotulo: "Campanha antiga",
      leads: 0,
      agendaram: 0,
      compareceram: 0,
      investimentoCents: 0,
      faturamentoCents: 0,
      comparecimentos: 0,
      comparecimentosSemPreco: 0,
      vendas: 1,
      valorDasVendasCents: 30_000,
      vendasSemValor: 0,
    });
    const linha = montarCampanhas(campanhas, true).find(
      (l) => l.rotulo === "Campanha antiga",
    );
    expect(linha?.vendas?.texto).toBe("1");
    expect(linha?.custoPorLead?.texto).toBe("Sem leads");
  });

  it("rodapé: o que as colunas contam, ou que nenhuma etapa está marcada", () => {
    expect(rodapesDasCampanhas(campanhasDoPeriodo(), true)).toContain(
      NOTA_DAS_VENDAS_DAS_CAMPANHAS,
    );
    const semEtapa = rodapesDasCampanhas(
      campanhasDoPeriodo({}, { temEtapaDeVenda: false }),
      true,
    );
    expect(semEtapa).toContain(NOTA_SEM_ETAPA_DE_VENDA_NAS_CAMPANHAS);
    expect(semEtapa).not.toContain(NOTA_DAS_VENDAS_DAS_CAMPANHAS);
    expect(
      rodapesDasCampanhas(campanhasDoPeriodo(), false).some((linha) =>
        linha.startsWith("Vendas"),
      ),
    ).toBe(false);
  });
});

describe("exportação da aba Comercial", () => {
  function entrada(extra: Partial<EntradaDaExportacao>): EntradaDaExportacao {
    return {
      aba: "comercial",
      podeVerValores: true,
      canalOficial: false,
      funil: { atual: FUNIL, anterior: null },
      agenda: { atual: agenda(15_000), anterior: null },
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
      ...extra,
    };
  }
  const secao = (extra: Partial<EntradaDaExportacao>) =>
    montarExportavelDaAba(entrada(extra)).secoes.find(
      (s) => s.titulo === "Vendas da Jornada",
    );
  const sem = (linhas: string[][] | undefined) =>
    linhas?.map((linha) => linha.map((celula) => celula.replace(/\s/g, " ")));

  it("os mesmos números dos cartões, no CSV e na impressão", () => {
    expect(sem(secao({ vendas: vendas({ semValor: 1 }) })?.linhas)).toEqual([
      ["Indicador", "Valor"],
      ["Vendas", "5"],
      ["Valor das vendas", "R$ 1.250,00"],
      ["Vendas sem valor", "1"],
    ]);
    const csv = linhasDoCsv(
      montarExportavelDaAba(entrada({ vendas: vendas() })),
    ).flat();
    expect(csv).toContain("Vendas da Jornada");
  });

  it("estados escritos: sem etapa, sem venda e só sem valor", () => {
    expect(
      secao({ vendas: vendas({ temEtapaDeVenda: false, vendas: 0 }) })?.linhas,
    ).toEqual([
      ["Indicador", "Valor"],
      ["Vendas", TEXTO_SEM_ETAPA_DE_VENDA],
    ]);
    expect(
      secao({ vendas: vendas({ vendas: 0, valorCents: 0 }) })?.linhas,
    ).toContainEqual(["Valor das vendas", TEXTO_SEM_VENDA]);
    expect(
      secao({ vendas: vendas({ vendas: 2, semValor: 2, valorCents: 0 }) })
        ?.linhas,
    ).toContainEqual(["Valor das vendas", TEXTO_SEM_VALOR_PARA_SOMAR]);
  });

  it("recepção, sem acesso no banco ou ainda carregando: a seção não sai", () => {
    expect(secao({ podeVerValores: false, vendas: vendas() })).toBeUndefined();
    expect(secao({ vendas: null })).toBeUndefined();
    expect(secao({ vendas: undefined })).toBeUndefined();
  });

  it("com origem escolhida, o arquivo diz que Vendas e Valor das vendas acompanham", () => {
    const exportavel = montarExportavelDaAba(
      entrada({ vendas: vendas(), grupo: "meta" }),
    );
    expect(exportavel.filtro?.texto).toContain(
      "Acompanham a origem: Vendas, Valor das vendas e Funil comercial.",
    );
  });
});

describe("leitura das RPCs", () => {
  const cliente = (data: unknown, error: { message: string } | null = null) => {
    const rpc = vi.fn(async () => ({ data, error }));
    return { rpc, supabase: { rpc } as unknown as SupabaseClient };
  };

  it("vendas_do_periodo: o corpo, o grupo só quando há, null é sem acesso, erro lança", async () => {
    const { rpc, supabase } = cliente({
      tem_etapa_de_venda: true,
      vendas: 3,
      valor_cents: 90_000,
      sem_valor: 1,
    });
    await expect(
      fetchVendasDoPeriodo(
        supabase,
        "c",
        "America/Fortaleza",
        "2026-11-01",
        "2026-11-30",
        { grupo: "meta" },
      ),
    ).resolves.toEqual({
      temEtapaDeVenda: true,
      vendas: 3,
      valorCents: 90_000,
      semValor: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "vendas_do_periodo",
      expect.objectContaining({ p_clinic_id: "c", p_grupo: "meta" }),
    );

    const todas = cliente({
      tem_etapa_de_venda: false,
      vendas: 0,
      valor_cents: 0,
      sem_valor: 0,
    });
    await fetchVendasDoPeriodo(
      todas.supabase,
      "c",
      "America/Fortaleza",
      "2026-11-01",
      "2026-11-30",
    );
    expect(todas.rpc.mock.calls[0]?.at(1)).not.toHaveProperty("p_grupo");

    await expect(
      fetchVendasDoPeriodo(
        cliente(null).supabase,
        "c",
        "America/Fortaleza",
        "2026-11-01",
        "2026-11-30",
      ),
    ).resolves.toBeNull();
    await expect(
      fetchVendasDoPeriodo(
        cliente(null, { message: "falhou" }).supabase,
        "c",
        "America/Fortaleza",
        "2026-11-01",
        "2026-11-30",
      ),
    ).rejects.toThrow("falhou");
  });

  it("campanhas_do_periodo: os campos de venda; sem eles, null (nunca zero)", async () => {
    const linha = {
      chave: "meta:1",
      tipo: "meta",
      meta_campaign_id: "1",
      rotulo: "A",
      leads: 0,
      agendaram: 0,
      compareceram: 0,
      investimento_cents: 0,
    };
    const corpo = (
      extraLinha: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => ({
      atual: {
        leads: 0,
        leads_de_anuncio: 0,
        leads_casados: 0,
        leads_de_anuncio_sem_campanha: 0,
        leads_sem_campanha: 0,
        linhas: [{ ...linha, ...extraLinha }],
        investimento: null,
        ...extra,
      },
    });
    const novo = await fetchCampanhasDoPeriodo(
      cliente(
        corpo(
          { vendas: 2, valor_das_vendas_cents: 5_000, vendas_sem_valor: 1 },
          { tem_etapa_de_venda: true },
        ),
      ).supabase,
      "c",
      "America/Fortaleza",
      "2026-11-01",
      "2026-11-30",
    );
    expect(novo.atual.linhas[0]).toMatchObject({
      vendas: 2,
      valorDasVendasCents: 5_000,
      vendasSemValor: 1,
    });
    expect(novo.atual.temEtapaDeVenda).toBe(true);
    const antigo = await fetchCampanhasDoPeriodo(
      cliente(corpo({})).supabase,
      "c",
      "America/Fortaleza",
      "2026-11-01",
      "2026-11-30",
    );
    expect(antigo.atual.linhas[0]).toMatchObject({
      vendas: null,
      valorDasVendasCents: null,
      vendasSemValor: null,
    });
    expect(antigo.atual.temEtapaDeVenda).toBeNull();
  });
});

describe("Jornada", () => {
  it("o aviso diz que a venda conta em Resultados; a marca sem efeito saiu da tela", () => {
    const fonte = readFileSync(
      "components/configuracoes/jornada-tab.tsx",
      "utf-8",
    ).replace(/\s+/g, " ");
    expect(fonte).toContain(
      "A marca de venda conta em Resultados (Vendas e Valor das vendas, na aba Comercial) a partir de quando a etapa está marcada",
    );
    // 24/11/2026: "É o primeiro contato" nao mudava numero nenhum e saiu.
    expect(fonte).not.toContain("É o primeiro contato");
    // A venda nao depende mais de escolher o evento da Meta.
    expect(COMO_MARCAR_ETAPA_DE_VENDA).not.toContain("evento");
  });
});
