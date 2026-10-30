import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Remarcar e cancelar pela IA (AG4, parte de banco: migration
// 20261028100000_remarcar_e_cancelar_pela_ia.sql) contra o banco REAL, pelo
// cliente de servico (o servidor, como o motor da IA chama). O que o ensaio
// nao prova, porque roda numa transacao so (now() fixo) e sem o PostgREST:
// as chamadas por HTTP, com os parametros por nome, em transacoes separadas
// (o instante do pedido e o da pergunta de verdade).
// - cancelar_consulta_pela_ia: cada recusa, na ordem do contrato (22004,
//   22023 job_invalido, ia_desligada, cancelamento_desligado,
//   sem_pedido_de_cancelamento, os motivos da conferencia, consulta_mudou e
//   sem_confirmacao_do_paciente); o caminho feliz (cancelado pelo paciente,
//   a trilha com autor ia e o job, o evento, a reoferta com fila ativa); a
//   idempotencia por job; a paridade com o botao da confirmacao
//   (cancelar_pelo_paciente);
// - [revisao da AG4] a ancora forte do "sim": uma automatica (autor sistema)
//   entre a pergunta e o "sim" nao cancela nem pede a remarcacao; a IA
//   pergunta de novo e o "sim" vale;
// - o reservar e o agendar com p_remarcar: as recusas, o ja_tem_consulta que
//   nao vale na remarcacao (outra consulta do mesmo procedimento de pe, com
//   outro profissional, e a pendente da IA nao barram; sem p_remarcar,
//   barram), a nova pendente ligada a antiga, a antiga com a marca, os
//   toques pulados, a linha de evento e o evento da conversa; a segunda
//   remarcacao da mesma consulta; o indice unico;
// - a aprovacao e a recusa pelo servidor: a antiga cancelada (trilha do
//   sistema, reoferta), a antiga ja atendida (23514 e a chave), a recusa que
//   devolve a conversa com o texto da remarcacao;
// - o gravar: o instante do pedido e do banco (o do codigo nao vale); pedido
//   sem consulta em foco e 22023; o turno seguinte com o mesmo pedido e o
//   mesmo foco mantem o instante enquanto ele vale, e outro foco carimba de
//   novo;
// - ao mesmo tempo (Promise.all): a IA e o botao na mesma consulta; duas
//   remarcacoes da mesma consulta por duas conversas do mesmo contato;
// - a antiga com remarcacao pendente, pelo servidor: so o fim ou so a
//   unidade tambem sao 23514 remarcacao_pendente, com a dica; o mesmo valor
//   passa; sem remarcacao pendente, mudam;
// - [revisao curta] o "sim" e uma mensagem que o job LEU: o cancelar e o
//   agendar gravam antes a linha do turno do job (ai_turno.mensagens_lidas,
//   como o motor antes de chamar o modelo); o paciente que escreve de novo
//   depois da leitura recebe mensagem_nova_do_paciente (nada cancelado nem
//   pedido) e o turno seguinte le e segue; a pergunta feita de novo por um
//   job criado depois da mudanca da consulta vale logo depois dela (o
//   consulta_mudou conta da criacao do job da pergunta respondida);
// - [revisao final] a mensagem do paciente so e nova se NENHUM turno a leu:
//   a duvida que o turno anterior leu e respondeu (enviado) nao barra o
//   "sim" que o job seguinte leu; com o turno anterior sem_envio, barra (o
//   job seguinte rele); com mensagem nova, ela responde antes de
//   consulta_mudou; a pergunta feita de novo so vale com o job dela criado
//   mais de 5 s depois da mudanca (a folga de c_folga_da_mudanca: o caso
//   espera 5,5 s).
// LIMITE (como na E4 e na AG3): os casos "ao mesmo tempo" disparam as RPCs
// por HTTP e NAO forcam a sobreposicao dentro do Postgres: provam o
// resultado final no banco real, nao a trava. A prova das travas, com
// sessoes de verdade esperando umas as outras, e o teste de concorrencia do
// harness local (~/.claude/plans/agente-completo/ag4/banco/travas), nunca na
// producao.
// LIMITE (a pergunta vencida, pedido_vencido): a pergunta respondida vale 60
// minutos e tem de ser depois do instante do pedido, que o BANCO carimba; e
// nenhum papel da API grava em ia_atendimento (o servidor so le), entao este
// arquivo nao consegue envelhecer o pedido e a pergunta sem esperar uma
// hora. O vencimento (a pergunta de 3 dias, o limite exato de 60 minutos, a
// ordem da recusa, a pergunta feita de novo que vale por si e o carimbo
// vencido renovado pelo gravar) e provado no ensaio do harness local
// (passos 5, 7b e 7c) e na simulacao dos testes (os instantes envelhecidos
// direto no banco local), nunca na producao.
//
// CUIDADO, o banco e o da producao: a clinica e_de_teste com o slug
// remarcar-ia-int-*, apagada no afterAll (consultas, reservas, estado,
// trilha, jobs e mensagens vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora). A IA liberada so nela (fora da
// lista fechada: nao depende do interruptor, so atende em numero 'fake' e o
// motor da IA de producao nunca a reivindica; os jobs sao montados direto e
// nenhum executor roda aqui; nenhuma mensagem sai: a reoferta fica na fila
// da clinica de teste, que e apagada). O interruptor global NUNCA e tocado.
// Telefones ficticios. ESCRITO, AINDA NAO RODADO: grava no banco. Roda
// depois de aplicar a migration, com
// npm run test:integration -- remarcar-e-cancelar-pela-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'remarcar-ia-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const FUSO = "America/Fortaleza";
const DADO_INVALIDO = "22023";
const PARAMETRO_NULO = "22004";
const VIOLA_CHECK = "23514";
const CHAVE_DUPLICADA = "23505";
const DICA_DA_ANTIGA =
  "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.";

type Resposta = {
  ok: boolean;
  motivo?: string;
  erro?: string;
  appointment_id?: string;
  hold_id?: string;
  starts_at?: string;
  ends_at?: string;
  remarcacao_de?: string;
  remarcacao_de_starts_at?: string;
  reutilizado?: boolean;
};

let clinica = "";
let numero = "";
let numero2 = "";
let ana = "";
let bruno = "";
let lAna = "";
let lBruno = "";
let lRetorno = "";
let lEquipe = "";
let passo = "";
let versao = 1;
let telefones = 0;

// Daqui a 3 dias, no fuso da clinica: fora dos prazos (24 h para cancelar e
// 48 h para remarcar), dentro da antecedencia (2 h) e do horizonte (30
// dias). Cada consulta usa um horario proprio (a exclusion por
// profissional).
const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string, mais = 0): string =>
  instanteLocal(FUSO, somarDias(dia, mais), hora).toISOString();
const meiaHoraDepois = (inicio: string): string =>
  new Date(Date.parse(inicio) + 30 * 60_000).toISOString();
const daquiA = (horas: number): string =>
  new Date(Date.now() + horas * 3_600_000).toISOString();

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

/** Publica uma versao nova da configuracao (a de numero maior e a que vale). */
async function publicar(
  skills: Record<string, boolean>,
  cancelar: number | null,
  remarcar: number | null,
): Promise<void> {
  versao += 1;
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: versao,
    status: "publicada",
    skills,
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
    cancelar_antecedencia_horas: cancelar,
    remarcar_antecedencia_horas: remarcar,
  });
}

const TUDO_LIGADO = { agendar: true, cancelar: true, remarcar: true };

/**
 * Telefone liberado, contato e conversa NA IA pela ingestao (com a janela),
 * no numero dado. Cada caso ingere logo antes de usar: a manutencao de
 * producao devolve a conversa de teste que espera resposta ha mais de 3
 * minutos.
 */
async function conversaNaIa(
  noNumero = "",
  telefoneDado = "",
): Promise<{ contato: string; conversa: string; telefone: string }> {
  // O numero desta chamada fica guardado antes do primeiro await: duas
  // chamadas ao mesmo tempo nao dividem o contador (a licao da AG3).
  telefones += 1;
  const n = telefones;
  const telefone =
    telefoneDado || `+55845${digitos}${String(n).padStart(2, "0")}`;
  if (!telefoneDado) {
    // O contato nasce paciente e o telefone, forcado, ANTES de a conversa
    // existir (o forcado so vale gravado depois do sinal de paciente): a
    // consulta que o caso cria depois nao abre janela para a manutencao do
    // motor (a cada minuto) tirar a conversa de teste da IA
    // (ia_pode_falar_com), o que dava ia_desligada ao acaso.
    await admin
      .from("contact")
      .insert({
        clinic_id: clinica,
        phone_e164: telefone,
        name: "Contato sintético",
        kind: "paciente",
      })
      .throwOnError();
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinica,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      p_confirmou_teste_com_paciente: true,
    });
  }
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `remarcar-ia-int:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: noNumero || numero,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id!, telefone };
}

/** Um job da IA em execucao da conversa (como o claim deixaria). */
async function job(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `remarcar-ia-int-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

function estado(
  pedido: "cancelar" | "remarcar" | null,
  consulta: string | null,
  instante: string | null = null,
): Record<string, unknown> {
  return {
    etapa: pedido ?? "informacao",
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
    pedido_pendente_em: instante,
    falhas_seguidas: 0,
    desfecho: null,
  };
}

async function versaoDoEstado(conversa: string): Promise<number> {
  const { data } = await admin
    .from("ia_atendimento")
    .select("versao")
    .eq("conversation_id", conversa)
    .maybeSingle()
    .throwOnError();
  return (data as { versao: number } | null)?.versao ?? 0;
}

/** Arma o pedido (cancelar ou remarcar) com o foco na consulta. */
async function armar(
  conversa: string,
  pedido: "cancelar" | "remarcar",
  consulta: string,
): Promise<void> {
  const gravado = await rpcOk<{ ok: boolean }>("gravar_atendimento_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: await job(conversa),
    p_versao: await versaoDoEstado(conversa),
    p_estado: estado(pedido, consulta),
  });
  expect(gravado, "armar o pedido").toMatchObject({ ok: true });
}

/**
 * Uma mensagem da conversa: a pergunta da IA, o "sim" do paciente ou uma
 * automatica (autor sistema: a regua, uma campanha, uma agendada). Cada uma
 * num pedido HTTP proprio (o instante de cada uma e o do banco, em ordem).
 */
async function mensagem(
  conversa: string,
  quem: "ia" | "paciente" | "automatica",
): Promise<void> {
  const linhaDaMensagem = {
    ia: { direction: "saida", author: "ia", body: "Pergunta sintética da IA" },
    paciente: {
      direction: "entrada",
      author: "paciente",
      body: "Mensagem sintética de confirmação",
    },
    automatica: {
      direction: "saida",
      author: "sistema",
      body: "Mensagem sintética automática",
    },
  }[quem];
  await admin
    .from("message")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      content_type: "texto",
      ...linhaDaMensagem,
    })
    .throwOnError();
}

/** A pergunta da IA e a resposta do paciente depois dela. */
async function perguntaEConfirmacao(conversa: string): Promise<void> {
  await mensagem(conversa, "ia");
  await mensagem(conversa, "paciente");
}

/**
 * [revisao curta] O job leu a conversa, como o motor antes de chamar o
 * modelo: as mensagens do paciente (nao apagadas) vao para
 * ai_turno.mensagens_lidas da linha do turno do job.
 */
async function leu(jobId: string, conversa: string): Promise<void> {
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
        clinic_id: clinica,
        conversation_id: conversa,
        estado: "reservado",
        mensagens_lidas: (data as { id: string }[]).map((m) => m.id),
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
}

/**
 * [revisao final] A linha do turno de um job com o estado e as lidas dados,
 * como o motor deixa: reservado ao ler; enviado, passou_para_equipe,
 * decidido ou sem_envio depois.
 */
async function turno(
  jobId: string,
  conversa: string,
  estadoDoTurno:
    "reservado" | "decidido" | "enviado" | "passou_para_equipe" | "sem_envio",
  lidas: string[],
): Promise<void> {
  await admin
    .from("ai_turno")
    .upsert(
      {
        job_id: jobId,
        clinic_id: clinica,
        conversation_id: conversa,
        estado: estadoDoTurno,
        mensagens_lidas: lidas,
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
}

/** [revisao final] A mensagem do paciente mais nova da conversa (o id). */
async function ultimaDoPaciente(conversa: string): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("conversation_id", conversa)
    .eq("direction", "entrada")
    .eq("author", "paciente")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

const esperar = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const PERGUNTA_DO_JOB = "Pergunta sintética da IA, do job";

/**
 * [revisao curta] A pergunta da IA escrita por um job (message.job_id), com
 * a decisao aprovada do mesmo job e do mesmo texto (o gatilho de message
 * exige). O contato com consulta tem sinal de paciente: o telefone volta
 * para a lista com o forcar (o caminho de definir_contato_liberado_da_ia).
 */
async function perguntaDoJob(
  conversa: string,
  telefone: string,
  jobId: string,
): Promise<void> {
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
  });
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: jobId,
      aprovado: true,
      texto_sha256: createHash("sha256")
        .update(PERGUNTA_DO_JOB, "utf8")
        .digest("hex"),
      desfecho: "respondeu",
    })
    .throwOnError();
  await admin
    .from("message")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      direction: "saida",
      author: "ia",
      content_type: "texto",
      body: PERGUNTA_DO_JOB,
      job_id: jobId,
    })
    .throwOnError();
}

/** O instante do pedido gravado pelo banco (o estado da conversa). */
async function instanteDoPedido(conversa: string): Promise<string | null> {
  const { data } = await admin
    .from("ia_atendimento")
    .select("pedido_pendente_em")
    .eq("conversation_id", conversa)
    .single()
    .throwOnError();
  return (data as { pedido_pendente_em: string | null }).pedido_pendente_em;
}

/** Uma consulta direta (como a recepcao marca), de 30 minutos. */
async function consulta(
  contato: string,
  vinculo: string,
  inicio: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data: sl } = await admin
    .from("service_link")
    .select("professional_id")
    .eq("id", vinculo)
    .single()
    .throwOnError();
  return inserir("appointment", {
    clinic_id: clinica,
    contact_id: contato,
    professional_id: (sl as { professional_id: string }).professional_id,
    service_link_id: vinculo,
    starts_at: inicio,
    ends_at: meiaHoraDepois(inicio),
    status: "agendado",
    created_by: "usuario",
    ...extra,
  });
}

/**
 * O cancelar pelo servidor. ler (padrao): antes, o job le a conversa (como
 * o motor); false: as lidas do job ficam como estao (a mensagem que chega
 * depois da leitura).
 */
async function cancelar(
  conversa: string,
  consultaId: string,
  jobId?: string,
  ler = true,
): Promise<Resposta> {
  const j = jobId ?? (await job(conversa));
  if (ler) {
    await leu(j, conversa);
  }
  return rpcOk<Resposta>("cancelar_consulta_pela_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: j,
    p_appointment_id: consultaId,
  });
}

async function reservar(
  conversa: string,
  vinculo: string,
  inicio: string,
  remarcar?: string,
): Promise<Resposta> {
  const args: Record<string, unknown> = {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_service_link_id: vinculo,
    p_starts_at: inicio,
    p_job_id: await job(conversa),
  };
  if (remarcar !== undefined) {
    args.p_remarcar = remarcar;
  }
  return rpcOk<Resposta>("reservar_horario_da_ia", args);
}

/** O agendar pelo servidor; ler como no cancelar. */
async function agendar(
  conversa: string,
  reserva: string | undefined,
  remarcar?: string,
  jobId?: string,
  ler = true,
): Promise<Resposta> {
  const j = jobId ?? (await job(conversa));
  if (ler) {
    await leu(j, conversa);
  }
  const args: Record<string, unknown> = {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: j,
  };
  if (reserva !== undefined) {
    args.p_slot_hold_id = reserva;
  }
  if (remarcar !== undefined) {
    args.p_remarcar = remarcar;
  }
  return rpcOk<Resposta>("agendar_pela_ia", args);
}

/** O pedido de cancelar armado, a pergunta e o "sim" (o caminho do motor). */
async function prontoParaCancelar(
  conversa: string,
  consultaId: string,
): Promise<void> {
  await armar(conversa, "cancelar", consultaId);
  await perguntaEConfirmacao(conversa);
}

/** O pedido de remarcar, a reserva com p_remarcar, a pergunta e o "sim". */
async function prontoParaRemarcar(
  conversa: string,
  antiga: string,
  vinculo: string,
  inicio: string,
): Promise<string> {
  await armar(conversa, "remarcar", antiga);
  const reserva = await reservar(conversa, vinculo, inicio, antiga);
  expect(reserva, "a reserva da remarcacao").toMatchObject({ ok: true });
  await perguntaEConfirmacao(conversa);
  return reserva.hold_id!;
}

async function linha(id: string) {
  const { data } = await admin
    .from("appointment")
    .select(
      "status, approval_status, created_by, remarcacao_de, remarcacao_pedida_em, oferecer_vaga_ao_cancelar, send_confirmation",
    )
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    approval_status: string | null;
    created_by: string;
    remarcacao_de: string | null;
    remarcacao_pedida_em: string | null;
    oferecer_vaga_ao_cancelar: boolean;
    send_confirmation: boolean;
  };
}

async function reofertas(consultaId: string): Promise<number> {
  const { count } = await admin
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinica)
    .eq("kind", "oferecer_lista_espera")
    .eq("payload->>appointment_id", consultaId)
    .throwOnError();
  return count ?? 0;
}

async function trilhaDeCancelamento(consultaId: string) {
  const { data } = await admin
    .from("appointment_status_history")
    .select("status, changed_by, changed_by_user_id, ia_job_id")
    .eq("appointment_id", consultaId)
    .like("status", "cancelado%")
    .throwOnError();
  return data as {
    status: string;
    changed_by: string;
    changed_by_user_id: string | null;
    ia_job_id: string | null;
  }[];
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "remarcar-ia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinica = await inserir("clinic", {
    name: `Remarcar IA integração ${sufixo}`,
    slug: `remarcar-ia-int-i-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  numero2 = (await criarNumeroDeTeste(admin, clinica, { nome: "Segundo" })).id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da AG4",
  });
  for (const n of [numero, numero2]) {
    await rpcOk("definir_numero_da_ia", {
      p_clinic_id: clinica,
      p_whatsapp_account_id: n,
      p_ativo: true,
    });
  }
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    skills: TUDO_LIGADO,
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
    cancelar_antecedencia_horas: 24,
    remarcar_antecedencia_horas: 48,
  });

  ana = await inserir("professional", { clinic_id: clinica, name: "Dra. Ana" });
  bruno = await inserir("professional", {
    clinic_id: clinica,
    name: "Dr. Bruno",
  });
  const consultaProc = await inserir("procedure", {
    clinic_id: clinica,
    name: "Consulta sintética",
    default_duration_min: 30,
  });
  const retornoProc = await inserir("procedure", {
    clinic_id: clinica,
    name: "Retorno sintético",
    default_duration_min: 30,
  });
  const equipeProc = await inserir("procedure", {
    clinic_id: clinica,
    name: "Só com a equipe sintético",
    default_duration_min: 30,
    bookable_by_ai: false,
  });
  const vinculo = (l: Record<string, unknown>) =>
    inserir("service_link", { clinic_id: clinica, duration_min: 30, ...l });
  lAna = await vinculo({
    professional_id: ana,
    procedure_id: consultaProc,
    price_cents: 20000,
  });
  lBruno = await vinculo({
    professional_id: bruno,
    procedure_id: consultaProc,
    price_cents: 20000,
  });
  lRetorno = await vinculo({
    professional_id: ana,
    procedure_id: retornoProc,
    price_cents: 15000,
  });
  lEquipe = await vinculo({
    professional_id: ana,
    procedure_id: equipeProc,
    price_cents: 15000,
  });
  await admin
    .from("professional_schedule")
    .insert(
      [ana, bruno].flatMap((profissional) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          clinic_id: clinica,
          professional_id: profissional,
          weekday,
          starts_at: "07:00",
          ends_at: "20:00",
        })),
      ),
    )
    .throwOnError();

  // A fila de espera ativa (a reoferta) e um passo na regua de confirmacao
  // da clinica (a clinica nasce com ela), para os toques das consultas.
  const daFila = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55844${digitos}99`,
    name: "Paciente sintético da fila",
  });
  await inserir("waitlist", {
    clinic_id: clinica,
    contact_id: daFila,
    procedure_id: consultaProc,
    active: true,
  });
  const { data: regua } = await admin
    .from("cadence")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("kind", "confirmacao")
    .order("created_at")
    .limit(1)
    .single()
    .throwOnError();
  passo = await inserir("cadence_step", {
    clinic_id: clinica,
    cadence_id: (regua as { id: string }).id,
    offset_minutes: -2880,
    fixed_body: "Toque sintético",
  });
}, 120_000);

afterAll(async () => {
  if (clinica) {
    const { error } = await admin.from("clinic").delete().eq("id", clinica);
    expect(error, "apagar a clinica do teste").toBeNull();
  }
}, 60_000);

describe("cancelar_consulta_pela_ia: cada recusa, na ordem do contrato", () => {
  it("parâmetro nulo é 22004; job que não é da conversa é 22023", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:00"));
    const { error: nulo } = await admin.rpc("cancelar_consulta_pela_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: await job(conversa),
      p_appointment_id: null,
    });
    expect(nulo?.code).toBe(PARAMETRO_NULO);
    const outra = await conversaNaIa();
    for (const jobId of [crypto.randomUUID(), await job(outra.conversa)]) {
      const { error } = await admin.rpc("cancelar_consulta_pela_ia", {
        p_clinic_id: clinica,
        p_conversation_id: conversa,
        p_job_id: jobId,
        p_appointment_id: alvo,
      });
      expect(error?.code).toBe(DADO_INVALIDO);
      expect(error?.message).toBe("job_invalido");
    }
  });

  it("ia_desligada, cancelamento_desligado e sem_pedido_de_cancelamento", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:30"));
    await prontoParaCancelar(conversa, alvo);
    // A versao em uso sem a habilidade, e sem o prazo.
    await publicar({ agendar: true, remarcar: true }, 24, 48);
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "cancelamento_desligado",
    });
    await publicar(TUDO_LIGADO, null, 48);
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "cancelamento_desligado",
    });
    await publicar(TUDO_LIGADO, 24, 48);
    // O pedido de outra consulta (o foco mudou): sem pedido para esta.
    const outra = await consulta(contato, lRetorno, as("09:00"));
    await armar(conversa, "cancelar", outra);
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "sem_pedido_de_cancelamento",
    });
    // A conversa com a equipe.
    await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", conversa)
      .throwOnError();
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "ia_desligada",
    });
    expect((await linha(alvo)).status).toBe("agendado");
  });

  it("os motivos da conferência: dentro do prazo, encaixe, só com a equipe, remarcação pendente e a já cancelada", async () => {
    // Dentro do prazo de 24 h.
    {
      const { contato, conversa } = await conversaNaIa();
      const alvo = await consulta(contato, lAna, daquiA(20));
      await prontoParaCancelar(conversa, alvo);
      expect(await cancelar(conversa, alvo)).toEqual({
        ok: false,
        motivo: "fora_do_prazo",
      });
    }
    // Encaixe.
    {
      const { contato, conversa } = await conversaNaIa();
      const alvo = await consulta(contato, lAna, as("09:30"), {
        is_overbooking: true,
      });
      await prontoParaCancelar(conversa, alvo);
      expect(await cancelar(conversa, alvo)).toEqual({
        ok: false,
        motivo: "encaixe",
      });
    }
    // O procedimento que a IA nao agenda.
    {
      const { contato, conversa } = await conversaNaIa();
      const alvo = await consulta(contato, lEquipe, as("10:00"));
      await prontoParaCancelar(conversa, alvo);
      expect(await cancelar(conversa, alvo)).toEqual({
        ok: false,
        motivo: "so_com_a_equipe",
      });
    }
    // A consulta com uma remarcacao pendente (direta, pelo servidor).
    {
      const { contato, conversa } = await conversaNaIa();
      const alvo = await consulta(contato, lAna, as("10:30"));
      await consulta(contato, lAna, as("10:30", 1), {
        created_by: "ia",
        approval_status: "pendente",
        oferecer_vaga_ao_cancelar: false,
        remarcacao_de: alvo,
      });
      await prontoParaCancelar(conversa, alvo);
      expect(await cancelar(conversa, alvo)).toEqual({
        ok: false,
        motivo: "remarcacao_pendente",
      });
    }
    // A cancelada pelo botao depois da pergunta.
    {
      const { contato, conversa } = await conversaNaIa();
      const alvo = await consulta(contato, lAna, as("11:00"));
      await prontoParaCancelar(conversa, alvo);
      const botao = await rpcOk<Resposta>("cancelar_pelo_paciente", {
        p_clinic_id: clinica,
        p_appointment_id: alvo,
        p_contact_id: contato,
        p_conversation_id: conversa,
      });
      expect(botao.ok).toBe(true);
      expect(await cancelar(conversa, alvo)).toEqual({
        ok: false,
        motivo: "consulta_encerrada",
      });
    }
  });

  it("consulta_mudou: a recepção remarcou depois da pergunta; sem_confirmacao_do_paciente: sem o sim", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("11:30"));
    await armar(conversa, "cancelar", alvo);
    // Sem a pergunta e o sim.
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "sem_confirmacao_do_paciente",
    });
    await perguntaEConfirmacao(conversa);
    // A recepcao move a consulta (a Agenda: update da linha, o gatilho grava
    // a linha kind remarcacao na trilha) depois do pedido.
    await admin
      .from("appointment")
      .update({ starts_at: as("12:00"), ends_at: meiaHoraDepois(as("12:00")) })
      .eq("id", alvo)
      .throwOnError();
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "consulta_mudou",
    });
    expect((await linha(alvo)).status).toBe("agendado");
  });

  it("a âncora forte: uma automática entre a pergunta e o sim não cancela; a IA pergunta de novo e o sim vale", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:00", 3));
    await armar(conversa, "cancelar", alvo);
    // A regua (ou uma campanha) sai entre a pergunta e o "sim": o "sim" pode
    // ser a resposta a ela.
    await mensagem(conversa, "ia");
    await mensagem(conversa, "automatica");
    await mensagem(conversa, "paciente");
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "sem_confirmacao_do_paciente",
    });
    expect((await linha(alvo)).status).toBe("agendado");
    expect(await trilhaDeCancelamento(alvo)).toEqual([]);
    expect(await reofertas(alvo)).toBe(0);
    // A IA pergunta de novo depois da automatica e o paciente responde.
    await perguntaEConfirmacao(conversa);
    expect(await cancelar(conversa, alvo)).toMatchObject({
      ok: true,
      reutilizado: false,
    });
    expect((await linha(alvo)).status).toBe("cancelado_paciente");
  });

  it("[revisão curta, B1] o paciente escreve de novo depois de o job ler o sim: mensagem_nova_do_paciente, nada cancelado; o turno seguinte lê e cancela", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:00", 5));
    await prontoParaCancelar(conversa, alvo);
    // O job le o "sim" (antes de chamar o modelo) e o paciente escreve de
    // novo ("nao, espera") antes da RPC.
    const jobId = await job(conversa);
    await leu(jobId, conversa);
    await mensagem(conversa, "paciente");
    expect(await cancelar(conversa, alvo, jobId, false)).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    expect((await linha(alvo)).status).toBe("agendado");
    expect(await trilhaDeCancelamento(alvo)).toEqual([]);
    expect(await reofertas(alvo)).toBe(0);
    // Sem a linha do turno do job: nada lido.
    expect(await cancelar(conversa, alvo, await job(conversa), false)).toEqual(
      { ok: false, motivo: "mensagem_nova_do_paciente" },
    );
    // O turno seguinte le as duas (o texto e do modelo; o banco deixa).
    expect(await cancelar(conversa, alvo)).toMatchObject({
      ok: true,
      reutilizado: false,
    });
  });

  it("[revisão curta, B2; revisão final] a recepção muda a consulta depois da pergunta: consulta_mudou; a pergunta feita de novo, por um job criado mais de 5 s depois da mudança, vale", async () => {
    const { contato, conversa, telefone } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:30", 5));
    await armar(conversa, "cancelar", alvo);
    await perguntaDoJob(conversa, telefone, await job(conversa));
    await admin
      .from("appointment")
      .update({
        starts_at: as("09:30", 5),
        ends_at: meiaHoraDepois(as("09:30", 5)),
      })
      .eq("id", alvo)
      .throwOnError();
    // [revisao final] A folga de 5 s (c_folga_da_mudanca): a mudanca com
    // changed_at ate 5 s antes da criacao do job da pergunta conta. O job do
    // "sim" (que pergunta de novo) nasce 5,5 s depois da mudanca.
    await esperar(5_500);
    await mensagem(conversa, "paciente");
    // O job do "sim" nasce depois da mudanca: e ele que pergunta de novo.
    const doSim = await job(conversa);
    expect(await cancelar(conversa, alvo, doSim)).toEqual({
      ok: false,
      motivo: "consulta_mudou",
    });
    await perguntaDoJob(conversa, telefone, doSim);
    await mensagem(conversa, "paciente");
    // Antes da revisao curta, a folga de 2 minutos contava do pedido e este
    // "sim" recebia consulta_mudou de novo (a terceira rodada).
    expect(await cancelar(conversa, alvo)).toMatchObject({
      ok: true,
      reutilizado: false,
    });
    expect((await linha(alvo)).status).toBe("cancelado_paciente");
  });

  it("[revisão final, M1] a dúvida que o turno anterior leu e respondeu não é mensagem nova: com ele enviado, o sim do job seguinte cancela; com ele sem_envio, não", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("13:00", 5));
    await armar(conversa, "cancelar", alvo);
    // A pergunta; a duvida do paciente ("e presencial?"), que o job J1 le;
    // o "sim" chega no meio do turno de J1; a resposta de J1 e gravada
    // depois do "sim"; o job J2 le so o "sim" (a duvida ja foi respondida).
    await mensagem(conversa, "ia");
    await mensagem(conversa, "paciente");
    const duvida = await ultimaDoPaciente(conversa);
    const j1 = await job(conversa);
    await turno(j1, conversa, "reservado", [duvida]);
    await mensagem(conversa, "paciente");
    const sim = await ultimaDoPaciente(conversa);
    await mensagem(conversa, "ia");
    await turno(j1, conversa, "sem_envio", [duvida]);
    const j2 = await job(conversa);
    await turno(j2, conversa, "reservado", [sim]);
    // J1 sem_envio: as lidas dele nao contam (o job seguinte as rele).
    expect(await cancelar(conversa, alvo, j2, false)).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    expect((await linha(alvo)).status).toBe("agendado");
    // J1 enviado: a duvida foi respondida; antes da revisao final, so as
    // lidas do job contavam e este "sim" ficava sem turno seguinte.
    await turno(j1, conversa, "enviado", [duvida]);
    expect(await cancelar(conversa, alvo, j2, false)).toMatchObject({
      ok: true,
      reutilizado: false,
    });
    expect((await linha(alvo)).status).toBe("cancelado_paciente");
  });

  it("[revisão final, M1b] com mensagem nova, ela responde antes de consulta_mudou; lida, consulta_mudou", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("13:30", 5));
    await prontoParaCancelar(conversa, alvo);
    const jobId = await job(conversa);
    await leu(jobId, conversa);
    await admin
      .from("appointment")
      .update({
        starts_at: as("14:30", 5),
        ends_at: meiaHoraDepois(as("14:30", 5)),
      })
      .eq("id", alvo)
      .throwOnError();
    await mensagem(conversa, "paciente");
    expect(await cancelar(conversa, alvo, jobId, false)).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    expect(await cancelar(conversa, alvo)).toEqual({
      ok: false,
      motivo: "consulta_mudou",
    });
    expect((await linha(alvo)).status).toBe("agendado");
  });
});

describe("cancelar_consulta_pela_ia: o caminho feliz, a idempotência e a paridade com o botão", () => {
  it("cancela pelo paciente, com a trilha da IA e o job, o evento, a reoferta; os toques ficam (o executor para)", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("12:30"));
    await inserir("cadence_run", {
      clinic_id: clinica,
      cadence_step_id: passo,
      contact_id: contato,
      appointment_id: alvo,
      scheduled_for: daquiA(24),
    });
    await prontoParaCancelar(conversa, alvo);
    const jobId = await job(conversa);
    const r = await cancelar(conversa, alvo, jobId);
    expect(r).toMatchObject({ ok: true, reutilizado: false });
    expect(Date.parse(r.starts_at!)).toBe(Date.parse(as("12:30")));
    expect((await linha(alvo)).status).toBe("cancelado_paciente");
    expect(await trilhaDeCancelamento(alvo)).toEqual([
      {
        status: "cancelado_paciente",
        changed_by: "ia",
        changed_by_user_id: null,
        ia_job_id: jobId,
      },
    ]);
    const { data: eventos } = await admin
      .from("message")
      .select("body, author, billable, cost_cents")
      .eq("conversation_id", conversa)
      .eq("content_type", "evento")
      .like("body", "A IA cancelou%")
      .throwOnError();
    expect(eventos).toEqual([
      {
        body: expect.stringMatching(
          /^A IA cancelou a consulta de \d{2}\/\d{2} às 12:30 \(Consulta sintética, Dra\. Ana\), a pedido do paciente\.$/,
        ),
        author: "sistema",
        billable: false,
        cost_cents: 0,
      },
    ]);
    expect(await reofertas(alvo)).toBe(1);
    const { data: toques } = await admin
      .from("cadence_run")
      .select("skipped_reason, sent_at")
      .eq("appointment_id", alvo)
      .throwOnError();
    expect(toques).toEqual([{ skipped_reason: null, sent_at: null }]);

    // O mesmo job de novo: volta como foi, sem outra trilha nem evento.
    const deNovo = await cancelar(conversa, alvo, jobId);
    expect(deNovo).toMatchObject({ ok: true, reutilizado: true });
    expect(await trilhaDeCancelamento(alvo)).toHaveLength(1);
    // O mesmo job com outra consulta: 22023.
    const outra = await consulta(contato, lRetorno, as("13:00"));
    const { error } = await admin.rpc("cancelar_consulta_pela_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: jobId,
      p_appointment_id: outra,
    });
    expect(error?.code).toBe(DADO_INVALIDO);
    expect(error?.message).toBe("job_de_outra_consulta");
  });

  it("a paridade com o botão da confirmação: a mesma situação, a mesma reoferta, os mesmos toques", async () => {
    const pelaIa = await conversaNaIa();
    const peloBotao = await conversaNaIa();
    const daIa = await consulta(pelaIa.contato, lAna, as("13:30"));
    const doBotao = await consulta(peloBotao.contato, lAna, as("14:00"));
    for (const [contato, alvo] of [
      [pelaIa.contato, daIa],
      [peloBotao.contato, doBotao],
    ] as const) {
      await inserir("cadence_run", {
        clinic_id: clinica,
        cadence_step_id: passo,
        contact_id: contato,
        appointment_id: alvo,
        scheduled_for: daquiA(24),
      });
    }
    await prontoParaCancelar(pelaIa.conversa, daIa);
    expect((await cancelar(pelaIa.conversa, daIa)).ok).toBe(true);
    const botao = await rpcOk<Resposta>("cancelar_pelo_paciente", {
      p_clinic_id: clinica,
      p_appointment_id: doBotao,
      p_contact_id: peloBotao.contato,
      p_conversation_id: peloBotao.conversa,
    });
    expect(botao.ok).toBe(true);
    const [a, b] = [await linha(daIa), await linha(doBotao)];
    expect(a).toEqual(b);
    expect(await reofertas(daIa)).toBe(await reofertas(doBotao));
    const toques = async (alvo: string) =>
      (
        await admin
          .from("cadence_run")
          .select("skipped_reason, sent_at")
          .eq("appointment_id", alvo)
          .throwOnError()
      ).data;
    expect(await toques(daIa)).toEqual(await toques(doBotao));
    // So a autoria muda: ia (com o job) e paciente.
    expect((await trilhaDeCancelamento(daIa))[0]!.changed_by).toBe("ia");
    expect((await trilhaDeCancelamento(doBotao))[0]).toMatchObject({
      changed_by: "paciente",
      ia_job_id: null,
    });
  });

  it("a pendente que a IA marcou: cancela pelo mesmo caminho e continua pendente (conta como recusada), sem reoferta", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("14:30"), {
      created_by: "ia",
      approval_status: "pendente",
      send_confirmation: false,
      oferecer_vaga_ao_cancelar: false,
    });
    await prontoParaCancelar(conversa, alvo);
    expect((await cancelar(conversa, alvo)).ok).toBe(true);
    expect(await linha(alvo)).toMatchObject({
      status: "cancelado_paciente",
      approval_status: "pendente",
    });
    expect(await reofertas(alvo)).toBe(0);
  });
});

describe("remarcar: o reservar e o agendar com p_remarcar", () => {
  it("as recusas do reservar: a habilidade, o pedido, o vínculo e o prazo de remarcar (48 h)", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("15:00"));
    // Sem p_remarcar, a antiga barra (ja_tem_consulta, como hoje).
    expect(await reservar(conversa, lAna, as("15:00", 1))).toMatchObject({
      ok: false,
      motivo: "ja_tem_consulta",
      appointment_id: antiga,
    });
    expect(await reservar(conversa, lAna, as("15:00", 1), antiga)).toEqual({
      ok: false,
      motivo: "sem_pedido_de_remarcacao",
    });
    await armar(conversa, "remarcar", antiga);
    await publicar({ agendar: true, cancelar: true }, 24, 48);
    expect(await reservar(conversa, lAna, as("15:00", 1), antiga)).toEqual({
      ok: false,
      motivo: "remarcacao_desligada",
    });
    await publicar(TUDO_LIGADO, 24, 48);
    expect(await reservar(conversa, lBruno, as("15:00", 1), antiga)).toEqual({
      ok: false,
      motivo: "remarcacao_invalida",
    });
    expect(await reservar(conversa, lRetorno, as("15:00", 1), antiga)).toEqual({
      ok: false,
      motivo: "remarcacao_invalida",
    });
    // A antiga 30 h a frente: dentro do prazo de remarcar (48 h), nao do de
    // cancelar (24 h).
    const perto = await consulta(contato, lRetorno, daquiA(30));
    await armar(conversa, "remarcar", perto);
    expect(await reservar(conversa, lRetorno, as("16:00", 1), perto)).toEqual({
      ok: false,
      motivo: "fora_do_prazo",
    });
    // O caminho feliz: na remarcacao, o ja_tem_consulta nao vale; nada grava
    // na antiga.
    await armar(conversa, "remarcar", antiga);
    expect(
      await reservar(conversa, lAna, as("15:00", 1), antiga),
    ).toMatchObject({
      ok: true,
      reutilizado: false,
    });
    expect(await linha(antiga)).toMatchObject({
      status: "agendado",
      remarcacao_pedida_em: null,
    });
  });

  it("o agendar: a nova pendente ligada à antiga; na antiga, a marca, os toques pulados e a linha de evento", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("16:30"));
    await inserir("cadence_run", {
      clinic_id: clinica,
      cadence_step_id: passo,
      contact_id: contato,
      appointment_id: antiga,
      scheduled_for: daquiA(24),
    });
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("16:30", 2),
    );
    const jobId = await job(conversa);
    const r = await agendar(conversa, reserva, antiga, jobId);
    expect(r).toMatchObject({
      ok: true,
      reutilizado: false,
      remarcacao_de: antiga,
    });
    expect(Date.parse(r.starts_at!)).toBe(Date.parse(as("16:30", 2)));
    expect(Date.parse(r.remarcacao_de_starts_at!)).toBe(
      Date.parse(as("16:30")),
    );
    const nova = r.appointment_id!;
    expect(await linha(nova)).toEqual({
      status: "agendado",
      approval_status: "pendente",
      created_by: "ia",
      remarcacao_de: antiga,
      remarcacao_pedida_em: null,
      oferecer_vaga_ao_cancelar: false,
      send_confirmation: false,
    });
    const velha = await linha(antiga);
    expect(velha.status).toBe("agendado");
    expect(velha.remarcacao_pedida_em).not.toBeNull();
    const { data: toques } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("appointment_id", antiga)
      .throwOnError();
    expect(toques).toEqual([{ skipped_reason: "remarcacao_pedida" }]);
    const { data: eventos } = await admin
      .from("appointment_status_history")
      .select("event, changed_by, status")
      .eq("appointment_id", antiga)
      .not("event", "is", null)
      .throwOnError();
    expect(eventos).toEqual([
      { event: "remarcacao_pedida", changed_by: "ia", status: "agendado" },
    ]);
    const { data: noFio } = await admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversa)
      .like("body", "A IA pediu a remarcação%")
      .throwOnError();
    expect(noFio).toEqual([
      {
        body: expect.stringMatching(
          /^A IA pediu a remarcação da consulta de \d{2}\/\d{2} às 16:30 para \d{2}\/\d{2} às 16:30 \(Consulta sintética, Dra\. Ana\), pendente de aprovação da equipe\.$/,
        ),
      },
    ]);
    expect(await reofertas(antiga)).toBe(0);
    // O mesmo job de novo devolve a mesma, com a antiga.
    expect(await agendar(conversa, reserva, antiga, jobId)).toMatchObject({
      ok: true,
      appointment_id: nova,
      reutilizado: true,
      remarcacao_de: antiga,
    });
    // Uma segunda remarcacao da mesma consulta: o reservar ja recusa; o
    // indice unico impede a segunda pendente direto.
    await armar(conversa, "remarcar", antiga);
    expect(await reservar(conversa, lAna, as("17:00", 2), antiga)).toEqual({
      ok: false,
      motivo: "remarcacao_pendente",
    });
    const { error } = await admin.from("appointment").insert({
      clinic_id: clinica,
      contact_id: contato,
      professional_id: ana,
      service_link_id: lAna,
      starts_at: as("17:30", 2),
      ends_at: meiaHoraDepois(as("17:30", 2)),
      status: "agendado",
      created_by: "ia",
      approval_status: "pendente",
      remarcacao_de: antiga,
    });
    expect(error?.code).toBe(CHAVE_DUPLICADA);
  });

  it("outra consulta do mesmo procedimento de pé (com outro profissional, e a pendente da IA) não barra a remarcação; sem p_remarcar, barra", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("11:00", 3));
    // O mesmo procedimento (Consulta sintetica) com o Dr. Bruno, e a pendente
    // que a IA marcou com a Dra. Ana.
    const outra = await consulta(contato, lBruno, as("11:00", 4));
    const pendente = await consulta(contato, lAna, as("12:00", 4), {
      created_by: "ia",
      approval_status: "pendente",
      send_confirmation: false,
      oferecer_vaga_ao_cancelar: false,
    });
    // Sem p_remarcar, como hoje: barra, apontando a mais proxima.
    expect(await reservar(conversa, lAna, as("13:00", 4))).toMatchObject({
      ok: false,
      motivo: "ja_tem_consulta",
      appointment_id: antiga,
    });
    // Na remarcacao, nenhuma barra (a remarcacao troca uma consulta por
    // outra), nem no reservar nem no agendar.
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("13:00", 4),
    );
    expect(await agendar(conversa, reserva, antiga)).toMatchObject({
      ok: true,
      reutilizado: false,
      remarcacao_de: antiga,
    });
    expect(await linha(outra)).toMatchObject({
      status: "agendado",
      approval_status: null,
    });
    expect(await linha(pendente)).toMatchObject({
      status: "agendado",
      approval_status: "pendente",
    });
  });

  it("a âncora forte no agendar da remarcação: uma automática entre a pergunta e o sim não pede a remarcação; a IA pergunta de novo e o sim vale", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("10:00", 3));
    await armar(conversa, "remarcar", antiga);
    const reserva = await reservar(conversa, lAna, as("10:00", 4), antiga);
    expect(reserva, "a reserva da remarcacao").toMatchObject({ ok: true });
    await mensagem(conversa, "ia");
    await mensagem(conversa, "automatica");
    await mensagem(conversa, "paciente");
    expect(await agendar(conversa, reserva.hold_id, antiga)).toEqual({
      ok: false,
      motivo: "sem_confirmacao_do_paciente",
    });
    expect(await linha(antiga)).toMatchObject({
      status: "agendado",
      remarcacao_pedida_em: null,
    });
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("remarcacao_de", antiga)
      .throwOnError();
    expect(count).toBe(0);
    // A IA pergunta de novo e o paciente responde: a remarcacao e pedida.
    await perguntaEConfirmacao(conversa);
    expect(await agendar(conversa, reserva.hold_id, antiga)).toMatchObject({
      ok: true,
      reutilizado: false,
      remarcacao_de: antiga,
    });
  });

  it("[revisão curta, B1] na remarcação, a mensagem que o job não leu: mensagem_nova_do_paciente, nada pedido; o turno seguinte lê e a remarcação é pedida", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("10:00", 5));
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("10:00", 6),
    );
    const jobId = await job(conversa);
    await leu(jobId, conversa);
    await mensagem(conversa, "paciente");
    expect(await agendar(conversa, reserva, antiga, jobId, false)).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    expect(await linha(antiga)).toMatchObject({
      status: "agendado",
      remarcacao_pedida_em: null,
    });
    expect(await agendar(conversa, reserva, antiga)).toMatchObject({
      ok: true,
      reutilizado: false,
      remarcacao_de: antiga,
    });
  });
});

describe("a aprovação e a recusa da remarcação (pelo servidor)", () => {
  it("aprovar cancela a antiga pelo paciente (trilha do sistema, reoferta); com a antiga atendida, 23514 e nada muda", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("08:00", 1));
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("08:00", 2),
    );
    const nova = (await agendar(conversa, reserva, antiga)).appointment_id!;
    await admin
      .from("appointment")
      .update({
        approval_status: "aprovado",
        send_confirmation: true,
        oferecer_vaga_ao_cancelar: true,
      })
      .eq("id", nova)
      .throwOnError();
    expect((await linha(antiga)).status).toBe("cancelado_paciente");
    expect(await trilhaDeCancelamento(antiga)).toEqual([
      {
        status: "cancelado_paciente",
        changed_by: "sistema",
        changed_by_user_id: null,
        ia_job_id: null,
      },
    ]);
    expect(await reofertas(antiga)).toBe(1);

    // A antiga ja atendida: a aprovacao nao acontece.
    const outro = await conversaNaIa();
    const atendida = await consulta(outro.contato, lBruno, as("08:00", 1));
    const reserva2 = await prontoParaRemarcar(
      outro.conversa,
      atendida,
      lBruno,
      as("08:30", 2),
    );
    const nova2 = (await agendar(outro.conversa, reserva2, atendida))
      .appointment_id!;
    await admin
      .from("appointment")
      .update({ status: "na_recepcao" })
      .eq("id", atendida)
      .throwOnError();
    const { error } = await admin
      .from("appointment")
      .update({ approval_status: "aprovado" })
      .eq("id", nova2);
    expect(error?.code).toBe(VIOLA_CHECK);
    expect(error?.message).toBe("remarcacao_consulta_antiga_encerrada");
    expect((await linha(nova2)).approval_status).toBe("pendente");
  });

  it("recusar deixa a antiga intacta (com a marca) e devolve a conversa com o texto da remarcação", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("09:00", 1));
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("09:00", 2),
    );
    const nova = (await agendar(conversa, reserva, antiga)).appointment_id!;
    await admin
      .from("appointment")
      .update({
        approval_status: "recusado",
        status: "cancelado_clinica",
        oferecer_vaga_ao_cancelar: false,
      })
      .eq("id", nova)
      .throwOnError();
    expect(
      await rpcOk<boolean>("devolver_conversa_da_consulta_recusada", {
        p_clinic_id: clinica,
        p_appointment_id: nova,
      }),
    ).toBe(true);
    const velha = await linha(antiga);
    expect(velha.status).toBe("agendado");
    expect(velha.remarcacao_pedida_em).not.toBeNull();
    const { data: eventos } = await admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversa)
      .like("body", "A equipe recusou%")
      .throwOnError();
    expect(eventos).toEqual([
      {
        body: expect.stringMatching(
          /^A equipe recusou a remarcação pedida pela IA\. A consulta de \d{2}\/\d{2} às 09:00 continua marcada\. Avise o paciente\.$/,
        ),
      },
    ]);
  });
});

describe("o gravar: o instante do pedido é do banco", () => {
  it("o instante que o código manda não vale; pedido sem consulta em foco é 22023", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("10:00", 1));
    const antes = Date.now();
    const gravado = await rpcOk<{ ok: boolean }>("gravar_atendimento_da_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: await job(conversa),
      p_versao: await versaoDoEstado(conversa),
      p_estado: estado("cancelar", alvo, "2000-01-01T00:00:00Z"),
    });
    expect(gravado).toMatchObject({ ok: true });
    const { data } = await admin
      .from("ia_atendimento")
      .select("pedido_pendente_em")
      .eq("conversation_id", conversa)
      .single()
      .throwOnError();
    const instante = Date.parse(
      (data as { pedido_pendente_em: string }).pedido_pendente_em,
    );
    expect(instante).toBeGreaterThan(antes - 60_000);
    expect(instante).toBeLessThan(Date.now() + 60_000);
    const { error } = await admin.rpc("gravar_atendimento_da_ia", {
      p_clinic_id: clinica,
      p_conversation_id: conversa,
      p_job_id: await job(conversa),
      p_versao: await versaoDoEstado(conversa),
      p_estado: estado("cancelar", null),
    });
    expect(error?.code).toBe(DADO_INVALIDO);
  });

  it("o turno seguinte com o mesmo pedido e o mesmo foco mantém o instante enquanto ele vale; outro foco carimba de novo", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("08:30", 3));
    const outra = await consulta(contato, lRetorno, as("09:00", 3));
    await armar(conversa, "cancelar", alvo);
    const primeiro = await instanteDoPedido(conversa);
    expect(primeiro).not.toBeNull();
    // Um job novo, o mesmo pedido e o mesmo foco, dentro dos 60 minutos: o
    // instante fica (a pergunta de antes continua valendo).
    await armar(conversa, "cancelar", alvo);
    expect(await instanteDoPedido(conversa)).toBe(primeiro);
    // Outro foco: o pedido e outro, o instante e de agora.
    await armar(conversa, "cancelar", outra);
    const segundo = await instanteDoPedido(conversa);
    expect(Date.parse(segundo!)).toBeGreaterThan(Date.parse(primeiro!));
  });
});

describe("ao mesmo tempo (Promise.all)", () => {
  it("a IA e o botão na mesma consulta: um cancela, o outro recebe a recusa; uma trilha só", async () => {
    const { contato, conversa } = await conversaNaIa();
    const alvo = await consulta(contato, lAna, as("11:00", 1));
    await prontoParaCancelar(conversa, alvo);
    const jobId = await job(conversa);
    const [daIa, doBotao] = await Promise.all([
      cancelar(conversa, alvo, jobId),
      rpcOk<Resposta>("cancelar_pelo_paciente", {
        p_clinic_id: clinica,
        p_appointment_id: alvo,
        p_contact_id: contato,
        p_conversation_id: conversa,
      }),
    ]);
    if (daIa.ok) {
      expect(doBotao).toEqual({ ok: false, erro: "ja_tratado" });
    } else {
      expect(daIa).toEqual({ ok: false, motivo: "consulta_encerrada" });
      expect(doBotao.ok).toBe(true);
    }
    expect(await trilhaDeCancelamento(alvo)).toHaveLength(1);
    expect(await reofertas(alvo)).toBe(1);
  });

  it("duas remarcações da mesma consulta, por duas conversas do mesmo contato: uma pendente só", async () => {
    const primeira = await conversaNaIa();
    // O mesmo telefone no segundo numero: outra conversa do mesmo contato.
    const segunda = await conversaNaIa(numero2, primeira.telefone);
    expect(segunda.contato).toBe(primeira.contato);
    const antiga = await consulta(primeira.contato, lAna, as("12:00", 1));
    const reserva1 = await prontoParaRemarcar(
      primeira.conversa,
      antiga,
      lAna,
      as("12:00", 2),
    );
    const reserva2 = await prontoParaRemarcar(
      segunda.conversa,
      antiga,
      lAna,
      as("12:30", 2),
    );
    const resultados = await Promise.all([
      agendar(primeira.conversa, reserva1, antiga),
      agendar(segunda.conversa, reserva2, antiga),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([
      { ok: false, motivo: "remarcacao_pendente" },
    ]);
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("remarcacao_de", antiga)
      .eq("approval_status", "pendente")
      .throwOnError();
    expect(count).toBe(1);
  });
});

// Por ultimo no arquivo: a unidade criada aqui nao muda os casos de cima.
describe("a antiga com a remarcação pendente: o fim e a unidade também ficam (D-32, pelo servidor)", () => {
  it("só o fim ou só a unidade: 23514 remarcacao_pendente com a dica; o mesmo valor passa; sem remarcação pendente, mudam", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await consulta(contato, lAna, as("14:00", 3));
    const reserva = await prontoParaRemarcar(
      conversa,
      antiga,
      lAna,
      as("14:00", 4),
    );
    expect(await agendar(conversa, reserva, antiga)).toMatchObject({
      ok: true,
      remarcacao_de: antiga,
    });
    const sede = await inserir("unit", {
      clinic_id: clinica,
      name: "Sede sintética",
    });
    const quarentaECincoDepois = (inicio: string): string =>
      new Date(Date.parse(inicio) + 45 * 60_000).toISOString();
    for (const [rotulo, mudanca] of [
      ["so o fim", { ends_at: quarentaECincoDepois(as("14:00", 3)) }],
      ["so a unidade", { unit_id: sede }],
    ] as const) {
      const { error } = await admin
        .from("appointment")
        .update(mudanca)
        .eq("id", antiga);
      expect(error?.code, rotulo).toBe(VIOLA_CHECK);
      expect(error?.message, rotulo).toBe("remarcacao_pendente");
      expect(error?.hint, rotulo).toBe(DICA_DA_ANTIGA);
    }
    // O mesmo fim e a mesma unidade (nenhuma) passam; a antiga fica como
    // estava, com a marca.
    const { data: igual } = await admin
      .from("appointment")
      .update({ ends_at: meiaHoraDepois(as("14:00", 3)), unit_id: null })
      .eq("id", antiga)
      .select("ends_at, unit_id, remarcacao_pedida_em")
      .throwOnError();
    const [ficou] = igual as {
      ends_at: string;
      unit_id: string | null;
      remarcacao_pedida_em: string | null;
    }[];
    expect(Date.parse(ficou!.ends_at)).toBe(
      Date.parse(meiaHoraDepois(as("14:00", 3))),
    );
    expect(ficou!.unit_id).toBeNull();
    expect(ficou!.remarcacao_pedida_em).not.toBeNull();
    // Positivo: a consulta sem remarcacao pendente muda o fim e a unidade.
    const livre = await consulta(contato, lRetorno, as("15:00", 3));
    const { data: mudou } = await admin
      .from("appointment")
      .update({
        ends_at: new Date(
          Date.parse(as("15:00", 3)) + 15 * 60_000,
        ).toISOString(),
        unit_id: sede,
      })
      .eq("id", livre)
      .select("unit_id")
      .throwOnError();
    expect(mudou).toEqual([{ unit_id: sede }]);
  });
});
