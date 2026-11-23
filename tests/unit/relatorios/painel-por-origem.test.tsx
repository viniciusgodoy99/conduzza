import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  linhasDoCsv,
  montarExportavelDaAba,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";
import {
  GRUPOS_DE_ORIGEM,
  ROTULO_DO_GRUPO_DE_ORIGEM,
  ROTULO_TODAS_AS_ORIGENS,
  avisoDoFiltroDeOrigem,
  lerGrupoDeOrigem,
  lerLeadsPorGrupo,
  textoDeLeads,
} from "@/lib/domain/grupos-de-origem";
import {
  ABAS_DE_RESULTADOS,
  fetchFunilDoPeriodo,
  fetchSerieDiariaDoPeriodo,
  relatoriosKeys,
  type AbaDeResultados,
  type PontoDaSerie,
} from "@/lib/queries/relatorios";

import {
  ATENDIMENTO,
  CONVERSOES,
  FUNIL,
  agenda,
  anunciosDoPeriodo,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// Painel por origem em Resultados (decisao do dono de 17/11/2026): os quatro
// grupos como filtro (?origem=) e como grafico por dia. Sem banco: a leitura
// do endereco e de por_grupo, o que vai na chamada, as chaves de cache, o que
// o bloco "Origem dos leads por dia" desenha, o aviso de cada aba e a
// exportacao com e sem filtro.

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

const { AbaMarketing } = await import("@/components/relatorios/aba-marketing");
const { OrigemDosLeadsPorDia } =
  await import("@/components/relatorios/origem-dos-leads-por-dia");

const TZ = "America/Fortaleza";
const PERIODO = { diaDe: "2026-10-01", diaAte: "2026-10-20" };
const nada = () => undefined;

/** Texto sem tags, com espacos (inclusive o NBSP do Intl) normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contar(markup: string, trecho: string): number {
  return markup.split(trecho).length - 1;
}

// 3 dias: Meta 4 + 0 + 2 = 6, Google 1 + 0 + 0 = 1, Outras 0, Nao rastreada
// 0 + 3 + 0 = 3. leads e agendadas sao os do filtro; por_grupo, nao.
const SERIE: PontoDaSerie[] = [
  {
    dia: "2026-10-01",
    leads: 5,
    agendadas: 2,
    porGrupo: { meta: 4, google: 1, outras: 0, nao_rastreada: 0 },
  },
  {
    dia: "2026-10-02",
    leads: 3,
    agendadas: 0,
    porGrupo: { meta: 0, google: 0, outras: 0, nao_rastreada: 3 },
  },
  {
    dia: "2026-10-03",
    leads: 2,
    agendadas: 1,
    porGrupo: { meta: 2, google: 0, outras: 0, nao_rastreada: 0 },
  },
];

const SERIE_SEM_GRUPO: PontoDaSerie[] = SERIE.map((ponto) => ({
  ...ponto,
  porGrupo: null,
}));

describe("os quatro grupos", () => {
  it("são estes, nesta ordem, com estes nomes", () => {
    expect(GRUPOS_DE_ORIGEM).toEqual([
      "meta",
      "google",
      "outras",
      "nao_rastreada",
    ]);
    expect(GRUPOS_DE_ORIGEM.map((g) => ROTULO_DO_GRUPO_DE_ORIGEM[g])).toEqual([
      "Meta Ads",
      "Google Ads",
      "Outras origens",
      "Não rastreada",
    ]);
    expect(ROTULO_TODAS_AS_ORIGENS).toBe("Todas as origens");
  });
});

describe("lerGrupoDeOrigem (o ?origem= do endereço)", () => {
  it("aceita as quatro chaves como vieram", () => {
    for (const grupo of GRUPOS_DE_ORIGEM) {
      expect(lerGrupoDeOrigem(grupo)).toBe(grupo);
    }
  });

  it("qualquer coisa fora da lista vira null (todas as origens)", () => {
    for (const valor of [
      undefined,
      null,
      "",
      "todas",
      "META",
      " meta",
      "meta,google",
      "trafego_pago",
      // Chaves herdadas de objeto nao podem passar.
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      // ?origem=meta&origem=google chega como lista.
      ["meta"],
      ["meta", "google"],
      0,
      {},
    ]) {
      expect(lerGrupoDeOrigem(valor)).toBeNull();
    }
  });
});

describe("lerLeadsPorGrupo (por_grupo do banco)", () => {
  it("com o campo: as quatro chaves", () => {
    expect(
      lerLeadsPorGrupo({ meta: 5, google: 2, outras: 1, nao_rastreada: 7 }),
    ).toEqual({ meta: 5, google: 2, outras: 1, nao_rastreada: 7 });
  });

  it("com chave faltando: o grupo sem lead é zero de verdade", () => {
    expect(lerLeadsPorGrupo({ meta: 5 })).toEqual({
      meta: 5,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
    expect(lerLeadsPorGrupo({})).toEqual({
      meta: 0,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
  });

  it("sem o campo, ou fora do formato: null, nunca zeros inventados", () => {
    for (const bruto of [undefined, null, "meta", 3, [], [{ meta: 1 }]]) {
      expect(lerLeadsPorGrupo(bruto)).toBeNull();
    }
    for (const bruto of [
      { meta: -1 },
      { meta: 1.5 },
      { meta: "muitos" },
      { meta: "3" },
      { google: null },
      { outras: "" },
    ]) {
      expect(lerLeadsPorGrupo(bruto)).toBeNull();
    }
  });

  it("chave herdada não conta, e chave desconhecida é ignorada", () => {
    expect(lerLeadsPorGrupo(Object.create({ meta: 9 }))).toEqual({
      meta: 0,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
    expect(lerLeadsPorGrupo({ meta: 2, tiktok: 40 })).toEqual({
      meta: 2,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
  });
});

describe("as consultas com o filtro", () => {
  function cliente(data: unknown) {
    const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return { data, error: null };
      },
    } as unknown as SupabaseClient;
    return { supabase, chamadas };
  }

  const BLOCO = {
    leads: 2,
    agendamentos_criados: 1,
    comparecimentos: 0,
    faltas: 0,
    coorte: { leads: 2, agendaram: 1, compareceram: 0 },
    por_canal: [
      { canal: "trafego_pago", leads: 2, agendaram: 1, compareceram: 0 },
    ],
    por_campanha: [],
  };

  it("funil: p_grupo só vai quando há origem escolhida", async () => {
    const semFiltro = cliente({ atual: BLOCO });
    await fetchFunilDoPeriodo(
      semFiltro.supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    await fetchFunilDoPeriodo(
      semFiltro.supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-31",
      { grupo: null },
    );
    for (const chamada of semFiltro.chamadas) {
      expect(chamada.nome).toBe("funil_do_periodo");
      expect(Object.keys(chamada.args).sort()).toEqual([
        "p_ate",
        "p_clinic_id",
        "p_de",
        "p_de_anterior",
      ]);
    }

    const comFiltro = cliente({ atual: BLOCO });
    await fetchFunilDoPeriodo(
      comFiltro.supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-31",
      { grupo: "google" },
    );
    expect(comFiltro.chamadas[0]?.args).toEqual({
      p_clinic_id: "c1",
      p_de: "2026-10-01T03:00:00.000Z",
      p_ate: "2026-11-01T03:00:00.000Z",
      p_de_anterior: "2026-08-31T03:00:00.000Z",
      p_grupo: "google",
    });
  });

  it("funil: porGrupo nas duas janelas; sem o campo, null", async () => {
    const { supabase } = cliente({
      atual: { ...BLOCO, por_grupo: { meta: 2 } },
      anterior: { ...BLOCO, por_grupo: { google: 1, nao_rastreada: 4 } },
    });
    const funil = await fetchFunilDoPeriodo(
      supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    expect(funil.atual.porGrupo).toEqual({
      meta: 2,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
    expect(funil.anterior?.porGrupo).toEqual({
      meta: 0,
      google: 1,
      outras: 0,
      nao_rastreada: 4,
    });

    // Banco de antes da migration 20261117110000: o resto do funil segue.
    const antigo = await fetchFunilDoPeriodo(
      cliente({ atual: BLOCO }).supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    expect(antigo.atual.porGrupo).toBeNull();
    expect(antigo.atual.leads).toBe(2);
  });

  it("série: p_grupo só vai quando há origem escolhida, e porGrupo por dia", async () => {
    const pontos = [
      {
        dia: "2026-10-01",
        leads: 1,
        agendadas: 0,
        por_grupo: { meta: 1, google: 0, outras: 0, nao_rastreada: 2 },
      },
      // Sem o campo: null so neste dia.
      { dia: "2026-10-02", leads: 0, agendadas: 0 },
    ];
    const semFiltro = cliente(pontos);
    const serie = await fetchSerieDiariaDoPeriodo(
      semFiltro.supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-02",
    );
    expect(semFiltro.chamadas).toEqual([
      {
        nome: "serie_diaria_do_periodo",
        args: {
          p_clinic_id: "c1",
          p_de: "2026-10-01T03:00:00.000Z",
          p_ate: "2026-10-03T03:00:00.000Z",
        },
      },
    ]);
    expect(serie).toEqual([
      {
        dia: "2026-10-01",
        leads: 1,
        agendadas: 0,
        porGrupo: { meta: 1, google: 0, outras: 0, nao_rastreada: 2 },
      },
      { dia: "2026-10-02", leads: 0, agendadas: 0, porGrupo: null },
    ]);

    const comFiltro = cliente(pontos);
    await fetchSerieDiariaDoPeriodo(
      comFiltro.supabase,
      "c1",
      TZ,
      "2026-10-01",
      "2026-10-02",
      { grupo: "nao_rastreada" },
    );
    expect(comFiltro.chamadas[0]?.args.p_grupo).toBe("nao_rastreada");
  });
});

describe("as chaves de cache", () => {
  it("funil e série levam a origem: cada filtro tem a própria entrada", () => {
    expect(
      relatoriosKeys.funil("c1", "2026-10-01", "2026-10-31", null),
    ).toEqual(["relatorios", "c1", "funil", "2026-10-01", "2026-10-31", null]);
    expect(
      relatoriosKeys.funil("c1", "2026-10-01", "2026-10-31", "meta"),
    ).toEqual([
      "relatorios",
      "c1",
      "funil",
      "2026-10-01",
      "2026-10-31",
      "meta",
    ]);
    expect(
      relatoriosKeys.serie("c1", "2026-10-01", "2026-10-31", "google"),
    ).toEqual([
      "relatorios",
      "c1",
      "serie",
      "2026-10-01",
      "2026-10-31",
      "google",
    ]);
    const chaves = [null, ...GRUPOS_DE_ORIGEM].map((grupo) =>
      JSON.stringify(relatoriosKeys.serie("c1", "a", "b", grupo)),
    );
    expect(new Set(chaves).size).toBe(5);
  });
});

describe("Origem dos leads por dia", () => {
  function bloco(
    props: Partial<Parameters<typeof OrigemDosLeadsPorDia>[0]> = {},
  ): string {
    return renderToStaticMarkup(
      <OrigemDosLeadsPorDia serie={SERIE} timezone={TZ} {...props} />,
    );
  }

  it("sem filtro: quatro séries, cada uma com marcador, traço, cor e nome", () => {
    const html = bloco();
    expect(contar(html, "<polyline")).toBe(4);
    for (const forma of ["circulo", "quadrado", "triangulo", "losango"]) {
      // Um marcador por dia e uma entrada na legenda.
      expect(contar(html, `data-marcador="${forma}"`)).toBe(3);
      expect(contar(html, `data-legenda="${forma}"`)).toBe(1);
    }
    for (const cor of [
      "var(--chart-bar)",
      "var(--chart-bar-muted)",
      "var(--chart-serie-3)",
      "var(--chart-serie-4)",
    ]) {
      expect(html).toContain(cor);
    }
    // Linha com marcadores, e so por token.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html).not.toMatch(/rgba?\(/);
    expect(html).not.toMatch(/[—–]/);
    expect(texto(html)).toContain("Origem dos leads por dia");
  });

  it("a legenda escreve o nome e o total de leads do período de cada grupo", () => {
    const html = bloco();
    expect(html).toMatch(
      /data-legenda="circulo"[\s\S]*?Meta Ads<span[^>]*>6 leads<\/span><\/li>/,
    );
    expect(html).toMatch(
      /data-legenda="triangulo"[\s\S]*?Google Ads<span[^>]*>1 lead<\/span><\/li>/,
    );
    expect(html).toMatch(
      /data-legenda="losango"[\s\S]*?Outras origens<span[^>]*>0 leads<\/span><\/li>/,
    );
    expect(html).toMatch(
      /data-legenda="quadrado"[\s\S]*?Não rastreada<span[^>]*>3 leads<\/span><\/li>/,
    );
    // O resumo falado e a tabela para leitor de tela trazem os quatro.
    expect(html).toContain("Meta Ads: 6 no total, pico de 4 em 1 de outubro.");
    expect(html).toContain("Outras origens: 0 no total.");
    expect(html).toContain(
      '<th scope="row">2 de outubro</th><td>0</td><td>0</td><td>0</td><td>3</td>',
    );
  });

  it("com filtro: só a série escolhida, com a mesma cara de sempre", () => {
    const html = bloco({ grupo: "google" });
    expect(contar(html, "<polyline")).toBe(1);
    expect(contar(html, 'data-legenda="triangulo"')).toBe(1);
    expect(contar(html, 'data-marcador="triangulo"')).toBe(3);
    for (const forma of ["circulo", "quadrado", "losango"]) {
      expect(html).not.toContain(`data-marcador="${forma}"`);
    }
    expect(html).toContain("var(--chart-serie-3)");
    expect(html).not.toContain("var(--chart-bar)");
    const lido = texto(html);
    expect(lido).toContain("Google Ads 1 lead");
    expect(lido).not.toContain("Meta Ads");
    expect(lido).toContain("Só Google Ads, por dia, no fuso da clínica");
  });

  it("vazio: nenhum lead no período, escrito, sem eixo", () => {
    const zerada = SERIE.map((ponto) => ({
      ...ponto,
      porGrupo: { meta: 0, google: 0, outras: 0, nao_rastreada: 0 },
    }));
    const html = bloco({ serie: zerada });
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toContain("Nenhum lead no período");
    expect(html).not.toContain("<polyline");

    // Com filtro, o vazio e o da origem escolhida (Outras tem zero aqui).
    const filtrado = bloco({ grupo: "outras" });
    expect(filtrado).toContain('data-estado="vazio"');
    expect(texto(filtrado)).toContain(
      "Nenhum lead em Outras origens no período",
    );
  });

  it("banco sem por_grupo: diz que não está disponível, sem inventar zero", () => {
    const html = bloco({ serie: SERIE_SEM_GRUPO });
    const lido = texto(html);
    expect(lido).toContain("Ainda não disponível");
    expect(lido).toContain(
      "A divisão dos leads por origem, dia a dia, ainda não está disponível.",
    );
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain('data-estado="vazio"');
    expect(lido).not.toContain("0 leads");
    // Um dia so sem o campo ja basta: o grafico nao sai pela metade.
    const umSo = bloco({
      serie: [SERIE[0]!, { ...SERIE[1]!, porGrupo: null }],
    });
    expect(umSo).not.toContain("<polyline");
  });

  it("carregando e erro com Tentar de novo, como os blocos vizinhos", () => {
    const carregando = bloco({ serie: undefined });
    expect(carregando).toContain("aria-busy");
    expect(texto(carregando)).toContain("Carregando");

    const comErro = bloco({
      serie: undefined,
      erro: true,
      tentarDeNovo: <button type="button">Tentar de novo</button>,
    });
    const lido = texto(comErro);
    expect(lido).toContain("Não foi possível carregar o gráfico");
    expect(lido).toContain("Tentar de novo");
    expect(comErro).not.toContain("aria-busy");
  });
});

describe("o aviso do filtro, aba por aba", () => {
  it("Visão geral: o que vem do funil e da série acompanha, o resto não", () => {
    const aviso = avisoDoFiltroDeOrigem("geral", "meta");
    expect(aviso.titulo).toBe("Origem escolhida: Meta Ads");
    expect(aviso.texto).toBe(
      "Acompanham a origem: Leads recebidos, Consultas agendadas, Taxa de conversão, Leads x consultas agendadas, Origem dos leads e Funil comercial. Continuam com todas as origens: Custo por lead, Faturamento estimado, Confirmação de consulta, Agente de IA e Campanhas.",
    );
    expect(aviso.notaDaTela).toBe(
      "Enquanto houver origem escolhida, os nomes em Origem dos leads não abrem a lista de Leads.",
    );
  });

  it("Marketing: o detalhe só acompanha por canal", () => {
    const porCanal = avisoDoFiltroDeOrigem("marketing", "google", "canal");
    expect(porCanal.titulo).toBe("Origem escolhida: Google Ads");
    expect(porCanal.texto).toBe(
      "Acompanham a origem: Leads recebidos, Com origem identificada, Lead para comparecimento, Taxa de falta, Origem dos leads, Origem dos leads por dia e Detalhe da origem por canal. Continuam com todas as origens: Custo por lead, Campanhas e Conversões devolvidas à Meta.",
    );
    expect(porCanal.notaDaTela).toContain("no detalhe por canal");

    const porCampanha = avisoDoFiltroDeOrigem(
      "marketing",
      "google",
      "campanha",
    );
    expect(porCampanha.texto).toContain(
      "Origem dos leads e Origem dos leads por dia. Continuam com todas as origens: Custo por lead, Campanhas, Conversões devolvidas à Meta e Detalhe da origem por campanha.",
    );
    expect(
      avisoDoFiltroDeOrigem("marketing", "google", "anuncio").texto,
    ).toContain("e Detalhe da origem por anúncio.");
    // Sem a dimensao, vale a que a tela abre: Canal.
    expect(avisoDoFiltroDeOrigem("marketing", "google")).toEqual(porCanal);
  });

  it("Comercial: só o Funil comercial acompanha", () => {
    const aviso = avisoDoFiltroDeOrigem("comercial", "outras");
    expect(aviso.titulo).toBe("Origem escolhida: Outras origens");
    expect(aviso.texto).toBe(
      "Acompanham a origem: Funil comercial. Continuam com todas as origens: Consultas agendadas, Comparecimentos, Faltas, Cancelamentos, Consultas recuperadas, Faturamento estimado, Confirmação de consulta e Detalhe da agenda.",
    );
    expect(aviso.notaDaTela).toBeNull();
  });

  it("Agente de IA: nada acompanha, e o aviso diz isso", () => {
    const aviso = avisoDoFiltroDeOrigem("ia", "nao_rastreada");
    expect(aviso.titulo).toBe("Origem escolhida: Não rastreada");
    expect(aviso.texto).toBe(
      "Nada nesta aba acompanha a origem escolhida: os números do agente de IA continuam com todas as origens.",
    );
    expect(aviso.notaDaTela).toBeNull();
  });

  it("toda aba tem aviso, sem travessão e em linguagem de recepção", () => {
    for (const { chave } of ABAS_DE_RESULTADOS) {
      for (const grupo of GRUPOS_DE_ORIGEM) {
        const aviso = avisoDoFiltroDeOrigem(chave, grupo);
        const tudo = `${aviso.titulo} ${aviso.texto} ${aviso.notaDaTela ?? ""}`;
        expect(tudo).not.toMatch(/[—–]/);
        expect(tudo).not.toMatch(/querystring|tenant|filtro aplicado|RPC/i);
        expect(aviso.titulo).toContain(ROTULO_DO_GRUPO_DE_ORIGEM[grupo]);
      }
    }
  });
});

describe("a aba Marketing com uma origem escolhida", () => {
  // Todos os anuncios com a divisao por plataforma, para a linha "Dos leads
  // de anúncio" aparecer na Origem dos leads quando nao ha filtro.
  const base = anunciosDoPeriodo();
  const ANUNCIOS = {
    ...base,
    linhas: base.linhas.map((linha) => ({
      ...linha,
      plataformas: linha.plataformas ?? [
        { plataforma: null, leads: linha.leads },
      ],
    })),
  };

  function marketing(grupo: "meta" | null, dimensao: "canal" | "campanha") {
    return renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: FUNIL }}
        periodo={PERIODO}
        campanhas={campanhasPeriodizadas()}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        anuncios={ANUNCIOS}
        serie={SERIE}
        grupo={grupo}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores={false}
        dimensao={dimensao}
        aoMudarDimensao={nada}
      />,
    );
  }

  /** O href de cada link para a lista de Leads, ja sem o &amp; do HTML. */
  function destinos(html: string): string[] {
    return [...html.matchAll(/<a\s[^>]*href="(\/leads[^"]*)"/g)].map(
      ([, href = ""]) => href.replaceAll("&amp;", "&"),
    );
  }

  it("sem filtro: o gráfico com as quatro séries, os links e as plataformas", () => {
    const html = marketing(null, "canal");
    expect(texto(html)).toContain("Origem dos leads por dia");
    expect(contar(html, "<polyline")).toBe(4);
    expect(texto(html)).toContain("Dos leads de anúncio:");
    // Duas barras e duas linhas do detalhe por canal.
    expect(
      destinos(html).filter((href) => href.includes("origem=")),
    ).toHaveLength(4);
  });

  it("com filtro: uma série, sem link por canal e sem a divisão por plataforma", () => {
    const html = marketing("meta", "canal");
    expect(contar(html, "<polyline")).toBe(1);
    expect(texto(html)).not.toContain("Dos leads de anúncio:");
    expect(destinos(html).filter((href) => href.includes("origem="))).toEqual(
      [],
    );
    // Os nomes continuam na tela, so nao sao links.
    expect(texto(html)).toContain("Tráfego pago");
    expect(texto(html)).toContain("Sem atribuição");
  });

  it("com filtro e detalhe por campanha: os links das campanhas continuam", () => {
    const html = marketing("meta", "campanha");
    const daCampanha = destinos(html).filter((href) =>
      href.includes("campanha="),
    );
    expect(daCampanha.length).toBeGreaterThan(0);
    expect(destinos(html).filter((href) => href.includes("origem="))).toEqual(
      [],
    );
  });
});

describe("a exportação com e sem filtro", () => {
  function entrada(
    aba: AbaDeResultados,
    extra: Partial<EntradaDaExportacao> = {},
  ): EntradaDaExportacao {
    return {
      aba,
      podeVerValores: false,
      canalOficial: false,
      funil: { atual: FUNIL, anterior: FUNIL },
      agenda: { atual: agenda(null), anterior: null },
      atendimento: { atual: ATENDIMENTO, anterior: null },
      serie: SERIE,
      conversoes: CONVERSOES,
      campanhas: campanhasPeriodizadas(),
      timezone: TZ,
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
      ...extra,
    };
  }

  const titulos = (
    aba: AbaDeResultados,
    extra: Partial<EntradaDaExportacao> = {},
  ) => montarExportavelDaAba(entrada(aba, extra)).secoes.map((s) => s.titulo);

  it("sem filtro: nada muda no formato (sem a linha da origem)", () => {
    for (const { chave } of ABAS_DE_RESULTADOS) {
      for (const grupo of [undefined, null]) {
        const exportavel = montarExportavelDaAba(entrada(chave, { grupo }));
        expect(exportavel).not.toHaveProperty("filtro");
        expect(linhasDoCsv(exportavel)[0]).toEqual([
          exportavel.secoes[0]?.titulo,
        ]);
      }
    }
  });

  it("com filtro: o arquivo abre com a origem e o que ela filtra na aba", () => {
    for (const { chave } of ABAS_DE_RESULTADOS) {
      const exportavel = montarExportavelDaAba(
        entrada(chave, { grupo: "meta" }),
      );
      const aviso = avisoDoFiltroDeOrigem(chave, "meta", "canal");
      expect(exportavel.filtro?.titulo).toBe("Origem escolhida: Meta Ads");
      expect(exportavel.filtro?.texto).toBe(aviso.texto);
      const linhas = linhasDoCsv(exportavel);
      expect(linhas.slice(0, 4)).toEqual([
        ["Origem escolhida: Meta Ads"],
        [aviso.texto],
        [],
        [exportavel.secoes[0]?.titulo],
      ]);
      // O resto do arquivo e o de sempre.
      expect(linhas.slice(3)).toEqual(
        linhasDoCsv({ ...exportavel, filtro: undefined }),
      );
    }
  });

  it("com filtro e detalhe por campanha: o arquivo diz que o detalhe não acompanha", () => {
    const exportavel = montarExportavelDaAba(
      entrada("marketing", { grupo: "google", dimensaoOrigem: "campanha" }),
    );
    expect(exportavel.filtro?.texto).toContain(
      "Detalhe da origem por campanha",
    );
  });

  it("Marketing exporta Origem dos leads por dia, logo depois da Origem dos leads", () => {
    const lista = titulos("marketing");
    expect(lista.indexOf("Origem dos leads por dia")).toBe(
      lista.indexOf("Origem dos leads") + 1,
    );
    const secao = montarExportavelDaAba(entrada("marketing")).secoes.find(
      (s) => s.titulo === "Origem dos leads por dia",
    );
    expect(secao?.linhas).toEqual([
      ["Dia", "Meta Ads", "Google Ads", "Outras origens", "Não rastreada"],
      ["01/10/2026", "4", "1", "0", "0"],
      ["02/10/2026", "0", "0", "0", "3"],
      ["03/10/2026", "2", "0", "0", "0"],
      ["Total", "6", "1", "0", "3"],
    ]);
  });

  it("com filtro, a seção leva só a coluna da origem escolhida", () => {
    const secao = montarExportavelDaAba(
      entrada("marketing", { grupo: "nao_rastreada" }),
    ).secoes.find((s) => s.titulo === "Origem dos leads por dia");
    expect(secao?.linhas).toEqual([
      ["Dia", "Não rastreada"],
      ["01/10/2026", "0"],
      ["02/10/2026", "3"],
      ["03/10/2026", "0"],
      ["Total", "3"],
    ]);
  });

  it("a seção só existe na aba do bloco, e some sem por_grupo ou sem a série", () => {
    for (const aba of ["geral", "comercial", "ia"] as const) {
      expect(titulos(aba)).not.toContain("Origem dos leads por dia");
    }
    expect(titulos("marketing", { serie: SERIE_SEM_GRUPO })).not.toContain(
      "Origem dos leads por dia",
    );
    expect(titulos("marketing", { serie: undefined })).not.toContain(
      "Origem dos leads por dia",
    );
  });
});

describe("textoDeLeads", () => {
  it("singular, plural e milhar", () => {
    expect(textoDeLeads(0)).toBe("0 leads");
    expect(textoDeLeads(1)).toBe("1 lead");
    expect(textoDeLeads(1234)).toBe("1.234 leads");
  });
});
