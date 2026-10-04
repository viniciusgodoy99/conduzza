import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Fase 4, campanhas_do_periodo (migration 20261003110000) contra o banco
// REAL, com o cliente de servico (auth.uid() nulo: ve o investimento). Os
// mesmos casos do ensaio (scratchpad/fase4/banco/asserts.sql, bloco K):
// - casamento SO por id: anuncio conhecido, anuncio desconhecido, campanha
//   por id sem anuncio, campanha desconhecida, texto digitado, e o contato
//   com source_campaign IGUAL ao nome da campanha e sem id, que NUNCA casa;
// - o gasto entra pelos dias civis da clinica: o dia anterior fica fora, o
//   ultimo dia entra, o dia seguinte fica fora; o lead das 23h30 do ultimo
//   dia conta e o da meia-noite seguinte nao;
// - o numerador e o total da conta (level=account), so em BRL; outra moeda
//   acende outra_moeda e nao soma;
// - campanha com gasto e 0 lead entra em investimento_sem_lead;
// - invariante: soma das linhas + leads_sem_campanha = leads = funil.
// Quem recebe o que por papel esta em tests/rls/investimento-meta.test.ts.
// Clinica e_de_teste: o motor de producao a ignora.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const CONTA = "act_7654321";

// Setembro de 2026 em Fortaleza (00:00 local = 03:00 UTC) e agosto antes.
const P_DE = "2026-09-01T03:00:00.000Z";
const P_ATE = "2026-10-01T03:00:00.000Z";
const P_DE_ANTERIOR = "2026-08-02T03:00:00.000Z";

let clinicId = "";

type Linha = {
  chave: string;
  tipo: "meta" | "texto";
  meta_campaign_id: string | null;
  rotulo: string | null;
  leads: number;
  agendaram: number;
  compareceram: number;
  investimento_cents: number | null;
};
type Investimento = {
  configurada: boolean;
  situacao: string | null;
  problema: string | null;
  moeda: string | null;
  fuso_da_conta: string | null;
  lido_desde: string | null;
  lido_ate: string | null;
  sincronizado_em: string | null;
  dia_de: string;
  dia_ate: string;
  investimento_cents: number;
  investimento_casado_cents: number;
  investimento_sem_lead_cents: number;
  campanhas_sem_lead: number;
  outra_moeda: boolean;
};
type Bloco = {
  leads: number;
  leads_de_anuncio: number;
  leads_casados: number;
  leads_de_anuncio_sem_campanha: number;
  leads_sem_campanha: number;
  linhas: Linha[];
  investimento: Investimento | null;
};
type Campanhas = { atual: Bloco; anterior?: Bloco };

async function campanhas(
  de = P_DE,
  ate = P_ATE,
  deAnterior?: string,
): Promise<Campanhas> {
  const { data, error } = await admin.rpc("campanhas_do_periodo", {
    p_clinic_id: clinicId,
    p_de: de,
    p_ate: ate,
    ...(deAnterior ? { p_de_anterior: deAnterior } : {}),
  });
  expect(error).toBeNull();
  return data as Campanhas;
}

let telefone = 0;
async function lead(
  nome: string,
  chegada: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  telefone += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849797${String(telefone).padStart(5, "0")}`,
      name: nome,
      first_contact_at: chegada,
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Campanhas ${sufixo}`,
      slug: `campanhas-periodo-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;
  await admin
    .from("meta_ads_account")
    .insert({ clinic_id: clinicId, ad_account_id: CONTA })
    .throwOnError();

  await admin
    .from("meta_anuncio")
    .insert([
      {
        clinic_id: clinicId,
        ad_id: "7001",
        ad_account_id: CONTA,
        campaign_id: "8001",
        campaign_name: "Implante Setembro",
        ultimo_dia_com_entrega: "2026-09-30",
      },
      {
        clinic_id: clinicId,
        ad_id: "7002",
        ad_account_id: CONTA,
        campaign_id: "8001",
        campaign_name: "Implante Antigo",
        ultimo_dia_com_entrega: "2026-08-15",
      },
      {
        clinic_id: clinicId,
        ad_id: "7003",
        ad_account_id: CONTA,
        campaign_id: "8002",
        campaign_name: "Botox Sem Lead",
        ultimo_dia_com_entrega: "2026-09-15",
      },
      {
        clinic_id: clinicId,
        ad_id: "7004",
        ad_account_id: CONTA,
        campaign_id: "8003",
        campaign_name: "Clareamento",
        ultimo_dia_com_entrega: "2026-09-15",
      },
    ])
    .throwOnError();
  const gasto = (dia: string, ad: string, campanha: string, cents: number) => ({
    clinic_id: clinicId,
    ad_account_id: CONTA,
    dia,
    ad_id: ad,
    campaign_id: campanha,
    spend_cents: cents,
    currency: "BRL",
  });
  await admin
    .from("meta_gasto_diario")
    .insert([
      gasto("2026-08-31", "7001", "8001", 999),
      gasto("2026-09-01", "7001", "8001", 1000),
      gasto("2026-09-30", "7001", "8001", 2000),
      gasto("2026-10-01", "7001", "8001", 5000),
      gasto("2026-09-15", "7003", "8002", 3000),
      gasto("2026-09-15", "7004", "8003", 0),
    ])
    .throwOnError();
  const total = (dia: string, cents: number) => ({
    clinic_id: clinicId,
    ad_account_id: CONTA,
    dia,
    spend_cents: cents,
    currency: "BRL",
  });
  await admin
    .from("meta_gasto_conta_diario")
    .insert([
      total("2026-08-31", 999),
      total("2026-09-01", 1100),
      total("2026-09-15", 3000),
      total("2026-09-30", 2000),
      total("2026-10-01", 5000),
    ])
    .throwOnError();

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Campanha" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Avaliação" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const k1 = await lead("Anuncio conhecido", "2026-09-05T15:00:00.000Z", {
    ctwa_clid: `clid-1-${sufixo}`,
    source_ad_id: "7001",
  });
  await lead("Anuncio de nome antigo", "2026-09-06T15:00:00.000Z", {
    source_ad_id: "7002",
  });
  await lead("Anuncio desconhecido", "2026-09-07T15:00:00.000Z", {
    ctwa_clid: `clid-3-${sufixo}`,
    source_ad_id: "7999",
  });
  await lead("Campanha por id", "2026-09-08T15:00:00.000Z", {
    source_campaign_id: "8003",
  });
  await lead("Campanha desconhecida", "2026-09-09T15:00:00.000Z", {
    source_campaign_id: "8999",
  });
  const k6 = await lead("Texto digitado", "2026-09-10T15:00:00.000Z", {
    source_channel: "indicacao",
    source_campaign: "Promo Inverno",
  });
  await lead("Mesmo nome da campanha", "2026-09-11T15:00:00.000Z", {
    source_channel: "trafego_pago",
    source_campaign: "Implante Setembro",
  });
  await lead("Organico", "2026-09-12T15:00:00.000Z");
  // 23h30 de 30/09 em Fortaleza (02:30 UTC de 01/10): conta.
  await lead("Ultima meia hora", "2026-10-01T02:30:00.000Z", {
    source_ad_id: "7001",
  });
  // Meia-noite de 01/10 em Fortaleza: fica fora.
  await lead("Dia seguinte", "2026-10-01T03:00:00.000Z", {
    source_ad_id: "7001",
  });
  // Periodo anterior.
  await lead("Agosto", "2026-08-20T15:00:00.000Z", { source_ad_id: "7001" });
  // Anuncio e texto: o id vence.
  await lead("Anuncio com texto", "2026-09-13T15:00:00.000Z", {
    source_ad_id: "7001",
    source_channel: "trafego_pago",
    source_campaign: "Outro Texto",
  });

  const consulta = (contato: string, inicio: string) => ({
    clinic_id: clinicId,
    contact_id: contato,
    professional_id: prof!.id,
    service_link_id: vinculo!.id,
    starts_at: inicio,
    ends_at: new Date(new Date(inicio).getTime() + 60_000).toISOString(),
  });
  const { data: compareceu } = await admin
    .from("appointment")
    .insert(consulta(k1, "2026-09-20T13:00:00.000Z"))
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("appointment")
    .update({ status: "compareceu" })
    .eq("id", compareceu!.id)
    .throwOnError();
  await admin
    .from("appointment")
    .insert(consulta(k6, "2026-09-21T13:00:00.000Z"))
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
});

describe("campanhas_do_periodo", () => {
  it("casa só por id e conta cada lead numa linha só", async () => {
    const { atual } = await campanhas();
    expect(atual.leads).toBe(10);
    expect(atual.leads_de_anuncio).toBe(7);
    expect(atual.leads_casados).toBe(5);
    expect(atual.leads_de_anuncio_sem_campanha).toBe(2);
    expect(atual.leads_sem_campanha).toBe(3);
    expect(atual.linhas).toEqual([
      {
        chave: "meta:8001",
        tipo: "meta",
        meta_campaign_id: "8001",
        rotulo: "Implante Setembro",
        leads: 4,
        agendaram: 1,
        compareceram: 1,
        investimento_cents: 3000,
      },
      {
        chave: "meta:8002",
        tipo: "meta",
        meta_campaign_id: "8002",
        rotulo: "Botox Sem Lead",
        leads: 0,
        agendaram: 0,
        compareceram: 0,
        investimento_cents: 3000,
      },
      {
        chave: "meta:8003",
        tipo: "meta",
        meta_campaign_id: "8003",
        rotulo: "Clareamento",
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        investimento_cents: 0,
      },
      // O contato com o NOME da campanha e sem id fica no texto, nunca na Meta.
      {
        chave: "texto:Implante Setembro",
        tipo: "texto",
        meta_campaign_id: null,
        rotulo: "Implante Setembro",
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        investimento_cents: null,
      },
      {
        chave: "texto:Promo Inverno",
        tipo: "texto",
        meta_campaign_id: null,
        rotulo: "Promo Inverno",
        leads: 1,
        agendaram: 1,
        compareceram: 0,
        investimento_cents: null,
      },
    ]);
  });

  it("a soma das linhas mais os leads sem campanha é igual aos leads do funil", async () => {
    const { atual } = await campanhas();
    const soma = atual.linhas.reduce((total, linha) => total + linha.leads, 0);
    expect(soma + atual.leads_sem_campanha).toBe(atual.leads);
    const { data: funil } = await admin.rpc("funil_do_periodo", {
      p_clinic_id: clinicId,
      p_de: P_DE,
      p_ate: P_ATE,
    });
    expect((funil as { atual: { leads: number } }).atual.leads).toBe(
      atual.leads,
    );
  });

  it("o investimento é o total da conta em BRL nos dias civis da clínica", async () => {
    const { atual } = await campanhas();
    expect(atual.investimento).toEqual({
      configurada: false,
      situacao: null,
      problema: null,
      moeda: null,
      fuso_da_conta: null,
      lido_desde: null,
      lido_ate: null,
      sincronizado_em: null,
      dia_de: "2026-09-01",
      dia_ate: "2026-09-30",
      investimento_cents: 6100,
      investimento_casado_cents: 3000,
      investimento_sem_lead_cents: 3000,
      campanhas_sem_lead: 1,
      outra_moeda: false,
    });
  });

  it("o período anterior vem junto quando pedido", async () => {
    const resultado = await campanhas(P_DE, P_ATE, P_DE_ANTERIOR);
    expect(resultado.anterior!.leads).toBe(1);
    expect(resultado.anterior!.leads_casados).toBe(1);
    expect(resultado.anterior!.investimento!.investimento_cents).toBe(999);
    expect(resultado.anterior!.investimento!.dia_de).toBe("2026-08-02");
    expect(resultado.anterior!.investimento!.dia_ate).toBe("2026-08-31");
    expect(resultado.anterior!.linhas[0]).toMatchObject({
      chave: "meta:8001",
      investimento_cents: 999,
    });
    expect((await campanhas()).anterior).toBeUndefined();
  });

  it("a leitura configurada aparece como está (cobertura parcial: lido_desde depois do início)", async () => {
    await admin
      .from("meta_gasto_leitura")
      .insert({
        clinic_id: clinicId,
        ad_account_id: CONTA,
        situacao: "funcionando",
        moeda: "BRL",
        fuso_da_conta: "America/Sao_Paulo",
        lido_desde: "2026-09-10",
        lido_ate: "2026-09-30",
        sincronizado_em: "2026-10-01T09:00:00.000Z",
      })
      .throwOnError();
    const { atual } = await campanhas();
    expect(atual.investimento).toMatchObject({
      configurada: true,
      situacao: "funcionando",
      lido_desde: "2026-09-10",
      lido_ate: "2026-09-30",
      moeda: "BRL",
      fuso_da_conta: "America/Sao_Paulo",
    });
    expect(new Date(atual.investimento!.sincronizado_em!).toISOString()).toBe(
      "2026-10-01T09:00:00.000Z",
    );
  });

  it("os dias seguem o fuso da clínica (Tóquio: 31/08 fica fora)", async () => {
    await admin
      .from("clinic")
      .update({ timezone: "Asia/Tokyo" })
      .eq("id", clinicId)
      .throwOnError();
    try {
      const { atual } = await campanhas(
        "2026-08-31T15:00:00.000Z",
        "2026-09-30T15:00:00.000Z",
      );
      expect(atual.investimento!.dia_de).toBe("2026-09-01");
      expect(atual.investimento!.dia_ate).toBe("2026-09-30");
      expect(atual.investimento!.investimento_cents).toBe(6100);
    } finally {
      await admin
        .from("clinic")
        .update({ timezone: "America/Fortaleza" })
        .eq("id", clinicId)
        .throwOnError();
    }
  });

  it("outra moeda acende o aviso e não entra na soma", async () => {
    await admin
      .from("meta_gasto_conta_diario")
      .insert({
        clinic_id: clinicId,
        ad_account_id: CONTA,
        dia: "2026-09-10",
        spend_cents: 4000,
        currency: "USD",
      })
      .throwOnError();
    const { atual } = await campanhas();
    expect(atual.investimento!.outra_moeda).toBe(true);
    expect(atual.investimento!.investimento_cents).toBe(6100);
    // Fora do periodo da linha em dolar, o aviso nao acende.
    const { atual: outubro } = await campanhas(
      "2026-10-01T03:00:00.000Z",
      "2026-10-02T03:00:00.000Z",
    );
    expect(outubro.investimento!.outra_moeda).toBe(false);
    expect(outubro.investimento!.investimento_cents).toBe(5000);
  });
});

// Origem real do lead de anuncio (migration 20261004100000): a linha do mapa
// criada pela consulta por id (ultimo_dia_com_entrega nulo) entra como
// campanha conhecida, mas no nome perde para a linha com entrega (NULLS
// LAST); o lead com origem de anuncio gravada (anuncio_ctwa, source_campaign
// nulo) casa pelo id do anuncio. Clinica propria: as contagens dos casos de
// cima nao mudam.
describe("campanhas_do_periodo com a linha da consulta por id", () => {
  let clinica = "";

  beforeAll(async () => {
    const { data } = await admin
      .from("clinic")
      .insert({
        name: `Campanhas Consulta ${sufixo}`,
        slug: `campanhas-consulta-${sufixo}`,
        e_de_teste: true,
        timezone: "America/Fortaleza",
      })
      .select("id")
      .single()
      .throwOnError();
    clinica = data!.id as string;
    const antes = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const agora = new Date().toISOString();
    await admin
      .from("meta_anuncio")
      .insert([
        // Mesma campanha: a linha com entrega (mais antiga) e a da consulta
        // (atualizada agora, sem dia). O nome vem da linha com entrega.
        {
          clinic_id: clinica,
          ad_id: "5101",
          ad_account_id: CONTA,
          campaign_id: "9600",
          campaign_name: "Nome com entrega",
          ultimo_dia_com_entrega: "2026-09-01",
          origem: "insights",
          atualizado_em: antes,
        },
        {
          clinic_id: clinica,
          ad_id: "5102",
          ad_account_id: CONTA,
          campaign_id: "9600",
          campaign_name: "Nome da consulta",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: agora,
          atualizado_em: agora,
        },
        // Campanha conhecida so pela consulta.
        {
          clinic_id: clinica,
          ad_id: "5201",
          ad_account_id: CONTA,
          campaign_id: "9700",
          campaign_name: "So consulta",
          adset_name: "Conjunto da consulta",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: agora,
        },
      ])
      .throwOnError();
    await admin
      .from("contact")
      .insert([
        {
          clinic_id: clinica,
          phone_e164: "+5584979890001",
          name: "Lead com origem de anuncio",
          first_contact_at: "2026-09-15T15:00:00.000Z",
          ctwa_clid: `clid-consulta-${sufixo}`,
          source_ad_id: "5102",
          source_channel: "trafego_pago",
          source_origin: "Meta",
          source_medium: "Instagram",
          source_method: "anuncio_ctwa",
          source_captured_at: "2026-09-15T15:00:00.000Z",
        },
        {
          clinic_id: clinica,
          phone_e164: "+5584979890002",
          name: "Lead so com o anuncio",
          first_contact_at: "2026-09-16T15:00:00.000Z",
          source_ad_id: "5201",
        },
      ])
      .throwOnError();
  });

  afterAll(async () => {
    await admin.from("clinic").delete().eq("id", clinica);
  });

  it("o nome prefere a linha com entrega; a campanha só da consulta aparece com o próprio nome", async () => {
    const { data, error } = await admin.rpc("campanhas_do_periodo", {
      p_clinic_id: clinica,
      p_de: P_DE,
      p_ate: P_ATE,
    });
    expect(error).toBeNull();
    const { atual } = data as Campanhas;
    expect(atual.leads).toBe(2);
    expect(atual.leads_de_anuncio).toBe(2);
    expect(atual.leads_casados).toBe(2);
    expect(atual.leads_de_anuncio_sem_campanha).toBe(0);
    expect(atual.leads_sem_campanha).toBe(0);
    expect(atual.linhas).toEqual([
      {
        chave: "meta:9600",
        tipo: "meta",
        meta_campaign_id: "9600",
        rotulo: "Nome com entrega",
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        investimento_cents: 0,
      },
      {
        chave: "meta:9700",
        tipo: "meta",
        meta_campaign_id: "9700",
        rotulo: "So consulta",
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        investimento_cents: 0,
      },
    ]);
    // Nenhuma linha de texto: a origem de anuncio nao usa source_campaign.
    expect(atual.linhas.some((linha) => linha.tipo === "texto")).toBe(false);
  });
});
