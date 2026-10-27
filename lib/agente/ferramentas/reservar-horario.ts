// Ferramenta reservar_horario do agente de IA (E4, contrato da E4 secao 2):
// trava por 10 minutos um horario oferecido, pelo codigo (h1, h2...). PURO:
// a definicao, a entrada, os motivos de reservar_horario_da_ia (contrato
// 1.3) e a leitura defensiva da resposta da RPC. Quem chama a RPC (com o
// job_id do turno, a idempotencia) e lib/agente/agenda.ts; quem limita a uma
// reserva por resposta e monta a saida para o modelo e
// lib/agente/ferramentas/agenda-do-turno.ts.
//
// AG3 (27/10/2026): o codigo vale entre as mensagens (o estado do
// atendimento guarda os horarios oferecidos, lib/agente/atendimento.ts), a
// reserva leva a unidade do horario (p_unit_id) e a RPC devolve a unidade e
// o motivo novo unidade_invalida (unidade de outra clinica, inativa ou que
// nao existe). A RPC confere tudo de novo, sempre.
//
// Revisao final da AG3: a RPC recusa tambem ja_tem_consulta, com o id e o
// inicio da consulta que o contato ja tem (futura e ativa, do mesmo
// procedimento), antes de qualquer dado ser pedido.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import { ehMotivoDaRemarcacao, type MotivoDaRemarcacao } from "./remarcar";

// AG4 (27/10/2026): no modo de remarcacao (o pedido "remarcar" no estado do
// atendimento), a reserva vai com p_remarcar (a consulta em foco) e a RPC
// recusa tambem com os motivos da remarcacao (MOTIVOS_DA_REMARCACAO).

export const NOME_DA_RESERVA = "reservar_horario";

/** A reserva vale 10 minutos (slot_hold.expires_at, contrato 1.3). */
export const MINUTOS_DA_RESERVA = 10;

export const entradaDaReservaSchema = z
  .object({ horario: z.string().trim().min(1).max(16) })
  .strict();

export const FERRAMENTA_RESERVAR_HORARIO: FunctionTool = {
  type: "function",
  name: NOME_DA_RESERVA,
  strict: true,
  description:
    "Reserva por 10 minutos o horário que a pessoa escolheu, pelo código que buscar_horario trouxe nesta resposta ou que está no bloco <atendimento_em_andamento>. O sistema confere o horário de novo. Uma reserva por resposta.",
  parameters: {
    type: "object",
    properties: {
      horario: {
        type: "string",
        description: "O código do horário escolhido, por exemplo h2.",
      },
    },
    required: ["horario"],
    additionalProperties: false,
  },
};

/**
 * Os motivos da conferencia do horario de reservar_horario_da_ia (contrato
 * 1.3), lista fechada, que agendar_pela_ia repete. AG3: unidade_invalida,
 * logo depois de vinculo_invalido (a ordem da RPC).
 */
export const MOTIVOS_DA_CONFERENCIA = [
  "ia_desligada",
  "agenda_nao_configurada",
  "vinculo_invalido",
  "unidade_invalida",
  "antes_da_antecedencia",
  "depois_do_horizonte",
  "fora_da_jornada",
  "bloqueado",
  "ocupado",
  "reservado_por_outra_conversa",
] as const;
export type MotivoDaConferencia = (typeof MOTIVOS_DA_CONFERENCIA)[number];

/**
 * Os motivos de reservar_horario_da_ia: os da conferencia e, revisao final
 * da AG3, ja_tem_consulta (com a consulta que o contato ja tem).
 */
export const MOTIVOS_DA_RESERVA = [
  ...MOTIVOS_DA_CONFERENCIA,
  "ja_tem_consulta",
] as const;
export type MotivoDaReserva =
  | (typeof MOTIVOS_DA_RESERVA)[number]
  // AG4: so no modo de remarcacao.
  | MotivoDaRemarcacao;

export type RespostaDaReserva =
  | {
      ok: true;
      /** ISO (UTC), como o banco devolveu. */
      inicio: string;
      fim: string;
      expiraEm: string;
      /** Repetir o job devolve a reserva que ele ja tinha feito. */
      reutilizado: boolean;
      /**
       * O vinculo da reserva quando quem chama sabe (a reserva reaproveitada
       * pode ser de outro horario que o pedido agora): os nomes da saida vem
       * dele, nunca do pedido.
       */
      serviceLinkId: string | null;
      /** AG3: slot_hold.id (o estado do atendimento guarda). */
      holdId: string | null;
      /** AG3: a unidade da reserva (nula = sem unidade, como antes). */
      unitId: string | null;
    }
  | { ok: false; motivo: MotivoDaConferencia }
  /** AG4: as recusas do modo de remarcacao (p_remarcar). */
  | { ok: false; motivo: MotivoDaRemarcacao }
  /**
   * Revisao final da AG3: o contato ja tem consulta futura ativa do mesmo
   * procedimento (o id e o inicio dela; nulos quando a RPC nao trouxe).
   */
  | {
      ok: false;
      motivo: "ja_tem_consulta";
      appointmentId: string | null;
      /** ISO (UTC). */
      inicio: string | null;
    };

function ehInstante(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

function ehMotivo<T extends string>(
  lista: readonly T[],
  valor: unknown,
): valor is T {
  return (
    typeof valor === "string" && (lista as readonly string[]).includes(valor)
  );
}

/**
 * O jsonb de reservar_horario_da_ia, lido sem confiar no formato. null =
 * fora do formato (motivo desconhecido inclusive): quem chama falha
 * fechado, porque nao sabe o que o banco fez.
 */
export function lerRespostaDaReserva(dado: unknown): RespostaDaReserva | null {
  if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
    return null;
  }
  const r = dado as Record<string, unknown>;
  if (r.ok === true) {
    if (!ehInstante(r.starts_at) || !ehInstante(r.ends_at)) {
      return null;
    }
    return {
      ok: true,
      inicio: r.starts_at,
      fim: r.ends_at,
      expiraEm: ehInstante(r.expires_at) ? r.expires_at : r.ends_at,
      reutilizado: r.reutilizado === true,
      serviceLinkId:
        typeof r.service_link_id === "string" ? r.service_link_id : null,
      holdId: typeof r.hold_id === "string" && r.hold_id !== "" ? r.hold_id : null,
      unitId: typeof r.unit_id === "string" && r.unit_id !== "" ? r.unit_id : null,
    };
  }
  if (r.ok === false && r.motivo === "ja_tem_consulta") {
    return {
      ok: false,
      motivo: "ja_tem_consulta",
      appointmentId:
        typeof r.appointment_id === "string" && r.appointment_id !== ""
          ? r.appointment_id
          : null,
      inicio: ehInstante(r.starts_at) ? r.starts_at : null,
    };
  }
  if (r.ok === false && ehMotivo(MOTIVOS_DA_CONFERENCIA, r.motivo)) {
    return { ok: false, motivo: r.motivo };
  }
  if (r.ok === false && ehMotivoDaRemarcacao(r.motivo)) {
    return { ok: false, motivo: r.motivo };
  }
  return null;
}

/** O id da reserva, quando a resposta trouxe (para achar o vinculo). */
export function idDaReserva(dado: unknown): string | null {
  if (typeof dado !== "object" || dado === null) {
    return null;
  }
  const id = (dado as { hold_id?: unknown }).hold_id;
  return typeof id === "string" && id !== "" ? id : null;
}
