import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Agendamento completo pela IA (AG3, parte de banco: migration
// 20261027120000_agendamento_completo_da_ia.sql), pela API com JWT real de
// cada papel. Pedido do dono de 26/10/2026: a IA faz todo o agendamento; o
// banco guarda o estado do atendimento entre os turnos, os dados que o
// paciente informa para marcar e a unidade da reserva. O que esta em jogo:
// - ai_agent_config.exige_nome_completo, exige_nascimento e exige_cpf, com a
//   permissao por coluna de skills: todo membro ativo da clinica le;
//   administrador e gestor gravam no rascunho; recepcao, profissional,
//   leitura e a outra clinica nao (zero linhas); anon nao le (42501); a
//   versao publicada nao muda pela sessao; o rascunho copia as tres da
//   ultima publicada (na B, falso, falso e verdadeiro, o contrario do
//   padrao);
// - ia_atendimento e dados_informados_na_marcacao: RLS ligada e sem grant
//   para authenticated e anon: nenhuma sessao le nem grava, nem a da propria
//   clinica (42501); a service role le (contraprova);
// - registrar_dados_da_marcacao, ler_atendimento_da_ia,
//   gravar_atendimento_da_ia, o reservar com a unidade e o agendar com a
//   reserva (p_slot_hold_id, da revisao final; os dois com DROP e CREATE:
//   os grants de antes voltaram): 42501 para toda sessao e para anon; o
//   servidor chama (resposta de negocio, nunca erro de permissao);
// - ler_dados_informados_na_marcacao, a unica leitura humana dos dados:
//   administrador, gestor e recepcao da A leem, e cada leitura grava a
//   trilha leu_dados_da_marcacao (quem e qual consulta, SEM o conteudo); o
//   profissional so na propria agenda; leitura, a B e anon recebem 42501 e
//   nenhuma trilha nasce; a B com o id da clinica dela recebe P0002; a
//   consulta sem dado devolve dados nulo, sem trilha;
// - slot_hold.unit_id: a sessao nao cria reserva com a unidade da B (23503,
//   o gatilho novo); com a da A, cria; a A le a unidade da reserva da IA e a
//   B nao ve a reserva;
// - a aprovacao pela sessao (como a Agenda faz) aplica os dados ao cadastro
//   do contato, so nos campos vazios: o nome do WhatsApp troca, o
//   nascimento que o cadastro ja tinha fica, o CPF vazio entra; a trilha
//   aplicou_dados_da_marcacao guarda quem aprovou e os NOMES dos campos,
//   nunca o valor; leitura e a B nao aprovam (nada aplicado); recusar nao
//   aplica nada; o gestor aprova a outra (contraprova).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// agendamento-ia-rls-*, apagadas no afterAll (prazo de 60 s; reservas,
// consultas, dados informados, estado e trilha vao em cascata; o beforeAll
// apaga a sobra de uma execucao que morreu ha mais de uma hora), e os
// usuarios desta execucao (depois das clinicas: a trilha segura o usuario
// ate a clinica sair). A IA e liberada so na A, de teste (fora da lista
// fechada: nao depende do interruptor, so atende em numero 'fake' e o motor
// da IA de producao nunca a reivindica; nenhum job e enfileirado para
// executar, nenhuma mensagem sai). Nada usa a id da Salud Care, da teste123
// nem da Conduzza Teste. Telefones ficticios; o CPF e o sintetico
// 000.000.001-91 (so digitos, verificador valido). ESCRITO, AINDA NAO
// RODADO: grava no banco. Roda depois de aplicar a migration, com
// npm run test:rls -- agendamento-completo-da-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro: a trilha delas segura os usuarios).
//   select id, name from public.clinic
//    where slug like 'agendamento-ia-rls-%' and e_de_teste;
//   delete from public.clinic
//    where slug like 'agendamento-ia-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u
//    where u.email like 'agendamento-ia-rls-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const DE_OUTRA_CLINICA = "23503";
const NAO_ENCONTRADA = "P0002";
const FUSO = "America/Fortaleza";
const CPF_SINTETICO = "00000000191";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `AgendamentoIaRls!${sufixo}`;

const COLUNAS_EXIGE = "id, exige_nome_completo, exige_nascimento, exige_cpf";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) =>
  `agendamento-ia-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const MEMBROS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
] as const;
const TODAS_AS_SESSOES = [...MEMBROS_ATIVOS_DA_A, "admin-b"] as const;

type Resposta = {
  ok: boolean;
  motivo?: string;
  appointment_id?: string;
  hold_id?: string;
  unit_id?: string | null;
  dados_id?: string;
  faltam?: string[];
  versao?: number;
  reutilizado?: boolean;
};

type DadosLidos = {
  dados: {
    nome_completo: string | null;
    data_nascimento: string | null;
    cpf: string | null;
    carteirinha: string | null;
    para_o_titular: boolean;
    informado_em: string;
    atualizado_em: string;
    aplicado_em: string | null;
    aplicado_por: string | null;
  } | null;
};

// O estado vazio do atendimento (ia_estado_do_atendimento de linha nula).
const ESTADO_VAZIO = {
  etapa: "informacao",
  intencao: null,
  procedure_id: null,
  professional_id: null,
  insurance_id: null,
  particular: null,
  unit_id: null,
  horarios_oferecidos: [],
  slot_hold_id: null,
  appointment_id: null,
  pedido_pendente: null,
  pedido_pendente_em: null,
  falhas_seguidas: 0,
  desfecho: null,
};

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let p1 = "";
let p2 = "";
let pb = "";
let procedimentoA = "";
let l1 = "";
let l2 = "";
let lb = "";
let unidadeA = "";
let unidadeB = "";
let publicadaA = "";
let rascunhoA = "";
let publicadaB = "";
let contato1 = "";
let contato2 = "";
let contato3 = "";
let consulta1 = "";
let consulta2 = "";
let consulta3 = "";
let consultaB = "";
let telefones = 0;

// Daqui a 3 dias, no fuso da clinica: dentro da antecedencia (2 h) e do
// horizonte (30 dias). A jornada cobre o dia todo, todos os dias da semana.
const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string): string =>
  instanteLocal(FUSO, dia, hora).toISOString();
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
    name: `Agendamento IA RLS ${nome} ${sufixo}`,
    slug: `agendamento-ia-rls-${nome.toLowerCase()}-${sufixo}`,
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

/**
 * Telefone liberado, contato e conversa NA IA pela ingestao (com a janela
 * aberta, como o webhook faz). Cada bloco que usa a conversa ingere logo
 * antes: a manutencao de producao devolve a conversa de teste que espera
 * resposta ha mais de 3 minutos.
 */
async function conversaNaIa(): Promise<{ contato: string; conversa: string }> {
  telefones += 1;
  const telefone = `+55849${digitos}${String(telefones).padStart(2, "0")}`;
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaA,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinicaA,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `agendamento-ia-rls:${sufixo}:${telefones}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numeroA,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id! };
}

/** A pergunta da IA depois da reserva e a resposta do paciente depois dela. */
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

/** Um job da IA em execucao, montado direto (como o claim deixaria). */
async function jobEmExecucao(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinicaA,
    kind: "responder_com_ia",
    whatsapp_account_id: numeroA,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `agendamento-ia-rls-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

/** A IA marca pelo caminho de verdade: os dados, a reserva, a confirmacao e o agendar. */
async function marcarPelaIa(params: {
  conversa: string;
  vinculo: string;
  hora: string;
  unidade: string | null;
  nome: string;
  nascimento: string;
  cpf: string | null;
}): Promise<string> {
  const registro = await rpcOk<Resposta>("registrar_dados_da_marcacao", {
    p_clinic_id: clinicaA,
    p_conversation_id: params.conversa,
    p_job_id: crypto.randomUUID(),
    p_para_o_titular: true,
    p_nome_completo: params.nome,
    p_data_nascimento: params.nascimento,
    p_cpf: params.cpf,
  });
  expect(registro, "registrar").toMatchObject({ ok: true, faltam: [] });
  const reserva = await rpcOk<Resposta>("reservar_horario_da_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: params.conversa,
    p_service_link_id: params.vinculo,
    p_starts_at: as(params.hora),
    p_job_id: crypto.randomUUID(),
    p_unit_id: params.unidade,
  });
  expect(reserva, "reservar").toMatchObject({
    ok: true,
    unit_id: params.unidade,
  });
  await perguntaEConfirmacao(params.conversa);
  const marcada = await rpcOk<Resposta>("agendar_pela_ia", {
    p_clinic_id: clinicaA,
    p_conversation_id: params.conversa,
    p_job_id: crypto.randomUUID(),
  });
  expect(marcada, "agendar").toMatchObject({ ok: true, reutilizado: false });
  return marcada.appointment_id!;
}

async function contatoLido(contato: string) {
  const { data } = await admin
    .from("contact")
    .select("name, birth_date, cpf")
    .eq("id", contato)
    .single()
    .throwOnError();
  return data as {
    name: string | null;
    birth_date: string | null;
    cpf: string | null;
  };
}

async function aplicacaoDaConsulta(consulta: string) {
  const { data } = await admin
    .from("dados_informados_na_marcacao")
    .select("aplicado_em, aplicado_por")
    .eq("appointment_id", consulta)
    .single()
    .throwOnError();
  return data as { aplicado_em: string | null; aplicado_por: string | null };
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

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "agendamento-ia-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" }))
    .id;

  // A IA liberada so na A (modo contatos, o numero e os telefones da lista).
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaA,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de RLS da AG3",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaA,
    p_whatsapp_account_id: numeroA,
    p_ativo: true,
  });

  p1 = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });
  p2 = await inserir("professional", { clinic_id: clinicaA, name: "Dr. Dois" });
  pb = await inserir("professional", { clinic_id: clinicaB, name: "Dra. B" });
  procedimentoA = await inserir("procedure", {
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
  // Jornada sem unidade (vale para todas), o dia todo, todos os dias.
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
  unidadeA = await inserir("unit", {
    clinic_id: clinicaA,
    name: "Sede sintética da A",
  });
  unidadeB = await inserir("unit", {
    clinic_id: clinicaB,
    name: "Sede sintética da B",
  });

  // A versao publicada da A: Agendar ligada, nome completo e nascimento
  // exigidos, CPF nao. A da B: o contrario do padrao (so o CPF).
  publicadaA = await inserir("ai_agent_config", {
    clinic_id: clinicaA,
    version: 1,
    status: "publicada",
    skills: { agendar: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: true,
    exige_nascimento: true,
    exige_cpf: false,
  });
  publicadaB = await inserir("ai_agent_config", {
    clinic_id: clinicaB,
    version: 1,
    status: "publicada",
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: true,
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

  // Tres consultas pendentes marcadas pela IA, com os dados informados: a 1
  // e a 3 na agenda da Dra. Um (a 1 na unidade da A), a 2 na do Dr. Dois. O
  // contato 1 ja tem o nascimento no cadastro (de adulto): a aprovacao nao
  // o troca.
  const c1 = await conversaNaIa();
  contato1 = c1.contato;
  await admin
    .from("contact")
    .update({ birth_date: "1975-05-05" })
    .eq("id", contato1)
    .throwOnError();
  consulta1 = await marcarPelaIa({
    conversa: c1.conversa,
    vinculo: l1,
    hora: "09:00",
    unidade: unidadeA,
    nome: "Paciente Um Sintético",
    nascimento: "1980-01-01",
    cpf: CPF_SINTETICO,
  });
  const c2 = await conversaNaIa();
  contato2 = c2.contato;
  consulta2 = await marcarPelaIa({
    conversa: c2.conversa,
    vinculo: l2,
    hora: "09:00",
    unidade: null,
    nome: "Paciente Dois Sintético",
    nascimento: "1985-02-02",
    cpf: null,
  });
  const c3 = await conversaNaIa();
  contato3 = c3.contato;
  consulta3 = await marcarPelaIa({
    conversa: c3.conversa,
    vinculo: l1,
    hora: "10:00",
    unidade: null,
    nome: "Paciente Três Sintético",
    nascimento: "1990-03-03",
    cpf: null,
  });

  // Uma consulta pendente da IA na B, SEM dado informado (inserida direto).
  const contatoB = await inserir("contact", {
    clinic_id: clinicaB,
    phone_e164: `+55848${digitos}01`,
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
    created_by: "ia",
    approval_status: "pendente",
    send_confirmation: false,
    oferecer_vaga_ao_cancelar: false,
  });
}, 120_000);

afterAll(async () => {
  // As clinicas desta execucao pelo slug (tudo em cascata); depois os
  // usuarios, com o erro conferido: limpeza que falha calada deixaria
  // usuario sintetico na producao.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `agendamento-ia-rls-%-${sufixo}`);
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

describe("ai_agent_config: os dados que a IA exige para marcar, por papel", () => {
  it("todo membro ativo da A lê as três colunas; a B não lê as da A; anon não lê", async () => {
    for (const quem of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(quem)
        .from("ai_agent_config")
        .select(COLUNAS_EXIGE)
        .eq("id", publicadaA);
      expect(error, quem).toBeNull();
      expect(data, quem).toEqual([
        {
          id: publicadaA,
          exige_nome_completo: true,
          exige_nascimento: true,
          exige_cpf: false,
        },
      ]);
    }
    const { data: daB, error: erroDaB } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_EXIGE)
      .eq("clinic_id", clinicaA);
    expect(erroDaB).toBeNull();
    expect(daB).toEqual([]);
    // Positivo: a B le a dela.
    const { data: propria } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_EXIGE)
      .eq("id", publicadaB);
    expect(propria).toEqual([
      {
        id: publicadaB,
        exige_nome_completo: false,
        exige_nascimento: false,
        exige_cpf: true,
      },
    ]);
    const { error: erroAnon } = await anonClient()
      .from("ai_agent_config")
      .select(COLUNAS_EXIGE)
      .eq("id", publicadaA);
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
  });

  it("o rascunho copia as três da última publicada (na B, o contrário do padrão)", async () => {
    const { data: rascunhoB, error } = await como("admin-b").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaB },
    );
    expect(error).toBeNull();
    const { data } = await admin
      .from("ai_agent_config")
      .select("status, exige_nome_completo, exige_nascimento, exige_cpf")
      .eq("id", rascunhoB as string)
      .single()
      .throwOnError();
    expect(data).toEqual({
      status: "rascunho",
      exige_nome_completo: false,
      exige_nascimento: false,
      exige_cpf: true,
    });
    // E o da A, criado no beforeAll, copiou a publicada da A.
    const { data: daA } = await admin
      .from("ai_agent_config")
      .select("exige_nome_completo, exige_nascimento, exige_cpf")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(daA).toEqual({
      exige_nome_completo: true,
      exige_nascimento: true,
      exige_cpf: false,
    });
  });

  it("administrador e gestor gravam no rascunho; recepção, profissional, leitura e a B não", async () => {
    const { data: doAdmin, error } = await como("admin-a")
      .from("ai_agent_config")
      .update({ exige_cpf: true })
      .eq("id", rascunhoA)
      .select("exige_nome_completo, exige_nascimento, exige_cpf");
    expect(error).toBeNull();
    expect(doAdmin).toEqual([
      { exige_nome_completo: true, exige_nascimento: true, exige_cpf: true },
    ]);
    const { data: doGestor } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ exige_nascimento: false })
      .eq("id", rascunhoA)
      .select("exige_nome_completo, exige_nascimento, exige_cpf");
    expect(doGestor).toEqual([
      { exige_nome_completo: true, exige_nascimento: false, exige_cpf: true },
    ]);

    for (const quem of [
      "recepcao-a",
      "profissional-a",
      "leitura-a",
      "admin-b",
    ] as const) {
      const { data, error: erro } = await como(quem)
        .from("ai_agent_config")
        .update({
          exige_nome_completo: false,
          exige_nascimento: true,
          exige_cpf: false,
        })
        .eq("id", rascunhoA)
        .select("id");
      // Sem permissao, a RLS esconde a linha: zero linhas (ou 42501).
      if (erro) {
        expect(erro.code, quem).toBe(PERMISSAO_NEGADA);
      } else {
        expect(data, quem).toEqual([]);
      }
    }
    const { data: depois } = await admin
      .from("ai_agent_config")
      .select("exige_nome_completo, exige_nascimento, exige_cpf")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      exige_nome_completo: true,
      exige_nascimento: false,
      exige_cpf: true,
    });
  });

  it("a versão publicada não muda pela sessão, nem do administrador dela", async () => {
    const { data, error } = await como("admin-a")
      .from("ai_agent_config")
      .update({ exige_nome_completo: false })
      .eq("id", publicadaA)
      .select("id");
    if (error) {
      expect(error.code).toBe(PERMISSAO_NEGADA);
    } else {
      expect(data).toEqual([]);
    }
    const { data: depois } = await admin
      .from("ai_agent_config")
      .select("exige_nome_completo")
      .eq("id", publicadaA)
      .single()
      .throwOnError();
    expect(depois).toEqual({ exige_nome_completo: true });
  });
});

describe("as tabelas novas: nenhuma sessão lê nem grava", () => {
  it("toda sessão, da própria clínica inclusive, e anon recebem 42501 ao ler; a service role lê", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ...TODAS_AS_SESSOES.map(
        (quem) => [quem, como(quem)] as [string, SupabaseClient],
      ),
      ["anon", anonClient()],
    ];
    for (const [quem, cliente] of sessoes) {
      for (const tabela of ["ia_atendimento", "dados_informados_na_marcacao"]) {
        const { data, error } = await cliente
          .from(tabela)
          .select("id")
          .eq("clinic_id", clinicaA);
        expect(error?.code, `${quem} lê ${tabela}`).toBe(PERMISSAO_NEGADA);
        expect(data, `${quem} lê ${tabela}`).toBeNull();
      }
    }
    // Positivo: a service role le os dados das tres consultas da A.
    const { data: lidos } = await admin
      .from("dados_informados_na_marcacao")
      .select("appointment_id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(
      (lidos as { appointment_id: string }[])
        .map((l) => l.appointment_id)
        .sort(),
    ).toEqual([consulta1, consulta2, consulta3].sort());
  });

  it("nenhuma sessão grava, nem o administrador da própria clínica (42501)", async () => {
    const { error: novoEstado } = await como("admin-a")
      .from("ia_atendimento")
      .insert({
        clinic_id: clinicaA,
        conversation_id: crypto.randomUUID(),
        janela_desde: new Date().toISOString(),
        job_id: crypto.randomUUID(),
      });
    expect(novoEstado?.code).toBe(PERMISSAO_NEGADA);
    const { error: novoDado } = await como("recepcao-a")
      .from("dados_informados_na_marcacao")
      .insert({
        clinic_id: clinicaA,
        conversation_id: crypto.randomUUID(),
        contact_id: contato1,
        para_o_titular: true,
        job_id: crypto.randomUUID(),
      });
    expect(novoDado?.code).toBe(PERMISSAO_NEGADA);
    const { error: troca } = await como("admin-a")
      .from("dados_informados_na_marcacao")
      .update({ nome_completo: "Outro Nome" })
      .eq("appointment_id", consulta1);
    expect(troca?.code).toBe(PERMISSAO_NEGADA);
    const { error: apaga } = await como("admin-a")
      .from("dados_informados_na_marcacao")
      .delete()
      .eq("appointment_id", consulta1);
    expect(apaga?.code).toBe(PERMISSAO_NEGADA);
    // Nada mudou (a service role confere).
    const { data } = await admin
      .from("dados_informados_na_marcacao")
      .select("nome_completo")
      .eq("appointment_id", consulta1)
      .single()
      .throwOnError();
    expect(data).toEqual({ nome_completo: "Paciente Um Sintético" });
  });
});

describe("as RPCs do servidor: só a service role", () => {
  it("nenhuma sessão nem anon chama (42501)", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ...TODAS_AS_SESSOES.map(
        (quem) => [quem, como(quem)] as [string, SupabaseClient],
      ),
      ["anon", anonClient()],
    ];
    const chamadas: [string, () => Record<string, unknown>][] = [
      [
        "registrar_dados_da_marcacao",
        () => ({
          p_clinic_id: clinicaA,
          p_conversation_id: crypto.randomUUID(),
          p_job_id: crypto.randomUUID(),
          p_para_o_titular: true,
          p_nome_completo: "Nome Sintético",
        }),
      ],
      [
        "ler_atendimento_da_ia",
        () => ({
          p_clinic_id: clinicaA,
          p_conversation_id: crypto.randomUUID(),
          p_job_id: crypto.randomUUID(),
        }),
      ],
      [
        "gravar_atendimento_da_ia",
        () => ({
          p_clinic_id: clinicaA,
          p_conversation_id: crypto.randomUUID(),
          p_job_id: crypto.randomUUID(),
          p_versao: 0,
          p_estado: ESTADO_VAZIO,
        }),
      ],
      [
        "reservar_horario_da_ia",
        () => ({
          p_clinic_id: clinicaA,
          p_conversation_id: crypto.randomUUID(),
          p_service_link_id: l1,
          p_starts_at: as("15:00"),
          p_job_id: crypto.randomUUID(),
          p_unit_id: unidadeA,
        }),
      ],
      [
        "agendar_pela_ia",
        () => ({
          p_clinic_id: clinicaA,
          p_conversation_id: crypto.randomUUID(),
          p_job_id: crypto.randomUUID(),
          p_slot_hold_id: crypto.randomUUID(),
        }),
      ],
    ];
    for (const [quem, cliente] of sessoes) {
      for (const [rpc, args] of chamadas) {
        const { error } = await cliente.rpc(rpc, args());
        expect(error?.code, `${quem} ${rpc}`).toBe(PERMISSAO_NEGADA);
      }
    }
  });

  it("o servidor chama: resposta de negócio, nunca erro de permissão", async () => {
    const { contato, conversa } = await conversaNaIa();
    const job = await jobEmExecucao(conversa);
    const lido = await rpcOk<Record<string, unknown>>("ler_atendimento_da_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_job_id: job,
    });
    expect(lido).toMatchObject({
      ok: true,
      versao: 0,
      estado: ESTADO_VAZIO,
      dados: {
        nome_completo: false,
        data_nascimento: false,
        cpf: false,
        carteirinha: false,
        para_o_titular: null,
        faltam: ["nome_completo", "data_nascimento"],
      },
    });
    const gravado = await rpcOk<Resposta>("gravar_atendimento_da_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_job_id: job,
      p_versao: 0,
      p_estado: {
        ...ESTADO_VAZIO,
        etapa: "escolha",
        intencao: "agendar",
        procedure_id: procedimentoA,
      },
    });
    expect(gravado).toEqual({ ok: true, versao: 1, reutilizado: false });
    const registro = await rpcOk<Resposta>("registrar_dados_da_marcacao", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_job_id: job,
      p_para_o_titular: true,
      p_nome_completo: "Paciente Quatro Sintético",
    });
    expect(registro).toMatchObject({ ok: true, faltam: ["data_nascimento"] });
    const reserva = await rpcOk<Resposta>("reservar_horario_da_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_service_link_id: l2,
      p_starts_at: as("15:00"),
      p_job_id: crypto.randomUUID(),
      p_unit_id: unidadeA,
    });
    expect(reserva).toMatchObject({ ok: true, unit_id: unidadeA });
    // O agendar com a reserva (revisao final): a reserva pedida nao e a viva,
    // reserva_diferente (resposta de negocio, nada marcado).
    const agendada = await rpcOk<Resposta>("agendar_pela_ia", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversa,
      p_job_id: crypto.randomUUID(),
      p_slot_hold_id: crypto.randomUUID(),
    });
    expect(agendada).toEqual({ ok: false, motivo: "reserva_diferente" });
    // Anti falso positivo: o estado e a linha de dados existem (a service
    // role le), do contato da conversa.
    const { data: estado } = await admin
      .from("ia_atendimento")
      .select("etapa, versao")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(estado).toEqual([{ etapa: "escolha", versao: 1 }]);
    const { data: aberta } = await admin
      .from("dados_informados_na_marcacao")
      .select("contact_id, appointment_id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(aberta).toEqual([{ contact_id: contato, appointment_id: null }]);
  });
});

describe("ler_dados_informados_na_marcacao: quem aprova lê, com a trilha", () => {
  const ler = (cliente: SupabaseClient, clinicId: string, consulta: string) =>
    cliente.rpc("ler_dados_informados_na_marcacao", {
      p_clinic_id: clinicId,
      p_appointment_id: consulta,
    });

  it("administrador, gestor e recepção da A leem; cada leitura grava a trilha sem o conteúdo", async () => {
    for (const quem of ["admin-a", "gestor-a", "recepcao-a"] as const) {
      const antes = await trilhas("leu_dados_da_marcacao", consulta1);
      const { data, error } = await ler(como(quem), clinicaA, consulta1);
      expect(error, quem).toBeNull();
      const lido = data as DadosLidos;
      expect(lido.dados, quem).toMatchObject({
        nome_completo: "Paciente Um Sintético",
        data_nascimento: "1980-01-01",
        cpf: CPF_SINTETICO,
        carteirinha: null,
        para_o_titular: true,
        aplicado_em: null,
        aplicado_por: null,
      });
      expect(typeof lido.dados?.informado_em, quem).toBe("string");
      expect(await trilhas("leu_dados_da_marcacao", consulta1), quem).toBe(
        antes + 1,
      );
    }
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, entity, detalhes")
      .eq("clinic_id", clinicaA)
      .eq("action", "leu_dados_da_marcacao")
      .eq("entity_id", consulta1)
      .throwOnError();
    const linhas = trilha as {
      user_id: string | null;
      entity: string;
      detalhes: unknown;
    }[];
    expect(linhas.map((l) => l.user_id).sort()).toEqual(
      [ids.get("admin-a"), ids.get("gestor-a"), ids.get("recepcao-a")].sort(),
    );
    for (const linha of linhas) {
      expect(linha.entity).toBe("appointment");
      // Nunca o conteudo: nem o nome, nem o CPF, nem o nascimento.
      expect(linha.detalhes).toBeNull();
    }
  });

  it("o profissional lê a da própria agenda; a do outro profissional, 42501 e sem trilha", async () => {
    const { data, error } = await ler(
      como("profissional-a"),
      clinicaA,
      consulta3,
    );
    expect(error).toBeNull();
    expect((data as DadosLidos).dados?.nome_completo).toBe(
      "Paciente Três Sintético",
    );
    const antes = await trilhas("leu_dados_da_marcacao", consulta2);
    const { error: daOutraAgenda } = await ler(
      como("profissional-a"),
      clinicaA,
      consulta2,
    );
    expect(daOutraAgenda?.code).toBe(PERMISSAO_NEGADA);
    expect(await trilhas("leu_dados_da_marcacao", consulta2)).toBe(antes);
  });

  it("leitura, a B e anon recebem 42501; a B com o id da clínica dela, P0002; nenhuma trilha nasce", async () => {
    const antes = await trilhas("leu_dados_da_marcacao", consulta1);
    for (const [quem, cliente] of [
      ["leitura-a", como("leitura-a")],
      ["admin-b", como("admin-b")],
      ["anon", anonClient()],
    ] as [string, SupabaseClient][]) {
      const { data, error } = await ler(cliente, clinicaA, consulta1);
      expect(error?.code, quem).toBe(PERMISSAO_NEGADA);
      expect(data, quem).toBeNull();
    }
    const { error: comAClinicaDela } = await ler(
      como("admin-b"),
      clinicaB,
      consulta1,
    );
    expect(comAClinicaDela?.code).toBe(NAO_ENCONTRADA);
    expect(await trilhas("leu_dados_da_marcacao", consulta1)).toBe(antes);
  });

  it("a consulta sem dado informado devolve dados nulo, sem trilha (a B na dela)", async () => {
    const { data, error } = await ler(como("admin-b"), clinicaB, consultaB);
    expect(error).toBeNull();
    expect(data).toEqual({ dados: null });
    const { count } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaB)
      .eq("action", "leu_dados_da_marcacao")
      .throwOnError();
    expect(count).toBe(0);
  });
});

describe("slot_hold.unit_id: a unidade é da clínica da reserva", () => {
  it("a sessão não cria reserva com a unidade da B (23503); com a da A, cria", async () => {
    const base = {
      clinic_id: clinicaA,
      professional_id: p2,
      service_link_id: l2,
      starts_at: as("16:00"),
      ends_at: meiaHoraDepois(as("16:00")),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      created_by: "usuario",
    };
    const { error } = await como("recepcao-a")
      .from("slot_hold")
      .insert({ ...base, unit_id: unidadeB });
    expect(error?.code).toBe(DE_OUTRA_CLINICA);
    const { error: valida } = await como("recepcao-a")
      .from("slot_hold")
      .insert({ ...base, unit_id: unidadeA });
    expect(valida).toBeNull();
  });

  it("a A lê a unidade da reserva da IA; a B não vê a reserva", async () => {
    const { data, error } = await como("recepcao-a")
      .from("slot_hold")
      .select("unit_id, appointment_id")
      .eq("appointment_id", consulta1);
    expect(error).toBeNull();
    expect(data).toEqual([{ unit_id: unidadeA, appointment_id: consulta1 }]);
    const { data: daB } = await como("admin-b")
      .from("slot_hold")
      .select("unit_id")
      .eq("appointment_id", consulta1);
    expect(daB).toEqual([]);
    // E a consulta guardou a unidade da reserva.
    const { data: consulta } = await admin
      .from("appointment")
      .select("unit_id, approval_status, created_by")
      .eq("id", consulta1)
      .single()
      .throwOnError();
    expect(consulta).toEqual({
      unit_id: unidadeA,
      approval_status: "pendente",
      created_by: "ia",
    });
  });
});

describe("a aprovação aplica os dados ao cadastro, só nos campos vazios", () => {
  const aprovar = (cliente: SupabaseClient, consulta: string) =>
    cliente
      .from("appointment")
      .update({
        approval_status: "aprovado",
        send_confirmation: true,
        oferecer_vaga_ao_cancelar: true,
      })
      .eq("id", consulta)
      .eq("approval_status", "pendente")
      .select("id");

  it("leitura, o profissional de outra agenda e a B não aprovam: nada é aplicado", async () => {
    const antes = await contatoLido(contato2);
    for (const quem of ["leitura-a", "profissional-a", "admin-b"] as const) {
      const { data } = await aprovar(como(quem), consulta2);
      expect(data ?? [], quem).toEqual([]);
    }
    expect(await contatoLido(contato2)).toEqual(antes);
    expect(await aplicacaoDaConsulta(consulta2)).toEqual({
      aplicado_em: null,
      aplicado_por: null,
    });
  });

  it("a recepção aprova: o nome do WhatsApp troca, o nascimento do cadastro fica, o CPF entra; a trilha sem o valor", async () => {
    const antes = await contatoLido(contato1);
    expect(antes.birth_date).toBe("1975-05-05");
    expect(antes.cpf ?? null).toBeNull();
    const { data, error } = await aprovar(como("recepcao-a"), consulta1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: consulta1 }]);
    expect(await contatoLido(contato1)).toEqual({
      name: "Paciente Um Sintético",
      birth_date: "1975-05-05",
      cpf: CPF_SINTETICO,
    });
    const aplicacao = await aplicacaoDaConsulta(consulta1);
    expect(aplicacao.aplicado_por).toBe(ids.get("recepcao-a"));
    expect(aplicacao.aplicado_em).not.toBeNull();
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, entity, detalhes")
      .eq("clinic_id", clinicaA)
      .eq("action", "aplicou_dados_da_marcacao")
      .eq("entity_id", contato1)
      .throwOnError();
    expect(trilha).toEqual([
      {
        user_id: ids.get("recepcao-a"),
        entity: "contact",
        detalhes: { campos: ["name", "cpf"], appointment_id: consulta1 },
      },
    ]);
  });

  it("recusar não aplica nada", async () => {
    const antes = await contatoLido(contato3);
    const { data, error } = await como("recepcao-a")
      .from("appointment")
      .update({
        approval_status: "recusado",
        status: "cancelado_clinica",
        oferecer_vaga_ao_cancelar: false,
      })
      .eq("id", consulta3)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: consulta3 }]);
    expect(await contatoLido(contato3)).toEqual(antes);
    expect(await aplicacaoDaConsulta(consulta3)).toEqual({
      aplicado_em: null,
      aplicado_por: null,
    });
    expect(await trilhas("aplicou_dados_da_marcacao", contato3)).toBe(0);
  });

  it("o gestor aprova a do Dr. Dois: o nome e o nascimento vazios entram (contraprova)", async () => {
    const { data, error } = await aprovar(como("gestor-a"), consulta2);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: consulta2 }]);
    expect(await contatoLido(contato2)).toMatchObject({
      name: "Paciente Dois Sintético",
      birth_date: "1985-02-02",
    });
    expect((await aplicacaoDaConsulta(consulta2)).aplicado_por).toBe(
      ids.get("gestor-a"),
    );
  });
});
