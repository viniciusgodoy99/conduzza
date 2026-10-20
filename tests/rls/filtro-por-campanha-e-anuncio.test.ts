import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ANUNCIO_NAO_IDENTIFICADO,
  ANUNCIO_SEM,
  CAMPANHA_SEM,
  hrefDaListaDeLeads,
  indexarMapaDeAtribuicao,
  ORIGEM_SEM_ATRIBUICAO,
  type MapaDeAtribuicao,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  linhasDaOrigem,
  montarDetalheDeOrigemDaTela,
  type DimensaoDaOrigem,
} from "@/lib/domain/exportacao-de-resultados";
import {
  filtrarLeads,
  filtrosDeLeadsDosValores,
  type ValoresDosFiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import {
  fetchLeads,
  fetchMapaDeAtribuicao,
  type LeadResumo,
} from "@/lib/queries/leads";
import {
  fetchAnunciosDoPeriodo,
  fetchCampanhasDoPeriodo,
  fetchFunilDoPeriodo,
} from "@/lib/queries/relatorios";

import { adminClient, anonClient } from "./stack";

// Paridade entre Resultados e a lista de Leads, contra o banco real (pedido
// do dono em 20/10/2026, depois da reuniao em que o cliente conferia
// "Trafego pago 16" contra outra ferramenta): para CADA linha de
// funil_do_periodo (por canal), campanhas_do_periodo (por campanha) e
// anuncios_do_periodo (por anuncio), inclusive "Sem atribuição", "Sem
// campanha", "Anúncio não identificado" e "Sem anúncio da Meta", o link da
// linha (hrefDaListaDeLeads) aplicado a lista que a tela carrega
// (fetchLeads), com o mapa da clinica (fetchMapaDeAtribuicao) e o mesmo
// filtrarLeads da tela, da exatamente os leads da linha. As RPCs sao
// chamadas pelas MESMAS funcoes de Resultados (lib/queries/relatorios.ts),
// pela sessao do administrador.
//
// Casos cobertos: o id do anuncio exato, com espaco, com NBSP e tabulacao,
// com letra e vazio; so o clique, so o conjunto, so a campanha (conhecida,
// desconhecida e so da outra clinica); texto com espaco nas pontas, so de
// espacos e com tabulacao; texto e Meta juntos; o metodo de anuncio sem
// ids; o clique do Google; anuncio fora do mapa; as pontas do periodo. O
// administrador tambem e membro ativo da clinica B, que tem o mesmo anuncio
// em outra campanha e uma campanha so dela: o mapa precisa recortar a
// clinica ativa (a RLS deixa ler as duas).
//
// Clinicas e_de_teste: o motor de producao as ignora. ESCRITO E NAO RODADO
// (grava no banco de producao, em clinica de teste; quem roda e o dono):
//   npm run test:rls -- filtro-por-campanha-e-anuncio

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "FiltroCampanha!Rls2026";
const EMAIL_DO_ADMIN = `filtro-campanha-admin-${sufixo}@teste.dev`;

const FUSO = "America/Fortaleza";
// Outubro de 2026 em Fortaleza: [01/10 03:00Z, 01/11 03:00Z).
const PERIODO = { diaDe: "2026-10-01", diaAte: "2026-10-31" };
const P_DE = "2026-10-01T03:00:00.000Z";
const P_ATE = "2026-11-01T03:00:00.000Z";
const NO_MEIO = "2026-10-15T15:00:00.000Z";

const AD_A1 = "900000000000010001";
const AD_A2 = "900000000000010002";
const AD_A3 = "900000000000010003";
const AD_FORA_DO_MAPA = "900000000000010099";
const AD_SO_DA_B = "900000000000010009";
const CAMPANHA_A1 = "900000000000020001";
const CAMPANHA_A2 = "900000000000020002";
const CAMPANHA_DO_A1_NA_B = "900000000000020008";
const CAMPANHA_SO_DA_B = "900000000000020009";
const CAMPANHA_DESCONHECIDA = "900000000000020777";

const VAZIOS: ValoresDosFiltrosDeLeads = {
  etapa: "",
  origem: "",
  campanha: "",
  anuncio: "",
  resp: "",
  de: "",
  ate: "",
};

let clinicaA = "";
let clinicaB = "";
let sessao: ReturnType<typeof anonClient> | null = null;

async function logado() {
  if (sessao) {
    return sessao;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: EMAIL_DO_ADMIN,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login: ${error.message}`);
  }
  sessao = cliente;
  return cliente;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `FiltroCampanha ${nome} ${sufixo}`,
      slug: `filtro-campanha-${nome.toLowerCase()}-${sufixo}`,
      timezone: FUSO,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

function telefone(n: number): string {
  const digitos = sufixo.replace(/\D/g, "").padEnd(4, "7").slice(0, 4);
  return `+55849781${digitos}${String(n).padStart(2, "0")}`;
}

function metaAnuncio(
  clinicId: string,
  adId: string,
  campaignId: string,
  campos: Record<string, unknown> = {},
) {
  return {
    clinic_id: clinicId,
    ad_id: adId,
    ad_account_id: "act_9000001",
    campaign_id: campaignId,
    campaign_name: null,
    ad_name: null,
    ultimo_dia_com_entrega: "2026-10-10",
    ...campos,
  };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");

  // Um administrador, membro ativo das DUAS clinicas.
  const { data: usuario, error } = await admin.auth.admin.createUser({
    email: EMAIL_DO_ADMIN,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "admin" },
  });
  if (error || !usuario.user) {
    throw new Error(`criar usuario: ${error?.message}`);
  }
  await admin
    .from("clinic_member")
    .insert([
      { clinic_id: clinicaA, user_id: usuario.user.id, role: "admin", status: "ativo" },
      { clinic_id: clinicaB, user_id: usuario.user.id, role: "admin", status: "ativo" },
    ])
    .throwOnError();

  // O mapa da Meta. Na A: dois anuncios da campanha A1 (o nome que vale e o
  // do dia com entrega mais recente) e um da A2. Na B: o MESMO anuncio A1 em
  // outra campanha e uma campanha que so a B conhece.
  await admin
    .from("meta_anuncio")
    .insert(
      [
        metaAnuncio(clinicaA, AD_A1, CAMPANHA_A1, {
          campaign_name: "Botox Outubro",
          ad_name: "Botox, criativo 1",
        }),
        metaAnuncio(clinicaA, AD_A2, CAMPANHA_A1, {
          campaign_name: "Botox (nome antigo)",
          ultimo_dia_com_entrega: "2026-09-30",
        }),
        metaAnuncio(clinicaA, AD_A3, CAMPANHA_A2, {
          campaign_name: "Limpeza",
          ad_name: "Limpeza na Meta",
        }),
        metaAnuncio(clinicaB, AD_A1, CAMPANHA_DO_A1_NA_B, {
          campaign_name: "Da clínica B",
        }),
        metaAnuncio(clinicaB, AD_SO_DA_B, CAMPANHA_SO_DA_B, {
          campaign_name: "Só da B",
        }),
      ],
      { defaultToNull: false },
    )
    .throwOnError();

  // O titulo guardado do anuncio A1 (so o sistema escreve, pela RPC).
  const titulo = await admin.rpc("registrar_anuncio_do_whatsapp", {
    p_clinic_id: clinicaA,
    p_ad_id: AD_A1,
    p_titulo: "Botox com 20% de desconto",
    p_visto_em: NO_MEIO,
  });
  expect(titulo.error).toBeNull();

  // Os contatos (service role: a sessao nao grava os ids do anuncio). Num
  // insert de varias linhas o PostgREST manda nulo na coluna que falta:
  // defaultToNull desligado para os defaults do banco valerem.
  const contato = (
    n: number,
    nome: string,
    campos: Record<string, unknown> = {},
    clinicId = clinicaA,
  ) => ({
    clinic_id: clinicId,
    phone_e164: telefone(n),
    name: `${nome} ${sufixo}`,
    first_contact_at: NO_MEIO,
    ...campos,
  });
  const deAnuncio = {
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_method: "anuncio_ctwa",
  };
  await admin
    .from("contact")
    .insert(
      [
        contato(1, "Anuncio exato", { ...deAnuncio, ctwa_clid: `clid-1-${sufixo}`, source_ad_id: AD_A1 }),
        contato(2, "Outro anuncio da mesma campanha", { ctwa_clid: `clid-2-${sufixo}`, source_ad_id: AD_A2 }),
        contato(3, "Id com espaco", { source_ad_id: ` ${AD_A1} ` }),
        contato(4, "Id com NBSP e campanha conhecida", {
          source_ad_id: ` ${AD_A1}\t`,
          source_campaign_id: CAMPANHA_A2,
        }),
        contato(5, "Id com letra", { source_ad_id: "90000000000001000a" }),
        contato(6, "So o clique", { ctwa_clid: `clid-6-${sufixo}` }),
        contato(7, "So o conjunto", { source_adset_id: "900000000000030001" }),
        contato(8, "So a campanha conhecida", { source_campaign_id: CAMPANHA_A2 }),
        contato(9, "So a campanha desconhecida", { source_campaign_id: CAMPANHA_DESCONHECIDA }),
        contato(10, "So a campanha da B", { source_campaign_id: CAMPANHA_SO_DA_B }),
        contato(11, "Texto com espacos", {
          source_channel: "indicacao",
          source_method: "manual",
          source_campaign: "  Promo de outubro  ",
        }),
        contato(12, "Texto igual", { source_channel: "indicacao", source_campaign: "Promo de outubro" }),
        contato(13, "Texto com tabulacao", { source_channel: "indicacao", source_campaign: "\tPromo" }),
        contato(14, "Texto e Meta", {
          source_channel: "indicacao",
          source_campaign: "Promo de outubro",
          source_ad_id: AD_A3,
        }),
        contato(15, "Texto so de espacos", { source_campaign: "   " }),
        contato(16, "Metodo de anuncio sem ids", deAnuncio),
        contato(17, "Clique do Google", {
          source_channel: "trafego_pago",
          source_origin: "Google",
          source_method: "clique_site",
          source_google_campaign_id: "123456789",
        }),
        contato(18, "Organico"),
        contato(19, "Anuncio fora do mapa", { source_ad_id: AD_FORA_DO_MAPA }),
        contato(20, "Id vazio", { source_ad_id: "" }),
        contato(21, "Retorno", { source_channel: "retorno" }),
        contato(22, "No inicio do periodo", { first_contact_at: P_DE }),
        contato(23, "No fim do periodo (fora)", { first_contact_at: P_ATE, source_ad_id: AD_A1 }),
        contato(24, "No ultimo microssegundo", {
          first_contact_at: "2026-11-01T02:59:59.999999Z",
          source_ad_id: AD_A1,
        }),
        contato(25, "Antes do periodo (fora)", {
          first_contact_at: "2026-09-30T12:00:00.000Z",
          source_ad_id: AD_A1,
        }),
        contato(26, "Lead da B", { source_ad_id: AD_A1, source_campaign_id: CAMPANHA_SO_DA_B }, clinicaB),
      ],
      { defaultToNull: false },
    )
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (usuario.email === EMAIL_DO_ADMIN) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

/** Os valores da URL de um link de Resultados, no formato da barra. */
function valoresDoLink(href: string): ValoresDosFiltrosDeLeads {
  const url = new URL(href, "https://conduzza.invalid");
  expect(url.pathname).toBe("/leads");
  expect(url.searchParams.get("visao")).toBe("lista");
  const valores = { ...VAZIOS };
  for (const campo of Object.keys(VAZIOS) as (keyof ValoresDosFiltrosDeLeads)[]) {
    valores[campo] = url.searchParams.get(campo) ?? "";
  }
  return valores;
}

function quantosNaLista(
  leads: LeadResumo[],
  mapa: MapaDeAtribuicao,
  href: string,
): number {
  return filtrarLeads(
    leads,
    filtrosDeLeadsDosValores(valoresDoLink(href), FUSO),
    mapa,
  ).length;
}

describe("a lista de Leads com os mesmos leads de cada linha de Resultados", () => {
  async function lerTudo() {
    const cliente = await logado();
    const [funil, campanhas, anuncios, leads, mapaLido] = await Promise.all([
      fetchFunilDoPeriodo(cliente, clinicaA, FUSO, PERIODO.diaDe, PERIODO.diaAte, {
        comparar: false,
      }),
      fetchCampanhasDoPeriodo(cliente, clinicaA, FUSO, PERIODO.diaDe, PERIODO.diaAte, {
        comparar: false,
      }),
      fetchAnunciosDoPeriodo(cliente, clinicaA, FUSO, PERIODO.diaDe, PERIODO.diaAte),
      fetchLeads(cliente, clinicaA),
      fetchMapaDeAtribuicao(cliente, clinicaA),
    ]);
    return {
      funil: funil.atual,
      campanhas: campanhas.atual,
      anuncios,
      leads,
      mapaLido,
      mapa: indexarMapaDeAtribuicao(mapaLido),
    };
  }

  it("os dados cobrem cada tipo de linha (contraprova: o teste não passa no vazio)", async () => {
    const { funil, campanhas, anuncios, leads } = await lerTudo();
    // 25 contatos na A: 23 no periodo (o do fim e o de setembro ficam fora).
    expect(leads).toHaveLength(25);
    expect(funil.leads).toBe(23);
    expect(campanhas.leads).toBe(23);
    expect(anuncios.leads).toBe(23);

    expect(
      Object.fromEntries(funil.porCanal.map((linha) => [linha.canal ?? "nulo", linha.leads])),
    ).toEqual({ trafego_pago: 3, indicacao: 4, retorno: 1, nulo: 15 });

    expect(
      campanhas.linhas
        .filter((linha) => linha.leads > 0)
        .map((linha) => [linha.chave, linha.rotulo, linha.leads]),
    ).toEqual([
      [`meta:${CAMPANHA_A1}`, "Botox Outubro", 3],
      [`meta:${CAMPANHA_A2}`, "Limpeza", 3],
      ["texto:Promo de outubro", "Promo de outubro", 2],
      ["texto:\tPromo", "\tPromo", 1],
    ]);
    expect(campanhas.leadsSemCampanha).toBe(14);

    expect(anuncios.linhas.map((linha) => [linha.adId, linha.leads])).toEqual([
      [AD_A1, 4],
      [AD_A2, 1],
      [AD_A3, 1],
      [AD_FORA_DO_MAPA, 1],
    ]);
    expect(anuncios.naoIdentificado.leads).toBe(8);
    expect(anuncios.semAnuncio.leads).toBe(8);
  });

  it("o mapa da clínica é só da clínica ativa (contraprova: a RLS deixa o admin ler as duas)", async () => {
    const { mapaLido, mapa } = await lerTudo();
    expect(mapaLido.anuncios.map((linha) => linha.ad_id).sort()).toEqual(
      [AD_A1, AD_A2, AD_A3].sort(),
    );
    expect(mapa.anuncios.get(AD_A1)?.campaignId).toBe(CAMPANHA_A1);
    expect(mapa.campanhas.has(CAMPANHA_SO_DA_B)).toBe(false);
    expect(mapa.campanhas.get(CAMPANHA_A1)).toBe("Botox Outubro");
    expect(mapaLido.titulos).toEqual([
      { ad_id: AD_A1, titulo: "Botox com 20% de desconto" },
    ]);

    const cliente = await logado();
    const { data: semRecorte, error } = await cliente
      .from("meta_anuncio")
      .select("clinic_id")
      .in("clinic_id", [clinicaA, clinicaB]);
    expect(error).toBeNull();
    expect(new Set((semRecorte ?? []).map((linha) => linha.clinic_id))).toEqual(
      new Set([clinicaA, clinicaB]),
    );
  });

  for (const dimensao of ["canal", "campanha", "anuncio"] as DimensaoDaOrigem[]) {
    it(`Detalhe da origem por ${dimensao}: cada linha abre a lista com os mesmos leads`, async () => {
      const { funil, campanhas, anuncios, leads, mapa } = await lerTudo();
      const linhas = montarDetalheDeOrigemDaTela(funil, dimensao, campanhas, anuncios);
      expect(linhas).not.toBeNull();
      expect(linhas!.reduce((soma, linha) => soma + linha.leads, 0)).toBe(23);
      for (const linha of linhas!) {
        expect(
          quantosNaLista(leads, mapa, hrefDaListaDeLeads(PERIODO, linha.filtro)),
          `${dimensao}: ${linha.rotulo} (${linha.filtro.valor})`,
        ).toBe(linha.leads);
      }
    });
  }

  it("os restos têm linha e batem: Sem atribuição, Sem campanha, Anúncio não identificado e Sem anúncio da Meta", async () => {
    const { funil, campanhas, anuncios, leads, mapa } = await lerTudo();
    const filtros = [
      ...montarDetalheDeOrigemDaTela(funil, "canal", campanhas, anuncios)!,
      ...montarDetalheDeOrigemDaTela(funil, "campanha", campanhas, anuncios)!,
      ...montarDetalheDeOrigemDaTela(funil, "anuncio", campanhas, anuncios)!,
    ].map((linha) => [linha.filtro.campo, linha.filtro.valor, linha.leads]);
    expect(filtros).toContainEqual(["origem", ORIGEM_SEM_ATRIBUICAO, 15]);
    expect(filtros).toContainEqual(["campanha", CAMPANHA_SEM, 14]);
    expect(filtros).toContainEqual(["anuncio", ANUNCIO_NAO_IDENTIFICADO, 8]);
    expect(filtros).toContainEqual(["anuncio", ANUNCIO_SEM, 8]);
    for (const [campo, valor, esperado] of filtros) {
      expect(
        quantosNaLista(
          leads,
          mapa,
          hrefDaListaDeLeads(PERIODO, {
            campo: campo as "origem" | "campanha" | "anuncio",
            valor: valor as string,
          }),
        ),
        `${campo}=${valor}`,
      ).toBe(esperado);
    }
  });

  it("as barras da Origem dos leads abrem a lista com os mesmos leads", async () => {
    const { funil, leads, mapa } = await lerTudo();
    const barras = linhasDaOrigem(funil);
    expect(barras.map((barra) => [barra.rotulo, barra.leads])).toEqual([
      ["Sem atribuição", 15],
      ["Indicação", 4],
      ["Tráfego pago", 3],
      ["Retorno", 1],
    ]);
    for (const barra of barras) {
      expect(
        quantosNaLista(leads, mapa, hrefDaListaDeLeads(PERIODO, barra.filtro)),
        barra.rotulo,
      ).toBe(barra.leads);
    }
  });

  it("sem filtro de linha, o período sozinho dá os leads do funil", async () => {
    const { funil, leads, mapa } = await lerTudo();
    expect(
      filtrarLeads(
        leads,
        filtrosDeLeadsDosValores(
          { ...VAZIOS, de: PERIODO.diaDe, ate: PERIODO.diaAte },
          FUSO,
        ),
        mapa,
      ),
    ).toHaveLength(funil.leads);
  });
});
