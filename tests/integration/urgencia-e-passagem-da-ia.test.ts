import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Urgencia e passagem da IA ao responsavel do lead (AG6a, migration
// 20261029120000_urgencia_e_passagem_da_ia.sql) contra o banco REAL, pelo
// cliente de servico (o servidor, como o motor da IA chama) e, para fechar a
// marca, pela sessao de quem atende (Assumir, Transferir e Resolver com o
// update condicional das Server Actions do Atendimento). O que o ensaio nao
// prova, porque roda numa transacao so: cada chamada numa transacao propria,
// pelo PostgREST de verdade.
// - a marca nasce (urgencia com p_atribuir: nunca atribui), com o evento de
//   urgencia e o lead em Aguardando resposta; a segunda chamada do job e
//   ja_fora_da_ia;
// - a marca fecha: Assumir (assumida), Transferir (transferida), Resolver
//   (resolvida), com quem tirou;
// - a atribuicao (D-15, D-55): o responsavel ativo que atende conversa
//   (recepcao, administrador, gestor, profissional) recebe a conversa em
//   "Em atendimento", com o evento "A conversa ficou com {nome}, responsavel
//   pelo lead."; Somente leitura, inativo, de outra clinica e sem
//   responsavel: a fila; sem perfil e nome vazio: o texto generico;
// - a urgencia nunca atribui; fora_do_horario nao atribui; a chamada de 3
//   parametros (o codigo publicado) nunca atribui; a regra e a da ULTIMA
//   versao publicada;
// - o funil continua levando o lead para Aguardando resposta, e a
//   atribuicao nao o leva adiante;
// - a frase de sempre igual a de hoje.
//
// ESCRITO NA AG6a E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a migration, com npm run
// test:integration -- urgencia-e-passagem-da-ia.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (sem a IA liberada:
// nenhuma conversa e atendida e nenhuma mensagem sai; numero fake), apagadas
// no afterAll (as conversas, as marcas e os eventos vao em cascata), e os
// usuarios desta execucao. As conversas "na IA" sao linhas gravadas direto
// pelo servidor; a passagem e a de verdade, com um job em execucao deste
// teste. O interruptor global NUNCA e tocado. Nada usa a id da salud-care, da
// teste123 nem da Conduzza Teste. Telefones ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic where slug like 'urgencia-int-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'urgencia-int-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `UrgenciaInt!${sufixo}`;
const WORKER = `urgencia-int-${sufixo}`;
const clinicas: string[] = [];
const usuarios = new Map<string, string>();
const sessoes = new Map<string, SupabaseClient>();

const EVENTO_DO_SINTOMA = "A IA passou a conversa para a equipe: o paciente descreveu um sintoma.";
const EVENTO_DA_URGENCIA =
  "A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.";
const EVENTO_DO_HORARIO =
  "A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.";
const GENERICO = "A conversa ficou com o responsável pelo lead.";
const FRASE_DE_SEMPRE =
  "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.";

type Passagem = {
  passou: boolean;
  codigo: string;
  urgente: boolean;
  atribuida: boolean;
};

let clinicaI = "";
let numeroI = "";
let clinicaC = "";
let numeroC = "";
let clinicaOutra = "";
let telefones = 0;

const pessoa = (apelido: string) => usuarios.get(apelido)!;
const sessao = (apelido: string) => sessoes.get(apelido)!;

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

async function novaClinica(nome: string): Promise<string> {
  const id = await inserir("clinic", {
    name: `Urgência integração ${nome} ${sufixo}`,
    slug: `urgencia-int-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  clinicas.push(id);
  return id;
}

/** A versao publicada do agente, com as regras dadas (a de numero maior vale). */
async function publicar(clinica: string, versao: number, regras: Record<string, unknown>): Promise<void> {
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: versao,
    status: "publicada",
    published_at: new Date().toISOString(),
    escalation_rules: regras,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
}

/**
 * Uma pessoa (o gatilho do Auth cria o perfil com o nome) com o vinculo
 * dado; com sessao, faz login (JWT real).
 */
async function criarPessoa(
  apelido: string,
  clinica: string,
  papel: string,
  opcoes: { status?: string; sessao?: boolean; profissional?: string } = {},
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `urgencia-int-${apelido}-${sufixo}@teste.dev`,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Pessoa ${apelido}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinica,
      user_id: data.user.id,
      role: papel,
      status: opcoes.status ?? "ativo",
      professional_id: opcoes.profissional ?? null,
    })
    .throwOnError();
  if (opcoes.sessao) {
    const cliente = anonClient();
    const { error: erroLogin } = await cliente.auth.signInWithPassword({
      email: `urgencia-int-${apelido}-${sufixo}@teste.dev`,
      password: SENHA,
    });
    if (erroLogin) {
      throw new Error(`login ${apelido}: ${erroLogin.message}`);
    }
    sessoes.set(apelido, cliente);
  }
  return data.user.id;
}

/** Contato (lead em Novo) com o responsavel dado e a conversa dele "na IA". */
async function naIa(
  dono: string | null,
  clinica = clinicaI,
  numero = numeroI,
): Promise<{ contato: string; conversa: string }> {
  telefones += 1;
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55848${digitos}${String(telefones).padStart(2, "0")}`,
    name: "Contato sintético",
    kind: "lead",
    funnel_stage: "novo",
    owner_user_id: dono,
  });
  const conversa = await inserir("conversation", {
    clinic_id: clinica,
    contact_id: contato,
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
  return { contato, conversa };
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

/** A passagem pelo servidor; sem p_atribuir (undefined), a chamada de 3 parametros. */
async function passar(
  conversa: string,
  motivo: string,
  atribuir: boolean | undefined,
  clinica = clinicaI,
  numero = numeroI,
): Promise<Passagem> {
  const job = await jobEmExecucao(clinica, numero, conversa);
  const args: Record<string, unknown> = { p_job_id: job, p_worker: WORKER, p_motivo: motivo };
  if (atribuir !== undefined) {
    args.p_atribuir = atribuir;
  }
  const r = await rpcOk<Passagem>("passar_conversa_da_ia_para_equipe", args);
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  return r;
}

async function estado(conversa: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, assignee_user_id, awaiting_reply")
    .eq("id", conversa)
    .single()
    .throwOnError();
  return data as { status: string; assignee_user_id: string | null; awaiting_reply: boolean };
}

async function eventos(conversa: string): Promise<string[]> {
  const { data } = await admin
    .from("message")
    .select("body")
    .eq("conversation_id", conversa)
    .eq("author", "sistema")
    .eq("content_type", "evento")
    .throwOnError();
  return (data as { body: string }[]).map((m) => m.body).sort();
}

async function etapa(contato: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage")
    .eq("id", contato)
    .single()
    .throwOnError();
  return (data as { funnel_stage: string }).funnel_stage;
}

async function marca(conversa: string) {
  const { data } = await admin
    .from("conversa_urgente")
    .select("clinic_id, desde, encerrada_em, encerrada_por, encerrada_como")
    .eq("conversation_id", conversa)
    .maybeSingle()
    .throwOnError();
  return data as {
    clinic_id: string;
    desde: string;
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
    .like("slug", "urgencia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaI = await novaClinica("I");
  numeroI = (await criarNumeroDeTeste(admin, clinicaI, { nome: "Recepção" })).id;
  clinicaC = await novaClinica("C");
  numeroC = (await criarNumeroDeTeste(admin, clinicaC, { nome: "Recepção" })).id;
  clinicaOutra = await novaClinica("Outra");
  await publicar(clinicaI, 1, { passagem_para: "responsavel_do_lead" });
  // Na C, a ultima publicada e a fila (a anterior era "responsavel do lead").
  await publicar(clinicaC, 1, { passagem_para: "responsavel_do_lead" });
  await publicar(clinicaC, 2, { passagem_para: "fila" });

  const profissional = await inserir("professional", { clinic_id: clinicaI, name: "Dra. Responsável" });
  await criarPessoa("recepcao", clinicaI, "recepcao", { sessao: true });
  await criarPessoa("gestor", clinicaI, "gestor", { sessao: true });
  await criarPessoa("dona", clinicaI, "recepcao");
  await criarPessoa("dona-admin", clinicaI, "admin");
  await criarPessoa("dona-gestor", clinicaI, "gestor");
  await criarPessoa("dona-prof", clinicaI, "profissional", { profissional });
  await criarPessoa("dona-leitura", clinicaI, "leitura");
  await criarPessoa("dona-inativa", clinicaI, "recepcao", { status: "inativo" });
  await criarPessoa("dona-de-outra", clinicaOutra, "recepcao");
  await criarPessoa("sem-perfil", clinicaI, "recepcao");
  await criarPessoa("nome-vazio", clinicaI, "recepcao");
  await criarPessoa("dona-c", clinicaC, "recepcao");
  await admin.from("profile").delete().eq("user_id", pessoa("sem-perfil")).throwOnError();
  await admin.from("profile").update({ name: "   " }).eq("user_id", pessoa("nome-vazio")).throwOnError();
}, 180_000);

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
  for (const id of usuarios.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("a urgencia: a marca nasce e nunca atribui", () => {
  it("com p_atribuir e o responsavel apto: a fila, a marca aberta, o evento e o lead em Aguardando resposta", async () => {
    const { contato, conversa } = await naIa(pessoa("dona"));
    const antes = Date.now();
    expect(await passar(conversa, "urgencia", true)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: true,
      atribuida: false,
    });
    expect(await estado(conversa)).toEqual({
      status: "aguardando_humano",
      assignee_user_id: null,
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DA_URGENCIA]);
    expect(await etapa(contato)).toBe("aguardando_resposta");
    const m = await marca(conversa);
    expect(m).toMatchObject({
      clinic_id: clinicaI,
      encerrada_em: null,
      encerrada_por: null,
      encerrada_como: null,
    });
    expect(Date.parse(m!.desde)).toBeGreaterThanOrEqual(antes - 60_000);
  });

  it("a chamada de 3 parametros tambem marca, e a segunda chamada do job e ja_fora_da_ia", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    const args = { p_job_id: job, p_worker: WORKER, p_motivo: "urgencia" };
    expect(await rpcOk("passar_conversa_da_ia_para_equipe", args)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: true,
      atribuida: false,
    });
    expect(await rpcOk("passar_conversa_da_ia_para_equipe", { ...args, p_atribuir: true })).toEqual({
      passou: false,
      codigo: "ja_fora_da_ia",
      urgente: false,
      atribuida: false,
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DA_URGENCIA]);
    expect((await estado(conversa)).assignee_user_id).toBeNull();
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  });
});

describe("a marca fecha quando alguem pega a conversa", () => {
  it("Assumir: assumida, por quem assumiu", async () => {
    const { conversa } = await naIa(null);
    await passar(conversa, "urgencia", true);
    const { data } = await sessao("recepcao")
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") })
      .eq("id", conversa)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id")
      .throwOnError();
    expect(data).toHaveLength(1);
    expect(await marca(conversa)).toMatchObject({
      encerrada_por: pessoa("recepcao"),
      encerrada_como: "assumida",
    });
  });

  it("Transferir: transferida, por quem passou", async () => {
    const { conversa } = await naIa(null);
    await passar(conversa, "urgencia", true);
    const { data } = await sessao("recepcao")
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: pessoa("gestor") })
      .eq("id", conversa)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id")
      .throwOnError();
    expect(data).toHaveLength(1);
    expect(await marca(conversa)).toMatchObject({
      encerrada_por: pessoa("recepcao"),
      encerrada_como: "transferida",
    });
  });

  it("Resolver: resolvida, por quem resolveu; a encerrada nao muda depois", async () => {
    const { conversa } = await naIa(null);
    await passar(conversa, "urgencia", true);
    const { data } = await sessao("gestor")
      .from("conversation")
      .update({ status: "resolvida", awaiting_reply: false })
      .eq("id", conversa)
      .neq("status", "resolvida")
      .select("id")
      .throwOnError();
    expect(data).toHaveLength(1);
    const fechada = await marca(conversa);
    expect(fechada).toMatchObject({ encerrada_por: pessoa("gestor"), encerrada_como: "resolvida" });
    // Reaberta e assumida depois: a marca encerrada fica como estava.
    await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", conversa)
      .throwOnError();
    await sessao("recepcao")
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") })
      .eq("id", conversa)
      .throwOnError();
    expect(await marca(conversa)).toEqual(fechada);
  });
});

describe("a atribuicao ao responsavel do lead (D-15, D-55)", () => {
  it.each([
    ["dona", "recepção"],
    ["dona-admin", "administrador"],
    ["dona-gestor", "gestor"],
    ["dona-prof", "profissional"],
  ])("o responsavel ativo (%s, %s) recebe a conversa, com o evento e o lead em Aguardando resposta", async (apelido) => {
    const { contato, conversa } = await naIa(pessoa(apelido));
    expect(await passar(conversa, "sintoma", true)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: false,
      atribuida: true,
    });
    expect(await estado(conversa)).toEqual({
      status: "em_atendimento",
      assignee_user_id: pessoa(apelido),
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual(
      [EVENTO_DO_SINTOMA, `A conversa ficou com Pessoa ${apelido}, responsável pelo lead.`].sort(),
    );
    expect(await etapa(contato)).toBe("aguardando_resposta");
    expect(await marca(conversa)).toBeNull();
  });

  it.each([["dona-leitura"], ["dona-inativa"], ["dona-de-outra"], [null]])(
    "Somente leitura, inativo, de outra clinica ou sem responsavel (%s): a fila",
    async (apelido) => {
      const { contato, conversa } = await naIa(apelido === null ? null : pessoa(apelido));
      expect(await passar(conversa, "sintoma", true)).toEqual({
        passou: true,
        codigo: "passou",
        urgente: false,
        atribuida: false,
      });
      expect(await estado(conversa)).toEqual({
        status: "aguardando_humano",
        assignee_user_id: null,
        awaiting_reply: true,
      });
      expect(await eventos(conversa)).toEqual([EVENTO_DO_SINTOMA]);
      expect(await etapa(contato)).toBe("aguardando_resposta");
    },
  );

  it.each([["sem-perfil"], ["nome-vazio"]])("sem nome (%s): atribui com o texto generico", async (apelido) => {
    const { conversa } = await naIa(pessoa(apelido));
    expect((await passar(conversa, "sintoma", true)).atribuida).toBe(true);
    expect(await eventos(conversa)).toEqual([EVENTO_DO_SINTOMA, GENERICO].sort());
  });

  it("a urgencia nunca atribui; fora_do_horario nao atribui; p_atribuir falso e a chamada de 3 parametros, tambem nao", async () => {
    const urgente = await naIa(pessoa("dona"));
    expect(await passar(urgente.conversa, "urgencia", true)).toMatchObject({ urgente: true, atribuida: false });
    const horario = await naIa(pessoa("dona"));
    expect(await passar(horario.conversa, "fora_do_horario", true)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: false,
      atribuida: false,
    });
    expect(await eventos(horario.conversa)).toEqual([EVENTO_DO_HORARIO]);
    const falso = await naIa(pessoa("dona"));
    expect((await passar(falso.conversa, "sintoma", false)).atribuida).toBe(false);
    const tres = await naIa(pessoa("dona"));
    expect(await passar(tres.conversa, "sintoma", undefined)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: false,
      atribuida: false,
    });
    for (const c of [urgente, horario, falso, tres]) {
      expect((await estado(c.conversa)).assignee_user_id).toBeNull();
    }
  });

  it("a regra e a da ULTIMA versao publicada (na C, fila)", async () => {
    const { conversa } = await naIa(pessoa("dona-c"), clinicaC, numeroC);
    expect((await passar(conversa, "sintoma", true, clinicaC, numeroC)).atribuida).toBe(false);
    expect((await estado(conversa)).status).toBe("aguardando_humano");
  });
});

describe("o que nao muda", () => {
  it("a frase de sempre e a de hoje", async () => {
    expect(await rpcOk<string>("frase_de_escalonamento_da_ia")).toBe(FRASE_DE_SEMPRE);
  });
});
