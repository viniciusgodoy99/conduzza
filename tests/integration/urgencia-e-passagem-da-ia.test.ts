import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Urgencia e passagem da IA ao responsavel do lead (AG6a, migration
// 20261029120000_urgencia_e_passagem_da_ia.sql, com a revisao de 28/10/2026
// e a revisao 2, do mesmo dia: os motivos clinicos e a mensagem nova)
// contra o banco REAL, pelo cliente de servico (o servidor, como o motor da
// IA chama) e, para fechar a marca, pela sessao de quem atende (Assumir,
// Transferir e Resolver com o update condicional das Server Actions do
// Atendimento). O que o ensaio nao prova, porque roda numa transacao so:
// cada chamada numa transacao propria, pelo PostgREST de verdade.
// - A REVISAO: a passagem (os 3 parametros de hoje) NUNCA atribui; a guarda
//   do envio (ia_pode_enviar_agora) deixa a frase de sempre sair logo depois
//   da passagem; a atribuicao e a RPC atribuir_conversa_passada_pela_ia, que
//   o motor chama DEPOIS da tentativa da frase; depois dela, a guarda barra;
// - a marca nasce (urgencia: a atribuicao recusa, motivo_nao_atribui), com o
//   evento de urgencia e o lead em Aguardando resposta; a segunda chamada do
//   job e ja_fora_da_ia;
// - a marca fecha: Assumir (assumida), Transferir (transferida), Resolver
//   (resolvida), com quem tirou;
// - a atribuicao (D-15, D-55): o responsavel ativo que atende conversa
//   (recepcao, administrador, gestor, profissional) recebe a conversa em
//   "Em atendimento", com o evento "A conversa ficou com {nome}, responsavel
//   pelo lead."; Somente leitura, inativo, de outra clinica
//   (responsavel_inapto) e sem responsavel (sem_responsavel): a fila; sem
//   perfil e nome vazio: o texto generico;
// - as decisoes que passam (escalou, falhou) atribuem; a resposta e o job
//   sem decisao (fora do horario) nao (sem_passagem); a regra e a da ULTIMA
//   versao publicada (regra_fila);
// - (revisao 2) os motivos clinicos e o conteudo que ninguem leu (sintoma,
//   assunto_clinico, midia_nao_suportada e conformidade, esta com bloqueou)
//   nunca atribuem (motivo_nao_atribui): e onde cai a emergencia que a lista
//   deterministica nao pega; e a mensagem do paciente que o job nao leu
//   (depois da passagem, durante o turno, ou sem o turno do job) barra a
//   atribuicao (mensagem_nova), mas a que o job leu
//   (ai_turno.mensagens_lidas, como o motor grava), a apagada e a de saida
//   nao;
// - a atribuicao nao rouba de quem assumiu antes (fora_da_fila) e a segunda
//   chamada nao muda nada;
// - o funil continua levando o lead para Aguardando resposta, e a
//   atribuicao nao o leva adiante;
// - a frase de sempre igual a de hoje.
//
// ESCRITO NA AG6a E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a migration, com npm run
// test:integration -- urgencia-e-passagem-da-ia.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no
// afterAll (as conversas, as marcas, as decisoes e os eventos vao em
// cascata), e os usuarios desta execucao. Nas clinicas I, C e Outra a IA nao
// e liberada: as conversas "na IA" sao linhas gravadas direto pelo servidor.
// Na clinica G a IA e liberada SO para um telefone ficticio, no numero falso
// (fora da lista fechada: o motor de producao nunca reivindica job de
// clinica de teste, e numero 'fake' nao manda nada): a conversa entra pela
// ingestao de verdade, com a janela, para a guarda do envio poder dizer ok.
// Licao de 30/10/2026 (commit 3f87861 do main): o contato da G nasce
// paciente e o telefone e liberado FORCADO antes de a conversa existir (o
// forcado so vale gravado depois do sinal de paciente); assim a manutencao
// do motor (a cada minuto, so na conversa de teste COM janela) nunca acha
// ia_pode_falar_com falso e nao tira a conversa da IA no meio do caso. As
// conversas das clinicas I e C sao linhas gravadas direto, sem janela: a
// manutencao nao as toca, e nenhum definir_* dessas clinicas roda depois
// de elas existirem.
// A passagem e a atribuicao sao as de verdade, com um job em execucao deste
// teste (nenhum executor roda aqui); o turno do job (ai_turno, com as
// mensagens que ele leu) e gravado pelo teste, como o motor grava antes de
// toda passagem com frase. O interruptor global NUNCA e tocado.
// Nada usa a id da salud-care, da teste123 nem da Conduzza Teste. Telefones
// ficticios.
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
const TELEFONE_G = `+5584985${digitos}`;
const clinicas: string[] = [];
const usuarios = new Map<string, string>();
const sessoes = new Map<string, SupabaseClient>();

// O motivo dos casos que atribuem (pela revisao 2, sintoma nunca atribui).
const EVENTO_DO_PEDIDO = "A IA passou a conversa para a equipe: o paciente pediu para falar com uma pessoa.";
const EVENTO_DO_SINTOMA = "A IA passou a conversa para a equipe: o paciente descreveu um sintoma.";
const EVENTO_DO_ASSUNTO_CLINICO = "A IA passou a conversa para a equipe: o assunto é clínico.";
const EVENTO_DA_MIDIA =
  "A IA passou a conversa para a equipe: o paciente mandou um conteúdo que o assistente não lê.";
const EVENTO_DA_URGENCIA =
  "A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.";
const EVENTO_DO_HORARIO =
  "A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.";
const EVENTO_DA_CONFORMIDADE = "A IA passou a conversa para a equipe: a resposta não passou na conformidade.";
const EVENTO_DA_FALHA = "A IA passou a conversa para a equipe: o assistente teve uma falha técnica.";
const GENERICO = "A conversa ficou com o responsável pelo lead.";
const FRASE_DE_SEMPRE =
  "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.";

type Passagem = {
  passou: boolean;
  codigo: string;
  urgente: boolean;
};

type Atribuicao = {
  atribuida: boolean;
  codigo: string;
};

type Desfecho = "escalou" | "bloqueou" | "falhou" | "respondeu";

type Ingestao = {
  inserted: boolean;
  conversation_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  ia_atendendo?: boolean;
};

let clinicaI = "";
let numeroI = "";
let clinicaC = "";
let numeroC = "";
let clinicaG = "";
let numeroG = "";
/** O contato da G (paciente, com o telefone forcado), antes da conversa. */
let contatoG = "";
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

/**
 * A decisao do job, como o motor grava ANTES da passagem: escalou (o
 * motivo), bloqueou (conformidade, com a regra e a camada), falhou (o
 * motivo da falha) ou respondeu (aprovada, com o hash).
 */
async function decidir(
  clinica: string,
  conversa: string,
  job: string,
  desfecho: Desfecho,
  motivo: string | null,
): Promise<void> {
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: job,
      desfecho,
      escalation_reason: motivo,
      aprovado: desfecho === "respondeu",
      texto_sha256: desfecho === "respondeu" ? "a".repeat(64) : null,
      compliance_blocked: desfecho === "bloqueou",
      compliance_rule: desfecho === "bloqueou" ? "triagem" : null,
      camada: desfecho === "bloqueou" ? "regra" : null,
      motivo_da_falha: desfecho === "falhou" ? "prazo" : null,
    })
    .throwOnError();
}

/** A passagem pelo servidor, com os 3 parametros de hoje. */
async function passarDoJob(job: string, motivo: string): Promise<Passagem> {
  return rpcOk<Passagem>("passar_conversa_da_ia_para_equipe", {
    p_job_id: job,
    p_worker: WORKER,
    p_motivo: motivo,
  });
}

/** A atribuicao pelo servidor (o motor chama depois da tentativa da frase). */
async function atribuirDoJob(job: string): Promise<Atribuicao> {
  return rpcOk<Atribuicao>("atribuir_conversa_passada_pela_ia", { p_job_id: job, p_worker: WORKER });
}

/**
 * Uma mensagem da conversa, gravada direto pelo servidor (texto sintetico):
 * do paciente (entrada) por padrao; de saida, a resposta de quem atende;
 * apagada quando pedido. O numero vem da conversa (gatilho).
 */
async function mensagem(
  clinica: string,
  conversa: string,
  opcoes: { saida?: boolean; apagada?: boolean; autor?: string } = {},
): Promise<string> {
  const agora = new Date().toISOString();
  return inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: opcoes.saida ? "saida" : "entrada",
    author: opcoes.saida ? "usuario" : "paciente",
    author_user_id: opcoes.saida ? (opcoes.autor ?? null) : null,
    content_type: "texto",
    body: "Mensagem sintética",
    billable: false,
    cost_cents: 0,
    deleted_at: opcoes.apagada ? agora : null,
  });
}

/**
 * O turno do job (ai_turno) com as mensagens que ele leu, como o motor grava
 * antes de toda passagem com frase (decidido, saida frase).
 */
async function turnoLeu(clinica: string, conversa: string, job: string, lidas: string[]): Promise<void> {
  await admin
    .from("ai_turno")
    .upsert(
      {
        job_id: job,
        clinic_id: clinica,
        conversation_id: conversa,
        estado: "decidido",
        saida: "frase",
        mensagens_lidas: lidas,
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
}

async function concluir(job: string): Promise<void> {
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
}

/** A passagem do job (com a decisao dele, como o motor) e o job concluido. */
async function passar(
  conversa: string,
  motivo: string,
  clinica = clinicaI,
  numero = numeroI,
): Promise<Passagem> {
  const job = await jobEmExecucao(clinica, numero, conversa);
  await decidir(clinica, conversa, job, "escalou", motivo);
  const r = await passarDoJob(job, motivo);
  await concluir(job);
  return r;
}

/**
 * O caminho do motor: a decisao do job (sem ela, com desfecho nulo), a
 * passagem e, depois da tentativa da frase, a atribuicao; o job conclui no
 * fim.
 */
async function passarEAtribuir(
  conversa: string,
  motivo: string,
  opcoes: { desfecho?: Desfecho | null; clinica?: string; numero?: string } = {},
): Promise<{ passagem: Passagem; atribuicao: Atribuicao }> {
  const clinica = opcoes.clinica ?? clinicaI;
  const numero = opcoes.numero ?? numeroI;
  const job = await jobEmExecucao(clinica, numero, conversa);
  if (opcoes.desfecho !== null) {
    // A resposta aprovada nao tem motivo de passagem (o motor grava nulo).
    const desfecho = opcoes.desfecho ?? "escalou";
    await decidir(clinica, conversa, job, desfecho, desfecho === "respondeu" ? null : motivo);
  }
  const passagem = await passarDoJob(job, motivo);
  const atribuicao = await atribuirDoJob(job);
  await concluir(job);
  return { passagem, atribuicao };
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
  clinicaG = await novaClinica("G");
  numeroG = (await criarNumeroDeTeste(admin, clinicaG, { nome: "Recepção" })).id;
  clinicaOutra = await novaClinica("Outra");
  await publicar(clinicaI, 1, { passagem_para: "responsavel_do_lead" });
  // Na C, a ultima publicada e a fila (a anterior era "responsavel do lead").
  await publicar(clinicaC, 1, { passagem_para: "responsavel_do_lead" });
  await publicar(clinicaC, 2, { passagem_para: "fila" });
  // Na G, a IA liberada so para TELEFONE_G, no numero falso (a guarda do
  // envio precisa da liberacao para dizer ok).
  await publicar(clinicaG, 1, { passagem_para: "responsavel_do_lead" });
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaG,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da AG6a",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaG,
    p_whatsapp_account_id: numeroG,
    p_ativo: true,
  });
  // O contato nasce paciente e o telefone, forcado, ANTES de a conversa
  // existir (o forcado so vale gravado depois do sinal de paciente; licao
  // de 30/10/2026, no cabecalho).
  contatoG = await inserir("contact", {
    clinic_id: clinicaG,
    phone_e164: TELEFONE_G,
    name: "Contato sintético",
    kind: "paciente",
  });
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaG,
    p_telefone_e164: TELEFONE_G,
    p_rotulo: "Contato sintético",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
  });

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
  await criarPessoa("dona-g", clinicaG, "recepcao");
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

describe("a frase sai antes da atribuicao (a revisao)", () => {
  it("a guarda deixa a frase sair logo depois da passagem e so a barra depois da atribuicao", async () => {
    // A conversa entra pela ingestao de verdade (na IA, com a janela).
    const r = await rpcOk<Ingestao>("ingest_inbound_message", {
      p_clinic_id: clinicaG,
      p_phone_e164: TELEFONE_G,
      p_name: "Contato sintético",
      p_wa_message_id: `urgencia-int:${sufixo}:g1`,
      p_content_type: "texto",
      p_body: "Mensagem sintética",
      p_whatsapp_account_id: numeroG,
    });
    // O contato que nasceu antes (paciente, telefone forcado) e o da conversa.
    expect(r).toMatchObject({ inserted: true, ia_atendendo: true, contact_id: contatoG });
    const conversa = r.conversation_id!;
    await admin
      .from("contact")
      .update({ owner_user_id: pessoa("dona-g") })
      .eq("id", contatoG)
      .throwOnError();
    const job = await jobEmExecucao(clinicaG, numeroG, conversa);
    // O turno leu a mensagem que a ingestao gravou (o motor grava antes da
    // passagem): ela nao e "nova" para a atribuicao.
    await turnoLeu(clinicaG, conversa, job, [r.message_id!]);
    await decidir(clinicaG, conversa, job, "escalou", "pedido_humano");
    const guarda = () =>
      rpcOk<string>("ia_pode_enviar_agora", {
        p_job_id: job,
        p_worker: WORKER,
        p_conversation_id: conversa,
        p_whatsapp_account_id: numeroG,
        p_telefone: TELEFONE_G,
        p_tipo: "frase",
      });

    expect(await passarDoJob(job, "pedido_humano")).toEqual({ passou: true, codigo: "passou", urgente: false });
    // A passagem nunca atribui: a conversa na fila, sem responsavel, e a
    // frase de sempre pode sair.
    expect(await estado(conversa)).toEqual({
      status: "aguardando_humano",
      assignee_user_id: null,
      awaiting_reply: true,
    });
    expect(await guarda()).toBe("ok");
    // Depois da tentativa da frase, a atribuicao; e so entao a guarda barra.
    expect(await atribuirDoJob(job)).toEqual({ atribuida: true, codigo: "atribuida" });
    expect(await guarda()).toBe("fora_da_ia");
    expect(await estado(conversa)).toEqual({
      status: "em_atendimento",
      assignee_user_id: pessoa("dona-g"),
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual(
      [EVENTO_DO_PEDIDO, "A conversa ficou com Pessoa dona-g, responsável pelo lead."].sort(),
    );
    await concluir(job);
  });
});

describe("a urgencia: a marca nasce e nunca atribui", () => {
  it("com a regra e o responsavel apto: a fila, a marca aberta, o evento, o lead em Aguardando resposta, e a atribuicao recusa", async () => {
    const { contato, conversa } = await naIa(pessoa("dona"));
    const antes = Date.now();
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    await decidir(clinicaI, conversa, job, "escalou", "urgencia");
    expect(await passarDoJob(job, "urgencia")).toEqual({ passou: true, codigo: "passou", urgente: true });
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "motivo_nao_atribui" });
    await concluir(job);
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

  it("a segunda chamada do job e ja_fora_da_ia, sem segundo evento", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    expect(await passarDoJob(job, "urgencia")).toEqual({ passou: true, codigo: "passou", urgente: true });
    expect(await passarDoJob(job, "urgencia")).toEqual({ passou: false, codigo: "ja_fora_da_ia", urgente: false });
    expect(await eventos(conversa)).toEqual([EVENTO_DA_URGENCIA]);
    expect((await estado(conversa)).assignee_user_id).toBeNull();
    await concluir(job);
  });
});

describe("a marca fecha quando alguem pega a conversa", () => {
  it("Assumir: assumida, por quem assumiu", async () => {
    const { conversa } = await naIa(null);
    await passar(conversa, "urgencia");
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
    await passar(conversa, "urgencia");
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
    await passar(conversa, "urgencia");
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

describe("a atribuicao ao responsavel do lead, depois da frase (D-15, D-55)", () => {
  it.each([
    ["dona", "recepção"],
    ["dona-admin", "administrador"],
    ["dona-gestor", "gestor"],
    ["dona-prof", "profissional"],
  ])("o responsavel ativo (%s, %s) recebe a conversa, com o evento e o lead em Aguardando resposta", async (apelido) => {
    const { contato, conversa } = await naIa(pessoa(apelido));
    expect(await passarEAtribuir(conversa, "pedido_humano")).toEqual({
      passagem: { passou: true, codigo: "passou", urgente: false },
      atribuicao: { atribuida: true, codigo: "atribuida" },
    });
    expect(await estado(conversa)).toEqual({
      status: "em_atendimento",
      assignee_user_id: pessoa(apelido),
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual(
      [EVENTO_DO_PEDIDO, `A conversa ficou com Pessoa ${apelido}, responsável pelo lead.`].sort(),
    );
    expect(await etapa(contato)).toBe("aguardando_resposta");
    expect(await marca(conversa)).toBeNull();
  });

  it.each([
    ["dona-leitura", "responsavel_inapto"],
    ["dona-inativa", "responsavel_inapto"],
    ["dona-de-outra", "responsavel_inapto"],
    [null, "sem_responsavel"],
  ])("Somente leitura, inativo, de outra clinica ou sem responsavel (%s): a fila (%s)", async (apelido, codigo) => {
    const { contato, conversa } = await naIa(apelido === null ? null : pessoa(apelido));
    expect(await passarEAtribuir(conversa, "pedido_humano")).toEqual({
      passagem: { passou: true, codigo: "passou", urgente: false },
      atribuicao: { atribuida: false, codigo },
    });
    expect(await estado(conversa)).toEqual({
      status: "aguardando_humano",
      assignee_user_id: null,
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DO_PEDIDO]);
    expect(await etapa(contato)).toBe("aguardando_resposta");
  });

  it.each([["sem-perfil"], ["nome-vazio"]])("sem nome (%s): atribui com o texto generico", async (apelido) => {
    const { conversa } = await naIa(pessoa(apelido));
    expect((await passarEAtribuir(conversa, "pedido_humano")).atribuicao.atribuida).toBe(true);
    expect(await eventos(conversa)).toEqual([EVENTO_DO_PEDIDO, GENERICO].sort());
  });

  it("a falha tecnica (falhou), saida com a frase, atribui", async () => {
    const falha = await naIa(pessoa("dona"));
    expect((await passarEAtribuir(falha.conversa, "falha_tecnica", { desfecho: "falhou" })).atribuicao).toEqual({
      atribuida: true,
      codigo: "atribuida",
    });
    expect(await eventos(falha.conversa)).toEqual(
      [EVENTO_DA_FALHA, "A conversa ficou com Pessoa dona, responsável pelo lead."].sort(),
    );
  });

  // Revisao 2 (28/10/2026): onde cai a emergencia que a lista deterministica
  // nao pega ("acho que to tendo um infarto", um audio, "parada cardiaca"):
  // a mesma razao da urgencia (D-54), a responsavel pode estar fora.
  it.each([
    ["sintoma", "escalou", EVENTO_DO_SINTOMA],
    ["assunto_clinico", "escalou", EVENTO_DO_ASSUNTO_CLINICO],
    ["midia_nao_suportada", "escalou", EVENTO_DA_MIDIA],
    ["conformidade", "bloqueou", EVENTO_DA_CONFORMIDADE],
  ] as const)(
    "os motivos clinicos e o conteudo que ninguem leu nunca atribuem (%s, %s): a fila",
    async (motivo, desfecho, evento) => {
      const { contato, conversa } = await naIa(pessoa("dona"));
      expect(await passarEAtribuir(conversa, motivo, { desfecho })).toEqual({
        passagem: { passou: true, codigo: "passou", urgente: false },
        atribuicao: { atribuida: false, codigo: "motivo_nao_atribui" },
      });
      expect(await estado(conversa)).toEqual({
        status: "aguardando_humano",
        assignee_user_id: null,
        awaiting_reply: true,
      });
      expect(await eventos(conversa)).toEqual([evento]);
      expect(await etapa(contato)).toBe("aguardando_resposta");
    },
  );

  it("nao atribuem: a urgencia, o fora do horario (sem decisao) e a decisao que respondeu", async () => {
    const urgente = await naIa(pessoa("dona"));
    expect(await passarEAtribuir(urgente.conversa, "urgencia")).toEqual({
      passagem: { passou: true, codigo: "passou", urgente: true },
      atribuicao: { atribuida: false, codigo: "motivo_nao_atribui" },
    });
    const horario = await naIa(pessoa("dona"));
    expect(await passarEAtribuir(horario.conversa, "fora_do_horario", { desfecho: null })).toEqual({
      passagem: { passou: true, codigo: "passou", urgente: false },
      atribuicao: { atribuida: false, codigo: "sem_passagem" },
    });
    expect(await eventos(horario.conversa)).toEqual([EVENTO_DO_HORARIO]);
    const respondeu = await naIa(pessoa("dona"));
    expect(
      (await passarEAtribuir(respondeu.conversa, "falha_tecnica", { desfecho: "respondeu" })).atribuicao,
    ).toEqual({ atribuida: false, codigo: "sem_passagem" });
    for (const c of [urgente, horario, respondeu]) {
      expect(await estado(c.conversa)).toEqual({
        status: "aguardando_humano",
        assignee_user_id: null,
        awaiting_reply: true,
      });
    }
  });

  it("a regra e a da ULTIMA versao publicada (na C, fila)", async () => {
    const { conversa } = await naIa(pessoa("dona-c"), clinicaC, numeroC);
    expect(
      (await passarEAtribuir(conversa, "pedido_humano", { clinica: clinicaC, numero: numeroC })).atribuicao,
    ).toEqual({ atribuida: false, codigo: "regra_fila" });
    expect((await estado(conversa)).status).toBe("aguardando_humano");
  });

  it("nao rouba: quem assumiu entre a passagem e a atribuicao fica com a conversa", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    expect((await passarDoJob(job, "pedido_humano")).passou).toBe(true);
    const { data } = await sessao("recepcao")
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") })
      .eq("id", conversa)
      .eq("status", "aguardando_humano")
      .is("assignee_user_id", null)
      .select("id")
      .throwOnError();
    expect(data).toHaveLength(1);
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "fora_da_fila" });
    await concluir(job);
    expect(await estado(conversa)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: pessoa("recepcao"),
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DO_PEDIDO]);
  });

  it("idempotente: a segunda chamada nao muda nada; depois de concluir o job, sem_posse", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    await passarDoJob(job, "pedido_humano");
    expect(await atribuirDoJob(job)).toEqual({ atribuida: true, codigo: "atribuida" });
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "fora_da_fila" });
    await concluir(job);
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "sem_posse" });
    expect(await eventos(conversa)).toEqual(
      [EVENTO_DO_PEDIDO, "A conversa ficou com Pessoa dona, responsável pelo lead."].sort(),
    );
    expect((await estado(conversa)).assignee_user_id).toBe(pessoa("dona"));
  });
});

// Revisao 2 (28/10/2026): a mensagem do paciente que o job NAO leu (entrada,
// nao apagada, desde a criacao do job, fora de ai_turno.mensagens_lidas do
// job) barra a atribuicao: alguem de plantao precisa ver na fila. Cada
// chamada numa transacao propria, como o motor: a mensagem que disparou o
// job antes dele, o job, o turno com as lidas, a decisao, a passagem e,
// depois, a atribuicao.
describe("a mensagem nova do paciente (revisao 2)", () => {
  /** A conversa na IA, a mensagem que disparou o job, o job e o turno que a leu. */
  async function comTurno(): Promise<{ contato: string; conversa: string; job: string; lida: string }> {
    const { contato, conversa } = await naIa(pessoa("dona"));
    const lida = await mensagem(clinicaI, conversa);
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    await turnoLeu(clinicaI, conversa, job, [lida]);
    return { contato, conversa, job, lida };
  }

  it("o paciente escreveu depois da passagem: mensagem_nova, a conversa na fila, sem o evento da atribuicao", async () => {
    const { conversa, job } = await comTurno();
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    expect(await passarDoJob(job, "pedido_humano")).toEqual({ passou: true, codigo: "passou", urgente: false });
    await mensagem(clinicaI, conversa);
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "mensagem_nova" });
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "mensagem_nova" });
    await concluir(job);
    expect(await estado(conversa)).toEqual({
      status: "aguardando_humano",
      assignee_user_id: null,
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DO_PEDIDO]);
  });

  it("a mensagem que chegou durante o turno (depois da leitura, antes da decisao) barra: o modelo nao a viu", async () => {
    const { conversa, job } = await comTurno();
    // O turno ja leu (as lidas gravadas); a pessoa escreve enquanto o modelo
    // pensa; so depois a decisao e a passagem.
    await mensagem(clinicaI, conversa);
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    await passarDoJob(job, "pedido_humano");
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "mensagem_nova" });
    await concluir(job);
    expect(await estado(conversa)).toEqual({
      status: "aguardando_humano",
      assignee_user_id: null,
      awaiting_reply: true,
    });
    expect(await eventos(conversa)).toEqual([EVENTO_DO_PEDIDO]);
  });

  it("a mensagem que chegou na espera do job e que ele leu nao barra: atribui", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const primeira = await mensagem(clinicaI, conversa);
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    // Chegou depois da criacao do job e foi junto no mesmo turno.
    const segunda = await mensagem(clinicaI, conversa);
    await turnoLeu(clinicaI, conversa, job, [primeira, segunda]);
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    await passarDoJob(job, "pedido_humano");
    expect(await atribuirDoJob(job)).toEqual({ atribuida: true, codigo: "atribuida" });
    await concluir(job);
    expect((await estado(conversa)).assignee_user_id).toBe(pessoa("dona"));
  });

  it("sem o turno do job, nada foi lido: a mensagem depois da criacao do job barra", async () => {
    const { conversa } = await naIa(pessoa("dona"));
    const job = await jobEmExecucao(clinicaI, numeroI, conversa);
    await mensagem(clinicaI, conversa);
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    await passarDoJob(job, "pedido_humano");
    expect(await atribuirDoJob(job)).toEqual({ atribuida: false, codigo: "mensagem_nova" });
    await concluir(job);
    expect((await estado(conversa)).status).toBe("aguardando_humano");
  });

  it("a mensagem apagada e a resposta de quem atende nao barram: atribui", async () => {
    const { conversa, job } = await comTurno();
    await decidir(clinicaI, conversa, job, "escalou", "pedido_humano");
    await passarDoJob(job, "pedido_humano");
    await mensagem(clinicaI, conversa, { apagada: true });
    await mensagem(clinicaI, conversa, { saida: true, autor: pessoa("recepcao") });
    expect(await atribuirDoJob(job)).toEqual({ atribuida: true, codigo: "atribuida" });
    await concluir(job);
    expect(await estado(conversa)).toEqual({
      status: "em_atendimento",
      assignee_user_id: pessoa("dona"),
      awaiting_reply: true,
    });
  });
});

describe("o que nao muda", () => {
  it("a frase de sempre e a de hoje", async () => {
    expect(await rpcOk<string>("frase_de_escalonamento_da_ia")).toBe(FRASE_DE_SEMPRE);
  });
});
