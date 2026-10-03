import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EtapaDoFunil, Leitura, ResumoDoDia } from "@/lib/queries/inicio";

// Blocos do Inicio da Fase 3, renderizados no servidor: os 4 cartoes do dia
// com a variacao A1, o lime so em Confirmadas e a IA "Ainda nao medido";
// as 7 barras deitadas com "Hoje" escrito e em destaque; o funil pelas
// etapas da clinica com Perdido neutro; e, em cada bloco, os estados de
// vazio e de erro (erro nunca vira zero).

// Componentes client trocados por stand-ins de servidor: a dica vira
// atributo e o "Tentar de novo" vira um botao simples (sem roteador).
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
vi.mock("@/components/shell/botao-recarregar", () => ({
  BotaoRecarregar: ({ rotulo }: { rotulo: string }) => (
    <button type="button">{rotulo}</button>
  ),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...resto
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

// As linhas de atividades de Proximas acoes leem a sessao e o banco no
// servidor (componente assincrono em Suspense): aqui entra um marcador, e o
// desenho delas tem teste proprio (atividades-em-proximas-acoes.test.tsx).
vi.mock("@/components/inicio/atividades-em-proximas-acoes", () => ({
  LinhasDeAtividades: () => <li data-linhas-de-atividades="sim" />,
  LinhasDeAtividadesCarregando: () => null,
}));

const { IndicadoresDoDia } =
  await import("@/components/inicio/indicadores-do-dia");
const { ConsultasPorDia } =
  await import("@/components/inicio/consultas-por-dia");
const { FunilDeLeads } = await import("@/components/inicio/funil-de-leads");
const { Painel } = await import("@/components/inicio/painel");

const FORTALEZA = "America/Fortaleza";
const TRAVESSAO = /[–—]/;

function resumo(parcial: Partial<ResumoDoDia> = {}): Leitura<ResumoDoDia> {
  return {
    ok: true,
    dados: {
      dia: "2026-10-02",
      hoje: {
        total: 147,
        confirmadas: 128,
        aguardando: 19,
        canceladas: 3,
        unidades: 3,
      },
      semanaPassada: { total: 0, confirmadas: 100 },
      ultimoDisparo: "2026-10-02T12:02:00+00:00",
      porDia: [
        { dia: "2026-09-26", total: 64 },
        { dia: "2026-09-27", total: 0 },
        { dia: "2026-09-28", total: 136 },
        { dia: "2026-09-29", total: 118 },
        { dia: "2026-09-30", total: 132 },
        { dia: "2026-10-01", total: 141 },
        { dia: "2026-10-02", total: 147 },
      ],
      ...parcial,
    },
  };
}

const ETAPAS: EtapaDoFunil[] = [
  { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10, total: 38 },
  {
    chave: "em_contato",
    nome: "Em contato",
    papel: null,
    posicao: 20,
    total: 0,
  },
  {
    chave: "agendou",
    nome: "Agendou",
    papel: "agendou",
    posicao: 40,
    total: 9,
  },
  {
    chave: "perdido",
    nome: "Perdido",
    papel: "perdido",
    posicao: 60,
    total: 4,
  },
];

const PROXIMAS = {
  confirmacoesPendentesAmanha: 3,
  aguardandoHumano: 1,
  semResposta24h: 0,
};

/** Texto visivel e falado, sem as tags. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O markup do cartao (role=group) cujo eyebrow e o rotulo dado. */
function cartao(markup: string, rotulo: string): string {
  const grupos = markup.split('role="group"').slice(1);
  const achado = grupos.find((grupo) => grupo.includes(`>${rotulo}<`));
  expect(achado, `cartão ${rotulo}`).toBeDefined();
  return achado ?? "";
}

describe("IndicadoresDoDia", () => {
  it("mostra os 4 cartões do dia na ordem do protótipo", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresDoDia resumo={resumo()} timezone={FORTALEZA} />,
    );
    const rotulos = [
      "Consultas hoje",
      "Confirmadas",
      "Aguardando",
      "Resolvidas pela IA",
    ];
    const posicoes = rotulos.map((rotulo) => markup.indexOf(`>${rotulo}<`));
    expect(posicoes.every((posicao) => posicao > -1)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(markup).toContain('aria-label="Indicadores de hoje"');
  });

  it("Consultas hoje: rodapé de unidades e base zero sem seta", () => {
    const consultas = cartao(
      renderToStaticMarkup(
        <IndicadoresDoDia resumo={resumo()} timezone={FORTALEZA} />,
      ),
      "Consultas hoje",
    );
    expect(texto(consultas)).toContain("147");
    expect(texto(consultas)).toContain("3 unidades");
    expect(texto(consultas)).toContain(
      "sem base de comparação (vs. mesmo dia da semana passada)",
    );
    expect(consultas).not.toContain('data-parte="variacao"');
  });

  it("Consultas hoje com 1 unidade não tem rodapé de unidades", () => {
    const base = resumo();
    const markup = renderToStaticMarkup(
      <IndicadoresDoDia
        resumo={
          base.ok
            ? {
                ok: true,
                dados: {
                  ...base.dados,
                  hoje: { ...base.dados.hoje, unidades: 1 },
                },
              }
            : base
        }
        timezone={FORTALEZA}
      />,
    );
    expect(texto(cartao(markup, "Consultas hoje"))).not.toContain("unidade");
  });

  it("Confirmadas é o lime da grade, com a taxa e a variação A1", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresDoDia resumo={resumo()} timezone={FORTALEZA} />,
    );
    const confirmadas = cartao(markup, "Confirmadas");
    expect(confirmadas).toContain("bg-primary");
    expect(texto(confirmadas)).toContain("128");
    expect(texto(confirmadas)).toContain("87,1% do total");
    expect(confirmadas).toContain('data-sentido="subiu"');
    expect(texto(confirmadas)).toContain(
      "subiu 28,0% vs. mesmo dia da semana passada",
    );
    // Um lime so por grade.
    expect(markup.match(/bg-primary /g)?.length ?? 0).toBe(1);
  });

  it("Aguardando diz o último disparo no fuso da clínica, ou que não houve", () => {
    const comDisparo = renderToStaticMarkup(
      <IndicadoresDoDia resumo={resumo()} timezone={FORTALEZA} />,
    );
    expect(texto(cartao(comDisparo, "Aguardando"))).toContain(
      "Último disparo 09:02",
    );
    const semDisparo = renderToStaticMarkup(
      <IndicadoresDoDia
        resumo={resumo({ ultimoDisparo: null })}
        timezone={FORTALEZA}
      />,
    );
    expect(texto(cartao(semDisparo, "Aguardando"))).toContain(
      "Nenhum disparo hoje",
    );
  });

  it("Resolvidas pela IA fica Ainda não medido, com a dica", () => {
    const ia = cartao(
      renderToStaticMarkup(
        <IndicadoresDoDia resumo={resumo()} timezone={FORTALEZA} />,
      ),
      "Resolvidas pela IA",
    );
    expect(ia).toContain('data-estado="nao-medido"');
    expect(texto(ia)).toContain("Ainda não medido");
    expect(ia).toContain("data-dica=");
  });

  it("erro: os 3 cartões de dado dizem que não carregaram, nenhum zero", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresDoDia resumo={{ ok: false }} timezone={FORTALEZA} />,
    );
    for (const rotulo of ["Consultas hoje", "Confirmadas", "Aguardando"]) {
      const trecho = cartao(markup, rotulo);
      expect(trecho).toContain('data-estado="erro"');
      // Do fim da tag de abertura em diante: so o conteudo do cartao.
      const conteudo = texto(trecho.slice(trecho.indexOf(">") + 1));
      expect(conteudo).toContain("Não foi possível carregar");
      expect(conteudo).not.toMatch(/\d/);
    }
    expect(cartao(markup, "Resolvidas pela IA")).toContain(
      'data-estado="nao-medido"',
    );
  });
});

describe("ConsultasPorDia", () => {
  it("7 barras deitadas, de D-6 a D sem pular dia, com Hoje escrito e em destaque", () => {
    const markup = renderToStaticMarkup(<ConsultasPorDia resumo={resumo()} />);
    expect(markup.match(/<li /g)?.length).toBe(7);
    expect(texto(markup)).toContain("Consultas por dia, últimos 7 dias");
    // O domingo com zero aparece.
    expect(markup).toContain(
      'aria-label="domingo, 27 de setembro: 0 consultas"',
    );
    expect(markup).toContain('aria-label="hoje, 2 de outubro: 147 consultas"');
    const hoje = markup.slice(
      markup.lastIndexOf("<li", markup.indexOf("data-hoje")),
    );
    expect(texto(hoje)).toMatch(/^Hoje 02\/10/);
    // So a barra de hoje e destaque; as outras 6 sao neutras.
    expect(markup.match(/var\(--chart-bar\)/g)?.length).toBe(1);
    expect(markup.match(/var\(--chart-bar-muted\)/g)?.length).toBe(6);
    expect(texto(markup)).toContain("738 consultas no período");
  });

  it("vazio: nenhuma consulta nos 7 dias", () => {
    const base = resumo();
    const zerado: Leitura<ResumoDoDia> = base.ok
      ? {
          ok: true,
          dados: {
            ...base.dados,
            porDia: base.dados.porDia.map((linha) => ({ ...linha, total: 0 })),
          },
        }
      : base;
    const markup = renderToStaticMarkup(<ConsultasPorDia resumo={zerado} />);
    expect(texto(markup)).toContain("Nenhuma consulta nos últimos 7 dias");
    expect(markup).not.toContain("<li");
  });

  it("erro: diz que não carregou, sem barra nenhuma", () => {
    const markup = renderToStaticMarkup(
      <ConsultasPorDia resumo={{ ok: false }} />,
    );
    expect(texto(markup)).toContain(
      "Não foi possível carregar as consultas dos últimos 7 dias",
    );
    expect(markup).not.toContain('role="img"');
  });
});

describe("FunilDeLeads", () => {
  it("uma barra por etapa da clínica, na ordem, com Perdido neutro", () => {
    const markup = renderToStaticMarkup(
      <FunilDeLeads funil={{ ok: true, dados: ETAPAS }} />,
    );
    const nomes = ETAPAS.map((etapa) => markup.indexOf(`>${etapa.nome}<`));
    expect(nomes.every((posicao) => posicao > -1)).toBe(true);
    expect([...nomes].sort((a, b) => a - b)).toEqual(nomes);
    expect(markup).toContain('aria-label="Novo: 38 leads"');
    expect(markup).toContain('aria-label="Em contato: 0 leads"');
    expect(markup.match(/var\(--chart-bar\)/g)?.length).toBe(3);
    expect(markup.match(/var\(--chart-bar-muted\)/g)?.length).toBe(1);
    expect(texto(markup)).toContain("51 leads, pela etapa em que estão agora");
    expect(markup).toContain('href="/leads"');
    expect(markup).toContain('aria-label="Abrir Leads"');
  });

  it("vazio: sem lead em etapa nenhuma (ou sem etapa visível)", () => {
    for (const dados of [[], ETAPAS.map((etapa) => ({ ...etapa, total: 0 }))]) {
      const markup = renderToStaticMarkup(
        <FunilDeLeads funil={{ ok: true, dados }} />,
      );
      expect(texto(markup)).toContain("Nenhum lead na jornada ainda");
      expect(markup).not.toContain('role="img"');
    }
  });

  it("erro: diz que não carregou", () => {
    const markup = renderToStaticMarkup(<FunilDeLeads funil={{ ok: false }} />);
    expect(texto(markup)).toContain(
      "Não foi possível carregar o funil de leads",
    );
    expect(markup).not.toContain('role="img"');
  });
});

describe("Painel", () => {
  it("tudo carregado: sem aviso, com Próximas ações e os três blocos", () => {
    const markup = renderToStaticMarkup(
      <Painel
        timezone={FORTALEZA}
        resumo={resumo()}
        funil={{ ok: true, dados: ETAPAS }}
        proximasAcoes={PROXIMAS}
      />,
    );
    const visivel = texto(markup);
    expect(visivel).not.toContain("Alguns números não carregaram");
    expect(visivel).toContain("Próximas ações");
    expect(visivel).toContain("Consultas por dia, últimos 7 dias");
    expect(visivel).toContain("Funil de leads");
    // As linhas de atividades entram no cartao de Proximas acoes.
    expect(markup).toContain('data-linhas-de-atividades="sim"');
    // Sairam do Inicio na Fase 3.
    for (const fora of [
      "Consultas recuperadas",
      "Origem dos leads",
      "Mensagens no período",
      "Últimos 30 dias",
    ]) {
      expect(visivel).not.toContain(fora);
    }
    expect(visivel).not.toMatch(TRAVESSAO);
  });

  it("um bloco falhou: aviso com Tentar de novo, o resto continua", () => {
    const markup = renderToStaticMarkup(
      <Painel
        timezone={FORTALEZA}
        resumo={resumo()}
        funil={{ ok: false }}
        proximasAcoes={PROXIMAS}
      />,
    );
    const visivel = texto(markup);
    expect(visivel).toContain("Alguns números não carregaram");
    expect(visivel).toContain("Tentar de novo");
    expect(visivel).toContain("Não foi possível carregar o funil de leads");
    expect(visivel).toContain("Último disparo 09:02");
  });
});
