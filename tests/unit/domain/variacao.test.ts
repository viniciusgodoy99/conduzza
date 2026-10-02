import { describe, expect, it } from "vitest";

import { descreverVariacao, variacaoPercentual } from "@/lib/domain/variacao";

// A variacao do cartao de metrica unico: o arredondamento vem antes do
// sentido (nunca "+0,0%" verde), base zero nao vira infinito, a cor segue a
// polaridade e a frase falada diz contra o que se compara.

const VS = "período anterior";

describe("variacaoPercentual", () => {
  it("mantém a semântica do cartao-kpi", () => {
    expect(variacaoPercentual(120, 100)).toBe(20);
    expect(variacaoPercentual(80, 100)).toBe(-20);
    expect(variacaoPercentual(4, 0)).toBeNull();
    expect(variacaoPercentual(4, -1)).toBeNull();
  });
});

describe("descreverVariacao", () => {
  it("percentual com 1 casa, sinal e frase falada", () => {
    expect(
      descreverVariacao({ atual: 1124, anterior: 1000, comparadoCom: VS }),
    ).toEqual({
      semBase: false,
      sentido: "subiu",
      visivel: "+12,4%",
      falado: "subiu 12,4% vs. período anterior",
      boa: true,
    });
  });

  it("queda com sinal ASCII e cor ruim em maior-melhor", () => {
    const descrita = descreverVariacao({
      atual: 939,
      anterior: 1000,
      comparadoCom: "mesmo dia da semana passada",
    });
    expect(descrita).toMatchObject({
      sentido: "caiu",
      visivel: "-6,1%",
      falado: "caiu 6,1% vs. mesmo dia da semana passada",
      boa: false,
    });
  });

  it("menor-melhor: cair é bom, subir é ruim", () => {
    expect(
      descreverVariacao({
        atual: 939,
        anterior: 1000,
        comparadoCom: VS,
        polaridade: "menor-melhor",
      }),
    ).toMatchObject({ sentido: "caiu", boa: true });
    expect(
      descreverVariacao({
        atual: 1100,
        anterior: 1000,
        comparadoCom: VS,
        polaridade: "menor-melhor",
      }),
    ).toMatchObject({ sentido: "subiu", boa: false });
  });

  it("arredonda antes de decidir: 0,04% é estável e neutro", () => {
    expect(
      descreverVariacao({ atual: 10004, anterior: 10000, comparadoCom: VS }),
    ).toEqual({
      semBase: false,
      sentido: "estavel",
      visivel: "0,0%",
      falado: "estável vs. período anterior",
      boa: null,
    });
    expect(
      descreverVariacao({ atual: 9996, anterior: 10000, comparadoCom: VS }),
    ).toMatchObject({ sentido: "estavel", visivel: "0,0%", boa: null });
  });

  it("0,05% arredonda para 0,1% e passa a ter sentido", () => {
    expect(
      descreverVariacao({ atual: 10005, anterior: 10000, comparadoCom: VS }),
    ).toMatchObject({ sentido: "subiu", visivel: "+0,1%" });
  });

  it("arredonda o meio para longe do zero nos dois sentidos", () => {
    expect(
      descreverVariacao({ atual: 112.45, anterior: 100, comparadoCom: VS }),
    ).toMatchObject({ visivel: "+12,5%" });
    expect(
      descreverVariacao({ atual: 87.55, anterior: 100, comparadoCom: VS }),
    ).toMatchObject({ visivel: "-12,5%" });
  });

  it("igual à base é estável", () => {
    expect(
      descreverVariacao({ atual: 50, anterior: 50, comparadoCom: VS }),
    ).toMatchObject({ sentido: "estavel", boa: null });
  });

  it("base zero: sem base de comparação, sem sentido nem cor", () => {
    expect(
      descreverVariacao({ atual: 4, anterior: 0, comparadoCom: VS }),
    ).toEqual({
      semBase: true,
      texto: "sem base de comparação (vs. período anterior)",
    });
    expect(
      descreverVariacao({
        atual: 34,
        anterior: 0,
        comparadoCom: "30 dias atrás",
        formato: "absoluto",
      }),
    ).toMatchObject({ semBase: true });
  });

  it("valor não finito não vira número", () => {
    expect(
      descreverVariacao({ atual: Number.NaN, anterior: 10, comparadoCom: VS }),
    ).toMatchObject({ semBase: true });
  });

  it("absoluto: diferença em unidades, sem %", () => {
    expect(
      descreverVariacao({
        atual: 1248,
        anterior: 1214,
        comparadoCom: "30 dias atrás",
        formato: "absoluto",
      }),
    ).toEqual({
      semBase: false,
      sentido: "subiu",
      visivel: "+34",
      falado: "subiu 34 vs. 30 dias atrás",
      boa: true,
    });
    expect(
      descreverVariacao({
        atual: 1000,
        anterior: 2234,
        comparadoCom: "30 dias atrás",
        formato: "absoluto",
      }),
    ).toMatchObject({ visivel: "-1.234", sentido: "caiu" });
    expect(
      descreverVariacao({
        atual: 10,
        anterior: 10,
        comparadoCom: "30 dias atrás",
        formato: "absoluto",
      }),
    ).toMatchObject({ visivel: "0", sentido: "estavel", boa: null });
  });

  it("nenhum texto usa travessão", () => {
    const descrita = descreverVariacao({
      atual: 50,
      anterior: 100,
      comparadoCom: VS,
    });
    expect(JSON.stringify(descrita)).not.toMatch(/[\u2014\u2013\u2212]/);
  });
});
