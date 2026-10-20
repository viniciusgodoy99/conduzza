import { beforeEach, describe, expect, it } from "vitest";

import {
  ANUNCIO_NAO_IDENTIFICADO,
  ANUNCIO_SEM,
  CAMPANHA_SEM,
  indexarMapaDeAtribuicao,
  ORIGEM_SEM_ATRIBUICAO,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  CARACTERES_DA_CAMPANHA_NA_TRILHA,
  corpoDoPedidoDeExportacao,
  detalhesDaTrilhaDaExportacao,
  filtrosDaExportacaoSchema,
  LIMITE_DA_CHAVE_DE_CAMPANHA,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
  mensagemAcimaDoTeto,
  TETO_DA_EXPORTACAO_DE_LEADS,
  valoresDaExportacao,
} from "@/lib/domain/exportacao-de-leads";
import {
  filtrarLeads,
  filtrosDeLeadsDosValores,
  type ValoresDosFiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import { exportarLeads } from "@/lib/queries/exportacao-de-leads";
import { fetchMapaDeAtribuicao, normalizarLead } from "@/lib/queries/leads";
import { parseCsv } from "@/lib/utils/csv";

import { SupabaseEmMemoria, type Linha } from "./supabase-em-memoria";

// A exportacao com os filtros novos da Tela 4 (campanha, anuncio e a Origem
// "Sem atribuição", pedido do dono em 20/10/2026), contra o PostgREST em
// memoria: o arquivo sai com os MESMOS leads da tela (o filtrarLeads da
// lista, com o mesmo mapa da clinica), o mapa e lido so da clinica ativa e
// so quando a campanha esta filtrada, o Zod e estrito nos dois campos, a
// trilha leva as duas chaves (nunca dado de paciente) e o teto avisa que
// conta antes de campanha e anuncio.

const FORTALEZA = "America/Fortaleza";
const CLINICA = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const EU = "a0000000-0000-4000-8000-000000000001";
const AGORA = new Date("2026-10-20T15:00:00.000Z");

const AD_1 = "120240000000000001";
const AD_2 = "120240000000000002";
const AD_DA_OUTRA = "120240000000000003";
const CAMPANHA_1 = "900000000000000001";
const CAMPANHA_2 = "900000000000000002";
const CAMPANHA_DO_AD_1_NA_OUTRA = "900000000000000008";
const CAMPANHA_SO_DA_OUTRA = "900000000000000009";

const VAZIOS: ValoresDosFiltrosDeLeads = {
  etapa: "",
  origem: "",
  campanha: "",
  anuncio: "",
  resp: "",
  de: "",
  ate: "",
};

let n = 0;

function contato(nome: string, campos: Partial<Linha> = {}): Linha {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    clinic_id: CLINICA,
    name: nome,
    phone_e164: `+55859${String(99000000 + n).padStart(8, "0")}`,
    kind: "lead",
    funnel_stage: "novo",
    lost_reason: null,
    lost_reason_note: null,
    owner_user_id: null,
    tags: [],
    source_channel: null,
    source_campaign: null,
    source_origin: null,
    source_medium: null,
    source_method: null,
    source_ad_id: null,
    source_google_campaign_id: null,
    source_campaign_id: null,
    source_adset_id: null,
    ctwa_clid: null,
    first_contact_at: "2026-10-05T12:00:00.000000+00:00",
    last_contact_at: null,
    insurance: null,
    contact_consent: [],
    ...campos,
  };
}

function meta(
  clinicId: string,
  adId: string,
  campaignId: string,
  campaignName: string,
): Linha {
  return {
    clinic_id: clinicId,
    ad_id: adId,
    campaign_id: campaignId,
    campaign_name: campaignName,
    ad_name: null,
    ultimo_dia_com_entrega: "2026-10-10",
    atualizado_em: "2026-10-10T12:00:00+00:00",
  };
}

function contatos(): Linha[] {
  n = 0;
  return [
    contato("Lead do anuncio 1", {
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_method: "anuncio_ctwa",
      source_ad_id: AD_1,
      ctwa_clid: "clid-1",
    }),
    contato("Lead do anuncio 1 com NBSP", {
      source_channel: "trafego_pago",
      source_ad_id: ` ${AD_1}\t`,
    }),
    contato("Lead do anuncio 2", { source_ad_id: AD_2 }),
    contato("Lead so com a campanha da outra clinica", {
      source_campaign_id: CAMPANHA_SO_DA_OUTRA,
    }),
    contato("Lead so com o clique", { ctwa_clid: "clid-solto" }),
    contato("Lead da promo", {
      source_channel: "indicacao",
      source_campaign: "  Promo de outubro ",
    }),
    contato("Lead do Google", {
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_method: "clique_site",
      source_google_campaign_id: "22334455",
    }),
    contato("Lead organico"),
    contato("Lead de setembro", {
      source_ad_id: AD_1,
      first_contact_at: "2026-09-20T12:00:00.000000+00:00",
    }),
    contato("Lead da outra clinica", {
      clinic_id: OUTRA_CLINICA,
      source_ad_id: AD_1,
    }),
  ];
}

let banco: SupabaseEmMemoria;

beforeEach(() => {
  banco = new SupabaseEmMemoria({
    contact: contatos(),
    funnel_stage_def: [
      { clinic_id: CLINICA, chave: "novo", nome: "Novo", posicao: 1 },
    ],
    meta_anuncio: [
      meta(CLINICA, AD_1, CAMPANHA_1, "Botox Outubro"),
      meta(CLINICA, AD_2, CAMPANHA_2, "Limpeza"),
      // A outra clinica da mesma pessoa: o mesmo anuncio em outra campanha,
      // e uma campanha que so ela conhece.
      meta(OUTRA_CLINICA, AD_1, CAMPANHA_DO_AD_1_NA_OUTRA, "Da outra"),
      meta(OUTRA_CLINICA, AD_DA_OUTRA, CAMPANHA_SO_DA_OUTRA, "Só da outra"),
    ],
    anuncio_do_whatsapp: [
      { clinic_id: CLINICA, ad_id: AD_1, titulo: "Botox com 20% de desconto" },
    ],
    audit_log: [],
  });
});

async function exportar(entrada: unknown) {
  return exportarLeads({
    supabase: banco.comoCliente(),
    sessao: { userId: EU, clinicId: CLINICA, role: "admin", timezone: FORTALEZA },
    clinicaDaTela: CLINICA,
    entrada,
    agora: AGORA,
  });
}

/** Os nomes do arquivo (coluna Nome), em ordem alfabetica. */
async function nomesExportados(entrada: Partial<ValoresDosFiltrosDeLeads>) {
  const resultado = await exportar(entrada);
  if (resultado.tipo === "vazio") {
    return [];
  }
  expect(resultado.tipo).toBe("arquivo");
  if (resultado.tipo !== "arquivo") {
    return [];
  }
  return parseCsv(resultado.conteudo)
    .linhas.slice(1)
    .map((linha) => linha[0] ?? "")
    .sort();
}

/** Os nomes que a TELA mostra com os mesmos valores (o filtrarLeads da lista). */
async function nomesNaTela(entrada: Partial<ValoresDosFiltrosDeLeads>) {
  const mapa = indexarMapaDeAtribuicao(
    await fetchMapaDeAtribuicao(banco.comoCliente(), CLINICA),
  );
  const daClinica = banco.tabelas.contact!
    .filter((linha) => linha.clinic_id === CLINICA)
    .map(normalizarLead);
  return filtrarLeads(
    daClinica,
    filtrosDeLeadsDosValores({ ...VAZIOS, ...entrada }, FORTALEZA),
    mapa,
  )
    .map((lead) => lead.name ?? "")
    .sort();
}

describe("o arquivo sai com os mesmos leads da tela", () => {
  const outubro = { de: "2026-10-01", ate: "2026-10-31" };
  const casos: [Partial<ValoresDosFiltrosDeLeads>, string[]][] = [
    [{ ...outubro, campanha: `meta:${CAMPANHA_1}` }, ["Lead do anuncio 1"]],
    [{ ...outubro, campanha: `meta:${CAMPANHA_2}` }, ["Lead do anuncio 2"]],
    [{ ...outubro, campanha: "texto:Promo de outubro" }, ["Lead da promo"]],
    [
      { ...outubro, campanha: CAMPANHA_SEM },
      [
        "Lead do Google",
        "Lead do anuncio 1 com NBSP",
        "Lead organico",
        "Lead so com a campanha da outra clinica",
        "Lead so com o clique",
      ],
    ],
    // A campanha que so a outra clinica conhece nao existe nesta.
    [{ ...outubro, campanha: `meta:${CAMPANHA_SO_DA_OUTRA}` }, []],
    [{ ...outubro, campanha: `meta:${CAMPANHA_DO_AD_1_NA_OUTRA}` }, []],
    [{ campanha: `meta:${CAMPANHA_1}` }, ["Lead de setembro", "Lead do anuncio 1"]],
    [
      { ...outubro, anuncio: AD_1 },
      ["Lead do anuncio 1", "Lead do anuncio 1 com NBSP"],
    ],
    [
      { ...outubro, anuncio: ANUNCIO_NAO_IDENTIFICADO },
      ["Lead so com a campanha da outra clinica", "Lead so com o clique"],
    ],
    [
      { ...outubro, anuncio: ANUNCIO_SEM },
      ["Lead da promo", "Lead do Google", "Lead organico"],
    ],
    [
      { ...outubro, origem: ORIGEM_SEM_ATRIBUICAO },
      [
        "Lead do anuncio 2",
        "Lead organico",
        "Lead so com a campanha da outra clinica",
        "Lead so com o clique",
      ],
    ],
    [
      { ...outubro, origem: "trafego_pago", campanha: CAMPANHA_SEM },
      ["Lead do Google", "Lead do anuncio 1 com NBSP"],
    ],
    [{ ...outubro, anuncio: AD_1, campanha: CAMPANHA_SEM }, ["Lead do anuncio 1 com NBSP"]],
  ];
  for (const [valores, esperados] of casos) {
    it(JSON.stringify(valores), async () => {
      const naTela = await nomesNaTela(valores);
      expect(naTela).toEqual([...esperados].sort());
      expect(await nomesExportados(valores)).toEqual(naTela);
    });
  }
});

describe("leitura", () => {
  it("Sem atribuição vai ao banco como canal nulo", async () => {
    await exportar({ origem: ORIGEM_SEM_ATRIBUICAO });
    const [primeira] = banco.consultasDe("contact");
    expect(primeira?.filtros).toEqual([
      { operador: "eq", coluna: "clinic_id", valor: CLINICA },
      { operador: "is", coluna: "source_channel", valor: null },
    ]);
  });

  it("campanha e anúncio não vão ao banco: o recorte é o da tela, no fim", async () => {
    await exportar({ campanha: `meta:${CAMPANHA_1}`, anuncio: AD_1 });
    const [primeira] = banco.consultasDe("contact");
    expect(primeira?.filtros).toEqual([
      { operador: "eq", coluna: "clinic_id", valor: CLINICA },
    ]);
  });

  it("o mapa é lido inteiro, só da clínica ativa e só com a campanha filtrada", async () => {
    await exportar({ campanha: `meta:${CAMPANHA_1}` });
    const doMapa = banco
      .consultas.filter(
        (consulta) =>
          (consulta.tabela === "meta_anuncio" ||
            consulta.tabela === "anuncio_do_whatsapp") &&
          consulta.ordem.some((ordem) => ordem.coluna === "ad_id"),
      );
    expect(doMapa.map((consulta) => consulta.tabela).sort()).toEqual([
      "anuncio_do_whatsapp",
      "meta_anuncio",
    ]);
    for (const consulta of banco.consultas) {
      expect(consulta.filtros).toContainEqual({
        operador: "eq",
        coluna: "clinic_id",
        valor: CLINICA,
      });
    }

    banco.consultas.length = 0;
    await exportar({ anuncio: AD_1 });
    expect(
      banco.consultas.some((consulta) =>
        consulta.ordem.some((ordem) => ordem.coluna === "ad_id"),
      ),
    ).toBe(false);
  });

  it("o mapa não carrega: com a campanha filtrada, nenhum arquivo e nenhuma trilha", async () => {
    banco.errosDeLeitura.anuncio_do_whatsapp = { code: "XX000", message: "caiu" };
    const resultado = await exportar({ campanha: `meta:${CAMPANHA_1}` });
    expect(resultado).toMatchObject({
      tipo: "falhou",
      status: 500,
      mensagem: MENSAGEM_EXPORTACAO_FALHOU,
    });
    expect(banco.inserts).toHaveLength(0);
  });
});

describe("filtros do pedido (Zod estrito nos dois campos)", () => {
  it("a tela manda campanha e anúncio só quando preenchidos", () => {
    expect(corpoDoPedidoDeExportacao({ ...VAZIOS })).toEqual({});
    expect(
      corpoDoPedidoDeExportacao({
        ...VAZIOS,
        origem: ORIGEM_SEM_ATRIBUICAO,
        campanha: "texto:Promo de outubro",
        anuncio: ANUNCIO_NAO_IDENTIFICADO,
      }),
    ).toEqual({
      origem: ORIGEM_SEM_ATRIBUICAO,
      campanha: "texto:Promo de outubro",
      anuncio: ANUNCIO_NAO_IDENTIFICADO,
    });
  });

  it("aceita as chaves de Resultados e volta ao formato da tela", () => {
    const pedido = {
      origem: ORIGEM_SEM_ATRIBUICAO,
      campanha: `meta:${CAMPANHA_1}`,
      anuncio: AD_1,
    };
    const lido = filtrosDaExportacaoSchema.safeParse(pedido);
    expect(lido.success).toBe(true);
    expect(valoresDaExportacao(lido.success ? lido.data : {})).toEqual({
      ...VAZIOS,
      ...pedido,
    });
    for (const valido of [
      { campanha: CAMPANHA_SEM },
      { campanha: "texto:Promo & cia" },
      { campanha: `texto:${"x".repeat(LIMITE_DA_CHAVE_DE_CAMPANHA - 6)}` },
      { anuncio: ANUNCIO_SEM },
      { anuncio: ANUNCIO_NAO_IDENTIFICADO },
      { campanha: "", anuncio: "" },
    ]) {
      expect(
        filtrosDaExportacaoSchema.safeParse(valido).success,
        JSON.stringify(valido).slice(0, 80),
      ).toBe(true);
    }
  });

  it("recusa o que a tela nunca manda, antes de ler o banco", async () => {
    for (const ruim of [
      { campanha: "abc" },
      { campanha: "meta:12a" },
      { campanha: "meta:" },
      { campanha: "texto:" },
      { campanha: `texto:${"x".repeat(LIMITE_DA_CHAVE_DE_CAMPANHA)}` },
      { campanha: 7 },
      { anuncio: "12a" },
      { anuncio: "1".repeat(33) },
      { anuncio: ` ${AD_1}` },
      { anuncio: "Sem" },
    ]) {
      expect(
        filtrosDaExportacaoSchema.safeParse(ruim).success,
        JSON.stringify(ruim).slice(0, 80),
      ).toBe(false);
    }
    const resultado = await exportar({ campanha: "abc" });
    expect(resultado).toEqual({
      tipo: "recusada",
      status: 400,
      mensagem: MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
    });
    expect(banco.consultas).toHaveLength(0);
  });
});

describe("trilha (LGPD)", () => {
  it("leva as duas chaves, que não são dado de paciente", async () => {
    const resultado = await exportar({
      origem: ORIGEM_SEM_ATRIBUICAO,
      campanha: CAMPANHA_SEM,
      anuncio: ANUNCIO_NAO_IDENTIFICADO,
    });
    expect(resultado.tipo).toBe("arquivo");
    const [trilha] = banco.inserts.filter((insert) => insert.tabela === "audit_log");
    expect(trilha?.linha.detalhes).toEqual({
      quantidade: 2,
      filtros: {
        origem: ORIGEM_SEM_ATRIBUICAO,
        campanha: CAMPANHA_SEM,
        anuncio: ANUNCIO_NAO_IDENTIFICADO,
      },
    });
    const texto = JSON.stringify(trilha?.linha);
    expect(texto).not.toContain("Lead so com o clique");
    expect(texto).not.toContain("+5585");
    expect(texto).not.toContain("clid-");
  });

  it("nome de campanha longo é cortado, para a linha caber no teto de 2 KB", () => {
    const longo = `texto:${"Campanha \u0001 ".repeat(100)}`;
    const detalhes = detalhesDaTrilhaDaExportacao(1, { campanha: longo });
    const campanha = detalhes.filtros.campanha ?? "";
    expect(Array.from(campanha)).toHaveLength(CARACTERES_DA_CAMPANHA_NA_TRILHA + 1);
    expect(campanha.endsWith("…")).toBe(true);
    // O pior caso do JSON do banco: todo caractere escrito com 6 bytes.
    expect(Array.from(campanha).length * 6 + 400).toBeLessThan(2048);
    expect(
      detalhesDaTrilhaDaExportacao(1, { campanha: "texto:Curta" }).filtros.campanha,
    ).toBe("texto:Curta");
  });
});

describe("teto", () => {
  it("com campanha ou anúncio, a mensagem diz que a conta é antes desse recorte", async () => {
    banco.contagemForcada = TETO_DA_EXPORTACAO_DE_LEADS + 1;
    const resultado = await exportar({ anuncio: AD_1 });
    expect(resultado).toMatchObject({ tipo: "recusada", status: 422 });
    if (resultado.tipo !== "recusada") {
      return;
    }
    expect(resultado.mensagem).toBe(
      mensagemAcimaDoTeto(TETO_DA_EXPORTACAO_DE_LEADS + 1, true),
    );
    expect(resultado.mensagem).toContain("Sem contar campanha e anúncio");
    expect(resultado.mensagem).toContain("20.001");
    expect(resultado.mensagem).not.toMatch(/[–—]/);
    // Sem esses dois filtros, a frase de sempre.
    expect(mensagemAcimaDoTeto(20_001)).toContain("São 20.001 leads com esses filtros");
  });
});
