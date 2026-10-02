// Pacote com varios procedimentos (pedido do dono em 29/09/2026; migration
// 20260929120000_pacote_com_varios_procedimentos.sql). Logica pura, sem React
// e sem banco: o preco avulso que o cadastro mostra ao lado do preco do
// pacote, o desconto entre os dois e a conferencia da lista de itens antes
// de gravar (a RPC salvar_pacote confere de novo: esta aqui so da a mensagem
// antes da ida ao banco).
//
// Preco avulso = soma de sessoes x preco base (procedure.base_price_cents) de
// cada item. E CALCULADO, nunca gravado: mudar o preco base de um
// procedimento muda o avulso de todo pacote que o usa. O preco do pacote e o
// valor que a clinica define e nao e distribuido entre os itens.

/** Limites da RPC salvar_pacote (espelho; o banco e quem manda). */
export const ITENS_POR_PACOTE_MAX = 30;
export const SESSOES_POR_ITEM_MAX = 200;
export const NOME_DO_PACOTE_MAX = 80;

/** Um procedimento do pacote, como a tela edita e a RPC grava. */
export type ItemParaSalvar = {
  procedure_id: string;
  sessions: number;
};

/** O minimo de um procedimento para o preco avulso. */
export type ProcedimentoComPreco = {
  id: string;
  base_price_cents: number | null;
};

export type PrecoAvulso = {
  /** Soma de sessoes x preco base dos itens que TEM preco base. */
  centavos: number;
  /**
   * Itens cujo procedimento nao tem preco base (ou nao foi encontrado): a
   * soma acima fica incompleta, e a tela diz isso em vez de mostrar um
   * desconto que nao existe.
   */
  itensSemPreco: number;
};

export function precoAvulsoDoPacote(
  itens: readonly ItemParaSalvar[],
  procedimentos: readonly ProcedimentoComPreco[],
): PrecoAvulso {
  const precoPorId = new Map(
    procedimentos.map((procedimento) => [
      procedimento.id,
      procedimento.base_price_cents,
    ]),
  );
  let centavos = 0;
  let itensSemPreco = 0;
  for (const item of itens) {
    const preco = precoPorId.get(item.procedure_id);
    if (preco === undefined || preco === null) {
      itensSemPreco++;
      continue;
    }
    centavos += preco * item.sessions;
  }
  return { centavos, itensSemPreco };
}

export type DescontoDoPacote = {
  /**
   * Avulso menos pacote. Negativo quando o pacote sai MAIS caro que o
   * avulso: a tela mostra como acrescimo, nunca esconde.
   */
  centavos: number;
  /** centavos / avulso (0,2 = 20% de desconto; negativo = acrescimo). */
  fracao: number;
};

/**
 * Desconto do pacote sobre o avulso. null quando nao da para comparar: algum
 * item sem preco base (o avulso esta incompleto) ou avulso zero.
 */
export function descontoDoPacote(
  precoDoPacoteCentavos: number,
  avulso: PrecoAvulso,
): DescontoDoPacote | null {
  if (avulso.itensSemPreco > 0 || avulso.centavos <= 0) {
    return null;
  }
  const centavos = avulso.centavos - precoDoPacoteCentavos;
  return { centavos, fracao: centavos / avulso.centavos };
}

/** Total de sessoes do pacote (todas as sessoes de todos os itens). */
export function totalDeSessoes(itens: readonly { sessions: number }[]): number {
  return itens.reduce((soma, item) => soma + item.sessions, 0);
}

/**
 * Confere a lista de itens como a RPC salvar_pacote confere. Devolve a
 * mensagem para a tela (sem travessao, linguagem de recepcao) ou null quando
 * a lista pode ir ao banco.
 */
export function problemaNosItens(
  itens: readonly ItemParaSalvar[],
): string | null {
  if (itens.length === 0) {
    return "Escolha ao menos um procedimento para o pacote.";
  }
  if (itens.length > ITENS_POR_PACOTE_MAX) {
    return `Um pacote tem no máximo ${ITENS_POR_PACOTE_MAX} procedimentos.`;
  }
  if (
    itens.some(
      (item) =>
        !Number.isInteger(item.sessions) ||
        item.sessions < 1 ||
        item.sessions > SESSOES_POR_ITEM_MAX,
    )
  ) {
    return `Cada procedimento do pacote tem de 1 a ${SESSOES_POR_ITEM_MAX} sessões.`;
  }
  const procedimentos = new Set(itens.map((item) => item.procedure_id));
  if (procedimentos.size !== itens.length) {
    return "O mesmo procedimento aparece duas vezes no pacote.";
  }
  return null;
}
