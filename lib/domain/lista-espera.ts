import { TZDate } from "@date-fns/tz";

import {
  interpretarResposta,
  normalizar,
} from "@/lib/domain/resposta-paciente";

// Logica PURA da lista de espera (tarefa 4.9), zero I/O: o casamento entre a
// vaga que abriu e as preferencias da fila, a montagem da onda e o
// vocabulario da resposta a oferta. Quem le o banco e envia e o job em
// lib/jobs/lista-espera.ts; quem decide o vencedor e a RPC (FOR UPDATE).

export type Turno = "manha" | "tarde" | "noite";

export type EntradaDaFila = {
  id: string;
  contactId: string;
  procedureId: string | null;
  professionalId: string | null;
  preferredShifts: string[];
  preferredWeekdays: number[];
  priority: number;
  createdAt: string;
};

export type SlotVago = {
  professionalId: string;
  /** 0=domingo..6=sabado, no fuso da clinica. */
  weekday: number;
  turno: Turno;
};

/** Repouso entre ofertas de SLOTS DIFERENTES para a mesma pessoa. */
export const REPOUSO_POS_OFERTA_MS = 2 * 60 * 60 * 1000;

/** Manha ate 11:59, tarde ate 17:59, noite dai em diante (fuso da clinica). */
export function turnoDoInstante(instante: Date, timezone: string): Turno {
  const hora = new TZDate(instante.getTime(), timezone).getHours();
  if (hora < 12) {
    return "manha";
  }
  if (hora < 18) {
    return "tarde";
  }
  return "noite";
}

/** Dia da semana no fuso da clinica (0=domingo, convencao getDay). */
export function diaDaSemanaNoFuso(instante: Date, timezone: string): number {
  return new TZDate(instante.getTime(), timezone).getDay();
}

/**
 * A entrada casa com a vaga? Campo vazio ou nulo e "sem preferencia" e casa
 * com tudo; preferencia declarada precisa bater. Procedimento so restringe
 * quando o profissional da vaga NAO atende o procedimento pedido (o conjunto
 * vem de service_link ativo).
 */
export function casaComSlot(
  entrada: EntradaDaFila,
  slot: SlotVago,
  procedimentosDoProfissional: ReadonlySet<string>,
): boolean {
  if (
    entrada.professionalId !== null &&
    entrada.professionalId !== slot.professionalId
  ) {
    return false;
  }
  if (
    entrada.procedureId !== null &&
    !procedimentosDoProfissional.has(entrada.procedureId)
  ) {
    return false;
  }
  if (
    entrada.preferredShifts.length > 0 &&
    !entrada.preferredShifts.includes(slot.turno)
  ) {
    return false;
  }
  if (
    entrada.preferredWeekdays.length > 0 &&
    !entrada.preferredWeekdays.includes(slot.weekday)
  ) {
    return false;
  }
  return true;
}

/**
 * Os N primeiros da fila que casam com a vaga: prioridade, depois quem
 * espera ha mais tempo; um contato entra UMA vez mesmo com duas entradas.
 */
export function montarOnda(params: {
  entradas: readonly EntradaDaFila[];
  slot: SlotVago;
  procedimentosDoProfissional: ReadonlySet<string>;
  excluirContatos: ReadonlySet<string>;
  tamanho: number;
}): EntradaDaFila[] {
  const ordenadas = [...params.entradas].sort(
    (a, b) =>
      a.priority - b.priority ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const onda: EntradaDaFila[] = [];
  const vistos = new Set<string>();
  for (const entrada of ordenadas) {
    if (onda.length >= params.tamanho) {
      break;
    }
    if (vistos.has(entrada.contactId)) {
      continue;
    }
    if (params.excluirContatos.has(entrada.contactId)) {
      continue;
    }
    if (
      !casaComSlot(entrada, params.slot, params.procedimentosDoProfissional)
    ) {
      continue;
    }
    vistos.add(entrada.contactId);
    onda.push(entrada);
  }
  return onda;
}

// A oferta pergunta sim ou nao, e a mensagem instrui "responda SIM" /
// "responda NAO QUERO". Os sets de confirmacao/cancelamento da 4.7 valem
// (inclusive "1" e "3" de quem responde como no menu), mais o vocabulario
// natural de oferta. "Remarcar" nao significa nada numa oferta.
const ACEITAR_EXTRA = new Set(["quero", "aceito", "sim quero", "eu quero"]);
const RECUSAR_EXTRA = new Set(["nao", "nao quero", "nao posso", "agora nao"]);

export type RespostaDeOferta = "aceitar" | "recusar" | "nao_reconhecida";

export function interpretarRespostaDeOferta(
  body: string | null,
): RespostaDeOferta {
  if (!body) {
    return "nao_reconhecida";
  }
  const texto = normalizar(body);
  if (ACEITAR_EXTRA.has(texto)) {
    return "aceitar";
  }
  if (RECUSAR_EXTRA.has(texto)) {
    return "recusar";
  }
  const base = interpretarResposta(body);
  if (base === "confirmar") {
    return "aceitar";
  }
  if (base === "cancelar") {
    return "recusar";
  }
  return "nao_reconhecida";
}
