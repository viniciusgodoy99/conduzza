import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// "Transferir para" e historico do contato no fio (achados 2, 10 e 16 da
// revisao de liberacao). O que a Server Action transferirConversaAction e o
// fetchMessagesPage com contactId confiam ao banco:
// - a recepcao consegue gravar OUTRO responsavel (a policy de UPDATE de
//   conversation so recorta o profissional), e o update condicional ao
//   responsavel visto recusa a corrida;
// - leitura e outra clinica nao conseguem;
// - o profissional passa a ver a conversa transferida, e so ela: o historico
//   de conversas anteriores do contato continua recortado pela RLS;
// - a recepcao enxerga a equipe ativa para escolher o destino;
// - reabrir uma resolvida com outra aberta do mesmo contato bate no indice
//   unico (23505), que a acao traduz em "ja tem uma conversa aberta".
// Clinicas descartaveis proprias: nao toca no seed.

const UNIQUE_VIOLATION = "23505";
const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-transf-${suffix}!`;

const admin = adminClient();

type Pessoa = { user: User; client: SupabaseClient };

let recepcaoA: Pessoa;
let profA: Pessoa;
let leituraA: Pessoa;
let adminB: Pessoa;
let clinicA: string;
let clinicB: string;
let conversaResolvida: string;
let conversaAberta: string;

async function criarPessoa(email: string): Promise<User> {
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

async function entrar(email: string): Promise<SupabaseClient> {
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

async function obrigatorio<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  rotulo: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${rotulo}: ${error.message}`);
  }
  return data;
}

const email = (nome: string) => `transf-${nome}-${suffix}@teste.dev`;

beforeAll(async () => {
  const [r, p, l, b] = await Promise.all([
    criarPessoa(email("recepcao-a")),
    criarPessoa(email("prof-a")),
    criarPessoa(email("leitura-a")),
    criarPessoa(email("admin-b")),
  ]);

  const clinicas = await obrigatorio(
    admin
      .from("clinic")
      .insert([
        { name: `Transf A ${suffix}`, slug: `transf-a-${suffix}` },
        { name: `Transf B ${suffix}`, slug: `transf-b-${suffix}` },
      ])
      .select("id, slug"),
    "clinic",
  );
  clinicA = clinicas!.find(
    (c: { slug: string }) => c.slug === `transf-a-${suffix}`,
  )!.id;
  clinicB = clinicas!.find(
    (c: { slug: string }) => c.slug === `transf-b-${suffix}`,
  )!.id;
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicA);

  await obrigatorio(
    admin.from("clinic_member").insert([
      { clinic_id: clinicA, user_id: r.id, role: "recepcao" },
      { clinic_id: clinicA, user_id: p.id, role: "profissional" },
      { clinic_id: clinicA, user_id: l.id, role: "leitura" },
      { clinic_id: clinicB, user_id: b.id, role: "admin" },
    ]),
    "clinic_member",
  );

  const contato = await obrigatorio(
    admin
      .from("contact")
      .insert({
        clinic_id: clinicA,
        phone_e164: `+5584982${suffix.slice(0, 6)}1`,
        name: "Contato Transferido",
      })
      .select("id")
      .single(),
    "contact",
  );

  // Um ciclo antigo, resolvido e atendido pela recepcao, e o ciclo novo,
  // aberto e sem responsavel: o mesmo contato, duas conversas.
  const resolvida = await obrigatorio(
    admin
      .from("conversation")
      .insert({
        clinic_id: clinicA,
        contact_id: contato!.id,
        status: "resolvida",
        assignee_user_id: r.id,
      })
      .select("id")
      .single(),
    "conversa resolvida",
  );
  conversaResolvida = resolvida!.id;
  const aberta = await obrigatorio(
    admin
      .from("conversation")
      .insert({
        clinic_id: clinicA,
        contact_id: contato!.id,
        status: "aguardando_humano",
      })
      .select("id")
      .single(),
    "conversa aberta",
  );
  conversaAberta = aberta!.id;

  await obrigatorio(
    admin.from("message").insert([
      {
        clinic_id: clinicA,
        conversation_id: conversaResolvida,
        wa_message_id: `transf:${suffix}:1`,
        direction: "entrada",
        author: "paciente",
        body: "ciclo antigo",
      },
      {
        clinic_id: clinicA,
        conversation_id: conversaAberta,
        wa_message_id: `transf:${suffix}:2`,
        direction: "entrada",
        author: "paciente",
        body: "ciclo novo",
      },
    ]),
    "message",
  );

  recepcaoA = { user: r, client: await entrar(email("recepcao-a")) };
  profA = { user: p, client: await entrar(email("prof-a")) };
  leituraA = { user: l, client: await entrar(email("leitura-a")) };
  adminB = { user: b, client: await entrar(email("admin-b")) };
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicA, clinicB]);
  await Promise.all(
    [recepcaoA, profA, leituraA, adminB]
      .filter(Boolean)
      .map((pessoa) => admin.auth.admin.deleteUser(pessoa.user.id)),
  );
});

describe("equipe para o Transferir", () => {
  it("a recepção enxerga os membros ativos que atendem", async () => {
    const { data, error } = await recepcaoA.client
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", clinicA)
      .eq("status", "ativo")
      .in("role", ["admin", "gestor", "recepcao", "profissional"]);
    expect(error).toBeNull();
    const ids = (data ?? []).map((m: { user_id: string }) => m.user_id);
    expect(ids).toContain(profA.user.id);
    expect(ids).not.toContain(leituraA.user.id);
  });

  it("a outra clínica não enxerga a equipe da A", async () => {
    const { data, error } = await adminB.client
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", clinicA);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("transferir a conversa", () => {
  it("antes da transferência, o profissional não vê a conversa", async () => {
    const { data, error } = await profA.client
      .from("conversation")
      .select("id")
      .eq("id", conversaAberta);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("somente leitura não consegue passar a conversa (0 linhas)", async () => {
    const { data, error } = await leituraA.client
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: profA.user.id })
      .eq("id", conversaAberta)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin de outra clínica não consegue passar a conversa (0 linhas)", async () => {
    const { data, error } = await adminB.client
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: adminB.user.id })
      .eq("id", conversaAberta)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a recepção passa para o profissional, condicional ao responsável visto", async () => {
    const { data, error } = await recepcaoA.client
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: profA.user.id })
      .eq("id", conversaAberta)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("a mesma transferência com o estado velho não muda nada (corrida)", async () => {
    const { data, error } = await recepcaoA.client
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: recepcaoA.user.id })
      .eq("id", conversaAberta)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("o profissional passa a ver a conversa e as mensagens dela", async () => {
    const conversa = await profA.client
      .from("conversation")
      .select("id, assignee_user_id")
      .eq("id", conversaAberta);
    expect(conversa.error).toBeNull();
    expect(conversa.data).toHaveLength(1);
    expect(conversa.data?.[0]?.assignee_user_id).toBe(profA.user.id);
  });

  it("o histórico do contato continua recortado: o profissional não lê o ciclo antigo", async () => {
    // A mesma consulta que o fio faz com contactId.
    const { data, error } = await profA.client
      .from("message")
      .select("conversation_id, body")
      .in("conversation_id", [conversaResolvida, conversaAberta]);
    expect(error).toBeNull();
    expect(
      (data ?? []).map((m: { conversation_id: string }) => m.conversation_id),
    ).toEqual([conversaAberta]);
  });

  it("anti falso-positivo: a recepção lê os dois ciclos", async () => {
    const { data, error } = await recepcaoA.client
      .from("message")
      .select("conversation_id")
      .in("conversation_id", [conversaResolvida, conversaAberta]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});

describe("reabrir com outra conversa aberta", () => {
  it("o índice único recusa com 23505", async () => {
    const { error } = await recepcaoA.client
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: recepcaoA.user.id })
      .eq("id", conversaResolvida)
      .eq("status", "resolvida")
      .select("id");
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });
});
