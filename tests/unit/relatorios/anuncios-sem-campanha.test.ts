import { describe, expect, it } from "vitest";

import {
  ROTULO_PLATAFORMA_NAO_INFORMADA,
  TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA,
  anunciosSemCampanha,
  linhasDoCsv,
  montarExportavelDaAba,
  plataformasDosAnuncios,
  textoDasPlataformas,
  textoDosAnunciosSemCampanha,
  type EntradaDaExportacao,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AbaDeResultados,
  AnunciosDoPeriodo,
} from "@/lib/queries/relatorios";

import {
  ATENDIMENTO,
  CONVERSOES,
  FUNIL,
  agenda,
  anunciosDoPeriodo,
  campanhasDoPeriodo,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// Os anuncios no quadro Campanhas e a divisao por plataforma na Origem dos
// leads (pedido do dono de 26/10/2026: sem a conta da Meta, ver em
// Resultados o que o uazapi grava do anuncio: titulo, texto, link e
// plataforma). Regras puras e a exportacao.

/** O exemplo com a divisao em todos os anuncios (o terceiro nao tinha). */
function anunciosComDivisao(): AnunciosDoPeriodo {
  const anuncios = anunciosDoPeriodo();
  return {
    ...anuncios,
    linhas: anuncios.linhas.map((linha) =>
      linha.plataformas === null
        ? { ...linha, plataformas: [{ plataforma: null, leads: linha.leads }] }
        : linha,
    ),
  };
}

/** Sem nenhuma linha de campanha (o retrato da Salud Care sem a Meta). */
function semCampanhas(investimento: Parameters<typeof campanhasDoPeriodo>[0]) {
  return campanhasDoPeriodo(investimento, {
    linhas: [],
    leadsCasados: 0,
    leadsDeAnuncioSemCampanha: 162,
    leadsSemCampanha: 486,
  });
}

describe("textoDasPlataformas", () => {
  it("uma só: o nome (a coluna Leads já diz quantos); com a contagem pedida, o número", () => {
    expect(textoDasPlataformas([{ plataforma: "Instagram", leads: 25 }])).toBe(
      "Instagram",
    );
    expect(textoDasPlataformas([{ plataforma: null, leads: 3 }])).toBe(
      ROTULO_PLATAFORMA_NAO_INFORMADA,
    );
    expect(
      textoDasPlataformas([{ plataforma: "Instagram", leads: 51 }], {
        comContagem: true,
      }),
    ).toBe("Instagram 51");
  });

  it("mais de uma: cada uma com a contagem, na ordem recebida, com milhar do pt-BR", () => {
    expect(
      textoDasPlataformas([
        { plataforma: "Instagram", leads: 1200 },
        { plataforma: null, leads: 8 },
      ]),
    ).toBe("Instagram 1.200 · Não informada 8");
  });

  it("sem a divisão: null (a tela não inventa)", () => {
    expect(textoDasPlataformas(null)).toBeNull();
    expect(textoDasPlataformas([])).toBeNull();
  });
});

describe("plataformasDosAnuncios", () => {
  it("soma os anúncios e o grupo sem id, mais leads primeiro", () => {
    expect(plataformasDosAnuncios(anunciosComDivisao())).toEqual([
      { plataforma: "Instagram", leads: 92 },
      { plataforma: "Facebook", leads: 55 },
      { plataforma: null, leads: 15 },
    ]);
  });

  it("empate: pelo nome, e a não informada por último", () => {
    const base = anunciosComDivisao();
    expect(
      plataformasDosAnuncios({
        ...base,
        linhas: [
          {
            ...base.linhas[0]!,
            leads: 9,
            plataformas: [
              { plataforma: null, leads: 3 },
              { plataforma: "Instagram", leads: 3 },
              { plataforma: "Facebook", leads: 3 },
            ],
          },
        ],
        naoIdentificado: { ...base.naoIdentificado, leads: 0, plataformas: [] },
      }),
    ).toEqual([
      { plataforma: "Facebook", leads: 3 },
      { plataforma: "Instagram", leads: 3 },
      { plataforma: null, leads: 3 },
    ]);
  });

  it("uma parte sem a divisão, nenhum lead de anúncio ou sem os anúncios: null", () => {
    expect(plataformasDosAnuncios(anunciosDoPeriodo())).toBeNull();
    expect(plataformasDosAnuncios(undefined)).toBeNull();
    expect(
      plataformasDosAnuncios({
        leads: 10,
        linhas: [],
        naoIdentificado: {
          leads: 0,
          agendaram: 0,
          compareceram: 0,
          plataformas: [],
        },
        semAnuncio: { leads: 10, agendaram: 0, compareceram: 0 },
      }),
    ).toBeNull();
  });
});

describe("anunciosSemCampanha", () => {
  it("com linha de campanha: null (o quadro fica como antes)", () => {
    expect(
      anunciosSemCampanha(campanhasDoPeriodo(), anunciosDoPeriodo(), true),
    ).toBeNull();
  });

  it("sem os anúncios carregados ou sem lead de anúncio: null", () => {
    expect(
      anunciosSemCampanha(semCampanhas(null), undefined, false),
    ).toBeNull();
    expect(
      anunciosSemCampanha(
        semCampanhas(null),
        {
          leads: 10,
          linhas: [],
          naoIdentificado: {
            leads: 0,
            agendaram: 0,
            compareceram: 0,
            plataformas: [],
          },
          semAnuncio: { leads: 10, agendaram: 0, compareceram: 0 },
        },
        false,
      ),
    ).toBeNull();
  });

  it("sem campanha: um anúncio por linha, com os rótulos da dimensão Anúncio, a plataforma, o Ver anúncio e o filtro da lista", () => {
    const linhas = anunciosSemCampanha(
      semCampanhas(null),
      anunciosDoPeriodo(),
      false,
    );
    expect(linhas).toEqual([
      {
        chave: "120240624148610289",
        rotulo: "Limpeza de pele com 30% de desconto",
        plataforma: "Instagram 80 · Facebook 15 · Não informada 5",
        leads: 100,
        agendaram: 70,
        compareceram: 50,
        anuncio: {
          titulo: "Limpeza de pele com 30% de desconto",
          descricao: "Agende sua limpeza de pele.\nVagas limitadas.",
          link: "https://fb.me/limpeza-de-pele",
        },
        filtro: { campo: "anuncio", valor: "120240624148610289" },
      },
      {
        chave: "120240624148610290",
        rotulo: "Botox outubro",
        plataforma: "Facebook",
        leads: 40,
        agendaram: 30,
        compareceram: 20,
        anuncio: null,
        filtro: { campo: "anuncio", valor: "120240624148610290" },
      },
      {
        chave: "120240624148610291",
        rotulo: "Anúncio sem título (id 120240624148610291)",
        plataforma: ROTULO_PLATAFORMA_NAO_INFORMADA,
        leads: 10,
        agendaram: 5,
        compareceram: 3,
        anuncio: null,
        filtro: { campo: "anuncio", valor: "120240624148610291" },
      },
      {
        chave: "nao_identificado",
        rotulo: "Anúncio não identificado",
        plataforma: "Instagram",
        leads: 12,
        agendaram: 7,
        compareceram: 7,
        anuncio: null,
        filtro: { campo: "anuncio", valor: "nao_identificado" },
      },
    ]);
  });

  it("o Ver anúncio só com texto ou link que valem: o texto em branco some e o link que não é https do anúncio cai", () => {
    const base = anunciosDoPeriodo();
    const [linha] =
      anunciosSemCampanha(
        semCampanhas(null),
        {
          ...base,
          linhas: [
            {
              ...base.linhas[0]!,
              descricao: "  \n ",
              link: "javascript:alert(1)",
            },
          ],
        },
        false,
      ) ?? [];
    expect(linha?.anuncio).toBeNull();
  });

  it("a frase de cima: sem a conta da Meta (a gestão vê), a que explica; nos outros casos, a neutra", () => {
    expect(
      textoDosAnunciosSemCampanha(semCampanhas({ configurada: false })),
    ).toBe(TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA.semMeta);
    expect(textoDosAnunciosSemCampanha(semCampanhas(null))).toBe(
      TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA.semCampanha,
    );
    expect(textoDosAnunciosSemCampanha(semCampanhas({}))).toBe(
      TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA.semCampanha,
    );
    for (const texto of Object.values(TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA)) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});

describe("exportação: os anúncios no lugar do cabeçalho vazio de Campanhas", () => {
  function entrada(
    aba: AbaDeResultados,
    extra: Partial<EntradaDaExportacao>,
  ): EntradaDaExportacao {
    return {
      aba,
      podeVerValores: false,
      canalOficial: false,
      funil: { atual: FUNIL, anterior: null },
      agenda: { atual: agenda(null), anterior: null },
      atendimento: { atual: ATENDIMENTO, anterior: null },
      serie: [],
      linhaDeBase: null,
      objetivo: { percentual: 35.5, atualizadoEm: "2026-10-01T12:00:00Z" },
      conversoes: CONVERSOES,
      campanhas: campanhasPeriodizadas(null, {
        linhas: [],
        leadsCasados: 0,
        leadsDeAnuncioSemCampanha: 162,
        leadsSemCampanha: 486,
      }),
      timezone: "America/Fortaleza",
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
      ...extra,
    };
  }

  it.each(["geral", "marketing"] as const)(
    "%s: a frase, o cabeçalho dos anúncios e uma linha por anúncio, com as linhas de conferência",
    (aba) => {
      const linhas = linhasDoCsv(
        montarExportavelDaAba(entrada(aba, { anuncios: anunciosDoPeriodo() })),
      );
      const inicio = linhas.findIndex(
        (linha) => linha[0] === TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA.semCampanha,
      );
      expect(inicio).toBeGreaterThan(-1);
      expect(linhas.slice(inicio + 1, inicio + 6)).toEqual([
        ["Anúncio", "Plataforma", "Leads", "Agendados", "Compareceram"],
        [
          "Limpeza de pele com 30% de desconto",
          "Instagram 80 · Facebook 15 · Não informada 5",
          "100",
          "70",
          "50",
        ],
        ["Botox outubro", "Facebook", "40", "30", "20"],
        [
          "Anúncio sem título (id 120240624148610291)",
          "Não informada",
          "10",
          "5",
          "3",
        ],
        ["Anúncio não identificado", "Instagram", "12", "7", "7"],
      ]);
      const celulas = linhas.flat();
      expect(celulas).toContain("Leads sem campanha: 486 de 486");
      // O cabecalho das campanhas, sem nenhuma linha, nao sai.
      expect(linhas).not.toContainEqual([
        "Campanha",
        "Leads",
        "Agendados",
        "Conversão",
      ]);
    },
  );

  it("sem os anúncios (não carregados): o cabeçalho das campanhas, como antes", () => {
    const linhas = linhasDoCsv(montarExportavelDaAba(entrada("marketing", {})));
    expect(linhas).toContainEqual([
      "Campanha",
      "Leads",
      "Agendados",
      "Conversão",
    ]);
    expect(linhas.flat()).not.toContain(
      TEXTOS_DOS_ANUNCIOS_SEM_CAMPANHA.semCampanha,
    );
  });
});
