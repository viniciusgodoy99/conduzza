import type { SaldoParaComparecimento } from "@/lib/domain/appointment-status";
import {
  problemaNosItens,
  SESSOES_POR_ITEM_MAX,
  type DescontoDoPacote,
  type ItemParaSalvar,
} from "@/lib/domain/pacotes";

// Regras PURAS das telas de pacote (pacote com varios procedimentos, pedido
// do dono em 29/09/2026): as linhas de "Procedimentos do pacote" no cadastro,
// o resumo "Botox 2x + Facelift 1x" da tabela, o texto do desconto, as
// sessoes ja usadas da venda em andamento e do ajuste na ficha, e a frase do
// Compareceu na Agenda. Zero I/O e zero React: quem grava sao as Server
// Actions, e o banco confere tudo de novo (salvar_pacote, vender_pacote,
// ajustar_saldo_de_pacote). Aqui so sai a mensagem certa antes da ida ao
// banco.

// ---------------------------------------------------------------------------
// Cadastro do pacote (aba Pacotes)
// ---------------------------------------------------------------------------

/**
 * Uma linha de "Procedimentos do pacote" no formulario. As sessoes ficam em
 * TEXTO, como o campo guarda: quem apaga o numero para digitar outro nao ve
 * o campo pular para 0.
 */
export type LinhaDoItem = {
  procedure_id: string;
  sessions: string;
};

/** Sessoes com que um procedimento entra no pacote ao ser adicionado. */
export const SESSOES_DO_ITEM_NOVO = "1";

/** As linhas do formulario a partir dos itens gravados (editar pacote). */
export function linhasDoPacote(
  itens: readonly { procedure_id: string; sessions: number }[],
): LinhaDoItem[] {
  return itens.map((item) => ({
    procedure_id: item.procedure_id,
    sessions: String(item.sessions),
  }));
}

/**
 * Adiciona o procedimento no fim da lista, com 1 sessao. O mesmo
 * procedimento aparece uma vez so no pacote: escolher de novo nao duplica.
 */
export function adicionarItem(
  linhas: readonly LinhaDoItem[],
  procedureId: string,
): LinhaDoItem[] {
  if (
    procedureId === "" ||
    linhas.some((linha) => linha.procedure_id === procedureId)
  ) {
    return [...linhas];
  }
  return [
    ...linhas,
    { procedure_id: procedureId, sessions: SESSOES_DO_ITEM_NOVO },
  ];
}

export function removerItem(
  linhas: readonly LinhaDoItem[],
  procedureId: string,
): LinhaDoItem[] {
  return linhas.filter((linha) => linha.procedure_id !== procedureId);
}

export function trocarSessoes(
  linhas: readonly LinhaDoItem[],
  procedureId: string,
  sessions: string,
): LinhaDoItem[] {
  return linhas.map((linha) =>
    linha.procedure_id === procedureId ? { ...linha, sessions } : linha,
  );
}

/** Sessoes digitadas de um item: inteiro de 1 a 200, ou null. */
export function lerSessoes(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d+$/.test(limpo)) {
    return null;
  }
  const sessoes = Number(limpo);
  return sessoes >= 1 && sessoes <= SESSOES_POR_ITEM_MAX ? sessoes : null;
}

/**
 * Itens para o calculo AO VIVO do preco avulso: null enquanto alguma linha
 * tem sessao invalida (a soma mentiria) ou a lista esta vazia.
 */
export function itensParaCalcular(
  linhas: readonly LinhaDoItem[],
): ItemParaSalvar[] | null {
  if (linhas.length === 0) {
    return null;
  }
  const itens: ItemParaSalvar[] = [];
  for (const linha of linhas) {
    const sessions = lerSessoes(linha.sessions);
    if (sessions === null) {
      return null;
    }
    itens.push({ procedure_id: linha.procedure_id, sessions });
  }
  return itens;
}

export type ItensDasLinhas =
  { ok: true; itens: ItemParaSalvar[] } | { ok: false; erro: string };

/**
 * As linhas do formulario viram os itens que a Server Action grava, ou a
 * mensagem do que corrigir (nomeando o procedimento quando o erro e dele).
 */
export function itensDasLinhas(
  linhas: readonly LinhaDoItem[],
  nomeDe: (procedureId: string) => string,
): ItensDasLinhas {
  const itens: ItemParaSalvar[] = [];
  for (const linha of linhas) {
    const sessions = lerSessoes(linha.sessions);
    if (sessions === null) {
      return {
        ok: false,
        erro: `As sessões de ${nomeDe(linha.procedure_id)} vão de 1 a ${SESSOES_POR_ITEM_MAX}.`,
      };
    }
    itens.push({ procedure_id: linha.procedure_id, sessions });
  }
  const problema = problemaNosItens(itens);
  return problema ? { ok: false, erro: problema } : { ok: true, itens };
}

/**
 * "Botox 2x + Facelift 1x": o que o pacote inclui, numa linha, na ordem dos
 * itens (o catalogo ja os ordena pelo nome do procedimento).
 */
export function resumoDosItens(
  itens: readonly { procedure_id: string; sessions: number }[],
  nomeDe: (procedureId: string) => string,
): string {
  return itens
    .map((item) => `${nomeDe(item.procedure_id)} ${item.sessions}x`)
    .join(" + ");
}

const PERCENTUAL = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

/**
 * O tamanho do desconto (ou do acrescimo) em porcentagem, sem sinal: "20%",
 * "14,3%". Diferenca que arredonda para 0% nao vira "0%": seria um pacote
 * com desconto dizendo que nao tem.
 */
export function percentualDoDesconto(desconto: DescontoDoPacote): string {
  const tamanho = Math.abs(desconto.fracao);
  if (desconto.centavos !== 0 && tamanho < 0.0005) {
    return "menos de 0,1%";
  }
  return PERCENTUAL.format(tamanho);
}

/**
 * O desconto em texto, nos tres casos: mais barato que o avulso, mais caro
 * (acrescimo, mostrado, nunca escondido) ou igual.
 */
export function textoDoDesconto(desconto: DescontoDoPacote): string {
  if (desconto.centavos > 0) {
    return `${percentualDoDesconto(desconto)} de desconto`;
  }
  if (desconto.centavos < 0) {
    return `${percentualDoDesconto(desconto)} acima do avulso`;
  }
  return "Mesmo valor do avulso";
}

// ---------------------------------------------------------------------------
// Ficha do paciente: venda em andamento e ajuste
// ---------------------------------------------------------------------------

/** Um procedimento do pacote a venda, como o dialogo de venda o mostra. */
export type ItemVendavel = {
  procedure_id: string;
  nome: string;
  sessions: number;
};

export type UsadasParaVender =
  | { ok: true; usadas: { procedure_id: string; sessions_used: number }[] }
  | { ok: false; erro: string };

/**
 * Sessoes ja usadas de cada procedimento do pacote em andamento (comprado
 * antes do sistema). Espelha a RPC vender_pacote: cada item vai de 0 ate as
 * sessoes dele, e a venda precisa sobrar ao menos 1 sessao no total. Campo
 * vazio conta como 0. So os itens com sessao usada vao para o banco (os
 * ausentes nascem com 0).
 */
export function usadasParaVender(
  itens: readonly ItemVendavel[],
  digitadas: Readonly<Record<string, string>>,
): UsadasParaVender {
  const usadas: { procedure_id: string; sessions_used: number }[] = [];
  let restantes = 0;
  for (const item of itens) {
    const texto = (digitadas[item.procedure_id] ?? "").trim();
    const numero = texto === "" ? 0 : /^\d+$/.test(texto) ? Number(texto) : NaN;
    if (!Number.isInteger(numero) || numero < 0 || numero > item.sessions) {
      return {
        ok: false,
        erro: `As sessões já usadas de ${item.nome} vão de 0 a ${item.sessions}.`,
      };
    }
    restantes += item.sessions - numero;
    if (numero > 0) {
      usadas.push({ procedure_id: item.procedure_id, sessions_used: numero });
    }
  }
  if (restantes <= 0) {
    return {
      ok: false,
      erro: "Com essas sessões já usadas não sobra nenhuma para descontar. Confira as sessões.",
    };
  }
  return { ok: true, usadas };
}

/** Um item da venda, como o dialogo de ajuste o mostra. */
export type ItemAjustavel = {
  id: string;
  procedure_name: string | null;
  sessions_total: number;
  sessions_used: number;
};

export type ItensDoAjuste =
  | { ok: true; itens: { item_id: string; sessions_used: number }[] }
  | { ok: false; erro: string };

/**
 * Sessoes usadas de cada item no ajuste. Espelha a RPC
 * ajustar_saldo_de_pacote: de 0 ate o total do item. Devolve SO os itens
 * que mudaram (a RPC grava uma linha de historico por item mudado); campo
 * que nao foi mexido vale o que ja estava gravado.
 */
export function itensDoAjuste(
  itens: readonly ItemAjustavel[],
  digitadas: Readonly<Record<string, string>>,
): ItensDoAjuste {
  const mudados: { item_id: string; sessions_used: number }[] = [];
  for (const item of itens) {
    const texto = (digitadas[item.id] ?? String(item.sessions_used)).trim();
    const numero = /^\d+$/.test(texto) ? Number(texto) : NaN;
    if (!Number.isInteger(numero) || numero > item.sessions_total) {
      return {
        ok: false,
        erro: `As sessões usadas de ${item.procedure_name ?? "cada procedimento"} vão de 0 a ${item.sessions_total}.`,
      };
    }
    if (numero !== item.sessions_used) {
      mudados.push({ item_id: item.id, sessions_used: numero });
    }
  }
  return { ok: true, itens: mudados };
}

/**
 * Vendas que alguma consulta ja descontou: essas nao se cancelam (a consulta
 * guarda a venda e o item que usou), so se ajustam. A consulta pode apontar
 * so o item, entao o item leva a venda dele.
 */
export function vendasQueJaDescontaram(
  consultas: readonly {
    package_balance_id: string | null;
    package_balance_item_id: string | null;
  }[],
  vendas: readonly { id: string; itens: readonly { id: string }[] }[],
): string[] {
  const vendaDoItem = new Map<string, string>();
  for (const venda of vendas) {
    for (const item of venda.itens) {
      vendaDoItem.set(item.id, venda.id);
    }
  }
  const descontaram = new Set<string>();
  for (const consulta of consultas) {
    if (consulta.package_balance_id !== null) {
      descontaram.add(consulta.package_balance_id);
    }
    const daVenda =
      consulta.package_balance_item_id === null
        ? undefined
        : vendaDoItem.get(consulta.package_balance_item_id);
    if (daVenda !== undefined) {
      descontaram.add(daVenda);
    }
  }
  return [...descontaram];
}

// ---------------------------------------------------------------------------
// Compareceu (menu da consulta na Agenda)
// ---------------------------------------------------------------------------

function sessoesUsadas(total: number): string {
  return total === 1 ? "usada" : "usadas";
}

/**
 * A frase do dialogo do Compareceu, com o estado DEPOIS de marcar:
 * "Desconta 1 sessão de Botox do pacote Harmonização (2 de 3 usadas)."
 * O procedimento vem do item; sem nome, o da consulta.
 */
export function fraseDoDescontoAoComparecer(
  saldo: SaldoParaComparecimento,
  procedimentoDaConsulta: string,
): string {
  const procedimento = saldo.procedure_name ?? procedimentoDaConsulta;
  const pacote = saldo.package_name
    ? `do pacote ${saldo.package_name}`
    : "do pacote";
  const usadasDepois = Math.min(saldo.sessions_used + 1, saldo.sessions_total);
  return `Desconta 1 sessão de ${procedimento} ${pacote} (${usadasDepois} de ${saldo.sessions_total} ${sessoesUsadas(saldo.sessions_total)}).`;
}

/** Quantas sessoes do procedimento sobram naquela venda depois de marcar. */
export function sobraDepoisDoDesconto(saldo: SaldoParaComparecimento): number {
  return Math.max(saldo.sessions_total - saldo.sessions_used - 1, 0);
}

/** A linha de baixo do dialogo: o que sobra do procedimento naquela venda. */
export function fraseDoQueSobra(
  saldo: SaldoParaComparecimento,
  procedimentoDaConsulta: string,
): string {
  const procedimento = saldo.procedure_name ?? procedimentoDaConsulta;
  const sobra = sobraDepoisDoDesconto(saldo);
  if (sobra === 0) {
    return `Depois de marcar, acabam as sessões de ${procedimento} deste pacote.`;
  }
  return sobra === 1
    ? `Depois de marcar, sobra 1 sessão de ${procedimento} neste pacote.`
    : `Depois de marcar, sobram ${sobra} sessões de ${procedimento} neste pacote.`;
}
