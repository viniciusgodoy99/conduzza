// Ferramenta consultar_minhas_consultas do agente de IA (AG4, 27/10/2026,
// remarcar e cancelar): as consultas futuras do contato da conversa, para a
// pessoa escolher qual cancelar ou remarcar. PURO: a definicao, a entrada, as
// situacoes (lista fechada), a ordem e os codigos (c1 a c5) e o espelho em TS
// da conferencia do banco (conferir_consulta_da_ia, migration
// 20261028100000_remarcar_e_cancelar_pela_ia.sql). Quem le e
// lib/agente/agenda.ts (service role, clinic_id e contato do servidor); quem
// guarda os codigos do turno e monta a saida e agenda-do-turno.ts.
//
// LGPD e decisao D-13 do dono: ao modelo vao SO o dia, a hora e a situacao de
// cada consulta. Procedimento, profissional, convenio e unidade ficam no
// servidor (os fatos do turno levam o profissional e a unidade para as regras
// do filtro, nunca para o resumo do verificador).
//
// Quais consultas (D-25, recomendacao): toda consulta FUTURA do contato nas
// quatro situacoes antes do atendimento (agendado, aguardando confirmacao,
// confirmado pelo paciente e pela recepcao), menos as recusadas, inclusive as
// que a recepcao marcou. A IA nunca mexe em encaixe, em procedimento so com a
// equipe, em remarcacao pendente nem (so para remarcar, D-26) em consulta
// ainda pendente da equipe; passada e com falta nem aparecem (a IA nunca fala
// de falta).

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import type { AcaoComPrazo } from "@/lib/domain/agente/config";

import type { CatalogoDoAgente } from "./buscar-procedimento";

export const NOME_DAS_MINHAS_CONSULTAS = "consultar_minhas_consultas";

/** No maximo isto de consultas por resposta (ha_mais diz se ha outras). */
export const MAXIMO_DE_CONSULTAS_NA_LISTA = 5;

/** As quatro situacoes antes do atendimento (o update do botao, MINT). */
export const STATUS_ANTES_DO_ATENDIMENTO = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
] as const;

const UMA_HORA_MS = 60 * 60_000;

export const entradaDasMinhasConsultasSchema = z.object({}).strict();

export const FERRAMENTA_CONSULTAR_MINHAS_CONSULTAS: FunctionTool = {
  type: "function",
  name: NOME_DAS_MINHAS_CONSULTAS,
  strict: true,
  description:
    "Lista as próximas consultas da pessoa desta conversa (até 5), cada uma com um código (c1, c2...), o dia, a hora e a situação. Use antes de cancelar ou remarcar, nesta resposta.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/**
 * Uma consulta futura do contato, como a porta le (so o servidor ve isto).
 */
export type ConsultaDoContato = {
  id: string;
  /** ISO (UTC). */
  inicio: string;
  fim: string;
  status: string;
  /** appointment.approval_status (nulo: consulta da recepcao). */
  aprovacao: string | null;
  /** appointment.is_overbooking. */
  encaixe: boolean;
  serviceLinkId: string;
  profissionalId: string;
  unidadeId: string | null;
  /**
   * appointment.remarcacao_de: esta consulta E a remarcacao (pendente ou
   * aprovada) de outra, a de id `remarcacaoDe`.
   */
  remarcacaoDe: string | null;
  /** Outra consulta pendente tem remarcacao_de = esta (a remarcacao pedida). */
  temRemarcacaoPendente: boolean;
};

export type ConsultasDoContato = {
  /** Ordenadas pelo inicio (e id), no maximo MAXIMO_DE_CONSULTAS_NA_LISTA. */
  consultas: ConsultaDoContato[];
  haMais: boolean;
};

/** A situacao que vai ao modelo (lista fechada). */
export const SITUACOES_DA_CONSULTA = [
  "marcada",
  "confirmada",
  "aguardando_aprovacao",
  "remarcacao_aguardando_aprovacao",
  "remarcacao_pedida",
] as const;
export type SituacaoDaConsulta = (typeof SITUACOES_DA_CONSULTA)[number];

/** A situacao da consulta para o modelo. */
export function situacaoDaConsulta(c: ConsultaDoContato): SituacaoDaConsulta {
  if (c.aprovacao === "pendente") {
    return c.remarcacaoDe === null
      ? "aguardando_aprovacao"
      : "remarcacao_aguardando_aprovacao";
  }
  if (c.temRemarcacaoPendente) {
    return "remarcacao_pedida";
  }
  return c.status === "confirmado_paciente" ||
    c.status === "confirmado_recepcao"
    ? "confirmada"
    : "marcada";
}

/** Como a trilha diz cada situacao (linguagem de recepcao). */
export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDaConsulta, string>> =
  {
    marcada: "marcada",
    confirmada: "confirmada",
    aguardando_aprovacao: "esperando a aprovação da equipe",
    remarcacao_aguardando_aprovacao:
      "remarcação pedida pelo assistente, esperando a aprovação da equipe",
    remarcacao_pedida: "com remarcação pedida, esperando a aprovação da equipe",
  };

/**
 * A consulta conta para a lista: futura, numa das quatro situacoes e nao
 * recusada. Nunca lanca.
 */
export function consultaListavel(
  c: Pick<ConsultaDoContato, "inicio" | "status" | "aprovacao">,
  agoraMs: number,
): boolean {
  const inicio = Date.parse(c.inicio);
  return (
    Number.isFinite(inicio) &&
    inicio > agoraMs &&
    (STATUS_ANTES_DO_ATENDIMENTO as readonly string[]).includes(c.status) &&
    c.aprovacao !== "recusado"
  );
}

/** A ordem da lista: pelo inicio e, no empate, pelo id. */
export function emOrdem<T extends Pick<ConsultaDoContato, "inicio" | "id">>(
  consultas: readonly T[],
): T[] {
  return [...consultas].sort(
    (a, b) =>
      Date.parse(a.inicio) - Date.parse(b.inicio) || a.id.localeCompare(b.id),
  );
}

/**
 * Os motivos do espelho de conferir_consulta_da_ia, na ORDEM do banco. Quem
 * decide de verdade e o banco (as RPCs conferem de novo); isto adianta a
 * recusa para a frase certa e a nota da equipe.
 */
export const MOTIVOS_DA_CONFERENCIA_DA_CONSULTA = [
  "consulta_nao_encontrada",
  "consulta_encerrada",
  "encaixe",
  "so_com_a_equipe",
  "pendente_da_equipe",
  "remarcacao_pendente",
  "fora_do_prazo",
] as const;
export type MotivoDaConferenciaDaConsulta =
  (typeof MOTIVOS_DA_CONFERENCIA_DA_CONSULTA)[number];

/**
 * O espelho em TS de conferir_consulta_da_ia (desenho da AG4, 3.3 a), na
 * ordem do banco:
 *  - consulta_nao_encontrada: nenhuma consulta (outro contato ou clinica);
 *  - consulta_encerrada: fora das quatro situacoes, passada ou recusada;
 *  - encaixe;
 *  - so_com_a_equipe: o vinculo nao e do agente (sem "IA pode agendar", ou o
 *    procedimento, o profissional ou o convenio inativo): o catalogo da IA so
 *    tem os vinculos que ela marca;
 *  - pendente_da_equipe: so na remarcacao (D-26), a consulta ainda espera a
 *    aprovacao da equipe;
 *  - remarcacao_pendente: e uma remarcacao pendente, ou tem uma;
 *  - fora_do_prazo: o inicio e antes de agora mais o prazo da clinica (a IA
 *    age se inicio >= agora + prazo). Prazo nulo (habilidade sem prazo) vale
 *    fora do prazo: falha fechada.
 * Nulo: pode. Nunca lanca.
 */
export function conferirConsultaDaIa(entrada: {
  consulta: ConsultaDoContato | null | undefined;
  acao: AcaoComPrazo;
  prazoHoras: number | null;
  agoraMs: number;
  catalogo: Pick<CatalogoDoAgente, "vinculos">;
}): MotivoDaConferenciaDaConsulta | null {
  const { consulta: c, acao } = entrada;
  if (c === null || c === undefined) {
    return "consulta_nao_encontrada";
  }
  if (!consultaListavel(c, entrada.agoraMs)) {
    return "consulta_encerrada";
  }
  if (c.encaixe) {
    return "encaixe";
  }
  const vinculo = entrada.catalogo.vinculos.find(
    (v) => v.id === c.serviceLinkId,
  );
  if (
    vinculo === undefined ||
    vinculo.id === null ||
    vinculo.duracaoMin === null ||
    vinculo.duracaoMin <= 0 ||
    vinculo.profissionalId !== c.profissionalId
  ) {
    return "so_com_a_equipe";
  }
  if (acao === "remarcar" && c.aprovacao === "pendente") {
    return "pendente_da_equipe";
  }
  if (
    (c.remarcacaoDe !== null && c.aprovacao === "pendente") ||
    c.temRemarcacaoPendente
  ) {
    return "remarcacao_pendente";
  }
  if (
    entrada.prazoHoras === null ||
    Date.parse(c.inicio) < entrada.agoraMs + entrada.prazoHoras * UMA_HORA_MS
  ) {
    return "fora_do_prazo";
  }
  return null;
}

/**
 * Teto, em bytes, de UMA saida de consultar_minhas_consultas (a reserva do
 * gasto, laco.ts): cinco consultas com o dia mais longo ("sábado, 31/12/2027"),
 * a situacao mais longa e o ha_mais.
 */
export function limiteDaSaidaDasMinhasConsultas(): number {
  const maiorSituacao = Math.max(...SITUACOES_DA_CONSULTA.map((s) => s.length));
  return 120 + MAXIMO_DE_CONSULTAS_NA_LISTA * (96 + maiorSituacao);
}
