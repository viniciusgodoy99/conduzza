// A marca que substitui o nome do contato no texto que vai ao modelo
// (lib/agente/historico.ts) e o que a resposta do modelo faz com ela. PURO.
//
// [AG7 preparo] A mascara do nome (mascararNome) mora aqui desde a revisao
// da AG7 (CFM-1 e MOTOR-1, 03/11/2026): o historico mascara a conversa, e o
// laco (lib/agente/laco.ts, que o historico importa) refaz a mascara na fala
// da clinica DEPOIS de trocar o texto do preparo pelo marcador. Antes, a
// troca casava o texto da clinica com a fala JA mascarada, e o primeiro nome
// do contato dentro do texto ("dieta liquida clara" da contato Clara, "Dr.
// Joao", "Clinica Santa Maria") desfazia a igualdade: o texto inteiro ia ao
// modelo.

/**
 * O que substitui o nome do contato no texto que vai ao modelo. Uma palavra
 * comum, sem sinal nenhum: nao dispara o portao de entrada nem as regras de
 * saida (o teste de historico confere as duas).
 */
export const MARCA_DO_NOME = "Fulano";

// ---------------------------------------------------------------------------
// A mascara do nome do contato
// ---------------------------------------------------------------------------

const LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

/** Minusculo e sem acento, caractere a caractere (com o mapa de volta). */
function normalizarComMapa(texto: string): { texto: string; origem: number[] } {
  let normal = "";
  const origem: number[] = [];
  let indice = 0;
  for (const caractere of texto) {
    const simples = caractere
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (const parte of simples) {
      normal += parte;
      origem.push(indice);
    }
    indice += caractere.length;
  }
  return { texto: normal, origem };
}

function normalizar(texto: string): string {
  return normalizarComMapa(texto).texto;
}

/** O nome inteiro e o primeiro nome, normalizados, do maior para o menor. */
function formasDoNome(nome: string | null): string[] {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  if (limpo === "") {
    return [];
  }
  const formas = new Set<string>();
  const inteiro = normalizar(limpo);
  const primeiro = normalizar(limpo.split(" ")[0] ?? "");
  // Uma letra so mascararia "a" e "e" em todo texto: fica de fora.
  for (const forma of [inteiro, primeiro]) {
    if (Array.from(forma).filter((c) => LETRA_OU_DIGITO.test(c)).length >= 2) {
      formas.add(forma);
    }
  }
  return [...formas].sort((a, b) => b.length - a.length);
}

/** Um trecho do texto, em indices de unidade UTF-16 ([inicio, fim)). */
export type TrechoDoTexto = { inicio: number; fim: number };

/**
 * Troca o nome do contato (inteiro e o primeiro nome, palavra inteira, sem
 * diferenciar maiusculas e acentos) por MARCA_DO_NOME.
 */
export function mascararNome(texto: string, nome: string | null): string {
  const trechos = trechosDoNome(texto, nome);
  if (trechos.length === 0) {
    return texto;
  }
  let saida = texto;
  for (const { inicio, fim } of [...trechos].reverse()) {
    saida = `${saida.slice(0, inicio)}${MARCA_DO_NOME}${saida.slice(fim)}`;
  }
  return saida;
}

/**
 * [AG7 preparo] Os trechos do texto que mascararNome troca, em ordem e sem
 * sobrepor. O laco os usa para refazer a mascara so nas palavras da clinica
 * depois de trocar o texto do preparo (o marcador nunca e mascarado).
 */
export function trechosDoNome(
  texto: string,
  nome: string | null,
): TrechoDoTexto[] {
  const formas = formasDoNome(nome);
  if (formas.length === 0 || texto === "") {
    return [];
  }
  const { texto: normal, origem } = normalizarComMapa(texto);
  const trechos: TrechoDoTexto[] = [];
  const ocupado = new Array<boolean>(normal.length).fill(false);
  for (const forma of formas) {
    let de = 0;
    while (de <= normal.length - forma.length) {
      const achou = normal.indexOf(forma, de);
      if (achou < 0) {
        break;
      }
      const fim = achou + forma.length;
      const antes = achou > 0 ? normal[achou - 1] : "";
      const depois = fim < normal.length ? normal[fim] : "";
      const palavraInteira =
        !(antes && LETRA_OU_DIGITO.test(antes)) &&
        !(depois && LETRA_OU_DIGITO.test(depois));
      const livre = !ocupado.slice(achou, fim).some(Boolean);
      if (palavraInteira && livre) {
        for (let i = achou; i < fim; i += 1) {
          ocupado[i] = true;
        }
        const inicioOriginal = origem[achou] ?? 0;
        const ultimo = origem[fim - 1] ?? inicioOriginal;
        // O fim no original: o caractere inteiro do ultimo indice.
        const fimOriginal =
          ultimo + ((texto.codePointAt(ultimo) ?? 0) > 0xffff ? 2 : 1);
        trechos.push({ inicio: inicioOriginal, fim: fimOriginal });
      }
      de = achou + 1;
    }
  }
  return trechos.sort((a, b) => a.inicio - b.inicio);
}

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
