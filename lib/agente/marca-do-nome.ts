// A marca que substitui o nome do contato no texto que vai ao modelo
// (lib/agente/historico.ts) e o que a resposta do modelo faz com ela. PURO.

/**
 * O que substitui o nome do contato no texto que vai ao modelo. Uma palavra
 * comum, sem sinal nenhum: nao dispara o portao de entrada nem as regras de
 * saida (o teste de historico confere as duas).
 */
export const MARCA_DO_NOME = "Fulano";

// A marca e as formas que o modelo pode devolver: o feminino ("Fulana",
// concordando com o artigo da mensagem, "aqui e a Fulano"), qualquer caixa
// e um tratamento colado na frente ("Sr. Fulano", "Dona Fulana").
// "Fulanos" e "Fulaninho" nao casam (palavra inteira).
const MARCA_NA_RESPOSTA =
  /,?[^\S\n]*(?<!\p{L})(?:(?:sr|sra|srta|dr|dra|seu|dona)\.?[^\S\n]+)?fulan[oa](?!\p{L})/giu;

const TEM_A_MARCA = /(?<!\p{L})fulan[oa](?!\p{L})/iu;

/**
 * Tira a marca da resposta do modelo, com a virgula do vocativo (conferencia
 * da revisao do E3, executor N2): "Fulano" como vocativo e tratamento
 * depreciativo, e o texto passaria nas duas camadas do filtro. "Olá, Fulano!
 * A consulta..." vira "Olá! A consulta..."; "Oi Fulano, tudo bem?" vira "Oi,
 * tudo bem?"; no comeco, a primeira letra que sobra vai para maiuscula. Roda
 * ANTES do filtro de saida (o filtro confere o texto que sai). O prompt
 * tambem avisa o modelo (TEXTO_FIXO_DO_AGENTE); prompt nao e garantia. Se
 * nao sobrar letra nenhuma ("Fulano!" vira "!"), quem chama trata como
 * saida invalida (falha fechada, laco.ts).
 */
export function semAMarcaDoNome(texto: string): string {
  if (!TEM_A_MARCA.test(texto)) {
    return texto;
  }
  const sem = texto.replace(MARCA_NA_RESPOSTA, "");
  const inicio = sem.replace(/^[\s,]+/u, "");
  if (inicio === sem) {
    return sem;
  }
  return inicio.charAt(0).toLocaleUpperCase("pt-BR") + inicio.slice(1);
}
