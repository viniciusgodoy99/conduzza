import { TOKEN_ALPHABET, TOKEN_LENGTH } from "@/lib/domain/attribution";

// Codigo do clique em caracteres INVISIVEIS (etapa 3c do plano de 16/11/2026,
// como no Q5): em vez de " [#K7Q2MX]" no fim da mensagem pronta, o codigo vai
// escondido logo depois da primeira palavra. A pessoa ve so a frase; quem
// apaga "aquele codigo estranho" some de cena. Regras PURAS, zero I/O.
//
// O codigo tem 6 caracteres de um alfabeto de 31 (5 bits cada, 30 bits). Cada
// caractere invisivel carrega 2 bits, entao sao 15 invisiveis seguidos. A
// leitura so aceita uma sequencia de EXATAMENTE 15 deles que decodifique num
// codigo valido: emoji composto (que usa U+200D) e texto de outra ferramenta
// com centenas de invisiveis nao viram codigo.
//
// No FIM da mensagem o WhatsApp corta os invisiveis (achado do Q5): por isso
// o codigo entra depois da primeira palavra e, em mensagem de uma palavra so,
// nao entra (quem chama usa o codigo visivel).
//
// SO LIGA DEPOIS DE TESTE COM CELULAR REAL pela uazapi (decisao do plano): a
// rota do link usa o invisivel com CODIGO_INVISIVEL_LIGADO (link-rastreado.ts)
// ou, para o teste, com ?cz_invisivel=1 no endereco. A LEITURA vale sempre: a ingestao tira o
// codigo invisivel do texto antes de gravar a mensagem (a conversa e a IA
// nunca veem o codigo) e atribui a origem por ele.

/** 2 bits cada: U+200B, U+200C, U+200D e U+2060. */
const INVISIVEIS = ["​", "‌", "‍", "⁠"] as const;
const CLASSE = "​‌‍⁠";
const BITS_POR_SIMBOLO = 5;
const TAMANHO_DA_SEQUENCIA = (TOKEN_LENGTH * BITS_POR_SIMBOLO) / 2;

/**
 * Cada trecho so de invisiveis, do tamanho que tiver. So vale o de EXATAMENTE
 * 15 (conferido na leitura). Sem lookbehind de proposito: este modulo tambem
 * vai para o navegador (pela aba Origem dos leads), e Safari antigo nao
 * entende lookbehind.
 */
const TRECHOS_INVISIVEIS = new RegExp(`[${CLASSE}]+`, "g");

/** O parametro do endereco que forca o codigo invisivel (teste do dono). */
export const PARAMETRO_DO_CODIGO_INVISIVEL = "cz_invisivel";

/** O codigo (6 caracteres do alfabeto) em 15 caracteres invisiveis. */
export function codificarCodigoInvisivel(codigo: string): string | null {
  const maiusculo = codigo.toUpperCase();
  if (maiusculo.length !== TOKEN_LENGTH) {
    return null;
  }
  let bits = "";
  for (const simbolo of maiusculo) {
    const indice = TOKEN_ALPHABET.indexOf(simbolo);
    if (indice < 0) {
      return null;
    }
    bits += indice.toString(2).padStart(BITS_POR_SIMBOLO, "0");
  }
  let invisivel = "";
  for (let i = 0; i < bits.length; i += 2) {
    invisivel += INVISIVEIS[parseInt(bits.slice(i, i + 2), 2)];
  }
  return invisivel;
}

function decodificar(sequencia: string): string | null {
  let bits = "";
  for (const caractere of sequencia) {
    const valor = INVISIVEIS.indexOf(caractere as (typeof INVISIVEIS)[number]);
    if (valor < 0) {
      return null;
    }
    bits += valor.toString(2).padStart(2, "0");
  }
  let codigo = "";
  for (let i = 0; i < bits.length; i += BITS_POR_SIMBOLO) {
    const simbolo = TOKEN_ALPHABET[parseInt(bits.slice(i, i + BITS_POR_SIMBOLO), 2)];
    if (simbolo === undefined) {
      return null;
    }
    codigo += simbolo;
  }
  return codigo.length === TOKEN_LENGTH ? codigo : null;
}

/**
 * A mensagem pronta com o codigo escondido logo depois da primeira palavra.
 * Null quando nao da (codigo fora do alfabeto, ou mensagem de uma palavra
 * so: no fim o WhatsApp corta os invisiveis): quem chama usa o visivel.
 */
export function mensagemComCodigoInvisivel(
  mensagem: string,
  codigo: string,
): string | null {
  const invisivel = codificarCodigoInvisivel(codigo);
  if (!invisivel) {
    return null;
  }
  const palavra = /^\s*\S+(?=\s+\S)/.exec(mensagem);
  if (!palavra) {
    return null;
  }
  return (
    mensagem.slice(0, palavra[0].length) +
    invisivel +
    mensagem.slice(palavra[0].length)
  );
}

/**
 * Tira do texto o codigo invisivel (a primeira sequencia valida) e devolve os
 * dois. Sem codigo, o texto volta como veio, com os invisiveis que tiver.
 */
export function separarCodigoInvisivel(texto: string | null): {
  texto: string | null;
  codigo: string | null;
} {
  if (!texto) {
    return { texto, codigo: null };
  }
  for (const achado of texto.matchAll(TRECHOS_INVISIVEIS)) {
    if (achado[0].length !== TAMANHO_DA_SEQUENCIA) {
      continue;
    }
    const codigo = decodificar(achado[0]);
    if (codigo) {
      return {
        texto:
          texto.slice(0, achado.index) +
          texto.slice(achado.index + achado[0].length),
        codigo,
      };
    }
  }
  return { texto, codigo: null };
}
