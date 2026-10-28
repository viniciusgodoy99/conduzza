import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Urgencia e passagem da IA ao responsavel do lead (AG6a, parte de banco:
// migration 20261029120000_urgencia_e_passagem_da_ia.sql, com a revisao de
// 28/10/2026: a atribuicao saiu da passagem e virou a RPC
// atribuir_conversa_passada_pela_ia, chamada depois da frase), pela API com
// JWT real de cada papel. O que esta em jogo:
// - passar_conversa_da_ia_para_equipe e atribuir_conversa_passada_pela_ia:
//   42501 para toda sessao e para anon; o servidor recebe resposta de
//   negocio;
// - conversa_urgente (a marca): a clinica A le as suas e nao a da B; o
//   profissional so a da conversa que esta com ele; anon nao le (42501); o
//   contador do menu (as abertas pela RLS); o embutido 1 para 1 na lista do
//   Atendimento;
// - ninguem grava a marca pela API (insert, update e delete de cada papel e
//   da service role: 42501);
// - o Assumir pela sessao (o update condicional da tela) fecha a marca como
//   assumida, com quem assumiu (o gatilho le auth.uid() do JWT).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// urgencia-rls-*, apagadas no afterAll (as conversas, as marcas e as
// mensagens vao em cascata; o beforeAll apaga a sobra de uma execucao que
// morreu ha mais de uma hora), e os usuarios desta execucao (depois das
// clinicas). Nenhuma IA e liberada: as conversas "na IA" sao linhas gravadas
// direto pelo servidor (que pode por ia_atendendo) e a passagem e a de
// verdade, chamada pelo servidor com um job em execucao deste teste; nenhum
// executor roda aqui e nenhuma mensagem sai (numero fake). Nada usa a id de
// uma clinica real. Telefones ficticios. ESCRITO, AINDA NAO RODADO: grava no
// banco. Roda depois de aplicar a migration, com
// npm run test:rls -- urgencia-e-passagem-da-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic
//    where slug like 'urgencia-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u
//    where u.email like 'urgencia-rls-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `UrgenciaRls!${sufixo}`;
const WORKER = `urgencia-rls-${sufixo}`;

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) => `urgencia-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const SESSOES = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
  "admin-b",
] as const;

type Passagem = {
  passou: boolean;
  codigo: string;
  urgente: boolean;
};

type Atribuicao = {
  atribuida: boolean;
  codigo: string;
};

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let numeroB = "";
let profissionalA = "";
/** A marca aberta da A (na fila). */
let conversaAberta = "";
/** A marca encerrada da A, da conversa que esta com o profissional. */
let conversaDoProfissional = "";
/** A marca aberta da B. */
let conversaDaB = "";
let telefones = 0;

async function rpcOk<T>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(tabela: string, linha: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarClinica(nome: string): Promise<string> {
  return inserir("clinic", {
    name: `Urgência RLS ${nome} ${sufixo}`,
    slug: `urgencia-rls-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
}

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  professionalId: string | null = null,
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
      professional_id: professionalId,
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

/** Contato sintetico e a conversa dele "na IA" (so as linhas, pelo servidor). */
async function conversaNaIa(clinica: string, numero: string): Promise<string> {
  telefones += 1;
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55847${digitos}${String(telefones).padStart(2, "0")}`,
    name: "Contato sintético",
    kind: "lead",
  });
  return inserir("conversation", {
    clinic_id: clinica,
    contact_id: contato,
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
}

async function jobEmExecucao(clinica: string, numero: string, conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: WORKER,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

/** A conversa na IA passada por urgencia (a marca aberta), pelo servidor. */
async function conversaUrgente(clinica: string, numero: string): Promise<string> {
  const conversa = await conversaNaIa(clinica, numero);
  const job = await jobEmExecucao(clinica, numero, conversa);
  const r = await rpcOk<Passagem>("passar_conversa_da_ia_para_equipe", {
    p_job_id: job,
    p_worker: WORKER,
    p_motivo: "urgencia",
  });
  expect(r).toEqual({ passou: true, codigo: "passou", urgente: true });
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  return conversa;
}

async function marca(conversa: string) {
  const { data } = await admin
    .from("conversa_urgente")
    .select("clinic_id, encerrada_em, encerrada_por, encerrada_como")
    .eq("conversation_id", conversa)
    .maybeSingle()
    .throwOnError();
  return data as {
    clinic_id: string;
    encerrada_em: string | null;
    encerrada_por: string | null;
    encerrada_como: string | null;
  } | null;
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "urgencia-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" })).id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" })).id;
  profissionalA = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional", profissionalA);
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("admin-b", clinicaB, "admin");

  conversaAberta = await conversaUrgente(clinicaA, numeroA);
  conversaDoProfissional = await conversaUrgente(clinicaA, numeroA);
  // O servidor poe a conversa com o profissional: a marca fecha (o sistema,
  // sem sessao: transferida, sem quem).
  await admin
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: ids.get("profissional-a")! })
    .eq("id", conversaDoProfissional)
    .throwOnError();
  conversaDaB = await conversaUrgente(clinicaB, numeroB);
}, 120_000);

afterAll(async () => {
  for (const clinica of [clinicaA, clinicaB]) {
    if (clinica) {
      const { error } = await admin.from("clinic").delete().eq("id", clinica);
      expect(error, "apagar a clinica do teste").toBeNull();
    }
  }
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("a passagem e a atribuicao: so o servidor", () => {
  it("toda sessao e anon recebem 42501 nas duas; o servidor recebe resposta de negocio", async () => {
    const conversa = await conversaNaIa(clinicaA, numeroA);
    const job = await jobEmExecucao(clinicaA, numeroA, conversa);
    const daPassagem = { p_job_id: job, p_worker: WORKER, p_motivo: "urgencia" };
    const daAtribuicao = { p_job_id: job, p_worker: WORKER };
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      const { error: erroDaPassagem } = await cliente.rpc("passar_conversa_da_ia_para_equipe", daPassagem);
      expect(erroDaPassagem?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroDaAtribuicao } = await cliente.rpc("atribuir_conversa_passada_pela_ia", daAtribuicao);
      expect(erroDaAtribuicao?.code).toBe(PERMISSAO_NEGADA);
    }
    // A conversa continua na IA, sem marca nem responsavel: nenhuma sessao
    // passou nem atribuiu.
    expect(await marca(conversa)).toBeNull();
    const { data: naIa } = await admin
      .from("conversation")
      .select("status, assignee_user_id")
      .eq("id", conversa)
      .single()
      .throwOnError();
    expect(naIa).toEqual({ status: "ia_atendendo", assignee_user_id: null });
    // O servidor: outro worker nao tem a posse (resposta de negocio, nas duas).
    expect(
      await rpcOk<Passagem>("passar_conversa_da_ia_para_equipe", { ...daPassagem, p_worker: "outro" }),
    ).toEqual({ passou: false, codigo: "sem_posse", urgente: false });
    expect(
      await rpcOk<Atribuicao>("atribuir_conversa_passada_pela_ia", { ...daAtribuicao, p_worker: "outro" }),
    ).toEqual({ atribuida: false, codigo: "sem_posse" });
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  });
});

describe("conversa_urgente: quem le", () => {
  it("a A le as suas (na fila e a encerrada); a B so a dela; o profissional so a da conversa com ele", async () => {
    const todas = [conversaAberta, conversaDoProfissional, conversaDaB];
    const esperado: Record<(typeof SESSOES)[number], string[]> = {
      "admin-a": [conversaAberta, conversaDoProfissional],
      "gestor-a": [conversaAberta, conversaDoProfissional],
      "recepcao-a": [conversaAberta, conversaDoProfissional],
      "leitura-a": [conversaAberta, conversaDoProfissional],
      "profissional-a": [conversaDoProfissional],
      "admin-b": [conversaDaB],
    };
    for (const apelido of SESSOES) {
      const { data, error } = await como(apelido)
        .from("conversa_urgente")
        .select("conversation_id")
        .in("conversation_id", todas);
      expect(error, apelido).toBeNull();
      expect(
        (data as { conversation_id: string }[]).map((l) => l.conversation_id).sort(),
        apelido,
      ).toEqual([...esperado[apelido]].sort());
    }
    // O servidor le as tres (anti falso positivo: as tres existem).
    const { data: doServidor } = await admin
      .from("conversa_urgente")
      .select("conversation_id")
      .in("conversation_id", todas)
      .throwOnError();
    expect(doServidor).toHaveLength(3);
  });

  it("anon nao le (42501)", async () => {
    const { error } = await anonClient().from("conversa_urgente").select("conversation_id").limit(1);
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("o contador do menu: as abertas pela RLS (a recepcao conta a da fila; o profissional, nenhuma)", async () => {
    const todas = [conversaAberta, conversaDoProfissional, conversaDaB];
    const { count, error } = await como("recepcao-a")
      .from("conversa_urgente")
      .select("conversation_id", { count: "exact", head: true })
      .is("encerrada_em", null)
      .in("conversation_id", todas);
    expect(error).toBeNull();
    expect(count).toBe(1);
    const { count: doProfissional, error: erroProfissional } = await como("profissional-a")
      .from("conversa_urgente")
      .select("conversation_id", { count: "exact", head: true })
      .is("encerrada_em", null)
      .in("conversation_id", todas);
    expect(erroProfissional).toBeNull();
    expect(doProfissional).toBe(0);
  });

  it("o embutido 1 para 1 na lista do Atendimento", async () => {
    const { data, error } = await como("recepcao-a")
      .from("conversation")
      .select("id, conversa_urgente ( desde, encerrada_em )")
      .in("id", [conversaAberta, conversaDoProfissional]);
    expect(error).toBeNull();
    // Sem o tipo do banco, o cliente nao sabe que a FK e 1 para 1 (a PK e a
    // propria conversa): o PostgREST devolve UM objeto (ou nulo), nunca lista.
    const linhas = data as unknown as {
      id: string;
      conversa_urgente: { desde: string; encerrada_em: string | null } | null;
    }[];
    for (const linha of linhas) {
      expect(Array.isArray(linha.conversa_urgente)).toBe(false);
    }
    const porId = new Map(linhas.map((l) => [l.id, l.conversa_urgente]));
    expect(porId.get(conversaAberta)).toMatchObject({ encerrada_em: null });
    expect(porId.get(conversaAberta)?.desde).toBeTruthy();
    expect(porId.get(conversaDoProfissional)?.encerrada_em).toBeTruthy();
  });
});

describe("conversa_urgente: ninguem grava pela API", () => {
  it("insert, update e delete de cada papel e da service role: 42501; a marca fica", async () => {
    for (const cliente of [admin, anonClient(), ...SESSOES.map(como)]) {
      const { error: erroInserir } = await cliente.from("conversa_urgente").insert({
        conversation_id: conversaDoProfissional,
        clinic_id: clinicaA,
        desde: new Date().toISOString(),
        job_id: crypto.randomUUID(),
      });
      expect(erroInserir?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroMudar } = await cliente
        .from("conversa_urgente")
        .update({ encerrada_em: new Date().toISOString(), encerrada_como: "outra" })
        .eq("conversation_id", conversaAberta);
      expect(erroMudar?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroApagar } = await cliente
        .from("conversa_urgente")
        .delete()
        .eq("conversation_id", conversaAberta);
      expect(erroApagar?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await marca(conversaAberta)).toMatchObject({
      clinic_id: clinicaA,
      encerrada_em: null,
      encerrada_como: null,
    });
  });
});

describe("o gatilho le quem tirou a conversa (o JWT)", () => {
  it("o Assumir pela sessao (o update condicional da tela) fecha a marca como assumida, por quem assumiu", async () => {
    const conversa = await conversaUrgente(clinicaA, numeroA);
    const recepcao = ids.get("recepcao-a")!;
    const { data, error } = await como("recepcao-a")
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: recepcao })
      .eq("id", conversa)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await marca(conversa)).toMatchObject({
      encerrada_por: recepcao,
      encerrada_como: "assumida",
    });
    expect((await marca(conversa))?.encerrada_em).toBeTruthy();
    // O sistema (sem sessao) pondo a do profissional: transferida, sem quem.
    expect(await marca(conversaDoProfissional)).toMatchObject({
      encerrada_por: null,
      encerrada_como: "transferida",
    });
  });
});
