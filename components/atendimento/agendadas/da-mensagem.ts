import type {
  AgendadaDoFio,
  AgendadasDoFio,
} from "@/lib/domain/mensagem-agendada";

// A agendada de onde uma mensagem do fio saiu (bolha "{Ana} · Mensagem
// agendada").
//
// O fio NAO embute mais mensagem_agendada (achado 16 da revisao): uma tabela
// que faltasse, ou um embed recusado pelo PostgREST, derrubava o fio de todas
// as conversas. A autoria vem de uma consulta separada e tolerante a erro
// (fetchAgendadasDoFio, chave agendadasKeys.doFio). Aqui ficam o recorte das
// mensagens que podem ter saido de uma agendada (so elas vao na consulta) e a
// assinatura desse recorte, que entra na chave: mensagem nova ou pagina
// antiga carregada pede uma leitura nova, com os ids certos.

/** O minimo da mensagem do fio que decide se ela pode ter vindo de agendada. */
type MensagemDoFio = {
  id: string;
  direction: "entrada" | "saida";
  author: string;
  is_internal_note: boolean;
  pelo_celular?: boolean;
  deleted_at: string | null;
};

/**
 * Os ids das mensagens que podem ter saido de uma agendada: resposta de
 * pessoa da equipe (author 'usuario'), pelo sistema, nao apagada. Paciente,
 * IA, nota interna e o que saiu pelo celular nunca sao agendada.
 */
export function idsQuePodemTerSaidoDeAgendada(
  mensagens: readonly MensagemDoFio[],
): string[] {
  return mensagens
    .filter(
      (m) =>
        m.direction === "saida" &&
        m.author === "usuario" &&
        !m.is_internal_note &&
        m.pelo_celular !== true &&
        m.deleted_at === null,
    )
    .map((m) => m.id);
}

/**
 * A assinatura do recorte, para a chave da consulta. O fio so cresce nas
 * pontas (mensagem nova no fim, pagina antiga no comeco) e a ordem e a do
 * fio, entao quantidade, primeiro e ultimo bastam: chave curta, sem a lista
 * inteira de uuids.
 */
export function assinaturaDosIds(ids: readonly string[]): string {
  if (ids.length === 0) {
    return "0";
  }
  return `${ids.length}:${ids[0]}:${ids[ids.length - 1]}`;
}

/** O mapa vazio (consulta desligada, carregando ou com erro). */
export const SEM_AGENDADAS_DO_FIO: AgendadasDoFio = {};

/** A agendada de onde a mensagem saiu, ou null. */
export function agendadaDaMensagem(
  agendadas: AgendadasDoFio,
  messageId: string,
): AgendadaDoFio | null {
  // hasOwn: um id como "constructor" nao pode achar nada no prototipo.
  return Object.hasOwn(agendadas, messageId)
    ? (agendadas[messageId] ?? null)
    : null;
}
