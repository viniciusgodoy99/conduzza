import { describe, expect, it } from "vitest";

import {
  ANUNCIO_NAO_IDENTIFICADO,
  ANUNCIO_SEM,
  CAMPANHA_SEM,
  chaveDaCampanhaDoLead,
  chaveDoAnuncioDoLead,
  ehChaveDeAnuncio,
  ehChaveDeCampanha,
  ehLeadDeAnuncioComoResultados,
  hrefDaListaDeLeads,
  indexarMapaDeAtribuicao,
  nomeDoLinkDaLista,
  opcoesDeAnuncio,
  opcoesDeCampanha,
  ORIGEM_SEM_ATRIBUICAO,
  ROTULO_ANUNCIO_NAO_IDENTIFICADO,
  ROTULO_ANUNCIO_NAO_RECONHECIDO,
  ROTULO_CAMPANHA_NAO_RECONHECIDA,
  ROTULO_SEM_ANUNCIO,
  ROTULO_SEM_CAMPANHA,
  rotuloDaCampanhaDaChave,
  rotuloDoAnuncioDaChave,
  textoDaCampanhaComoResultados,
  type AnuncioDoMapa,
  type AtribuicaoDoLead,
  type MapaDeAtribuicaoLido,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  filtrarLeads,
  filtrosDeLeadsDosValores,
  textoDaContagemDeLeads,
  type LeadFiltravel,
  type ValoresDosFiltrosDeLeads,
} from "@/lib/domain/leads-ui";

// Campanha e anuncio de um lead COMO RESULTADOS CONTA (pedido do dono em
// 20/10/2026): as chaves reproduzem campanhas_do_periodo (an = ad_id exato,
// cr = campanhas conhecidas da clinica, btrim so do espaco) e
// anuncios_do_periodo (o id aparado como no JavaScript, de_anuncio largo).
// Aqui, os casos dificeis um a um; a prova contra o banco e
// tests/rls/filtro-por-campanha-e-anuncio.test.ts.

const AD_1 = "120240000000000001";
const AD_2 = "120240000000000002";
const AD_SO_NA_META = "120240000000000003";
const AD_FORA_DO_MAPA = "120240000000000099";
const CAMPANHA_1 = "900000000000000001";
const CAMPANHA_2 = "900000000000000002";
const CAMPANHA_DESCONHECIDA = "900000000000000777";

function anuncio(campos: Partial<AnuncioDoMapa> & { ad_id: string }): AnuncioDoMapa {
  return {
    campaign_id: CAMPANHA_1,
    campaign_name: null,
    ad_name: null,
    ultimo_dia_com_entrega: "2026-10-10",
    atualizado_em: "2026-10-10T12:00:00+00:00",
    ...campos,
  };
}

const LIDO: MapaDeAtribuicaoLido = {
  anuncios: [
    anuncio({
      ad_id: AD_1,
      campaign_name: "Botox Outubro",
      ad_name: "Botox outubro, criativo 1",
    }),
    anuncio({ ad_id: AD_2, campaign_id: CAMPANHA_2, campaign_name: "Limpeza" }),
    anuncio({
      ad_id: AD_SO_NA_META,
      campaign_id: CAMPANHA_2,
      campaign_name: "Limpeza",
      ad_name: "Limpeza na Meta",
    }),
  ],
  titulos: [{ ad_id: AD_1, titulo: "Botox com 20% de desconto" }],
};
const MAPA = indexarMapaDeAtribuicao(LIDO);

function lead(campos: AtribuicaoDoLead = {}): AtribuicaoDoLead {
  return {
    source_campaign: null,
    source_campaign_id: null,
    source_ad_id: null,
    source_adset_id: null,
    source_method: null,
    com_ctwa_clid: false,
    ...campos,
  };
}

describe("chave da campanha (campanhas_do_periodo)", () => {
  const casos: [string, AtribuicaoDoLead, string][] = [
    [
      "anúncio com o id exato: a campanha do anúncio na Meta",
      lead({ source_ad_id: AD_1, com_ctwa_clid: true, source_method: "anuncio_ctwa" }),
      `meta:${CAMPANHA_1}`,
    ],
    [
      "id do anúncio com espaço nas pontas: o an do SQL não apara, então não casa",
      lead({ source_ad_id: ` ${AD_1} ` }),
      CAMPANHA_SEM,
    ],
    [
      "id com NBSP e tabulação: também não casa pelo anúncio",
      lead({ source_ad_id: ` ${AD_1}\t` }),
      CAMPANHA_SEM,
    ],
    [
      "id com NBSP e o id de campanha conhecido: casa pela campanha (cr)",
      lead({ source_ad_id: ` ${AD_1}\t`, source_campaign_id: CAMPANHA_2 }),
      `meta:${CAMPANHA_2}`,
    ],
    [
      "id do anúncio com letra: não casa",
      lead({ source_ad_id: "12024000000000000a" }),
      CAMPANHA_SEM,
    ],
    ["só o clique: sem campanha", lead({ com_ctwa_clid: true }), CAMPANHA_SEM],
    [
      "só o id do conjunto: sem campanha",
      lead({ source_adset_id: "238500000000000001" }),
      CAMPANHA_SEM,
    ],
    [
      "só o id da campanha, conhecido no mapa da clínica",
      lead({ source_campaign_id: CAMPANHA_1 }),
      `meta:${CAMPANHA_1}`,
    ],
    [
      "só o id da campanha, desconhecido: sem campanha",
      lead({ source_campaign_id: CAMPANHA_DESCONHECIDA }),
      CAMPANHA_SEM,
    ],
    [
      "id da campanha desconhecido e texto: vale o texto",
      lead({ source_campaign_id: CAMPANHA_DESCONHECIDA, source_campaign: "Promo" }),
      "texto:Promo",
    ],
    [
      "anúncio fora do mapa (Meta ainda não leu): sem campanha",
      lead({ source_ad_id: AD_FORA_DO_MAPA, com_ctwa_clid: true }),
      CAMPANHA_SEM,
    ],
    [
      "texto com espaço nas pontas: o btrim tira só o espaço",
      lead({ source_campaign: "  Promo de outubro  " }),
      "texto:Promo de outubro",
    ],
    [
      "texto com tabulação na ponta: o btrim sem lista não tira",
      lead({ source_campaign: "\tPromo" }),
      "texto:\tPromo",
    ],
    [
      "texto com NBSP na ponta: também fica",
      lead({ source_campaign: " Promo" }),
      "texto: Promo",
    ],
    ["texto só de espaços: sem campanha", lead({ source_campaign: "   " }), CAMPANHA_SEM],
    ["texto vazio: sem campanha", lead({ source_campaign: "" }), CAMPANHA_SEM],
    [
      "texto e Meta juntos: a Meta vence",
      lead({ source_ad_id: AD_1, source_campaign: "Promo" }),
      `meta:${CAMPANHA_1}`,
    ],
    [
      "lead do clique no site (Google): sem campanha, como no SQL",
      lead({ source_method: "clique_site" }),
      CAMPANHA_SEM,
    ],
    ["nada: sem campanha", lead(), CAMPANHA_SEM],
    ["campo ausente vale nulo", {}, CAMPANHA_SEM],
  ];
  for (const [nome, contato, chave] of casos) {
    it(nome, () => {
      expect(chaveDaCampanhaDoLead(contato, MAPA)).toBe(chave);
    });
  }

  it("o texto como o SQL agrupa: nullif(btrim(texto), '')", () => {
    expect(textoDaCampanhaComoResultados(null)).toBeNull();
    expect(textoDaCampanhaComoResultados(undefined)).toBeNull();
    expect(textoDaCampanhaComoResultados("")).toBeNull();
    expect(textoDaCampanhaComoResultados("    ")).toBeNull();
    expect(textoDaCampanhaComoResultados(" a b ")).toBe("a b");
    expect(textoDaCampanhaComoResultados("　a　")).toBe("　a　");
    expect(textoDaCampanhaComoResultados(` ${" ".repeat(50_000)}x`)).toBe("x");
  });
});

describe("chave do anúncio (anuncios_do_periodo)", () => {
  const casos: [string, AtribuicaoDoLead, string][] = [
    ["id exato", lead({ source_ad_id: AD_1 }), AD_1],
    ["id com espaço nas pontas: aparado", lead({ source_ad_id: ` ${AD_1} ` }), AD_1],
    [
      "id com NBSP e tabulação: aparado (a regra do JavaScript)",
      lead({ source_ad_id: ` ${AD_1}\t` }),
      AD_1,
    ],
    [
      "id com os espaços Unicode do String.trim (BOM, U+3000, U+2028, U+205F)",
      lead({ source_ad_id: `﻿　${AD_1}  ` }),
      AD_1,
    ],
    [
      "U+180E não é espaço para o JavaScript (nem para a lista do SQL)",
      lead({ source_ad_id: `᠎${AD_1}` }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "id com letra: lead de anúncio sem id válido",
      lead({ source_ad_id: "12024000000000000a" }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "id com 33 dígitos: fora do formato",
      lead({ source_ad_id: "1".repeat(33) }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    ["id vazio: não nulo, conta como anúncio", lead({ source_ad_id: "" }), ANUNCIO_NAO_IDENTIFICADO],
    ["só o clique", lead({ com_ctwa_clid: true }), ANUNCIO_NAO_IDENTIFICADO],
    [
      "só o id do conjunto",
      lead({ source_adset_id: "238500000000000001" }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "só o id da campanha conhecido",
      lead({ source_campaign_id: CAMPANHA_1 }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "só o id da campanha desconhecido",
      lead({ source_campaign_id: CAMPANHA_DESCONHECIDA }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "só o método anuncio_ctwa",
      lead({ source_method: "anuncio_ctwa" }),
      ANUNCIO_NAO_IDENTIFICADO,
    ],
    [
      "anúncio fora do mapa: a linha do próprio id",
      lead({ source_ad_id: AD_FORA_DO_MAPA }),
      AD_FORA_DO_MAPA,
    ],
    ["texto de campanha não é anúncio", lead({ source_campaign: "Promo" }), ANUNCIO_SEM],
    ["lead do Google: sem anúncio da Meta", lead({ source_method: "clique_site" }), ANUNCIO_SEM],
    ["nada", lead(), ANUNCIO_SEM],
    ["campo ausente vale nulo", {}, ANUNCIO_SEM],
  ];
  for (const [nome, contato, chave] of casos) {
    it(nome, () => {
      expect(chaveDoAnuncioDoLead(contato)).toBe(chave);
    });
  }

  it("lead de anúncio: mais largo que o de campanhas (conjunto e método contam)", () => {
    expect(ehLeadDeAnuncioComoResultados(lead({ source_adset_id: "1" }))).toBe(true);
    expect(ehLeadDeAnuncioComoResultados(lead({ source_method: "anuncio_ctwa" }))).toBe(true);
    expect(ehLeadDeAnuncioComoResultados(lead({ source_method: "manual" }))).toBe(false);
  });
});

describe("mapa da clínica", () => {
  it("o nome da campanha é o da linha mais recente: dia com entrega, depois atualização, depois o menor id", () => {
    const mapa = indexarMapaDeAtribuicao({
      anuncios: [
        anuncio({
          ad_id: "3",
          campaign_name: "Nome de setembro",
          ultimo_dia_com_entrega: "2026-09-30",
          atualizado_em: "2026-10-15T00:00:00+00:00",
        }),
        anuncio({ ad_id: "2", campaign_name: "Nome de outubro", ultimo_dia_com_entrega: "2026-10-10" }),
        anuncio({ ad_id: "1", campaign_name: "Sem entrega lida", ultimo_dia_com_entrega: null }),
      ],
      titulos: [],
    });
    expect(mapa.campanhas.get(CAMPANHA_1)).toBe("Nome de outubro");
  });

  it("empate no dia: a atualização mais nova vence, até o microssegundo", () => {
    const mapa = indexarMapaDeAtribuicao({
      anuncios: [
        anuncio({ ad_id: "1", campaign_name: "Antes", atualizado_em: "2026-10-10T12:00:00.123456+00:00" }),
        anuncio({ ad_id: "2", campaign_name: "Depois", atualizado_em: "2026-10-10T12:00:00.123457+00:00" }),
      ],
      titulos: [],
    });
    expect(mapa.campanhas.get(CAMPANHA_1)).toBe("Depois");
  });

  it("empate em tudo: o menor ad_id; e o nome nulo da linha escolhida fica nulo", () => {
    const mapa = indexarMapaDeAtribuicao({
      anuncios: [
        anuncio({ ad_id: "20", campaign_name: "Do maior id" }),
        anuncio({ ad_id: "10", campaign_name: null }),
      ],
      titulos: [],
    });
    expect(mapa.campanhas.has(CAMPANHA_1)).toBe(true);
    expect(mapa.campanhas.get(CAMPANHA_1)).toBeNull();
    expect(rotuloDaCampanhaDaChave(`meta:${CAMPANHA_1}`, mapa)).toBe(
      `Campanha ${CAMPANHA_1}`,
    );
  });

  it("o anúncio guarda a campanha e o nome na Meta; o título vem de anuncio_do_whatsapp", () => {
    expect(MAPA.anuncios.get(AD_2)).toEqual({ campaignId: CAMPANHA_2, nomeNaMeta: null });
    expect(MAPA.titulos.get(AD_1)).toBe("Botox com 20% de desconto");
  });
});

describe("valores válidos e rótulos", () => {
  it("campanha: sem, meta:<id> ou texto:<texto>", () => {
    for (const valido of [CAMPANHA_SEM, `meta:${CAMPANHA_1}`, "texto:Promo", "texto: a "]) {
      expect(ehChaveDeCampanha(valido), valido).toBe(true);
    }
    for (const invalido of ["", "abc", "meta:", "meta:12a", `meta:${"1".repeat(33)}`, "texto:", "Sem"]) {
      expect(ehChaveDeCampanha(invalido), invalido).toBe(false);
    }
  });

  it("anúncio: o id, nao_identificado ou sem", () => {
    for (const valido of [AD_1, ANUNCIO_NAO_IDENTIFICADO, ANUNCIO_SEM]) {
      expect(ehChaveDeAnuncio(valido), valido).toBe(true);
    }
    for (const invalido of ["", "12a", "1".repeat(33), ` ${AD_1}`, "meta:1"]) {
      expect(ehChaveDeAnuncio(invalido), invalido).toBe(false);
    }
  });

  it("rótulos de campanha: nome na Meta, Campanha {id}, o texto, Sem campanha e o de reserva", () => {
    expect(rotuloDaCampanhaDaChave(`meta:${CAMPANHA_1}`, MAPA)).toBe("Botox Outubro");
    expect(rotuloDaCampanhaDaChave(`meta:${CAMPANHA_DESCONHECIDA}`, MAPA)).toBe(
      `Campanha ${CAMPANHA_DESCONHECIDA}`,
    );
    expect(rotuloDaCampanhaDaChave(`meta:${CAMPANHA_1}`, null)).toBe(`Campanha ${CAMPANHA_1}`);
    expect(rotuloDaCampanhaDaChave("texto:Promo de outubro", MAPA)).toBe("Promo de outubro");
    expect(rotuloDaCampanhaDaChave(CAMPANHA_SEM, MAPA)).toBe(ROTULO_SEM_CAMPANHA);
    expect(rotuloDaCampanhaDaChave("abc", MAPA)).toBe(ROTULO_CAMPANHA_NAO_RECONHECIDA);
  });

  it("rótulos de anúncio: título, nome na Meta, sem título com o id, os restos e o de reserva", () => {
    expect(rotuloDoAnuncioDaChave(AD_1, MAPA)).toBe("Botox com 20% de desconto");
    expect(rotuloDoAnuncioDaChave(AD_SO_NA_META, MAPA)).toBe("Limpeza na Meta");
    expect(rotuloDoAnuncioDaChave(AD_FORA_DO_MAPA, MAPA)).toBe(
      `Anúncio sem título (id ${AD_FORA_DO_MAPA})`,
    );
    expect(rotuloDoAnuncioDaChave(ANUNCIO_NAO_IDENTIFICADO, MAPA)).toBe(
      ROTULO_ANUNCIO_NAO_IDENTIFICADO,
    );
    expect(rotuloDoAnuncioDaChave(ANUNCIO_SEM, MAPA)).toBe(ROTULO_SEM_ANUNCIO);
    expect(rotuloDoAnuncioDaChave("12a", MAPA)).toBe(ROTULO_ANUNCIO_NAO_RECONHECIDO);
  });
});

describe("opções dos filtros", () => {
  const LEADS: AtribuicaoDoLead[] = [
    lead({ source_ad_id: AD_1 }),
    lead({ source_ad_id: AD_1 }),
    lead({ source_ad_id: AD_1 }),
    lead({ source_ad_id: AD_2 }),
    lead({ source_campaign: "Promo" }),
    lead({ source_campaign: "Promo" }),
    lead({ com_ctwa_clid: true }),
    lead(),
    lead(),
    lead(),
    lead(),
  ];

  it("campanha: mais leads primeiro e Sem campanha no fim, mesmo com mais leads", () => {
    expect(opcoesDeCampanha(LEADS, MAPA, "")).toEqual([
      { value: `meta:${CAMPANHA_1}`, label: "Botox Outubro" },
      { value: "texto:Promo", label: "Promo" },
      { value: `meta:${CAMPANHA_2}`, label: "Limpeza" },
      { value: CAMPANHA_SEM, label: ROTULO_SEM_CAMPANHA },
    ]);
  });

  it("campanha da URL fora dos carregados entra com o rótulo de reserva", () => {
    const comMetaForaDaLista = opcoesDeCampanha(LEADS, MAPA, `meta:${CAMPANHA_DESCONHECIDA}`);
    expect(comMetaForaDaLista).toContainEqual({
      value: `meta:${CAMPANHA_DESCONHECIDA}`,
      label: `Campanha ${CAMPANHA_DESCONHECIDA}`,
    });
    expect(comMetaForaDaLista.at(-1)?.value).toBe(CAMPANHA_SEM);
    const comTexto = opcoesDeCampanha([], MAPA, "texto:Black Friday");
    expect(comTexto).toEqual([{ value: "texto:Black Friday", label: "Black Friday" }]);
    const malFormado = opcoesDeCampanha(LEADS, MAPA, "abc");
    expect(malFormado.at(-1)).toEqual({ value: "abc", label: ROTULO_CAMPANHA_NAO_RECONHECIDA });
  });

  it("sem o mapa (carregando ou erro): só o valor da URL", () => {
    expect(opcoesDeCampanha(LEADS, null, "")).toEqual([]);
    expect(opcoesDeCampanha(LEADS, null, `meta:${CAMPANHA_1}`)).toEqual([
      { value: `meta:${CAMPANHA_1}`, label: `Campanha ${CAMPANHA_1}` },
    ]);
  });

  it("duas campanhas com o mesmo rótulo: a da Meta ganha o id", () => {
    const mapa = indexarMapaDeAtribuicao({
      anuncios: [
        anuncio({ ad_id: AD_1, campaign_id: CAMPANHA_1, campaign_name: "Botox" }),
        anuncio({ ad_id: AD_2, campaign_id: CAMPANHA_2, campaign_name: "botox" }),
      ],
      titulos: [],
    });
    const opcoes = opcoesDeCampanha(
      [lead({ source_ad_id: AD_1 }), lead({ source_ad_id: AD_2 }), lead({ source_campaign: "Botox" })],
      mapa,
      "",
    );
    expect(opcoes.map((opcao) => opcao.label).sort()).toEqual(
      [`Botox (id ${CAMPANHA_1})`, `botox (id ${CAMPANHA_2})`, "Botox"].sort(),
    );
  });

  it("anúncio: mais leads primeiro, rótulos de Resultados e os restos no fim, na ordem de Resultados", () => {
    expect(opcoesDeAnuncio(LEADS, MAPA, "")).toEqual([
      { value: AD_1, label: "Botox com 20% de desconto" },
      { value: AD_2, label: `Anúncio sem título (id ${AD_2})` },
      { value: ANUNCIO_NAO_IDENTIFICADO, label: ROTULO_ANUNCIO_NAO_IDENTIFICADO },
      { value: ANUNCIO_SEM, label: ROTULO_SEM_ANUNCIO },
    ]);
  });

  it("anúncio: rótulo repetido ganha o id inteiro; valor da URL fora dos carregados entra", () => {
    const mapa = indexarMapaDeAtribuicao({
      anuncios: [],
      titulos: [
        { ad_id: AD_1, titulo: "Avaliação gratuita" },
        { ad_id: AD_2, titulo: "Avaliação gratuita" },
      ],
    });
    const opcoes = opcoesDeAnuncio(
      [lead({ source_ad_id: AD_1 }), lead({ source_ad_id: AD_2 })],
      mapa,
      AD_FORA_DO_MAPA,
    );
    expect(opcoes.map((opcao) => opcao.label)).toEqual([
      `Avaliação gratuita (id ${AD_1})`,
      `Avaliação gratuita (id ${AD_2})`,
      `Anúncio sem título (id ${AD_FORA_DO_MAPA})`,
    ]);
    expect(opcoesDeAnuncio([], mapa, "x").at(-1)).toEqual({
      value: "x",
      label: ROTULO_ANUNCIO_NAO_RECONHECIDO,
    });
  });
});

describe("filtros na URL e filtrarLeads", () => {
  const VAZIOS: ValoresDosFiltrosDeLeads = {
    etapa: "",
    origem: "",
    campanha: "",
    anuncio: "",
    resp: "",
    de: "",
    ate: "",
  };
  const FUSO = "America/Fortaleza";

  function filtravel(
    id: string,
    campos: Partial<LeadFiltravel> = {},
  ): LeadFiltravel & { id: string } {
    return {
      id,
      funnel_stage: "novo",
      source_channel: null,
      owner_user_id: null,
      first_contact_at: "2026-10-05T12:00:00.000Z",
      last_contact_at: null,
      ...lead(),
      ...campos,
    };
  }

  const BASE = [
    filtravel("meta", { source_channel: "trafego_pago", source_ad_id: AD_1, com_ctwa_clid: true }),
    filtravel("meta-com-espaco", { source_channel: "trafego_pago", source_ad_id: ` ${AD_1}` }),
    filtravel("texto", { source_channel: "indicacao", source_campaign: " Promo " }),
    filtravel("so-clique", { com_ctwa_clid: true }),
    filtravel("nada"),
    filtravel("fora-do-periodo", { source_ad_id: AD_1, first_contact_at: "2026-09-30T12:00:00.000Z" }),
  ];

  function ids(valores: Partial<ValoresDosFiltrosDeLeads>) {
    return filtrarLeads(
      BASE,
      filtrosDeLeadsDosValores({ ...VAZIOS, ...valores }, FUSO),
      MAPA,
    ).map((item) => item.id);
  }

  it("os valores da URL viram os filtros (vazio = sem filtro)", () => {
    const filtros = filtrosDeLeadsDosValores(
      { ...VAZIOS, campanha: `meta:${CAMPANHA_1}`, anuncio: ANUNCIO_SEM },
      FUSO,
    );
    expect(filtros.campanha).toBe(`meta:${CAMPANHA_1}`);
    expect(filtros.anuncio).toBe(ANUNCIO_SEM);
    const vazio = filtrosDeLeadsDosValores(VAZIOS, FUSO);
    expect(vazio.campanha).toBeUndefined();
    expect(vazio.anuncio).toBeUndefined();
  });

  it("Origem Sem atribuição é o canal nulo", () => {
    expect(ids({ origem: ORIGEM_SEM_ATRIBUICAO })).toEqual([
      "so-clique",
      "nada",
      "fora-do-periodo",
    ]);
    expect(ids({ origem: "trafego_pago" })).toEqual(["meta", "meta-com-espaco"]);
  });

  it("campanha e anúncio separam como Resultados, junto com o período", () => {
    const outubro = { de: "2026-10-01", ate: "2026-10-31" };
    expect(ids({ ...outubro, campanha: `meta:${CAMPANHA_1}` })).toEqual(["meta"]);
    expect(ids({ ...outubro, campanha: "texto:Promo" })).toEqual(["texto"]);
    expect(ids({ ...outubro, campanha: CAMPANHA_SEM })).toEqual([
      "meta-com-espaco",
      "so-clique",
      "nada",
    ]);
    expect(ids({ ...outubro, anuncio: AD_1 })).toEqual(["meta", "meta-com-espaco"]);
    expect(ids({ ...outubro, anuncio: ANUNCIO_NAO_IDENTIFICADO })).toEqual(["so-clique"]);
    expect(ids({ ...outubro, anuncio: ANUNCIO_SEM })).toEqual(["texto", "nada"]);
    expect(ids({ campanha: `meta:${CAMPANHA_1}` })).toEqual(["meta", "fora-do-periodo"]);
    // Valor fora do formato nao casa ninguem (a tela mostra o vazio).
    expect(ids({ campanha: "abc" })).toEqual([]);
  });

  it("o filtro de campanha sem o mapa lança (nunca filtra errado calado); o de anúncio não precisa dele", () => {
    expect(() =>
      filtrarLeads(BASE, filtrosDeLeadsDosValores({ ...VAZIOS, campanha: CAMPANHA_SEM }, FUSO)),
    ).toThrow();
    expect(
      filtrarLeads(BASE, filtrosDeLeadsDosValores({ ...VAZIOS, anuncio: AD_1 }, FUSO)).map(
        (item) => item.id,
      ),
    ).toEqual(["meta", "meta-com-espaco", "fora-do-periodo"]);
  });
});

describe("contagem ao lado da barra", () => {
  it("singular, plural, milhar e zero", () => {
    expect(textoDaContagemDeLeads(16)).toBe("16 leads");
    expect(textoDaContagemDeLeads(1)).toBe("1 lead");
    expect(textoDaContagemDeLeads(0)).toBe("Nenhum lead");
    expect(textoDaContagemDeLeads(1234)).toBe("1.234 leads");
  });

  it("com o teto da lista cortando, diz que é entre os carregados", () => {
    expect(textoDaContagemDeLeads(16, 1000)).toBe("16 leads entre os 1.000 carregados");
  });
});

describe("de Resultados para a lista", () => {
  const PERIODO = { diaDe: "2026-10-01", diaAte: "2026-10-20" };

  function parametros(href: string): URLSearchParams {
    const url = new URL(href, "https://conduzza.invalid");
    expect(url.pathname).toBe("/leads");
    return url.searchParams;
  }

  it("lista, o mesmo período e o filtro da linha", () => {
    const href = hrefDaListaDeLeads(PERIODO, { campo: "origem", valor: "trafego_pago" });
    expect(href).toBe("/leads?visao=lista&de=2026-10-01&ate=2026-10-20&origem=trafego_pago");
    const lidos = parametros(href);
    expect(lidos.get("visao")).toBe("lista");
    expect(lidos.get("de")).toBe("2026-10-01");
    expect(lidos.get("ate")).toBe("2026-10-20");
  });

  it("cada dimensão e os Sem, com a chave voltando inteira da URL", () => {
    const casos: [Parameters<typeof hrefDaListaDeLeads>[1], string, string][] = [
      [{ campo: "origem", valor: ORIGEM_SEM_ATRIBUICAO }, "origem", "sem_atribuicao"],
      [{ campo: "campanha", valor: `meta:${CAMPANHA_1}` }, "campanha", `meta:${CAMPANHA_1}`],
      [{ campo: "campanha", valor: "texto:Promo & cia #1 50%+" }, "campanha", "texto:Promo & cia #1 50%+"],
      [{ campo: "campanha", valor: CAMPANHA_SEM }, "campanha", "sem"],
      [{ campo: "anuncio", valor: AD_1 }, "anuncio", AD_1],
      [{ campo: "anuncio", valor: ANUNCIO_NAO_IDENTIFICADO }, "anuncio", "nao_identificado"],
      [{ campo: "anuncio", valor: ANUNCIO_SEM }, "anuncio", "sem"],
    ];
    for (const [filtro, campo, valor] of casos) {
      const lidos = parametros(hrefDaListaDeLeads(PERIODO, filtro));
      expect(lidos.get(campo)).toBe(valor);
      // Um filtro so: o da linha.
      const outros = ["origem", "campanha", "anuncio"].filter((nome) => nome !== campo);
      for (const outro of outros) {
        expect(lidos.has(outro)).toBe(false);
      }
    }
  });

  it("o nome acessível diz o destino, com o rótulo que se vê", () => {
    expect(nomeDoLinkDaLista("Tráfego pago", 16)).toBe(
      "Ver os 16 leads de Tráfego pago na lista de Leads",
    );
    expect(nomeDoLinkDaLista("Indicação", 1)).toBe(
      "Ver o lead de Indicação na lista de Leads",
    );
    expect(nomeDoLinkDaLista("Sem campanha", 1500)).toBe(
      "Ver os 1.500 leads de Sem campanha na lista de Leads",
    );
    expect(nomeDoLinkDaLista("Tráfego pago", 16)).not.toMatch(/[–—]/);
  });
});
