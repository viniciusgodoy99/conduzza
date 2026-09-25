// Filtros da lista do Atendimento. PURO, zero I/O: a lista (components/
// atendimento/conversation-list.tsx) so chama estas funcoes, e o teste
// tests/unit/domain/filtros-da-conversa.test.ts trava cada regra.

import type { ConversationStatus } from "@/lib/design/status";
import {
  DDDS_VALIDOS,
  chaveDeTelefone,
  normalizarTelefone,
} from "@/lib/domain/telefone";

/** O que os filtros leem de uma conversa da lista. */
export type ConversaFiltravel = {
  status: ConversationStatus;
  awaiting_reply: boolean;
  last_inbound_at: string | null;
  last_message_at: string | null;
  contact: { name: string | null; phone_e164: string };
};

/**
 * Chip de situacao: um dos 4 status de conversa ou o recorte "sem resposta
 * ha mais de 24h", que atravessa status.
 */
export type FiltroDeSituacao = ConversationStatus | "sem_resposta_24h";

/** Filtros que chegam pela URL (?filtro=), vindos dos links do Inicio. */
export const FILTROS_DA_URL = ["aguardando", "sem_resposta_24h"] as const;

export type FiltroDaUrl = (typeof FILTROS_DA_URL)[number];

export function filtroDeSituacaoDaUrl(filtro: FiltroDaUrl): FiltroDeSituacao {
  return filtro === "aguardando" ? "aguardando_humano" : "sem_resposta_24h";
}

export const HORAS_SEM_RESPOSTA = 24;

/**
 * "Sem resposta ha mais de 24h", com o MESMO criterio da contagem do Inicio
 * (fetchProximasAcoes em lib/queries/relatorios.ts): awaiting_reply ligado,
 * conversa nao resolvida e a ultima fala do paciente (last_inbound_at) mais
 * antiga que 24 horas. Sem last_inbound_at nao entra (o `lt` do SQL tambem
 * descarta nulo). O numero do Inicio e a lista filtrada dizem a mesma coisa.
 */
export function semResposta24h(
  conversa: ConversaFiltravel,
  agora: number,
): boolean {
  if (!conversa.awaiting_reply || conversa.status === "resolvida") {
    return false;
  }
  if (!conversa.last_inbound_at) {
    return false;
  }
  const falou = Date.parse(conversa.last_inbound_at);
  return (
    Number.isFinite(falou) && falou < agora - HORAS_SEM_RESPOSTA * 3_600_000
  );
}

/**
 * O chip filtra o mesmo conjunto que ele conta: numero e lista dizem a mesma
 * coisa.
 *
 * "Aguardando voce" conta quem ESPERA RESPOSTA, nao quem tem o status. A
 * regua abre conversa em aguardando_humano so para enviar a confirmacao, e
 * pelo status um disparo de 40 confirmacoes mostraria "Aguardando voce 41"
 * numa manha em que um paciente so escreveu. Os outros chips de status contam
 * por status puro, que e o que eles significam.
 */
export function casaSituacao(
  conversa: ConversaFiltravel,
  filtro: FiltroDeSituacao,
  agora: number,
): boolean {
  if (filtro === "sem_resposta_24h") {
    return semResposta24h(conversa, agora);
  }
  if (conversa.status !== filtro) {
    return false;
  }
  return filtro === "aguardando_humano" ? conversa.awaiting_reply : true;
}

/**
 * Chave de ordem da lista: a fala mais recente do paciente primeiro. A MESMA
 * chave que o servidor usa no order by e que o cartao exibe como horario.
 */
export function recencia(conversa: ConversaFiltravel): number {
  const quando = conversa.last_inbound_at ?? conversa.last_message_at;
  if (!quando) {
    return 0;
  }
  const ms = Date.parse(quando);
  return Number.isFinite(ms) ? ms : 0;
}

function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Formas de um trecho de telefone digitado que valem a pena procurar:
 * como veio, sem o 55 do pais, sem zero de operadora, e com o nono digito
 * quando o trecho comeca por um DDD seguido de celular no formato antigo
 * ("85 9999-88" tambem acha quem esta gravado com o 9).
 */
function formasDoTrecho(digitos: string): string[] {
  const formas = new Set<string>([digitos]);
  const nacionais = new Set<string>([digitos.replace(/^0+/, "")]);
  if (digitos.startsWith("55") && digitos.length > 4) {
    nacionais.add(digitos.slice(2).replace(/^0+/, ""));
  }
  for (const nacional of nacionais) {
    if (nacional.length < 3) {
      continue;
    }
    formas.add(nacional);
    const ddd = nacional.slice(0, 2);
    const primeiroLocal = nacional[2] ?? "";
    if (DDDS_VALIDOS.has(ddd) && /[6-9]/.test(primeiroLocal)) {
      formas.add(`${ddd}9${nacional.slice(2)}`);
    }
  }
  return [...formas].filter((forma) => forma.length >= 3);
}

/**
 * Busca da lista: por nome (sem diferenca de acento e caixa) ou por telefone.
 *
 * Telefone e comparado por DIGITOS contra a chave canonica
 * (chaveDeTelefone, lib/domain/telefone.ts) e contra o numero como o
 * WhatsApp entregou: aceita mascara ("(85) 99999-8888"), com ou sem o 55, e
 * com ou sem o nono digito. Termo com letra e so nome. Menos de 3 digitos nao
 * busca telefone (um "9" acharia a clinica inteira).
 */
export function casaBusca(
  contato: ConversaFiltravel["contact"],
  termoBruto: string,
): boolean {
  const termo = termoBruto.trim();
  if (termo === "") {
    return true;
  }
  const termoSemAcento = semAcento(termo);
  if (semAcento(contato.name ?? "").includes(termoSemAcento)) {
    return true;
  }
  if (/\p{L}/u.test(termoSemAcento)) {
    return false;
  }
  const digitos = termo.replace(/\D/g, "");
  if (digitos.length < 3) {
    return false;
  }
  const alvos = [
    chaveDeTelefone(contato.phone_e164).replace(/\D/g, ""),
    contato.phone_e164.replace(/\D/g, ""),
  ];
  const completo = normalizarTelefone(termo);
  if (completo) {
    const chave = chaveDeTelefone(completo);
    if (chave === chaveDeTelefone(contato.phone_e164)) {
      return true;
    }
  }
  return formasDoTrecho(digitos).some((forma) =>
    alvos.some((alvo) => alvo.includes(forma)),
  );
}
