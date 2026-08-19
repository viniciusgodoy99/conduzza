import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Aceite da tarefa 1.1: isolamento das tabelas de conversa entre clinicas,
// segredo invisivel ate para admin da propria clinica, papel profissional
// vendo SO as proprias conversas (a policy alimenta o Realtime), e
// idempotencia estrutural por wa_message_id unique.
// Clinicas descartaveis proprias: nao toca no seed.

const UNIQUE_VIOLATION = "23505";
const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-conv-${suffix}!`;

const admin = adminClient();

type Person = { user: User; client: SupabaseClient };

let adminA: Person;
let profA: Person;
let adminB: Person;
let clinicA: { id: string };
let clinicB: { id: string };
let convUnassignedA: string;
let convAssignedToProfA: string;

async function createPerson(email: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário ${email}: ${error?.message}`);
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
    throw new Error(`Falha no login de ${email}: ${error.message}`);
  }
  return client;
}

async function mustInsert<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  label: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

beforeAll(async () => {
  const [a, p, b] = await Promise.all([
    createPerson(`conv-admin-a-${suffix}@teste.dev`),
    createPerson(`conv-prof-a-${suffix}@teste.dev`),
    createPerson(`conv-admin-b-${suffix}@teste.dev`),
  ]);

  const clinics = await mustInsert(
    admin
      .from("clinic")
      .insert([
        { name: `Conv A ${suffix}`, slug: `conv-a-${suffix}` },
        { name: `Conv B ${suffix}`, slug: `conv-b-${suffix}` },
      ])
      .select("id, slug"),
    "clinic",
  );
  clinicA = clinics!.find(
    (c: { slug: string }) => c.slug === `conv-a-${suffix}`,
  )!;
  clinicB = clinics!.find(
    (c: { slug: string }) => c.slug === `conv-b-${suffix}`,
  )!;

  await mustInsert(
    admin.from("clinic_member").insert([
      { clinic_id: clinicA.id, user_id: a.id, role: "admin" },
      { clinic_id: clinicA.id, user_id: p.id, role: "profissional" },
      { clinic_id: clinicB.id, user_id: b.id, role: "admin" },
    ]),
    "clinic_member",
  );

  const contacts = await mustInsert(
    admin
      .from("contact")
      .insert([
        {
          clinic_id: clinicA.id,
          phone_e164: `+5584981${suffix.slice(0, 6)}1`,
          name: "Contato A",
        },
        {
          clinic_id: clinicB.id,
          phone_e164: `+5584981${suffix.slice(0, 6)}2`,
          name: "Contato B",
        },
      ])
      .select("id, clinic_id"),
    "contact",
  );
  const contactA = contacts!.find(
    (c: { clinic_id: string }) => c.clinic_id === clinicA.id,
  )!;
  const contactB = contacts!.find(
    (c: { clinic_id: string }) => c.clinic_id === clinicB.id,
  )!;

  await mustInsert(
    admin.from("contact_consent").insert([
      { clinic_id: clinicA.id, contact_id: contactA.id, source: "conversa" },
      { clinic_id: clinicB.id, contact_id: contactB.id, source: "conversa" },
    ]),
    "contact_consent",
  );

  // Duas conversas na A (uma sem responsavel, uma do profissional) e uma na B.
  // A segunda conversa da A precisa de outro contato (uma aberta por contato).
  const contactA2 = await mustInsert(
    admin
      .from("contact")
      .insert({
        clinic_id: clinicA.id,
        phone_e164: `+5584981${suffix.slice(0, 6)}3`,
        name: "Contato A2",
      })
      .select("id")
      .single(),
    "contact A2",
  );

  const conversations = await mustInsert(
    admin
      .from("conversation")
      .insert([
        {
          clinic_id: clinicA.id,
          contact_id: contactA.id,
          status: "aguardando_humano",
        },
        {
          clinic_id: clinicA.id,
          contact_id: contactA2!.id,
          status: "em_atendimento",
          assignee_user_id: p.id,
        },
        {
          clinic_id: clinicB.id,
          contact_id: contactB.id,
          status: "aguardando_humano",
        },
      ])
      .select("id, clinic_id, assignee_user_id"),
    "conversation",
  );
  convUnassignedA = conversations!.find(
    (c: { clinic_id: string; assignee_user_id: string | null }) =>
      c.clinic_id === clinicA.id && c.assignee_user_id === null,
  )!.id;
  convAssignedToProfA = conversations!.find(
    (c: { assignee_user_id: string | null }) => c.assignee_user_id === p.id,
  )!.id;
  const convB = conversations!.find(
    (c: { clinic_id: string }) => c.clinic_id === clinicB.id,
  )!.id;

  await mustInsert(
    admin.from("message").insert([
      {
        clinic_id: clinicA.id,
        conversation_id: convUnassignedA,
        wa_message_id: `rls:${suffix}:a1`,
        direction: "entrada",
        author: "paciente",
        body: "oi",
      },
      {
        clinic_id: clinicA.id,
        conversation_id: convAssignedToProfA,
        wa_message_id: `rls:${suffix}:a2`,
        direction: "entrada",
        author: "paciente",
        body: "ola",
      },
      {
        clinic_id: clinicB.id,
        conversation_id: convB,
        wa_message_id: `rls:${suffix}:b1`,
        direction: "entrada",
        author: "paciente",
        body: "bom dia",
      },
    ]),
    "message",
  );

  await mustInsert(
    admin.from("ai_decision_log").insert([
      {
        clinic_id: clinicA.id,
        conversation_id: convUnassignedA,
        compliance_blocked: true,
        compliance_rule: "triagem",
        blocked_draft: "rascunho",
      },
      {
        clinic_id: clinicB.id,
        conversation_id: convB,
        compliance_blocked: false,
      },
    ]),
    "ai_decision_log",
  );

  await mustInsert(
    admin.from("whatsapp_account").insert([
      {
        clinic_id: clinicA.id,
        provider: "fake",
        connection_status: "conectado",
      },
      {
        clinic_id: clinicB.id,
        provider: "fake",
        connection_status: "conectado",
      },
    ]),
    "whatsapp_account",
  );
  await mustInsert(
    admin.from("whatsapp_account_secret").insert([
      { clinic_id: clinicA.id, instance_token: "segredo-a" },
      { clinic_id: clinicB.id, instance_token: "segredo-b" },
    ]),
    "whatsapp_account_secret",
  );
  await mustInsert(
    admin.from("message_template").insert([
      {
        clinic_id: clinicA.id,
        name: "t-a",
        category: "utility",
        body: "corpo",
      },
      {
        clinic_id: clinicB.id,
        name: "t-b",
        category: "utility",
        body: "corpo",
      },
    ]),
    "message_template",
  );

  adminA = {
    user: a,
    client: await signIn(`conv-admin-a-${suffix}@teste.dev`),
  };
  profA = { user: p, client: await signIn(`conv-prof-a-${suffix}@teste.dev`) };
  adminB = {
    user: b,
    client: await signIn(`conv-admin-b-${suffix}@teste.dev`),
  };
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicA.id, clinicB.id]);
  await Promise.all(
    [adminA, profA, adminB]
      .filter(Boolean)
      .map((person) => admin.auth.admin.deleteUser(person.user.id)),
  );
});

describe("isolamento entre clínicas", () => {
  const TABLES = [
    "contact",
    "contact_consent",
    "conversation",
    "message",
    "ai_decision_log",
    "whatsapp_account",
    "message_template",
  ];

  it.each(TABLES)("admin da A recebe zero linhas de %s da B", async (table) => {
    const { data, error } = await adminA.client
      .from(table)
      .select("clinic_id")
      .eq("clinic_id", clinicB.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anti falso-positivo: service role enxerga o dado da B", async () => {
    const { data } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicB.id);
    expect(data).toHaveLength(1);
  });

  it("admin da B lê a própria conversa", async () => {
    const { data, error } = await adminB.client
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicB.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("segredos", () => {
  it("nem admin da própria clínica lê whatsapp_account_secret", async () => {
    const { data, error } = await adminA.client
      .from("whatsapp_account_secret")
      .select("clinic_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("service role lê o segredo (anti falso-positivo)", async () => {
    const { data } = await admin
      .from("whatsapp_account_secret")
      .select("clinic_id")
      .eq("clinic_id", clinicA.id);
    expect(data).toHaveLength(1);
  });
});

describe("papel profissional: só as próprias conversas", () => {
  it("vê somente a conversa atribuída a ele", async () => {
    const { data, error } = await profA.client
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(convAssignedToProfA);
  });

  it("vê somente as mensagens da conversa atribuída", async () => {
    const { data, error } = await profA.client
      .from("message")
      .select("conversation_id")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.conversation_id).toBe(convAssignedToProfA);
  });

  it("não consegue editar conversa que não é dele (0 linhas)", async () => {
    const { data, error } = await profA.client
      .from("conversation")
      .update({ unread_count: 0 })
      .eq("id", convUnassignedA)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin da mesma clínica vê as duas conversas", async () => {
    const { data, error } = await adminA.client
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});

describe("idempotência estrutural", () => {
  it("wa_message_id duplicado é recusado pelo banco", async () => {
    const { error } = await admin.from("message").insert({
      clinic_id: clinicA.id,
      conversation_id: convUnassignedA,
      wa_message_id: `rls:${suffix}:a1`,
      direction: "entrada",
      author: "paciente",
      body: "duplicada",
    });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("message_pricing é legível por autenticado e nasce vazia", async () => {
    const { data, error } = await adminA.client
      .from("message_pricing")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
