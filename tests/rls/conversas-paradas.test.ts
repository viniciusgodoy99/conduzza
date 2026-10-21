import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { eventoDaConversaParada } from "@/components/atendimento/conversas-paradas";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// "Resolver as conversas paradas" do Atendimento (onda 2, decisao P11b do
// dono): a Server Action (app/(app)/atendimento/conversas-paradas-actions.ts)
// nao tem funcao propria no banco. Ela le, resolve e grava o evento e a
// trilha PELA SESSAO, entao quem protege e a RLS de sempre:
//
// - a conversa da outra clinica nao se conta nem se resolve (o UPDATE com as
//   mesmas condicoes da acao volta vazio, e a conversa continua aberta);
// - o evento no fio e a trilha nao se gravam em nome da outra clinica;
// - o papel leitura nao resolve nem grava o evento (user_can_write na
//   policy; a guarda da acao e a segunda camada);
// - o gestor da clinica resolve a parada dela com as mesmas condicoes da
//   acao, e a conversa recente fica como estava.
//
// Clinicas descartaveis (e_de_teste), proprias desta suite: nao toca no
// seed. Os UPDATEs repetem os filtros da acao (status aberto com a equipe e
// last_message_at antes do corte).

const admin = adminClient();
const PASSWORD = "SenhaDeTeste!234";
const suffix = crypto.randomUUID().slice(0, 8);
/** So digitos no telefone (E.164): o suffix tem letras. */
const digitos = String(Date.now()).slice(-6);

const ABERTAS_COM_A_EQUIPE = ["aguardando_humano", "em_atendimento"];
const DIAS = 30;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

type Pessoa = { user: User; client: SupabaseClient };

let clinicaA: string;
let clinicaB: string;
let gestorA: Pessoa;
let leituraA: Pessoa;
let adminB: Pessoa;
let paradaA: string;
let recenteA: string;
let paradaB: string;

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

/** Um contato novo e a conversa aberta dele, parada ha `diasAtras` dias. */
async function criarConversa(
  clinicId: string,
  final: string,
  diasAtras: number,
): Promise<string> {
  const { data: contato, error: erroDoContato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849${digitos}${final}`,
      name: `Parada ${final}`,
    })
    .select("id")
    .single();
  if (erroDoContato || !contato) {
    throw new Error(`Falha ao criar contato: ${erroDoContato?.message}`);
  }
  const { data: conversa, error } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contato.id,
      status: "aguardando_humano",
      awaiting_reply: true,
      last_message_at: new Date(
        Date.now() - diasAtras * UM_DIA_MS,
      ).toISOString(),
    })
    .select("id")
    .single();
  if (error || !conversa) {
    throw new Error(`Falha ao criar conversa: ${error?.message}`);
  }
  return conversa.id as string;
}

/** O status da conversa, lido sem RLS (a prova anti falso positivo). */
async function statusDe(conversationId: string): Promise<string | null> {
  const { data } = await admin
    .from("conversation")
    .select("status")
    .eq("id", conversationId)
    .single();
  return (data?.status as string | undefined) ?? null;
}

/** O instante do corte, como a acao calcula (instanteDoCorte). */
function corte(): string {
  return new Date(Date.now() - DIAS * UM_DIA_MS).toISOString();
}

/** O UPDATE da acao, pela sessao de quem chama. */
function resolverComo(pessoa: Pessoa, clinicId: string, ids: string[]) {
  return pessoa.client
    .from("conversation")
    .update({ status: "resolvida", awaiting_reply: false })
    .in("id", ids)
    .eq("clinic_id", clinicId)
    .in("status", ABERTAS_COM_A_EQUIPE)
    .lt("last_message_at", corte())
    .select("id");
}

/** O evento no fio, como a acao grava. */
function eventoComo(pessoa: Pessoa, clinicId: string, conversationId: string) {
  return pessoa.client.from("message").insert({
    clinic_id: clinicId,
    conversation_id: conversationId,
    direction: "saida",
    author: "sistema",
    content_type: "evento",
    body: eventoDaConversaParada(DIAS),
  });
}

beforeAll(async () => {
  const { data: clinicas, error } = await admin
    .from("clinic")
    .insert([
      {
        name: `Paradas A ${suffix}`,
        slug: `paradas-a-${suffix}`,
        e_de_teste: true,
      },
      {
        name: `Paradas B ${suffix}`,
        slug: `paradas-b-${suffix}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug");
  if (error || clinicas?.length !== 2) {
    throw new Error(`Falha ao criar clínicas: ${error?.message}`);
  }
  clinicaA = clinicas.find((c) => c.slug === `paradas-a-${suffix}`)!
    .id as string;
  clinicaB = clinicas.find((c) => c.slug === `paradas-b-${suffix}`)!
    .id as string;
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicaA);
  await criarNumeroDeTeste(admin, clinicaB);

  [gestorA, leituraA, adminB] = await Promise.all([
    criarPessoa(`paradas-gestor-a-${suffix}@teste.dev`),
    criarPessoa(`paradas-leitura-a-${suffix}@teste.dev`),
    criarPessoa(`paradas-admin-b-${suffix}@teste.dev`),
  ]);

  const { error: erroDosMembros } = await admin.from("clinic_member").insert([
    { clinic_id: clinicaA, user_id: gestorA.user.id, role: "gestor" },
    { clinic_id: clinicaA, user_id: leituraA.user.id, role: "leitura" },
    { clinic_id: clinicaB, user_id: adminB.user.id, role: "admin" },
  ]);
  if (erroDosMembros) {
    throw new Error(`Falha ao criar membros: ${erroDosMembros.message}`);
  }

  [paradaA, recenteA, paradaB] = await Promise.all([
    criarConversa(clinicaA, "01", 40),
    criarConversa(clinicaA, "02", 2),
    criarConversa(clinicaB, "03", 40),
  ]);
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  await Promise.all(
    [gestorA, leituraA, adminB]
      .filter(Boolean)
      .map((pessoa) => admin.auth.admin.deleteUser(pessoa.user.id)),
  );
});

describe("resolver as conversas paradas: isolamento entre clínicas", () => {
  it("o gestor da A não conta as paradas da B", async () => {
    const { count, error } = await gestorA.client
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaB)
      .in("status", ABERTAS_COM_A_EQUIPE)
      .lt("last_message_at", corte());
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("o gestor da A não resolve a parada da B: o UPDATE volta vazio e ela continua aberta", async () => {
    const { data, error } = await resolverComo(gestorA, clinicaB, [paradaB]);
    // A RLS de UPDATE recorta a linha (sem erro) ou recusa: nunca resolve.
    expect(error === null ? (data ?? []).length : 0).toBe(0);
    expect(await statusDe(paradaB)).toBe("aguardando_humano");
  });

  it("o gestor da A não grava o evento no fio da B, nem pela clínica B nem pela A", async () => {
    const pelaB = await eventoComo(gestorA, clinicaB, paradaB);
    expect(pelaB.error).not.toBeNull();
    // A clinica dele no clinic_id e a conversa da B: o exists da policy
    // exige a conversa da mesma clinica.
    const pelaA = await eventoComo(gestorA, clinicaA, paradaB);
    expect(pelaA.error).not.toBeNull();
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", paradaB)
      .eq("content_type", "evento");
    expect(count).toBe(0);
  });

  it("o gestor da A não grava a trilha em nome da B", async () => {
    const { error } = await gestorA.client.from("audit_log").insert({
      clinic_id: clinicaB,
      user_id: gestorA.user.id,
      action: "resolveu_conversas_paradas",
      entity: "conversation",
      entity_id: null,
      detalhes: { dias: DIAS, quantas: 1 },
    });
    expect(error).not.toBeNull();
  });
});

describe("resolver as conversas paradas: o papel leitura não escreve", () => {
  it("leitura da A não resolve a parada da A (a policy, não só a Server Action)", async () => {
    const { data, error } = await resolverComo(leituraA, clinicaA, [paradaA]);
    expect(error === null ? (data ?? []).length : 0).toBe(0);
    expect(await statusDe(paradaA)).toBe("aguardando_humano");
  });

  it("leitura da A não grava o evento no fio", async () => {
    const { error } = await eventoComo(leituraA, clinicaA, paradaA);
    expect(error).not.toBeNull();
  });
});

describe("resolver as conversas paradas: o gestor da própria clínica", () => {
  it("resolve só a parada há mais de N dias; a recente fica; o evento e a trilha gravam", async () => {
    const { data, error } = await resolverComo(gestorA, clinicaA, [
      paradaA,
      recenteA,
    ]);
    expect(error).toBeNull();
    expect((data ?? []).map((linha: { id: string }) => linha.id)).toEqual([
      paradaA,
    ]);
    expect(await statusDe(paradaA)).toBe("resolvida");
    expect(await statusDe(recenteA)).toBe("aguardando_humano");

    const evento = await eventoComo(gestorA, clinicaA, paradaA);
    expect(evento.error).toBeNull();

    const trilha = await gestorA.client.from("audit_log").insert({
      clinic_id: clinicaA,
      user_id: gestorA.user.id,
      action: "resolveu_conversas_paradas",
      entity: "conversation",
      entity_id: null,
      detalhes: { dias: DIAS, quantas: 1 },
    });
    expect(trilha.error).toBeNull();

    // A trilha leva so os dias e a quantidade: nada de paciente.
    const { data: linhas } = await admin
      .from("audit_log")
      .select("detalhes")
      .eq("clinic_id", clinicaA)
      .eq("action", "resolveu_conversas_paradas");
    expect(linhas).toEqual([{ detalhes: { dias: DIAS, quantas: 1 } }]);
  });

  it("a conversa já resolvida não volta a contar nem se resolve de novo", async () => {
    const { data, error } = await resolverComo(gestorA, clinicaA, [paradaA]);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
