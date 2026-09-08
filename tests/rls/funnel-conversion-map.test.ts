import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Frente de Resultados (docs/06, Caminho B): o mapa de conversao diz qual
// etapa do funil dispara qual evento para a Meta, e qual o valor. Isso decide
// dinheiro (a otimizacao da conta de anuncios da clinica), entao o isolamento
// nao pode depender de tela: uma clinica nao pode LER nem ESCREVER o mapa da
// outra, e dentro da clinica so admin e gestor mexem (mesma matriz de
// campaign_link, que a migration espelha de proposito).
//
// Padrao da suite: select barrado por RLS retorna VAZIO, nao erro; toda
// negacao tem contraprova via service role, senao um schema quebrado passaria
// como "isolado".

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Mapa!Rls2026";

let clinicaA = "";
let clinicaB = "";
let mapaA = "";

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

const email = (papel: string) => `mapa-${papel}-${sufixo}@teste.dev`;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Mapa A ${sufixo}`, slug: `mapa-a-${sufixo}`, e_de_teste: true },
      { name: `Mapa B ${sufixo}`, slug: `mapa-b-${sufixo}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `mapa-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `mapa-b-${sufixo}`)!.id as string;

  await Promise.all([
    criarUsuario(email("gestor-a"), clinicaA, "gestor"),
    criarUsuario(email("recepcao-a"), clinicaA, "recepcao"),
    criarUsuario(email("leitura-a"), clinicaA, "leitura"),
    criarUsuario(email("admin-b"), clinicaB, "admin"),
  ]);

  const { data: mapa } = await admin
    .from("funnel_conversion_map")
    .insert({
      clinic_id: clinicaA,
      trigger_stage: "compareceu",
      meta_event_name: "Purchase",
      is_sale: true,
      value_source: "fixo",
      value_cents: 20000,
    })
    .select("id")
    .single()
    .throwOnError();
  mapaA = mapa!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("leitura do mapa de conversão", () => {
  it("membro ativo da própria clínica lê", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { data, error } = await cliente
      .from("funnel_conversion_map")
      .select("id, trigger_stage, meta_event_name")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.meta_event_name).toBe("Purchase");
  });

  it("membro de OUTRA clínica recebe vazio, nunca a configuração alheia", async () => {
    // O mapa revela a estratégia comercial da clínica (o que ela considera
    // venda e por quanto). Vazio, não erro, é o contrato da RLS de select.
    const cliente = await logado(email("admin-b"));
    const { data, error } = await cliente
      .from("funnel_conversion_map")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // Contraprova anti falso-positivo: a linha EXISTE quando quem olha é o
    // service role. Sem isto, uma tabela vazia por bug passaria como isolada.
    const { data: prova } = await admin
      .from("funnel_conversion_map")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(prova).toHaveLength(1);
  });
});

describe("escrita do mapa de conversão", () => {
  it("gestor da clínica cria e edita", async () => {
    const cliente = await logado(email("gestor-a"));
    const { data: criada, error: erroInsert } = await cliente
      .from("funnel_conversion_map")
      .insert({
        clinic_id: clinicaA,
        trigger_stage: "agendou",
        meta_event_name: "Schedule",
      })
      .select("id")
      .single();
    expect(erroInsert).toBeNull();

    const { error: erroUpdate } = await cliente
      .from("funnel_conversion_map")
      .update({ meta_event_name: "Lead" })
      .eq("id", criada!.id);
    expect(erroUpdate).toBeNull();

    await admin.from("funnel_conversion_map").delete().eq("id", criada!.id);
  });

  it("recepção não escreve, mesmo lendo", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error } = await cliente.from("funnel_conversion_map").insert({
      clinic_id: clinicaA,
      trigger_stage: "novo",
      meta_event_name: "Lead",
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("leitura não escreve nada", async () => {
    const cliente = await logado(email("leitura-a"));
    const { error } = await cliente
      .from("funnel_conversion_map")
      .update({ is_sale: false })
      .eq("id", mapaA);
    // Update barrado por RLS afeta zero linhas; a contraprova é a linha
    // continuar como estava.
    expect(error).toBeNull();
    const { data: prova } = await admin
      .from("funnel_conversion_map")
      .select("is_sale")
      .eq("id", mapaA)
      .single();
    expect(prova!.is_sale).toBe(true);
  });

  it("gestor de A não planta configuração em B", async () => {
    // O ataque que importa: o with_check da policy é quem barra escrever com o
    // clinic_id de outra clínica, não a tela.
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.from("funnel_conversion_map").insert({
      clinic_id: clinicaB,
      trigger_stage: "compareceu",
      meta_event_name: "Purchase",
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    const { data: prova } = await admin
      .from("funnel_conversion_map")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(prova).toHaveLength(0);
  });

  it("uma etapa só mapeia um evento por clínica (unique)", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.from("funnel_conversion_map").insert({
      clinic_id: clinicaA,
      trigger_stage: "compareceu",
      meta_event_name: "Lead",
    });
    // 23505 = unique_violation: duas linhas para a mesma etapa fariam a mesma
    // conversão disparar duas vezes para a Meta.
    expect(error?.code).toBe("23505");
  });
});
