import type { AppointmentStatus } from "@/lib/design/status";

// Transicoes validas do ciclo de status da consulta (tarefa 2.7). Mapa PURO,
// usado pela Server Action (que confere de novo) e pelo menu do bloco.
//
// Regras duras:
// - "faltou" SO por acao explicita, e so de estados em que o paciente era
//   esperado (nunca de cancelado nem de atendido).
// - Cancelado e terminal: reabrir e marcar de novo, nao voltar o status.
// - As duas confirmacoes sao STATUS DISTINTOS (autoria no proprio status).

const TRANSICOES: Record<AppointmentStatus, AppointmentStatus[]> = {
  agendado: [
    "aguardando_confirmacao",
    "confirmado_recepcao",
    "na_recepcao",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  aguardando_confirmacao: [
    "confirmado_paciente",
    "confirmado_recepcao",
    "na_recepcao",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  confirmado_paciente: [
    "na_recepcao",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  confirmado_recepcao: [
    "na_recepcao",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  na_recepcao: ["em_atendimento", "cancelado_clinica", "faltou"],
  em_atendimento: ["compareceu"],
  compareceu: [],
  cancelado_paciente: [],
  cancelado_clinica: [],
  faltou: [],
};

export function transicoesPermitidas(
  de: AppointmentStatus,
): AppointmentStatus[] {
  return TRANSICOES[de];
}

export function podeTransicionar(
  de: AppointmentStatus,
  para: AppointmentStatus,
): boolean {
  return TRANSICOES[de].includes(para);
}

/** Status que exigem canal/autoria extra ao aplicar. */
export function exigeCanal(status: AppointmentStatus): boolean {
  return status === "confirmado_recepcao";
}

export const STATUS_TERMINAIS: AppointmentStatus[] = [
  "compareceu",
  "cancelado_paciente",
  "cancelado_clinica",
  "faltou",
];
