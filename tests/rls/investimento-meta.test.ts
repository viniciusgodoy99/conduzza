import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Fase 4, investimento da Meta (migrations 20261003100000 e 20261003110000),
// contra o banco real. O que esta em jogo:
// - dinheiro (meta_gasto_diario, meta_gasto_conta_diario) e a situacao da
//   leitura (meta_gasto_leitura) so para admin e gestor da propria clinica;
// - o mapa anuncio -> campanha (meta_anuncio, sem dinheiro) para todo membro
//   ativo, nunca para pendente nem para outra clinica;
// - ninguem escreve nessas tabelas pela sessao, nem o admin: so o sistema;
// - o segredo (insights_access_token) devolve 42501 para a sessao, e as
//   funcoes do job tambem (so a service role as executa);
// - campanhas_do_periodo: mesmas contagens de leads em todo papel,
//   investimento null fora da gestao, null para o profissional, zeros para
//   outra clinica, anon sem EXECUTE;
// - a sessao nao reescreve a atribuicao de anuncio do contato;
// - a gestao trocar a conta pela API volta a leitura para "nao_testada".
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Clinicas
// e_de_teste: o motor de producao as ignora.

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "InvestMeta!Rls2026";

const email = (papel: string) => `invmeta-${papel}-${sufixo}@teste.dev`;

// Periodo fixo: setembro de 2026 em Fortaleza (00:00 local = 03:00 UTC).
const P_DE = "2026-09-01T03:00:00.000Z";
const P_ATE = "2026-10-01T03:00:00.000Z";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
let contatoDoAnuncio = "";

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
type Bloco = {
  leads: number;
  leads_de_anuncio: number;
  leads_casados: number;
  leads_de_anuncio_sem_campanha: number;
  leads_sem_campanha: number;
  linhas: Linha[];
  investimento: { investimento_cents: number; configurada: boolean } | null;
};
type Campanhas = { atual: Bloco; anterior?: Bloco } | null;

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string,
  role: string,
  opcoes: { status?: string; professionalId?: string } = {},
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: papelNoEmail },
  });
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: opcoes.status ?? "ativo",
      ...(opcoes.professionalId
        ? { professional_id: opcoes.professionalId }
        : {}),
    })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, ReturnType<typeof anonClient>>();

async function logado(papelNoEmail: string) {
  const pronta = sessoes.get(papelNoEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papelNoEmail),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papelNoEmail}: ${error.message}`);
  }
  sessoes.set(papelNoEmail, cliente);
  return cliente;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `InvMeta ${nome} ${sufixo}`,
      slug: `invmeta-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Dado da Meta de uma clinica, gravado pelo sistema (service role). */
async function montarMeta(
  clinicId: string,
  conta: string,
  anuncio: string,
  campanha: string,
): Promise<void> {
  await admin
    .from("meta_ads_account")
    .insert({ clinic_id: clinicId, ad_account_id: conta })
    .throwOnError();
  await admin
    .from("meta_ads_account_secret")
    .insert({
      clinic_id: clinicId,
      insights_access_token: `EAAtokenDeLeitura${sufixo}${conta}`,
    })
    .throwOnError();
  await admin
    .from("meta_gasto_leitura")
    .insert({
      clinic_id: clinicId,
      ad_account_id: conta,
      situacao: "funcionando",
      moeda: "BRL",
      fuso_da_conta: "America/Sao_Paulo",
      lido_desde: "2026-08-01",
      lido_ate: "2026-10-01",
      sincronizado_em: "2026-10-01T09:00:00.000Z",
    })
    .throwOnError();
  await admin
    .from("meta_anuncio")
    .insert({
      clinic_id: clinicId,
      ad_id: anuncio,
      ad_account_id: conta,
      campaign_id: campanha,
      campaign_name: `Campanha ${campanha}`,
      ultimo_dia_com_entrega: "2026-09-30",
    })
    .throwOnError();
  await admin
    .from("meta_gasto_diario")
    .insert({
      clinic_id: clinicId,
      ad_account_id: conta,
      dia: "2026-09-10",
      ad_id: anuncio,
      campaign_id: campanha,
      campaign_name: `Campanha ${campanha}`,
      spend_cents: 4500,
      currency: "BRL",
    })
    .throwOnError();
  await admin
    .from("meta_gasto_conta_diario")
    .insert({
      clinic_id: clinicId,
      ad_account_id: conta,
      dia: "2026-09-10",
      spend_cents: 5000,
      currency: "BRL",
    })
    .throwOnError();
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Meta" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", {
    professionalId: profissionalA,
  });
  await criarUsuario("pendente-a", clinicaA, "recepcao", {
    status: "pendente",
  });
  await criarUsuario("admin-b", clinicaB, "admin");

  await montarMeta(clinicaA, "act_1234567", "7001", "8001");
  await montarMeta(clinicaB, "act_2222222", "7002", "8002");

  // Leads de setembro na A: um de anuncio (casa com a campanha 8001), um com
  // campanha digitada e um sem campanha.
  const { data: contatos } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicaA,
        phone_e164: `+5584975${sufixo.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}`,
        name: "Lead do anuncio",
        first_contact_at: "2026-09-05T15:00:00.000Z",
        ctwa_clid: `clid-${sufixo}`,
        source_ad_id: "7001",
      },
      {
        clinic_id: clinicaA,
        phone_e164: `+5584976${sufixo.replace(/\D/g, "").padEnd(6, "2").slice(0, 6)}`,
        name: "Lead do texto",
        first_contact_at: "2026-09-06T15:00:00.000Z",
        source_channel: "indicacao",
        source_campaign: "Promo Inverno",
      },
      {
        clinic_id: clinicaA,
        phone_e164: `+5584977${sufixo.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}`,
        name: "Lead organico",
        first_contact_at: "2026-09-07T15:00:00.000Z",
      },
    ])
    .select("id, name")
    .throwOnError();
  contatoDoAnuncio = contatos!.find((c) => c.name === "Lead do anuncio")!
    .id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
});

const TABELAS_DA_GESTAO = [
  "meta_gasto_diario",
  "meta_gasto_conta_diario",
  "meta_gasto_leitura",
] as const;

describe("gasto, total da conta e situação da leitura", () => {
  it("admin e gestor de A leem os da própria clínica e nada da B", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      for (const tabela of TABELAS_DA_GESTAO) {
        const { data: daA, error } = await cliente
          .from(tabela)
          .select("clinic_id")
          .eq("clinic_id", clinicaA);
        expect(error).toBeNull();
        expect(daA).toHaveLength(1);
        const { data: daB } = await cliente
          .from(tabela)
          .select("clinic_id")
          .eq("clinic_id", clinicaB);
        expect(daB).toEqual([]);
      }
    }
  });

  it("recepção, leitura, profissional e pendente não leem nada (com contraprova da B)", async () => {
    for (const papel of ["recepcao-a", "leitura-a", "prof-a", "pendente-a"]) {
      const cliente = await logado(papel);
      for (const tabela of TABELAS_DA_GESTAO) {
        const { data, error } = await cliente.from(tabela).select("clinic_id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    }
    // Contraprova: o admin da B le o proprio gasto.
    const b = await logado("admin-b");
    const { data } = await b
      .from("meta_gasto_diario")
      .select("spend_cents")
      .eq("clinic_id", clinicaB);
    expect(data).toEqual([{ spend_cents: 4500 }]);
  });
});

describe("meta_anuncio (mapa sem dinheiro)", () => {
  it("todo membro ativo de A lê; pendente não; A não lê B", async () => {
    for (const papel of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "prof-a",
    ]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("meta_anuncio")
        .select("ad_id, campaign_id, clinic_id");
      expect(error).toBeNull();
      expect(data).toEqual([
        { ad_id: "7001", campaign_id: "8001", clinic_id: clinicaA },
      ]);
    }
    const pendente = await logado("pendente-a");
    const { data: doPendente } = await pendente
      .from("meta_anuncio")
      .select("ad_id");
    expect(doPendente).toEqual([]);
  });
});

describe("ninguém escreve pela sessão", () => {
  it("insert, update e delete devolvem 42501 nas quatro tabelas, até para o admin", async () => {
    const cliente = await logado("admin-a");
    const tentativas = [
      cliente
        .from("meta_gasto_leitura")
        .update({ situacao: "funcionando" })
        .eq("clinic_id", clinicaA),
      cliente.from("meta_gasto_leitura").delete().eq("clinic_id", clinicaA),
      cliente.from("meta_gasto_leitura").insert({ clinic_id: clinicaB }),
      cliente
        .from("meta_gasto_diario")
        .update({ spend_cents: 0 })
        .eq("clinic_id", clinicaA),
      cliente.from("meta_gasto_diario").delete().eq("clinic_id", clinicaA),
      cliente.from("meta_gasto_diario").insert({
        clinic_id: clinicaA,
        ad_account_id: "act_1234567",
        dia: "2026-09-11",
        ad_id: "7001",
        campaign_id: "8001",
        spend_cents: 1,
        currency: "BRL",
      }),
      cliente
        .from("meta_gasto_conta_diario")
        .update({ spend_cents: 0 })
        .eq("clinic_id", clinicaA),
      cliente
        .from("meta_gasto_conta_diario")
        .delete()
        .eq("clinic_id", clinicaA),
      cliente
        .from("meta_anuncio")
        .update({ campaign_id: "9999" })
        .eq("clinic_id", clinicaA),
      cliente.from("meta_anuncio").delete().eq("clinic_id", clinicaA),
      cliente.from("meta_anuncio").insert({
        clinic_id: clinicaA,
        ad_id: "7999",
        ad_account_id: "act_1234567",
        campaign_id: "8999",
        ultimo_dia_com_entrega: "2026-09-11",
      }),
    ];
    for (const tentativa of tentativas) {
      const { error } = await tentativa;
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    // O dado ficou como o sistema gravou.
    const { data: leitura } = await admin
      .from("meta_gasto_leitura")
      .select("situacao")
      .eq("clinic_id", clinicaA)
      .single();
    expect(leitura!.situacao).toBe("funcionando");
    const { data: gasto } = await admin
      .from("meta_gasto_diario")
      .select("spend_cents")
      .eq("clinic_id", clinicaA);
    expect(gasto).toEqual([{ spend_cents: 4500 }]);
  });

  it("anon não chega nas tabelas novas", async () => {
    const anon = anonClient();
    for (const tabela of [...TABELAS_DA_GESTAO, "meta_anuncio"] as const) {
      const { error } = await anon.from(tabela).select("clinic_id");
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });
});

describe("token de leitura (meta_ads_account_secret)", () => {
  it("a sessão da gestão recebe 42501 ao ler ou gravar; o token existe", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { error: erroLeitura } = await cliente
        .from("meta_ads_account_secret")
        .select("insights_access_token")
        .eq("clinic_id", clinicaA);
      expect(erroLeitura?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroEscrita } = await cliente
        .from("meta_ads_account_secret")
        .update({ insights_access_token: "forjadoforjadoforjado1" })
        .eq("clinic_id", clinicaA);
      expect(erroEscrita?.code).toBe(PERMISSAO_NEGADA);
    }
    const { error: erroAnon } = await anonClient()
      .from("meta_ads_account_secret")
      .select("clinic_id");
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
    const { data: prova } = await admin
      .from("meta_ads_account_secret")
      .select("insights_access_token")
      .eq("clinic_id", clinicaA)
      .single();
    expect(prova!.insights_access_token).toBe(
      `EAAtokenDeLeitura${sufixo}act_1234567`,
    );
  });
});

describe("funções do job (só a service role)", () => {
  it("authenticated e anon recebem 42501", async () => {
    const chamadas = (cliente: ReturnType<typeof anonClient>) => [
      cliente.rpc("enfileirar_sincronizacao_de_gasto_meta", {
        p_clinic_id: clinicaA,
        p_origem: "manual",
      }),
      // O parametro dos testes de integracao tambem nao abre a porta.
      cliente.rpc("enfileirar_sincronizacao_de_gasto_meta", {
        p_clinic_id: clinicaA,
        p_origem: "manual",
        p_incluir_teste: true,
      }),
      cliente.rpc("enfileirar_gasto_meta_do_dia", {}),
      cliente.rpc("enfileirar_gasto_meta_do_dia", {
        p_clinic_ids: [clinicaA],
        p_incluir_teste: true,
      }),
      cliente.rpc("regravar_gasto_meta", {
        p_job_id: crypto.randomUUID(),
        p_worker: "sessao",
        p_clinic_id: clinicaA,
        p_ad_account_id: "act_1234567",
        p_token_sha256: "0".repeat(64),
        p_desde: "2026-09-01",
        p_ate: "2026-09-02",
        p_moeda: "BRL",
        p_fuso: "America/Sao_Paulo",
        p_nome_da_conta: "Conta",
        p_conta_ativa: true,
        p_por_anuncio: [],
        p_da_conta: [],
      }),
      cliente.rpc("registrar_falha_do_gasto_meta", {
        p_job_id: crypto.randomUUID(),
        p_worker: "sessao",
        p_clinic_id: clinicaA,
        p_ad_account_id: "act_1234567",
        p_token_sha256: "0".repeat(64),
        p_problema: "token_invalido",
        p_codigo: 190,
      }),
    ];
    const sessao = await logado("admin-a");
    for (const cliente of [sessao, anonClient()]) {
      for (const chamada of chamadas(cliente)) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    // Nada nasceu na fila pela sessao.
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("kind", "sincronizar_gasto_meta");
    expect(jobs).toEqual([]);
  });
});

describe("campanhas_do_periodo", () => {
  const args = () => ({ p_clinic_id: clinicaA, p_de: P_DE, p_ate: P_ATE });

  it("a gestão recebe o investimento; recepção e leitura recebem as MESMAS contagens com investimento null", async () => {
    const gestao: Campanhas[] = [];
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("campanhas_do_periodo", args());
      expect(error).toBeNull();
      gestao.push(data as Campanhas);
    }
    const doAdmin = gestao[0]!;
    expect(gestao[1]).toEqual(doAdmin);
    expect(doAdmin!.atual.leads).toBe(3);
    expect(doAdmin!.atual.leads_de_anuncio).toBe(1);
    expect(doAdmin!.atual.leads_casados).toBe(1);
    expect(doAdmin!.atual.leads_sem_campanha).toBe(1);
    expect(doAdmin!.atual.investimento?.investimento_cents).toBe(5000);
    expect(doAdmin!.atual.investimento?.configurada).toBe(true);
    expect(doAdmin!.atual.linhas[0]).toMatchObject({
      chave: "meta:8001",
      leads: 1,
      investimento_cents: 4500,
    });

    for (const papel of ["recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("campanhas_do_periodo", args());
      expect(error).toBeNull();
      const visto = data as Campanhas;
      expect(visto!.atual.investimento).toBeNull();
      expect(visto!.atual.leads).toBe(doAdmin!.atual.leads);
      expect(visto!.atual.leads_de_anuncio).toBe(
        doAdmin!.atual.leads_de_anuncio,
      );
      expect(visto!.atual.leads_casados).toBe(doAdmin!.atual.leads_casados);
      expect(visto!.atual.leads_sem_campanha).toBe(
        doAdmin!.atual.leads_sem_campanha,
      );
      expect(visto!.atual.linhas.map((l) => [l.chave, l.leads])).toEqual(
        doAdmin!.atual.linhas.map((l) => [l.chave, l.leads]),
      );
      expect(
        visto!.atual.linhas.every((l) => l.investimento_cents === null),
      ).toBe(true);
    }
  });

  it("profissional recebe null; admin da B pedindo a A recebe zeros e investimento null", async () => {
    const prof = await logado("prof-a");
    const { data: doProf, error } = await prof.rpc(
      "campanhas_do_periodo",
      args(),
    );
    expect(error).toBeNull();
    expect(doProf).toBeNull();

    const b = await logado("admin-b");
    const { data: daB } = await b.rpc("campanhas_do_periodo", args());
    const visto = daB as Campanhas;
    expect(visto!.atual.leads).toBe(0);
    expect(visto!.atual.linhas).toEqual([]);
    expect(visto!.atual.investimento).toBeNull();
    // Contraprova: a B ve o proprio investimento.
    const { data: propria } = await b.rpc("campanhas_do_periodo", {
      ...args(),
      p_clinic_id: clinicaB,
    });
    expect((propria as Campanhas)!.atual.investimento?.investimento_cents).toBe(
      5000,
    );
  });

  it("anon não executa", async () => {
    const { error } = await anonClient().rpc("campanhas_do_periodo", args());
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("atribuição de anúncio do contato", () => {
  it("a recepção edita o contato, mas ctwa_clid e os ids do anúncio não mudam", async () => {
    const cliente = await logado("recepcao-a");
    const { data: editado, error } = await cliente
      .from("contact")
      .update({
        name: "Nome corrigido",
        ctwa_clid: "forjado",
        source_ad_id: "1",
        source_adset_id: "2",
        source_campaign_id: "3",
      })
      .eq("id", contatoDoAnuncio)
      .select("id");
    expect(error).toBeNull();
    expect(editado).toHaveLength(1);
    const { data: depois } = await admin
      .from("contact")
      .select(
        "name, ctwa_clid, source_ad_id, source_adset_id, source_campaign_id",
      )
      .eq("id", contatoDoAnuncio)
      .single();
    expect(depois).toEqual({
      name: "Nome corrigido",
      ctwa_clid: `clid-${sufixo}`,
      source_ad_id: "7001",
      source_adset_id: null,
      source_campaign_id: null,
    });
  });

  it("contato criado pela sessão nasce sem atribuição de anúncio", async () => {
    const cliente = await logado("recepcao-a");
    const { data, error } = await cliente
      .from("contact")
      .insert({
        clinic_id: clinicaA,
        phone_e164: `+5584978${sufixo.replace(/\D/g, "").padEnd(6, "4").slice(0, 6)}`,
        name: "Criado pela recepção",
        ctwa_clid: "forjado",
        source_ad_id: "7001",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: criado } = await admin
      .from("contact")
      .select("ctwa_clid, source_ad_id")
      .eq("id", data!.id)
      .single();
    expect(criado).toEqual({ ctwa_clid: null, source_ad_id: null });
  });
});

describe("troca da conta de anúncios pela sessão", () => {
  it("o gestor troca o ad_account_id e a leitura volta para não testada; outra coluna não mexe", async () => {
    await admin
      .from("meta_gasto_leitura")
      .update({
        situacao: "com_problema",
        problema: "token_invalido",
        codigo_da_meta: 190,
      })
      .eq("clinic_id", clinicaB)
      .throwOnError();
    const b = await logado("admin-b");

    // Outra coluna: nada muda.
    const { error: erroPixel } = await b
      .from("meta_ads_account")
      .update({ pixel_id: "123456789012345" })
      .eq("clinic_id", clinicaB);
    expect(erroPixel).toBeNull();
    const { data: antes } = await admin
      .from("meta_gasto_leitura")
      .select("situacao, problema")
      .eq("clinic_id", clinicaB)
      .single();
    expect(antes).toEqual({
      situacao: "com_problema",
      problema: "token_invalido",
    });

    // Conta sem act_ e recusada pelo banco.
    const { error: erroFormato } = await b
      .from("meta_ads_account")
      .update({ ad_account_id: "3333333" })
      .eq("clinic_id", clinicaB);
    expect(erroFormato?.code).toBe("23514");

    const { error } = await b
      .from("meta_ads_account")
      .update({ ad_account_id: "act_3333333" })
      .eq("clinic_id", clinicaB);
    expect(error).toBeNull();
    const { data: depois } = await admin
      .from("meta_gasto_leitura")
      .select("situacao, problema, codigo_da_meta")
      .eq("clinic_id", clinicaB)
      .single();
    expect(depois).toEqual({
      situacao: "nao_testada",
      problema: null,
      codigo_da_meta: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Origem real do lead de anuncio (migration 20261004100000)
// ---------------------------------------------------------------------------
// - as colunas novas de meta_anuncio (adset_name, ad_name, origem,
//   consultado_em) seguem a policy do mapa: todo membro ativo da propria
//   clinica, nunca pendente nem outra clinica;
// - meta_anuncio_recusado nao e lida por sessao nenhuma (42501, nem o
//   admin); so o sistema;
// - as funcoes do resolvedor sao so da service role;
// - a sessao nao forja lead de anuncio (source_method anuncio_ctwa: 42501),
//   mas edita o contato reenviando o metodo que ja estava gravado.
// Linhas proprias (anuncios 7101 e 7102): os casos de cima nao mudam.

describe("origem real: colunas novas de meta_anuncio", () => {
  beforeAll(async () => {
    const agora = new Date().toISOString();
    await admin
      .from("meta_anuncio")
      .insert([
        {
          clinic_id: clinicaA,
          ad_id: "7101",
          ad_account_id: "act_1234567",
          campaign_id: "8101",
          campaign_name: "Campanha da consulta A",
          adset_name: "Conjunto A",
          ad_name: "Anúncio A",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: agora,
        },
        {
          clinic_id: clinicaB,
          ad_id: "7102",
          ad_account_id: "act_2222222",
          campaign_id: "8102",
          campaign_name: "Campanha da consulta B",
          adset_name: "Conjunto B",
          ad_name: "Anúncio B",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: agora,
        },
      ])
      .throwOnError();
  });

  it("todo membro ativo de A lê as colunas novas da própria clínica; pendente não; A não lê as da B", async () => {
    for (const papel of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "prof-a",
    ]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("meta_anuncio")
        .select("ad_id, adset_name, ad_name, origem, consultado_em")
        .eq("ad_id", "7101");
      expect(error, papel).toBeNull();
      expect(data, papel).toHaveLength(1);
      expect(data![0]).toMatchObject({
        adset_name: "Conjunto A",
        ad_name: "Anúncio A",
        origem: "consulta",
      });
      expect(data![0]!.consultado_em).not.toBeNull();
      // Tudo o que a sessao enxerga e da A: nada do anuncio, do conjunto ou
      // do nome da B.
      const { data: visiveis } = await cliente
        .from("meta_anuncio")
        .select("clinic_id, ad_id, adset_name, ad_name");
      expect(visiveis!.length, papel).toBeGreaterThan(0);
      for (const linha of visiveis!) {
        expect(linha.clinic_id, papel).toBe(clinicaA);
        expect(linha.ad_id, papel).not.toBe("7102");
        expect(linha.adset_name, papel).not.toBe("Conjunto B");
        expect(linha.ad_name, papel).not.toBe("Anúncio B");
      }
    }
    const pendente = await logado("pendente-a");
    const { data: doPendente } = await pendente
      .from("meta_anuncio")
      .select("adset_name");
    expect(doPendente).toEqual([]);
    // Contraprova: o admin da B le o proprio conjunto e nada da A.
    const b = await logado("admin-b");
    const { data: daPropria } = await b
      .from("meta_anuncio")
      .select("adset_name")
      .eq("ad_id", "7102");
    expect(daPropria).toEqual([{ adset_name: "Conjunto B" }]);
    const { data: daA } = await b
      .from("meta_anuncio")
      .select("ad_id")
      .eq("clinic_id", clinicaA);
    expect(daA).toEqual([]);
  });

  it("a sessão não grava o conjunto nem cria linha da consulta (42501), nem o admin", async () => {
    const cliente = await logado("admin-a");
    const tentativas = [
      cliente
        .from("meta_anuncio")
        .update({ adset_name: "Forjado" })
        .eq("ad_id", "7101"),
      cliente.from("meta_anuncio").insert({
        clinic_id: clinicaA,
        ad_id: "7109",
        ad_account_id: "act_1234567",
        campaign_id: "8109",
        origem: "consulta",
        consultado_em: new Date().toISOString(),
      }),
    ];
    for (const tentativa of tentativas) {
      const { error } = await tentativa;
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("meta_anuncio")
      .select("adset_name")
      .eq("clinic_id", clinicaA)
      .eq("ad_id", "7101")
      .single();
    expect(data).toEqual({ adset_name: "Conjunto A" });
  });
});

describe("origem real: meta_anuncio_recusado (só o sistema)", () => {
  beforeAll(async () => {
    await admin
      .from("meta_anuncio_recusado")
      .insert([
        {
          clinic_id: clinicaA,
          ad_id: "7201",
          motivo: "inacessivel",
          codigo_da_meta: 100,
          ad_account_id: "act_1234567",
          token_sha256: "a".repeat(64),
        },
        {
          clinic_id: clinicaB,
          ad_id: "7202",
          motivo: "inacessivel",
          codigo_da_meta: 100,
          ad_account_id: "act_2222222",
          token_sha256: "b".repeat(64),
        },
      ])
      .throwOnError();
  });

  it("nenhuma sessão lê (42501), nem o admin; anon também não; o sistema lê as duas", async () => {
    const sessoesDoTeste = [
      ...(await Promise.all(
        [
          "admin-a",
          "gestor-a",
          "recepcao-a",
          "leitura-a",
          "prof-a",
          "pendente-a",
          "admin-b",
        ].map((papel) => logado(papel)),
      )),
      anonClient(),
    ];
    for (const cliente of sessoesDoTeste) {
      const { data, error } = await cliente
        .from("meta_anuncio_recusado")
        .select("clinic_id, ad_id, token_sha256");
      expect(error?.code).toBe(PERMISSAO_NEGADA);
      expect(data).toBeNull();
    }
    const { data } = await admin
      .from("meta_anuncio_recusado")
      .select("ad_id")
      .in("clinic_id", [clinicaA, clinicaB])
      .order("ad_id");
    expect(data).toEqual([{ ad_id: "7201" }, { ad_id: "7202" }]);
  });

  it("a sessão não grava, não altera e não apaga recusa (42501)", async () => {
    const cliente = await logado("admin-a");
    const tentativas = [
      cliente.from("meta_anuncio_recusado").insert({
        clinic_id: clinicaA,
        ad_id: "7209",
        motivo: "inacessivel",
        ad_account_id: "act_1234567",
        token_sha256: "c".repeat(64),
      }),
      cliente
        .from("meta_anuncio_recusado")
        .update({ tentativas: 9 })
        .eq("clinic_id", clinicaA),
      cliente.from("meta_anuncio_recusado").delete().eq("clinic_id", clinicaA),
    ];
    for (const tentativa of tentativas) {
      const { error } = await tentativa;
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("meta_anuncio_recusado")
      .select("ad_id, tentativas")
      .eq("clinic_id", clinicaA);
    expect(data).toEqual([{ ad_id: "7201", tentativas: 1 }]);
  });
});

describe("origem real: funções do resolvedor (só a service role)", () => {
  it("authenticated e anon recebem 42501; nada nasce na fila", async () => {
    const chamadas = (cliente: ReturnType<typeof anonClient>) => [
      cliente.rpc("enfileirar_resolucao_de_anuncios_meta", {
        p_clinic_id: clinicaA,
        p_origem: "teste",
      }),
      // O parametro dos testes de integracao tambem nao abre a porta.
      cliente.rpc("enfileirar_resolucao_de_anuncios_meta", {
        p_clinic_id: clinicaA,
        p_origem: "ingestao",
        p_incluir_teste: true,
      }),
      cliente.rpc("anuncios_meta_a_resolver", {
        p_clinic_id: clinicaA,
        p_ad_account_id: "act_1234567",
        p_token_sha256: "0".repeat(64),
      }),
      cliente.rpc("gravar_resolucao_de_anuncios_meta", {
        p_job_id: crypto.randomUUID(),
        p_worker: "sessao",
        p_clinic_id: clinicaA,
        p_ad_account_id: "act_1234567",
        p_token_sha256: "0".repeat(64),
        p_resolvidos: [],
        p_recusas: [],
      }),
    ];
    const sessao = await logado("admin-a");
    for (const cliente of [sessao, anonClient()]) {
      for (const chamada of chamadas(cliente)) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("kind", "resolver_anuncio_meta");
    expect(jobs).toEqual([]);
  });
});

describe("origem real: a sessão não forja lead de anúncio", () => {
  let leadDeAnuncio = "";
  let semOrigem = "";
  const fone = (prefixo: string, preenchimento: string) =>
    `+55849${prefixo}${sufixo.replace(/\D/g, "").padEnd(6, preenchimento).slice(0, 6)}`;

  beforeAll(async () => {
    // Gravados pelo sistema: um lead de anuncio com origem real e um sem
    // origem nenhuma.
    const { data } = await admin
      .from("contact")
      .insert([
        {
          clinic_id: clinicaA,
          phone_e164: fone("81", "5"),
          name: "Lead de anuncio com origem",
          first_contact_at: "2026-09-08T15:00:00.000Z",
          ctwa_clid: `clid-origem-${sufixo}`,
          source_ad_id: "7101",
          source_channel: "trafego_pago",
          source_origin: "Meta",
          source_method: "anuncio_ctwa",
          source_captured_at: "2026-09-08T15:00:00.000Z",
        },
        {
          clinic_id: clinicaA,
          phone_e164: fone("82", "6"),
          name: "Lead sem origem",
          first_contact_at: "2026-09-09T15:00:00.000Z",
        },
      ])
      .select("id, name")
      .throwOnError();
    leadDeAnuncio = data!.find((c) => c.name === "Lead de anuncio com origem")!
      .id as string;
    semOrigem = data!.find((c) => c.name === "Lead sem origem")!.id as string;
  });

  it("insert ou update para anuncio_ctwa devolve 42501 para recepção, gestor e admin", async () => {
    for (const papel of ["recepcao-a", "gestor-a", "admin-a"]) {
      const cliente = await logado(papel);
      const { error: criar } = await cliente.from("contact").insert({
        clinic_id: clinicaA,
        phone_e164: fone("83", "7"),
        name: "Forjado",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "Instagram",
        source_method: "anuncio_ctwa",
      });
      expect(criar?.code, papel).toBe(PERMISSAO_NEGADA);
      const { error: mudar } = await cliente
        .from("contact")
        .update({
          source_channel: "trafego_pago",
          source_origin: "Meta",
          source_method: "anuncio_ctwa",
          source_captured_at: new Date().toISOString(),
        })
        .eq("id", semOrigem);
      expect(mudar?.code, papel).toBe(PERMISSAO_NEGADA);
    }
    const { data: depois } = await admin
      .from("contact")
      .select("source_channel, source_method")
      .eq("id", semOrigem)
      .single();
    expect(depois).toEqual({ source_channel: null, source_method: null });
    const { data: forjado } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("phone_e164", fone("83", "7"));
    expect(forjado).toEqual([]);
  });

  it("contraprova: a recepção edita o lead de anúncio reenviando o método e grava origem manual", async () => {
    const cliente = await logado("recepcao-a");
    const { data: editado, error } = await cliente
      .from("contact")
      .update({
        name: "Lead de anuncio renomeado",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_method: "anuncio_ctwa",
      })
      .eq("id", leadDeAnuncio)
      .select("id");
    expect(error).toBeNull();
    expect(editado).toHaveLength(1);
    const { data: depois } = await admin
      .from("contact")
      .select("name, source_method, source_ad_id")
      .eq("id", leadDeAnuncio)
      .single();
    expect(depois).toEqual({
      name: "Lead de anuncio renomeado",
      source_method: "anuncio_ctwa",
      source_ad_id: "7101",
    });
    const { error: manual } = await cliente.from("contact").insert({
      clinic_id: clinicaA,
      phone_e164: fone("84", "8"),
      name: "Origem manual",
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "manual",
      source_captured_at: new Date().toISOString(),
    });
    expect(manual).toBeNull();
  });
});
