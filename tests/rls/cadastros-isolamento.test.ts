import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Revisao de liberacao (24/09/2026), migration 20260924106000:
// (1) achados 39 e 91: FK de agenda e catalogo apontando para cadastro de
//     OUTRA clinica. A FK simples so confere existencia e ignora RLS; as
//     exclusion constraints da agenda nao tem clinic_id, entao a consulta da
//     clinica A travava a agenda da B. O gatilho exigir_cadastro_da_mesma_
//     clinica recusa com 23503.
// (2) achado 35: pacote vendido nao troca de procedimento (23514), nao sai do
//     banco (23503) e pacote desativado nao e vendido (23514).
// (3) achado 7c: INSERT de message pela sessao amarrado ao autor.
// Padrao da suite: toda negacao tem o caso positivo ao lado (anti falso
// positivo), para o teste nao passar por um motivo errado.

const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Isolamento!Rls2026";

let clinicaA = "";
let clinicaB = "";
let adminAId = "";
let recepcaoAId = "";
let profA = "";
let profA2 = "";
let profB = "";
let procA = "";
let procA2 = "";
let procB = "";
let recursoB = "";
let unidadeB = "";
let convenioB = "";
let vinculoA = "";
let vinculoA2 = "";
let contatoA = "";
let contatoB = "";
let conversaA = "";
let conversaB = "";
let pacoteB = "";

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
): Promise<string> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
    })
    .throwOnError();
  return data.user!.id;
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

async function inserirId(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Isolamento A ${sufixo}`, slug: `iso-a-${sufixo}` },
      { name: `Isolamento B ${sufixo}`, slug: `iso-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("iso-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("iso-b"))!.id as string;

  adminAId = await criarUsuario(
    `iso-admin-${sufixo}@teste.dev`,
    clinicaA,
    "admin",
  );
  recepcaoAId = await criarUsuario(
    `iso-recepcao-${sufixo}@teste.dev`,
    clinicaA,
    "recepcao",
  );
  await criarUsuario(`iso-outra-${sufixo}@teste.dev`, clinicaB, "admin");

  profA = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dra. A",
  });
  profA2 = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dr. A2",
  });
  profB = await inserirId("professional", {
    clinic_id: clinicaB,
    name: "Dr. B",
  });
  procA = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Consulta A",
    default_duration_min: 30,
  });
  procA2 = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Retorno A",
    default_duration_min: 30,
  });
  procB = await inserirId("procedure", {
    clinic_id: clinicaB,
    name: "Consulta B",
    default_duration_min: 30,
  });
  recursoB = await inserirId("resource", {
    clinic_id: clinicaB,
    name: "Laser B",
    kind: "equipamento",
  });
  unidadeB = await inserirId("unit", { clinic_id: clinicaB, name: "Centro B" });
  convenioB = await inserirId("insurance", {
    clinic_id: clinicaB,
    name: "Convênio B",
  });
  vinculoA = await inserirId("service_link", {
    clinic_id: clinicaA,
    professional_id: profA,
    procedure_id: procA,
    duration_min: 30,
  });
  vinculoA2 = await inserirId("service_link", {
    clinic_id: clinicaA,
    professional_id: profA2,
    procedure_id: procA,
    duration_min: 30,
  });
  contatoA = await inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+5584982${sufixo.replace(/\D/g, "0").slice(0, 6)}1`,
    name: "Paciente A",
  });
  contatoB = await inserirId("contact", {
    clinic_id: clinicaB,
    phone_e164: `+5584982${sufixo.replace(/\D/g, "0").slice(0, 6)}2`,
    name: "Paciente B",
  });
  conversaA = await inserirId("conversation", {
    clinic_id: clinicaA,
    contact_id: contatoA,
    status: "aguardando_humano",
  });
  conversaB = await inserirId("conversation", {
    clinic_id: clinicaB,
    contact_id: contatoB,
    status: "aguardando_humano",
  });
  // Pacote VENDIDO na B: sem isto, uso_dos_pacotes da B volta vazio por
  // falta de dado, e o teste de isolamento passaria mesmo com vazamento.
  pacoteB = await inserirId("package", {
    clinic_id: clinicaB,
    procedure_id: procB,
    sessions: 5,
    price_cents: 50000,
  });
  await inserirId("package_balance", {
    clinic_id: clinicaB,
    contact_id: contatoB,
    package_id: pacoteB,
    sessions_total: 5,
  });
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("iso-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("catálogo e agenda só apontam para cadastro da mesma clínica", () => {
  it("admin da A não aponta procedimento para recurso da B", async () => {
    const cliente = await logado(`iso-admin-${sufixo}@teste.dev`);
    const { error } = await cliente
      .from("procedure")
      .update({ resource_id: recursoB })
      .eq("id", procA);
    expect(error?.code).toBe(FK_VIOLATION);
  });

  it("admin da A não cria vínculo com profissional, procedimento ou convênio da B", async () => {
    const cliente = await logado(`iso-admin-${sufixo}@teste.dev`);
    const base = { clinic_id: clinicaA, duration_min: 30 };
    const comProfB = await cliente.from("service_link").insert({
      ...base,
      professional_id: profB,
      procedure_id: procA2,
    });
    expect(comProfB.error?.code).toBe(FK_VIOLATION);
    const comProcB = await cliente.from("service_link").insert({
      ...base,
      professional_id: profA,
      procedure_id: procB,
    });
    expect(comProcB.error?.code).toBe(FK_VIOLATION);
    const comConvB = await cliente.from("service_link").insert({
      ...base,
      professional_id: profA,
      procedure_id: procA2,
      insurance_id: convenioB,
    });
    expect(comConvB.error?.code).toBe(FK_VIOLATION);

    // Anti falso positivo: o mesmo vinculo com cadastros da A entra.
    const ok = await cliente.from("service_link").insert({
      ...base,
      professional_id: profA,
      procedure_id: procA2,
    });
    expect(ok.error).toBeNull();
  });

  it("admin da A não usa profissional ou unidade da B em jornada, bloqueio e recurso", async () => {
    const cliente = await logado(`iso-admin-${sufixo}@teste.dev`);
    const jornada = await cliente.from("professional_schedule").insert({
      clinic_id: clinicaA,
      professional_id: profB,
      weekday: 1,
      starts_at: "08:00",
      ends_at: "12:00",
    });
    expect(jornada.error?.code).toBe(FK_VIOLATION);
    const jornadaUnidade = await cliente.from("professional_schedule").insert({
      clinic_id: clinicaA,
      professional_id: profA,
      weekday: 1,
      starts_at: "08:00",
      ends_at: "12:00",
      unit_id: unidadeB,
    });
    expect(jornadaUnidade.error?.code).toBe(FK_VIOLATION);
    const bloqueio = await cliente.from("professional_block").insert({
      clinic_id: clinicaA,
      professional_id: profB,
      starts_at: "2026-11-02T12:00:00Z",
      ends_at: "2026-11-02T18:00:00Z",
      reason: "Teste",
    });
    expect(bloqueio.error?.code).toBe(FK_VIOLATION);
    const recurso = await cliente.from("resource").insert({
      clinic_id: clinicaA,
      name: "Sala",
      kind: "sala",
      unit_id: unidadeB,
    });
    expect(recurso.error?.code).toBe(FK_VIOLATION);
    const pacote = await cliente.from("package").insert({
      clinic_id: clinicaA,
      procedure_id: procB,
      sessions: 10,
      price_cents: 100000,
    });
    expect(pacote.error?.code).toBe(FK_VIOLATION);
  });

  it("consulta da A não usa profissional nem recurso da B, nem vínculo de outro profissional", async () => {
    const cliente = await logado(`iso-recepcao-${sufixo}@teste.dev`);
    const base = {
      clinic_id: clinicaA,
      contact_id: contatoA,
      starts_at: "2026-11-03T12:00:00Z",
      ends_at: "2026-11-03T12:30:00Z",
    };
    const profDaB = await cliente.from("appointment").insert({
      ...base,
      professional_id: profB,
      service_link_id: vinculoA,
    });
    expect(profDaB.error?.code).toBe(FK_VIOLATION);
    const recursoDaB = await cliente.from("appointment").insert({
      ...base,
      professional_id: profA,
      service_link_id: vinculoA,
      resource_id: recursoB,
    });
    expect(recursoDaB.error?.code).toBe(FK_VIOLATION);
    const vinculoDeOutro = await cliente.from("appointment").insert({
      ...base,
      professional_id: profA,
      service_link_id: vinculoA2,
    });
    expect(vinculoDeOutro.error?.code).toBe(FK_VIOLATION);

    // Anti falso positivo: a consulta coerente entra.
    const ok = await cliente.from("appointment").insert({
      ...base,
      professional_id: profA,
      service_link_id: vinculoA,
    });
    expect(ok.error).toBeNull();
  });

  it("vínculo usuário e profissional só aceita profissional da mesma clínica", async () => {
    const cliente = await logado(`iso-admin-${sufixo}@teste.dev`);
    const cruzado = await cliente
      .from("clinic_member")
      .update({ professional_id: profB })
      .eq("clinic_id", clinicaA)
      .eq("user_id", recepcaoAId);
    expect(cruzado.error?.code).toBe(FK_VIOLATION);

    const ok = await cliente
      .from("clinic_member")
      .update({ professional_id: profA })
      .eq("clinic_id", clinicaA)
      .eq("user_id", recepcaoAId);
    expect(ok.error).toBeNull();
    await admin
      .from("clinic_member")
      .update({ professional_id: null })
      .eq("clinic_id", clinicaA)
      .eq("user_id", recepcaoAId);
  });
});

describe("pacote vendido", () => {
  it("congela o procedimento, não sai do banco e pacote desativado não é vendido", async () => {
    const gestao = await logado(`iso-admin-${sufixo}@teste.dev`);
    const recepcao = await logado(`iso-recepcao-${sufixo}@teste.dev`);
    const pacote = await inserirId("package", {
      clinic_id: clinicaA,
      procedure_id: procA,
      sessions: 10,
      price_cents: 100000,
    });

    // Antes da venda, trocar o procedimento e livre.
    const antes = await gestao
      .from("package")
      .update({ procedure_id: procA2 })
      .eq("id", pacote);
    expect(antes.error).toBeNull();

    const venda = await recepcao.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacote,
      sessions_total: 10,
    });
    expect(venda.error).toBeNull();

    const troca = await gestao
      .from("package")
      .update({ procedure_id: procA })
      .eq("id", pacote);
    expect(troca.error?.code).toBe(CHECK_VIOLATION);

    // Preco e sessoes continuam editaveis (nao mexem no saldo vendido).
    const preco = await gestao
      .from("package")
      .update({ price_cents: 120000 })
      .eq("id", pacote);
    expect(preco.error).toBeNull();

    const apagar = await gestao.from("package").delete().eq("id", pacote);
    expect(apagar.error?.code).toBe(FK_VIOLATION);

    const desativar = await gestao
      .from("package")
      .update({ active: false })
      .eq("id", pacote);
    expect(desativar.error).toBeNull();
    const vendaDesativado = await recepcao.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacote,
      sessions_total: 10,
    });
    expect(vendaDesativado.error?.code).toBe(CHECK_VIOLATION);

    const { data: uso, error: erroUso } = await recepcao.rpc(
      "uso_dos_pacotes",
      { p_clinic_id: clinicaA },
    );
    expect(erroUso).toBeNull();
    const linha = (
      uso as {
        package_id: string;
        vendas: number;
        pacientes_com_saldo: number;
      }[]
    ).find((u) => u.package_id === pacote);
    expect(linha?.vendas).toBe(1);
    expect(linha?.pacientes_com_saldo).toBe(1);
  });

  it("uso_dos_pacotes da B não aparece para a A", async () => {
    type Uso = {
      package_id: string;
      vendas: number;
      pacientes_com_saldo: number;
    };

    // Anti falso positivo: a venda da B existe e a propria B a enxerga pela
    // mesma RPC. Sem isto o vazio abaixo poderia ser so falta de dado.
    const daB = await logado(`iso-outra-${sufixo}@teste.dev`);
    const propria = await daB.rpc("uso_dos_pacotes", {
      p_clinic_id: clinicaB,
    });
    expect(propria.error).toBeNull();
    const linhaDaB = ((propria.data ?? []) as Uso[]).find(
      (u) => u.package_id === pacoteB,
    );
    expect(linhaDaB?.vendas).toBe(1);
    expect(linhaDaB?.pacientes_com_saldo).toBe(1);

    // A recepcao da A pede a B pelo id: sem erro (a chamada e permitida) e
    // sem nenhuma linha. Erro da RPC NAO conta como isolamento.
    const recepcao = await logado(`iso-recepcao-${sufixo}@teste.dev`);
    const alheia = await recepcao.rpc("uso_dos_pacotes", {
      p_clinic_id: clinicaB,
    });
    expect(alheia.error).toBeNull();
    expect(alheia.data).toEqual([]);
  });
});

describe("mensagem gravada pela sessão é da própria pessoa", () => {
  it("recepção não grava mensagem como se fosse do paciente nem em nome de colega", async () => {
    const recepcao = await logado(`iso-recepcao-${sufixo}@teste.dev`);
    const doPaciente = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "entrada",
      author: "contato",
      content_type: "texto",
      body: "forjada",
    });
    expect(doPaciente.error?.code).toBe(RLS_VIOLATION);

    const deColega = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      author: "usuario",
      author_user_id: adminAId,
      content_type: "texto",
      body: "forjada",
      is_internal_note: true,
    });
    expect(deColega.error?.code).toBe(RLS_VIOLATION);

    const comIdDoWhatsapp = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      author: "usuario",
      author_user_id: recepcaoAId,
      content_type: "texto",
      body: "forjada",
      wa_message_id: `forjado-${sufixo}`,
    });
    expect(comIdDoWhatsapp.error?.code).toBe(RLS_VIOLATION);

    const naConversaDaB = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaB,
      direction: "saida",
      author: "usuario",
      author_user_id: recepcaoAId,
      content_type: "texto",
      body: "forjada",
      is_internal_note: true,
    });
    expect(naConversaDaB.error?.code).toBe(RLS_VIOLATION);
  });

  it("os caminhos legítimos do Inbox continuam: nota interna e evento de sistema", async () => {
    const recepcao = await logado(`iso-recepcao-${sufixo}@teste.dev`);
    const nota = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      author: "usuario",
      author_user_id: recepcaoAId,
      content_type: "texto",
      body: "nota",
      is_internal_note: true,
    });
    expect(nota.error).toBeNull();

    const evento = await recepcao.from("message").insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      author: "sistema",
      content_type: "evento",
      body: "Recepção assumiu a conversa",
    });
    expect(evento.error).toBeNull();
  });
});
