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

// Formatos aceitos (achado 34: "250.00" virava R$ 25.000,00 porque todo
// ponto era tratado como milhar):
// - com virgula, a virgula e o decimal e os pontos sao milhar: "1.250,50",
//   "1250,5", "250,00";
// - sem virgula, ponto seguido de 1 ou 2 digitos no fim e decimal (teclado
//   ou navegador em ingles): "250.00", "120.5";
// - sem virgula, grupos de 3 digitos separados por ponto sao milhar:
//   "1.200", "1.200.000";
// - so digitos: reais inteiros ("250").
// Qualquer outra forma e AMBIGUA ou errada ("1,250", "12.3456", "1.2.3") e
// volta como invalida, para a tela pedir de novo em vez de gravar um valor
// que ninguem digitou.
const COM_VIRGULA = /^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/;
const PONTO_DECIMAL = /^\d+\.\d{1,2}$/;
const PONTO_MILHAR = /^\d{1,3}(\.\d{3})+$/;
const SO_DIGITOS = /^\d+$/;

/**
 * Le o valor em reais digitado e devolve centavos.
 * - `null`: campo vazio (a tela decide se vazio e permitido);
 * - `undefined`: texto que nao e um valor em reais valido;
 * - numero: centavos inteiros.
 */
export function lerReais(texto: string): number | null | undefined {
  const limpo = texto
    .trim()
    .replace(/^R\$\s*/i, "")
    .trim();
  if (limpo === "") {
    return null;
  }
  let normalizado: string;
  if (COM_VIRGULA.test(limpo)) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (PONTO_DECIMAL.test(limpo)) {
    normalizado = limpo;
  } else if (PONTO_MILHAR.test(limpo)) {
    normalizado = limpo.replace(/\./g, "");
  } else if (SO_DIGITOS.test(limpo)) {
    normalizado = limpo;
  } else {
    return undefined;
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) {
    return undefined;
  }
  return Math.round(valor * 100);
}

/** Texto digitado para centavos; null quando vazio ou invalido. */
export function reaisParaCentavos(texto: string): number | null {
  return lerReais(texto) ?? null;
}
