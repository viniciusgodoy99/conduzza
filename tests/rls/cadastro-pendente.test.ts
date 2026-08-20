import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Aceite do cadastro self-service: o gatilho handle_new_user cria a clinica
// numa transacao; quem entra por CODIGO nasce pendente e NAO enxerga dado de
// paciente ate um administrador liberar.
//
// Os usuarios sao criados pela API administrativa em vez do signup publico
// porque o signup dispara e-mail de confirmacao e o projeto esta no limite de
// 2 e-mails por hora do servico interno do Supabase. A insercao em auth.users
// e a mesma nos dois caminhos, e e ela que aciona o gatilho: o que este teste
// prova vale identico para o cadastro pela tela.

const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Cadastro-${suffix}!1`;

const admin = adminClient();

let dona: { user: User; client: SupabaseClient };
let pendente: { user: User; client: SupabaseClient };
let clinicId: string;
let conversationId: string;

async function signUp(
  email: string,
  metadata: Record<string, string>,
): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data.user) {
    throw new Error(`signUp ${email}: ${error?.message}`);
  }
  return data.user;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return client;
}

beforeAll(async () => {
  // 1. Cadastro criando clinica.
  const emailDona = `dona-${suffix}@teste.dev`;
  const userDona = await signUp(emailDona, {
    tipo: "clinica",
    nome: "Dona da Clínica",
    nome_clinica: `Clínica Cadastro ${suffix}`,
    name: "Dona da Clínica",
  });

  const { data: membro } = await admin
    .from("clinic_member")
    .select("clinic_id")
    .eq("user_id", userDona.id)
    .single();
  clinicId = membro!.clinic_id;

  // Dado de paciente na clinica, para provar o bloqueio do pendente.
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+5584917${suffix.slice(0, 6)}`,
      name: "Paciente Reservado",
    })
    .select("id")
    .single();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contato!.id,
      status: "aguardando_humano",
    })
    .select("id")
    .single();
  conversationId = conversa!.id;
  await admin.from("message").insert({
    clinic_id: clinicId,
    conversation_id: conversationId,
    wa_message_id: `cad:${suffix}:1`,
    direction: "entrada",
    author: "paciente",
    body: "Mensagem confidencial de paciente",
  });

  // 2. Cadastro por codigo, na mesma clinica.
  // O codigo mora em tabela propria desde a auditoria: so administrador le.
  await admin
    .from("clinic")
    .update({ allow_code_signup: true })
    .eq("id", clinicId);
  const { data: codigo } = await admin
    .from("clinic_access_code")
    .select("code")
    .eq("clinic_id", clinicId)
    .single();
  const emailPendente = `pendente-${suffix}@teste.dev`;
  const userPendente = await signUp(emailPendente, {
    tipo: "codigo",
    nome: "Pessoa Pendente",
    codigo: codigo!.code,
    name: "Pessoa Pendente",
  });

  dona = { user: userDona, client: await signIn(emailDona) };
  pendente = { user: userPendente, client: await signIn(emailPendente) };
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
  for (const pessoa of [dona, pendente]) {
    if (pessoa) {
      await admin.auth.admin.deleteUser(pessoa.user.id);
    }
  }
});

describe("cadastro criando clínica", () => {
  it("cria clínica, branding e vínculo de administrador ativo", async () => {
    const { data: clinica } = await admin
      .from("clinic")
      .select("name")
      .eq("id", clinicId)
      .single();
    expect(clinica?.name).toBe(`Clínica Cadastro ${suffix}`);
    const { data: acesso } = await admin
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicId)
      .single();
    expect((acesso?.code as string).length).toBeGreaterThanOrEqual(8);

    const { data: branding } = await admin
      .from("clinic_branding")
      .select("clinic_id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    expect(branding).not.toBeNull();

    const { data: membro } = await admin
      .from("clinic_member")
      .select("role, status")
      .eq("clinic_id", clinicId)
      .eq("user_id", dona.user.id)
      .single();
    expect(membro).toMatchObject({ role: "admin", status: "ativo" });
  });

  it("a dona enxerga a conversa da própria clínica", async () => {
    const { data } = await dona.client
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(data).toHaveLength(1);
  });
});

describe("cadastro por código: pendente sem acesso a dado de paciente", () => {
  it("o vínculo nasce pendente", async () => {
    const { data } = await admin
      .from("clinic_member")
      .select("status, role")
      .eq("clinic_id", clinicId)
      .eq("user_id", pendente.user.id)
      .single();
    expect(data?.status).toBe("pendente");
  });

  it("enxerga o próprio vínculo (para a tela explicar que aguarda liberação)", async () => {
    const { data } = await pendente.client
      .from("clinic_member")
      .select("clinic_id, status")
      .eq("user_id", pendente.user.id);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("pendente");
  });

  it.each(["conversation", "message", "contact", "contact_consent"])(
    "NÃO enxerga %s da clínica",
    async (tabela) => {
      const { data, error } = await pendente.client
        .from(tabela)
        .select("clinic_id")
        .eq("clinic_id", clinicId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  it("anti falso-positivo: o dado existe e está visível para a dona", async () => {
    const { data } = await dona.client
      .from("message")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(data?.length).toBeGreaterThan(0);
  });

  it("não consegue se autoaprovar", async () => {
    const { error } = await pendente.client
      .from("clinic_member")
      .update({ status: "ativo", role: "admin" })
      .eq("user_id", pendente.user.id)
      .eq("clinic_id", clinicId);
    // Ou o gatilho levanta excecao, ou a policy nao deixa passar: nos dois
    // casos o vinculo continua pendente, que e o que importa.
    const { data: depois } = await admin
      .from("clinic_member")
      .select("status, role")
      .eq("clinic_id", clinicId)
      .eq("user_id", pendente.user.id)
      .single();
    expect(depois).toMatchObject({ status: "pendente", role: "leitura" });
    void error;
  });
});

describe("liberação pelo administrador", () => {
  it("depois de liberado, o acesso abre", async () => {
    const { error } = await dona.client
      .from("clinic_member")
      .update({ status: "ativo", role: "recepcao" })
      .eq("clinic_id", clinicId)
      .eq("user_id", pendente.user.id)
      .eq("status", "pendente");
    expect(error).toBeNull();

    const liberado = await signIn(`pendente-${suffix}@teste.dev`);
    const { data } = await liberado
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(data).toHaveLength(1);
  });
});

describe("código inválido", () => {
  it("o cadastro é recusado com código inexistente", async () => {
    const { error } = await admin.auth.admin.createUser({
      email: `invalido-${suffix}@teste.dev`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        tipo: "codigo",
        nome: "Sem Clínica",
        codigo: "ZZZZZZZZ",
      },
    });
    // O gatilho levanta excecao e o usuario nem chega a existir.
    expect(error).not.toBeNull();
  });
});
