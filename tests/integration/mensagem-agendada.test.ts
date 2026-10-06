import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, somarDias } from "@/lib/domain/horarios";
import {
  decidirJanelaDaAgendada,
  MOTIVOS_DA_AGENDADA,
} from "@/lib/domain/mensagem-agendada";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { KINDS_DE_ENVIO } from "@/lib/jobs/kinds";
import { executarMensagemAgendada } from "@/lib/jobs/mensagem-agendada";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { KINDS_DE_ENVIO_AUTOMATICO } from "@/lib/queries/mensagens-esperando";
import {
  criarNumeroDeTeste,
  type NumeroDeTeste,
  type OpcoesDoNumeroDeTeste,
} from "../rls/numeros";
import { adminClient, anonClient, stackCredentials } from "../rls/stack";

// As Server Actions usam createAdminClient (o "Enviar agora" envia pelo 1:1
// com o service role). Fora do Next essas variaveis nao vem carregadas.
const credenciaisDaPilha = stackCredentials();
process.env.NEXT_PUBLIC_SUPABASE_URL ??= credenciaisDaPilha.url;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= credenciaisDaPilha.serviceRoleKey;

// MENSAGEM AGENDADA (migration 20261006140000; desenho de 06/10/2026 com as
// decisoes A1 a A5 do dono), de ponta a ponta contra o banco, com o provedor
// fake e o executor de verdade (lib/jobs/mensagem-agendada.ts pelo
// executarJobComPosse do worker, que fecha a agendada pela
// reconciliar_mensagem_agendada).
//
// Clinicas e_de_teste: o motor de producao as ignora. Toda chamada de
// planejadora e reconciliacao passa p_clinic_id e p_incluir_teste = true, e
// o claim e manual (so este teste executa os jobs). Cada caso usa a sua
// clinica: estado do numero (conexao, slot) nao vaza de um caso para outro.
// O afterAll apaga as clinicas (cascata leva jobs, agendadas, mensagens e
// atividades): job pendente esquecido de clinica de teste acenderia
// fila_atrasada no monitor (runbook do motor).
//
// Nenhum texto de paciente e conferido em log: o que se confere e o banco e
// o provedor fake.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `Agendada!Int${sufixo}`;
const TZ = "America/Fortaleza";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const CORRIDA = "CZ409";

const clinicasCriadas: string[] = [];
const usuarios = new Map<string, string>();
const sessoes = new Map<string, SupabaseClient>();
const uid = (apelido: string) => usuarios.get(apelido)!;
const sessao = (apelido: string) => sessoes.get(apelido)!;

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  const base = sufixo.replace(/\D/g, "7").slice(0, 3).padEnd(3, "7");
  return `+5584973${base}${String(sequencia).padStart(3, "0")}`;
}

/**
 * Fuso Etc/GMT em que a hora local AGORA e `hora` (0 a 23). Serve para
 * provar a regra da madrugada (A2) sem depender da hora em que o teste roda.
 * Atencao ao sinal invertido do Etc: Etc/GMT-3 e UTC+3.
 */
function fusoComHoraLocal(hora: number): string {
  const horaUtc = new Date().getUTCHours();
  let deslocamento = (((hora - horaUtc) % 24) + 24) % 24;
  if (deslocamento > 11) {
    deslocamento -= 24;
  }
  if (deslocamento === 0) {
    return "Etc/GMT";
  }
  return deslocamento > 0
    ? `Etc/GMT-${deslocamento}`
    : `Etc/GMT+${-deslocamento}`;
}

async function criarUsuario(apelido: string): Promise<void> {
  const email = `agendada-int-${apelido}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.set(apelido, data.user.id);
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  sessoes.set(apelido, cliente);
}

type Clinica = { clinicId: string; numero: NumeroDeTeste; fuso: string };

/** Clinica de teste com um numero e a equipe (recepcao e colega escrevem). */
async function clinica(
  nome: string,
  opcoes: { fuso?: string; numero?: OpcoesDoNumeroDeTeste } = {},
): Promise<Clinica> {
  const fuso = opcoes.fuso ?? TZ;
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Agendada ${nome} ${sufixo}`,
      slug: `agendada-int-${nome}-${sufixo}`,
      e_de_teste: true,
      timezone: fuso,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  await admin
    .from("clinic_member")
    .insert([
      {
        clinic_id: clinicId,
        user_id: uid("recepcao"),
        role: "recepcao",
        status: "ativo",
      },
      {
        clinic_id: clinicId,
        user_id: uid("colega"),
        role: "recepcao",
        status: "ativo",
      },
      {
        clinic_id: clinicId,
        user_id: uid("gestora"),
        role: "gestor",
        status: "ativo",
      },
    ])
    .throwOnError();
  const numero = await criarNumeroDeTeste(admin, clinicId, opcoes.numero);
  return { clinicId, numero, fuso };
}

type Par = { contato: string; conversa: string; telefone: string };

/** Contato autorizado e a conversa dele em atendimento com o apelido. */
async function parComConversa(
  c: Clinica,
  responsavel = "recepcao",
  numeroId?: string,
): Promise<Par> {
  const fone = telefone();
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: c.clinicId,
      phone_e164: fone,
      name: "Paciente",
      kind: "lead",
    })
    .select("id")
    .single()
    .throwOnError();
  const contato = data!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: c.clinicId,
      contact_id: contato,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: c.clinicId,
      contact_id: contato,
      whatsapp_account_id: numeroId ?? c.numero.id,
      status: "em_atendimento",
      assignee_user_id: uid(responsavel),
    })
    .select("id")
    .single()
    .throwOnError();
  return { contato, conversa: conversa!.id as string, telefone: fone };
}

/** Agenda pela SESSAO (RLS e gatilho de verdade) e devolve o id. */
async function agendar(
  c: Clinica,
  par: Par,
  campos: {
    apelido?: string;
    texto?: string;
    enviarEm?: Date;
    numeroId?: string;
  } = {},
): Promise<string> {
  const { data, error } = await sessao(campos.apelido ?? "recepcao")
    .from("mensagem_agendada")
    .insert({
      clinic_id: c.clinicId,
      contact_id: par.contato,
      whatsapp_account_id: campos.numeroId ?? c.numero.id,
      conversation_id: par.conversa,
      texto: campos.texto ?? `Lembrete ${crypto.randomUUID().slice(0, 6)}`,
      enviar_em: (campos.enviarEm ?? new Date(Date.now() + HORA)).toISOString(),
      criada_por: uid(campos.apelido ?? "recepcao"),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`agendar: ${error?.code} ${error?.message}`);
  }
  return data.id as string;
}

/** Faz a agendada vencer (o sistema pode; a sessao nao poe hora passada). */
async function vencer(agendadaId: string, atrasoMs = MINUTO): Promise<void> {
  await admin
    .from("mensagem_agendada")
    .update({ enviar_em: new Date(Date.now() - atrasoMs).toISOString() })
    .eq("id", agendadaId)
    .throwOnError();
}

type ResumoDaPlanejadora = {
  planejadas: number;
  atrasadas: number;
  numero_removido: number;
  esperando_a_anterior: number;
  erros_por_linha: number;
};

async function planejar(clinicId: string): Promise<ResumoDaPlanejadora> {
  const { data, error } = await admin.rpc("planejar_mensagens_agendadas", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
    p_limite: 50,
  });
  if (error) {
    throw new Error(`planejar: ${error.code} ${error.message}`);
  }
  return data as ResumoDaPlanejadora;
}

type ResumoDaReconciliacao = {
  fechadas_enviadas: number;
  fechadas_sem_envio: number;
  retidas: number;
  presas: number;
  erros_por_linha: number;
};

async function reconciliar(clinicId: string): Promise<ResumoDaReconciliacao> {
  const { data, error } = await admin.rpc("reconciliar_mensagens_agendadas", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
    p_limite: 50,
  });
  if (error) {
    throw new Error(`reconciliar: ${error.code} ${error.message}`);
  }
  return data as ResumoDaReconciliacao;
}

type Agendada = {
  situacao: string;
  motivo: string | null;
  texto: string | null;
  conversation_id: string | null;
  job_id: string | null;
  message_id: string | null;
  atividade_id: string | null;
  enviada_em: string | null;
  encerrada_em: string | null;
  dispensada_em: string | null;
  dispensada_por: string | null;
  editada_por: string | null;
};

async function agendadaNoBanco(agendadaId: string): Promise<Agendada> {
  const { data } = await admin
    .from("mensagem_agendada")
    .select(
      "situacao, motivo, texto, conversation_id, job_id, message_id, atividade_id, enviada_em, encerrada_em, dispensada_em, dispensada_por, editada_por",
    )
    .eq("id", agendadaId)
    .single()
    .throwOnError();
  return data as Agendada;
}

async function jobDa(agendadaId: string): Promise<string> {
  const { job_id } = await agendadaNoBanco(agendadaId);
  expect(job_id).not.toBeNull();
  return job_id!;
}

type LinhaDoJob = {
  status: string;
  kind: string;
  payload: Record<string, unknown>;
  last_error: string | null;
  ultimo_motivo_devolucao: string | null;
  run_at: string;
  whatsapp_account_id: string | null;
};

async function linhaDoJob(jobId: string): Promise<LinhaDoJob> {
  const { data } = await admin
    .from("job_queue")
    .select(
      "status, kind, payload, last_error, ultimo_motivo_devolucao, run_at, whatsapp_account_id",
    )
    .eq("id", jobId)
    .single()
    .throwOnError();
  return data as LinhaDoJob;
}

const WORKER = `teste-agendada-${sufixo}`;

/** O claim que o motor faria, so para este job (a linha que ele devolve). */
async function reivindicar(jobId: string): Promise<Job> {
  const { data } = await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: WORKER,
      locked_at: new Date().toISOString(),
      attempts: 1,
    })
    .eq("id", jobId)
    .eq("status", "pendente")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, whatsapp_account_id, created_at",
    )
    .single()
    .throwOnError();
  return data as unknown as Job;
}

/** Reivindica e executa pelo worker (concluir/falhar/reagendar e fechar). */
async function executar(jobId: string) {
  return executarJobComPosse(admin, WORKER, await reivindicar(jobId));
}

/**
 * A message que o send.ts deixou para o job numa tentativa que falhou (o
 * job volta a 'pendente' quando o codigo esta em falhas_sem_envio()).
 */
async function falhaDoJob(
  c: Clinica,
  par: Par,
  jobId: string,
  codigo: string,
): Promise<string> {
  const { data } = await admin
    .from("message")
    .insert({
      clinic_id: c.clinicId,
      conversation_id: par.conversa,
      direction: "saida",
      author: "usuario",
      author_user_id: uid("recepcao"),
      content_type: "texto",
      body: "Tentativa que falhou",
      job_id: jobId,
      delivery_status: "falhou",
      error_code: codigo,
      billable: false,
      cost_cents: 0,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Um contato da clinica sem conversa nenhuma (destino de conversa trocada). */
async function contatoSemConversa(c: Clinica): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: c.clinicId, phone_e164: telefone(), kind: "lead" })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function trocarContatoDaConversa(
  conversa: string,
  contato: string,
): Promise<void> {
  await admin
    .from("conversation")
    .update({ contact_id: contato })
    .eq("id", conversa)
    .throwOnError();
}

async function liberarSlot(numeroId: string): Promise<void> {
  await admin
    .from("whatsapp_account")
    .update({ next_send_at: null, next_bulk_send_at: null })
    .eq("id", numeroId)
    .throwOnError();
}

async function mudarConexao(
  numeroId: string,
  status: "conectado" | "desconectado",
): Promise<void> {
  await admin
    .from("whatsapp_account")
    .update({ connection_status: status })
    .eq("id", numeroId)
    .throwOnError();
}

type Mensagem = {
  id: string;
  conversation_id: string;
  author: string;
  author_user_id: string | null;
  body: string | null;
  cost_cents: number;
  billable: boolean;
  delivery_status: string;
  job_id: string | null;
  whatsapp_account_id: string;
};

async function mensagensDoContato(contato: string): Promise<Mensagem[]> {
  const { data: conversas } = await admin
    .from("conversation")
    .select("id")
    .eq("contact_id", contato)
    .throwOnError();
  const ids = (conversas ?? []).map((c) => c.id as string);
  if (ids.length === 0) {
    return [];
  }
  const { data } = await admin
    .from("message")
    .select(
      "id, conversation_id, author, author_user_id, body, cost_cents, billable, delivery_status, job_id, whatsapp_account_id",
    )
    .in("conversation_id", ids)
    .eq("direction", "saida")
    .neq("content_type", "evento")
    .order("created_at")
    .throwOnError();
  return (data ?? []) as Mensagem[];
}

type Conversa = {
  id: string;
  status: string;
  assignee_user_id: string | null;
  awaiting_reply: boolean;
};

async function conversasAbertas(contato: string): Promise<Conversa[]> {
  const { data } = await admin
    .from("conversation")
    .select("id, status, assignee_user_id, awaiting_reply")
    .eq("contact_id", contato)
    .neq("status", "resolvida")
    .throwOnError();
  return (data ?? []) as Conversa[];
}

type Atividade = {
  id: string;
  titulo: string;
  detalhes: string | null;
  origem: string;
  automacao_id: string | null;
  created_by: string | null;
  assignee_user_id: string | null;
  status: string;
  due_on: string;
  due_at: string | null;
};

async function atividadesDo(contato: string): Promise<Atividade[]> {
  const { data } = await admin
    .from("contact_activity")
    .select(
      "id, titulo, detalhes, origem, automacao_id, created_by, assignee_user_id, status, due_on, due_at",
    )
    .eq("contact_id", contato)
    .order("created_at")
    .throwOnError();
  return (data ?? []) as Atividade[];
}

function enviadasNa(clinicId: string) {
  return fakeSentMessages().filter((m) => m.clinicId === clinicId);
}

async function resolverConversa(conversa: string): Promise<void> {
  await admin
    .from("conversation")
    .update({ status: "resolvida", awaiting_reply: false })
    .eq("id", conversa)
    .throwOnError();
}

beforeAll(async () => {
  await criarUsuario("recepcao");
  await criarUsuario("colega");
  await criarUsuario("gestora");
});

afterAll(async () => {
  // As clinicas antes dos usuarios: mensagem, atividade e autoria apontam
  // para eles.
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
  for (const usuario of usuarios.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

// ---------------------------------------------------------------------------
// Planejadora
// ---------------------------------------------------------------------------

describe("planejadora", () => {
  it("a vencida vira job 'enviar_mensagem_agendada' no número dela, com payload só de ids (nunca o texto)", async () => {
    const c = await clinica("planeja");
    const par = await parComConversa(c);
    const futura = await agendar(c, par, {
      texto: "Texto que nunca vai para a fila",
      enviarEm: new Date(Date.now() + 3 * HORA),
    });
    const agendadaId = await agendar(c, par, {
      texto: "Outro texto que nunca vai para a fila",
    });
    await vencer(agendadaId);

    const resumo = await planejar(c.clinicId);
    expect(resumo).toMatchObject({ planejadas: 1, atrasadas: 0 });
    const jobId = await jobDa(agendadaId);
    const job = await linhaDoJob(jobId);
    expect(job).toMatchObject({
      status: "pendente",
      kind: "enviar_mensagem_agendada",
      whatsapp_account_id: c.numero.id,
    });
    expect(job.payload).toEqual({
      contact_id: par.contato,
      mensagem_agendada_id: agendadaId,
    });
    expect(JSON.stringify(job.payload)).not.toContain("fila");
    expect(new Date(job.run_at).getTime()).toBeLessThanOrEqual(
      Date.now() + 5_000,
    );
    expect((await agendadaNoBanco(agendadaId)).situacao).toBe("enviando");
    // A futura nao foi tocada.
    expect(await agendadaNoBanco(futura)).toMatchObject({
      situacao: "agendada",
      job_id: null,
    });

    // Rodar de novo nao cria outro job.
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 0 });
  });

  it("vencida há mais de 12 h vira 'atrasou'; a do número removido vira 'numero_removido'; cada uma com UMA atividade", async () => {
    const c = await clinica("desiste");
    const par = await parComConversa(c);
    const atrasada = await agendar(c, par, { texto: "Atrasada demais" });
    await vencer(atrasada, 13 * HORA);

    const segundo = await criarNumeroDeTeste(admin, c.clinicId, {
      nome: "Segundo",
    });
    const parNoSegundo = await parComConversa(c, "recepcao", segundo.id);
    const noRemovido = await agendar(c, parNoSegundo, {
      numeroId: segundo.id,
      texto: "Do número que vai sair",
    });
    await vencer(noRemovido);
    // O numero sai sem passar por remover_numero (o caminho da planejadora).
    await admin
      .from("whatsapp_account")
      .update({ removido_em: new Date().toISOString() })
      .eq("id", segundo.id)
      .throwOnError();

    const resumo = await planejar(c.clinicId);
    expect(resumo).toMatchObject({
      planejadas: 0,
      atrasadas: 1,
      numero_removido: 1,
    });
    expect(await agendadaNoBanco(atrasada)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "atrasou",
      job_id: null,
    });
    expect(await agendadaNoBanco(noRemovido)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "numero_removido",
      job_id: null,
    });
    const hoje = diaCivil(TZ, new Date());
    const daAtrasada = await atividadesDo(par.contato);
    expect(daAtrasada).toHaveLength(1);
    expect(daAtrasada[0]).toMatchObject({
      titulo: "Mensagem agendada não saiu",
      origem: "automacao",
      automacao_id: null,
      created_by: null,
      assignee_user_id: uid("recepcao"),
      status: "pendente",
      due_on: hoje,
      due_at: null,
    });
    expect(daAtrasada[0]!.detalhes).toContain(
      "o envio atrasou mais de 12 horas",
    );
    expect(daAtrasada[0]!.detalhes).not.toContain("Atrasada demais");
    const doRemovido = await atividadesDo(parNoSegundo.contato);
    expect(doRemovido).toHaveLength(1);
    expect(doRemovido[0]!.detalhes).toContain(
      "o número Segundo foi removido da clínica",
    );
    expect(await agendadaNoBanco(atrasada)).toMatchObject({
      atividade_id: daAtrasada[0]!.id,
    });

    // Nenhum job nasceu.
    const { count } = await admin
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", c.clinicId)
      .eq("kind", "enviar_mensagem_agendada");
    expect(count).toBe(0);
  });

  it("duas para o mesmo contato e número no mesmo minuto, com o slot adiado: a segunda só vira job depois da primeira fechar, e saem na ordem", async () => {
    const c = await clinica("vez");
    const par = await parComConversa(c);
    const primeira = await agendar(c, par, { texto: "Primeira da fila" });
    const segunda = await agendar(c, par, { texto: "Segunda da fila" });
    const marcada = new Date(Date.now() - MINUTO).toISOString();
    await admin
      .from("mensagem_agendada")
      .update({ enviar_em: marcada })
      .in("id", [primeira, segunda])
      .throwOnError();

    expect(await planejar(c.clinicId)).toMatchObject({
      planejadas: 1,
      esperando_a_anterior: 1,
    });
    const jobDaPrimeira = await jobDa(primeira);
    expect((await agendadaNoBanco(segunda)).situacao).toBe("agendada");

    // Canal ocupado com outros envios: a primeira e adiada.
    await admin
      .from("whatsapp_account")
      .update({
        next_bulk_send_at: new Date(Date.now() + 10 * MINUTO).toISOString(),
      })
      .eq("id", c.numero.id)
      .throwOnError();
    resetFakeProvider();
    expect(await executar(jobDaPrimeira)).toBe("reagendado");
    expect(await linhaDoJob(jobDaPrimeira)).toMatchObject({
      status: "pendente",
      ultimo_motivo_devolucao: "canal_ocupado",
    });
    expect(await planejar(c.clinicId)).toMatchObject({
      planejadas: 0,
      esperando_a_anterior: 1,
    });

    await liberarSlot(c.numero.id);
    expect(await executar(jobDaPrimeira)).toBe("concluido");
    expect((await agendadaNoBanco(primeira)).situacao).toBe("enviada");

    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 1 });
    await liberarSlot(c.numero.id);
    expect(await executar(await jobDa(segunda))).toBe("concluido");
    expect((await agendadaNoBanco(segunda)).situacao).toBe("enviada");
    expect(enviadasNa(c.clinicId).map((m) => m.body)).toEqual([
      "Primeira da fila",
      "Segunda da fila",
    ]);
  }, 60_000);

  it("o limite conta só o que dá para planejar: a que espera a anterior não toma a vaga de outra", async () => {
    const c = await clinica("limite");
    const par = await parComConversa(c);
    const primeira = await agendar(c, par, { texto: "Primeira do contato" });
    await vencer(primeira, 10 * MINUTO);
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 1 });
    const segunda = await agendar(c, par, { texto: "Segunda do contato" });
    await vencer(segunda, 9 * MINUTO);
    const outroPar = await parComConversa(c);
    const deOutro = await agendar(c, outroPar, { texto: "De outro contato" });
    await vencer(deOutro, 5 * MINUTO);

    // A segunda e a mais antiga das vencidas, mas espera a primeira: com
    // lote de 1, a vaga e da de outro contato.
    const { data, error } = await admin.rpc("planejar_mensagens_agendadas", {
      p_clinic_id: c.clinicId,
      p_incluir_teste: true,
      p_limite: 1,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      planejadas: 1,
      esperando_a_anterior: 1,
      erros_por_linha: 0,
    });
    expect((await agendadaNoBanco(segunda)).situacao).toBe("agendada");
    expect((await agendadaNoBanco(deOutro)).situacao).toBe("enviando");
  });

  it("erro numa linha não para as outras (planejadora e reconciliação), e a revogação grava mesmo assim", async () => {
    const c = await clinica("erro-linha");
    // A conversa da quebrada passa para outro contato (PATCH que a policy de
    // conversa deixa): a atividade de "nao saiu" e recusada (23514).
    const parQuebrado = await parComConversa(c);
    const quebrada = await agendar(c, parQuebrado, { texto: "Quebrada" });
    await vencer(quebrada, 13 * HORA);
    const parSadio = await parComConversa(c);
    const sadia = await agendar(c, parSadio, { texto: "Sadia" });
    await vencer(sadia);
    await trocarContatoDaConversa(
      parQuebrado.conversa,
      await contatoSemConversa(c),
    );

    expect(await planejar(c.clinicId)).toMatchObject({
      planejadas: 1,
      erros_por_linha: 1,
    });
    expect(await agendadaNoBanco(quebrada)).toMatchObject({
      situacao: "agendada",
      texto: "Quebrada",
    });
    expect((await agendadaNoBanco(sadia)).situacao).toBe("enviando");

    // O descadastro do contato da quebrada grava mesmo com ela quebrada.
    const revogacao = await sessao("recepcao")
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", c.clinicId)
      .eq("contact_id", parQuebrado.contato)
      .is("revoked_at", null)
      .select("id");
    expect(revogacao.error).toBeNull();
    expect(revogacao.data).toHaveLength(1);
    // Fechar com a atividade falha (conversa trocada), entao a revogacao
    // fecha sem ela: o descadastro nunca deixa a agendada viva para uma
    // reautorizacao (revisao de 06/10/2026).
    expect(await agendadaNoBanco(quebrada)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
    });

    // Reconciliacao: duas com o job encerrado; a de conversa trocada erra
    // sozinha.
    const parReconciliar = await parComConversa(c);
    const quebradaNaFila = await agendar(c, parReconciliar, {
      texto: "Quebrada na fila",
    });
    await vencer(quebradaNaFila);
    await planejar(c.clinicId);
    for (const agendadaId of [sadia, quebradaNaFila]) {
      await admin
        .from("job_queue")
        .update({ status: "falhou", last_error: "desconectado" })
        .eq("id", await jobDa(agendadaId))
        .throwOnError();
    }
    await trocarContatoDaConversa(
      parReconciliar.conversa,
      await contatoSemConversa(c),
    );
    expect(await reconciliar(c.clinicId)).toMatchObject({
      fechadas_sem_envio: 1,
      erros_por_linha: 1,
    });
    expect(await agendadaNoBanco(sadia)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "numero_desconectado",
    });
    expect((await agendadaNoBanco(quebradaNaFila)).situacao).toBe("enviando");

    // Consertadas as conversas, a passagem seguinte fecha as duas.
    await trocarContatoDaConversa(parQuebrado.conversa, parQuebrado.contato);
    await trocarContatoDaConversa(
      parReconciliar.conversa,
      parReconciliar.contato,
    );
    expect(await planejar(c.clinicId)).toMatchObject({
      atrasadas: 0,
      erros_por_linha: 0,
    });
    expect(await reconciliar(c.clinicId)).toMatchObject({
      fechadas_sem_envio: 1,
      erros_por_linha: 0,
    });
    expect(await agendadaNoBanco(quebrada)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
    });
    expect((await agendadaNoBanco(quebradaNaFila)).situacao).toBe(
      "nao_enviada",
    );
  });
});

// ---------------------------------------------------------------------------
// Executor pelo fake
// ---------------------------------------------------------------------------

describe("executor: sai em nome de quem assina, pelo número da conversa", () => {
  it("autoria da pessoa, custo 0 e billable false, 'Aguardando você' mantido, e a agendada fecha 'enviada' sem o texto", async () => {
    const c = await clinica("sai");
    const par = await parComConversa(c);
    await admin
      .from("conversation")
      .update({ awaiting_reply: true })
      .eq("id", par.conversa)
      .throwOnError();
    const agendadaId = await agendar(c, par, {
      texto: "Bom dia! Sua consulta é amanhã às 9h.",
    });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);

    resetFakeProvider();
    expect(await executar(jobId)).toBe("concluido");

    const enviadas = enviadasNa(c.clinicId);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({
      accountId: c.numero.id,
      body: "Bom dia! Sua consulta é amanhã às 9h.",
    });
    expect(enviadas[0]!.to.replace(/\D/g, "")).toBe(
      par.telefone.replace(/\D/g, ""),
    );
    const [mensagem] = await mensagensDoContato(par.contato);
    expect(mensagem).toMatchObject({
      conversation_id: par.conversa,
      author: "usuario",
      author_user_id: uid("recepcao"),
      cost_cents: 0,
      billable: false,
      job_id: jobId,
      whatsapp_account_id: c.numero.id,
    });
    expect(["enviada", "entregue", "lida"]).toContain(
      mensagem!.delivery_status,
    );

    const [conversa] = await conversasAbertas(par.contato);
    expect(conversa).toMatchObject({
      id: par.conversa,
      status: "em_atendimento",
      assignee_user_id: uid("recepcao"),
      awaiting_reply: true,
    });

    const agendada = await agendadaNoBanco(agendadaId);
    expect(agendada).toMatchObject({
      situacao: "enviada",
      motivo: null,
      texto: null,
      message_id: mensagem!.id,
      conversation_id: par.conversa,
      atividade_id: null,
    });
    expect(agendada.enviada_em).not.toBeNull();
    expect((await linhaDoJob(jobId)).status).toBe("concluido");
  });

  it("A1: editada pela colega sai em nome dela; com a conversa resolvida antes, nasce outra e só vai para a colega depois do envio", async () => {
    const c = await clinica("assina");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, {
      texto: "Texto de quem agendou",
    });
    await sessao("colega")
      .from("mensagem_agendada")
      .update({ texto: "Texto da colega" })
      .eq("id", agendadaId)
      .throwOnError();
    expect((await agendadaNoBanco(agendadaId)).editada_por).toBe(uid("colega"));

    await resolverConversa(par.conversa);
    await vencer(agendadaId);
    await planejar(c.clinicId);
    resetFakeProvider();
    expect(await executar(await jobDa(agendadaId))).toBe("concluido");

    const [mensagem] = await mensagensDoContato(par.contato);
    expect(mensagem).toMatchObject({
      author: "usuario",
      author_user_id: uid("colega"),
      body: "Texto da colega",
    });
    expect(mensagem!.conversation_id).not.toBe(par.conversa);
    const abertas = await conversasAbertas(par.contato);
    expect(abertas).toHaveLength(1);
    expect(abertas[0]).toMatchObject({
      id: mensagem!.conversation_id,
      status: "em_atendimento",
      assignee_user_id: uid("colega"),
    });
    expect((await agendadaNoBanco(agendadaId)).conversation_id).toBe(
      mensagem!.conversation_id,
    );
  });

  it("número desconectado espera sem criar conversa; slot adiado não atribui; só depois de sair a conversa vai para quem assina", async () => {
    const c = await clinica("espera");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Espera o número" });
    await resolverConversa(par.conversa);
    await mudarConexao(c.numero.id, "desconectado");
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    resetFakeProvider();

    expect(await executar(jobId)).toBe("reagendado");
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "pendente",
      ultimo_motivo_devolucao: "desconectado",
    });
    expect(await conversasAbertas(par.contato)).toEqual([]);
    expect((await agendadaNoBanco(agendadaId)).situacao).toBe("enviando");

    // Reconecta com o canal ocupado: a conversa nasce, mas ninguem e
    // atribuido enquanto nada saiu.
    await mudarConexao(c.numero.id, "conectado");
    await admin
      .from("whatsapp_account")
      .update({
        next_bulk_send_at: new Date(Date.now() + 10 * MINUTO).toISOString(),
      })
      .eq("id", c.numero.id)
      .throwOnError();
    expect(await executar(jobId)).toBe("reagendado");
    expect((await linhaDoJob(jobId)).ultimo_motivo_devolucao).toBe(
      "canal_ocupado",
    );
    for (const conversa of await conversasAbertas(par.contato)) {
      expect(conversa.assignee_user_id).toBeNull();
      expect(conversa.status).not.toBe("em_atendimento");
    }
    expect(enviadasNa(c.clinicId)).toEqual([]);

    await liberarSlot(c.numero.id);
    expect(await executar(jobId)).toBe("concluido");
    const abertas = await conversasAbertas(par.contato);
    expect(abertas).toHaveLength(1);
    expect(abertas[0]).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: uid("recepcao"),
    });
  }, 60_000);

  it("não rouba a conversa de colega nem da IA", async () => {
    const c = await clinica("rouba");
    const parDaColega = await parComConversa(c);
    const daColega = await agendar(c, parDaColega, {
      texto: "Para a conversa da colega",
    });
    await admin
      .from("conversation")
      .update({ assignee_user_id: uid("colega") })
      .eq("id", parDaColega.conversa)
      .throwOnError();

    const parDaIa = await parComConversa(c);
    const daIa = await agendar(c, parDaIa, { texto: "Para a conversa da IA" });
    await admin
      .from("conversation")
      .update({ status: "ia_atendendo", assignee_user_id: null })
      .eq("id", parDaIa.conversa)
      .throwOnError();

    await vencer(daColega);
    await vencer(daIa);
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 2 });
    resetFakeProvider();
    expect(await executar(await jobDa(daColega))).toBe("concluido");
    await liberarSlot(c.numero.id);
    expect(await executar(await jobDa(daIa))).toBe("concluido");

    expect(await conversasAbertas(parDaColega.contato)).toEqual([
      expect.objectContaining({
        id: parDaColega.conversa,
        status: "em_atendimento",
        assignee_user_id: uid("colega"),
      }),
    ]);
    expect(await conversasAbertas(parDaIa.contato)).toEqual([
      expect.objectContaining({
        id: parDaIa.conversa,
        status: "ia_atendendo",
        assignee_user_id: null,
      }),
    ]);
    // A autoria continua de quem assina.
    const [daColegaMsg] = await mensagensDoContato(parDaColega.contato);
    expect(daColegaMsg!.author_user_id).toBe(uid("recepcao"));
  }, 60_000);

  it.each([
    ["inativo", { status: "inativo" }],
    ["Somente leitura (A5)", { role: "leitura" }],
  ] as const)(
    "quem assina sem acesso com escrita (%s): sai em nome dela e a conversa fica Sem atendente",
    async (_rotulo, mudanca) => {
      const c = await clinica(
        `saiu-${"status" in mudanca ? "inativo" : "leitura"}`,
      );
      const par = await parComConversa(c);
      const agendadaId = await agendar(c, par, {
        texto: "De quem saiu da equipe",
      });
      await resolverConversa(par.conversa);
      await admin
        .from("clinic_member")
        .update(mudanca)
        .eq("clinic_id", c.clinicId)
        .eq("user_id", uid("recepcao"))
        .throwOnError();

      await vencer(agendadaId);
      await planejar(c.clinicId);
      resetFakeProvider();
      expect(await executar(await jobDa(agendadaId))).toBe("concluido");

      const [mensagem] = await mensagensDoContato(par.contato);
      expect(mensagem!.author_user_id).toBe(uid("recepcao"));
      const abertas = await conversasAbertas(par.contato);
      expect(abertas).toHaveLength(1);
      expect(abertas[0]).toMatchObject({
        status: "aguardando_humano",
        assignee_user_id: null,
      });
      expect((await agendadaNoBanco(agendadaId)).situacao).toBe("enviada");
    },
  );
});

// ---------------------------------------------------------------------------
// Autorizacao
// ---------------------------------------------------------------------------

describe("revogação da autorização", () => {
  it("a agendada e a da fila com o job pendente param na hora (job cancelado), a que já executa morre no executor (trilha sem pessoa); reautorizar não revive nada", async () => {
    const c = await clinica("revoga");
    const par = await parComConversa(c);
    const futura = await agendar(c, par, {
      texto: "Futura do contato",
      enviarEm: new Date(Date.now() + 5 * HORA),
    });
    const naFila = await agendar(c, par, { texto: "Já na fila" });
    await vencer(naFila);
    // A do outro contato ja esta executando quando a autorizacao cai.
    const parExecutando = await parComConversa(c);
    const executando = await agendar(c, parExecutando, {
      texto: "Já executando",
    });
    await vencer(executando);
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 2 });
    const jobNaFila = await jobDa(naFila);
    const jobExecutando = await reivindicar(await jobDa(executando));

    // Numero caido: a da fila volta ao job pendente, esperando a reconexao.
    await mudarConexao(c.numero.id, "desconectado");
    resetFakeProvider();
    expect(await executar(jobNaFila)).toBe("reagendado");
    expect((await linhaDoJob(jobNaFila)).status).toBe("pendente");
    await mudarConexao(c.numero.id, "conectado");

    // A recepcao revoga pela ficha (sessao), os dois contatos.
    for (const contato of [par.contato, parExecutando.contato]) {
      await sessao("recepcao")
        .from("contact_consent")
        .update({ revoked_at: new Date().toISOString() })
        .eq("clinic_id", c.clinicId)
        .eq("contact_id", contato)
        .is("revoked_at", null)
        .throwOnError();
    }

    expect(await agendadaNoBanco(futura)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
      texto: "Futura do contato",
    });
    expect(await agendadaNoBanco(naFila)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
    });
    expect(await linhaDoJob(jobNaFila)).toMatchObject({
      status: "cancelado",
      last_error: "sem_consentimento",
    });
    expect((await atividadesDo(par.contato)).length).toBe(2);
    // A que executa e do executor.
    expect((await agendadaNoBanco(executando)).situacao).toBe("enviando");

    resetFakeProvider();
    expect(await executarJobComPosse(admin, WORKER, jobExecutando)).toBe(
      "falhou",
    );
    expect(await linhaDoJob(jobExecutando.id)).toMatchObject({
      status: "falhou",
      last_error: "sem_consentimento",
    });
    expect(await agendadaNoBanco(executando)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
    });
    expect((await atividadesDo(parExecutando.contato)).length).toBe(1);
    expect(enviadasNa(c.clinicId)).toEqual([]);

    const { data: bloqueios } = await admin
      .from("audit_log")
      .select("user_id, entity")
      .eq("clinic_id", c.clinicId)
      .eq("action", "envio_bloqueado_sem_autorizacao")
      .throwOnError();
    expect((bloqueios ?? []).length).toBeGreaterThan(0);
    for (const linha of bloqueios ?? []) {
      expect(linha).toEqual({ user_id: null, entity: "contact" });
    }

    // Reautoriza (com evidencia, regra 3.4): nada volta a sair.
    for (const contato of [par.contato, parExecutando.contato]) {
      await admin
        .from("contact_consent")
        .insert({
          clinic_id: c.clinicId,
          contact_id: contato,
          channel: "whatsapp",
          source: "recepcao",
          evidence: "Autorizou de novo no balcão",
        })
        .throwOnError();
    }
    await vencer(futura);
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 0 });
    expect((await agendadaNoBanco(futura)).situacao).toBe("nao_enviada");
    const reclamado = await admin
      .from("job_queue")
      .update({ status: "executando", locked_by: WORKER })
      .eq("id", jobNaFila)
      .eq("status", "pendente")
      .select("id");
    expect(reclamado.data ?? []).toEqual([]);
    expect(enviadasNa(c.clinicId)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Excluir e editar contra o motor
// ---------------------------------------------------------------------------

describe("excluir e editar contra o motor", () => {
  it("excluir a que está esperando o número cancela o job; reconectar não envia", async () => {
    const c = await clinica("exclui");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Não deve sair" });
    await mudarConexao(c.numero.id, "desconectado");
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    resetFakeProvider();
    expect(await executar(jobId)).toBe("reagendado");

    const { data, error } = await sessao("colega")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", agendadaId)
      .in("situacao", ["agendada", "enviando"])
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "cancelado",
      last_error: "cancelada_pela_clinica",
    });
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "cancelada",
      texto: null,
    });

    await mudarConexao(c.numero.id, "conectado");
    const reclamado = await admin
      .from("job_queue")
      .update({ status: "executando", locked_by: WORKER })
      .eq("id", jobId)
      .eq("status", "pendente")
      .select("id");
    expect(reclamado.data ?? []).toEqual([]);
    expect(await planejar(c.clinicId)).toMatchObject({ planejadas: 0 });
    expect(enviadasNa(c.clinicId)).toEqual([]);
  });

  it("excluir a que voltou à fila depois de uma falha que certamente não enviou cancela o job; envio incerto continua CZ409", async () => {
    const c = await clinica("exclui-retry");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Falhou sem sair" });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    // 1a tentativa: o send.ts gravou a message e a reconferencia falhou
    // (leitura_falhou, de falhas_sem_envio()); o job voltou a 'pendente'.
    await falhaDoJob(c, par, jobId, "leitura_falhou");

    const { data, error } = await sessao("colega")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", agendadaId)
      .in("situacao", ["agendada", "enviando"])
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "cancelado",
      last_error: "cancelada_pela_clinica",
    });
    const reclamado = await admin
      .from("job_queue")
      .update({ status: "executando", locked_by: WORKER })
      .eq("id", jobId)
      .eq("status", "pendente")
      .select("id");
    expect(reclamado.data ?? []).toEqual([]);
    expect(enviadasNa(c.clinicId)).toEqual([]);

    // Pode ter chegado (envio_incerto): a exclusao perde.
    const outroPar = await parComConversa(c);
    const talvez = await agendar(c, outroPar, { texto: "Talvez tenha saído" });
    await vencer(talvez);
    await planejar(c.clinicId);
    const jobTalvez = await jobDa(talvez);
    await falhaDoJob(c, outroPar, jobTalvez, "envio_incerto");
    const recusa = await sessao("colega")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", talvez);
    expect(recusa.error?.code).toBe(CORRIDA);
    expect((await linhaDoJob(jobTalvez)).status).toBe("pendente");
    // Solta o job (a clinica de teste nao vai executa-lo).
    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("id", jobTalvez)
      .throwOnError();
  });

  it("corrida excluir contra o claim: exatamente um dos dois vence", async () => {
    const c = await clinica("corrida-exclui");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Corrida" });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);

    const [exclusao, claim] = await Promise.all([
      sessao("recepcao")
        .from("mensagem_agendada")
        .update({ situacao: "cancelada" })
        .eq("id", agendadaId)
        .select("id"),
      admin
        .from("job_queue")
        .update({
          status: "executando",
          locked_by: WORKER,
          locked_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "pendente")
        .select("id"),
    ]);
    const excluiu =
      exclusao.error === null && (exclusao.data ?? []).length === 1;
    const reivindicou = (claim.data ?? []).length === 1;
    expect(excluiu !== reivindicou).toBe(true);
    const job = await linhaDoJob(jobId);
    const agendada = await agendadaNoBanco(agendadaId);
    if (excluiu) {
      expect(job.status).toBe("cancelado");
      expect(agendada.situacao).toBe("cancelada");
    } else {
      expect(exclusao.error?.code).toBe(CORRIDA);
      expect(job.status).toBe("executando");
      expect(agendada.situacao).toBe("enviando");
      // Solta o job sem enviar (o teste nao segue com o envio).
      await admin
        .from("job_queue")
        .update({ status: "cancelado", locked_by: null, locked_at: null })
        .eq("id", jobId)
        .throwOnError();
    }
  });

  it("editar depois da planejadora: 0 linhas pelo filtro da ação (e CZ409 sem ele); em corrida, um dos dois resultados coerentes", async () => {
    const c = await clinica("corrida-edita");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Original" });
    await vencer(agendadaId);
    await planejar(c.clinicId);

    const filtrada = await sessao("recepcao")
      .from("mensagem_agendada")
      .update({ texto: "Mudança tardia" })
      .eq("id", agendadaId)
      .eq("situacao", "agendada")
      .select("id");
    expect(filtrada.error).toBeNull();
    expect(filtrada.data ?? []).toEqual([]);
    const semFiltro = await sessao("recepcao")
      .from("mensagem_agendada")
      .update({ texto: "Mudança tardia" })
      .eq("id", agendadaId);
    expect(semFiltro.error?.code).toBe(CORRIDA);
    expect((await agendadaNoBanco(agendadaId)).texto).toBe("Original");

    // Em corrida de verdade.
    const outra = await agendar(c, await parComConversa(c), { texto: "Antes" });
    await vencer(outra);
    const [edicao] = await Promise.all([
      sessao("recepcao")
        .from("mensagem_agendada")
        .update({ texto: "Depois" })
        .eq("id", outra)
        .eq("situacao", "agendada")
        .select("id"),
      planejar(c.clinicId),
    ]);
    // Se a edicao segurou a linha, a planejadora a pulou (SKIP LOCKED): a
    // proxima passagem pega.
    await planejar(c.clinicId);
    const final = await agendadaNoBanco(outra);
    expect(final.situacao).toBe("enviando");
    if ((edicao.data ?? []).length === 1) {
      expect(final.texto).toBe("Depois");
    } else {
      expect(edicao.error).toBeNull();
      expect(final.texto).toBe("Antes");
    }
  });
});

// ---------------------------------------------------------------------------
// Queda e reexecucao
// ---------------------------------------------------------------------------

describe("queda e reexecução", () => {
  async function comMensagemDoJob(
    c: Clinica,
    par: Par,
    jobId: string,
    status: "enviada" | "enviando",
  ): Promise<string> {
    const { data } = await admin
      .from("message")
      .insert({
        clinic_id: c.clinicId,
        conversation_id: par.conversa,
        direction: "saida",
        author: "usuario",
        author_user_id: uid("recepcao"),
        content_type: "texto",
        body: "Mensagem da queda",
        job_id: jobId,
        delivery_status: status,
        billable: false,
        cost_cents: 0,
      })
      .select("id")
      .single()
      .throwOnError();
    return data!.id as string;
  }

  it("a mensagem já tinha saído: fecha 'enviada' sem reenviar", async () => {
    const c = await clinica("queda-enviada");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par);
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    const mensagemId = await comMensagemDoJob(c, par, jobId, "enviada");

    resetFakeProvider();
    expect(await executar(jobId)).toBe("concluido");
    expect(enviadasNa(c.clinicId)).toEqual([]);
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "enviada",
      message_id: mensagemId,
      texto: null,
    });
  });

  it("a mensagem ficou 'enviando': fecha 'nao_confirmada' com a atividade de conferir, sem reenviar", async () => {
    const c = await clinica("queda-incerta");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Pode ter chegado" });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    const mensagemId = await comMensagemDoJob(c, par, jobId, "enviando");

    resetFakeProvider();
    expect(await executar(jobId)).toBe("falhou");
    expect(enviadasNa(c.clinicId)).toEqual([]);
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "falhou",
      last_error: "envio_incerto",
    });
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "nao_confirmada",
      motivo: "envio_incerto",
      message_id: mensagemId,
    });
    const atividades = await atividadesDo(par.contato);
    expect(atividades).toHaveLength(1);
    expect(atividades[0]).toMatchObject({
      titulo: "Conferir se a mensagem agendada chegou",
      assignee_user_id: uid("recepcao"),
    });
    expect(atividades[0]!.detalhes).not.toContain("Pode ter chegado");
  });

  it("lease_expirado com a mensagem enviada: a reconciliação do motor fecha 'enviada'", async () => {
    const c = await clinica("queda-lease");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par);
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    await comMensagemDoJob(c, par, jobId, "enviada");
    await admin
      .from("job_queue")
      .update({ status: "falhou", last_error: "lease_expirado" })
      .eq("id", jobId)
      .throwOnError();

    expect(await reconciliar(c.clinicId)).toMatchObject({
      fechadas_enviadas: 1,
      fechadas_sem_envio: 0,
      presas: 0,
    });
    expect((await agendadaNoBanco(agendadaId)).situacao).toBe("enviada");
  });

  it("falha antiga na message e motivo final no job: vale o do job (sem 'agende de novo' para quem revogou)", async () => {
    const c = await clinica("queda-motivo");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Motivo do job" });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    const mensagemId = await falhaDoJob(c, par, jobId, "leitura_falhou");
    // A 2a tentativa encerrou o job de vez sem tocar a message.
    await admin
      .from("job_queue")
      .update({ status: "falhou", last_error: "sem_consentimento" })
      .eq("id", jobId)
      .throwOnError();

    expect(await reconciliar(c.clinicId)).toMatchObject({
      fechadas_sem_envio: 1,
    });
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
      message_id: mensagemId,
    });
    const [atividade] = await atividadesDo(par.contato);
    expect(atividade!.detalhes).toContain(
      "o contato não autoriza receber mensagens",
    );
    expect(atividade!.detalhes).not.toContain("agende de novo");
  });

  it("job que falhou sem o executor fechar: a reconciliação do motor fecha 'nao_enviada' com o motivo e a atividade", async () => {
    const c = await clinica("queda-motor");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par);
    await vencer(agendadaId);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);
    await admin
      .from("job_queue")
      .update({ status: "falhou", last_error: "desconectado" })
      .eq("id", jobId)
      .throwOnError();

    expect(await reconciliar(c.clinicId)).toMatchObject({
      fechadas_sem_envio: 1,
    });
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "numero_desconectado",
    });
    const [atividade] = await atividadesDo(par.contato);
    expect(atividade!.detalhes).toContain(
      "ficou desconectado por mais de 12 horas",
    );
  });
});

// ---------------------------------------------------------------------------
// remover_numero
// ---------------------------------------------------------------------------

describe("remover_numero", () => {
  it("cancela o job pendente (mesmo depois de uma falha que certamente não enviou) e encerra as agendadas do número, cada uma com atividade", async () => {
    const c = await clinica("remove");
    const segundo = await criarNumeroDeTeste(admin, c.clinicId, {
      nome: "Do Doutor",
    });
    const par = await parComConversa(c, "recepcao", segundo.id);
    const futura = await agendar(c, par, {
      numeroId: segundo.id,
      texto: "Futura no número que sai",
      enviarEm: new Date(Date.now() + 4 * HORA),
    });
    const naFila = await agendar(c, par, {
      numeroId: segundo.id,
      texto: "Na fila do número que sai",
    });
    await vencer(naFila);
    await planejar(c.clinicId);
    const jobId = await jobDa(naFila);
    // A 1a tentativa falhou sem sair (canal_ocupado): o job pendente ainda
    // e cancelado.
    await falhaDoJob(c, par, jobId, "canal_ocupado");
    // Outro numero da clinica nao e tocado.
    const parNoPrincipal = await parComConversa(c);
    const noPrincipal = await agendar(c, parNoPrincipal);

    const { data, error } = await admin.rpc("remover_numero", {
      p_clinic_id: c.clinicId,
      p_account_id: segundo.id,
      p_removido_por: uid("gestora"),
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, agendadas_encerradas: 2 });
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "cancelado",
      last_error: "numero_removido",
    });
    for (const agendadaId of [futura, naFila]) {
      const linha = await agendadaNoBanco(agendadaId);
      expect(linha).toMatchObject({
        situacao: "nao_enviada",
        motivo: "numero_removido",
      });
      expect(linha.atividade_id).not.toBeNull();
    }
    expect(await atividadesDo(par.contato)).toHaveLength(2);
    expect((await agendadaNoBanco(noPrincipal)).situacao).toBe("agendada");
  });
});

// ---------------------------------------------------------------------------
// Madrugada (A2)
// ---------------------------------------------------------------------------

describe("madrugada (A2): a atrasada não sai entre 21:00 e 08:00 da clínica", () => {
  it("atrasada às 23h da clínica espera as 08:00, sem enviar", async () => {
    const fuso = fusoComHoraLocal(23);
    const c = await clinica("madrugada-espera", { fuso });
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Atrasada da noite" });
    await vencer(agendadaId, HORA);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);

    resetFakeProvider();
    const job = await reivindicar(jobId);
    const resultado = await executarMensagemAgendada(admin, job);
    const { enviar_em } = (
      await admin
        .from("mensagem_agendada")
        .select("enviar_em")
        .eq("id", agendadaId)
        .single()
        .throwOnError()
    ).data as { enviar_em: string };
    const esperado = decidirJanelaDaAgendada({
      enviarEm: enviar_em,
      agora: Date.now(),
      fuso,
    });
    expect(esperado.acao).toBe("esperar");
    expect(resultado).toMatchObject({ motivo: "silencio_noturno" });
    if (!("reagendar" in resultado) || esperado.acao !== "esperar") {
      throw new Error("a atrasada da madrugada devia esperar");
    }
    expect(resultado.reagendar).toBe(esperado.ate);
    // 08:00 no fuso da clinica.
    expect(
      new Date(resultado.reagendar).toLocaleTimeString("pt-BR", {
        timeZone: fuso,
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toBe("08:00");
    expect(enviadasNa(c.clinicId)).toEqual([]);

    // O worker devolve o job para as 08:00 sem queimar tentativa.
    const { data: devolvido } = await admin.rpc("reagendar_job", {
      p_id: jobId,
      p_worker: WORKER,
      p_run_at: resultado.reagendar,
      p_motivo: resultado.motivo ?? null,
    });
    expect(devolvido).toBe(true);
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "pendente",
      ultimo_motivo_devolucao: "silencio_noturno",
      run_at: expect.any(String),
    });
    expect(new Date((await linhaDoJob(jobId)).run_at).getTime()).toBe(
      new Date(resultado.reagendar).getTime(),
    );
    expect((await agendadaNoBanco(agendadaId)).situacao).toBe("enviando");
  });

  it("atrasada que passaria das 12 h esperando as 08:00 desiste ('madrugada') com a atividade, uma só", async () => {
    const fuso = fusoComHoraLocal(23);
    const c = await clinica("madrugada-desiste", { fuso });
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, {
      texto: "Atrasada demais da noite",
    });
    await vencer(agendadaId, 5 * HORA);
    await planejar(c.clinicId);
    const jobId = await jobDa(agendadaId);

    resetFakeProvider();
    expect(await executar(jobId)).toBe("falhou");
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "falhou",
      last_error: "madrugada",
    });
    expect(enviadasNa(c.clinicId)).toEqual([]);
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "madrugada",
    });
    const atividades = await atividadesDo(par.contato);
    expect(atividades).toHaveLength(1);
    expect(atividades[0]!.due_on).toBe(diaCivil(fuso, new Date()));
    // Nao foi "mais de 12 horas": o texto diz o que houve.
    expect(atividades[0]!.detalhes).toContain(
      "o envio atrasou e cairia de madrugada",
    );

    // A3: idempotente. Encerrar e reconciliar de novo nao criam outra.
    const { data: deNovo } = await admin.rpc("encerrar_agendada_sem_envio", {
      p_agendada_id: agendadaId,
      p_situacao: "nao_enviada",
      p_motivo: "falha_no_envio",
    });
    expect(deNovo).toBe(false);
    const { data: reconciliada } = await admin.rpc(
      "reconciliar_mensagem_agendada",
      { p_agendada_id: agendadaId },
    );
    expect(reconciliada).toBe("sem_mudanca");
    await reconciliar(c.clinicId);
    expect(await atividadesDo(par.contato)).toHaveLength(1);
    expect((await agendadaNoBanco(agendadaId)).motivo).toBe("madrugada");
  });
});

// ---------------------------------------------------------------------------
// Retencao (A5) e motivos
// ---------------------------------------------------------------------------

describe("retenção de 30 dias (A5) e lista de motivos", () => {
  it("a não enviada esquecida há mais de 30 dias perde o texto e sai da lista, sem quem dispensou; a de 29 dias fica", async () => {
    const c = await clinica("retencao");
    const par = await parComConversa(c);
    const velha = await agendar(c, par, { texto: "Esquecida há muito tempo" });
    const recente = await agendar(c, par, {
      texto: "Esquecida há pouco",
      enviarEm: new Date(Date.now() + 2 * HORA),
    });
    for (const agendadaId of [velha, recente]) {
      const { data } = await admin.rpc("encerrar_agendada_sem_envio", {
        p_agendada_id: agendadaId,
        p_situacao: "nao_enviada",
        p_motivo: "falha_no_envio",
      });
      expect(data).toBe(true);
    }
    await admin
      .from("mensagem_agendada")
      .update({
        encerrada_em: new Date(Date.now() - 31 * 24 * HORA).toISOString(),
      })
      .eq("id", velha)
      .throwOnError();
    await admin
      .from("mensagem_agendada")
      .update({
        encerrada_em: new Date(Date.now() - 29 * 24 * HORA).toISOString(),
      })
      .eq("id", recente)
      .throwOnError();

    expect(await reconciliar(c.clinicId)).toMatchObject({ retidas: 1 });
    const linhaVelha = await agendadaNoBanco(velha);
    expect(linhaVelha).toMatchObject({
      situacao: "nao_enviada",
      texto: null,
      dispensada_por: null,
    });
    expect(linhaVelha.dispensada_em).not.toBeNull();
    expect(await agendadaNoBanco(recente)).toMatchObject({
      texto: "Esquecida há pouco",
      dispensada_em: null,
    });
  });

  it("o CHECK do banco aceita exatamente os MOTIVOS_DA_AGENDADA do domínio", async () => {
    const c = await clinica("motivos");
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par);
    for (const motivo of MOTIVOS_DA_AGENDADA) {
      const { error } = await admin
        .from("mensagem_agendada")
        .update({ motivo })
        .eq("id", agendadaId);
      expect(error, motivo).toBeNull();
    }
    const { error } = await admin
      .from("mensagem_agendada")
      .update({ motivo: "motivo_inexistente" })
      .eq("id", agendadaId);
    expect(error?.code).toBe("23514");
  });

  it("o CHECK de kinds aceita os kinds de envio do motor; a faixa de mensagens esperando conta o novo", async () => {
    const c = await clinica("kinds");
    expect(KINDS_DE_ENVIO).toContain("enviar_mensagem_agendada");
    expect(KINDS_DE_ENVIO_AUTOMATICO).toContain("enviar_mensagem_agendada");
    for (const kind of KINDS_DE_ENVIO) {
      const { error } = await admin.from("job_queue").insert({
        clinic_id: c.clinicId,
        kind,
        payload: {},
        status: "cancelado",
        whatsapp_account_id: c.numero.id,
      });
      expect(error, kind).toBeNull();
    }
    const { error } = await admin.from("job_queue").insert({
      clinic_id: c.clinicId,
      kind: "kind_inexistente",
      payload: {},
      status: "cancelado",
    });
    expect(error?.code).toBe("23514");
  });
});

// ---------------------------------------------------------------------------
// Claim legado (npm run worker e as suites de integracao)
// ---------------------------------------------------------------------------

describe("claim legado (claim_jobs)", () => {
  it("não reivindica agendada: pula para o job seguinte", async () => {
    const c = await clinica("claim-legado");
    // Os dois mais antigos da fila inteira (run_at de 1999 e 2000): o
    // claim_jobs com limite 1 so pode pegar um destes, nunca job de verdade.
    const { data: agendadaNaFila } = await admin
      .from("job_queue")
      .insert({
        clinic_id: c.clinicId,
        kind: "enviar_mensagem_agendada",
        payload: {},
        whatsapp_account_id: c.numero.id,
        run_at: "1999-12-31T00:00:00Z",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: ativa } = await admin
      .from("job_queue")
      .insert({
        clinic_id: c.clinicId,
        kind: "enviar_mensagem_ativa",
        payload: {},
        whatsapp_account_id: c.numero.id,
        run_at: "2000-01-01T00:00:00Z",
      })
      .select("id")
      .single()
      .throwOnError();
    try {
      const { data, error } = await admin.rpc("claim_jobs", {
        p_worker: WORKER,
        p_limit: 1,
      });
      expect(error).toBeNull();
      expect((data as { id: string }[]).map((job) => job.id)).toEqual([
        ativa!.id,
      ]);
      expect(await linhaDoJob(agendadaNaFila!.id as string)).toMatchObject({
        status: "pendente",
      });
    } finally {
      await admin
        .from("job_queue")
        .update({ status: "cancelado", locked_by: null, locked_at: null })
        .in("id", [agendadaNaFila!.id as string, ativa!.id as string])
        .throwOnError();
    }
  });
});

// ---------------------------------------------------------------------------
// Metricas
// ---------------------------------------------------------------------------

describe("atendimento_do_periodo", () => {
  it("a agendada não conta como primeira resposta; a resposta digitada conta", async () => {
    const c = await clinica("metrica");
    const par = await parComConversa(c);
    const de = new Date(Date.now() - HORA).toISOString();
    await admin
      .from("message")
      .insert({
        clinic_id: c.clinicId,
        conversation_id: par.conversa,
        direction: "entrada",
        author: "paciente",
        content_type: "texto",
        body: "Oi, queria marcar",
        wa_message_id: `agendada-metrica-${sufixo}`,
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    const agendadaId = await agendar(c, par, { texto: "Resposta agendada" });
    await vencer(agendadaId);
    await planejar(c.clinicId);
    resetFakeProvider();
    expect(await executar(await jobDa(agendadaId))).toBe("concluido");

    const medir = async () => {
      const { data, error } = await admin.rpc("atendimento_do_periodo", {
        p_clinic_id: c.clinicId,
        p_de: de,
        p_ate: new Date(Date.now() + HORA).toISOString(),
      });
      expect(error).toBeNull();
      return (
        data as {
          atual: {
            primeira_resposta: { conversas: number; respondidas: number };
          };
        }
      ).atual.primeira_resposta;
    };
    expect(await medir()).toMatchObject({ conversas: 1, respondidas: 0 });

    await admin
      .from("message")
      .insert({
        clinic_id: c.clinicId,
        conversation_id: par.conversa,
        direction: "saida",
        author: "usuario",
        author_user_id: uid("recepcao"),
        content_type: "texto",
        body: "Resposta digitada",
        delivery_status: "enviada",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    expect(await medir()).toMatchObject({ conversas: 1, respondidas: 1 });
  });
});

// ---------------------------------------------------------------------------
// Server Actions (sessao dublada como em numeros-fase-2)
// ---------------------------------------------------------------------------

describe("Server Actions da agendada", () => {
  // Fora do Next nao ha cookie: so getSessionContext e createClient sao
  // dublados, com a recepcao REAL logada por senha (JWT, RLS e gatilhos de
  // verdade). vi.doMock vale so para o que e importado depois dele.
  const sessaoDaAcao: {
    userId: string;
    userName: string;
    active: {
      clinicId: string;
      clinicName: string;
      slug: string;
      timezone: string;
      role: string;
      status: string;
    } | null;
  } = { userId: "", userName: "Recepção", active: null };
  let acoes: typeof import("@/app/(app)/atendimento/agendadas-actions");

  beforeAll(async () => {
    sessaoDaAcao.userId = uid("recepcao");
    vi.doMock("@/lib/auth/active-clinic", () => ({
      getSessionContext: async () => sessaoDaAcao,
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => sessao("recepcao"),
    }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => undefined }));
    acoes = await import("@/app/(app)/atendimento/agendadas-actions");
  });

  afterAll(() => {
    vi.doUnmock("@/lib/auth/active-clinic");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("next/cache");
  });

  function entrarNa(c: Clinica): void {
    sessaoDaAcao.active = {
      clinicId: c.clinicId,
      clinicName: "Clínica Agendada",
      slug: `agendada-int-${c.clinicId.slice(0, 8)}`,
      timezone: c.fuso,
      role: "recepcao",
      status: "ativo",
    };
  }

  async function trilha(agendadaId: string): Promise<string[]> {
    const { data } = await admin
      .from("audit_log")
      .select("action, entity")
      .eq("entity_id", agendadaId)
      .order("created_at")
      .throwOnError();
    for (const linha of data ?? []) {
      expect(linha.entity).toBe("mensagem_agendada");
    }
    return (data ?? []).map((linha) => linha.action as string);
  }

  it("agendar, repetir o mesmo id, editar e excluir; a trilha leva só ids", async () => {
    const c = await clinica("acoes");
    entrarNa(c);
    const par = await parComConversa(c);
    const id = crypto.randomUUID();
    const amanha = somarDias(diaCivil(c.fuso, new Date()), 1);

    const agendou = await acoes.agendarMensagemAction({
      id,
      conversationId: par.conversa,
      texto: "  Confirmando sua consulta de amanhã  ",
      data: amanha,
      hora: "09:00",
    });
    expect(agendou).toMatchObject({ ok: true });
    const { data: linha } = await admin
      .from("mensagem_agendada")
      .select("contact_id, whatsapp_account_id, criada_por, situacao, texto")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(linha).toMatchObject({
      contact_id: par.contato,
      whatsapp_account_id: c.numero.id,
      criada_por: uid("recepcao"),
      situacao: "agendada",
    });

    // O mesmo id de novo (duplo clique, reenvio): ok, sem segunda linha.
    const repetido = await acoes.agendarMensagemAction({
      id,
      conversationId: par.conversa,
      texto: "Confirmando sua consulta de amanhã",
      data: amanha,
      hora: "09:00",
    });
    expect(repetido).toMatchObject({ ok: true });
    const { count } = await admin
      .from("mensagem_agendada")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", par.contato)
      .throwOnError();
    expect(count).toBe(1);

    const editou = await acoes.editarAgendadaAction({
      id,
      texto: "Confirmando sua consulta de amanhã às 10h",
      data: amanha,
      hora: "10:00",
    });
    expect(editou).toEqual({ ok: true });
    expect((await agendadaNoBanco(id)).texto).toBe(
      "Confirmando sua consulta de amanhã às 10h",
    );

    const excluiu = await acoes.excluirAgendadaAction({ id });
    expect(excluiu).toEqual({ ok: true });
    expect((await agendadaNoBanco(id)).situacao).toBe("cancelada");

    expect(await trilha(id)).toEqual(
      expect.arrayContaining([
        "agendou_mensagem",
        "editou_mensagem_agendada",
        "excluiu_mensagem_agendada",
      ]),
    );
  });

  it("Enviar agora retira e envia pelo 1:1 em nome de quem está com a conversa; na fila para sair, recusa", async () => {
    const c = await clinica("acoes-agora");
    entrarNa(c);
    const par = await parComConversa(c);
    // A colega agendou; a recepcao esta com a conversa (A1).
    await admin
      .from("conversation")
      .update({ assignee_user_id: uid("colega") })
      .eq("id", par.conversa)
      .throwOnError();
    const daColega = await agendar(c, par, {
      apelido: "colega",
      texto: "Sai agora, por favor",
      enviarEm: new Date(Date.now() + 3 * HORA),
    });
    await admin
      .from("conversation")
      .update({ assignee_user_id: uid("recepcao") })
      .eq("id", par.conversa)
      .throwOnError();

    resetFakeProvider();
    const resultado = await acoes.enviarAgendadaAgoraAction({ id: daColega });
    expect(resultado).toMatchObject({ ok: true, conversationId: par.conversa });
    expect(await agendadaNoBanco(daColega)).toMatchObject({
      situacao: "cancelada",
      motivo: "enviada_agora",
      texto: null,
    });
    const [mensagem] = await mensagensDoContato(par.contato);
    expect(mensagem).toMatchObject({
      author: "usuario",
      author_user_id: uid("recepcao"),
      body: "Sai agora, por favor",
      job_id: null,
      cost_cents: 0,
      billable: false,
    });
    expect(enviadasNa(c.clinicId)).toHaveLength(1);
    // A RPC registra a retirada; a acao, o envio que saiu.
    expect(await trilha(daColega)).toEqual([
      "retirou_agendada_para_enviar_agora",
      "enviou_agora_mensagem_agendada",
    ]);

    // Na fila para sair: a planejadora ja pegou.
    const naFila = await agendar(c, par, { texto: "Já saindo" });
    await vencer(naFila);
    await planejar(c.clinicId);
    const recusa = await acoes.enviarAgendadaAgoraAction({ id: naFila });
    expect(recusa).toMatchObject({
      ok: false,
      error: "Esta mensagem já está na fila para sair.",
    });
    expect((await agendadaNoBanco(naFila)).situacao).toBe("enviando");
  });

  it("dispensar a que não saiu", async () => {
    const c = await clinica("acoes-dispensa");
    entrarNa(c);
    const par = await parComConversa(c);
    const agendadaId = await agendar(c, par, { texto: "Não saiu" });
    await admin.rpc("encerrar_agendada_sem_envio", {
      p_agendada_id: agendadaId,
      p_situacao: "nao_enviada",
      p_motivo: "canal_ocupado",
    });
    const resultado = await acoes.dispensarAgendadaAction({ id: agendadaId });
    expect(resultado).toEqual({ ok: true });
    expect(await agendadaNoBanco(agendadaId)).toMatchObject({
      dispensada_por: uid("recepcao"),
      texto: null,
    });
    expect(await trilha(agendadaId)).toContain("dispensou_mensagem_agendada");
  });
});
