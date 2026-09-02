import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Isolamento do acervo de MIDIA de paciente (foto de exame, audio, documento).
//
// Este e o primeiro caminho pelo qual arquivo de paciente sai do banco para o
// navegador. Ate a policy existir, o unico controle era o balde ser privado, e
// o unico leitor era o service role. Aqui provamos que quem decide e o
// Postgres, e nao um if do TypeScript, que e o que a regra 3.1 do CLAUDE.md
// exige ("Se a RLS falhar, o dado nao pode vazar").
//
// A prova usa createSignedUrl com o cliente da SESSAO, que e exatamente o que
// a rota app/api/atendimento/midia/[messageId] faz: se o storage-api recusar
// assinar, nao existe URL para o navegador seguir.

const admin = adminClient();
const PASSWORD = "SenhaDeTeste!234";
const suffix = Math.random().toString(36).slice(2, 8);
const BUCKET = "midia-conversas";

type Pessoa = { user: User; client: SupabaseClient };

let clinicaA: string;
let clinicaB: string;
let mensagemA: string;
let caminhoA: string;
let daClinicaA: Pessoa;
let daClinicaB: Pessoa;
let profissionalSemAConversa: Pessoa;

async function criarPessoa(email: string): Promise<Pessoa> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar ${email}: ${error?.message}`);
  }
  const client = anonClient();
  const { error: erroLogin } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (erroLogin) {
    throw new Error(`Falha no login de ${email}: ${erroLogin.message}`);
  }
  return { user: data.user, client };
}

beforeAll(async () => {
  const { data: clinicas, error } = await admin
    .from("clinic")
    .insert([
      { name: `Mídia A ${suffix}`, slug: `midia-a-${suffix}`, e_de_teste: true },
      { name: `Mídia B ${suffix}`, slug: `midia-b-${suffix}`, e_de_teste: true },
    ])
    .select("id, slug");
  if (error || clinicas?.length !== 2) {
    throw new Error(`Falha ao criar clínicas: ${error?.message}`);
  }
  clinicaA = clinicas.find((c) => c.slug === `midia-a-${suffix}`)!.id as string;
  clinicaB = clinicas.find((c) => c.slug === `midia-b-${suffix}`)!.id as string;

  [daClinicaA, daClinicaB, profissionalSemAConversa] = await Promise.all([
    criarPessoa(`midia-a-${suffix}@teste.dev`),
    criarPessoa(`midia-b-${suffix}@teste.dev`),
    criarPessoa(`midia-prof-${suffix}@teste.dev`),
  ]);

  await admin.from("clinic_member").insert([
    { clinic_id: clinicaA, user_id: daClinicaA.user.id, role: "admin" },
    { clinic_id: clinicaB, user_id: daClinicaB.user.id, role: "admin" },
    // Profissional da MESMA clínica A, mas a conversa não é dele.
    {
      clinic_id: clinicaA,
      user_id: profissionalSemAConversa.user.id,
      role: "profissional",
    },
  ]);

  const { data: contato } = await admin
    .from("contact")
    .insert({ clinic_id: clinicaA, phone_e164: `+5511${Date.now() % 100000000}` })
    .select("id")
    .single();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({ clinic_id: clinicaA, contact_id: contato!.id })
    .select("id")
    .single();

  mensagemA = crypto.randomUUID();
  caminhoA = `${clinicaA}/${mensagemA}`;
  await admin.from("message").insert({
    id: mensagemA,
    clinic_id: clinicaA,
    conversation_id: conversa!.id,
    direction: "entrada",
    author: "paciente",
    content_type: "imagem",
    media_url: `storage://${BUCKET}/${caminhoA}`,
  });

  // O arquivo em si, subido pelo service role, como o worker faz.
  await admin.storage
    .from(BUCKET)
    .upload(caminhoA, Buffer.from("conteudo-de-teste"), {
      contentType: "image/png",
      upsert: true,
    });
});

afterAll(async () => {
  await admin.storage.from(BUCKET).remove([caminhoA]);
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const p of [daClinicaA, daClinicaB, profissionalSemAConversa]) {
    if (p?.user) {
      await admin.auth.admin.deleteUser(p.user.id);
    }
  }
});

describe("acesso ao acervo de mídia de paciente", () => {
  it("membro da própria clínica consegue assinar a mídia", async () => {
    const { data, error } = await daClinicaA.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("membro de OUTRA clínica não consegue", async () => {
    // O caso que a policy existe para impedir: foto de exame de paciente de
    // uma clínica alcançável por quem trabalha em outra.
    const { data, error } = await daClinicaB.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(data?.signedUrl).toBeFalsy();
    expect(error).toBeTruthy();
  });

  it("profissional sem a conversa atribuída não consegue, mesmo na clínica certa", async () => {
    // A policy do balde consulta public.message, que já tem o recorte do papel
    // profissional. A regra não é duplicada aqui: ou ela vale nos dois lugares,
    // ou não vale em nenhum.
    const { data, error } = await profissionalSemAConversa.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(data?.signedUrl).toBeFalsy();
    expect(error).toBeTruthy();
  });

  it("caminho forjado com outra clínica não consegue", async () => {
    // O atacante informa o caminho, não nós: sem a conferência do primeiro
    // segmento, bastaria trocar o prefixo para ler o arquivo alheio.
    const forjado = `${clinicaB}/${mensagemA}`;
    const { data, error } = await daClinicaB.client.storage
      .from(BUCKET)
      .createSignedUrl(forjado, 60);
    expect(data?.signedUrl).toBeFalsy();
    expect(error).toBeTruthy();
  });

  it("mídia de mensagem apagada deixa de ser acessível", async () => {
    await admin
      .from("message")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", mensagemA);
    const { data, error } = await daClinicaA.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(data?.signedUrl).toBeFalsy();
    expect(error).toBeTruthy();
    await admin
      .from("message")
      .update({ deleted_at: null })
      .eq("id", mensagemA);
  });

  it("ninguém escreve no acervo pela sessão, só o service role", async () => {
    // Não existe policy de INSERT: o arquivo entra pelo worker ou pela Server
    // Action, que conferem papel e posse antes. Se o navegador pudesse
    // escrever, poderia plantar arquivo em conversa alheia.
    const { error } = await daClinicaA.client.storage
      .from(BUCKET)
      .upload(`${clinicaA}/${crypto.randomUUID()}`, Buffer.from("x"));
    expect(error).toBeTruthy();
  });
});
