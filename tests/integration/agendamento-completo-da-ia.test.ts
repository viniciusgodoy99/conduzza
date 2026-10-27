import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Agendamento completo pela IA (AG3, parte de banco: migration
// 20261027120000_agendamento_completo_da_ia.sql) contra o banco REAL, pelo
// cliente de servico (o servidor, como o motor da IA chama) e, so no Assumir
// e no Devolver, pela sessao de uma recepcionista sintetica. O que o ensaio
// nao prova, porque roda numa transacao so (now() fixo) e sem o PostgREST:
// as chamadas por HTTP, com os parametros por nome, em transacoes separadas.
// - o reservar com 5 parametros, como o codigo de hoje chama, resolve para
//   a funcao nova (p_unit_id tem default) e continua igual (unidade nula);
// - a unidade na reserva: a jornada da unidade e a sem unidade valem; a de
//   outra unidade nao (fora_da_jornada); unidade de outra clinica ou
//   inativa: unidade_invalida;
// - o agendar novo: faltam_dados na ordem e o registrar que completa; a
//   consulta guarda a unidade e os dados ficam ligados a ela e a reserva;
//   dado invalido nao grava nada e a resposta nunca traz o valor;
//   ja_tem_consulta (o mesmo procedimento com outro profissional; outro
//   procedimento nao conta); D-8: para outra pessoa e menor de idade (pelo
//   informado e pelo cadastro); a carteirinha do convenio com "Carteirinha
//   obrigatoria";
// - o estado do atendimento: as versoes, o mesmo job de novo (parte do
//   estado de antes dele), estado_mudou, a normalizacao (UTC com Z, ids
//   minusculos), 22023 (forma, id de outra clinica, job de outra conversa),
//   sem_posse, Assumir (fora_da_ia) e Devolver (o job de antes vira
//   job_antigo e o estado recomeca);
// - a leitura dos dados pelo servidor grava a trilha sem usuario e sem
//   conteudo; o primeiro rascunho de uma clinica nasce com o padrao do dono
//   (nome completo e nascimento, sem CPF);
// - a revisao final (27/10/2026): o "sim" para a reserva que outro turno
//   trocou (agendar com p_slot_hold_id) recusa reserva_diferente sem gravar
//   nada, e com a reserva viva marca; o reservar ja recusa ja_tem_consulta
//   (com o appointment_id e o starts_at), e o agendar confere de novo; a
//   marca de consulta para outra pessoa nao sobrevive ao Assumir e
//   Devolver (a janela nova); a reserva do estado que sumiu no meio do
//   turno e gravada nula, sem 22023.
// LIMITE (como na E4): os casos "ao mesmo tempo" disparam as RPCs por HTTP
// (Promise.all) e NAO forcam a sobreposicao dentro do Postgres: provam o
// resultado final no banco real, nao a trava. A prova das travas, com
// sessoes de verdade esperando umas as outras, e o teste de concorrencia do
// harness local (~/.claude/plans/agente-completo/ag3/banco/travas), nunca na
// producao.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// agendamento-ia-int-*, apagadas no afterAll (reservas, consultas, dados
// informados, estado e jobs vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora), e a recepcionista sintetica
// (depois das clinicas). A IA liberada so na clinica de teste (fora da lista
// fechada: nao depende do interruptor, so atende em numero 'fake' e o motor
// da IA de producao nunca a reivindica; os jobs sao montados direto e nenhum
// executor roda aqui; nenhuma mensagem sai). O interruptor global NUNCA e
// tocado. Nada usa a id da Salud Care, da teste123 nem da Conduzza Teste.
// Telefones ficticios. ESCRITO, AINDA NAO RODADO: grava no banco. Roda
// depois de aplicar a migration, com
// npm run test:integration -- agendamento-completo-da-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'agendamento-ia-int-%' and e_de_teste;
// e a recepcionista (auth.users com email like
// 'agendamento-ia-int-%@teste.dev') pela API de administracao.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `AgendamentoIaInt!${sufixo}`;
const FUSO = "America/Fortaleza";
const DADO_INVALIDO = "22023";
const INSTANTE_EM_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

type Resposta = {
  ok: boolean;
  motivo?: string;
  appointment_id?: string;
  hold_id?: string;
  starts_at?: string;
  unit_id?: string | null;
  reutilizado?: boolean;
  dados_id?: string;
  faltam?: string[];
  invalidos?: string[];
};

type Estado = {
  etapa: string;
  intencao: string | null;
  procedure_id: string | null;
  professional_id: string | null;
  insurance_id: string | null;
  particular: boolean | null;
  unit_id: string | null;
  horarios_oferecidos: Record<string, unknown>[];
  slot_hold_id: string | null;
  appointment_id: string | null;
  pedido_pendente: string | null;
  pedido_pendente_em: string | null;
  falhas_seguidas: number;
  desfecho: string | null;
};

type Leitura = {
  ok: boolean;
  motivo?: string;
  versao?: number;
  janela_desde?: string;
  estado?: Estado;
};

const ESTADO_VAZIO: Estado = {
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

const clinicas: string[] = [];
let clinica = "";
let clinicaJ = "";
let numero = "";
let sede = "";
let filial = "";
let antiga = "";
let unidadeJ = "";
let ana = "";
let bruno = "";
let consulta = "";
let lAna = "";
let lBruno = "";
let lRetorno = "";
let lConvenio = "";
let contatoDaRecepcao = "";
let recepcionista = "";
let sessao: SupabaseClient;
let telefones = 0;
let consultaComDados = "";

// Daqui a 3 dias, no fuso da clinica: dentro da antecedencia (2 h) e do
// horizonte (30 dias). Cada caso usa um horario proprio (as reservas vivem
// 10 minutos e seguram o horario para as outras conversas).
const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string): string =>
  instanteLocal(FUSO, dia, hora).toISOString();
/** O instante de outro dia (dia + n), no fuso da clinica. */
const noDia = (n: number, hora: string): string =>
  instanteLocal(FUSO, somarDias(dia, n), hora).toISOString();
const meiaHoraDepois = (inicio: string): string =>
  new Date(Date.parse(inicio) + 30 * 60_000).toISOString();
// Um nascimento de menor (10 anos no dia da consulta) e um de adulto.
const NASCIMENTO_DE_MENOR = `${Number(dia.slice(0, 4)) - 10}-06-15`;
const NASCIMENTO_DE_ADULTO = "1980-01-01";

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

async function novaClinica(nome: string): Promise<string> {
  const id = await inserir("clinic", {
    name: `Agendamento IA integração ${nome} ${sufixo}`,
    slug: `agendamento-ia-int-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
  });
  clinicas.push(id);
  return id;
}

/**
 * Telefone liberado, contato e conversa NA IA pela ingestao (com a janela).
 * Cada caso ingere logo antes de usar: a manutencao de producao devolve a
 * conversa de teste que espera resposta ha mais de 3 minutos.
 */
async function novaConversa(): Promise<{ contato: string; conversa: string }> {
  // O numero desta chamada fica guardado antes do primeiro await: duas
  // chamadas ao mesmo tempo (o teste de concorrencia) nao dividem o contador.
  telefones += 1;
  const n = telefones;
  const telefone = `+55849${digitos}${String(n).padStart(2, "0")}`;
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
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
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `agendamento-ia-int:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numero,
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
        clinic_id: clinica,
        conversation_id: conversa,
        direction,
        author,
        content_type: "texto",
        body,
      })
      .throwOnError();
  }
}

/** Um job da IA da conversa, montado direto (como o claim deixaria). */
async function job(
  conversa: string,
  status: "executando" | "pendente" = "executando",
): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status,
    locked_by: status === "executando" ? `agendamento-ia-int-${sufixo}` : null,
    locked_at: status === "executando" ? new Date().toISOString() : null,
    run_at:
      status === "pendente"
        ? new Date(Date.now() + 60 * 60_000).toISOString()
        : new Date().toISOString(),
    attempts: status === "executando" ? 1 : 0,
    max_attempts: 3,
  });
}

/** O reservar; unidade undefined = os 5 parametros do codigo de hoje. */
async function reservar(
  conversa: string,
  vinculo: string,
  hora: string,
  unidade?: string | null,
): Promise<Resposta> {
  const args: Record<string, unknown> = {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_service_link_id: vinculo,
    p_starts_at: as(hora),
    p_job_id: crypto.randomUUID(),
  };
  if (unidade !== undefined) {
    args.p_unit_id = unidade;
  }
  return rpcOk<Resposta>("reservar_horario_da_ia", args);
}

/** O agendar; reserva undefined = os 3 parametros do codigo de hoje. */
async function agendar(conversa: string, reserva?: string): Promise<Resposta> {
  const args: Record<string, unknown> = {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: crypto.randomUUID(),
  };
  if (reserva !== undefined) {
    args.p_slot_hold_id = reserva;
  }
  return rpcOk<Resposta>("agendar_pela_ia", args);
}

async function registrar(
  conversa: string,
  dados: {
    titular?: boolean;
    nome?: string;
    nascimento?: string;
    cpf?: string;
    carteirinha?: string;
  },
): Promise<Resposta> {
  return rpcOk<Resposta>("registrar_dados_da_marcacao", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: crypto.randomUUID(),
    p_para_o_titular: dados.titular ?? true,
    p_nome_completo: dados.nome ?? null,
    p_data_nascimento: dados.nascimento ?? null,
    p_cpf: dados.cpf ?? null,
    p_carteirinha: dados.carteirinha ?? null,
  });
}

async function ler(conversa: string, jobId: string): Promise<Leitura> {
  return rpcOk<Leitura>("ler_atendimento_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: jobId,
  });
}

function gravar(
  conversa: string,
  jobId: string,
  versao: number,
  estado: Record<string, unknown>,
) {
  return admin.rpc("gravar_atendimento_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: jobId,
    p_versao: versao,
    p_estado: estado,
  });
}

async function gravarOk(
  conversa: string,
  jobId: string,
  versao: number,
  estado: Record<string, unknown>,
): Promise<Resposta> {
  const { data, error } = await gravar(conversa, jobId, versao, estado);
  expect(error, "gravar_atendimento_da_ia").toBeNull();
  return data as Resposta;
}

/** Assumir pela sessao da recepcionista (como a Inbox faz). */
async function assumir(conversa: string): Promise<void> {
  const { error } = await sessao
    .from("conversation")
    .update({
      status: "em_atendimento",
      assignee_user_id: recepcionista,
      awaiting_reply: false,
    })
    .eq("id", conversa);
  expect(error).toBeNull();
}

async function consultasDoContato(contato: string): Promise<number> {
  const { count } = await admin
    .from("appointment")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contato)
    .throwOnError();
  return count ?? 0;
}

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "agendamento-ia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinica = await novaClinica("I");
  clinicaJ = await novaClinica("J");
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;

  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da AG3",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  // A versao publicada em uso: Agendar ligada, 2 h de antecedencia, 30 dias
  // de horizonte, nome completo e nascimento exigidos, CPF nao.
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    skills: { agendar: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: true,
    exige_nascimento: true,
    exige_cpf: false,
  });

  sede = await inserir("unit", { clinic_id: clinica, name: "Sede sintética" });
  filial = await inserir("unit", {
    clinic_id: clinica,
    name: "Filial sintética",
  });
  antiga = await inserir("unit", {
    clinic_id: clinica,
    name: "Unidade antiga sintética",
    active: false,
  });
  unidadeJ = await inserir("unit", {
    clinic_id: clinicaJ,
    name: "Unidade sintética da J",
  });

  ana = await inserir("professional", { clinic_id: clinica, name: "Dra. Ana" });
  bruno = await inserir("professional", {
    clinic_id: clinica,
    name: "Dr. Bruno",
  });
  consulta = await inserir("procedure", {
    clinic_id: clinica,
    name: "Consulta sintética",
    default_duration_min: 30,
  });
  const retorno = await inserir("procedure", {
    clinic_id: clinica,
    name: "Retorno sintético",
    default_duration_min: 30,
  });
  const convenio = await inserir("insurance", {
    clinic_id: clinica,
    name: "Convênio sintético",
    requires_card: true,
  });
  const vinculo = (linha: Record<string, unknown>) =>
    inserir("service_link", {
      clinic_id: clinica,
      duration_min: 30,
      ...linha,
    });
  lAna = await vinculo({
    professional_id: ana,
    procedure_id: consulta,
    price_cents: 20000,
  });
  lBruno = await vinculo({
    professional_id: bruno,
    procedure_id: consulta,
    price_cents: 20000,
  });
  lRetorno = await vinculo({
    professional_id: ana,
    procedure_id: retorno,
    price_cents: 15000,
  });
  lConvenio = await vinculo({
    professional_id: ana,
    procedure_id: consulta,
    insurance_id: convenio,
    price_cents: null,
    covered_by_insurance: true,
  });

  // Jornadas, todos os dias: a Dra. Ana na Sede das 08:00 as 12:00 e, sem
  // unidade, das 14:00 as 18:00; o Dr. Bruno na Filial das 08:00 as 18:00.
  await admin
    .from("professional_schedule")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        {
          clinic_id: clinica,
          professional_id: ana,
          unit_id: sede,
          weekday,
          starts_at: "08:00",
          ends_at: "12:00",
        },
        {
          clinic_id: clinica,
          professional_id: ana,
          unit_id: null,
          weekday,
          starts_at: "14:00",
          ends_at: "18:00",
        },
        {
          clinic_id: clinica,
          professional_id: bruno,
          unit_id: filial,
          weekday,
          starts_at: "08:00",
          ends_at: "18:00",
        },
      ]),
    )
    .throwOnError();

  contatoDaRecepcao = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55848${digitos}99`,
    name: "Paciente sintético da recepção",
    kind: "paciente",
  });

  // Recepcionista sintetica (so para o Assumir e o Devolver pela sessao).
  const { data: criada, error } = await admin.auth.admin.createUser({
    email: `agendamento-ia-int-${sufixo}@teste.dev`,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "Recepcionista Sintética" },
  });
  if (error || !criada.user) {
    throw new Error(`criar recepcionista: ${error?.message ?? "sem usuário"}`);
  }
  recepcionista = criada.user.id;
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinica,
      user_id: recepcionista,
      role: "recepcao",
      status: "ativo",
    })
    .throwOnError();
  sessao = anonClient();
  const { error: erroLogin } = await sessao.auth.signInWithPassword({
    email: `agendamento-ia-int-${sufixo}@teste.dev`,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login: ${erroLogin.message}`);
  }
}, 120_000);

afterAll(async () => {
  if (clinicas.length > 0) {
    const { error } = await admin.from("clinic").delete().in("id", clinicas);
    expect(error, "apagar as clinicas do teste").toBeNull();
  }
  if (recepcionista) {
    const { error } = await admin.auth.admin.deleteUser(recepcionista);
    expect(error, "apagar a recepcionista sintetica").toBeNull();
  }
}, 60_000);

describe("a unidade na reserva", () => {
  it("o reservar com 5 parâmetros, como o código de hoje chama, continua igual (unidade nula)", async () => {
    const { conversa } = await novaConversa();
    const r = await reservar(conversa, lAna, "14:00");
    expect(r).toMatchObject({ ok: true, reutilizado: false, unit_id: null });
    expect(Date.parse(r.starts_at!)).toBe(Date.parse(as("14:00")));
    const { data } = await admin
      .from("slot_hold")
      .select("unit_id, created_by")
      .eq("id", r.hold_id!)
      .single()
      .throwOnError();
    expect(data).toEqual({ unit_id: null, created_by: "ia" });
  });

  it("a jornada da unidade e a sem unidade valem; a de outra unidade não; unidade de outra clínica ou inativa não", async () => {
    const { conversa } = await novaConversa();
    expect(await reservar(conversa, lAna, "08:00", sede)).toMatchObject({
      ok: true,
      unit_id: sede,
    });
    // A Dra. Ana de manha so atende na Sede.
    expect(await reservar(conversa, lAna, "08:30", filial)).toEqual({
      ok: false,
      motivo: "fora_da_jornada",
    });
    // A tarde a jornada dela e sem unidade: vale para a Filial.
    expect(await reservar(conversa, lAna, "14:30", filial)).toMatchObject({
      ok: true,
      unit_id: filial,
    });
    // O Dr. Bruno so atende na Filial.
    expect(await reservar(conversa, lBruno, "08:00", sede)).toEqual({
      ok: false,
      motivo: "fora_da_jornada",
    });
    expect(await reservar(conversa, lBruno, "08:00", filial)).toMatchObject({
      ok: true,
      unit_id: filial,
    });
    for (const unidade of [unidadeJ, antiga]) {
      expect(await reservar(conversa, lAna, "09:00", unidade)).toEqual({
        ok: false,
        motivo: "unidade_invalida",
      });
    }
    // Uma reserva por conversa: a ultima que deu certo (a do Dr. Bruno).
    const { data } = await admin
      .from("slot_hold")
      .select("professional_id, unit_id")
      .eq("conversation_id", conversa)
      .is("consumido_em", null)
      .throwOnError();
    expect(data).toEqual([{ professional_id: bruno, unit_id: filial }]);
  });

  it("duas conversas, o mesmo horário e a mesma unidade, ao mesmo tempo: uma reserva só", async () => {
    const [a, b] = await Promise.all([novaConversa(), novaConversa()]);
    const resultados = await Promise.all([
      reservar(a.conversa, lBruno, "09:00", filial),
      reservar(b.conversa, lBruno, "09:00", filial),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([
      { ok: false, motivo: "reservado_por_outra_conversa" },
    ]);
    const { count } = await admin
      .from("slot_hold")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica)
      .eq("professional_id", bruno)
      .eq("starts_at", as("09:00"))
      .is("consumido_em", null)
      .throwOnError();
    expect(count).toBe(1);
  });

  it("a IA e a recepção ao mesmo tempo no mesmo horário, com a unidade: uma consulta só", async () => {
    const { conversa } = await novaConversa();
    expect(
      await registrar(conversa, {
        nome: "Paciente Sintético da Corrida",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    expect(await reservar(conversa, lBruno, "11:00", filial)).toMatchObject({
      ok: true,
    });
    await perguntaEConfirmacao(conversa);
    const [daIa, daRecepcao] = await Promise.all([
      agendar(conversa),
      admin
        .from("appointment")
        .insert({
          clinic_id: clinica,
          contact_id: contatoDaRecepcao,
          professional_id: bruno,
          service_link_id: lBruno,
          starts_at: as("11:00"),
          ends_at: meiaHoraDepois(as("11:00")),
          status: "agendado",
          created_by: "usuario",
        })
        .select("id"),
    ]);
    // Ou a IA marca e a recepcao recebe 23P01, ou a recepcao marca e a IA
    // recebe conflito, sem gravar nada.
    if (daIa.ok) {
      expect(daRecepcao.error?.code).toBe("23P01");
    } else {
      expect(daIa).toEqual({ ok: false, motivo: "conflito" });
      expect(daRecepcao.error).toBeNull();
    }
    const { data } = await admin
      .from("appointment")
      .select("id")
      .eq("clinic_id", clinica)
      .eq("professional_id", bruno)
      .eq("starts_at", as("11:00"))
      .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
      .throwOnError();
    expect(data).toHaveLength(1);
  });
});

describe("o agendar novo", () => {
  let contatoComConsulta = "";
  let conversaComConsulta = "";

  it("faltam_dados na ordem; o registrar completa; a consulta guarda a unidade e os dados ficam ligados", async () => {
    const { contato, conversa } = await novaConversa();
    contatoComConsulta = contato;
    conversaComConsulta = conversa;
    const reserva = await reservar(conversa, lAna, "10:00", sede);
    expect(reserva).toMatchObject({ ok: true, unit_id: sede });
    await perguntaEConfirmacao(conversa);
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "faltam_dados",
      faltam: ["nome_completo", "data_nascimento"],
    });
    const comONome = await registrar(conversa, {
      nome: "Paciente Integração Um",
    });
    expect(comONome).toMatchObject({ ok: true, faltam: ["data_nascimento"] });
    const comTudo = await registrar(conversa, {
      nascimento: NASCIMENTO_DE_ADULTO,
    });
    expect(comTudo).toEqual({
      ok: true,
      dados_id: comONome.dados_id,
      faltam: [],
    });
    const marcada = await agendar(conversa);
    expect(marcada).toMatchObject({ ok: true, reutilizado: false });
    consultaComDados = marcada.appointment_id!;

    const { data: linha } = await admin
      .from("appointment")
      .select("unit_id, approval_status, created_by, status, contact_id")
      .eq("id", consultaComDados)
      .single()
      .throwOnError();
    expect(linha).toEqual({
      unit_id: sede,
      approval_status: "pendente",
      created_by: "ia",
      status: "agendado",
      contact_id: contato,
    });
    const { data: dados } = await admin
      .from("dados_informados_na_marcacao")
      .select(
        "id, appointment_id, slot_hold_id, nome_completo, data_nascimento, para_o_titular, aplicado_em",
      )
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(dados).toEqual([
      {
        id: comONome.dados_id,
        appointment_id: consultaComDados,
        slot_hold_id: reserva.hold_id,
        nome_completo: "Paciente Integração Um",
        data_nascimento: NASCIMENTO_DE_ADULTO,
        para_o_titular: true,
        aplicado_em: null,
      },
    ]);
  });

  it("dado inválido não grava nada, e a resposta diz o campo, nunca o valor", async () => {
    const { conversa } = await novaConversa();
    const amanha = somarDias(diaCivil(FUSO, new Date()), 1);
    for (const [dados, campo, valor] of [
      [{ cpf: "12345678900" }, "cpf", "12345678900"],
      [{ nome: "Mariana" }, "nome_completo", "Mariana"],
      [{ nascimento: amanha }, "data_nascimento", amanha],
      [{ carteirinha: "abc" }, "carteirinha", "abc"],
    ] as const) {
      const r = await registrar(conversa, dados);
      expect(r, campo).toEqual({
        ok: false,
        motivo: "dados_invalidos",
        invalidos: [campo],
      });
      expect(JSON.stringify(r), campo).not.toContain(valor);
    }
    const { data } = await admin
      .from("dados_informados_na_marcacao")
      .select("id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([]);
  });

  it("ja_tem_consulta: o reservar já recusa o mesmo procedimento com outro profissional; outro procedimento não conta; o agendar confere de novo", async () => {
    expect(conversaComConsulta).not.toBe("");
    // O reservar recusa antes de o paciente informar os dados (revisao
    // final), com a consulta que ja existe e o inicio dela, e nao reserva.
    const recusada = await reservar(
      conversaComConsulta,
      lBruno,
      "10:00",
      filial,
    );
    expect(recusada).toMatchObject({
      ok: false,
      motivo: "ja_tem_consulta",
      appointment_id: consultaComDados,
    });
    expect(Date.parse(recusada.starts_at!)).toBe(Date.parse(as("10:00")));
    const { data: vivas } = await admin
      .from("slot_hold")
      .select("id")
      .eq("conversation_id", conversaComConsulta)
      .is("consumido_em", null)
      .throwOnError();
    expect(vivas).toEqual([]);
    // O Retorno (outro procedimento): nao conta. Aqui faltam os dados (a
    // linha de antes foi para a consulta).
    expect(
      await reservar(conversaComConsulta, lRetorno, "15:00"),
    ).toMatchObject({ ok: true });
    await perguntaEConfirmacao(conversaComConsulta);
    expect(await agendar(conversaComConsulta)).toMatchObject({
      ok: false,
      motivo: "faltam_dados",
    });
    // O agendar confere de novo: um Retorno marcado pela recepcao depois da
    // reserva tambem conta.
    const retornoDaRecepcao = await inserir("appointment", {
      clinic_id: clinica,
      contact_id: contatoComConsulta,
      professional_id: ana,
      service_link_id: lRetorno,
      starts_at: noDia(1, "09:00"),
      ends_at: meiaHoraDepois(noDia(1, "09:00")),
      status: "agendado",
      created_by: "usuario",
    });
    expect(await agendar(conversaComConsulta)).toEqual({
      ok: false,
      motivo: "ja_tem_consulta",
      appointment_id: retornoDaRecepcao,
    });
    expect(await consultasDoContato(contatoComConsulta)).toBe(2);
  });

  it("reserva_diferente: o sim para a reserva que outro turno trocou não grava nada; com a reserva viva, marca", async () => {
    const { contato, conversa } = await novaConversa();
    expect(
      await registrar(conversa, {
        nome: "Paciente Integração Sete",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    // O "Confirma ...?" perguntou a primeira; outro turno reservou a segunda
    // (uma reserva por conversa: a primeira saiu).
    const perguntada = await reservar(conversa, lBruno, "13:00");
    expect(perguntada).toMatchObject({ ok: true });
    await perguntaEConfirmacao(conversa);
    const viva = await reservar(conversa, lBruno, "13:30");
    expect(viva).toMatchObject({ ok: true });
    expect(await agendar(conversa, perguntada.hold_id)).toEqual({
      ok: false,
      motivo: "reserva_diferente",
    });
    expect(await consultasDoContato(contato)).toBe(0);
    const { data: reservas } = await admin
      .from("slot_hold")
      .select("id, consumido_em")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(reservas).toEqual([{ id: viva.hold_id, consumido_em: null }]);
    // A IA pergunta de novo, o paciente confirma, e a reserva viva marca.
    await perguntaEConfirmacao(conversa);
    const marcada = await agendar(conversa, viva.hold_id);
    expect(marcada).toMatchObject({ ok: true, reutilizado: false });
    expect(Date.parse(marcada.starts_at!)).toBe(Date.parse(as("13:30")));
  });

  it("D-8: para outra pessoa e menor de idade passam para a equipe, e nada é marcado", async () => {
    const { contato, conversa } = await novaConversa();
    expect(await reservar(conversa, lAna, "15:30")).toMatchObject({ ok: true });
    await perguntaEConfirmacao(conversa);
    expect(await registrar(conversa, { titular: false })).toEqual({
      ok: false,
      motivo: "consulta_para_outra_pessoa",
    });
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "consulta_para_outra_pessoa",
    });
    const menor = await registrar(conversa, {
      nome: "Paciente Integração Menor",
      nascimento: NASCIMENTO_DE_MENOR,
    });
    expect(menor).toMatchObject({ ok: false, motivo: "menor_de_idade" });
    expect(typeof menor.dados_id).toBe("string");
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "menor_de_idade",
    });
    expect(await consultasDoContato(contato)).toBe(0);
  });

  it("o nascimento de menor no cadastro do contato também passa para a equipe, antes dos dados que faltam", async () => {
    const { contato, conversa } = await novaConversa();
    await admin
      .from("contact")
      .update({ birth_date: NASCIMENTO_DE_MENOR })
      .eq("id", contato)
      .throwOnError();
    expect(await reservar(conversa, lAna, "16:00")).toMatchObject({ ok: true });
    await perguntaEConfirmacao(conversa);
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "menor_de_idade",
    });
    expect(await consultasDoContato(contato)).toBe(0);
  });

  it("a carteirinha: o convênio com Carteirinha obrigatória pede, e com ela a IA marca", async () => {
    const { conversa } = await novaConversa();
    expect(
      await registrar(conversa, {
        nome: "Paciente Integração Cinco",
        nascimento: "1985-05-05",
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    expect(await reservar(conversa, lConvenio, "16:30")).toMatchObject({
      ok: true,
    });
    await perguntaEConfirmacao(conversa);
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "faltam_dados",
      faltam: ["carteirinha"],
    });
    expect(
      await registrar(conversa, { carteirinha: "1234 5678 9" }),
    ).toMatchObject({ ok: true, faltam: [] });
    expect(await agendar(conversa)).toMatchObject({ ok: true });
  });

  it("dois registrar da mesma conversa ao mesmo tempo ficam numa linha só", async () => {
    const { conversa } = await novaConversa();
    const [nome, nascimento] = await Promise.all([
      registrar(conversa, { nome: "Paciente Integração Seis" }),
      registrar(conversa, { nascimento: "1991-01-01" }),
    ]);
    expect(nome.ok).toBe(true);
    expect(nascimento.ok).toBe(true);
    expect(nome.dados_id).toBe(nascimento.dados_id);
    const { data } = await admin
      .from("dados_informados_na_marcacao")
      .select("nome_completo, data_nascimento")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([
      {
        nome_completo: "Paciente Integração Seis",
        data_nascimento: "1991-01-01",
      },
    ]);
  });
});

describe("a janela da IA nos dados informados", () => {
  it("a marca de consulta para outra pessoa não sobrevive ao Assumir e Devolver", async () => {
    const { conversa } = await novaConversa();
    expect(await reservar(conversa, lBruno, "14:00")).toMatchObject({
      ok: true,
    });
    await perguntaEConfirmacao(conversa);
    expect(await registrar(conversa, { titular: false })).toEqual({
      ok: false,
      motivo: "consulta_para_outra_pessoa",
    });
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "consulta_para_outra_pessoa",
    });
    await assumir(conversa);
    const { data: devolvida, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: conversa,
    });
    expect(error).toBeNull();
    expect(devolvida).toEqual({ ok: true });
    // Na janela nova a marca nao vale: o agendar pede os dados e o estado
    // le que nada foi informado.
    expect(await agendar(conversa)).toEqual({
      ok: false,
      motivo: "faltam_dados",
      faltam: ["nome_completo", "data_nascimento"],
    });
    const lido = await rpcOk<{ dados?: Record<string, unknown> }>(
      "ler_atendimento_da_ia",
      {
        p_clinic_id: clinica,
        p_conversation_id: conversa,
        p_job_id: await job(conversa),
      },
    );
    expect(lido.dados).toMatchObject({
      nome_completo: false,
      data_nascimento: false,
      para_o_titular: null,
    });
    // O registrar na janela nova: a linha de antes sai e a IA marca.
    expect(
      await registrar(conversa, {
        nome: "Paciente Integração Oito",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    const { data: linhas } = await admin
      .from("dados_informados_na_marcacao")
      .select("para_o_titular, nome_completo")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(linhas).toEqual([
      { para_o_titular: true, nome_completo: "Paciente Integração Oito" },
    ]);
    expect(await agendar(conversa)).toMatchObject({ ok: true });
  });
});

describe("o estado do atendimento entre os turnos", () => {
  it("as versões; o mesmo job de novo parte do estado de antes dele; o job atrasado recebe estado_mudou", async () => {
    const { conversa } = await novaConversa();
    const j1 = await job(conversa);
    expect(await ler(conversa, j1)).toMatchObject({
      ok: true,
      versao: 0,
      estado: ESTADO_VAZIO,
    });
    const e1 = {
      ...ESTADO_VAZIO,
      etapa: "escolha",
      intencao: "agendar",
      procedure_id: consulta,
    };
    expect(await gravarOk(conversa, j1, 0, e1)).toEqual({
      ok: true,
      versao: 1,
      reutilizado: false,
    });
    // O mesmo job de novo (outra tentativa): le o estado de antes dele.
    expect(await ler(conversa, j1)).toMatchObject({
      ok: true,
      versao: 0,
      estado: ESTADO_VAZIO,
    });
    const e1b = { ...e1, professional_id: ana };
    expect(await gravarOk(conversa, j1, 0, e1b)).toEqual({
      ok: true,
      versao: 1,
      reutilizado: true,
    });
    // O job seguinte le o que o primeiro gravou por ultimo.
    const j2 = await job(conversa);
    expect(await ler(conversa, j2)).toMatchObject({
      ok: true,
      versao: 1,
      estado: e1b,
    });
    expect(
      await gravarOk(conversa, j2, 1, { ...e1b, etapa: "oferta" }),
    ).toEqual({ ok: true, versao: 2, reutilizado: false });
    // O primeiro job, atrasado, nao passa por cima.
    expect(await gravarOk(conversa, j1, 0, e1)).toEqual({
      ok: false,
      motivo: "estado_mudou",
    });
    const { data } = await admin
      .from("ia_atendimento")
      .select("etapa, professional_id, versao, job_id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([
      { etapa: "oferta", professional_id: ana, versao: 2, job_id: j2 },
    ]);
  });

  it("a gravação normaliza os horários oferecidos: instantes em UTC com Z, ids minúsculos", async () => {
    const { conversa } = await novaConversa();
    const j = await job(conversa);
    const oferecidoEm = new Date().toISOString();
    expect(
      await gravarOk(conversa, j, 0, {
        ...ESTADO_VAZIO,
        etapa: "oferta",
        intencao: "agendar",
        unit_id: sede.toUpperCase(),
        horarios_oferecidos: [
          {
            codigo: "h1",
            service_link_id: lAna.toUpperCase(),
            professional_id: ana.toUpperCase(),
            unit_id: sede.toUpperCase(),
            starts_at: `${dia}T10:30:00-03:00`,
            ends_at: `${dia}T11:00:00-03:00`,
            oferecido_em: oferecidoEm,
          },
        ],
      }),
    ).toMatchObject({ ok: true, versao: 1 });
    const lido = await ler(conversa, await job(conversa));
    expect(lido.estado?.unit_id).toBe(sede);
    const [h1] = lido.estado?.horarios_oferecidos ?? [];
    expect(h1).toMatchObject({
      codigo: "h1",
      service_link_id: lAna,
      professional_id: ana,
      unit_id: sede,
    });
    for (const chave of ["starts_at", "ends_at", "oferecido_em"] as const) {
      expect(String(h1?.[chave]), chave).toMatch(INSTANTE_EM_UTC);
    }
    expect(Date.parse(String(h1?.starts_at))).toBe(
      Date.parse(`${dia}T10:30:00-03:00`),
    );
    expect(Date.parse(String(h1?.oferecido_em))).toBe(Date.parse(oferecidoEm));
  });

  it("forma errada, id de outra clínica e job de outra conversa: 22023, e nada é gravado", async () => {
    const outra = await novaConversa();
    const jobDaOutra = await job(outra.conversa);
    const { conversa } = await novaConversa();
    const j = await job(conversa);
    const semODesfecho = Object.fromEntries(
      Object.entries(ESTADO_VAZIO).filter(([chave]) => chave !== "desfecho"),
    );
    for (const [caso, jobId, estado] of [
      ["etapa fora da lista", j, { ...ESTADO_VAZIO, etapa: "outra" }],
      ["chave faltando", j, semODesfecho],
      ["unidade de outra clínica", j, { ...ESTADO_VAZIO, unit_id: unidadeJ }],
      ["job de outra conversa", jobDaOutra, ESTADO_VAZIO],
    ] as [string, string, Record<string, unknown>][]) {
      const { data, error } = await gravar(conversa, jobId, 0, estado);
      expect(error?.code, caso).toBe(DADO_INVALIDO);
      expect(data, caso).toBeNull();
    }
    const { error: lerComOutroJob } = await admin.rpc("ler_atendimento_da_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: jobDaOutra,
    });
    expect(lerComOutroJob?.code).toBe(DADO_INVALIDO);
    const { data } = await admin
      .from("ia_atendimento")
      .select("id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([]);
  });

  it("a reserva do estado que sumiu no meio do turno é gravada nula, sem 22023", async () => {
    const { conversa } = await novaConversa();
    const reserva = await reservar(conversa, lBruno, "15:00");
    expect(reserva).toMatchObject({ ok: true });
    const j = await job(conversa);
    expect((await ler(conversa, j)).versao).toBe(0);
    // A manutencao apagou a reserva vencida (limpar_holds_vencidos): aqui,
    // so a deste caso.
    await admin
      .from("slot_hold")
      .delete()
      .eq("id", reserva.hold_id!)
      .throwOnError();
    expect(
      await gravarOk(conversa, j, 0, {
        ...ESTADO_VAZIO,
        etapa: "aguardando_confirmacao",
        intencao: "agendar",
        slot_hold_id: reserva.hold_id,
      }),
    ).toEqual({ ok: true, versao: 1, reutilizado: false });
    const { data } = await admin
      .from("ia_atendimento")
      .select("etapa, slot_hold_id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([
      { etapa: "aguardando_confirmacao", slot_hold_id: null },
    ]);
  });

  it("o job que não está em execução não grava (sem_posse)", async () => {
    const { conversa } = await novaConversa();
    const pendente = await job(conversa, "pendente");
    expect(await gravarOk(conversa, pendente, 0, ESTADO_VAZIO)).toEqual({
      ok: false,
      motivo: "sem_posse",
    });
    // Contraprova: o job em execucao grava.
    expect(
      await gravarOk(conversa, await job(conversa), 0, ESTADO_VAZIO),
    ).toMatchObject({ ok: true, versao: 1 });
  });

  it("Assumir tira da IA (fora_da_ia); o Devolver abre janela nova: o job de antes vira job_antigo e o estado recomeça", async () => {
    const { conversa } = await novaConversa();
    const antigo = await job(conversa);
    const escolha = { ...ESTADO_VAZIO, etapa: "escolha", intencao: "agendar" };
    expect(await gravarOk(conversa, antigo, 0, escolha)).toMatchObject({
      ok: true,
      versao: 1,
    });
    await assumir(conversa);
    expect(await ler(conversa, antigo)).toEqual({
      ok: false,
      motivo: "fora_da_ia",
    });
    expect(await gravarOk(conversa, antigo, 1, escolha)).toEqual({
      ok: false,
      motivo: "fora_da_ia",
    });
    const { data: devolvida, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: conversa,
    });
    expect(error).toBeNull();
    expect(devolvida).toEqual({ ok: true });
    expect(await ler(conversa, antigo)).toEqual({
      ok: false,
      motivo: "job_antigo",
    });
    expect(await gravarOk(conversa, antigo, 1, escolha)).toEqual({
      ok: false,
      motivo: "job_antigo",
    });
    const novo = await job(conversa);
    const lido = await ler(conversa, novo);
    expect(lido).toMatchObject({ ok: true, versao: 0, estado: ESTADO_VAZIO });
    expect(
      await gravarOk(conversa, novo, 0, { ...escolha, etapa: "oferta" }),
    ).toEqual({ ok: true, versao: 1, reutilizado: false });
    // O estado da janela de antes saiu na gravacao: uma linha, a da janela
    // nova.
    const { data } = await admin
      .from("ia_atendimento")
      .select("etapa, versao, janela_desde")
      .eq("conversation_id", conversa)
      .throwOnError();
    const linhas = data as {
      etapa: string;
      versao: number;
      janela_desde: string;
    }[];
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ etapa: "oferta", versao: 1 });
    expect(Date.parse(linhas[0]!.janela_desde)).toBe(
      Date.parse(lido.janela_desde!),
    );
  });

  it("dois jobs gravando sobre a mesma versão ao mesmo tempo: um grava, o outro recebe estado_mudou", async () => {
    const { conversa } = await novaConversa();
    const [ja, jb] = await Promise.all([job(conversa), job(conversa)]);
    expect((await ler(conversa, ja)).versao).toBe(0);
    expect((await ler(conversa, jb)).versao).toBe(0);
    const resultados = await Promise.all([
      gravarOk(conversa, ja, 0, { ...ESTADO_VAZIO, etapa: "escolha" }),
      gravarOk(conversa, jb, 0, { ...ESTADO_VAZIO, etapa: "oferta" }),
    ]);
    expect(resultados.filter((r) => r.ok)).toEqual([
      { ok: true, versao: 1, reutilizado: false },
    ]);
    expect(resultados.filter((r) => !r.ok)).toEqual([
      { ok: false, motivo: "estado_mudou" },
    ]);
    const { data } = await admin
      .from("ia_atendimento")
      .select("versao")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([{ versao: 1 }]);
  });
});

describe("a leitura dos dados pelo servidor e o rascunho novo", () => {
  it("o servidor lê os dados da consulta; a trilha fica sem usuário e sem conteúdo", async () => {
    expect(consultaComDados).not.toBe("");
    const lido = await rpcOk<{ dados: Record<string, unknown> | null }>(
      "ler_dados_informados_na_marcacao",
      { p_clinic_id: clinica, p_appointment_id: consultaComDados },
    );
    expect(lido.dados).toMatchObject({
      nome_completo: "Paciente Integração Um",
      data_nascimento: NASCIMENTO_DE_ADULTO,
      para_o_titular: true,
    });
    const { data } = await admin
      .from("audit_log")
      .select("user_id, entity, detalhes")
      .eq("clinic_id", clinica)
      .eq("action", "leu_dados_da_marcacao")
      .eq("entity_id", consultaComDados)
      .throwOnError();
    expect(data).toEqual([
      { user_id: null, entity: "appointment", detalhes: null },
    ]);
  });

  it("a clínica sem versão publicada: o primeiro rascunho nasce com nome completo e nascimento, sem CPF", async () => {
    const rascunho = await rpcOk<string>("garantir_rascunho_do_agente", {
      p_clinic_id: clinicaJ,
    });
    const { data } = await admin
      .from("ai_agent_config")
      .select("status, exige_nome_completo, exige_nascimento, exige_cpf")
      .eq("id", rascunho)
      .single()
      .throwOnError();
    expect(data).toEqual({
      status: "rascunho",
      exige_nome_completo: true,
      exige_nascimento: true,
      exige_cpf: false,
    });
  });
});

// Os casos que a revisao curta da AG3 (docs/04, 33.14) achou que faltavam,
// escritos na AG4 (27/10/2026). Usam o dia + 2 (horarios que nenhum outro
// caso deste arquivo usa: as reservas vivem 10 minutos e seguram o horario)
// e chamam as RPCs direto, com o instante e o job explicitos.
describe("os casos que faltavam (revisão curta da AG3, 33.14)", () => {
  const em = (hora: string): string => noDia(2, hora);

  async function reservarEm(
    conversa: string,
    vinculo: string,
    hora: string,
  ): Promise<Resposta> {
    return rpcOk<Resposta>("reservar_horario_da_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_service_link_id: vinculo,
      p_starts_at: em(hora),
      p_job_id: crypto.randomUUID(),
    });
  }

  async function agendarCom(
    conversa: string,
    jobId: string,
    reserva?: string,
  ): Promise<Resposta> {
    const args: Record<string, unknown> = {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: jobId,
    };
    if (reserva !== undefined) {
      args.p_slot_hold_id = reserva;
    }
    return rpcOk<Resposta>("agendar_pela_ia", args);
  }

  async function reservasVivas(conversa: string): Promise<string[]> {
    const { data } = await admin
      .from("slot_hold")
      .select("id")
      .eq("conversation_id", conversa)
      .is("consumido_em", null)
      .throwOnError();
    return (data as { id: string }[]).map((r) => r.id);
  }

  it("reserva_diferente no caminho idempotente (o mesmo job de novo) e a precedência dele sobre reserva_vencida", async () => {
    const { conversa } = await novaConversa();
    expect(
      await registrar(conversa, {
        nome: "Paciente Integração Nove",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    const reserva = await reservarEm(conversa, lAna, "14:00");
    expect(reserva).toMatchObject({ ok: true });
    await perguntaEConfirmacao(conversa);
    const j = crypto.randomUUID();
    const marcada = await agendarCom(conversa, j);
    expect(marcada).toMatchObject({ ok: true, reutilizado: false });
    // O mesmo job de novo, com outra reserva: reserva_diferente (nada muda);
    // com a reserva que ele consumiu: a mesma consulta.
    expect(await agendarCom(conversa, j, crypto.randomUUID())).toEqual({
      ok: false,
      motivo: "reserva_diferente",
    });
    expect(await agendarCom(conversa, j, reserva.hold_id)).toMatchObject({
      ok: true,
      appointment_id: marcada.appointment_id,
      reutilizado: true,
    });

    // A reserva viva vencida: o "sim" para outra reserva e reserva_diferente
    // (vem antes de reserva_vencida); para ela mesma, reserva_vencida.
    const outra = await novaConversa();
    expect(
      await registrar(outra.conversa, {
        nome: "Paciente Integração Dez",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toMatchObject({ ok: true, faltam: [] });
    const vencida = await reservarEm(outra.conversa, lAna, "14:30");
    expect(vencida).toMatchObject({ ok: true });
    await perguntaEConfirmacao(outra.conversa);
    await admin
      .from("slot_hold")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", vencida.hold_id!)
      .throwOnError();
    expect(
      await agendarCom(
        outra.conversa,
        crypto.randomUUID(),
        crypto.randomUUID(),
      ),
    ).toEqual({ ok: false, motivo: "reserva_diferente" });
    expect(
      await agendarCom(outra.conversa, crypto.randomUUID(), vencida.hold_id),
    ).toEqual({ ok: false, motivo: "reserva_vencida" });
    expect(await consultasDoContato(outra.contato)).toBe(0);
  });

  it("o reservar com ja_tem_consulta mantém a reserva que a conversa já tinha", async () => {
    const { contato, conversa } = await novaConversa();
    const doRetorno = await reservarEm(conversa, lRetorno, "15:00");
    expect(doRetorno).toMatchObject({ ok: true });
    // A recepcao marca uma Consulta para o contato.
    const daRecepcao = await inserir("appointment", {
      clinic_id: clinica,
      contact_id: contato,
      professional_id: ana,
      service_link_id: lAna,
      starts_at: noDia(4, "09:00"),
      ends_at: meiaHoraDepois(noDia(4, "09:00")),
      status: "agendado",
      created_by: "usuario",
    });
    expect(await reservarEm(conversa, lBruno, "15:30")).toMatchObject({
      ok: false,
      motivo: "ja_tem_consulta",
      appointment_id: daRecepcao,
    });
    expect(await reservasVivas(conversa)).toEqual([doRetorno.hold_id]);
  });

  it("a reserva de outra conversa continua 22023 no gravar; só a que sumiu vira nula", async () => {
    const dona = await novaConversa();
    const reserva = await reservarEm(dona.conversa, lBruno, "16:00");
    expect(reserva).toMatchObject({ ok: true });
    const { conversa } = await novaConversa();
    const { error } = await gravar(conversa, await job(conversa), 0, {
      ...ESTADO_VAZIO,
      etapa: "aguardando_confirmacao",
      intencao: "agendar",
      slot_hold_id: reserva.hold_id,
    });
    expect(error?.code).toBe(DADO_INVALIDO);
    const { data: nada } = await admin
      .from("ia_atendimento")
      .select("id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(nada).toEqual([]);
    // Contraprova: a que sumiu (nao existe mais) vira nula, sem erro.
    expect(
      await gravarOk(conversa, await job(conversa), 0, {
        ...ESTADO_VAZIO,
        etapa: "aguardando_confirmacao",
        intencao: "agendar",
        slot_hold_id: crypto.randomUUID(),
      }),
    ).toEqual({ ok: true, versao: 1, reutilizado: false });
  });

  it("o registrar sem janela da IA devolve ia_desligada, sem gravar", async () => {
    // A conversa na IA sem janela (montada direto: a ingestao sempre abre
    // a janela), com o telefone na lista (so a janela falta).
    const telefone = `+55843${digitos}01`;
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinica,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    const { data: existente } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinica)
      .eq("phone_e164", telefone)
      .maybeSingle()
      .throwOnError();
    const contato =
      (existente as { id: string } | null)?.id ??
      (await inserir("contact", {
        clinic_id: clinica,
        phone_e164: telefone,
        name: "Contato sintético sem janela",
      }));
    const conversa = await inserir("conversation", {
      clinic_id: clinica,
      contact_id: contato,
      whatsapp_account_id: numero,
      status: "ia_atendendo",
    });
    expect(
      await registrar(conversa, {
        nome: "Paciente Integração Onze",
        nascimento: NASCIMENTO_DE_ADULTO,
      }),
    ).toEqual({ ok: false, motivo: "ia_desligada" });
    const { data } = await admin
      .from("dados_informados_na_marcacao")
      .select("id")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(data).toEqual([]);
  });

  it("o dado inválido mantém, ignorada, a linha de outra janela", async () => {
    const { conversa } = await novaConversa();
    expect(await registrar(conversa, { titular: false })).toEqual({
      ok: false,
      motivo: "consulta_para_outra_pessoa",
    });
    await assumir(conversa);
    const { data: devolvida, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: conversa,
    });
    expect(error).toBeNull();
    expect(devolvida).toEqual({ ok: true });
    // Na janela nova, um CPF invalido: nada grava, e a linha da janela de
    // antes fica (ignorada: o estado le que nada foi informado).
    expect(await registrar(conversa, { cpf: "11111111111" })).toEqual({
      ok: false,
      motivo: "dados_invalidos",
      invalidos: ["cpf"],
    });
    const { data: linhas } = await admin
      .from("dados_informados_na_marcacao")
      .select("para_o_titular")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(linhas).toEqual([{ para_o_titular: false }]);
    const lido = await rpcOk<{ dados?: Record<string, unknown> }>(
      "ler_atendimento_da_ia",
      {
        p_clinic_id: clinica,
        p_conversation_id: conversa,
        p_job_id: await job(conversa),
      },
    );
    expect(lido.dados).toMatchObject({ para_o_titular: null });
  });
});
