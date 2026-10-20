import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import type { IntervaloOcupado, JanelaSemanal } from "@/lib/domain/scheduling";
import { log } from "@/lib/log";

import {
  idDaConsulta,
  lerRespostaDoAgendar,
  type RespostaDoAgendar,
} from "./ferramentas/agendar";
import type { PortaDaAgenda } from "./ferramentas/agenda-do-turno";
import type {
  AgendaCarregada,
  PedidoDaAgenda,
} from "./ferramentas/buscar-horario";
import {
  consultaQueAguardaConfirmacao,
  STATUS_QUE_AGUARDAM_CONFIRMACAO,
  type RespostaDaConfirmacao,
} from "./ferramentas/confirmar-presenca";
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
 * profissionais (todas as unidades: clinica com mais de uma unidade fica
 * para depois, risco aceito no plano), os bloqueios, as consultas nao
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
          .select("professional_id, weekday, starts_at, ends_at")
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

    const porProfissional = new Map<string, JanelaSemanal[]>();
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
  pedido: { serviceLinkId: string; inicio: string },
): Promise<RespostaDaReserva> {
  const corrida = await rpcComPrazo(admin, "reservar_horario_da_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_service_link_id: pedido.serviceLinkId,
    p_starts_at: pedido.inicio,
    p_job_id: ids.jobId,
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
 * da conversa; repetir o job devolve a mesma consulta. Lanca no erro, no
 * prazo e na resposta fora do formato.
 */
export async function agendarPelaIa(
  admin: Cliente,
  ids: IdsDoTurno,
): Promise<RespostaDoAgendar> {
  const corrida = await rpcComPrazo(admin, "agendar_pela_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
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
    log.info("ia_agenda_marcou", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      status: lida.reutilizado ? "reutilizado" : "nova",
    });
    return { ...lida, serviceLinkId };
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
      .select("id, status, starts_at, approval_status, service_link_id")
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
  };
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
    agendar: () => agendarPelaIa(admin, ids),
    confirmarPresenca: () => confirmarPresencaPelaIa(admin, ids, ids.agora()),
  };
}

/**
 * A porta do simulador (lib/agente/simulador.ts): buscar le a Agenda de
 * verdade (sem conversa, toda reserva viva conta); reservar, agendar e
 * confirmar devolvem a resposta simulada e NAO GRAVAM nada (nenhuma RPC,
 * nenhuma escrita). O simulador nao guarda a reserva entre as rodadas: a
 * marcacao simulada nao sabe o dia e a hora.
 */
export function portaDaAgendaDoSimulador(
  admin: Cliente,
  e: { clinicId: string; agora: () => number },
): PortaDaAgenda {
  return {
    simulada: true,
    carregar: (pedido) =>
      carregarAgendaDaIa(admin, {
        clinicId: e.clinicId,
        conversationId: null,
        pedido,
        agoraMs: e.agora(),
      }),
    reservar: async (pedido) => ({
      ok: true,
      inicio: pedido.inicio,
      fim: pedido.fim,
      expiraEm: new Date(e.agora() + MINUTOS_DA_RESERVA * 60_000).toISOString(),
      reutilizado: false,
      serviceLinkId: pedido.serviceLinkId,
    }),
    agendar: async () => ({
      ok: true,
      inicio: null,
      fim: null,
      reutilizado: false,
      serviceLinkId: null,
    }),
    confirmarPresenca: async () => ({
      ok: true,
      inicio: null,
      serviceLinkId: null,
    }),
  };
}
