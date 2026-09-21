import type { StatusTone } from "@/lib/design/status";

// Etiquetas de CONVERSA (catalogo por clinica, 21/09/2026). Logica pura:
// roda no servidor e no cliente, e e o que os testes de unidade cobrem.
//
// Nome do arquivo e proposital: lib/domain/etiquetas.ts ja existe e e de
// outra coisa (os sinais DERIVADOS do paciente, risco de falta e inativo,
// que ninguem aplica).

/** Violeta ('ai') fica de fora: e RESERVADO para a IA (lib/design/status). */
export type TomDeEtiqueta = Exclude<StatusTone, "ai">;

export const TONS_DE_ETIQUETA: readonly TomDeEtiqueta[] = [
  "neutral",
  "info",
  "warning",
  "success",
  "alert",
];

export type EtiquetaDeConversa = {
  id: string;
  chave: string;
  nome: string;
  tom: TomDeEtiqueta;
};

/** O que o chip precisa para ser desenhado. */
export type ChipDeEtiquetaDados = {
  chave: string;
  nome: string;
  tom: TomDeEtiqueta;
};

export function porChaveDeEtiqueta(
  catalogo: readonly EtiquetaDeConversa[],
): Map<string, EtiquetaDeConversa> {
  return new Map(catalogo.map((etiqueta) => [etiqueta.chave, etiqueta]));
}

/**
 * Resolve as chaves guardadas em conversation.tags para o que a tela desenha,
 * em ordem de nome.
 *
 * Chave fora do catalogo so acontece com cache velho (o banco garante a
 * invariante): mostra a chave crua em tom neutro, porque mostrar a chave e
 * feio mas MENTIR seria pior, e sumir com o chip esconderia que a conversa
 * tem etiqueta.
 */
export function etiquetasDaConversa(
  tags: readonly string[],
  porChave: Map<string, EtiquetaDeConversa>,
): ChipDeEtiquetaDados[] {
  return tags
    .map((chave) => {
      const etiqueta = porChave.get(chave);
      return etiqueta
        ? { chave, nome: etiqueta.nome, tom: etiqueta.tom }
        : { chave, nome: chave, tom: "neutral" as const };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * A regra do filtro: marcar varias etiquetas SOMA os resultados (decisao do
 * dono). Nenhuma escolhida = nao filtra nada.
 */
export function casaEtiquetas(
  tagsDaConversa: readonly string[],
  escolhidas: readonly string[],
): boolean {
  return (
    escolhidas.length === 0 ||
    escolhidas.some((chave) => tagsDaConversa.includes(chave))
  );
}
