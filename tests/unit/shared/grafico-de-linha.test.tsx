import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GraficoDeLinha,
  escalaDoEixoY,
  indicesDoEixoX,
  type GraficoDeLinhaProps,
} from "@/components/shared/grafico-de-linha";

// Linha com marcadores de Resultados ("Leads x consultas agendadas"): duas
// series que nunca se distinguem so pela cor (marcador redondo contra
// quadrado, linha cheia contra tracejada, legenda escrita), cores so por
// token, resumo falado com total e pico, tabela sr-only com todos os pontos
// e estado sem dados escrito.

const ROTULOS = ["01/09", "02/09", "03/09", "04/09"];

const DUAS: GraficoDeLinhaProps = {
  titulo: "Leads x consultas agendadas",
  rotulos: ROTULOS,
  rotulosFalados: [
    "1 de setembro",
    "2 de setembro",
    "3 de setembro",
    "4 de setembro",
  ],
  series: [
    { nome: "Leads recebidos", valores: [3, 12, 7, 1] },
    { nome: "Consultas agendadas", valores: [1, 4, 6, 0] },
  ],
};

function html(props: GraficoDeLinhaProps): string {
  return renderToStaticMarkup(<GraficoDeLinha {...props} />);
}

function contar(markup: string, trecho: string): number {
  return markup.split(trecho).length - 1;
}

describe("GraficoDeLinha, duas séries", () => {
  const markup = html(DUAS);

  it("marcadores de forma diferente, um por ponto", () => {
    expect(contar(markup, 'data-marcador="circulo"')).toBe(4);
    expect(contar(markup, 'data-marcador="quadrado"')).toBe(4);
    expect(markup).toMatch(/data-marcador="circulo"[^>]*rounded-full/);
    expect(markup).toMatch(/data-marcador="quadrado"[^>]*rounded-\[1px\]/);
    expect(markup).not.toMatch(/data-marcador="quadrado"[^>]*rounded-full/);
  });

  it("traço diferente: a 2ª série é tracejada, a 1ª não", () => {
    const linhas = [...markup.matchAll(/<polyline[^>]*>/g)].map((m) => m[0]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).not.toContain("stroke-dasharray");
    expect(linhas[1]).toContain('stroke-dasharray="6 4"');
    expect(linhas[0]).toContain('vector-effect="non-scaling-stroke"');
  });

  it("cores só por token, nunca hex", () => {
    expect(markup).toContain("var(--chart-bar)");
    expect(markup).toContain("var(--chart-bar-muted)");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(markup).not.toMatch(/rgba?\(/);
  });

  it("legenda escrita com a forma de cada série", () => {
    expect(markup).toMatch(
      /data-legenda="circulo"[\s\S]*?Leads recebidos<\/li>/,
    );
    expect(markup).toMatch(
      /data-legenda="quadrado"[\s\S]*?Consultas agendadas<\/li>/,
    );
  });

  it("role=img com resumo de período, total e pico", () => {
    expect(markup).toContain(
      'role="img" aria-label="Leads x consultas agendadas, de 1 de setembro a 4 de setembro. Leads recebidos: 23 no total, pico de 12 em 2 de setembro. Consultas agendadas: 11 no total, pico de 6 em 3 de setembro."',
    );
  });

  it("tabela sr-only com todos os pontos", () => {
    const tabela = markup.slice(markup.indexOf('<table class="sr-only">'));
    expect(tabela).toContain("<caption>Leads x consultas agendadas</caption>");
    expect(tabela).toContain('<th scope="col">Dia</th>');
    expect(tabela).toContain('<th scope="col">Consultas agendadas</th>');
    expect(contar(tabela, '<th scope="row">')).toBe(4);
    expect(tabela).toContain(
      '<th scope="row">2 de setembro</th><td>12</td><td>4</td>',
    );
  });

  it("responsivo: viewBox esticado e largura cheia", () => {
    expect(markup).toContain('viewBox="0 0 100 100"');
    expect(markup).toContain('preserveAspectRatio="none"');
    expect(markup).toContain("size-full");
  });

  it("dica nativa por dia com os valores", () => {
    expect(markup).toContain(
      'title="3 de setembro: Leads recebidos 7, Consultas agendadas 6"',
    );
  });

  it("sem travessão", () => {
    expect(markup).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("GraficoDeLinha, empate entre as séries", () => {
  it("no empate o quadrado é maior que o círculo, e as duas formas aparecem", () => {
    const markup = html({
      ...DUAS,
      rotulos: ["01/09", "02/09"],
      rotulosFalados: ["1 de setembro", "2 de setembro"],
      series: [
        { nome: "Leads recebidos", valores: [3, 1] },
        { nome: "Consultas agendadas", valores: [3, 0] },
      ],
    });
    const quadrado = markup.match(/<span[^>]*data-marcador="quadrado"[^>]*>/)?.[0] ?? "";
    const circulo = markup.match(/<span[^>]*data-marcador="circulo"[^>]*>/)?.[0] ?? "";
    expect(quadrado).toContain("size-3");
    expect(circulo).toContain("size-2");
    expect(circulo).not.toContain("size-3");
    // os dois no mesmo ponto do dia 1
    expect(quadrado).toMatch(/left:0%;top:0%/);
    expect(circulo).toMatch(/left:0%;top:0%/);
  });
});

describe("GraficoDeLinha, uma série e casos de borda", () => {
  it("uma série: só marcador redondo e linha cheia", () => {
    const markup = html({
      titulo: "Leads",
      rotulos: ROTULOS,
      series: [{ nome: "Leads recebidos", valores: [1, 2, 3, 4] }],
    });
    expect(contar(markup, 'data-marcador="circulo"')).toBe(4);
    expect(markup).not.toContain('data-marcador="quadrado"');
    expect(markup).not.toContain("stroke-dasharray");
  });

  it("um ponto só fica no meio e o resumo diz o dia", () => {
    const markup = html({
      titulo: "Leads",
      rotulos: ["01/09"],
      series: [{ nome: "Leads recebidos", valores: [5] }],
    });
    expect(markup).toContain("left:50%");
    expect(markup).toContain("Leads, em 01/09.");
  });

  it("série zerada ao lado de outra com dado diz 0 no total", () => {
    const markup = html({
      titulo: "T",
      rotulos: ["01/09", "02/09"],
      series: [
        { nome: "A", valores: [1, 2] },
        { nome: "B", valores: [0, 0] },
      ],
    });
    expect(markup).toContain("B: 0 no total.");
  });
});

describe("GraficoDeLinha, sem dados", () => {
  it("nenhum ponto: texto escrito, sem eixo nem role=img", () => {
    const markup = html({
      titulo: "T",
      rotulos: [],
      series: [{ nome: "A", valores: [] }],
    });
    expect(markup).toContain('data-estado="vazio"');
    expect(markup).toContain("Sem dados no período");
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("<svg");
  });

  it("tudo zero também é vazio, com o texto da tela", () => {
    const markup = html({
      titulo: "T",
      rotulos: ["01/09", "02/09"],
      series: [
        { nome: "A", valores: [0, 0] },
        { nome: "B", valores: [0, 0] },
      ],
      textoVazio: "Nenhum lead no período",
    });
    expect(markup).toContain("Nenhum lead no período");
    expect(markup).not.toContain('role="img"');
  });
});

describe("eixos", () => {
  it("escala do Y com topo e passo redondos, sem fração em contagem", () => {
    expect(escalaDoEixoY(31)).toEqual({
      topo: 40,
      marcas: [0, 10, 20, 30, 40],
    });
    expect(escalaDoEixoY(7)).toEqual({ topo: 8, marcas: [0, 2, 4, 6, 8] });
    expect(escalaDoEixoY(3)).toEqual({ topo: 3, marcas: [0, 1, 2, 3] });
    expect(escalaDoEixoY(1)).toEqual({ topo: 1, marcas: [0, 1] });
    expect(escalaDoEixoY(0)).toEqual({ topo: 1, marcas: [0, 1] });
  });

  it("rótulos do X esparsos, sempre com o primeiro e o último", () => {
    expect(indicesDoEixoX(4)).toEqual([0, 1, 2, 3]);
    expect(indicesDoEixoX(30)).toEqual([0, 5, 10, 15, 19, 24, 29]);
    const noventa = indicesDoEixoX(90);
    expect(noventa).toHaveLength(7);
    expect(noventa[0]).toBe(0);
    expect(noventa.at(-1)).toBe(89);
    expect(indicesDoEixoX(0)).toEqual([]);
    expect(indicesDoEixoX(1)).toEqual([0]);
  });

  it("abaixo de lg esconde metade dos rótulos quando há 7", () => {
    const markup = html({
      titulo: "T",
      rotulos: Array.from({ length: 30 }, (_, i) => `${i + 1}/09`),
      series: [{ nome: "A", valores: Array.from({ length: 30 }, () => 1) }],
    });
    expect(contar(markup, "max-lg:hidden")).toBe(3);
  });
});
