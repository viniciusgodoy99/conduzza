// Acoes em massa da Tela 4 em lotes (achado 95 da revisao). As Server Actions
// aceitam ate 100 contatos por chamada (idsSchema em app/(app)/leads/actions)
// e a lista nao pagina: "Selecionar todos" numa etapa com 127 leads mandava
// 127 ids de uma vez e o Zod recusava com uma mensagem generica. Aqui a
// selecao vira lotes de 100, chamados em sequencia, com progresso; se um lote
// falha, o que ja foi gravado fica gravado e a tela diz quantos mudaram e
// quantos nao. PURO, sem React: testado em tests/unit/leads/em-lotes.test.ts.

/** Mesmo teto do idsSchema das Server Actions de Leads. */
export const LOTE_DE_ACOES = 100;

export type ResultadoDaAcao = { ok: boolean; error?: string };

export type ResultadoEmLotes = {
  /** Ids dos lotes que deram certo, na ordem original */
  feitos: string[];
  /** Ids do lote que falhou e dos que nem foram tentados */
  restantes: string[];
  /** Mensagem do lote que falhou; null quando tudo deu certo */
  erro: string | null;
};

/**
 * Chama a acao lote a lote, em sequencia (nunca em paralelo: a ordem do
 * progresso e a do que foi gravado). Para no primeiro lote que falhar.
 */
export async function executarEmLotes(
  ids: readonly string[],
  acao: (lote: string[]) => Promise<ResultadoDaAcao>,
  aoProgredir?: (feitos: number) => void,
  tamanho: number = LOTE_DE_ACOES,
): Promise<ResultadoEmLotes> {
  const feitos: string[] = [];
  for (let inicio = 0; inicio < ids.length; inicio += tamanho) {
    const lote = ids.slice(inicio, inicio + tamanho);
    let resultado: ResultadoDaAcao;
    try {
      resultado = await acao(lote);
    } catch {
      resultado = { ok: false };
    }
    if (!resultado.ok) {
      return {
        feitos,
        restantes: ids.slice(inicio),
        erro: resultado.error ?? "Não foi possível concluir.",
      };
    }
    feitos.push(...lote);
    aoProgredir?.(feitos.length);
  }
  return { feitos, restantes: [], erro: null };
}

/** "1 lead" ou "12 leads". */
export function contarLeads(n: number): string {
  return n === 1 ? "1 lead" : `${n} leads`;
}

/**
 * Frase de falha parcial, sem travessao: diz quantos mudaram, quantos nao e
 * por que. Com nada gravado, volta so o motivo.
 */
export function mensagemDeFalhaParcial(
  resultado: ResultadoEmLotes,
  total: number,
): string {
  const motivo = resultado.erro ?? "Não foi possível concluir.";
  if (resultado.feitos.length === 0) {
    return motivo;
  }
  return `${resultado.feitos.length} de ${total} leads foram alterados. Os outros ${resultado.restantes.length} continuam como estavam. ${motivo}`;
}
