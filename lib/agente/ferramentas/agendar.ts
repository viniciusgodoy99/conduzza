// Ferramenta agendar do agente de IA (E4, contrato da E4 secao 2): marca a
// consulta do horario reservado NESTA conversa, so depois de o paciente
// confirmar numa mensagem nova (a RPC exige a mensagem dele depois da
// reserva). A consulta nasce pendente da aprovacao da equipe (D12) e sem a
// regua de confirmacao ate a equipe aprovar. PURO: a definicao, a entrada,
// os motivos de agendar_pela_ia (contrato 1.4) e a leitura defensiva da
// resposta. Quem chama a RPC e lib/agente/agenda.ts.

// AG3 (27/10/2026): agendar_pela_ia recusa tambem, depois da conferencia do
// horario e nesta ordem, consulta_para_outra_pessoa e menor_de_idade (a IA
// passa para a equipe, D-8), ja_tem_consulta (com appointment_id: o contato
// ja tem consulta futura ativa do mesmo procedimento) e faltam_dados (com
// faltam: a lista do que a clinica exige e nao veio). A leitura guarda o id
// da consulta e a lista; o modelo so recebe o dia e a hora da consulta que
// ja existe (lib/agente/ferramentas/agenda-do-turno.ts).
//
// Revisao final da AG3: o agendar leva a reserva que a pergunta "Confirma
// ...?" mostrou (p_slot_hold_id) e a RPC recusa reserva_diferente quando a
// reserva viva da conversa e outra: o turno pergunta de novo, com o horario
// certo, e nada e marcado.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import { DADOS_DA_MARCACAO, type DadoDaMarcacao } from "../atendimento";
import { MOTIVOS_DA_CONFERENCIA } from "./reservar-horario";

export const NOME_DO_AGENDAR = "agendar";

export const entradaDoAgendarSchema = z.object({}).strict();

export const FERRAMENTA_AGENDAR: FunctionTool = {
  type: "function",
  name: NOME_DO_AGENDAR,
  strict: true,
  description:
    "Marca a consulta do horário reservado nesta conversa. Use só quando a pessoa confirmar numa mensagem nova, depois da pergunta \"Confirma ...?\". A consulta fica pendente até a equipe aprovar.",
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
  // Revisao final da AG3: a reserva viva e outra, nao a perguntada.
  "reserva_diferente",
  "sem_confirmacao_do_paciente",
  "conflito",
  ...MOTIVOS_DA_CONFERENCIA,
  // AG3, na ordem da RPC.
  "consulta_para_outra_pessoa",
  "menor_de_idade",
  "ja_tem_consulta",
  "faltam_dados",
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
      /** AG3: appointment.id (o estado do atendimento guarda). */
      appointmentId: string | null;
    }
  | {
      ok: false;
      motivo: MotivoDoAgendar;
      /** AG3, so em ja_tem_consulta: a consulta que o contato ja tem. */
      appointmentId?: string | null;
      /** AG3, so em faltam_dados: o que falta, na ordem do banco. */
      faltam?: DadoDaMarcacao[];
    };

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
      appointmentId: r.appointment_id,
    };
  }
  if (
    r.ok === false &&
    typeof r.motivo === "string" &&
    (MOTIVOS_DO_AGENDAR as readonly string[]).includes(r.motivo)
  ) {
    const motivo = r.motivo as MotivoDoAgendar;
    if (motivo === "ja_tem_consulta") {
      // A consulta que ja existe: sem o id, quem chama nao diz dia nem hora
      // (o modelo so ouve que ja ha consulta).
      return {
        ok: false,
        motivo,
        appointmentId:
          typeof r.appointment_id === "string" && r.appointment_id !== ""
            ? r.appointment_id
            : null,
      };
    }
    if (motivo === "faltam_dados") {
      // A lista e do banco: fora do formato, ninguem sabe o que pedir.
      if (
        !Array.isArray(r.faltam) ||
        r.faltam.length === 0 ||
        !r.faltam.every((f) =>
          (DADOS_DA_MARCACAO as readonly unknown[]).includes(f),
        )
      ) {
        return null;
      }
      return {
        ok: false,
        motivo,
        faltam: [...new Set(r.faltam as DadoDaMarcacao[])],
      };
    }
    return { ok: false, motivo };
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
