import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Retorno de conversao a Meta, fase 1 (migration 20260910100000): as tres
// tabelas novas. O que esta em jogo: configuracao de anuncio e estrategia
// comercial (isolamento entre clinicas), o token da CAPI da acesso a conta
// de anuncios da clinica (NINGUEM le pela sessao, nem admin), e
// conversion_event so o sistema escreve (um evento forjado viraria conversao
// falsa nos anuncios do cliente).

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Conversao!Rls2026";

let clinicaA = "";
let clinicaB = "";
let contatoA = "";

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  await admin.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: data.user!.id,
    role,
    status: "ativo",
  });
}

async function logado(email: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

const email = (papel: string) => `convmeta-${papel}-${sufixo}@teste.dev`;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Conv A ${sufixo}`,
        slug: `conv-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Conv B ${sufixo}`,
        slug: `conv-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `conv-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `conv-b-${sufixo}`)!.id as string;

  await Promise.all([
    criarUsuario(email("admin-a"), clinicaA, "admin"),
    criarUsuario(email("leitura-a"), clinicaA, "leitura"),
    criarUsuario(email("gestor-b"), clinicaB, "gestor"),
  ]);

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+5584973${String(Date.now()).slice(-6)}`,
      name: "Contato Conversao",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = contato!.id as string;

  // Uma conversao registrada pelo SISTEMA (service role), como o gatilho fara.
  await admin
    .from("conversion_event")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      stage_chave: "agendou",
      event_name: "Schedule",
      value_cents: 20000,
    })
    .throwOnError();

  // Conta configurada na clinica A, para as provas de isolamento.
  await admin
    .from("meta_ads_account")
    .insert({ clinic_id: clinicaA, pixel_id: "123456789012345" })
    .throwOnError();
  await admin
    .from("meta_ads_account_secret")
    .insert({ clinic_id: clinicaA, capi_access_token: `tok-${sufixo}` })
    .throwOnError();
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

describe("conversion_event", () => {
  it("membro lê as conversões da própria clínica; as da outra voltam vazias", async () => {
    const cliente = await logado(email("leitura-a"));
    const { data: minhas } = await cliente
      .from("conversion_event")
      .select("event_name")
      .eq("clinic_id", clinicaA);
    expect(minhas).toHaveLength(1);

    const clienteB = await logado(email("gestor-b"));
    const { data: alheias, error } = await clienteB
      .from("conversion_event")
      .select("event_name")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(alheias).toHaveLength(0);
    // Contraprova anti falso-positivo.
    const { data: prova } = await admin
      .from("conversion_event")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(prova).toHaveLength(1);
  });

  it("NENHUM papel insere ou edita conversão pela sessão, nem admin", async () => {
    const cliente = await logado(email("admin-a"));
    const { error: erroInsert } = await cliente
      .from("conversion_event")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        stage_chave: "compareceu",
        event_name: "Purchase",
      });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    const { error: erroUpdate } = await cliente
      .from("conversion_event")
      .update({ status: "enviado" })
      .eq("clinic_id", clinicaA);
    expect(erroUpdate).toBeNull(); // zero linhas afetadas, sem erro
    const { data: prova } = await admin
      .from("conversion_event")
      .select("status")
      .eq("clinic_id", clinicaA)
      .single();
    expect(prova!.status).toBe("registrado");
  });

  it("agregado do painel respeita a RLS: clínica B vê tudo zerado da A", async () => {
    const clienteA = await logado(email("leitura-a"));
    const { data: meu } = await clienteA.rpc("conversoes_devolvidas_da_clinica", {
      p_clinic_id: clinicaA,
    });
    expect(
      (meu as { por_status: Record<string, number> }).por_status.registrado,
    ).toBe(1);

    const clienteB = await logado(email("gestor-b"));
    const { data: alheio } = await clienteB.rpc(
      "conversoes_devolvidas_da_clinica",
      { p_clinic_id: clinicaA },
    );
    expect((alheio as { por_status: object }).por_status).toEqual({});
  });
});

describe("meta_ads_account", () => {
  it("gestão lê e escreve a própria conta; a da outra clínica é invisível", async () => {
    const clienteA = await logado(email("admin-a"));
    const { data: minha } = await clienteA
      .from("meta_ads_account")
      .select("pixel_id")
      .eq("clinic_id", clinicaA)
      .maybeSingle();
    expect(minha?.pixel_id).toBe("123456789012345");

    const clienteB = await logado(email("gestor-b"));
    const { data: alheia } = await clienteB
      .from("meta_ads_account")
      .select("pixel_id")
      .eq("clinic_id", clinicaA)
      .maybeSingle();
    expect(alheia).toBeNull();
    const { error: erroEscrita } = await clienteB
      .from("meta_ads_account")
      .insert({ clinic_id: clinicaA, pixel_id: "999" });
    expect(erroEscrita?.code).toBe(RLS_VIOLATION);
  });

  it("papel leitura não vê a conta nem escreve nela", async () => {
    const cliente = await logado(email("leitura-a"));
    const { data } = await cliente
      .from("meta_ads_account")
      .select("pixel_id")
      .eq("clinic_id", clinicaA)
      .maybeSingle();
    expect(data).toBeNull();
    const { error } = await cliente
      .from("meta_ads_account")
      .insert({ clinic_id: clinicaB, pixel_id: "111" });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("o embargo da decisão D6 segura no banco: nem o service role escolhe o modo", async () => {
    // A trava NAO e a tela (regra 3.4: esconder botao nao protege nada). O
    // gatilho recusa qualquer modo_user_data ate a migration de liberacao,
    // por INSERT e por UPDATE, ate para o service role.
    const { error: porUpdate } = await admin
      .from("meta_ads_account")
      .update({ modo_user_data: "telefone_hasheado" })
      .eq("clinic_id", clinicaA);
    expect(porUpdate?.message).toContain("decisão de privacidade pendente");

    const { error: porInsert } = await admin.from("meta_ads_account").insert({
      clinic_id: clinicaB,
      pixel_id: "555555555555555",
      modo_user_data: "ctwa_apenas",
    });
    expect(porInsert?.message).toContain("decisão de privacidade pendente");

    // E pela SESSAO de quem gerencia (o caminho do achado da revisao; a
    // policy trata admin e gestor na mesma clausula): recusado.
    const cliente = await logado(email("admin-a"));
    const { error: porSessao } = await cliente
      .from("meta_ads_account")
      .update({ modo_user_data: "telefone_hasheado", envio_ativado: true })
      .eq("clinic_id", clinicaA);
    expect(porSessao?.message).toContain("decisão de privacidade pendente");
  });

  it("sem modo o envio não liga (CHECK); sem token, nem com tudo o mais", async () => {
    // Clinica A tem token mas nao tem modo: o CHECK barra.
    const { error: semModo } = await admin
      .from("meta_ads_account")
      .update({ envio_ativado: true })
      .eq("clinic_id", clinicaA);
    expect(semModo?.code).toBe("23514");

    // Clinica B sem token: o gatilho barra antes (INSERT direto com envio).
    const { error: semToken } = await admin.from("meta_ads_account").insert({
      clinic_id: clinicaB,
      pixel_id: "555555555555555",
      envio_ativado: true,
    });
    // Sem modo cai no CHECK; o que importa e que NAO entra ligado.
    expect(semToken).not.toBeNull();
    const { data: prova } = await admin
      .from("meta_ads_account")
      .select("envio_ativado")
      .eq("clinic_id", clinicaB)
      .maybeSingle();
    expect(prova?.envio_ativado ?? false).toBe(false);
  });
});

describe("meta_ads_account_secret", () => {
  it("o token é ilegível e inescrevível pela sessão, até para o admin da clínica", async () => {
    const cliente = await logado(email("admin-a"));
    const { data, error } = await cliente
      .from("meta_ads_account_secret")
      .select("capi_access_token")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    // Contraprova: o token existe.
    const { data: prova } = await admin
      .from("meta_ads_account_secret")
      .select("capi_access_token")
      .eq("clinic_id", clinicaA)
      .single();
    expect(prova!.capi_access_token).toBe(`tok-${sufixo}`);

    const { error: erroEscrita } = await cliente
      .from("meta_ads_account_secret")
      .insert({ clinic_id: clinicaA, capi_access_token: "forjado" });
    expect(erroEscrita?.code).toBe(RLS_VIOLATION);
  });
});
