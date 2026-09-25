import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Duas escritas novas das telas de Confirmacoes e Automacoes (adocao do
// design system, 24/09/2026), provadas no banco e nao na tela:
//
// 1. "Manter o horario" (revisao da leva 1, R12): a recepcao zera
//    appointment.remarcacao_pedida_em de uma consulta da propria clinica,
//    inclusive ja confirmada, sem mudar status nem horario. Papel leitura e
//    membro de outra clinica nao zeram (user_can_write na policy).
// 2. Numero de faltas da regua reforcada editavel depois de criada (achado
//    53): administrador e gestor mudam no_show_threshold; a recepcao nao
//    configura regua; o banco recusa numero menor que 1.
//
// Padrao da suite: update barrado por RLS devolve ZERO linhas, nao erro; toda
// negacao confere o valor no banco pelo service role (anti falso-positivo).

const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Manter!Rls2026";

type Chave = "gestor" | "recepcao" | "leitura" | "adminB";

const sessoes = {} as Record<Chave, SupabaseClient>;

let clinicaA = "";
let clinicaB = "";
let profA = "";
let vinculoA = "";
let contatoA = "";
let reforcadaA = "";

function endereco(chave: Chave): string {
  return `manter-${chave.toLowerCase()}-${sufixo}@teste.dev`;
}

async function criarUsuario(chave: Chave, clinicId: string, role: string) {
  const email = endereco(chave);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: chave },
  });
  if (error || !data?.user) {
    throw new Error(`criar ${email}: ${error?.message}`);
  }
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
}

async function logado(chave: Chave): Promise<SupabaseClient> {
  const cliente = anonClient();
  const email = endereco(chave);
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

function emDias(dias: number, hora = 13): Date {
  const d = new Date(Date.now() + dias * 86_400_000);
  d.setUTCHours(hora, 0, 0, 0);
  return d;
}

// Um dia por consulta: a exclusion constraint impede duas consultas do mesmo
// profissional no mesmo horario.
let proximoDia = 4;

/** Consulta futura da clinica A com o pedido de remarcacao em aberto. */
async function consultaComPedido(status: string): Promise<string> {
  const inicio = emDias(proximoDia++);
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      professional_id: profA,
      service_link_id: vinculoA,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      status,
      remarcacao_pedida_em: new Date().toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function consultaNoBanco(id: string) {
  const { data } = await admin
    .from("appointment")
    .select("status, starts_at, remarcacao_pedida_em")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    starts_at: string;
    remarcacao_pedida_em: string | null;
  };
}

async function limiarNoBanco(): Promise<number> {
  const { data } = await admin
    .from("cadence")
    .select("no_show_threshold")
    .eq("id", reforcadaA)
    .single()
    .throwOnError();
  return data!.no_show_threshold as number;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Manter A ${sufixo}`, slug: `manter-a-${sufixo}` },
      { name: `Manter B ${sufixo}`, slug: `manter-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("manter-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("manter-b"))!.id as string;

  // Canal falso nas duas: nenhum teste pode encostar no WhatsApp real.
  await admin
    .from("whatsapp_account")
    .insert([
      { clinic_id: clinicaA, provider: "fake", connection_status: "conectado" },
      { clinic_id: clinicaB, provider: "fake", connection_status: "conectado" },
    ])
    .throwOnError();

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Manter" })
    .select("id")
    .single()
    .throwOnError();
  profA = prof!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicaA, name: "Consulta Manter" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicaA,
      professional_id: profA,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculoA = vinculo!.id as string;

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+55849${sufixo.replace(/\D/g, "6").slice(0, 7).padStart(7, "6")}`,
      name: "Paciente Manter",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = contato!.id as string;

  // A reforcada nasce desligada, como a action cria (active false).
  const { data: reforcada } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Confirmação reforçada",
      for_no_show_history: true,
      no_show_threshold: 2,
      active: false,
    })
    .select("id")
    .single()
    .throwOnError();
  reforcadaA = reforcada!.id as string;

  await criarUsuario("gestor", clinicaA, "gestor");
  await criarUsuario("recepcao", clinicaA, "recepcao");
  await criarUsuario("leitura", clinicaA, "leitura");
  await criarUsuario("adminB", clinicaB, "admin");
  for (const chave of ["gestor", "recepcao", "leitura", "adminB"] as const) {
    sessoes[chave] = await logado(chave);
  }
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("manter-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("manter o horário depois do pedido de remarcação", () => {
  it("a recepção zera o pedido de consulta já confirmada, sem mudar situação nem horário", async () => {
    const id = await consultaComPedido("confirmado_paciente");
    const antes = await consultaNoBanco(id);

    const { data, error } = await sessoes.recepcao
      .from("appointment")
      .update({ remarcacao_pedida_em: null })
      .eq("clinic_id", clinicaA)
      .eq("id", id)
      .not("remarcacao_pedida_em", "is", null)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const depois = await consultaNoBanco(id);
    expect(depois.remarcacao_pedida_em).toBeNull();
    expect(depois.status).toBe("confirmado_paciente");
    expect(depois.starts_at).toBe(antes.starts_at);
  });

  it("vale também para consulta ainda aguardando confirmação", async () => {
    const id = await consultaComPedido("aguardando_confirmacao");

    const { data, error } = await sessoes.recepcao
      .from("appointment")
      .update({ remarcacao_pedida_em: null })
      .eq("clinic_id", clinicaA)
      .eq("id", id)
      .not("remarcacao_pedida_em", "is", null)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await consultaNoBanco(id)).remarcacao_pedida_em).toBeNull();
  });

  it("o papel leitura não zera o pedido (e ele continua no banco)", async () => {
    const id = await consultaComPedido("confirmado_recepcao");

    const { data } = await sessoes.leitura
      .from("appointment")
      .update({ remarcacao_pedida_em: null })
      .eq("clinic_id", clinicaA)
      .eq("id", id)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect((await consultaNoBanco(id)).remarcacao_pedida_em).not.toBeNull();
  });

  it("o administrador de outra clínica não zera o pedido da A", async () => {
    const id = await consultaComPedido("confirmado_paciente");

    const { data } = await sessoes.adminB
      .from("appointment")
      .update({ remarcacao_pedida_em: null })
      .eq("id", id)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect((await consultaNoBanco(id)).remarcacao_pedida_em).not.toBeNull();
  });
});

describe("número de faltas da régua reforçada, depois de criada", () => {
  it("o gestor muda o número", async () => {
    const { data, error } = await sessoes.gestor
      .from("cadence")
      .update({ no_show_threshold: 3 })
      .eq("clinic_id", clinicaA)
      .eq("id", reforcadaA)
      .eq("for_no_show_history", true)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await limiarNoBanco()).toBe(3);
  });

  it("a recepção não configura régua: zero linhas e o número fica", async () => {
    const antes = await limiarNoBanco();
    const { data } = await sessoes.recepcao
      .from("cadence")
      .update({ no_show_threshold: 7 })
      .eq("clinic_id", clinicaA)
      .eq("id", reforcadaA)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect(await limiarNoBanco()).toBe(antes);
  });

  it("o administrador de outra clínica não muda a régua da A", async () => {
    const antes = await limiarNoBanco();
    const { data } = await sessoes.adminB
      .from("cadence")
      .update({ no_show_threshold: 9 })
      .eq("id", reforcadaA)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    expect(await limiarNoBanco()).toBe(antes);
  });

  it("o banco recusa número menor que 1, até para o gestor", async () => {
    const antes = await limiarNoBanco();
    const { error } = await sessoes.gestor
      .from("cadence")
      .update({ no_show_threshold: 0 })
      .eq("clinic_id", clinicaA)
      .eq("id", reforcadaA)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await limiarNoBanco()).toBe(antes);
  });
});
