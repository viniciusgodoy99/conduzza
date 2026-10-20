// Ferramenta agendar do agente de IA (E4, contrato da E4 secao 2): marca a
// consulta do horario reservado NESTA conversa, so depois de o paciente
// confirmar numa mensagem nova (a RPC exige a mensagem dele depois da
// reserva). A consulta nasce pendente da aprovacao da equipe (D12) e sem a
// regua de confirmacao ate a equipe aprovar. PURO: a definicao, a entrada,
// os motivos de agendar_pela_ia (contrato 1.4) e a leitura defensiva da
// resposta. Quem chama a RPC e lib/agente/agenda.ts.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import { MOTIVOS_DA_RESERVA } from "./reservar-horario";

export const NOME_DO_AGENDAR = "agendar";

export const entradaDoAgendarSchema = z.object({}).strict();

export const FERRAMENTA_AGENDAR: FunctionTool = {
  type: "function",
  name: NOME_DO_AGENDAR,
  strict: true,
  description:
    "Marca a consulta do horário reservado nesta conversa. Use só quando a pessoa confirmar numa mensagem nova, depois da reserva. A consulta fica pendente até a equipe aprovar.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/**
 * Os motivos de agendar_pela_ia (contrato 1.4), lista fechada: os proprios e
 * as conferencias 4 a 9 do reservar, que ele repete.
 */
export const MOTIVOS_DO_AGENDAR = [
  "reserva_inexistente",
  "reserva_vencida",
  "sem_confirmacao_do_paciente",
  "conflito",
  ...MOTIVOS_DA_RESERVA,
] as const;
export type MotivoDoAgendar = (typeof MOTIVOS_DO_AGENDAR)[number];

export type RespostaDoAgendar =
  | {
      ok: true;
      /** ISO (UTC); null quando ninguem sabe (o simulador nao grava). */
      inicio: string | null;
      fim: string | null;
      reutilizado: boolean;
      /** O vinculo da consulta, quando quem chama sabe. */
      serviceLinkId: string | null;
    }
  | { ok: false; motivo: MotivoDoAgendar };

function ehInstante(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

/**
 * O jsonb de agendar_pela_ia, lido sem confiar no formato. null = fora do
 * formato (motivo desconhecido inclusive): quem chama falha fechado.
 */
export function lerRespostaDoAgendar(dado: unknown): RespostaDoAgendar | null {
  if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
    return null;
  }
  const r = dado as Record<string, unknown>;
  if (r.ok === true) {
    if (typeof r.appointment_id !== "string" || r.appointment_id === "") {
      return null;
    }
    return {
      ok: true,
      inicio: ehInstante(r.starts_at) ? r.starts_at : null,
      fim: ehInstante(r.ends_at) ? r.ends_at : null,
      reutilizado: r.reutilizado === true,
      serviceLinkId:
        typeof r.service_link_id === "string" ? r.service_link_id : null,
    };
  }
  if (
    r.ok === false &&
    typeof r.motivo === "string" &&
    (MOTIVOS_DO_AGENDAR as readonly string[]).includes(r.motivo)
  ) {
    return { ok: false, motivo: r.motivo as MotivoDoAgendar };
  }
  return null;
}

/** O id da consulta, quando a resposta trouxe (para achar o vinculo). */
export function idDaConsulta(dado: unknown): string | null {
  if (typeof dado !== "object" || dado === null) {
    return null;
  }
  const id = (dado as { appointment_id?: unknown }).appointment_id;
  return typeof id === "string" && id !== "" ? id : null;
}
