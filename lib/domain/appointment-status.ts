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
 * 24/09/2026): quem confirmou confirmou O HORARIO ANTIGO.
 */
export const STATUS_QUE_VOLTAM_A_CONFIRMAR: AppointmentStatus[] = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
];

/** O paciente ja chegou: Na recepcao e Em atendimento. */
export const STATUS_COM_PACIENTE_NA_CLINICA: AppointmentStatus[] = [
  "na_recepcao",
  "em_atendimento",
];

/**
 * Situacao da consulta depois de remarcada. Espelha o gatilho
 * preparar_remarcacao (migration 20260924130000).
 *
 * - Antes do atendimento: volta sempre para Agendado.
 * - Paciente na clinica (Na recepcao, Em atendimento): so fica como esta numa
 *   troca NO MESMO DIA civil da clinica (atraso do medico, troca de sala), em
 *   que o paciente continua la. Movida para OUTRO DIA, volta para Agendado: a
 *   grade de amanha nao pode mostrar o paciente como ja presente, e a regua
 *   so pede confirmacao a Agendado ou Aguardando confirmacao (achado R4).
 *
 * `mesmoDia` e calculado por quem chama, no fuso da clinica (diaCivil). Sem
 * ele vale o mesmo dia, que e o comportamento de antes para quem so quer
 * saber se a confirmacao se perde (nota do dialogo).
 */
export function statusAposRemarcar(
  status: AppointmentStatus,
  opcoes: { mesmoDia?: boolean } = {},
): AppointmentStatus {
  if (STATUS_QUE_VOLTAM_A_CONFIRMAR.includes(status)) {
    return "agendado";
  }
  if (STATUS_COM_PACIENTE_NA_CLINICA.includes(status)) {
    return (opcoes.mesmoDia ?? true) ? status : "agendado";
  }
  return status;
}

// ---------------------------------------------------------------------------
// Aviso de remarcacao na hora do envio
// ---------------------------------------------------------------------------

/**
 * Situacoes em que o aviso "sua consulta foi remarcada para X" nao sai mais:
 * as finais (cancelada, faltou, compareceu) e Em atendimento (o paciente ja
 * esta na sala; o aviso nao diz nada que ele precise saber).
 */
export const STATUS_SEM_AVISO_DE_REMARCACAO: AppointmentStatus[] = [
  ...STATUS_TERMINAIS,
  "em_atendimento",
];

export type ConsultaDoAviso = {
  status: AppointmentStatus;
  starts_at: string;
  professional_id: string;
};

/**
 * O aviso de remarcacao ainda diz a verdade? O texto sai com data e hora
 * congeladas na hora de enfileirar, e o job pode esperar minutos (canal
 * ocupado pela regua) ou mais de uma hora (retry de desconexao). So vale se a
 * consulta existe, esta viva, ainda comeca no instante e com o profissional
 * que o aviso anuncia, e esse instante nao passou. Uma remarcacao mais nova
 * enfileira o proprio aviso; o antigo morre sem sair (achados R3, R5, R10 e
 * R18).
 *
 * `esperado` com null (job enfileirado antes deste contrato) confere so a
 * situacao e o horario vencido. Comparacao de instantes (epoch), sem fuso.
 */
export function avisoDeRemarcacaoVale(
  consulta: ConsultaDoAviso | null,
  esperado: { startsAt: string | null; professionalId: string | null },
  agora: Date,
): boolean {
  if (!consulta) {
    return false;
  }
  if (STATUS_SEM_AVISO_DE_REMARCACAO.includes(consulta.status)) {
    return false;
  }
  const inicio = new Date(consulta.starts_at).getTime();
  if (!(inicio > agora.getTime())) {
    return false;
  }
  if (
    esperado.startsAt !== null &&
    new Date(esperado.startsAt).getTime() !== inicio
  ) {
    return false;
  }
  if (
    esperado.professionalId !== null &&
    esperado.professionalId !== consulta.professional_id
  ) {
    return false;
  }
  return true;
}
