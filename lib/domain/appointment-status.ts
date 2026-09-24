import type { AppointmentStatus } from "@/lib/design/status";

// Transicoes validas do ciclo de status da consulta (tarefa 2.7). Mapa PURO,
// usado pela Server Action (que confere de novo) e pelo menu do bloco.
//
// Regras duras:
// - "faltou" SO por acao explicita, e so de estados em que o paciente era
//   esperado (nunca de cancelado nem de atendido). E so A PARTIR do horario
//   da consulta (faltaLiberada): antes disso o paciente avisou, e isso e
//   cancelamento. O banco confere de novo (gatilho impedir_falta_antes_do_horario).
// - Cancelado e terminal: reabrir e marcar de novo, nao voltar o status.
// - As duas confirmacoes sao STATUS DISTINTOS (autoria no proprio status).
// - "compareceu" direto (decisao do dono em 24/09/2026): clinica que nao faz
//   check-in fecha o dia marcando quem veio, sem passar por Na recepcao e Em
//   atendimento. Os dois continuam existindo como etapas opcionais.

const TRANSICOES: Record<AppointmentStatus, AppointmentStatus[]> = {
  agendado: [
    "aguardando_confirmacao",
    "confirmado_recepcao",
    "na_recepcao",
    "compareceu",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  aguardando_confirmacao: [
    "confirmado_paciente",
    "confirmado_recepcao",
    "na_recepcao",
    "compareceu",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  confirmado_paciente: [
    "na_recepcao",
    "compareceu",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  confirmado_recepcao: [
    "na_recepcao",
    "compareceu",
    "cancelado_paciente",
    "cancelado_clinica",
    "faltou",
  ],
  na_recepcao: ["em_atendimento", "compareceu", "cancelado_clinica", "faltou"],
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

/** Os dois cancelamentos: situacao final, com dialogo de confirmacao. */
export const STATUS_DE_CANCELAMENTO: AppointmentStatus[] = [
  "cancelado_paciente",
  "cancelado_clinica",
];

export function eCancelamento(status: AppointmentStatus): boolean {
  return STATUS_DE_CANCELAMENTO.includes(status);
}

// ---------------------------------------------------------------------------
// Falta so a partir do horario da consulta
// ---------------------------------------------------------------------------

export const DICA_FALTA_ANTES_DO_HORARIO =
  "Falta só pode ser marcada a partir do horário da consulta. Se o paciente avisou, use Cancelado pelo paciente.";

/**
 * Falta vale a partir do instante em que a consulta comeca. Comparacao de
 * instantes (epoch), sem fuso envolvido: o banco guarda UTC.
 */
export function faltaLiberada(startsAt: string | Date, agora: Date): boolean {
  return new Date(startsAt).getTime() <= agora.getTime();
}

// ---------------------------------------------------------------------------
// Remarcacao
// ---------------------------------------------------------------------------

export const DICA_REMARCAR_ENCERRADA =
  "Consulta encerrada não se remarca. Marque uma nova consulta.";

/** Consulta com situacao final nao se move: fica registrada onde aconteceu. */
export function podeRemarcar(status: AppointmentStatus): boolean {
  return !STATUS_TERMINAIS.includes(status);
}

/**
 * Situacoes que voltam a pedir confirmacao ao remarcar (decisao do dono em
 * 24/09/2026): quem confirmou confirmou O HORARIO ANTIGO. Na recepcao e Em
 * atendimento ficam como estao, porque o paciente ja esta na clinica.
 */
export const STATUS_QUE_VOLTAM_A_CONFIRMAR: AppointmentStatus[] = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
];

/** Situacao da consulta depois de remarcada. Espelha o gatilho preparar_remarcacao. */
export function statusAposRemarcar(
  status: AppointmentStatus,
): AppointmentStatus {
  return STATUS_QUE_VOLTAM_A_CONFIRMAR.includes(status) ? "agendado" : status;
}
