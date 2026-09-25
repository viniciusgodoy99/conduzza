// Os numeros de WhatsApp da clinica, vistos pelo Atendimento (docs/07, Fase
// 4: selo no cartao, numero no cabecalho do fio, filtro "Numero" e o
// compositor que diz por que a resposta nao sai). PURO, zero I/O: a tela so
// chama estas funcoes, e tests/unit/atendimento/numeros-no-inbox.test.ts
// trava cada regra.
//
// Regra geral (docs/07): tudo isto so aparece quando a clinica tem MAIS DE UM
// numero ativo. Com um numero so, o Inbox fica como sempre foi. A excecao e o
// numero REMOVIDO: a conversa dele diz sempre de qual numero era, porque a
// clinica tinha mais de um quando ela nasceu, e a resposta dela nao sai mais
// por lugar nenhum.

import { formatarTelefone } from "@/lib/domain/telefone";
import type {
  NumeroDaClinica,
  NumeroRemovido,
  NumerosDoInbox,
} from "@/lib/queries/conversations";

export type { NumeroRemovido, NumerosDoInbox };

export const SEM_NUMEROS: NumerosDoInbox = { ativos: [], removidos: [] };

/** Mais de um numero ativo: e so ai que o Inbox fala de numero. */
export function variosNumeros(numeros: NumerosDoInbox): boolean {
  return numeros.ativos.length > 1;
}

/** O numero de uma conversa, ativo ou removido. */
export type NumeroDaConversa =
  | { estado: "ativo"; numero: NumeroDaClinica }
  | { estado: "removido"; numero: NumeroRemovido };

/**
 * O numero da conversa que a tela deve MOSTRAR, ou null.
 *
 * Ativo so com mais de um numero ativo (com um so, "o WhatsApp da clinica"
 * diz tudo). Removido sempre. Conversa sem numero (clinica que ainda nao tem
 * nenhum) ou com um numero que esta aba ainda nao conhece: null, e a tela
 * fica como sempre foi, sem inventar nome.
 */
export function numeroParaMostrar(
  conversa: { whatsapp_account_id?: string | null },
  numeros: NumerosDoInbox,
): NumeroDaConversa | null {
  const id = conversa.whatsapp_account_id;
  if (!id) {
    return null;
  }
  const ativo = numeros.ativos.find((numero) => numero.id === id);
  if (ativo) {
    return variosNumeros(numeros) ? { estado: "ativo", numero: ativo } : null;
  }
  const removido = numeros.removidos.find((numero) => numero.id === id);
  return removido ? { estado: "removido", numero: removido } : null;
}

/** Por que a resposta ao paciente nao sai por causa do numero, ou null. */
export type TravaDoNumero =
  | { motivo: "desconectado"; nome: string }
  | { motivo: "removido"; nome: string };

/**
 * A resposta desta conversa esta presa ao numero dela (uma conversa por
 * numero, decisao 1 do dono): desconectado, ela espera a reconexao e nunca
 * sai por outro; removido, ela nao sai mais. So "conectado" libera, a mesma
 * regra do envio (canSendDecision).
 */
export function travaDoNumero(
  mostrado: NumeroDaConversa | null,
): TravaDoNumero | null {
  if (!mostrado) {
    return null;
  }
  if (mostrado.estado === "removido") {
    return { motivo: "removido", nome: mostrado.numero.nome };
  }
  return mostrado.numero.connection_status === "conectado"
    ? null
    : { motivo: "desconectado", nome: mostrado.numero.nome };
}

/**
 * O telefone pareado do numero, formatado, ou null.
 *
 * display_phone ja guardou o NOME DO PERFIL do WhatsApp em vez do telefone
 * (achado N[2] da revisao da Fase 2): o que nao tem de 10 a 15 digitos nao e
 * telefone e nao aparece. Com 10 ou 11 digitos e numero nacional (DDD e
 * numero, sem o pais; o DDD 55 existe) e ganha o 55.
 */
export function telefoneDoNumero(displayPhone: string | null): string | null {
  if (!displayPhone || /[a-z]/i.test(displayPhone)) {
    return null;
  }
  const digitos = displayPhone.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) {
    return null;
  }
  const comPais = digitos.length <= 11 ? `55${digitos}` : digitos;
  return formatarTelefone(`+${comPais}`);
}

/** Uma opcao do filtro "Numero" da lista. */
export type OpcaoDeNumero = {
  id: string;
  nome: string;
  removido: boolean;
  /** conversas carregadas deste numero: o chip conta o que ele filtra */
  total: number;
};

/**
 * As opcoes do filtro "Numero", fora o "Todos": os ativos na ordem da clinica
 * e, depois deles, os removidos que ainda tem conversa na lista (o arquivo de
 * resolvidas aberto, por exemplo). Removido sem conversa carregada nao vira
 * chip: filtraria uma lista vazia.
 */
export function opcoesDoFiltroDeNumero(
  conversas: readonly { whatsapp_account_id?: string | null }[],
  numeros: NumerosDoInbox,
): OpcaoDeNumero[] {
  const porNumero = new Map<string, number>();
  for (const conversa of conversas) {
    const id = conversa.whatsapp_account_id;
    if (id) {
      porNumero.set(id, (porNumero.get(id) ?? 0) + 1);
    }
  }
  const ativos = numeros.ativos.map((numero) => ({
    id: numero.id,
    nome: numero.nome,
    removido: false,
    total: porNumero.get(numero.id) ?? 0,
  }));
  const removidos = numeros.removidos
    .filter((numero) => (porNumero.get(numero.id) ?? 0) > 0)
    .map((numero) => ({
      id: numero.id,
      nome: numero.nome,
      removido: true,
      total: porNumero.get(numero.id) ?? 0,
    }));
  return [...ativos, ...removidos];
}

/** A conversa passa no filtro "Numero" (null = Todos). */
export function casaNumero(
  conversa: { whatsapp_account_id?: string | null },
  numeroId: string | null,
): boolean {
  return numeroId === null || conversa.whatsapp_account_id === numeroId;
}

/**
 * A linha de whatsapp_account como chega no Realtime (a linha nova inteira)
 * ou numa leitura parcial. Tudo opcional.
 */
export type LinhaDoNumeroNoInbox = {
  id?: string;
  nome?: string;
  display_phone?: string | null;
  connection_status?: string | null;
  principal?: boolean;
  connected_at?: string | null;
  removido_em?: string | null;
};

function mesmoNumero(a: NumeroDaClinica, b: NumeroDaClinica): boolean {
  return (
    a.nome === b.nome &&
    a.display_phone === b.display_phone &&
    a.connection_status === b.connection_status &&
    a.principal === b.principal &&
    a.connected_at === b.connected_at
  );
}

/** O principal primeiro; os outros mantem a ordem em que ja estavam. */
function principalPrimeiro(ativos: NumeroDaClinica[]): NumeroDaClinica[] {
  return [
    ...ativos.filter((numero) => numero.principal),
    ...ativos.filter((numero) => !numero.principal),
  ];
}

/**
 * Aplica UMA linha de whatsapp_account aos numeros do Inbox, pelo id.
 *
 * Devolve o MESMO objeto quando nada do que a tela usa mudou: toda reserva de
 * slot de envio faz UPDATE em whatsapp_account (achado 6 do docs/07), e um
 * objeto novo a cada mensagem enviada redesenharia o Inbox inteiro em todas
 * as abas.
 *
 * Removido sai dos ativos e passa a nomear as conversas antigas. Numero
 * desconhecido so entra com o minimo para a tela (id, nome e status), que e o
 * caso do evento de Realtime.
 */
export function aplicarLinhaAosNumeros(
  numeros: NumerosDoInbox,
  linha: LinhaDoNumeroNoInbox,
): NumerosDoInbox {
  const id = linha.id;
  if (!id) {
    return numeros;
  }
  const indice = numeros.ativos.findIndex((numero) => numero.id === id);
  const atual = indice === -1 ? undefined : numeros.ativos[indice];

  if (linha.removido_em) {
    const nome =
      typeof linha.nome === "string" ? linha.nome : (atual?.nome ?? null);
    const jaRemovido = numeros.removidos.some((numero) => numero.id === id);
    if (!atual && (jaRemovido || nome === null)) {
      return numeros;
    }
    return {
      ativos: atual
        ? numeros.ativos.filter((numero) => numero.id !== id)
        : numeros.ativos,
      removidos:
        jaRemovido || nome === null
          ? numeros.removidos
          : [...numeros.removidos, { id, nome }],
    };
  }

  if (!atual) {
    if (
      typeof linha.nome !== "string" ||
      typeof linha.connection_status !== "string"
    ) {
      return numeros;
    }
    const novo: NumeroDaClinica = {
      id,
      nome: linha.nome,
      display_phone: linha.display_phone ?? null,
      connection_status: linha.connection_status,
      principal: linha.principal === true,
      connected_at: linha.connected_at ?? null,
    };
    return {
      // Voltou de removido (o banco aceita desfazer a remocao): sai da lista
      // dos removidos para nao aparecer duas vezes.
      ativos: principalPrimeiro([...numeros.ativos, novo]),
      removidos: numeros.removidos.filter((numero) => numero.id !== id),
    };
  }

  const proximo: NumeroDaClinica = {
    id,
    nome: typeof linha.nome === "string" ? linha.nome : atual.nome,
    display_phone:
      linha.display_phone !== undefined
        ? linha.display_phone
        : atual.display_phone,
    connection_status:
      typeof linha.connection_status === "string"
        ? linha.connection_status
        : atual.connection_status,
    principal:
      typeof linha.principal === "boolean" ? linha.principal : atual.principal,
    connected_at:
      linha.connected_at !== undefined
        ? linha.connected_at
        : atual.connected_at,
  };
  if (mesmoNumero(atual, proximo)) {
    return numeros;
  }
  const ativos = numeros.ativos.map((numero) =>
    numero.id === id ? proximo : numero,
  );
  return {
    ativos:
      proximo.principal !== atual.principal
        ? principalPrimeiro(ativos)
        : ativos,
    removidos: numeros.removidos,
  };
}
