import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Quem pode apagar mensagem de conversa de paciente, e ate quando.
//
// A regra mora no banco (pode_apagar_mensagem), e nao na Server Action, por
// exigencia da regra 3.1 do CLAUDE.md: esconder botao nao protege nada, e uma
// checagem que vive so no TypeScript cai junto com a primeira chamada direta a
// RPC. Estes testes chamam a RPC pela SESSAO, exatamente como o navegador
// chamaria, sem passar pela tela.
//
// Decisao do dono do produto em 02/09/2026, que e o que estes testes travam:
// apaga quem escreveu, mais administrador e gestor, nunca o papel 'leitura'.
// O prazo de 'apagar para todos' e o do WhatsApp, 60 horas.

const admin = adminClient();
const PASSWORD = "SenhaDeTeste!234";
const suffix = Math.random().toString(36).slice(2, 8);

type Pessoa = { user: User; client: SupabaseClient };

let clinicaA: string;
let clinicaB: string;
let conversaA: string;
let autora: Pessoa;
let colega: Pessoa;
let chefe: Pessoa;
let soLeitura: Pessoa;
let deOutraClinica: Pessoa;

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

/** Uma mensagem de saida da clinica A, com a idade que o teste precisar. */
async function criarMensagem(opcoes: {
  autor?: string | null;
  horasAtras?: number;
  nota?: boolean;
  entrada?: boolean;
}): Promise<string> {
  const criadaEm = new Date(
    Date.now() - (opcoes.horasAtras ?? 0) * 3_600_000,
  ).toISOString();
  const { data, error } = await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: opcoes.entrada ? "entrada" : "saida",
      author: opcoes.entrada ? "paciente" : "usuario",
      author_user_id: opcoes.entrada ? null : (opcoes.autor ?? autora.user.id),
      content_type: "texto",
      body: "conteudo sensivel de teste",
      is_internal_note: opcoes.nota ?? false,
      wa_message_id: opcoes.nota ? null : `WA-${crypto.randomUUID()}`,
      delivery_status: opcoes.nota ? null : "enviada",
      created_at: criadaEm,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar mensagem: ${error?.message}`);
  }
  return data.id as string;
}

beforeAll(async () => {
  const { data: clinicas, error } = await admin
    .from("clinic")
    .insert([
      {
        name: `Apagar A ${suffix}`,
        slug: `apagar-a-${suffix}`,
        e_de_teste: true,
      },
      {
        name: `Apagar B ${suffix}`,
        slug: `apagar-b-${suffix}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug");
  if (error || clinicas?.length !== 2) {
    throw new Error(`Falha ao criar clínicas: ${error?.message}`);
  }
  clinicaA = clinicas.find((c) => c.slug === `apagar-a-${suffix}`)!
    .id as string;
  clinicaB = clinicas.find((c) => c.slug === `apagar-b-${suffix}`)!
    .id as string;

  [autora, colega, chefe, soLeitura, deOutraClinica] = await Promise.all([
    criarPessoa(`apagar-autora-${suffix}@teste.dev`),
    criarPessoa(`apagar-colega-${suffix}@teste.dev`),
    criarPessoa(`apagar-chefe-${suffix}@teste.dev`),
    criarPessoa(`apagar-leitura-${suffix}@teste.dev`),
    criarPessoa(`apagar-outra-${suffix}@teste.dev`),
  ]);

  await admin.from("clinic_member").insert([
    { clinic_id: clinicaA, user_id: autora.user.id, role: "recepcao" },
    { clinic_id: clinicaA, user_id: colega.user.id, role: "recepcao" },
    { clinic_id: clinicaA, user_id: chefe.user.id, role: "gestor" },
    { clinic_id: clinicaA, user_id: soLeitura.user.id, role: "leitura" },
    { clinic_id: clinicaB, user_id: deOutraClinica.user.id, role: "admin" },
  ]);

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+5511${Date.now() % 100000000}`,
    })
    .select("id")
    .single();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({ clinic_id: clinicaA, contact_id: contato!.id })
    .select("id")
    .single();
  conversaA = conversa!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const p of [autora, colega, chefe, soLeitura, deOutraClinica]) {
    if (p?.user) {
      await admin.auth.admin.deleteUser(p.user.id);
    }
  }
});

describe("quem pode apagar", () => {
  it("quem escreveu apaga a própria mensagem", async () => {
    const id = await criarMensagem({});
    const { data } = await autora.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: true });
  });

  it("colega de mesmo papel NÃO apaga mensagem alheia", async () => {
    // O caso que separa "a equipe toda mexe em tudo" de "cada um responde pelo
    // que escreveu". Duas recepcionistas na mesma clínica, mesma conversa.
    const id = await criarMensagem({});
    const { data } = await colega.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "nao_e_sua" });
  });

  it("gestor apaga mensagem de qualquer pessoa da clínica", async () => {
    const id = await criarMensagem({});
    const { data } = await chefe.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: true });
  });

  it("papel leitura não apaga nem a mensagem que apareceria como dele", async () => {
    const id = await criarMensagem({ autor: soLeitura.user.id });
    const { data } = await soLeitura.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "local",
    });
    expect(data).toMatchObject({ ok: false, motivo: "sem_permissao" });
  });

  it("membro de outra clínica não enxerga a mensagem para apagar", async () => {
    // Isolamento entre clínicas: a função é SECURITY DEFINER, então a RLS não
    // roda dentro dela. Se a checagem de papel não estivesse lá, o id bastaria.
    const id = await criarMensagem({});
    const { data } = await deOutraClinica.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "sem_permissao" });
  });
});

describe("o prazo do WhatsApp", () => {
  it("dentro de 60 horas, apagar para todos é permitido", async () => {
    const id = await criarMensagem({ horasAtras: 59 });
    const { data } = await autora.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: true });
  });

  it("passadas 60 horas, apagar para todos é recusado", async () => {
    const id = await criarMensagem({ horasAtras: 61 });
    const { data } = await autora.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "prazo_vencido" });
  });

  it("mas apagar só aqui continua valendo, sem prazo", async () => {
    const id = await criarMensagem({ horasAtras: 500 });
    const { data } = await autora.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "local",
    });
    expect(data).toMatchObject({ ok: true });
  });

  it("mensagem do paciente não pode ser apagada para todos", async () => {
    const id = await criarMensagem({ entrada: true });
    const { data } = await chefe.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "do_paciente" });
  });

  it("nota interna só existe aqui, então 'para todos' não se aplica", async () => {
    const id = await criarMensagem({ nota: true });
    const { data } = await autora.client.rpc("pode_apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "nota_e_local" });
  });
});

describe("o que acontece com o conteúdo", () => {
  it("o corpo sai da linha viva e vai para o cofre", async () => {
    const id = await criarMensagem({});
    const { data } = await autora.client.rpc("apagar_mensagem", {
      p_message_id: id,
      p_escopo: "local",
    });
    expect(data).toMatchObject({ ok: true });

    // A linha continua existindo, com a lápide, mas sem o texto: message está
    // publicada no tempo real, e deixar o corpo faria o apagamento empurrar o
    // texto apagado por websocket para todas as abas abertas da clínica.
    const { data: viva } = await admin
      .from("message")
      .select("body, deleted_at, deleted_by, deleted_source, deleted_escopo")
      .eq("id", id)
      .single();
    expect(viva!.body).toBeNull();
    expect(viva!.deleted_at).not.toBeNull();
    expect(viva!.deleted_by).toBe(autora.user.id);
    expect(viva!.deleted_source).toBe("clinica");
    expect(viva!.deleted_escopo).toBe("local");

    const { data: cofre } = await admin
      .from("message_apagada")
      .select("body, escopo, origem, apagada_por")
      .eq("message_id", id)
      .single();
    expect(cofre!.body).toBe("conteudo sensivel de teste");
    expect(cofre!.apagada_por).toBe(autora.user.id);
  });

  it("apagar duas vezes não sobrescreve quem apagou primeiro", async () => {
    const id = await criarMensagem({});
    await autora.client.rpc("apagar_mensagem", {
      p_message_id: id,
      p_escopo: "local",
    });
    const { data } = await chefe.client.rpc("apagar_mensagem", {
      p_message_id: id,
      p_escopo: "todos",
    });
    expect(data).toMatchObject({ ok: false, motivo: "ja_apagada" });

    const { data: viva } = await admin
      .from("message")
      .select("deleted_by, deleted_escopo")
      .eq("id", id)
      .single();
    expect(viva!.deleted_by).toBe(autora.user.id);
    expect(viva!.deleted_escopo).toBe("local");
  });

  it("recepção não lê o cofre; gestor lê", async () => {
    // O cofre guarda exatamente o que alguém quis tirar da tela. Deixá-lo
    // aberto para a equipe inteira desfaria o apagamento por outra porta.
    const id = await criarMensagem({});
    await autora.client.rpc("apagar_mensagem", {
      p_message_id: id,
      p_escopo: "local",
    });

    const { data: paraAutora } = await autora.client
      .from("message_apagada")
      .select("body")
      .eq("message_id", id);
    expect(paraAutora ?? []).toHaveLength(0);

    const { data: paraChefe } = await chefe.client
      .from("message_apagada")
      .select("body")
      .eq("message_id", id);
    expect(paraChefe).toHaveLength(1);
  });

  it("ninguém escreve no cofre pela sessão", async () => {
    const { error } = await chefe.client.from("message_apagada").insert({
      message_id: crypto.randomUUID(),
      clinic_id: clinicaA,
      conversation_id: conversaA,
      escopo: "local",
      origem: "clinica",
    });
    expect(error).toBeTruthy();
  });
});
