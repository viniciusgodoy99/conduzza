import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Isolamento do anexo do passo da regua (balde midia-de-regua, 19/09/2026).
// Nao e dado de paciente, mas e conteudo da clinica: quem decide a leitura e
// a policy do Postgres (a subconsulta em cadence_step roda como o usuario da
// sessao, entao a RLS de cadence_step recorta a clinica). A prova usa
// createSignedUrl com o cliente da SESSAO, que e o que o editor da Tela 7
// faz para a pre-visualizacao.

const admin = adminClient();
const PASSWORD = "SenhaDeTeste!234";
const suffix = Math.random().toString(36).slice(2, 8);
const BUCKET = "midia-de-regua";

type Pessoa = { user: User; client: SupabaseClient };

let clinicaA: string;
let clinicaB: string;
let caminhoA: string;
let daClinicaA: Pessoa;
let daClinicaB: Pessoa;
const usuarios: string[] = [];

async function criarPessoa(email: string): Promise<Pessoa> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar ${email}: ${error?.message}`);
  }
  usuarios.push(data.user.id);
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
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Anexo A ${suffix}`, slug: `anexo-a-${suffix}`, e_de_teste: true },
      { name: `Anexo B ${suffix}`, slug: `anexo-b-${suffix}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `anexo-a-${suffix}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `anexo-b-${suffix}`)!.id as string;

  daClinicaA = await criarPessoa(`anexo-a-${suffix}@teste.dev`);
  daClinicaB = await criarPessoa(`anexo-b-${suffix}@teste.dev`);
  await admin.from("clinic_member").insert([
    {
      clinic_id: clinicaA,
      user_id: daClinicaA.user.id,
      role: "gestor",
      status: "ativo",
    },
    {
      clinic_id: clinicaB,
      user_id: daClinicaB.user.id,
      role: "gestor",
      status: "ativo",
    },
  ]).throwOnError();

  // Um passo da regua de confirmacao semeada da A, com anexo plantado.
  const { data: passo } = await admin
    .from("cadence_step")
    .select("id, cadence:cadence_id!inner(clinic_id)")
    .eq("cadence.clinic_id", clinicaA)
    .limit(1)
    .single()
    .throwOnError();
  caminhoA = `${clinicaA}/${passo!.id}`;
  const upload = await admin.storage
    .from(BUCKET)
    .upload(caminhoA, Buffer.from("anexo-de-teste"), {
      contentType: "application/pdf",
      upsert: true,
    });
  expect(upload.error).toBeNull();
});

afterAll(async () => {
  await admin.storage.from(BUCKET).remove([caminhoA]);
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("anexo do passo da régua: leitura por clínica", () => {
  it("membro da clínica A assina e baixa o anexo da A", async () => {
    const { data, error } = await daClinicaA.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("membro da clínica B não assina o anexo da A", async () => {
    const { data, error } = await daClinicaB.client.storage
      .from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });

  it("caminho forjado com o prefixo da B e o passo da A não abre para a B", async () => {
    const passoIdDaA = caminhoA.split("/")[1]!;
    const forjado = `${clinicaB}/${passoIdDaA}`;
    const { data, error } = await daClinicaB.client.storage
      .from(BUCKET)
      .createSignedUrl(forjado, 60);
    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });

  it("sem sessão, nada se assina", async () => {
    const { data, error } = await anonClient()
      .storage.from(BUCKET)
      .createSignedUrl(caminhoA, 60);
    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });
});
