import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Remarcar e cancelar pela IA (AG4, parte de banco: migration
// 20261028100000_remarcar_e_cancelar_pela_ia.sql), pela API com JWT real de
// cada papel. O que esta em jogo:
// - ai_agent_config.cancelar_antecedencia_horas e
//   remarcar_antecedencia_horas, com a permissao por coluna de skills e dos
//   exige_*: todo membro ativo da clinica le; administrador e gestor gravam
//   no rascunho (0 a 720); recepcao, profissional, leitura e a outra clinica
//   nao (zero linhas); anon nao le (42501); a versao publicada nao muda pela
//   sessao; o rascunho copia os dois da ultima publicada;
// - appointment.remarcacao_de: a sessao le (o cartao da Agenda, com a antiga
//   embutida pela FK), a outra clinica nao; nenhuma sessao grava o elo
//   (42501, o gatilho exigir_remarcacao_da_ia), nem ao criar nem ao mudar;
// - appointment_status_history.ia_job_id: a sessao nunca grava (o CHECK com
//   o proprio usuario, 23514; a policy com autor ia, 42501); a sessao le a
//   trilha da propria clinica;
// - mover (horario ou profissional; [revisao da AG4] tambem so o fim ou so
//   a unidade) a antiga com a remarcacao pendente: 23514
//   remarcacao_pendente, com a dica, para todo papel que escreve
//   (administrador, gestor, recepcao e o profissional da agenda); o mesmo
//   valor passa; leitura e a outra clinica nao alcancam a linha (zero
//   linhas); a antiga fica onde estava; sem remarcacao pendente, muda;
// - cancelar_consulta_pela_ia, e o reservar e o agendar com p_remarcar:
//   42501 para toda sessao e para anon; o servidor chama (resposta de
//   negocio); o job de uma clinica com a outra clinica: 22023;
// - ler_dados_informados_na_marcacao com p_campo: so aquele dado volta, e a
//   trilha revelou_dado_da_marcacao diz o campo (quem e qual consulta, nunca
//   o valor); o profissional so na propria agenda; leitura, a B e anon
//   recebem 42501 e nenhuma trilha nasce; o campo fora da lista e 22023;
// - a aprovacao e a recusa pela sessao (como a Agenda faz): leitura e a B nao
//   aprovam (nada muda); a recepcao aprova e a antiga e cancelada pelo
//   paciente, com a trilha de quem aprovou; a recusa deixa a antiga intacta.
// [revisao curta] O agendar grava antes a linha do turno do job
// (ai_turno.mensagens_lidas), como o motor: o "sim" tem de ser uma mensagem
// que o job leu (senao, mensagem_nova_do_paciente).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// remarcar-ia-rls-*, apagadas no afterAll (consultas, reservas, estado,
// dados informados e trilha vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora), e os usuarios desta execucao
// (depois das clinicas: a trilha segura o usuario ate a clinica sair). A IA
// e liberada so na A, de teste (fora da lista fechada: nao depende do
// interruptor, so atende em numero 'fake' e o motor da IA de producao nunca
// a reivindica; os jobs sao montados direto e nenhum executor roda aqui;
// nenhuma mensagem sai). Nada usa a id da Salud Care, da teste123 nem da
// Conduzza Teste. Telefones ficticios; o CPF e o sintetico 000.000.001-91.
// ESCRITO, AINDA NAO RODADO: grava no banco. Roda depois de aplicar a
// migration, com npm run test:rls -- remarcar-e-cancelar-pela-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro: a trilha delas segura os usuarios).
//   delete from public.clinic
//    where slug like 'remarcar-ia-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u
//    where u.email like 'remarcar-ia-rls-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const VIOLA_CHECK = "23514";
const DADO_INVALIDO = "22023";
const NAO_ENCONTRADA = "P0002";
const FUSO = "America/Fortaleza";
const CPF_SINTETICO = "00000000191";
const DICA_DA_ANTIGA =
  "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `RemarcarIaRls!${sufixo}`;
const COLUNAS_DOS_PRAZOS =
  "id, cancelar_antecedencia_horas, remarcar_antecedencia_horas";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) =>
  `remarcar-ia-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const MEMBROS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
] as const;
const TODAS_AS_SESSOES = [...MEMBROS_ATIVOS_DA_A, "admin-b"] as const;
/** Os papeis da A que escrevem na agenda da Dra. Um. */
const QUEM_MOVE = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
] as const;

type Resposta = {
  ok: boolean;
  motivo?: string;
  appointment_id?: string;
  hold_id?: string;
  remarcacao_de?: string;
  remarcacao_de_starts_at?: string;
  reutilizado?: boolean;
  versao?: number;
};

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let p1 = "";
let p2 = "";
let pb = "";
let l1 = "";
let l2 = "";
let lb = "";
let publicadaA = "";
let rascunhoA = "";
let publicadaB = "";
let conversa1 = "";
let antiga1 = "";
let nova1 = "";
let outraDaA = "";
let consultaComDados = "";
let consultaSemDados = "";
let consultaB = "";
let telefones = 0;

// Daqui a 3 dias (e 4), no fuso da clinica: fora dos prazos (24 e 48 h),
// dentro da antecedencia (2 h) e do horizonte (30 dias).
const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string, mais = 0): string =>
  instanteLocal(FUSO, somarDias(dia, mais), hora).toISOString();
const meiaHoraDepois = (inicio: string): string =>
  new Date(Date.parse(inicio) + 30 * 60_000).toISOString();

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
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

async function criarClinica(nome: string): Promise<string> {
  return inserir("clinic", {
    name: `Remarcar IA RLS ${nome} ${sufixo}`,
    slug: `remarcar-ia-rls-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
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

/** Telefone liberado, contato e conversa NA IA pela ingestao (com a janela). */
async function conversaNaIa(): Promise<{ contato: string; conversa: string }> {
  // O numero desta chamada fica guardado antes do primeiro await (a licao
  // da AG3: duas chamadas ao mesmo tempo nao dividem o contador).
  telefones += 1;
  const n = telefones;
  const telefone = `+55847${digitos}${String(n).padStart(2, "0")}`;
  // O contato nasce paciente e o telefone, forcado, ANTES de a conversa
  // existir (o forcado so vale gravado depois do sinal de paciente): a
  // consulta que o caso cria depois nao abre janela para a manutencao do
  // motor (a cada minuto) tirar a conversa de teste da IA
  // (ia_pode_falar_com), o que dava ia_desligada ao acaso.
  await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: telefone,
      name: "Contato sintético",
      kind: "paciente",
    })
    .throwOnError();
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaA,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
  });
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinicaA,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `remarcar-ia-rls:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numeroA,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id! };
}

/** Um job da IA em execucao da conversa (como o claim deixaria). */
async function jobEmExecucao(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinicaA,
    kind: "responder_com_ia",
    whatsapp_account_id: numeroA,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `remarcar-ia-rls-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

/**
 * [revisao curta] O job leu a conversa, como o motor antes de chamar o
 * modelo: as mensagens do paciente (nao apagadas) vao para
 * ai_turno.mensagens_lidas da linha do turno do job. Devolve o job.
 */
async function leu(jobId: string, conversa: string): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("conversation_id", conversa)
    .eq("direction", "entrada")
    .eq("author", "paciente")
    .is("deleted_at", null)
    .order("created_at")
    .throwOnError();
  await admin
    .from("ai_turno")
    .upsert(
      {
        job_id: jobId,
        clinic_id: clinicaA,
        conversation_id: conversa,
        estado: "reservado",
        mensagens_lidas: (data as { id: string }[]).map((m) => m.id),
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
  return jobId;
}

/** A pergunta da IA e a resposta do paciente depois dela. */
async function perguntaEConfirmacao(conversa: string): Promise<void> {
  for (const [direction, author, body] of [
    ["saida", "ia", "Pergunta sintética da IA"],
    ["entrada", "paciente", "Mensagem sintética de confirmação"],
  ] as const) {
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaA,
        conversation_id: conversa,
        direction,
        author,
        content_type: "texto",
        body,
      })
      .throwOnError();
  }
}

/** Arma o pedido (cancelar ou remarcar) com o foco na consulta. */
async function armar(
  conversa: string,
  pedido: "cancelar" | "remarcar",
  consulta: string,
): Promise<void> {
  const { data: linha } = await admin
    .from("ia_atendimento")
    .select("versao")
    .eq("conversation_id", conversa)
    .maybeSingle()
    .throwOnError();
  const gravado = await rpcOk<Resposta>("gravar_atendimento_da_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: conversa,
    p_job_id: await jobEmExecucao(conversa),
    p_versao: (linha as { versao: number } | null)?.versao ?? 0,
    p_estado: {
      etapa: pedido,
      intencao: pedido,
      procedure_id: null,
      professional_id: null,
      insurance_id: null,
      particular: null,
      unit_id: null,
      horarios_oferecidos: [],
      slot_hold_id: null,
      appointment_id: consulta,
      pedido_pendente: pedido,
      pedido_pendente_em: null,
      falhas_seguidas: 0,
      desfecho: null,
    },
  });
  expect(gravado, "armar o pedido").toMatchObject({ ok: true });
}

async function trilhas(acao: string, entidade: string): Promise<number> {
  const { count } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicaA)
    .eq("action", acao)
    .eq("entity_id", entidade)
    .throwOnError();
  return count ?? 0;
}

async function inicioDe(consulta: string): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .select("starts_at")
    .eq("id", consulta)
    .single()
    .throwOnError();
  return (data as { starts_at: string }).starts_at;
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "remarcar-ia-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" }))
    .id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaA,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de RLS da AG4",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaA,
    p_whatsapp_account_id: numeroA,
    p_ativo: true,
  });

  p1 = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });
  p2 = await inserir("professional", { clinic_id: clinicaA, name: "Dr. Dois" });
  pb = await inserir("professional", { clinic_id: clinicaB, name: "Dra. B" });
  const procedimentoA = await inserir("procedure", {
    clinic_id: clinicaA,
    name: "Consulta A",
    default_duration_min: 30,
  });
  const procedimentoB = await inserir("procedure", {
    clinic_id: clinicaB,
    name: "Consulta B",
    default_duration_min: 30,
  });
  l1 = await inserir("service_link", {
    clinic_id: clinicaA,
    professional_id: p1,
    procedure_id: procedimentoA,
    duration_min: 30,
    price_cents: 20000,
  });
  l2 = await inserir("service_link", {
    clinic_id: clinicaA,
    professional_id: p2,
    procedure_id: procedimentoA,
    duration_min: 30,
    price_cents: 20000,
  });
  lb = await inserir("service_link", {
    clinic_id: clinicaB,
    professional_id: pb,
    procedure_id: procedimentoB,
    duration_min: 30,
    price_cents: 20000,
  });
  await admin
    .from("professional_schedule")
    .insert(
      [p1, p2].flatMap((profissional) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          clinic_id: clinicaA,
          professional_id: profissional,
          weekday,
          starts_at: "07:00",
          ends_at: "20:00",
        })),
      ),
    )
    .throwOnError();

  // A versao publicada da A: Agendar, Cancelar e Remarcar, prazos de 24 e
  // 48 horas. A da B: prazos de 12 horas (a B le os dela, nunca os da A).
  publicadaA = await inserir("ai_agent_config", {
    clinic_id: clinicaA,
    version: 1,
    status: "publicada",
    skills: { agendar: true, cancelar: true, remarcar: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
    cancelar_antecedencia_horas: 24,
    remarcar_antecedencia_horas: 48,
  });
  publicadaB = await inserir("ai_agent_config", {
    clinic_id: clinicaB,
    version: 1,
    status: "publicada",
    cancelar_antecedencia_horas: 12,
    remarcar_antecedencia_horas: 12,
  });
  rascunhoA = await rpcOk<string>("garantir_rascunho_do_agente", {
    p_clinic_id: clinicaA,
  });

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional", p1);
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("admin-b", clinicaB, "admin");

  // A remarcacao pedida pela IA, pelo caminho de verdade: a antiga (da
  // recepcao, na agenda da Dra. Um), o pedido de remarcar, a reserva com
  // p_remarcar, a pergunta, a confirmacao e o agendar com p_remarcar.
  const c1 = await conversaNaIa();
  conversa1 = c1.conversa;
  antiga1 = await inserir("appointment", {
    clinic_id: clinicaA,
    contact_id: c1.contato,
    professional_id: p1,
    service_link_id: l1,
    starts_at: as("09:00"),
    ends_at: meiaHoraDepois(as("09:00")),
    status: "agendado",
    created_by: "usuario",
  });
  await armar(conversa1, "remarcar", antiga1);
  const reserva = await rpcOk<Resposta>("reservar_horario_da_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: conversa1,
    p_service_link_id: l1,
    p_starts_at: as("15:00", 1),
    p_job_id: await jobEmExecucao(conversa1),
    p_remarcar: antiga1,
  });
  expect(reserva, "a reserva da remarcacao").toMatchObject({ ok: true });
  await perguntaEConfirmacao(conversa1);
  const remarcada = await rpcOk<Resposta>("agendar_pela_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: conversa1,
    p_job_id: await leu(await jobEmExecucao(conversa1), conversa1),
    p_slot_hold_id: reserva.hold_id,
    p_remarcar: antiga1,
  });
  expect(remarcada, "a remarcacao pedida").toMatchObject({
    ok: true,
    remarcacao_de: antiga1,
  });
  nova1 = remarcada.appointment_id!;

  // Outra consulta da A, sem remarcacao (o positivo do mover).
  outraDaA = await inserir("appointment", {
    clinic_id: clinicaA,
    contact_id: c1.contato,
    professional_id: p2,
    service_link_id: l2,
    starts_at: as("11:00"),
    ends_at: meiaHoraDepois(as("11:00")),
    status: "agendado",
    created_by: "usuario",
  });

  // Uma consulta da IA com os dados informados (o CPF e a carteirinha), na
  // agenda do Dr. Dois, e uma sem dados; e a consulta da B.
  const c2 = await conversaNaIa();
  const registro = await rpcOk<Resposta>("registrar_dados_da_marcacao", {
    p_clinic_id: clinicaA,
    p_conversation_id: c2.conversa,
    p_job_id: crypto.randomUUID(),
    p_para_o_titular: true,
    p_nome_completo: "Paciente Dois Sintético",
    p_data_nascimento: "1985-02-02",
    p_cpf: CPF_SINTETICO,
    p_carteirinha: "CART-0001",
  });
  expect(registro, "registrar").toMatchObject({ ok: true });
  const reservaComDados = await rpcOk<Resposta>("reservar_horario_da_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: c2.conversa,
    p_service_link_id: l2,
    p_starts_at: as("10:00"),
    p_job_id: crypto.randomUUID(),
  });
  expect(reservaComDados, "reservar").toMatchObject({ ok: true });
  await perguntaEConfirmacao(c2.conversa);
  const marcada = await rpcOk<Resposta>("agendar_pela_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: c2.conversa,
    p_job_id: await leu(crypto.randomUUID(), c2.conversa),
  });
  expect(marcada, "agendar").toMatchObject({ ok: true });
  consultaComDados = marcada.appointment_id!;
  consultaSemDados = await inserir("appointment", {
    clinic_id: clinicaA,
    contact_id: c2.contato,
    professional_id: p2,
    service_link_id: l2,
    starts_at: as("12:00"),
    ends_at: meiaHoraDepois(as("12:00")),
    status: "agendado",
    created_by: "ia",
    approval_status: "pendente",
    send_confirmation: false,
    oferecer_vaga_ao_cancelar: false,
  });
  const contatoB = await inserir("contact", {
    clinic_id: clinicaB,
    phone_e164: `+55846${digitos}01`,
    name: "Contato sintético da B",
  });
  consultaB = await inserir("appointment", {
    clinic_id: clinicaB,
    contact_id: contatoB,
    professional_id: pb,
    service_link_id: lb,
    starts_at: as("09:00"),
    ends_at: meiaHoraDepois(as("09:00")),
    status: "agendado",
    created_by: "usuario",
  });
}, 120_000);

afterAll(async () => {
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `remarcar-ia-rls-%-${sufixo}`);
  expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("ai_agent_config: os prazos para cancelar e remarcar, por papel", () => {
  it("todo membro ativo da A lê os dois prazos; a B não lê os da A; anon não lê", async () => {
    for (const quem of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(quem)
        .from("ai_agent_config")
        .select(COLUNAS_DOS_PRAZOS)
        .eq("id", publicadaA);
      expect(error, quem).toBeNull();
      expect(data, quem).toEqual([
        {
          id: publicadaA,
          cancelar_antecedencia_horas: 24,
          remarcar_antecedencia_horas: 48,
        },
      ]);
    }
    const { data: daB, error: erroDaB } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_DOS_PRAZOS)
      .eq("clinic_id", clinicaA);
    expect(erroDaB).toBeNull();
    expect(daB).toEqual([]);
    const { data: propria } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_DOS_PRAZOS)
      .eq("id", publicadaB);
    expect(propria).toEqual([
      {
        id: publicadaB,
        cancelar_antecedencia_horas: 12,
        remarcar_antecedencia_horas: 12,
      },
    ]);
    const { error: erroAnon } = await anonClient()
      .from("ai_agent_config")
      .select(COLUNAS_DOS_PRAZOS)
      .eq("id", publicadaA);
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
  });

  it("o rascunho copia os prazos da última publicada", async () => {
    const { data } = await admin
      .from("ai_agent_config")
      .select(
        "status, cancelar_antecedencia_horas, remarcar_antecedencia_horas",
      )
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(data).toEqual({
      status: "rascunho",
      cancelar_antecedencia_horas: 24,
      remarcar_antecedencia_horas: 48,
    });
  });

  it("administrador e gestor gravam no rascunho (0 a 720); recepção, profissional, leitura e a B não", async () => {
    const { data: doAdmin, error } = await como("admin-a")
      .from("ai_agent_config")
      .update({ cancelar_antecedencia_horas: 0 })
      .eq("id", rascunhoA)
      .select(COLUNAS_DOS_PRAZOS);
    expect(error).toBeNull();
    expect(doAdmin).toEqual([
      {
        id: rascunhoA,
        cancelar_antecedencia_horas: 0,
        remarcar_antecedencia_horas: 48,
      },
    ]);
    const { data: doGestor } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ remarcar_antecedencia_horas: 720 })
      .eq("id", rascunhoA)
      .select(COLUNAS_DOS_PRAZOS);
    expect(doGestor).toEqual([
      {
        id: rascunhoA,
        cancelar_antecedencia_horas: 0,
        remarcar_antecedencia_horas: 720,
      },
    ]);
    for (const quem of [
      "recepcao-a",
      "profissional-a",
      "leitura-a",
      "admin-b",
    ] as const) {
      const { data, error: erro } = await como(quem)
        .from("ai_agent_config")
        .update({ cancelar_antecedencia_horas: 6 })
        .eq("id", rascunhoA)
        .select("id");
      if (erro) {
        expect(erro.code, quem).toBe(PERMISSAO_NEGADA);
      } else {
        expect(data, quem).toEqual([]);
      }
    }
    for (const valor of [721, -1]) {
      const { error: foraDaFaixa } = await como("admin-a")
        .from("ai_agent_config")
        .update({ cancelar_antecedencia_horas: valor })
        .eq("id", rascunhoA)
        .select("id");
      expect(foraDaFaixa?.code, String(valor)).toBe(VIOLA_CHECK);
    }
    const { data: depois } = await admin
      .from("ai_agent_config")
      .select("cancelar_antecedencia_horas, remarcar_antecedencia_horas")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      cancelar_antecedencia_horas: 0,
      remarcar_antecedencia_horas: 720,
    });
  });

  it("a versão publicada não muda pela sessão, nem nos prazos", async () => {
    const { data, error } = await como("admin-a")
      .from("ai_agent_config")
      .update({ cancelar_antecedencia_horas: 1 })
      .eq("id", publicadaA)
      .select("id");
    if (error) {
      expect(error.code).toBe(PERMISSAO_NEGADA);
    } else {
      expect(data).toEqual([]);
    }
    const { data: publicada } = await admin
      .from("ai_agent_config")
      .select("cancelar_antecedencia_horas")
      .eq("id", publicadaA)
      .single()
      .throwOnError();
    expect(publicada).toEqual({ cancelar_antecedencia_horas: 24 });
  });
});

describe("o elo da remarcação: a sessão lê, nunca grava", () => {
  it("a A lê o elo e a antiga embutida pela coluna; o profissional, na própria agenda; a B não vê", async () => {
    // A forma das telas (lib/queries/agenda.ts) e do reply_to das mensagens
    // (lib/queries/conversations.ts, conferida contra o banco em 02/09): o
    // alvo e a COLUNA da chave, que so casa com a ponta muitos-para-um. Com
    // "appointment!remarcacao_de" a dica tambem casa com a outra ponta da
    // tabela que aponta para si (a coluna referenciada), e o PostgREST pode
    // responder PGRST201 (ambiguo).
    for (const quem of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(quem)
        .from("appointment")
        .select(
          "id, remarcacao_de, approval_status, antiga:remarcacao_de(id, starts_at, status)",
        )
        .eq("id", nova1);
      expect(error, quem).toBeNull();
      expect(data, quem).toEqual([
        {
          id: nova1,
          remarcacao_de: antiga1,
          approval_status: "pendente",
          antiga: {
            id: antiga1,
            starts_at: expect.any(String),
            status: "agendado",
          },
        },
      ]);
    }
    const { data: daB } = await como("admin-b")
      .from("appointment")
      .select("id, remarcacao_de")
      .eq("id", nova1);
    expect(daB).toEqual([]);
  });

  it("nenhuma sessão cria consulta com o elo nem liga uma consulta à outra (42501)", async () => {
    for (const quem of QUEM_MOVE) {
      const { error: aoCriar } = await como(quem)
        .from("appointment")
        .insert({
          clinic_id: clinicaA,
          contact_id: (
            await admin
              .from("appointment")
              .select("contact_id")
              .eq("id", antiga1)
              .single()
              .throwOnError()
          ).data!.contact_id,
          professional_id: p1,
          service_link_id: l1,
          starts_at: as("16:00", 2),
          ends_at: meiaHoraDepois(as("16:00", 2)),
          status: "agendado",
          created_by: "usuario",
          remarcacao_de: antiga1,
        })
        .select("id");
      expect(aoCriar?.code, quem).toBe(PERMISSAO_NEGADA);
      const { error: aoLigar } = await como(quem)
        .from("appointment")
        .update({ remarcacao_de: antiga1 })
        .eq("id", outraDaA)
        .select("id");
      if (quem === "profissional-a") {
        // A outra consulta e da agenda do Dr. Dois: a RLS esconde a linha.
        expect(aoLigar?.code ?? null, quem).toBeNull();
      } else {
        expect(aoLigar?.code, quem).toBe(PERMISSAO_NEGADA);
      }
    }
    const { data: elo } = await admin
      .from("appointment")
      .select("remarcacao_de")
      .eq("id", outraDaA)
      .single()
      .throwOnError();
    expect(elo).toEqual({ remarcacao_de: null });
    // Positivo: a sessao mexe em outra coluna da nova (o elo fica).
    const { data: nota, error: erroNota } = await como("recepcao-a")
      .from("appointment")
      .update({ notes: "Nota sintética" })
      .eq("id", nova1)
      .select("remarcacao_de");
    expect(erroNota).toBeNull();
    expect(nota).toEqual([{ remarcacao_de: antiga1 }]);
  });

  it("a sessão nunca grava o job da IA na trilha; lê a trilha da própria clínica", async () => {
    const { error: comoUsuario } = await como("recepcao-a")
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: outraDaA,
        status: "agendado",
        changed_by: "usuario",
        changed_by_user_id: ids.get("recepcao-a"),
        ia_job_id: crypto.randomUUID(),
      });
    expect(comoUsuario?.code).toBe(VIOLA_CHECK);
    const { error: comoIa } = await como("recepcao-a")
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: outraDaA,
        status: "agendado",
        changed_by: "ia",
        ia_job_id: crypto.randomUUID(),
      });
    expect(comoIa?.code).toBe(PERMISSAO_NEGADA);
    // Positivo: a trilha de sempre (sem o job) entra pela sessao.
    const { error: daSessao } = await como("recepcao-a")
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: outraDaA,
        status: "agendado",
        changed_by: "usuario",
        changed_by_user_id: ids.get("recepcao-a"),
      });
    expect(daSessao).toBeNull();
    // A linha de evento da remarcacao (autor ia) na antiga: a A le, a B nao.
    const { data: eventos } = await como("recepcao-a")
      .from("appointment_status_history")
      .select("event, changed_by, ia_job_id")
      .eq("appointment_id", antiga1)
      .not("event", "is", null);
    expect(eventos).toEqual([
      { event: "remarcacao_pedida", changed_by: "ia", ia_job_id: null },
    ]);
    const { data: daB } = await como("admin-b")
      .from("appointment_status_history")
      .select("id")
      .eq("appointment_id", antiga1);
    expect(daB).toEqual([]);
  });
});

describe("a antiga com a remarcação pendente não se move (D-32)", () => {
  it("23514 remarcacao_pendente, com a dica, para todo papel que escreve; leitura e a B não alcançam", async () => {
    const inicio = await inicioDe(antiga1);
    for (const quem of QUEM_MOVE) {
      const { data, error } = await como(quem)
        .from("appointment")
        .update({
          starts_at: as("13:00"),
          ends_at: meiaHoraDepois(as("13:00")),
        })
        .eq("id", antiga1)
        .select("id");
      expect(data, quem).toBeNull();
      expect(error?.code, quem).toBe(VIOLA_CHECK);
      expect(error?.message, quem).toBe("remarcacao_pendente");
      expect(error?.hint, quem).toBe(DICA_DA_ANTIGA);
    }
    const { error: profissional } = await como("admin-a")
      .from("appointment")
      .update({ professional_id: p2, service_link_id: l2 })
      .eq("id", antiga1)
      .select("id");
    expect(profissional?.code).toBe(VIOLA_CHECK);
    for (const quem of ["leitura-a", "admin-b"] as const) {
      const { data, error } = await como(quem)
        .from("appointment")
        .update({
          starts_at: as("13:00"),
          ends_at: meiaHoraDepois(as("13:00")),
        })
        .eq("id", antiga1)
        .select("id");
      if (error) {
        expect(error.code, quem).toBe(PERMISSAO_NEGADA);
      } else {
        expect(data, quem).toEqual([]);
      }
    }
    expect(await inicioDe(antiga1)).toBe(inicio);
    // Positivo: a consulta sem remarcacao pendente se move.
    const { data: movida, error: erroMovida } = await como("recepcao-a")
      .from("appointment")
      .update({
        starts_at: as("11:30"),
        ends_at: meiaHoraDepois(as("11:30")),
      })
      .eq("id", outraDaA)
      .select("id");
    expect(erroMovida).toBeNull();
    expect(movida).toEqual([{ id: outraDaA }]);
  });

  it("só o fim ou só a unidade da antiga também não mudam, para todo papel que escreve; o mesmo valor passa; sem remarcação pendente, mudam", async () => {
    const sede = await inserir("unit", {
      clinic_id: clinicaA,
      name: "Sede sintética",
    });
    const fimDaAntiga = meiaHoraDepois(as("09:00"));
    for (const quem of QUEM_MOVE) {
      for (const [rotulo, mudanca] of [
        [
          "so o fim",
          {
            ends_at: new Date(
              Date.parse(as("09:00")) + 45 * 60_000,
            ).toISOString(),
          },
        ],
        ["so a unidade", { unit_id: sede }],
      ] as const) {
        const { data, error } = await como(quem)
          .from("appointment")
          .update(mudanca)
          .eq("id", antiga1)
          .select("id");
        expect(data, `${quem}, ${rotulo}`).toBeNull();
        expect(error?.code, `${quem}, ${rotulo}`).toBe(VIOLA_CHECK);
        expect(error?.message, `${quem}, ${rotulo}`).toBe(
          "remarcacao_pendente",
        );
        expect(error?.hint, `${quem}, ${rotulo}`).toBe(DICA_DA_ANTIGA);
      }
    }
    // O mesmo fim e a mesma unidade (nenhuma) passam.
    const { data: igual, error: erroIgual } = await como("recepcao-a")
      .from("appointment")
      .update({ ends_at: fimDaAntiga, unit_id: null })
      .eq("id", antiga1)
      .select("id");
    expect(erroIgual).toBeNull();
    expect(igual).toEqual([{ id: antiga1 }]);
    const { data: ficou } = await admin
      .from("appointment")
      .select("ends_at, unit_id")
      .eq("id", antiga1)
      .single()
      .throwOnError();
    const antiga = ficou as { ends_at: string; unit_id: string | null };
    expect(Date.parse(antiga.ends_at)).toBe(Date.parse(fimDaAntiga));
    expect(antiga.unit_id).toBeNull();
    // Positivo: sem remarcacao pendente, o fim (mais curto, sem bater na
    // consulta das 12:00 do Dr. Dois) e a unidade mudam.
    const { data: mudou, error: erroMudou } = await como("recepcao-a")
      .from("appointment")
      .update({
        ends_at: new Date(Date.parse(as("11:30")) + 15 * 60_000).toISOString(),
        unit_id: sede,
      })
      .eq("id", outraDaA)
      .select("id, unit_id");
    expect(erroMudou).toBeNull();
    expect(mudou).toEqual([{ id: outraDaA, unit_id: sede }]);
  });
});

describe("as RPCs da IA: só o servidor", () => {
  it("cancelar_consulta_pela_ia: 42501 para toda sessão e anon; o servidor recebe resposta de negócio", async () => {
    // Uma conversa nova (a manutencao de producao devolve a conversa de
    // teste que espera resposta ha mais de 3 minutos).
    const { conversa } = await conversaNaIa();
    const job = await jobEmExecucao(conversa);
    const args = {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_job_id: job,
      p_appointment_id: antiga1,
    };
    for (const quem of TODAS_AS_SESSOES) {
      const { error } = await como(quem).rpc("cancelar_consulta_pela_ia", args);
      expect(error?.code, quem).toBe(PERMISSAO_NEGADA);
    }
    const { error: erroAnon } = await anonClient().rpc(
      "cancelar_consulta_pela_ia",
      args,
    );
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
    // O servidor: a conversa nao tem pedido de cancelar armado, entao a
    // resposta e de negocio.
    const resposta = await rpcOk<Resposta>("cancelar_consulta_pela_ia", args);
    expect(resposta).toEqual({
      ok: false,
      motivo: "sem_pedido_de_cancelamento",
    });
    // O job da A com a clinica B: 22023 (erro de quem chama).
    const { error: daB } = await admin.rpc("cancelar_consulta_pela_ia", {
      ...args,
      p_clinic_id: clinicaB,
    });
    expect(daB?.code).toBe(DADO_INVALIDO);
  });

  it("o reservar e o agendar com p_remarcar: 42501 para toda sessão e anon", async () => {
    for (const cliente of [
      ...TODAS_AS_SESSOES.map((quem) => [quem, como(quem)] as const),
      ["anon", anonClient()] as const,
    ]) {
      const [quem, c] = cliente;
      const { error: reservar } = await c.rpc("reservar_horario_da_ia", {
        p_clinic_id: clinicaA,
        p_conversation_id: conversa1,
        p_service_link_id: l1,
        p_starts_at: as("17:00", 1),
        p_job_id: crypto.randomUUID(),
        p_remarcar: antiga1,
      });
      expect(reservar?.code, quem).toBe(PERMISSAO_NEGADA);
      const { error: agendar } = await c.rpc("agendar_pela_ia", {
        p_clinic_id: clinicaA,
        p_conversation_id: conversa1,
        p_job_id: crypto.randomUUID(),
        p_remarcar: antiga1,
      });
      expect(agendar?.code, quem).toBe(PERMISSAO_NEGADA);
    }
  });
});

describe("ler_dados_informados_na_marcacao com o campo (a revelação)", () => {
  it("só o dado pedido volta, e a trilha diz o campo; sem dado, nulo e sem trilha", async () => {
    const { data: cpf, error } = await como("admin-a").rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaA,
        p_appointment_id: consultaComDados,
        p_campo: "cpf",
      },
    );
    expect(error).toBeNull();
    expect(cpf).toEqual({ dados: { cpf: CPF_SINTETICO } });
    const { data: carteirinha } = await como("recepcao-a").rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaA,
        p_appointment_id: consultaComDados,
        p_campo: "carteirinha",
      },
    );
    expect(carteirinha).toEqual({ dados: { carteirinha: "CART-0001" } });
    const { data: linhas } = await admin
      .from("audit_log")
      .select("user_id, entity, detalhes")
      .eq("clinic_id", clinicaA)
      .eq("action", "revelou_dado_da_marcacao")
      .eq("entity_id", consultaComDados)
      .order("created_at")
      .throwOnError();
    expect(linhas).toEqual([
      {
        user_id: ids.get("admin-a"),
        entity: "appointment",
        detalhes: { campo: "cpf" },
      },
      {
        user_id: ids.get("recepcao-a"),
        entity: "appointment",
        detalhes: { campo: "carteirinha" },
      },
    ]);
    const { data: semDados } = await como("admin-a").rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaA,
        p_appointment_id: consultaSemDados,
        p_campo: "cpf",
      },
    );
    expect(semDados).toEqual({ dados: null });
    expect(await trilhas("revelou_dado_da_marcacao", consultaSemDados)).toBe(0);
  });

  it("o campo fora da lista é 22023; quem não aprova recebe 42501 e nenhuma trilha nasce", async () => {
    const antes = await trilhas("revelou_dado_da_marcacao", consultaComDados);
    const { error: campo } = await como("admin-a").rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaA,
        p_appointment_id: consultaComDados,
        p_campo: "nome_completo",
      },
    );
    expect(campo?.code).toBe(DADO_INVALIDO);
    for (const quem of ["leitura-a", "profissional-a", "admin-b"] as const) {
      const { error } = await como(quem).rpc(
        "ler_dados_informados_na_marcacao",
        {
          p_clinic_id: clinicaA,
          p_appointment_id: consultaComDados,
          p_campo: "cpf",
        },
      );
      // O profissional-a e da agenda da Dra. Um; a consulta e do Dr. Dois.
      expect(error?.code, quem).toBe(PERMISSAO_NEGADA);
    }
    const { error: comAB } = await como("admin-b").rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaB,
        p_appointment_id: consultaComDados,
        p_campo: "cpf",
      },
    );
    expect(comAB?.code).toBe(NAO_ENCONTRADA);
    const { error: anon } = await anonClient().rpc(
      "ler_dados_informados_na_marcacao",
      {
        p_clinic_id: clinicaA,
        p_appointment_id: consultaComDados,
        p_campo: "cpf",
      },
    );
    expect(anon?.code).toBe(PERMISSAO_NEGADA);
    expect(await trilhas("revelou_dado_da_marcacao", consultaComDados)).toBe(
      antes,
    );
    // Positivo: a B le a consulta dela (sem dado: nulo).
    const { data: daB } = await como("admin-b").rpc(
      "ler_dados_informados_na_marcacao",
      { p_clinic_id: clinicaB, p_appointment_id: consultaB, p_campo: "cpf" },
    );
    expect(daB).toEqual({ dados: null });
  });
});

describe("a aprovação e a recusa da remarcação pela sessão (como a Agenda)", () => {
  it("leitura e a B não aprovam; a recepção aprova e a antiga é cancelada pelo paciente, com a trilha de quem aprovou", async () => {
    for (const quem of ["leitura-a", "admin-b"] as const) {
      const { data, error } = await como(quem)
        .from("appointment")
        .update({ approval_status: "aprovado" })
        .eq("id", nova1)
        .eq("approval_status", "pendente")
        .select("id");
      if (error) {
        expect(error.code, quem).toBe(PERMISSAO_NEGADA);
      } else {
        expect(data, quem).toEqual([]);
      }
    }
    const { data: antes } = await admin
      .from("appointment")
      .select("status, remarcacao_pedida_em")
      .eq("id", antiga1)
      .single()
      .throwOnError();
    expect(antes!.status).toBe("agendado");
    expect(antes!.remarcacao_pedida_em).not.toBeNull();

    const { data, error } = await como("recepcao-a")
      .from("appointment")
      .update({
        approval_status: "aprovado",
        send_confirmation: true,
        oferecer_vaga_ao_cancelar: true,
      })
      .eq("id", nova1)
      .eq("approval_status", "pendente")
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: nova1 }]);
    const { data: depois } = await admin
      .from("appointment")
      .select("status, remarcacao_pedida_em")
      .eq("id", antiga1)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      status: "cancelado_paciente",
      remarcacao_pedida_em: null,
    });
    const { data: trilha } = await admin
      .from("appointment_status_history")
      .select("status, changed_by, changed_by_user_id")
      .eq("appointment_id", antiga1)
      .eq("status", "cancelado_paciente")
      .throwOnError();
    expect(trilha).toEqual([
      {
        status: "cancelado_paciente",
        changed_by: "usuario",
        changed_by_user_id: ids.get("recepcao-a"),
      },
    ]);
  });

  it("a recusa de outra remarcação deixa a antiga intacta e devolve a conversa com o texto dela", async () => {
    // Uma remarcacao nova, numa conversa nova (a manutencao de producao
    // devolve a conversa de teste parada ha mais de 3 minutos).
    const c3 = await conversaNaIa();
    const antiga3 = await inserir("appointment", {
      clinic_id: clinicaA,
      contact_id: c3.contato,
      professional_id: p2,
      service_link_id: l2,
      starts_at: as("14:00"),
      ends_at: meiaHoraDepois(as("14:00")),
      status: "agendado",
      created_by: "usuario",
    });
    await armar(c3.conversa, "remarcar", antiga3);
    const reserva = await rpcOk<Resposta>("reservar_horario_da_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: c3.conversa,
      p_service_link_id: l2,
      p_starts_at: as("16:00", 1),
      p_job_id: await jobEmExecucao(c3.conversa),
      p_remarcar: antiga3,
    });
    expect(reserva).toMatchObject({ ok: true });
    await perguntaEConfirmacao(c3.conversa);
    const remarcada = await rpcOk<Resposta>("agendar_pela_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: c3.conversa,
      p_job_id: await leu(await jobEmExecucao(c3.conversa), c3.conversa),
      p_slot_hold_id: reserva.hold_id,
      p_remarcar: antiga3,
    });
    expect(remarcada).toMatchObject({ ok: true, remarcacao_de: antiga3 });
    const { data, error } = await como("admin-a")
      .from("appointment")
      .update({
        approval_status: "recusado",
        status: "cancelado_clinica",
        oferecer_vaga_ao_cancelar: false,
      })
      .eq("id", remarcada.appointment_id!)
      .eq("approval_status", "pendente")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const { data: devolveu, error: erroDevolver } = await como("admin-a").rpc(
      "devolver_conversa_da_consulta_recusada",
      { p_clinic_id: clinicaA, p_appointment_id: remarcada.appointment_id },
    );
    expect(erroDevolver).toBeNull();
    expect(devolveu).toBe(true);
    const { data: antiga } = await admin
      .from("appointment")
      .select("status, remarcacao_pedida_em")
      .eq("id", antiga3)
      .single()
      .throwOnError();
    expect(antiga!.status).toBe("agendado");
    expect(antiga!.remarcacao_pedida_em).not.toBeNull();
    const { data: eventos } = await admin
      .from("message")
      .select("body")
      .eq("conversation_id", c3.conversa)
      .like("body", "A equipe recusou%")
      .throwOnError();
    expect(eventos).toHaveLength(1);
    expect((eventos![0] as { body: string }).body).toMatch(
      /^A equipe recusou a remarcação pedida pela IA\. A consulta de \d{2}\/\d{2} às \d{2}:\d{2} continua marcada\. Avise o paciente\.$/,
    );
  });
});
