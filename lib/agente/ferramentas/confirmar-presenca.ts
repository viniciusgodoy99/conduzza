// Ferramenta confirmar_presenca do agente de IA (E4, contrato da E4 secao
// 2): confirma a presenca do paciente quando ele tem UMA consulta futura
// aguardando confirmacao (status agendado ou aguardando_confirmacao) que nao
// esta pendente da equipe (approval_status nulo ou aprovado). Mais de uma, ou
// nenhuma, o modelo passa para a equipe. Com um horario reservado pela IA
// nesta conversa esperando a confirmacao, nada e confirmado (revisao da E4:
// o "confirmo" e do horario reservado). PURO: a definicao, a entrada e a
// regra da consulta que conta. Quem le a Agenda e chama
// confirmar_pelo_paciente e lib/agente/agenda.ts.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const NOME_DA_CONFIRMACAO = "confirmar_presenca";

export const entradaDaConfirmacaoSchema = z.object({}).strict();

export const FERRAMENTA_CONFIRMAR_PRESENCA: FunctionTool = {
  type: "function",
  name: NOME_DA_CONFIRMACAO,
  strict: true,
  description:
    "Confirma a presença do paciente na consulta dele que aguarda confirmação. Use quando ele disser que vai à consulta já marcada.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/** Os status em que a consulta aguarda a confirmacao do paciente. */
export const STATUS_QUE_AGUARDAM_CONFIRMACAO = [
  "agendado",
  "aguardando_confirmacao",
] as const;

/**
 * A consulta conta para a confirmacao: status que aguarda, no futuro, e nao
 * pendente da equipe (a consulta da IA que a equipe ainda nao aprovou nao e
 * confirmada pelo paciente).
 */
export function consultaQueAguardaConfirmacao(
  consulta: {
    status: string;
    starts_at: string;
    approval_status: string | null;
  },
  agoraMs: number,
): boolean {
  const inicio = Date.parse(consulta.starts_at);
  return (
    (STATUS_QUE_AGUARDAM_CONFIRMACAO as readonly string[]).includes(
      consulta.status,
    ) &&
    Number.isFinite(inicio) &&
    inicio > agoraMs &&
    (consulta.approval_status === null ||
      consulta.approval_status === "aprovado")
  );
}

/**
 * Por que nao confirmou. "reserva_em_andamento" (revisao da E4): a conversa
 * tem um horario reservado esperando a confirmacao da pessoa; o "confirmo"
 * dela e do horario reservado (agendar), e confirmar presenca ali gravaria
 * a confirmacao em OUTRA consulta dela.
 */
export type MotivoDaConfirmacao =
  "sem_consulta" | "mais_de_uma" | "reserva_em_andamento";

export type RespostaDaConfirmacao =
  | {
      ok: true;
      /** ISO (UTC); null quando ninguem sabe (o simulador nao grava). */
      inicio: string | null;
      serviceLinkId: string | null;
      /**
       * AG4 (o limite da 21.15): o profissional da consulta confirmada, so
       * para os fatos do turno. Ausente: o do vinculo.
       */
      profissionalId?: string | null;
    }
  | { ok: false; motivo: MotivoDaConfirmacao };
