import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Previa da ultima mensagem no cartao da conversa (migration
// 20260925100000_previa_da_conversa, achado 14 da revisao de liberacao).
//  - E dado de paciente: a clinica B nao le a previa da A, e o profissional
//    nao le a de conversa que nao e dele (mesma RLS da linha).
//  - So o gatilho escreve: a API nao forja a previa, nem no INSERT.
//  - Nota interna e evento nunca entram; apagada vira 'apagada' sem texto;
//    midia grava o tipo (video pelo mimetype) e a legenda ou o nome do
//    documento; texto longo e cortado em 120 com os espacos colapsados.
// Clinicas descartaveis proprias: nao toca no seed.

const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-previa-${suffix}!`;

const admin = adminClient();

type Person = { user: User; client: SupabaseClient };

let adminA: Person;
let profA: Person;
let adminB: Person;
let clinicA: { id: string };
let clinicB: { id: string };
let convA: string;
let contatoA: string;
let seq = 0;

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
async function mensagem(campos: Record<string, unknown>): Promise<string> {
  seq += 1;
  const linha = await must(
    admin
      .from("message")
      .insert({
        clinic_id: clinicA.id,
        conversation_id: convA,
        wa_message_id: `previa:${suffix}:${seq}`,
        direction: "entrada",
        author: "paciente",
        content_type: "texto",
        created_at: new Date(Date.now() + seq * 1000).toISOString(),
        ...campos,
      })
      .select("id")
      .single(),
    "message",
  );
  return (linha as { id: string }).id;
}

async function previaDaA(): Promise<{
  last_preview: string | null;
  last_preview_kind: string | null;
}> {
  return (await must(
    admin
      .from("conversation")
      .select("last_preview, last_preview_kind")
      .eq("id", convA)
      .single(),
    "previa",
  )) as { last_preview: string | null; last_preview_kind: string | null };
}

beforeAll(async () => {
  const [a, p, b] = await Promise.all([
    createPerson(`previa-admin-a-${suffix}@teste.dev`),
    createPerson(`previa-prof-a-${suffix}@teste.dev`),
    createPerson(`previa-admin-b-${suffix}@teste.dev`),
  ]);

  const clinics = (await must(
    admin
      .from("clinic")
      .insert([
        { name: `Previa A ${suffix}`, slug: `previa-a-${suffix}` },
        { name: `Previa B ${suffix}`, slug: `previa-b-${suffix}` },
      ])
      .select("id, slug"),
    "clinic",
  )) as { id: string; slug: string }[];
  clinicA = clinics.find((c) => c.slug === `previa-a-${suffix}`)!;
  clinicB = clinics.find((c) => c.slug === `previa-b-${suffix}`)!;
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
        phone_e164: `+5584982${suffix.slice(0, 6)}1`,
        name: "Contato Previa A",
      })
      .select("id")
      .single(),
    "contact",
  )) as { id: string };
  contatoA = contato.id;

  // A conversa nasce SEM previa, mesmo que quem insere tente mandar uma.
  const conversa = (await must(
    admin
      .from("conversation")
      .insert({
        clinic_id: clinicA.id,
        contact_id: contatoA,
        status: "aguardando_humano",
        last_preview: "forjada no insert",
        last_preview_kind: "texto",
      })
      .select("id, last_preview, last_preview_kind")
      .single(),
    "conversation",
  )) as {
    id: string;
    last_preview: string | null;
    last_preview_kind: string | null;
  };
  convA = conversa.id;
  expect(conversa.last_preview).toBeNull();
  expect(conversa.last_preview_kind).toBeNull();

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

describe("o gatilho mantém a prévia", () => {
  it("texto do paciente vira a prévia", async () => {
    await mensagem({ body: "Quanto custa a consulta?" });
    expect(await previaDaA()).toEqual({
      last_preview: "Quanto custa a consulta?",
      last_preview_kind: "texto",
    });
  });

  it("nota interna e evento não mudam a prévia", async () => {
    await mensagem({
      direction: "saida",
      author: "usuario",
      body: "nota que o paciente nao ve",
      is_internal_note: true,
      wa_message_id: null,
    });
    await mensagem({
      direction: "saida",
      author: "sistema",
      content_type: "evento",
      body: "Fulano assumiu a conversa",
      wa_message_id: null,
    });
    expect((await previaDaA()).last_preview).toBe("Quanto custa a consulta?");
  });

  it("texto longo é cortado em 120, com quebras de linha colapsadas", async () => {
    await mensagem({ body: `Linha um\n\n  linha dois ${"x".repeat(200)}` });
    const previa = await previaDaA();
    expect(previa.last_preview?.length).toBe(120);
    expect(previa.last_preview?.startsWith("Linha um linha dois x")).toBe(true);
  });

  it("mídia grava o tipo; vídeo pelo mimetype; documento sem legenda usa o nome", async () => {
    await mensagem({ content_type: "imagem", body: "meu exame" });
    expect(await previaDaA()).toEqual({
      last_preview: "meu exame",
      last_preview_kind: "imagem",
    });
    await mensagem({ content_type: "imagem", media_mimetype: "video/mp4" });
    expect(await previaDaA()).toEqual({
      last_preview: null,
      last_preview_kind: "video",
    });
    await mensagem({
      content_type: "documento",
      media_filename: "laudo.pdf",
    });
    expect(await previaDaA()).toEqual({
      last_preview: "laudo.pdf",
      last_preview_kind: "documento",
    });
  });

  it("apagar a última tira o texto da conversa na hora", async () => {
    const id = await mensagem({ body: "texto que vai ser apagado" });
    expect((await previaDaA()).last_preview).toBe("texto que vai ser apagado");
    await must(
      admin
        .from("message")
        .update({
          body: null,
          deleted_at: new Date().toISOString(),
          deleted_source: "clinica",
          deleted_escopo: "todos",
        })
        .eq("id", id),
      "apagar",
    );
    expect(await previaDaA()).toEqual({
      last_preview: null,
      last_preview_kind: "apagada",
    });
  });

  it("status de entrega não mexe na prévia", async () => {
    const id = await mensagem({
      direction: "saida",
      author: "usuario",
      body: "Custa R$ 200.",
    });
    await must(
      admin.from("message").update({ delivery_status: "lida" }).eq("id", id),
      "entrega",
    );
    expect((await previaDaA()).last_preview).toBe("Custa R$ 200.");
  });
});

describe("ninguém forja a prévia", () => {
  it("UPDATE direto de quem pode editar a conversa não pega", async () => {
    const antes = await previaDaA();
    const { error } = await adminA.client
      .from("conversation")
      .update({ last_preview: "forjada", last_preview_kind: "texto" })
      .eq("id", convA);
    expect(error).toBeNull();
    expect(await previaDaA()).toEqual(antes);
  });

  it("nem pelo service role", async () => {
    const antes = await previaDaA();
    await must(
      admin
        .from("conversation")
        .update({ last_preview: "forjada", last_preview_kind: "apagada" })
        .eq("id", convA),
      "update service",
    );
    expect(await previaDaA()).toEqual(antes);
  });
});

describe("isolamento da prévia (dado de paciente)", () => {
  it("admin da clínica A lê a prévia da própria conversa", async () => {
    const { data, error } = await adminA.client
      .from("conversation")
      .select("id, last_preview")
      .eq("id", convA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.last_preview).toBe("Custa R$ 200.");
  });

  it("admin da clínica B não lê a prévia da A", async () => {
    const { data, error } = await adminB.client
      .from("conversation")
      .select("id, last_preview")
      .eq("id", convA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("profissional da A não lê a prévia de conversa que não é dele", async () => {
    const { data, error } = await profA.client
      .from("conversation")
      .select("id, last_preview")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a função de recálculo não é chamável pela API", async () => {
    const { error } = await adminA.client.rpc("recalcular_previa_da_conversa", {
      p_conversation_id: convA,
    });
    expect(error).not.toBeNull();
  });
});
