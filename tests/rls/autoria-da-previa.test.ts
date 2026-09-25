import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Autoria da previa do cartao (migration 20260925120000_autoria_da_previa,
// achado L2 da revisao da leva 2).
//  - O mesmo gatilho da previa grava QUEM escreveu a mensagem da previa
//    (paciente, usuario, ia, sistema) e, quando e alguem da equipe, a pessoa.
//  - Nota interna e evento continuam fora: a autoria acompanha a previa.
//  - So o gatilho escreve: a API nao forja a autoria, nem no INSERT.
//  - A autoria fica sob a RLS da conversa: a clinica B nao le a da A, e o
//    profissional nao le a de conversa que nao e dele.
// Clinicas descartaveis proprias: nao toca no seed.

const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-autoria-${suffix}!`;

const admin = adminClient();

type Person = { user: User; client: SupabaseClient };

let adminA: Person;
let profA: Person;
let adminB: Person;
let clinicA: { id: string };
let clinicB: { id: string };
let convA: string;
let seq = 0;

type Autoria = {
  last_preview: string | null;
  last_preview_author: string | null;
  last_preview_author_user_id: string | null;
};

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

async function must<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  label: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

/** Insere uma mensagem na conversa da A, sempre mais nova que a anterior. */
async function mensagem(campos: Record<string, unknown>): Promise<void> {
  seq += 1;
  await must(
    admin.from("message").insert({
      clinic_id: clinicA.id,
      conversation_id: convA,
      wa_message_id: `autoria:${suffix}:${seq}`,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      created_at: new Date(Date.now() + seq * 1000).toISOString(),
      ...campos,
    }),
    "message",
  );
}

async function autoriaDaA(): Promise<Autoria> {
  return (await must(
    admin
      .from("conversation")
      .select("last_preview, last_preview_author, last_preview_author_user_id")
      .eq("id", convA)
      .single(),
    "autoria",
  )) as Autoria;
}

beforeAll(async () => {
  const [a, p, b] = await Promise.all([
    createPerson(`autoria-admin-a-${suffix}@teste.dev`),
    createPerson(`autoria-prof-a-${suffix}@teste.dev`),
    createPerson(`autoria-admin-b-${suffix}@teste.dev`),
  ]);

  const clinics = (await must(
    admin
      .from("clinic")
      .insert([
        { name: `Autoria A ${suffix}`, slug: `autoria-a-${suffix}` },
        { name: `Autoria B ${suffix}`, slug: `autoria-b-${suffix}` },
      ])
      .select("id, slug"),
    "clinic",
  )) as { id: string; slug: string }[];
  clinicA = clinics.find((c) => c.slug === `autoria-a-${suffix}`)!;
  clinicB = clinics.find((c) => c.slug === `autoria-b-${suffix}`)!;
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicA.id);

  await must(
    admin.from("clinic_member").insert([
      { clinic_id: clinicA.id, user_id: a.id, role: "admin" },
      { clinic_id: clinicA.id, user_id: p.id, role: "profissional" },
      { clinic_id: clinicB.id, user_id: b.id, role: "admin" },
    ]),
    "clinic_member",
  );

  const contato = (await must(
    admin
      .from("contact")
      .insert({
        clinic_id: clinicA.id,
        phone_e164: `+5584983${suffix.slice(0, 6)}1`,
        name: "Contato Autoria A",
      })
      .select("id")
      .single(),
    "contact",
  )) as { id: string };

  // A conversa nasce SEM autoria, mesmo que quem insere tente mandar uma.
  const conversa = (await must(
    admin
      .from("conversation")
      .insert({
        clinic_id: clinicA.id,
        contact_id: contato.id,
        status: "em_atendimento",
        assignee_user_id: a.id,
        last_preview_author: "ia",
        last_preview_author_user_id: a.id,
      })
      .select("id, last_preview_author, last_preview_author_user_id")
      .single(),
    "conversation",
  )) as {
    id: string;
    last_preview_author: string | null;
    last_preview_author_user_id: string | null;
  };
  convA = conversa.id;
  expect(conversa.last_preview_author).toBeNull();
  expect(conversa.last_preview_author_user_id).toBeNull();

  adminA = { user: a, client: await signIn(a.email!) };
  profA = { user: p, client: await signIn(p.email!) };
  adminB = { user: b, client: await signIn(b.email!) };
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicA?.id, clinicB?.id]);
  await Promise.all(
    [adminA, profA, adminB]
      .filter(Boolean)
      .map((person) => admin.auth.admin.deleteUser(person.user.id)),
  );
});

describe("o gatilho grava quem escreveu a prévia", () => {
  it("fala do paciente: autor paciente, sem pessoa da equipe", async () => {
    await mensagem({ body: "Quanto custa a consulta?" });
    expect(await autoriaDaA()).toEqual({
      last_preview: "Quanto custa a consulta?",
      last_preview_author: "paciente",
      last_preview_author_user_id: null,
    });
  });

  it("resposta da equipe: autor usuario, com a pessoa", async () => {
    await mensagem({
      direction: "saida",
      author: "usuario",
      author_user_id: adminA.user.id,
      body: "Custa R$ 200.",
    });
    expect(await autoriaDaA()).toEqual({
      last_preview: "Custa R$ 200.",
      last_preview_author: "usuario",
      last_preview_author_user_id: adminA.user.id,
    });
  });

  it("nota interna e evento não mudam a autoria", async () => {
    await mensagem({
      direction: "saida",
      author: "sistema",
      content_type: "evento",
      body: "Fulano assumiu a conversa",
      wa_message_id: null,
    });
    await mensagem({
      direction: "saida",
      author: "usuario",
      author_user_id: adminA.user.id,
      body: "nota que o paciente nao ve",
      is_internal_note: true,
      wa_message_id: null,
    });
    expect((await autoriaDaA()).last_preview_author).toBe("usuario");
  });

  it("envio automático: autor sistema, a pessoa sai", async () => {
    await mensagem({
      direction: "saida",
      author: "sistema",
      body: "Lembrete da sua consulta amanhã",
    });
    expect(await autoriaDaA()).toEqual({
      last_preview: "Lembrete da sua consulta amanhã",
      last_preview_author: "sistema",
      last_preview_author_user_id: null,
    });
  });
});

describe("ninguém forja a autoria", () => {
  it("UPDATE direto de quem pode editar a conversa não pega", async () => {
    const antes = await autoriaDaA();
    const { error } = await adminA.client
      .from("conversation")
      .update({
        last_preview_author: "paciente",
        last_preview_author_user_id: adminA.user.id,
      })
      .eq("id", convA);
    expect(error).toBeNull();
    expect(await autoriaDaA()).toEqual(antes);
  });

  it("nem pelo service role", async () => {
    const antes = await autoriaDaA();
    await must(
      admin
        .from("conversation")
        .update({ last_preview_author: "ia" })
        .eq("id", convA),
      "update service",
    );
    expect(await autoriaDaA()).toEqual(antes);
  });
});

describe("isolamento da autoria", () => {
  it("admin da clínica A lê a autoria da própria conversa", async () => {
    const { data, error } = await adminA.client
      .from("conversation")
      .select("id, last_preview_author")
      .eq("id", convA);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: convA, last_preview_author: "sistema" }]);
  });

  it("admin da clínica B não lê a autoria da A", async () => {
    const { data, error } = await adminB.client
      .from("conversation")
      .select("id, last_preview_author, last_preview_author_user_id")
      .eq("id", convA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("profissional da A não lê a autoria de conversa que não é dele", async () => {
    const { data, error } = await profA.client
      .from("conversation")
      .select("id, last_preview_author, last_preview_author_user_id")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
