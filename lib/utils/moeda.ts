// Formatacao de moeda em centavos, pt-BR. Fonte mono tabular fica no
// componente; aqui e so o texto.

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatarCentavos(cents: number): string {
  return formatador.format(cents / 100);
}

/**
 * Centavos para o texto de um campo de digitacao ("25000" -> "250,00").
 *
 * Movidas para ca na 4a copia (a tela do mapa de conversao): tres abas de
 * cadastros carregam versoes identicas, e a regra de composicao antes de
 * abstracao diz que o terceiro caso de uso e o teto.
 */
export function centavosParaReais(cents: number | null): string {
  if (cents === null) {
    return "";
  }
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Texto digitado para centavos; null quando vazio ou invalido. */
export function reaisParaCentavos(texto: string): number | null {
  const normalizado = texto.trim().replace(/\./g, "").replace(",", ".");
  if (normalizado === "") {
    return null;
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) {
    return null;
  }
  return Math.round(valor * 100);
}
