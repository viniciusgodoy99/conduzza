import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  prazoDaAcao,
  tipoDoContatoDoBanco,
  type ConfigDoAgente,
  type TipoDoContato,
} from "@/lib/domain/agente/config";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import { diaCivil } from "@/lib/domain/horarios";
import type { IntervaloOcupado } from "@/lib/domain/scheduling";
import { log } from "@/lib/log";

import {
  dadosQueFaltam,
  dadosVazios,
  type DadoDaMarcacao,
  type DadosInformados,
} from "./atendimento";
import {
  idDaConsulta,
  lerRespostaDoAgendar,
  type RespostaDoAgendar,
} from "./ferramentas/agendar";
import type {
  ConsultaLida,
  PortaDaAgenda,
  ReservaLida,
  ReservaVivaDaConversa,
} from "./ferramentas/agenda-do-turno";
import {
  lerRespostaDoCancelamento,
  type RespostaDoCancelamento,
} from "./ferramentas/cancelar-consulta";
import {
  conferirConsultaDaIa,
  consultaListavel,
  emOrdem,
  MAXIMO_DE_CONSULTAS_NA_LISTA,
  STATUS_ANTES_DO_ATENDIMENTO,
  type ConsultaDoContato,
  type ConsultasDoContato,
} from "./ferramentas/minhas-consultas";
import {
  horarioContinuaLivre,
  pedidoDaReconferencia,
  type AgendaCarregada,
  type JanelaDaAgenda,
  type PedidoDaAgenda,
} from "./ferramentas/buscar-horario";
import type { CatalogoDoAgente } from "./ferramentas/buscar-procedimento";
import {
  nomeDoCadastro,
  type CadastroDoContato,
} from "./ferramentas/cadastro-do-contato";
import {
  consultaQueAguardaConfirmacao,
  STATUS_QUE_AGUARDAM_CONFIRMACAO,
  type RespostaDaConfirmacao,
} from "./ferramentas/confirmar-presenca";
import {
  carteirinhaValida,
  cpfValido,
  idadeNoDia,
  lerRespostaDoRegistro,
  nascimentoValido,
  nomeCompletoValido,
  type DadosParaRegistrar,
  type RespostaDoRegistro,
} from "./ferramentas/registrar-dados";
import {
  idDaReserva,
  lerRespostaDaReserva,
  MINUTOS_DA_RESERVA,
  type RespostaDaReserva,
} from "./ferramentas/reservar-horario";

// A Agenda da IA no servidor (E4, contrato da E4 secao 2): o carregador de
// disponibilidade de buscar_horario e as RPCs de reservar_horario, agendar e
// confirmar_presenca, pelo cliente de SERVICE ROLE e sempre com o clinic_id
// explicito (o isolamento por clinica e AQUI: o motor nao tem sessao). O
// clinic_id, a conversa, o contato e o job vem do servidor (o job do E3),
// nunca do modelo.
//
// LGPD: a leitura traz SO horarios (jornada, bloqueio, consulta, reserva e
// recurso). Nada de nome, telefone, observacao ou id de contato de paciente
// sai daqui para o modelo; das consultas, so o inicio, o fim e o status. Log
// so com ids e codigos.
//
// Falha fechada: leitura que falha ou passa do prazo, RPC com erro e
// resposta fora do formato LANCAM; o turno (agenda-do-turno.ts) para com a
// frase fixa e a conversa vai para a equipe.

type Cliente = SupabaseClient;

/** Prazo de cada leitura e de cada RPC da agenda. */
export const PRAZO_DA_AGENDA_MS = 6_000;

/** Status de consulta que NAO ocupa o horario (a exclusion constraint). */
const STATUS_CANCELADOS = ["cancelado_paciente", "cancelado_clinica"] as const;

/** O PostgREST corta em max_rows sem erro: le por paginas, ordenado por id. */
const PAGINA = 1000;

async function todasAsPaginas<T>(
  pagina: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) {
      throw new Error("leitura da agenda falhou");
    }
    const lidas = (data ?? []) as T[];
    linhas.push(...lidas);
    if (lidas.length < PAGINA) {
      return linhas;
    }
  }
}

type LinhaDaJornada = {
  professional_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  /** AG3: a unidade da faixa (nula = qualquer unidade). */
  unit_id?: string | null;
};

type LinhaDeIntervalo = {
  professional_id?: string;
  resource_id?: string | null;
  service_link_id?: string | null;
  conversation_id?: string | null;
  starts_at: string;
  ends_at: string;
};

function intervalo(linha: LinhaDeIntervalo): IntervaloOcupado | null {
  const inicio = new Date(linha.starts_at);
  const fim = new Date(linha.ends_at);
  return Number.isFinite(inicio.getTime()) && Number.isFinite(fim.getTime())
    ? { startsAt: inicio, endsAt: fim }
    : null;
}

function agrupar(
  linhas: readonly LinhaDeIntervalo[],
  chave: (linha: LinhaDeIntervalo) => string | null | undefined,
): Map<string, IntervaloOcupado[]> {
  const grupos = new Map<string, IntervaloOcupado[]>();
  for (const linha of linhas) {
    const id = chave(linha);
    const lido = intervalo(linha);
    if (typeof id !== "string" || lido === null) {
      continue;
    }
    const lista = grupos.get(id) ?? [];
    lista.push(lido);
    grupos.set(id, lista);
  }
  return grupos;
}

/**
 * Le a Agenda do pedido de buscar_horario: a jornada semanal dos
 * profissionais (AG3: com a unidade de cada faixa; a busca filtra pela
 * unidade pedida, e a faixa sem unidade vale para todas), os bloqueios, as consultas nao
 * canceladas (encaixe conta) e as reservas vivas (vencimento no futuro e nao
 * consumidas) que se sobrepoem ao periodo, menos as desta conversa (a RPC
 * troca a reserva da conversa), e a ocupacao de cada recurso por qualquer
 * profissional: as consultas no recurso e (revisao da E4) as reservas vivas
 * de OUTRAS conversas nos vinculos cujo procedimento usa o recurso, como a
 * RPC confere. Lanca na leitura que falha ou passa do prazo.
 */
export async function carregarAgendaDaIa(
  admin: Cliente,
  e: {
    clinicId: string;
    /** A conversa do turno; null no simulador (toda reserva viva conta). */
    conversationId: string | null;
    pedido: PedidoDaAgenda;
    agoraMs: number;
  },
): Promise<AgendaCarregada> {
  const { clinicId, pedido } = e;
  const profissionais = [...new Set(pedido.profissionais)];
  const recursos = [...new Set(pedido.recursos)];
  /** service_link_id -> o recurso do procedimento dele. */
  const recursoDoVinculo = new Map(
    (pedido.vinculosDosRecursos ?? [])
      .filter((v) => recursos.includes(v.recursoId))
      .map((v) => [v.serviceLinkId, v.recursoId]),
  );
  const inicioIso = pedido.inicio.toISOString();
  const fimIso = pedido.fim.toISOString();
  const agoraIso = new Date(e.agoraMs).toISOString();
  const naoCancelada = `(${STATUS_CANCELADOS.join(",")})`;

  const leitura = async (): Promise<AgendaCarregada> => {
    if (profissionais.length === 0) {
      return {
        jornadas: new Map(),
        bloqueios: new Map(),
        consultas: new Map(),
        reservas: new Map(),
        recursos: new Map(),
      };
    }
    const [
      jornadas,
      bloqueios,
      consultas,
      reservas,
      doRecurso,
      reservasDoRecurso,
    ] = await Promise.all([
      todasAsPaginas<LinhaDaJornada>((de, ate) =>
        admin
          .from("professional_schedule")
          .select("professional_id, weekday, starts_at, ends_at, unit_id")
          .eq("clinic_id", clinicId)
          .in("professional_id", profissionais)
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      todasAsPaginas<LinhaDeIntervalo>((de, ate) =>
        admin
          .from("professional_block")
          .select("professional_id, starts_at, ends_at")
          .eq("clinic_id", clinicId)
          .in("professional_id", profissionais)
          .lt("starts_at", fimIso)
          .gt("ends_at", inicioIso)
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      // So o horario e o profissional: nunca contato, nome ou observacao.
      todasAsPaginas<LinhaDeIntervalo>((de, ate) =>
        admin
          .from("appointment")
          .select("professional_id, starts_at, ends_at")
          .eq("clinic_id", clinicId)
          .in("professional_id", profissionais)
          .not("status", "in", naoCancelada)
          .lt("starts_at", fimIso)
          .gt("ends_at", inicioIso)
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      todasAsPaginas<LinhaDeIntervalo>((de, ate) =>
        admin
          .from("slot_hold")
          .select("professional_id, conversation_id, starts_at, ends_at")
          .eq("clinic_id", clinicId)
          .in("professional_id", profissionais)
          .gt("expires_at", agoraIso)
          .is("consumido_em", null)
          .lt("starts_at", fimIso)
          .gt("ends_at", inicioIso)
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      recursos.length === 0
        ? Promise.resolve([] as LinhaDeIntervalo[])
        : todasAsPaginas<LinhaDeIntervalo>((de, ate) =>
            admin
              .from("appointment")
              .select("resource_id, starts_at, ends_at")
              .eq("clinic_id", clinicId)
              .in("resource_id", recursos)
              .not("status", "in", naoCancelada)
              .lt("starts_at", fimIso)
              .gt("ends_at", inicioIso)
              .order("id", { ascending: true })
              .range(de, ate),
          ),
      // As reservas vivas nos vinculos que usam os recursos (de qualquer
      // profissional): so horario, vinculo e conversa.
      recursoDoVinculo.size === 0
        ? Promise.resolve([] as LinhaDeIntervalo[])
        : todasAsPaginas<LinhaDeIntervalo>((de, ate) =>
            admin
              .from("slot_hold")
              .select("service_link_id, conversation_id, starts_at, ends_at")
              .eq("clinic_id", clinicId)
              .in("service_link_id", [...recursoDoVinculo.keys()])
              .gt("expires_at", agoraIso)
              .is("consumido_em", null)
              .lt("starts_at", fimIso)
              .gt("ends_at", inicioIso)
              .order("id", { ascending: true })
              .range(de, ate),
          ),
    ]);

    const porProfissional = new Map<string, JanelaDaAgenda[]>();
    for (const linha of jornadas) {
      if (
        typeof linha.professional_id !== "string" ||
        typeof linha.starts_at !== "string" ||
        typeof linha.ends_at !== "string" ||
        !Number.isInteger(linha.weekday)
      ) {
        continue;
      }
      const lista = porProfissional.get(linha.professional_id) ?? [];
      lista.push({
        weekday: linha.weekday,
        startsAt: linha.starts_at,
        endsAt: linha.ends_at,
        unidadeId: typeof linha.unit_id === "string" ? linha.unit_id : null,
      });
      porProfissional.set(linha.professional_id, lista);
    }
    // A reserva desta conversa nao ocupa: a RPC solta a anterior ao reservar
    // outra (uma por conversa).
    const deOutraConversa = (l: LinhaDeIntervalo) =>
      e.conversationId === null || l.conversation_id !== e.conversationId;
    return {
      jornadas: porProfissional,
      bloqueios: agrupar(bloqueios, (l) => l.professional_id),
      consultas: agrupar(consultas, (l) => l.professional_id),
      reservas: agrupar(
        reservas.filter(deOutraConversa),
        (l) => l.professional_id,
      ),
      recursos: agrupar(
        [
          ...doRecurso,
          ...reservasDoRecurso.filter(deOutraConversa).map((l) => ({
            ...l,
            resource_id: recursoDoVinculo.get(l.service_link_id ?? "") ?? null,
          })),
        ],
        (l) => l.resource_id,
      ),
    };
  };

  const corrida = await correrComPrazo(leitura, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    log.warn("ia_agenda_falhou", {
      clinic_id: clinicId,
      conversation_id: e.conversationId ?? undefined,
      kind: "leitura",
      error_code: corrida.tipo,
    });
    throw new Error("leitura da agenda falhou");
  }
  return corrida.valor;
}

/** Os ids que acompanham todo log e toda RPC do turno do WhatsApp. */
type IdsDoTurno = {
  clinicId: string;
  conversationId: string;
  contactId: string;
  jobId: string;
};

function falhou(ids: IdsDoTurno, kind: string, errorCode: string): never {
  log.warn("ia_agenda_falhou", {
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
    kind,
    error_code: errorCode,
  });
  throw new Error("agenda da ia falhou");
}

async function rpcComPrazo(
  admin: Cliente,
  funcao: string,
  parametros: Record<string, unknown>,
): Promise<{ tipo: "resultado"; valor: unknown } | { tipo: "erro" | "prazo" }> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc(funcao, parametros);
    if (error) {
      throw new Error("rpc");
    }
    return data as unknown;
  }, PRAZO_DA_AGENDA_MS);
  return corrida;
}

/** O vinculo de uma reserva (para a reserva reaproveitada). Nunca lanca. */
async function vinculoDaReserva(
  admin: Cliente,
  clinicId: string,
  holdId: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("slot_hold")
      .select("service_link_id")
      .eq("clinic_id", clinicId)
      .eq("id", holdId)
      .maybeSingle();
    const id = (data as { service_link_id?: unknown } | null)?.service_link_id;
    return !error && typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** O vinculo de uma consulta (para a marcacao reaproveitada). Nunca lanca. */
async function vinculoDaConsulta(
  admin: Cliente,
  clinicId: string,
  appointmentId: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("appointment")
      .select("service_link_id")
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle();
    const id = (data as { service_link_id?: unknown } | null)?.service_link_id;
    return !error && typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * reservar_horario_da_ia com o job_id do turno (contrato 1.3): repetir o job
 * devolve a mesma reserva (reutilizado), e o vinculo dela e lido para a
 * saida dizer os nomes certos. Lanca no erro, no prazo e na resposta fora do
 * formato.
 */
export async function reservarHorarioDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  pedido: {
    serviceLinkId: string;
    inicio: string;
    unidadeId?: string | null;
    /** AG4: a consulta que esta sendo remarcada (so manda quando vem). */
    remarcarId?: string | null;
  },
): Promise<RespostaDaReserva> {
  const corrida = await rpcComPrazo(admin, "reservar_horario_da_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_service_link_id: pedido.serviceLinkId,
    p_starts_at: pedido.inicio,
    p_job_id: ids.jobId,
    // AG3: a unidade do horario (null = como antes, todas as unidades).
    p_unit_id: pedido.unidadeId ?? null,
    // AG4: o modo de remarcacao (o codigo de antes chama sem ele).
    ...(pedido.remarcarId ? { p_remarcar: pedido.remarcarId } : {}),
  });
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "reservar", corrida.tipo);
  }
  const lida = lerRespostaDaReserva(corrida.valor);
  if (lida === null) {
    return falhou(ids, "reservar", "resposta_fora_do_formato");
  }
  if (lida.ok) {
    // A reserva nova e a do pedido; a reaproveitada (job repetido) pode ser
    // de outro horario: o vinculo dela e lido, e sem ele a saida fica sem os
    // nomes.
    const holdId = idDaReserva(corrida.valor);
    let serviceLinkId = lida.serviceLinkId;
    if (serviceLinkId === null) {
      serviceLinkId = !lida.reutilizado
        ? pedido.serviceLinkId
        : holdId === null
          ? null
          : await vinculoDaReserva(admin, ids.clinicId, holdId);
    }
    log.info("ia_agenda_reservou", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      status: lida.reutilizado ? "reutilizado" : "nova",
    });
    return { ...lida, serviceLinkId };
  }
  log.info("ia_agenda_reserva_recusada", {
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
    error_code: lida.motivo,
  });
  return lida;
}

/**
 * agendar_pela_ia com o job_id do turno (contrato 1.4): usa a reserva viva
 * da conversa; repetir o job devolve a mesma consulta. Revisao final da
 * AG3: com a reserva que a pergunta "Confirma ...?" mostrou (p_slot_hold_id;
 * a RPC recusa reserva_diferente quando a viva e outra). Sem ela (o turno
 * sem estado), como antes. Lanca no erro, no prazo e na resposta fora do
 * formato.
 */
export async function agendarPelaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  slotHoldId?: string | null,
  /** AG4: a consulta que esta sendo remarcada (so manda quando vem). */
  remarcarId?: string | null,
): Promise<RespostaDoAgendar> {
  const corrida = await rpcComPrazo(admin, "agendar_pela_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
    ...(slotHoldId === undefined ? {} : { p_slot_hold_id: slotHoldId }),
    ...(remarcarId ? { p_remarcar: remarcarId } : {}),
  });
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "agendar", corrida.tipo);
  }
  const lida = lerRespostaDoAgendar(corrida.valor);
  if (lida === null) {
    return falhou(ids, "agendar", "resposta_fora_do_formato");
  }
  if (lida.ok) {
    const appointmentId = idDaConsulta(corrida.valor);
    const serviceLinkId =
      lida.serviceLinkId ??
      (appointmentId === null
        ? null
        : await vinculoDaConsulta(admin, ids.clinicId, appointmentId));
    log.info(remarcarId ? "ia_agenda_remarcou" : "ia_agenda_marcou", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      status: lida.reutilizado ? "reutilizado" : "nova",
    });
    return { ...lida, serviceLinkId, appointmentId };
  }
  log.info("ia_agenda_marcacao_recusada", {
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
    error_code: lida.motivo,
  });
  return lida;
}

type LinhaDaConsultaDoContato = {
  id: string;
  status: string;
  starts_at: string;
  approval_status: string | null;
  service_link_id: string | null;
  /** AG4 (o limite da 21.15): o profissional, so para os fatos. */
  professional_id?: string | null;
};

/**
 * confirmar_presenca: a consulta futura do CONTATO da conversa que aguarda
 * confirmacao e nao esta pendente da equipe. Exatamente uma: chama
 * confirmar_pelo_paciente (que grava o evento na conversa). Nenhuma ou mais
 * de uma: o modelo passa para a equipe. Com uma reserva VIVA da IA nesta
 * conversa (revisao da E4), nada e confirmado: o "confirmo" da pessoa e do
 * horario reservado (agendar), e confirmar presenca gravaria a confirmacao
 * em outra consulta dela. Lanca no erro e no prazo.
 */
export async function confirmarPresencaPelaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  agoraMs: number,
): Promise<RespostaDaConfirmacao> {
  const reserva = await correrComPrazo(async () => {
    const { data, error } = await admin
      .from("slot_hold")
      .select("id")
      .eq("clinic_id", ids.clinicId)
      .eq("conversation_id", ids.conversationId)
      .is("consumido_em", null)
      .gt("expires_at", new Date(agoraMs).toISOString())
      .limit(1);
    if (error) {
      throw new Error("leitura");
    }
    return (data ?? []).length > 0;
  }, PRAZO_DA_AGENDA_MS);
  if (reserva.tipo !== "resultado") {
    return falhou(ids, "confirmar", reserva.tipo);
  }
  if (reserva.valor) {
    log.info("ia_agenda_confirmacao_recusada", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: "reserva_em_andamento",
    });
    return { ok: false, motivo: "reserva_em_andamento" };
  }
  const leitura = await correrComPrazo(async () => {
    const { data, error } = await admin
      .from("appointment")
      .select(
        "id, status, starts_at, approval_status, service_link_id, professional_id",
      )
      .eq("clinic_id", ids.clinicId)
      .eq("contact_id", ids.contactId)
      .in("status", [...STATUS_QUE_AGUARDAM_CONFIRMACAO])
      .gt("starts_at", new Date(agoraMs).toISOString())
      .or("approval_status.is.null,approval_status.eq.aprovado")
      .order("starts_at", { ascending: true })
      .limit(2);
    if (error) {
      throw new Error("leitura");
    }
    return (data ?? []) as LinhaDaConsultaDoContato[];
  }, PRAZO_DA_AGENDA_MS);
  if (leitura.tipo !== "resultado") {
    return falhou(ids, "confirmar", leitura.tipo);
  }
  const consultas = leitura.valor.filter((c) =>
    consultaQueAguardaConfirmacao(c, agoraMs),
  );
  const [consulta] = consultas;
  if (consulta === undefined) {
    return { ok: false, motivo: "sem_consulta" };
  }
  if (consultas.length > 1) {
    return { ok: false, motivo: "mais_de_uma" };
  }
  const corrida = await rpcComPrazo(admin, "confirmar_pelo_paciente", {
    p_clinic_id: ids.clinicId,
    p_appointment_id: consulta.id,
    p_contact_id: ids.contactId,
    p_conversation_id: ids.conversationId,
  });
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "confirmar", corrida.tipo);
  }
  const resposta = corrida.valor as {
    ok?: unknown;
    starts_at?: unknown;
  } | null;
  if (resposta?.ok !== true) {
    // ja_tratado: a consulta mudou entre a leitura e a confirmacao.
    return { ok: false, motivo: "sem_consulta" };
  }
  log.info("ia_agenda_confirmou_presenca", {
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
  });
  return {
    ok: true,
    inicio:
      typeof resposta.starts_at === "string"
        ? resposta.starts_at
        : consulta.starts_at,
    serviceLinkId: consulta.service_link_id,
    profissionalId:
      typeof consulta.professional_id === "string"
        ? consulta.professional_id
        : null,
  };
}

// ---------------------------------------------------------------------------
// AG3: os dados da marcacao, o cadastro do contato, a reserva e a consulta
// ---------------------------------------------------------------------------

/**
 * registrar_dados_da_marcacao com o job_id do turno (contrato da AG3). Os
 * valores vao so para a RPC (nunca para log). Lanca no erro, no prazo e na
 * resposta fora do formato.
 */
export async function registrarDadosDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  dados: DadosParaRegistrar,
): Promise<RespostaDoRegistro> {
  const corrida = await rpcComPrazo(admin, "registrar_dados_da_marcacao", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
    p_para_o_titular: dados.paraOTitular,
    p_nome_completo: dados.nomeCompleto,
    p_data_nascimento: dados.dataNascimento,
    p_cpf: dados.cpf,
    p_carteirinha: dados.carteirinha,
  });
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "registrar_dados", corrida.tipo);
  }
  const lida = lerRespostaDoRegistro(corrida.valor);
  if (lida === null) {
    return falhou(ids, "registrar_dados", "resposta_fora_do_formato");
  }
  log.info(lida.ok ? "ia_agenda_registrou_dados" : "ia_agenda_dados_recusados", {
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
    ...(lida.ok ? {} : { error_code: lida.motivo }),
  });
  return lida;
}

/**
 * Os sinais do cadastro do contato da conversa (consultar_cadastro_do_contato):
 * o tipo, o convenio, se o nome e confirmado (o criterio da aprovacao, a
 * trilha da equipe) e SE ha nascimento e CPF (contados pelo banco: o valor
 * nem e lido), e quantas consultas futuras ativas. Lanca na leitura que
 * falha ou passa do prazo.
 */
export async function lerCadastroDoContatoDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  agoraMs: number,
): Promise<CadastroDoContato> {
  const corrida = await correrComPrazo(async () => {
    const contato = admin
      .from("contact")
      .select("kind, insurance_id, criado_por_importacao")
      .eq("clinic_id", ids.clinicId)
      .eq("id", ids.contactId)
      .maybeSingle();
    // SE ha nome, nascimento e CPF: conta o contato com o campo preenchido
    // (o valor nunca sai do banco).
    const comNome = admin
      .from("contact")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("id", ids.contactId)
      .not("name", "is", null)
      .neq("name", "");
    const comNascimento = admin
      .from("contact")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("id", ids.contactId)
      .not("birth_date", "is", null);
    const comCpf = admin
      .from("contact")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("id", ids.contactId)
      .not("cpf", "is", null)
      .neq("cpf", "");
    const escritoPorAlguem = admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("entity", "contact")
      .eq("entity_id", ids.contactId)
      .in("action", ["criou", "editou"])
      .not("user_id", "is", null);
    const nomeAplicado = admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("entity", "contact")
      .eq("entity_id", ids.contactId)
      .eq("action", "aplicou_dados_da_marcacao")
      .contains("detalhes", { campos: ["name"] });
    const futuras = admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", ids.clinicId)
      .eq("contact_id", ids.contactId)
      .gt("starts_at", new Date(agoraMs).toISOString())
      .not(
        "status",
        "in",
        "(cancelado_paciente,cancelado_clinica,faltou,compareceu)",
      )
      .or("approval_status.is.null,approval_status.neq.recusado");
    const [c, nome, n, cpf, escrito, aplicado, f] = await Promise.all([
      contato,
      comNome,
      comNascimento,
      comCpf,
      escritoPorAlguem,
      nomeAplicado,
      futuras,
    ]);
    if (
      c.error ||
      nome.error ||
      n.error ||
      cpf.error ||
      escrito.error ||
      aplicado.error ||
      f.error
    ) {
      throw new Error("leitura");
    }
    const linha = c.data as {
      kind?: unknown;
      insurance_id?: unknown;
      criado_por_importacao?: unknown;
    } | null;
    if (linha === null) {
      throw new Error("sem contato");
    }
    return {
      tipo: tipoDoContatoDoBanco(linha.kind),
      nome: nomeDoCadastro({
        temNome: (nome.count ?? 0) > 0,
        criadoPorImportacao: linha.criado_por_importacao === true,
        escritoPorAlguem: (escrito.count ?? 0) > 0 || (aplicado.count ?? 0) > 0,
      }),
      temNascimento: (n.count ?? 0) > 0,
      temCpf: (cpf.count ?? 0) > 0,
      convenioId:
        typeof linha.insurance_id === "string" ? linha.insurance_id : null,
      consultasFuturas: f.count ?? 0,
    } satisfies CadastroDoContato;
  }, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "cadastro_do_contato", corrida.tipo);
  }
  return corrida.valor;
}

/** A reserva do estado (desta conversa): viva ou nao, e o horario dela. */
export async function lerReservaDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  holdId: string,
  agoraMs: number,
): Promise<ReservaLida | null> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin
      .from("slot_hold")
      .select("service_link_id, starts_at, ends_at, unit_id, expires_at, consumido_em")
      .eq("clinic_id", ids.clinicId)
      .eq("conversation_id", ids.conversationId)
      .eq("id", holdId)
      .maybeSingle();
    if (error) {
      throw new Error("leitura");
    }
    return data as {
      service_link_id?: unknown;
      starts_at?: unknown;
      ends_at?: unknown;
      unit_id?: unknown;
      expires_at?: unknown;
      consumido_em?: unknown;
    } | null;
  }, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "reserva_do_estado", corrida.tipo);
  }
  const linha = corrida.valor;
  if (
    linha === null ||
    typeof linha.service_link_id !== "string" ||
    typeof linha.starts_at !== "string" ||
    typeof linha.ends_at !== "string"
  ) {
    return null;
  }
  const expira =
    typeof linha.expires_at === "string" ? Date.parse(linha.expires_at) : NaN;
  return {
    viva:
      (linha.consumido_em === null || linha.consumido_em === undefined) &&
      Number.isFinite(expira) &&
      expira > agoraMs,
    serviceLinkId: linha.service_link_id,
    inicio: linha.starts_at,
    fim: linha.ends_at,
    unidadeId: typeof linha.unit_id === "string" ? linha.unit_id : null,
    // Revisao final da AG3: o vencimento (a reserva que vence no meio do
    // turno conta como vencida).
    expiraEm:
      typeof linha.expires_at === "string" && Number.isFinite(expira)
        ? linha.expires_at
        : null,
  };
}

/**
 * Revisao final da AG3: a reserva viva desta conversa, qualquer que seja (o
 * agendar recusou reserva_diferente: a viva nao e a perguntada). So horario,
 * vinculo, unidade e vencimento. Lanca na leitura que falha ou passa do
 * prazo.
 */
export async function lerReservaVivaDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  agoraMs: number,
): Promise<ReservaVivaDaConversa | null> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin
      .from("slot_hold")
      .select("id, service_link_id, starts_at, ends_at, unit_id, expires_at")
      .eq("clinic_id", ids.clinicId)
      .eq("conversation_id", ids.conversationId)
      .is("consumido_em", null)
      .gt("expires_at", new Date(agoraMs).toISOString())
      .order("expires_at", { ascending: false })
      .limit(1);
    if (error) {
      throw new Error("leitura");
    }
    return (data ?? []) as {
      id?: unknown;
      service_link_id?: unknown;
      starts_at?: unknown;
      ends_at?: unknown;
      unit_id?: unknown;
      expires_at?: unknown;
    }[];
  }, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "reserva_viva", corrida.tipo);
  }
  const [linha] = corrida.valor;
  if (
    linha === undefined ||
    typeof linha.id !== "string" ||
    typeof linha.service_link_id !== "string" ||
    typeof linha.starts_at !== "string" ||
    typeof linha.ends_at !== "string" ||
    typeof linha.expires_at !== "string"
  ) {
    return null;
  }
  return {
    holdId: linha.id,
    viva: Date.parse(linha.expires_at) > agoraMs,
    serviceLinkId: linha.service_link_id,
    inicio: linha.starts_at,
    fim: linha.ends_at,
    unidadeId: typeof linha.unit_id === "string" ? linha.unit_id : null,
    expiraEm: linha.expires_at,
  };
}

/**
 * Uma consulta do contato da conversa: SO o inicio, a unidade (revisao final
 * da AG3) e se continua de pe (nao cancelada, nao recusada, sem falta nem
 * comparecimento, no futuro).
 */
export async function lerConsultaDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  appointmentId: string,
  agoraMs: number,
): Promise<ConsultaLida | null> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin
      .from("appointment")
      .select(
        "starts_at, status, approval_status, unit_id, professional_id, service_link_id, remarcacao_de",
      )
      .eq("clinic_id", ids.clinicId)
      .eq("contact_id", ids.contactId)
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) {
      throw new Error("leitura");
    }
    return data as {
      starts_at?: unknown;
      status?: unknown;
      approval_status?: unknown;
      unit_id?: unknown;
      professional_id?: unknown;
      service_link_id?: unknown;
      remarcacao_de?: unknown;
    } | null;
  }, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "consulta_do_estado", corrida.tipo);
  }
  const linha = corrida.valor;
  if (linha === null || typeof linha.starts_at !== "string") {
    return null;
  }
  const inicio = Date.parse(linha.starts_at);
  return {
    inicio: linha.starts_at,
    ativa:
      Number.isFinite(inicio) &&
      inicio > agoraMs &&
      typeof linha.status === "string" &&
      !["cancelado_paciente", "cancelado_clinica", "faltou", "compareceu"].includes(
        linha.status,
      ) &&
      linha.approval_status !== "recusado",
    unidadeId: typeof linha.unit_id === "string" ? linha.unit_id : null,
    // AG4: o profissional (os fatos), o vinculo (a remarcacao e a nota), se
    // ainda espera a aprovacao e a consulta antiga da remarcacao.
    profissionalId:
      typeof linha.professional_id === "string" ? linha.professional_id : null,
    serviceLinkId:
      typeof linha.service_link_id === "string" ? linha.service_link_id : null,
    pendente: linha.approval_status === "pendente",
    remarcacaoDe:
      typeof linha.remarcacao_de === "string" ? linha.remarcacao_de : null,
    // Revisao da AG4 (achado 7): cancelada (pelo paciente ou pela clinica),
    // para o fato do cancelamento feito nesta conversa.
    cancelada:
      linha.status === "cancelado_paciente" ||
      linha.status === "cancelado_clinica",
  };
}

// ---------------------------------------------------------------------------
// AG4: as consultas do contato e o cancelamento pela IA
// ---------------------------------------------------------------------------

type LinhaDaConsultaListada = {
  id?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  status?: unknown;
  approval_status?: unknown;
  is_overbooking?: unknown;
  service_link_id?: unknown;
  professional_id?: unknown;
  unit_id?: unknown;
  remarcacao_de?: unknown;
};

/**
 * AG4: as consultas futuras do contato da conversa, nas quatro situacoes
 * antes do atendimento e sem as recusadas, ate MAXIMO_DE_CONSULTAS_NA_LISTA
 * (com ha_mais), e quais delas tem uma remarcacao pendente ligada. So o que
 * a ferramenta e a conferencia precisam: nada de observacao, nome ou
 * telefone. Lanca na leitura que falha ou passa do prazo. Revisao da AG4
 * (achados 1 e 9): com `apenas`, so aquela consulta (a mesma leitura e a
 * mesma conferencia, para reconferir a consulta em foco).
 */
export async function lerConsultasDoContatoDaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  agoraMs: number,
  apenas?: string,
): Promise<ConsultasDoContato> {
  const corrida = await correrComPrazo(async () => {
    const consulta = admin
      .from("appointment")
      .select(
        "id, starts_at, ends_at, status, approval_status, is_overbooking, service_link_id, professional_id, unit_id, remarcacao_de",
      )
      .eq("clinic_id", ids.clinicId)
      .eq("contact_id", ids.contactId);
    const { data, error } = await (apenas === undefined
      ? consulta
      : consulta.eq("id", apenas))
      .in("status", [...STATUS_ANTES_DO_ATENDIMENTO])
      .gt("starts_at", new Date(agoraMs).toISOString())
      .or("approval_status.is.null,approval_status.neq.recusado")
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAXIMO_DE_CONSULTAS_NA_LISTA + 1);
    if (error) {
      throw new Error("leitura");
    }
    return (data ?? []) as LinhaDaConsultaListada[];
  }, PRAZO_DA_AGENDA_MS);
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "consultas_do_contato", corrida.tipo);
  }
  const texto = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;
  const lidas: ConsultaDoContato[] = [];
  for (const linha of corrida.valor) {
    const id = texto(linha.id);
    const inicio = texto(linha.starts_at);
    const fim = texto(linha.ends_at);
    const status = texto(linha.status);
    const serviceLinkId = texto(linha.service_link_id);
    const profissionalId = texto(linha.professional_id);
    if (
      id === null ||
      inicio === null ||
      fim === null ||
      status === null ||
      serviceLinkId === null ||
      profissionalId === null
    ) {
      continue;
    }
    const consulta: ConsultaDoContato = {
      id,
      inicio,
      fim,
      status,
      aprovacao: texto(linha.approval_status),
      encaixe: linha.is_overbooking === true,
      serviceLinkId,
      profissionalId,
      unidadeId: texto(linha.unit_id),
      remarcacaoDe: texto(linha.remarcacao_de),
      temRemarcacaoPendente: false,
    };
    if (consultaListavel(consulta, agoraMs)) {
      lidas.push(consulta);
    }
  }
  const ordenadas = emOrdem(lidas);
  const primeiras = ordenadas.slice(0, MAXIMO_DE_CONSULTAS_NA_LISTA);
  if (primeiras.length > 0) {
    // As remarcacoes pendentes ligadas a estas (a consulta nova pendente com
    // remarcacao_de = uma delas), do mesmo contato.
    const ligadas = await correrComPrazo(async () => {
      const { data, error } = await admin
        .from("appointment")
        .select("remarcacao_de")
        .eq("clinic_id", ids.clinicId)
        .eq("contact_id", ids.contactId)
        .in(
          "remarcacao_de",
          primeiras.map((c) => c.id),
        )
        .eq("approval_status", "pendente")
        .not("status", "in", "(cancelado_paciente,cancelado_clinica)");
      if (error) {
        throw new Error("leitura");
      }
      return (data ?? []) as { remarcacao_de?: unknown }[];
    }, PRAZO_DA_AGENDA_MS);
    if (ligadas.tipo !== "resultado") {
      return falhou(ids, "consultas_do_contato", ligadas.tipo);
    }
    const comRemarcacao = new Set(
      ligadas.valor.flatMap((l) =>
        typeof l.remarcacao_de === "string" ? [l.remarcacao_de] : [],
      ),
    );
    for (const c of primeiras) {
      c.temRemarcacaoPendente = comRemarcacao.has(c.id);
    }
  }
  return {
    consultas: primeiras,
    haMais: ordenadas.length > primeiras.length,
  };
}

/**
 * AG4: cancelar_consulta_pela_ia com o job_id do turno (desenho da AG4, 3.3
 * b): repetir o job devolve o cancelamento que ele ja fez. Lanca no erro, no
 * prazo e na resposta fora do formato.
 */
export async function cancelarConsultaPelaIa(
  admin: Cliente,
  ids: IdsDoTurno,
  appointmentId: string,
): Promise<RespostaDoCancelamento> {
  const corrida = await rpcComPrazo(admin, "cancelar_consulta_pela_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
    p_appointment_id: appointmentId,
  });
  if (corrida.tipo !== "resultado") {
    return falhou(ids, "cancelar", corrida.tipo);
  }
  const lida = lerRespostaDoCancelamento(corrida.valor);
  if (lida === null) {
    return falhou(ids, "cancelar", "resposta_fora_do_formato");
  }
  if (lida.ok) {
    log.info("ia_agenda_cancelou", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      status: lida.reutilizado ? "reutilizado" : "nova",
    });
  } else {
    log.info("ia_agenda_cancelamento_recusado", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: lida.motivo,
    });
  }
  return lida;
}

/**
 * A porta do turno do WhatsApp (lib/jobs/responder-com-ia.ts): a Agenda de
 * verdade e as RPCs com o job_id do turno.
 */
export function portaDaAgendaDoWhatsapp(
  admin: Cliente,
  ids: IdsDoTurno & { agora: () => number },
): PortaDaAgenda {
  return {
    simulada: false,
    carregar: (pedido) =>
      carregarAgendaDaIa(admin, {
        clinicId: ids.clinicId,
        conversationId: ids.conversationId,
        pedido,
        agoraMs: ids.agora(),
      }),
    reservar: (pedido) => reservarHorarioDaIa(admin, ids, pedido),
    agendar: (pedido) =>
      pedido === undefined
        ? agendarPelaIa(admin, ids)
        : agendarPelaIa(admin, ids, pedido.slotHoldId, pedido.remarcarId),
    confirmarPresenca: () => confirmarPresencaPelaIa(admin, ids, ids.agora()),
    registrarDados: (dados) => registrarDadosDaIa(admin, ids, dados),
    lerCadastroDoContato: () => lerCadastroDoContatoDaIa(admin, ids, ids.agora()),
    lerReserva: (holdId) => lerReservaDaIa(admin, ids, holdId, ids.agora()),
    lerConsulta: (appointmentId) =>
      lerConsultaDaIa(admin, ids, appointmentId, ids.agora()),
    lerReservaViva: () => lerReservaVivaDaIa(admin, ids, ids.agora()),
    // AG4: remarcar e cancelar.
    lerConsultasDoContato: (apenas) =>
      lerConsultasDoContatoDaIa(admin, ids, ids.agora(), apenas),
    cancelarConsulta: (appointmentId) =>
      cancelarConsultaPelaIa(admin, ids, appointmentId),
  };
}

/** Uma consulta SIMULADA (id inventado, nada gravado). */
export type ConsultaSimulada = {
  appointmentId: string;
  inicio: string;
  serviceLinkId?: string;
  /**
   * Revisao curta das correcoes (achado 10): a unidade da consulta
   * simulada (a da reserva), como a consulta que a RPC grava. Ausente no
   * pacote de antes: sem unidade.
   */
  unidadeId?: string | null;
};

/**
 * AG3: o que o simulador guarda do atendimento entre as rodadas (no
 * historico assinado, lib/agente/assinatura.ts), alem do estado: a reserva
 * e a consulta SIMULADAS (ids inventados, nada gravado). Os dados que a
 * pessoa informa nunca ficam: so SE foram informados (no estado).
 *
 * AG4: a consulta simulada pode ser a remarcacao pedida de outra
 * (`remarcacaoDe`: a antiga, que continua marcada; o vinculo da remarcacao
 * fica na memoria assinada). No simulador nao ha aprovacao: a consulta
 * marcada na conversa de teste conta como aprovada pela equipe, para que
 * cancelar e remarcar possam ser testados (no WhatsApp, a consulta da IA
 * ainda pendente nao remarca, D-26); a remarcacao simulada fica pendente.
 */
export type MemoriaDoSimulador = {
  reserva: {
    holdId: string;
    serviceLinkId: string;
    inicio: string;
    fim: string;
    unidadeId: string | null;
    expiraEm: string;
  } | null;
  /**
   * serviceLinkId (revisao final da AG3): o vinculo da consulta simulada,
   * para a reserva seguinte do mesmo procedimento recusar ja_tem_consulta,
   * como a RPC. Ausente no pacote de antes: nao recusa.
   */
  consulta: (ConsultaSimulada & { remarcacaoDe?: ConsultaSimulada }) | null;
};

/**
 * A porta do simulador (lib/agente/simulador.ts): buscar le a Agenda de
 * verdade (sem conversa, toda reserva viva conta); reservar, agendar,
 * confirmar e registrar os dados devolvem a resposta simulada e NAO GRAVAM
 * nada (nenhuma RPC, nenhuma escrita). AG3: com a memoria do simulador, a
 * reserva reconfere o horario na Agenda de verdade (como a RPC), a reserva
 * e a consulta simuladas valem entre as rodadas (o agendar sabe o dia e a
 * hora), e os dados sao conferidos pelas mesmas regras do banco sem que o
 * valor fique em lugar nenhum.
 */
export function portaDaAgendaDoSimulador(
  admin: Cliente,
  e: {
    clinicId: string;
    agora: () => number;
    /** AG3: a memoria do atendimento simulado (muda aqui dentro). */
    memoria?: MemoriaDoSimulador;
    /** AG3: o estado do atendimento simulado (os dados informados). */
    atendimento?: { dados: DadosInformados };
    catalogo?: CatalogoDoAgente;
    config?: Pick<ConfigDoAgente, "agenda" | "dadosExigidos"> &
      Partial<Pick<ConfigDoAgente, "prazos">>;
    fuso?: string;
    /** AG3: o "Testar como" (o tipo do contato simulado). */
    contato?: TipoDoContato | null;
  },
): PortaDaAgenda {
  const memoria = e.memoria;
  // Os dados informados no simulador (so SE vieram): a copia desta rodada,
  // que o registrar atualiza (duas chamadas no mesmo turno somam).
  const dadosAtuais: DadosInformados = {
    ...(e.atendimento?.dados ?? dadosVazios()),
  };
  const carregar = (pedido: PedidoDaAgenda) =>
    carregarAgendaDaIa(admin, {
      clinicId: e.clinicId,
      conversationId: null,
      pedido,
      agoraMs: e.agora(),
    });
  const vinculoDe = (id: string | null) =>
    e.catalogo?.vinculos.find((v) => v.id === id);
  /**
   * AG4: as consultas simuladas como o contato as tem (a de cima e, numa
   * remarcacao pedida, a antiga), na forma da lista. A de cima conta como
   * aprovada; a remarcacao pedida, como pendente.
   */
  const simuladas = (): ConsultaDoContato[] => {
    const consulta = memoria?.consulta ?? null;
    if (consulta === null) {
      return [];
    }
    const comoDoContato = (
      c: ConsultaSimulada,
      extra: Pick<ConsultaDoContato, "aprovacao" | "remarcacaoDe" | "temRemarcacaoPendente">,
    ): ConsultaDoContato | null => {
      const vinculo =
        c.serviceLinkId === undefined ? undefined : vinculoDe(c.serviceLinkId);
      if (vinculo === undefined || vinculo.id === null) {
        return null;
      }
      return {
        id: c.appointmentId,
        inicio: c.inicio,
        fim: new Date(
          Date.parse(c.inicio) + (vinculo.duracaoMin ?? 30) * 60_000,
        ).toISOString(),
        status: "agendado",
        encaixe: false,
        serviceLinkId: vinculo.id,
        profissionalId: vinculo.profissionalId,
        unidadeId: c.unidadeId ?? null,
        ...extra,
      };
    };
    const antiga = consulta.remarcacaoDe;
    return [
      comoDoContato(consulta, {
        aprovacao: antiga === undefined ? null : "pendente",
        remarcacaoDe: antiga?.appointmentId ?? null,
        temRemarcacaoPendente: false,
      }),
      ...(antiga === undefined
        ? []
        : [
            comoDoContato(antiga, {
              aprovacao: null,
              remarcacaoDe: null,
              temRemarcacaoPendente: true,
            }),
          ]),
    ].filter(
      (c): c is ConsultaDoContato =>
        c !== null && consultaListavel(c, e.agora()),
    );
  };
  /** AG4: a conferencia do banco, sobre a consulta simulada. */
  const conferirSimulada = (
    id: string,
    acao: "cancelar" | "remarcar",
  ) =>
    conferirConsultaDaIa({
      consulta: simuladas().find((c) => c.id === id) ?? null,
      acao,
      prazoHoras: prazoDaAcao(e.config?.prazos ?? null, acao),
      agoraMs: e.agora(),
      catalogo: e.catalogo ?? { vinculos: [] },
    });
  return {
    simulada: true,
    carregar,
    reservar: async (pedido) => {
      if (memoria !== undefined && e.catalogo && e.config) {
        // AG4: a reserva da remarcacao, como a RPC: a consulta em foco e a
        // simulada, conferida, e o horario novo e do mesmo procedimento,
        // profissional e pagamento.
        const remarcarId = pedido.remarcarId ?? null;
        if (remarcarId !== null) {
          const motivo = conferirSimulada(remarcarId, "remarcar");
          if (motivo !== null) {
            return { ok: false, motivo };
          }
          const antiga = simuladas().find((c) => c.id === remarcarId);
          const daAntiga = vinculoDe(antiga?.serviceLinkId ?? null);
          const doNovo = vinculoDe(pedido.serviceLinkId);
          if (
            daAntiga === undefined ||
            doNovo === undefined ||
            daAntiga.procedimentoId !== doNovo.procedimentoId ||
            daAntiga.profissionalId !== doNovo.profissionalId ||
            daAntiga.convenioId !== doNovo.convenioId
          ) {
            return { ok: false, motivo: "remarcacao_invalida" };
          }
        }
        // Revisao final da AG3: como a RPC, a consulta simulada (futura) do
        // mesmo procedimento recusa ja_tem_consulta (AG4: menos a que esta
        // sendo remarcada, 33.14 ponto 3).
        const consulta = memoria.consulta;
        const procedimentoDe = (id: string | undefined) =>
          id === undefined ? undefined : vinculoDe(id)?.procedimentoId;
        if (
          remarcarId === null &&
          consulta !== null &&
          consulta.serviceLinkId !== undefined &&
          Date.parse(consulta.inicio) > e.agora() &&
          procedimentoDe(consulta.serviceLinkId) !== undefined &&
          procedimentoDe(consulta.serviceLinkId) ===
            procedimentoDe(pedido.serviceLinkId)
        ) {
          return {
            ok: false,
            motivo: "ja_tem_consulta",
            appointmentId: consulta.appointmentId,
            inicio: consulta.inicio,
          };
        }
        // Como a RPC: o horario tem de continuar livre agora.
        const horario = {
          codigo: "h1",
          serviceLinkId: pedido.serviceLinkId,
          unidadeId: pedido.unidadeId ?? null,
          inicio: pedido.inicio,
          fim: pedido.fim,
        };
        const plano = pedidoDaReconferencia(e.catalogo, [horario]);
        if (plano === null) {
          return { ok: false, motivo: "vinculo_invalido" };
        }
        const agenda = await carregar(plano);
        if (
          !horarioContinuaLivre({
            catalogo: e.catalogo,
            agenda,
            config: e.config.agenda,
            horario,
            agoraMs: e.agora(),
            fuso: e.fuso ?? "America/Fortaleza",
          })
        ) {
          return { ok: false, motivo: "ocupado" };
        }
        memoria.reserva = {
          holdId: randomUUID(),
          serviceLinkId: pedido.serviceLinkId,
          inicio: pedido.inicio,
          fim: pedido.fim,
          unidadeId: pedido.unidadeId ?? null,
          expiraEm: new Date(e.agora() + MINUTOS_DA_RESERVA * 60_000).toISOString(),
        };
        return {
          ok: true,
          inicio: pedido.inicio,
          fim: pedido.fim,
          expiraEm: memoria.reserva.expiraEm,
          reutilizado: false,
          serviceLinkId: pedido.serviceLinkId,
          holdId: memoria.reserva.holdId,
          unitId: memoria.reserva.unidadeId,
        };
      }
      return {
        ok: true,
        inicio: pedido.inicio,
        fim: pedido.fim,
        expiraEm: new Date(e.agora() + MINUTOS_DA_RESERVA * 60_000).toISOString(),
        reutilizado: false,
        serviceLinkId: pedido.serviceLinkId,
        holdId: null,
        unitId: pedido.unidadeId ?? null,
      };
    },
    agendar: async (pedido) => {
      if (memoria !== undefined && e.catalogo && e.config) {
        // Revisao curta das correcoes (achado 10): na ORDEM da RPC
        // (agendar_pela_ia): reserva_inexistente, reserva_diferente e so
        // depois reserva_vencida. A reserva da conversa que nao foi
        // consumida conta, vencida ou nao, como no banco.
        const reserva = memoria.reserva;
        if (reserva === null) {
          return { ok: false, motivo: "reserva_inexistente" };
        }
        // AG4: a remarcacao simulada: a consulta nova pendente, ligada a
        // antiga, que continua marcada (D-10). Nada gravado.
        const remarcarId = pedido?.remarcarId ?? null;
        if (remarcarId !== null) {
          if (
            pedido?.slotHoldId !== undefined &&
            pedido.slotHoldId !== null &&
            pedido.slotHoldId !== reserva.holdId
          ) {
            return { ok: false, motivo: "reserva_diferente" };
          }
          if (Date.parse(reserva.expiraEm) <= e.agora()) {
            return { ok: false, motivo: "reserva_vencida" };
          }
          const motivo = conferirSimulada(remarcarId, "remarcar");
          if (motivo !== null) {
            return { ok: false, motivo };
          }
          const antiga = memoria.consulta;
          if (antiga === null || antiga.appointmentId !== remarcarId) {
            return { ok: false, motivo: "consulta_nao_encontrada" };
          }
          memoria.consulta = {
            appointmentId: randomUUID(),
            inicio: reserva.inicio,
            serviceLinkId: reserva.serviceLinkId,
            unidadeId: reserva.unidadeId,
            remarcacaoDe: {
              appointmentId: antiga.appointmentId,
              inicio: antiga.inicio,
              ...(antiga.serviceLinkId === undefined
                ? {}
                : { serviceLinkId: antiga.serviceLinkId }),
              unidadeId: antiga.unidadeId ?? null,
            },
          };
          memoria.reserva = null;
          return {
            ok: true,
            inicio: reserva.inicio,
            fim: reserva.fim,
            reutilizado: false,
            serviceLinkId: reserva.serviceLinkId,
            appointmentId: memoria.consulta.appointmentId,
            remarcacaoDe: antiga.appointmentId,
            inicioDaAntiga: antiga.inicio,
          };
        }
        // Revisao final da AG3: como a RPC, a reserva perguntada tem de ser
        // a da conversa.
        if (
          pedido?.slotHoldId !== undefined &&
          pedido.slotHoldId !== null &&
          pedido.slotHoldId !== reserva.holdId
        ) {
          return { ok: false, motivo: "reserva_diferente" };
        }
        if (Date.parse(reserva.expiraEm) <= e.agora()) {
          return { ok: false, motivo: "reserva_vencida" };
        }
        const dados = dadosAtuais;
        if (dados.para_o_titular === false) {
          return { ok: false, motivo: "consulta_para_outra_pessoa" };
        }
        const vinculo = vinculoDe(reserva.serviceLinkId);
        const faltam = dadosQueFaltam({
          exigidos: e.config.dadosExigidos,
          informados: dados,
          vinculo:
            vinculo === undefined
              ? null
              : {
                  procedimentoId: vinculo.procedimentoId,
                  convenioId: vinculo.convenioId,
                },
          catalogo: e.catalogo,
        });
        if (faltam.length > 0) {
          return { ok: false, motivo: "faltam_dados", faltam };
        }
        memoria.consulta = {
          appointmentId: randomUUID(),
          inicio: reserva.inicio,
          serviceLinkId: reserva.serviceLinkId,
          // Revisao curta das correcoes (achado 10): a unidade da reserva,
          // como a consulta que a RPC grava.
          unidadeId: reserva.unidadeId,
        };
        memoria.reserva = null;
        return {
          ok: true,
          inicio: reserva.inicio,
          fim: reserva.fim,
          reutilizado: false,
          serviceLinkId: reserva.serviceLinkId,
          appointmentId: memoria.consulta.appointmentId,
        };
      }
      return {
        ok: true,
        inicio: null,
        fim: null,
        reutilizado: false,
        serviceLinkId: null,
        appointmentId: null,
      };
    },
    confirmarPresenca: async () => ({
      ok: true,
      inicio: null,
      serviceLinkId: null,
    }),
    registrarDados: async (dados) => {
      // As regras do banco, sem guardar valor nenhum.
      if (!dados.paraOTitular) {
        dadosAtuais.para_o_titular = false;
        return { ok: false, motivo: "consulta_para_outra_pessoa" };
      }
      const hoje = diaCivil(e.fuso ?? "America/Fortaleza", new Date(e.agora()));
      const invalidos: DadoDaMarcacao[] = [];
      if (dados.nomeCompleto !== null && nomeCompletoValido(dados.nomeCompleto) === null) {
        invalidos.push("nome_completo");
      }
      if (
        dados.dataNascimento !== null &&
        !nascimentoValido(dados.dataNascimento, hoje)
      ) {
        invalidos.push("data_nascimento");
      }
      if (dados.cpf !== null && !cpfValido(dados.cpf.replace(/[^0-9]/g, ""))) {
        invalidos.push("cpf");
      }
      if (dados.carteirinha !== null && carteirinhaValida(dados.carteirinha) === null) {
        invalidos.push("carteirinha");
      }
      if (invalidos.length > 0) {
        return { ok: false, motivo: "dados_invalidos", invalidos };
      }
      const informados = {
        nome_completo: dadosAtuais.nome_completo || dados.nomeCompleto !== null,
        data_nascimento:
          dadosAtuais.data_nascimento || dados.dataNascimento !== null,
        cpf: dadosAtuais.cpf || dados.cpf !== null,
        carteirinha: dadosAtuais.carteirinha || dados.carteirinha !== null,
      };
      // Menor de 18 anos no dia da reserva viva (ou hoje): a equipe marca.
      if (dados.dataNascimento !== null) {
        const reserva = memoria?.reserva ?? null;
        const dia =
          reserva !== null && Date.parse(reserva.expiraEm) > e.agora()
            ? diaCivil(e.fuso ?? "America/Fortaleza", new Date(reserva.inicio))
            : hoje;
        const idade = idadeNoDia(dados.dataNascimento, dia);
        if (idade !== null && idade < 18) {
          dadosAtuais.data_nascimento = true;
          return { ok: false, motivo: "menor_de_idade" };
        }
      }
      Object.assign(dadosAtuais, informados, { para_o_titular: true });
      const reserva = memoria?.reserva ?? null;
      const vinculo =
        reserva !== null && Date.parse(reserva.expiraEm) > e.agora()
          ? vinculoDe(reserva.serviceLinkId)
          : undefined;
      return {
        ok: true,
        faltam:
          e.config && e.catalogo
            ? dadosQueFaltam({
                exigidos: e.config.dadosExigidos,
                informados,
                vinculo:
                  vinculo === undefined
                    ? null
                    : {
                        procedimentoId: vinculo.procedimentoId,
                        convenioId: vinculo.convenioId,
                      },
                catalogo: e.catalogo,
              })
            : [],
      };
    },
    lerCadastroDoContato: async () => ({
      tipo: e.contato ?? null,
      nome: "sem_nome",
      temNascimento: false,
      temCpf: false,
      convenioId: null,
      consultasFuturas: 0,
      simulado: true,
    }),
    lerReserva: async (holdId) => {
      const reserva = memoria?.reserva ?? null;
      if (reserva === null || reserva.holdId !== holdId) {
        return null;
      }
      return {
        viva: Date.parse(reserva.expiraEm) > e.agora(),
        serviceLinkId: reserva.serviceLinkId,
        inicio: reserva.inicio,
        fim: reserva.fim,
        unidadeId: reserva.unidadeId,
        expiraEm: reserva.expiraEm,
      };
    },
    lerReservaViva: async () => {
      const reserva = memoria?.reserva ?? null;
      if (reserva === null || Date.parse(reserva.expiraEm) <= e.agora()) {
        return null;
      }
      return {
        holdId: reserva.holdId,
        viva: true,
        serviceLinkId: reserva.serviceLinkId,
        inicio: reserva.inicio,
        fim: reserva.fim,
        unidadeId: reserva.unidadeId,
        expiraEm: reserva.expiraEm,
      };
    },
    lerConsulta: async (appointmentId) => {
      const consulta = memoria?.consulta ?? null;
      // AG4: a antiga da remarcacao pedida tambem se le.
      const lida =
        consulta === null
          ? null
          : consulta.appointmentId === appointmentId
            ? consulta
            : consulta.remarcacaoDe?.appointmentId === appointmentId
              ? consulta.remarcacaoDe
              : null;
      if (consulta === null || lida === null) {
        return null;
      }
      const vinculo =
        lida.serviceLinkId === undefined ? undefined : vinculoDe(lida.serviceLinkId);
      const ehANova = lida === consulta && consulta.remarcacaoDe !== undefined;
      return {
        inicio: lida.inicio,
        ativa: Date.parse(lida.inicio) > e.agora(),
        // Revisao curta das correcoes (achado 10): a unidade, como
        // lerConsultaDaIa (o pacote de antes, sem ela: sem unidade).
        unidadeId: lida.unidadeId ?? null,
        // AG4: o profissional e o vinculo, a remarcacao pendente e a antiga.
        profissionalId: vinculo?.profissionalId ?? null,
        serviceLinkId: lida.serviceLinkId ?? null,
        pendente: ehANova,
        remarcacaoDe: ehANova ? (consulta.remarcacaoDe?.appointmentId ?? null) : null,
      };
    },
    // AG4: so a consulta marcada na propria conversa de teste aparece.
    // Revisao da AG4: com `apenas`, so aquela.
    lerConsultasDoContato: async (apenas) => {
      const lista = emOrdem(
        simuladas().filter((c) => apenas === undefined || c.id === apenas),
      );
      return {
        consultas: lista.slice(0, MAXIMO_DE_CONSULTAS_NA_LISTA),
        haMais: lista.length > MAXIMO_DE_CONSULTAS_NA_LISTA,
      };
    },
    // AG4: o cancelamento simulado, com a conferencia do banco. Nada
    // gravado: so a memoria do simulador perde a consulta.
    cancelarConsulta: async (appointmentId) => {
      const motivo = conferirSimulada(appointmentId, "cancelar");
      // (pendente_da_equipe so vale na remarcacao.)
      if (motivo !== null && motivo !== "pendente_da_equipe") {
        return { ok: false, motivo };
      }
      const consulta = memoria?.consulta ?? null;
      if (memoria === undefined || consulta === null) {
        return { ok: false, motivo: "consulta_nao_encontrada" };
      }
      if (consulta.appointmentId === appointmentId) {
        // Cancelar a remarcacao pedida deixa a antiga, que continua marcada.
        memoria.consulta = consulta.remarcacaoDe ?? null;
        return { ok: true, inicio: consulta.inicio, reutilizado: false };
      }
      return { ok: false, motivo: "consulta_nao_encontrada" };
    },
  };
}
