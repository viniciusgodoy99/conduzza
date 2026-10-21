import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Onda 3, a passagem da IA no funil (migration 20261023100000, M1), pela API
// com JWT real de cada papel. O que esta em jogo:
//   - etapa_pendente_da_passagem (o movimento que esperou o contato) tem RLS
//     ligada SEM policy e nenhum grant para anon e authenticated: nenhuma
//     sessao, da clinica A ou da B, le, grava, muda ou apaga pendencia (so
//     ids, mas o funil e de uma clinica so); a service role le (anti falso
//     positivo: a linha existe);
//   - mover_lead_para_aguardando so as funcoes do banco executam (nem a
//     service role); processar_pendencias_do_funil, so a service role (e o
//     pg_cron); as funcoes de gatilho (passagem_da_ia_move_o_lead e
//     recusar_followup_em_aguardando), ninguem pela API;
//   - D3 (decisao do dono de 21/10/2026): o gestor nao cria regua de
//     follow-up em Aguardando resposta nem pelo PostgREST (P0001, hint
//     etapa_sem_followup), nao muda uma regua para la, e cria em Em contato
//     (anti falso positivo).
// Toda negacao tem o caso positivo ao lado.
//
// ESCRITO NA ONDA 3 E NAO RODADO por quem escreveu: grava no banco. Quem
// roda e o coordenador, DEPOIS de aplicar a M1, com npm run test:rls.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no
// afterAll; nada usa a id da salud-care, da teste123 nem da Conduzza Teste.
// Telefones ficticios; nenhum dado de paciente.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'funil-passagem-rls-%' and e_de_teste;
// e os usuarios sinteticos (auth.users com email like
// 'funil-passagem-rls-%@teste.dev'), pelo painel do Supabase ou pela API de
// administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = "FunilPassagemRls!2026";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) =>
  `funil-passagem-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let conversaA = "";
let contatoB = "";
let conversaB = "";

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Funil passagem RLS ${nome} ${sufixo}`,
      slug: `funil-passagem-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

/** Lead em Novo com conversa esperando a equipe (so as linhas). */
async function leadComConversa(
  clinicId: string,
  numero: string,
  final: string,
): Promise<{ contato: string; conversa: string }> {
  const contato = await inserir("contact", {
    clinic_id: clinicId,
    phone_e164: `+55849${digitos}${final}`,
    name: `Contato sintético ${final}`,
  });
  const conversa = await inserir("conversation", {
    clinic_id: clinicId,
    contact_id: contato,
    status: "aguardando_humano",
    awaiting_reply: true,
    whatsapp_account_id: numero,
  });
  return { contato, conversa };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;
  const numeroB = (await criarNumeroDeTeste(admin, clinicaB)).id;
  ({ contato: contatoA, conversa: conversaA } = await leadComConversa(
    clinicaA,
    numeroA,
    "1",
  ));
  ({ contato: contatoB, conversa: conversaB } = await leadComConversa(
    clinicaB,
    numeroB,
    "2",
  ));
  // A pendencia da A existe (gravada como a passagem grava: pelo banco).
  await admin
    .from("etapa_pendente_da_passagem")
    .insert({
      contact_id: contatoA,
      clinic_id: clinicaA,
      conversation_id: conversaA,
    })
    .throwOnError();

  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("admin-b", clinicaB, "admin");
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("etapa_pendente_da_passagem: nenhuma sessão lê nem grava", () => {
  it("a service role lê a pendência da A (anti falso positivo)", async () => {
    const { data } = await admin
      .from("etapa_pendente_da_passagem")
      .select("contact_id, clinic_id, conversation_id, tentativas")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(data).toEqual([
      {
        contact_id: contatoA,
        clinic_id: clinicaA,
        conversation_id: conversaA,
        tentativas: 0,
      },
    ]);
  });

  it("gestor e recepção da A e o administrador da B não leem (42501)", async () => {
    for (const quem of ["gestor-a", "recepcao-a", "admin-b"]) {
      const { data, error } = await como(quem)
        .from("etapa_pendente_da_passagem")
        .select("contact_id");
      expect(error?.code, quem).toBe(PERMISSAO_NEGADA);
      expect(data, quem).toBeNull();
    }
  });

  it("anon não lê (42501)", async () => {
    const { error } = await anonClient()
      .from("etapa_pendente_da_passagem")
      .select("contact_id");
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("ninguém da clínica grava, muda ou apaga pendência; a da A continua igual", async () => {
    for (const quem of ["gestor-a", "admin-b"]) {
      const cliente = como(quem);
      const grava = await cliente.from("etapa_pendente_da_passagem").insert({
        contact_id: contatoB,
        clinic_id: clinicaB,
        conversation_id: conversaB,
      });
      expect(grava.error?.code, `${quem} insert`).toBe(PERMISSAO_NEGADA);
      const muda = await cliente
        .from("etapa_pendente_da_passagem")
        .update({ tentativas: 59 })
        .eq("contact_id", contatoA);
      expect(muda.error?.code, `${quem} update`).toBe(PERMISSAO_NEGADA);
      const apaga = await cliente
        .from("etapa_pendente_da_passagem")
        .delete()
        .eq("contact_id", contatoA);
      expect(apaga.error?.code, `${quem} delete`).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("etapa_pendente_da_passagem")
      .select("contact_id, tentativas")
      .in("clinic_id", [clinicaA, clinicaB])
      .throwOnError();
    expect(data).toEqual([{ contact_id: contatoA, tentativas: 0 }]);
  });
});

describe("as funções novas: quem executa", () => {
  const argsDoMover = () => ({
    p_clinic_id: clinicaA,
    p_contact_id: contatoA,
    p_conversation_id: conversaA,
  });

  it("nenhuma sessão nem anon executa mover_lead_para_aguardando ou processar_pendencias_do_funil", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ["gestor-a", como("gestor-a")],
      ["recepcao-a", como("recepcao-a")],
      ["admin-b", como("admin-b")],
      ["anon", anonClient()],
    ];
    for (const [quem, cliente] of sessoes) {
      const mover = await cliente.rpc(
        "mover_lead_para_aguardando",
        argsDoMover(),
      );
      expect(mover.error?.code, `${quem} mover`).toBe(PERMISSAO_NEGADA);
      const processar = await cliente.rpc("processar_pendencias_do_funil", {
        p_clinic_id: clinicaA,
        p_incluir_teste: true,
      });
      expect(processar.error?.code, `${quem} processar`).toBe(PERMISSAO_NEGADA);
    }
    // Nada mudou: o lead continua em Novo e a pendencia continua la.
    const { data: lead } = await admin
      .from("contact")
      .select("funnel_stage")
      .eq("id", contatoA)
      .single()
      .throwOnError();
    expect(lead).toEqual({ funnel_stage: "novo" });
    const { count } = await admin
      .from("etapa_pendente_da_passagem")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", contatoA)
      .throwOnError();
    expect(count).toBe(1);
  });

  it("a service role não executa mover_lead_para_aguardando (só as funções do banco)", async () => {
    const { error } = await admin.rpc(
      "mover_lead_para_aguardando",
      argsDoMover(),
    );
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("as funções de gatilho não são chamáveis pela API", async () => {
    for (const nome of [
      "passagem_da_ia_move_o_lead",
      "recusar_followup_em_aguardando",
      // O gatilho da ordem da jornada (revisao de 21/10/2026).
      "conferir_ordem_da_jornada",
    ]) {
      const daSessao = await como("gestor-a").rpc(nome);
      expect(daSessao.error, nome).not.toBeNull();
      expect(daSessao.data, nome).toBeNull();
      const doServidor = await admin.rpc(nome);
      expect(doServidor.error, `${nome} servidor`).not.toBeNull();
    }
  });
});

describe("D3: régua de follow-up em Aguardando resposta", () => {
  it("o gestor não cria pelo PostgREST (P0001 etapa_sem_followup)", async () => {
    const { error } = await como("gestor-a").from("cadence").insert({
      clinic_id: clinicaA,
      kind: "followup",
      name: "Follow-up em Aguardando",
      trigger_stage: "aguardando_resposta",
    });
    expect(error?.code).toBe("P0001");
    expect(error?.hint).toBe("etapa_sem_followup");
    expect(error?.message).toContain("não tem régua de follow-up");
    const { count } = await admin
      .from("cadence")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .eq("kind", "followup")
      .throwOnError();
    expect(count).toBe(0);
  });

  it("em Em contato cria (anti falso positivo), mas não muda a régua para Aguardando resposta", async () => {
    const cliente = como("gestor-a");
    const { data, error } = await cliente
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "followup",
        name: "Follow-up em Em contato",
        trigger_stage: "em_contato",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const regua = (data as { id: string }).id;
    const muda = await cliente
      .from("cadence")
      .update({ trigger_stage: "aguardando_resposta" })
      .eq("id", regua);
    expect(muda.error?.code).toBe("P0001");
    expect(muda.error?.hint).toBe("etapa_sem_followup");
    const { data: depois } = await admin
      .from("cadence")
      .select("trigger_stage")
      .eq("id", regua)
      .single()
      .throwOnError();
    expect(depois).toEqual({ trigger_stage: "em_contato" });
  });

  it("nem a service role cria (o gatilho vale para todos)", async () => {
    const { error } = await admin.from("cadence").insert({
      clinic_id: clinicaB,
      kind: "followup",
      name: "Follow-up do servidor em Aguardando",
      trigger_stage: "aguardando_resposta",
    });
    expect(error?.code).toBe("P0001");
    expect(error?.hint).toBe("etapa_sem_followup");
  });
});
