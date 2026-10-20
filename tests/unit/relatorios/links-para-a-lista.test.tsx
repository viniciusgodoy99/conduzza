import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ANUNCIO_NAO_IDENTIFICADO,
  ANUNCIO_SEM,
  CAMPANHA_SEM,
  ORIGEM_SEM_ATRIBUICAO,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  linhasDaOrigem,
  linhasDoCsv,
  montarDetalheDeOrigem,
  montarDetalheDeOrigemDaTela,
  montarExportavelDaAba,
  type DimensaoDaOrigem,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";

import {
  CONVERSOES,
  FUNIL,
  agenda,
  anunciosDoPeriodo,
  campanhasDoPeriodo,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// De Resultados para a lista de Leads (pedido do dono em 20/10/2026): o
// rotulo de cada linha do Detalhe da origem e de cada barra da Origem dos
// leads abre /leads na visao Lista, com o MESMO periodo e o filtro da linha
// (canal ou sem_atribuicao, a chave da campanha ou sem, o id do anuncio,
// nao_identificado ou sem). O nome acessivel diz o destino, o alvo tem 40px
// de altura, e a exportacao CSV de Resultados nao muda.

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
const { OrigemDosLeads } =
  await import("@/components/relatorios/origem-dos-leads");
const { AbaMarketing } = await import("@/components/relatorios/aba-marketing");
const { VisaoDoProfissional } =
  await import("@/app/(app)/relatorios/visao-do-profissional");

const PERIODO = { diaDe: "2026-10-01", diaAte: "2026-10-20" };
const nada = () => undefined;

function decodificar(valor: string): string {
  return valor
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Os links do HTML: destino, nome acessivel e classes. */
function links(html: string) {
  return [...html.matchAll(/<a\s([^>]*)>/g)].map(([, atributos = ""]) => ({
    href: decodificar(/(?:^|\s)href="([^"]*)"/.exec(atributos)?.[1] ?? ""),
    nome: decodificar(/aria-label="([^"]*)"/.exec(atributos)?.[1] ?? ""),
    classe: /class="([^"]*)"/.exec(atributos)?.[1] ?? "",
  }));
}

/** O filtro do destino: [campo, valor], fora visao, de e ate. */
function filtroDoDestino(href: string): [string, string][] {
  const url = new URL(href, "https://conduzza.invalid");
  expect(url.pathname).toBe("/leads");
  expect(url.searchParams.get("visao")).toBe("lista");
  expect(url.searchParams.get("de")).toBe(PERIODO.diaDe);
  expect(url.searchParams.get("ate")).toBe(PERIODO.diaAte);
  return [...url.searchParams.entries()].filter(
    ([campo]) => !["visao", "de", "ate"].includes(campo),
  );
}

describe("o filtro de cada linha (montarDetalheDeOrigemDaTela)", () => {
  const campanhas = campanhasDoPeriodo();
  const anuncios = anunciosDoPeriodo();

  it("por canal: o canal, e o canal vazio vira sem_atribuicao", () => {
    expect(
      montarDetalheDeOrigemDaTela(FUNIL, "canal", campanhas)?.map((linha) => [
        linha.rotulo,
        linha.filtro,
      ]),
    ).toEqual([
      ["Tráfego pago", { campo: "origem", valor: "trafego_pago" }],
      ["Sem atribuição", { campo: "origem", valor: ORIGEM_SEM_ATRIBUICAO }],
    ]);
  });

  it("por campanha: a chave que o banco devolveu, e Sem campanha vira sem (a de 0 lead não entra)", () => {
    expect(
      montarDetalheDeOrigemDaTela(FUNIL, "campanha", campanhas)?.map((linha) => [
        linha.rotulo,
        linha.leads,
        linha.filtro,
      ]),
    ).toEqual([
      ["Implante Dentário", 120, { campo: "campanha", valor: "meta:120000000000000010" }],
      ["Campanha 120000000000000020", 30, { campo: "campanha", valor: "meta:120000000000000020" }],
      ["Check-up 2026", 186, { campo: "campanha", valor: "texto:Check-up 2026" }],
      ["Sem campanha", 150, { campo: "campanha", valor: CAMPANHA_SEM }],
    ]);
  });

  it("por anúncio: o id, e os restos viram nao_identificado e sem", () => {
    expect(
      montarDetalheDeOrigemDaTela(FUNIL, "anuncio", campanhas, anuncios)?.map(
        (linha) => linha.filtro,
      ),
    ).toEqual([
      { campo: "anuncio", valor: "120240624148610289" },
      { campo: "anuncio", valor: "120240624148610290" },
      { campo: "anuncio", valor: "120240624148610291" },
      { campo: "anuncio", valor: ANUNCIO_NAO_IDENTIFICADO },
      { campo: "anuncio", valor: ANUNCIO_SEM },
    ]);
  });

  it("a forma da exportação é a mesma linha, sem o filtro", () => {
    for (const dimensao of ["canal", "campanha", "anuncio"] as DimensaoDaOrigem[]) {
      const daTela = montarDetalheDeOrigemDaTela(FUNIL, dimensao, campanhas, anuncios)!;
      const exportada = montarDetalheDeOrigem(FUNIL, dimensao, campanhas, anuncios)!;
      expect(exportada).toEqual(
        daTela.map(
          ({ rotulo, leads, agendaram, compareceram, comparecimento }) => ({
            rotulo,
            leads,
            agendaram,
            compareceram,
            comparecimento,
          }),
        ),
      );
      for (const linha of exportada) {
        expect(Object.keys(linha)).not.toContain("filtro");
      }
    }
  });

  it("as barras da Origem dos leads levam o filtro do canal", () => {
    expect(linhasDaOrigem(FUNIL).map((linha) => linha.filtro)).toEqual([
      { campo: "origem", valor: "trafego_pago" },
      { campo: "origem", valor: ORIGEM_SEM_ATRIBUICAO },
    ]);
  });
});

describe("a exportação CSV de Resultados não muda", () => {
  function csv(dimensaoOrigem: DimensaoDaOrigem): string[][] {
    const entrada: EntradaDaExportacao = {
      aba: "marketing",
      podeVerValores: true,
      canalOficial: false,
      funil: { atual: FUNIL, anterior: null },
      campanhas: campanhasPeriodizadas(),
      anuncios: anunciosDoPeriodo(),
      conversoes: CONVERSOES,
      timezone: "America/Fortaleza",
      dimensaoOrigem,
      dimensaoAgenda: "profissional",
    };
    return linhasDoCsv(montarExportavelDaAba(entrada));
  }

  it("as seções de origem saem só com rótulo e números, sem link nem chave", () => {
    for (const dimensao of ["canal", "campanha", "anuncio"] as DimensaoDaOrigem[]) {
      const linhas = csv(dimensao);
      const celulas = linhas.flat().join("\n");
      for (const proibido of ["/leads", "visao=lista", "sem_atribuicao", "meta:", "texto:", "nao_identificado"]) {
        expect(celulas, `${dimensao}: ${proibido}`).not.toContain(proibido);
      }
    }
    const porCanal = csv("canal");
    const inicio = porCanal.findIndex((linha) => linha[0] === "Detalhe por canal");
    expect(porCanal.slice(inicio, inicio + 4)).toEqual([
      ["Detalhe por canal"],
      ["Origem", "Leads", "Agendaram", "Compareceram", "Comparecimento"],
      ["Tráfego pago", "300", "200", "160", "53,3%"],
      ["Sem atribuição", "186", "112", "90", "48,4%"],
    ]);
    const origem = porCanal.findIndex((linha) => linha[0] === "Origem dos leads");
    expect(porCanal.slice(origem, origem + 4)).toEqual([
      ["Origem dos leads"],
      ["Origem", "Leads", "Participação"],
      ["Tráfego pago", "300", "61,7%"],
      ["Sem atribuição", "186", "38,3%"],
    ]);
  });
});

describe("Detalhe da origem na tela: o rótulo é o link", () => {
  function tela(dimensao: DimensaoDaOrigem) {
    return renderToStaticMarkup(
      <DetalheDaOrigem
        funil={FUNIL}
        periodo={PERIODO}
        campanhas={campanhasDoPeriodo()}
        anuncios={anunciosDoPeriodo()}
        dimensao={dimensao}
        aoMudarDimensao={nada}
      />,
    );
  }

  it("por canal: o canal e Sem atribuição, com o período da tela", () => {
    const achados = links(tela("canal"));
    expect(achados.map((link) => filtroDoDestino(link.href))).toEqual([
      [["origem", "trafego_pago"]],
      [["origem", ORIGEM_SEM_ATRIBUICAO]],
    ]);
    expect(achados.map((link) => link.nome)).toEqual([
      "Ver os 300 leads de Tráfego pago na lista de Leads",
      "Ver os 186 leads de Sem atribuição na lista de Leads",
    ]);
  });

  it("por campanha: a chave de cada linha e Sem campanha", () => {
    const achados = links(tela("campanha"));
    expect(achados.map((link) => filtroDoDestino(link.href))).toEqual([
      [["campanha", "meta:120000000000000010"]],
      [["campanha", "meta:120000000000000020"]],
      [["campanha", "texto:Check-up 2026"]],
      [["campanha", CAMPANHA_SEM]],
    ]);
    expect(achados.map((link) => link.nome)).toEqual([
      "Ver os 120 leads de Implante Dentário na lista de Leads",
      "Ver os 30 leads de Campanha 120000000000000020 na lista de Leads",
      "Ver os 186 leads de Check-up 2026 na lista de Leads",
      "Ver os 150 leads de Sem campanha na lista de Leads",
    ]);
  });

  it("por anúncio: o id, Anúncio não identificado e Sem anúncio da Meta", () => {
    const achados = links(tela("anuncio"));
    expect(achados.map((link) => filtroDoDestino(link.href))).toEqual([
      [["anuncio", "120240624148610289"]],
      [["anuncio", "120240624148610290"]],
      [["anuncio", "120240624148610291"]],
      [["anuncio", ANUNCIO_NAO_IDENTIFICADO]],
      [["anuncio", ANUNCIO_SEM]],
    ]);
    expect(achados.at(-2)?.nome).toBe(
      "Ver os 12 leads de Anúncio não identificado na lista de Leads",
    );
    expect(achados.at(-1)?.nome).toBe(
      "Ver os 324 leads de Sem anúncio da Meta na lista de Leads",
    );
  });

  it("alvo de 40px, tokens do tema, foco visível e nenhum travessão", () => {
    const html = tela("campanha");
    for (const link of links(html)) {
      expect(link.classe).toContain("min-h-10");
      expect(link.classe).toContain("text-primary-text");
      expect(link.classe).toContain("focus-visible:outline-focus");
      expect(link.classe).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
    expect(html).not.toMatch(/[–—]/);
  });

  it("carregando e erro continuam sem link", () => {
    const carregando = renderToStaticMarkup(
      <DetalheDaOrigem
        funil={FUNIL}
        periodo={PERIODO}
        campanhas={undefined}
        dimensao="campanha"
        aoMudarDimensao={nada}
      />,
    );
    expect(links(carregando)).toEqual([]);
    const comErro = renderToStaticMarkup(
      <DetalheDaOrigem
        funil={FUNIL}
        periodo={PERIODO}
        campanhas={undefined}
        campanhasComErro
        dimensao="campanha"
        aoMudarDimensao={nada}
      />,
    );
    expect(links(comErro)).toEqual([]);
    expect(comErro).toContain("Não foi possível carregar as campanhas.");
  });
});

describe("Origem dos leads: cada barra abre a lista", () => {
  it("o rótulo da barra é o link, com 40px e o período da tela", () => {
    const html = renderToStaticMarkup(
      <OrigemDosLeads funil={FUNIL} periodo={PERIODO} />,
    );
    const achados = links(html);
    expect(achados.map((link) => filtroDoDestino(link.href))).toEqual([
      [["origem", "trafego_pago"]],
      [["origem", ORIGEM_SEM_ATRIBUICAO]],
    ]);
    expect(achados.map((link) => link.nome)).toEqual([
      "Ver os 300 leads de Tráfego pago na lista de Leads",
      "Ver os 186 leads de Sem atribuição na lista de Leads",
    ]);
    for (const link of achados) {
      expect(link.classe).toContain("min-h-10");
    }
    // A barra continua lendo o numero e a participacao para o leitor de tela.
    expect(html).toContain('aria-label="Tráfego pago: 300, 61,7%"');
  });

  it("sem lead no período: o vazio, sem link", () => {
    const html = renderToStaticMarkup(
      <OrigemDosLeads
        funil={{ ...FUNIL, leads: 0, porCanal: [] }}
        periodo={PERIODO}
      />,
    );
    expect(links(html)).toEqual([]);
    expect(html).toContain("Nenhum lead chegou neste período");
  });
});

describe("a aba Marketing leva o período até os links", () => {
  it("as barras e o detalhe usam o período que a tela mostra", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        periodo={{ diaDe: "2026-09-01", diaAte: "2026-09-30" }}
        campanhas={campanhasPeriodizadas(null)}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone="America/Fortaleza"
        podeVerValores={false}
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    const paraLeads = links(html).filter((link) => link.href.startsWith("/leads?"));
    // Duas barras e duas linhas do detalhe por canal.
    expect(paraLeads).toHaveLength(4);
    for (const link of paraLeads) {
      const url = new URL(link.href, "https://conduzza.invalid");
      expect(url.searchParams.get("de")).toBe("2026-09-01");
      expect(url.searchParams.get("ate")).toBe("2026-09-30");
    }
  });
});

describe("visão do profissional", () => {
  it("não tem Origem dos leads nem Detalhe da origem: nenhum link para Leads", () => {
    const html = renderToStaticMarkup(
      <VisaoDoProfissional agenda={{ atual: agenda(null), anterior: null }} />,
    );
    expect(html).not.toContain('href="/leads');
    expect(html).not.toContain("Origem dos leads");
  });
});
