import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Clique rastreado pelo site (migration 20261005100000, F1 do Google),
// contra o banco real. O que esta em jogo:
// - clique_do_site guarda gclid, gbraid e wbraid (identificadores): nenhuma
//   sessao le nem escreve, nem o admin, nem anon (42501); so o sistema;
// - rastreio_do_site: administrador e gestor ativos da propria clinica leem
//   (com a chave), criam (so clinic_id e ativo) e ligam ou desligam (so
//   ativo); recepcao, leitura, profissional, pendente e outra clinica nao
//   veem nem mudam; a chave so troca pela RPC;
// - trocar_chave_do_rastreio e situacao_do_rastreio: so a gestao (42501
//   para os demais); a situacao so traz agregados;
// - registrar, casar e podar: 42501 para qualquer sessao;
// - contact: a sessao nao grava a origem clique_site nem os ids do Google
//   (42501); reenviar o valor ja gravado passa; o membro le as colunas
//   novas da propria clinica e a outra clinica nao.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Clinicas
// e_de_teste, apagadas no afterAll.

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "CliqueSite!Rls2026";

const email = (papel: string) => `cliquesite-${papel}-${sufixo}@teste.dev`;

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
let contatoDoGoogle = "";
let contatoSemOrigem = "";

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
      name: `CliqueSite ${nome} ${sufixo}`,
      slug: `cliquesite-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

const digitos = sufixo.replace(/\D/g, "").padEnd(6, "7").slice(0, 6);

async function rastreioDaA() {
  const { data } = await admin
    .from("rastreio_do_site")
    .select("ativo, chave, chave_trocada_em, ultimo_clique_em")
    .eq("clinic_id", clinicaA)
    .maybeSingle()
    .throwOnError();
  return data;
}

const NAO_GESTAO_DA_A = [
  "recepcao-a",
  "leitura-a",
  "prof-a",
  "pendente-a",
  "admin-b",
] as const;

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Site" })
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
  await criarUsuario("pendente-a", clinicaA, "gestor", { status: "pendente" });
  await criarUsuario("admin-b", clinicaB, "admin");

  // Um clique casado pelo sistema: o contato ganha a origem do Google.
  const { data: rastreio } = await admin
    .from("rastreio_do_site")
    .insert({ clinic_id: clinicaB, ativo: true })
    .select("chave")
    .single()
    .throwOnError();
  expect(rastreio!.chave).toMatch(/^[0-9a-f]{20}$/);

  const { data: contatos } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicaA,
        phone_e164: `+5584971${digitos}`,
        name: "Lead do Google",
      },
      {
        clinic_id: clinicaA,
        phone_e164: `+5584972${digitos}`,
        name: "Lead sem origem",
      },
    ])
    .select("id, name")
    .throwOnError();
  contatoDoGoogle = contatos!.find((c) => c.name === "Lead do Google")!
    .id as string;
  contatoSemOrigem = contatos!.find((c) => c.name === "Lead sem origem")!
    .id as string;
  await admin
    .from("clique_do_site")
    .insert({
      clinic_id: clinicaA,
      codigo: "K7Q2MX",
      gclid: `gclid-${sufixo}`,
      google_campaign_id: "123",
      google_adgroup_id: "456",
    })
    .throwOnError();
  const { data: casado, error } = await admin.rpc("casar_clique_do_site", {
    p_clinic_id: clinicaA,
    p_contact_id: contatoDoGoogle,
    p_codigo: "K7Q2MX",
  });
  expect(error).toBeNull();
  expect(casado).toBe("origem_gravada");
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

describe("clique_do_site (so o sistema)", () => {
  it("nenhuma sessao le nem escreve, nem o admin; o sistema le", async () => {
    for (const papel of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "prof-a",
      "pendente-a",
      "admin-b",
    ]) {
      const cliente = await logado(papel);
      const tentativas = [
        cliente.from("clique_do_site").select("gclid"),
        cliente
          .from("clique_do_site")
          .select("clinic_id")
          .eq("clinic_id", clinicaA),
        cliente
          .from("clique_do_site")
          .insert({ clinic_id: clinicaA, codigo: "TTT234", gclid: "x" }),
        cliente
          .from("clique_do_site")
          .update({ contact_id: contatoSemOrigem })
          .eq("clinic_id", clinicaA),
        cliente.from("clique_do_site").delete().eq("clinic_id", clinicaA),
      ];
      for (const tentativa of tentativas) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    const { data } = await admin
      .from("clique_do_site")
      .select("codigo, gclid, contact_id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(data).toEqual([
      {
        codigo: "K7Q2MX",
        gclid: `gclid-${sufixo}`,
        contact_id: contatoDoGoogle,
      },
    ]);
  });
});

describe("rastreio_do_site", () => {
  it("antes de existir, so a gestao cria; a chave nasce no banco", async () => {
    for (const papel of ["recepcao-a", "leitura-a", "prof-a", "pendente-a"]) {
      const cliente = await logado(papel);
      const { error } = await cliente
        .from("rastreio_do_site")
        .insert({ clinic_id: clinicaA, ativo: true });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await rastreioDaA()).toBeNull();
    // admin da B nao cria para a A; nem escolhe a chave
    const b = await logado("admin-b");
    const { error: daB } = await b
      .from("rastreio_do_site")
      .insert({ clinic_id: clinicaA, ativo: true });
    expect(daB?.code).toBe(PERMISSAO_NEGADA);
    const adminA = await logado("admin-a");
    const { error: comChave } = await adminA
      .from("rastreio_do_site")
      .insert({ clinic_id: clinicaA, ativo: true, chave: "a".repeat(20) });
    expect(comChave?.code).toBe(PERMISSAO_NEGADA);
    // contraprova: o admin da A cria
    const { error } = await adminA
      .from("rastreio_do_site")
      .insert({ clinic_id: clinicaA, ativo: true });
    expect(error).toBeNull();
    const rastreio = await rastreioDaA();
    expect(rastreio!.ativo).toBe(true);
    expect(rastreio!.chave).toMatch(/^[0-9a-f]{20}$/);
    expect(rastreio!.ultimo_clique_em).toBeNull();
  });

  it("admin e gestor da A leem a chave; os demais e a B nao veem nada", async () => {
    const { chave } = (await rastreioDaA())!;
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("rastreio_do_site")
        .select("clinic_id, chave, ativo");
      expect(error).toBeNull();
      expect(data).toEqual([{ clinic_id: clinicaA, chave, ativo: true }]);
    }
    for (const papel of NAO_GESTAO_DA_A) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("rastreio_do_site")
        .select("chave")
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    // contraprova da B: le o proprio
    const b = await logado("admin-b");
    const { data: daB } = await b
      .from("rastreio_do_site")
      .select("clinic_id")
      .eq("clinic_id", clinicaB);
    expect(daB).toEqual([{ clinic_id: clinicaB }]);
  });

  it("gestor liga e desliga; os demais nao mudam nada", async () => {
    for (const papel of NAO_GESTAO_DA_A) {
      const cliente = await logado(papel);
      const { error } = await cliente
        .from("rastreio_do_site")
        .update({ ativo: false })
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect((await rastreioDaA())!.ativo).toBe(true);
    }
    const gestor = await logado("gestor-a");
    const { error } = await gestor
      .from("rastreio_do_site")
      .update({ ativo: false })
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect((await rastreioDaA())!.ativo).toBe(false);
    await gestor
      .from("rastreio_do_site")
      .update({ ativo: true })
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect((await rastreioDaA())!.ativo).toBe(true);
  });

  it("a sessao nao troca a chave direto, nao grava as datas, nao muda a clinica e nao apaga", async () => {
    const antes = await rastreioDaA();
    const adminA = await logado("admin-a");
    const tentativas = [
      adminA
        .from("rastreio_do_site")
        .update({ chave: "b".repeat(20) })
        .eq("clinic_id", clinicaA),
      adminA
        .from("rastreio_do_site")
        .update({ ultimo_clique_em: new Date().toISOString() })
        .eq("clinic_id", clinicaA),
      adminA
        .from("rastreio_do_site")
        .update({ chave_trocada_em: new Date().toISOString() })
        .eq("clinic_id", clinicaA),
      adminA
        .from("rastreio_do_site")
        .update({ clinic_id: clinicaB })
        .eq("clinic_id", clinicaA),
      adminA.from("rastreio_do_site").delete().eq("clinic_id", clinicaA),
    ];
    for (const tentativa of tentativas) {
      const { error } = await tentativa;
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await rastreioDaA()).toEqual(antes);
  });

  it("anon nao chega no rastreio", async () => {
    const { error } = await anonClient()
      .from("rastreio_do_site")
      .select("chave");
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("trocar_chave_do_rastreio e situacao_do_rastreio", () => {
  it("admin e gestor trocam a chave; os demais recebem 42501 e a chave fica", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const antes = (await rastreioDaA())!.chave;
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("trocar_chave_do_rastreio", {
        p_clinic_id: clinicaA,
      });
      expect(error).toBeNull();
      expect(data).toMatch(/^[0-9a-f]{20}$/);
      expect(data).not.toBe(antes);
      const depois = await rastreioDaA();
      expect(depois!.chave).toBe(data);
      expect(depois!.ativo).toBe(true);
    }
    const chave = (await rastreioDaA())!.chave;
    for (const papel of NAO_GESTAO_DA_A) {
      const cliente = await logado(papel);
      const { error } = await cliente.rpc("trocar_chave_do_rastreio", {
        p_clinic_id: clinicaA,
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect((await rastreioDaA())!.chave).toBe(chave);
  });

  it("a situacao so traz agregados, so para a gestao", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("situacao_do_rastreio", {
        p_clinic_id: clinicaA,
      });
      expect(error).toBeNull();
      const situacao = data as Record<string, unknown>;
      expect(Object.keys(situacao).sort()).toEqual([
        "ativo",
        "casados_7_dias",
        "chave_trocada_em",
        "cliques_7_dias",
        "configurado",
        "ultimo_clique_em",
      ]);
      expect(situacao).toMatchObject({
        configurado: true,
        ativo: true,
        cliques_7_dias: 1,
        casados_7_dias: 1,
      });
    }
    for (const papel of NAO_GESTAO_DA_A) {
      const cliente = await logado(papel);
      const { error } = await cliente.rpc("situacao_do_rastreio", {
        p_clinic_id: clinicaA,
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });

  it("registrar, casar e podar: 42501 para qualquer sessao", async () => {
    const { chave } = (await rastreioDaA())!;
    for (const papel of ["admin-a", "gestor-a", "recepcao-a"]) {
      const cliente = await logado(papel);
      const chamadas = [
        cliente.rpc("registrar_clique_do_site", {
          p_chave: chave,
          p_codigo: "FFF234",
          p_gclid: "g",
        }),
        cliente.rpc("casar_clique_do_site", {
          p_clinic_id: clinicaA,
          p_contact_id: contatoSemOrigem,
          p_codigo: "K7Q2MX",
        }),
        cliente.rpc("podar_cliques_do_site", {}),
      ];
      for (const chamada of chamadas) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    const { data } = await admin
      .from("clique_do_site")
      .select("codigo")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(data).toEqual([{ codigo: "K7Q2MX" }]);
  });
});

describe("contact: origem clique_site e ids do Google", () => {
  it("a sessao nao grava clique_site nem os ids do Google (42501)", async () => {
    for (const papel of ["recepcao-a", "gestor-a", "admin-a"]) {
      const cliente = await logado(papel);
      const tentativas = [
        cliente.from("contact").insert({
          clinic_id: clinicaA,
          phone_e164: `+5584973${digitos}`,
          name: "Forjado",
          source_channel: "trafego_pago",
          source_origin: "Google",
          source_method: "clique_site",
        }),
        cliente.from("contact").insert({
          clinic_id: clinicaA,
          phone_e164: `+5584973${digitos}`,
          name: "Forjado",
          source_channel: "trafego_pago",
          source_origin: "Google",
          source_method: "manual",
          source_google_campaign_id: "123",
        }),
        cliente
          .from("contact")
          .update({
            source_channel: "trafego_pago",
            source_origin: "Google",
            source_method: "clique_site",
            source_captured_at: new Date().toISOString(),
          })
          .eq("id", contatoSemOrigem),
        cliente
          .from("contact")
          .update({ source_google_campaign_id: "123" })
          .eq("id", contatoSemOrigem),
        cliente
          .from("contact")
          .update({ source_google_adgroup_id: "456" })
          .eq("id", contatoSemOrigem),
      ];
      for (const tentativa of tentativas) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    const { data } = await admin
      .from("contact")
      .select(
        "source_channel, source_method, source_google_campaign_id, source_google_adgroup_id",
      )
      .eq("id", contatoSemOrigem)
      .single()
      .throwOnError();
    expect(data).toEqual({
      source_channel: null,
      source_method: null,
      source_google_campaign_id: null,
      source_google_adgroup_id: null,
    });
  });

  it("reenviar os valores ja gravados passa (formulario com a linha inteira)", async () => {
    const recepcao = await logado("recepcao-a");
    const { error } = await recepcao
      .from("contact")
      .update({
        name: "Lead do Google renomeado",
        source_channel: "trafego_pago",
        source_origin: "Google",
        source_method: "clique_site",
        source_google_campaign_id: "123",
        source_google_adgroup_id: "456",
      })
      .eq("id", contatoDoGoogle);
    expect(error).toBeNull();
    const { data } = await admin
      .from("contact")
      .select("name, source_method, source_google_campaign_id")
      .eq("id", contatoDoGoogle)
      .single()
      .throwOnError();
    expect(data).toEqual({
      name: "Lead do Google renomeado",
      source_method: "clique_site",
      source_google_campaign_id: "123",
    });
  });

  it("membro da A le a campanha do Google; a B nao le o contato", async () => {
    for (const papel of ["admin-a", "recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("contact")
        .select(
          "source_origin, source_google_campaign_id, source_google_adgroup_id",
        )
        .eq("id", contatoDoGoogle);
      expect(error).toBeNull();
      expect(data).toEqual([
        {
          source_origin: "Google",
          source_google_campaign_id: "123",
          source_google_adgroup_id: "456",
        },
      ]);
    }
    const b = await logado("admin-b");
    const { data } = await b
      .from("contact")
      .select("id")
      .eq("id", contatoDoGoogle);
    expect(data).toEqual([]);
  });
});
