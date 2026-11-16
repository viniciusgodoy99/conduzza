import { z } from "zod";

import {
  extrairToken,
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
} from "@/lib/domain/attribution";
import type { Database } from "@/lib/supabase/database.types";

// Regras PURAS do rastreio do site (F1 do Google, pedido do dono em
// 04/10/2026): zero I/O, testaveis direto.
//
// O anuncio do Google leva ao SITE da clinica. O site ganha uma linha de
// script (public/rastreio/v1.js) que, so em visita vinda de anuncio do
// Google, acrescenta um codigo por clique ao texto do link do WhatsApp
// (" [#K7Q2MX]", o mesmo formato e alfabeto do codigo fixo de campaign_link)
// e avisa a rota publica app/api/publico/clique. A rota valida o corpo com o
// schema daqui e chama registrar_clique_do_site com a service role.
//
// Botao sem mensagem pronta (ajuste de 04/10/2026): o texto antes do codigo
// e uma das frases da clinica (de 1 a 5, sorteada por clique). O script
// busca as frases ao carregar, so com sinal do Google, na rota publica
// app/api/publico/rastreio/[chave] (que chama frases_do_rastreio com a
// service role), e usa FRASE_PADRAO se a busca falhar ou nao voltar a tempo.
//
// O SCRIPT NAO IMPORTA ESTE MODULO: ele e um arquivo estatico, sem build e
// sem dependencia, que roda no site da clinica. Por isso as regras que ele
// tambem aplica (sinais da URL, frases da resposta, sorteio e o link com o
// codigo) existem nos dois lugares, e tests/unit/rastreio/script-v1.test.ts
// roda o script de verdade e confere que ele faz EXATAMENTE o que as funcoes
// daqui fazem. Mudou uma, muda a outra.
//
// Os formatos sao os mesmos dos CHECKs e da validacao de
// registrar_clique_do_site (supabase/migrations/20261005100000): o que passa
// aqui nunca volta 22023 do banco.

/**
 * Teto do corpo do aviso. Os 4 identificadores somam ate 2 KB e as 5 UTMs,
 * com acento, ate 1,5 KB.
 */
export const LIMITE_DO_CORPO_EM_BYTES = 4096;

/** Onde o script fica, a partir do endereco do sistema. */
export const CAMINHO_DO_SCRIPT = "/rastreio/v1.js";

/** Para onde o script manda o aviso do clique. */
export const CAMINHO_DO_AVISO = "/api/publico/clique";

/**
 * Sufixo de URL final que a clinica (ou a agencia) poe no Google Ads, em
 * Configuracoes da conta, Acompanhamento. Opcional: o Google ja manda
 * gad_campaignid; o sufixo reforca a campanha e traz o grupo de anuncios.
 */
export const SUFIXO_DE_URL_FINAL =
  "cz_campanha={campaignid}&cz_grupo={adgroupid}";

/**
 * Frase de fabrica: vai antes do codigo quando o botao do site nao tem
 * mensagem pronta e a clinica nao cadastrou outras, ou quando a busca das
 * frases falha ou nao volta a tempo (pedido do dono em 04/10/2026). E
 * IDENTICA ao default de rastreio_do_site.frases (migration 20261005110000)
 * e a FRASE_PADRAO do script (la escrita com escape unicode, para nao
 * depender do charset da pagina da clinica). Os testes conferem os tres.
 */
export const FRASE_PADRAO =
  "Olá! Vim pelo site e gostaria de agendar uma consulta.";

/** Nome antigo de FRASE_PADRAO (contrato do banco, item 6). */
export const TEXTO_SEM_MENSAGEM_PRONTA = FRASE_PADRAO;

/** Quantas frases a clinica cadastra, no maximo (check do banco). */
export const LIMITE_DE_FRASES = 5;

/** Tamanho maximo de uma frase, em caracteres (check do banco). */
export const TAMANHO_MAXIMO_DA_FRASE = 300;

/** Onde o script busca as frases da clinica (seguido da chave). */
export const CAMINHO_DAS_FRASES = "/api/publico/rastreio/";

export const FORMATO_DA_CHAVE = /^[0-9a-f]{20}$/;
export const FORMATO_DO_CODIGO = new RegExp(
  `^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`,
);
/** gclid, gbraid e wbraid (o Google nao publica o maximo; 512 de folga). */
export const FORMATO_DO_IDENTIFICADOR = /^[A-Za-z0-9._~+/=-]{1,512}$/;
export const FORMATO_DO_GAD_SOURCE = /^[A-Za-z0-9_-]{1,32}$/;
/** Id de campanha e de grupo de anuncios do Google: so digitos. */
export const FORMATO_DO_ID_DO_GOOGLE = /^[0-9]{1,20}$/;
export const FORMATO_DO_HOST = /^[a-z0-9.-]{1,253}$/;

/**
 * Parametros da URL que contam como sinal de anuncio do Google, na ordem em
 * que o script os le. cz_campanha e cz_grupo vem do SUFIXO_DE_URL_FINAL.
 */
export const PARAMETROS_DO_GOOGLE = [
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "gad_campaignid",
  "cz_campanha",
  "cz_grupo",
] as const;

/**
 * Sinais do anuncio da Meta que leva ao site (etapa 2 do plano de 16/11/2026):
 * o fbclid que a Meta poe na URL e o numero do anuncio, que vem dos
 * PARAMETROS_DE_URL_DA_META.
 */
export const PARAMETROS_DA_META = ["fbclid", "cz_anuncio"] as const;

/** As UTMs da visita (bio, e-mail, anuncio): detalhe da origem do lead. */
export const PARAMETROS_UTM = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

/**
 * As familias de sinal. Na pagina seguinte da mesma aba, a familia que vem
 * na URL substitui a guardada INTEIRA e as outras ficam (juntarSinais): um
 * link interno com UTM nao apaga o clique do anuncio que trouxe a visita.
 */
export const FAMILIAS_DE_SINAL = [
  PARAMETROS_DO_GOOGLE,
  PARAMETROS_DA_META,
  PARAMETROS_UTM,
] as const;

/** Todos os sinais que o script le, na ordem em que os le. */
export const PARAMETROS_DO_RASTREIO = [
  ...PARAMETROS_DO_GOOGLE,
  ...PARAMETROS_DA_META,
  ...PARAMETROS_UTM,
] as const;

export type ParametroDoRastreio = (typeof PARAMETROS_DO_RASTREIO)[number];

export type SinaisDoRastreio = Partial<Record<ParametroDoRastreio, string>>;

/**
 * Parametros de URL que a clinica (ou a agencia) poe no anuncio da Meta que
 * leva ao site. A Meta troca as chaves pelos valores do anuncio.
 */
export const PARAMETROS_DE_URL_DA_META =
  "utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&cz_anuncio={{ad.id}}";

/** Numero do anuncio da Meta (so digitos), o mesmo formato do id do Google. */
export const FORMATO_DO_ID_DA_META = FORMATO_DO_ID_DO_GOOGLE;

/**
 * UTM: texto livre de ate 100 caracteres, sem caractere de controle nem
 * quebra de linha. O regex conta unidades UTF-16 e o banco conta caracteres:
 * o que passa aqui cabe la.
 */
export const FORMATO_DA_UTM = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,100}$/;

const FORMATO_DO_PARAMETRO: Record<ParametroDoRastreio, RegExp> = {
  gclid: FORMATO_DO_IDENTIFICADOR,
  gbraid: FORMATO_DO_IDENTIFICADOR,
  wbraid: FORMATO_DO_IDENTIFICADOR,
  gad_source: FORMATO_DO_GAD_SOURCE,
  gad_campaignid: FORMATO_DO_ID_DO_GOOGLE,
  cz_campanha: FORMATO_DO_ID_DO_GOOGLE,
  cz_grupo: FORMATO_DO_ID_DO_GOOGLE,
  fbclid: FORMATO_DO_IDENTIFICADOR,
  cz_anuncio: FORMATO_DO_ID_DA_META,
  utm_source: FORMATO_DA_UTM,
  utm_medium: FORMATO_DA_UTM,
  utm_campaign: FORMATO_DA_UTM,
  utm_content: FORMATO_DA_UTM,
  utm_term: FORMATO_DA_UTM,
};

/**
 * Sinais (Google, Meta e UTMs) na query da pagina (`location.search`). Valor
 * vazio ou fora do formato e descartado SOZINHO: um `cz_grupo` vazio
 * (Performance Max nao tem grupo) nao pode custar o gclid que veio junto.
 * Nenhum sinal valido: null, e o script nao faz nada.
 */
export function sinaisDaUrl(busca: string): SinaisDoRastreio | null {
  const parametros = new URLSearchParams(busca);
  return sinaisValidos((nome) => parametros.get(nome));
}

/** So os sinais conhecidos e no formato, na ordem de PARAMETROS_DO_RASTREIO. */
export function sinaisValidos(
  ler: (nome: ParametroDoRastreio) => unknown,
): SinaisDoRastreio | null {
  const sinais: SinaisDoRastreio = {};
  let algum = false;
  for (const nome of PARAMETROS_DO_RASTREIO) {
    const valor = ler(nome);
    if (typeof valor === "string" && FORMATO_DO_PARAMETRO[nome].test(valor)) {
      sinais[nome] = valor;
      algum = true;
    }
  }
  return algum ? sinais : null;
}

/**
 * Os sinais guardados na aba com os da URL desta pagina: a familia que veio
 * na URL substitui a guardada inteira, as outras ficam (FAMILIAS_DE_SINAL).
 */
export function juntarSinais(
  guardados: SinaisDoRastreio | null,
  daUrl: SinaisDoRastreio | null,
): SinaisDoRastreio | null {
  const juntos: SinaisDoRastreio = {};
  let algum = false;
  for (const familia of FAMILIAS_DE_SINAL) {
    const veioNaUrl =
      daUrl !== null && familia.some((nome) => daUrl[nome] !== undefined);
    const fonte = veioNaUrl ? daUrl : guardados;
    if (!fonte) {
      continue;
    }
    for (const nome of familia) {
      const valor = fonte[nome];
      if (valor !== undefined) {
        juntos[nome] = valor;
        algum = true;
      }
    }
  }
  return algum ? juntos : null;
}

// ---------------------------------------------------------------------------
// Corpo do aviso (rota publica)
// ---------------------------------------------------------------------------

/**
 * Corpo que o script manda (JSON em text/plain). Estrito: campo a mais,
 * formato errado ou nenhum sinal recusam o corpo inteiro, e a rota responde
 * 204 sem tocar no banco.
 */
export const corpoDoCliqueSchema = z
  .strictObject({
    chave: z.string().regex(FORMATO_DA_CHAVE),
    codigo: z.string().regex(FORMATO_DO_CODIGO),
    gclid: z.string().regex(FORMATO_DO_IDENTIFICADOR).optional(),
    gbraid: z.string().regex(FORMATO_DO_IDENTIFICADOR).optional(),
    wbraid: z.string().regex(FORMATO_DO_IDENTIFICADOR).optional(),
    gad_source: z.string().regex(FORMATO_DO_GAD_SOURCE).optional(),
    gad_campaignid: z.string().regex(FORMATO_DO_ID_DO_GOOGLE).optional(),
    cz_campanha: z.string().regex(FORMATO_DO_ID_DO_GOOGLE).optional(),
    cz_grupo: z.string().regex(FORMATO_DO_ID_DO_GOOGLE).optional(),
    fbclid: z.string().regex(FORMATO_DO_IDENTIFICADOR).optional(),
    cz_anuncio: z.string().regex(FORMATO_DO_ID_DA_META).optional(),
    utm_source: z.string().regex(FORMATO_DA_UTM).optional(),
    utm_medium: z.string().regex(FORMATO_DA_UTM).optional(),
    utm_campaign: z.string().regex(FORMATO_DA_UTM).optional(),
    utm_content: z.string().regex(FORMATO_DA_UTM).optional(),
    utm_term: z.string().regex(FORMATO_DA_UTM).optional(),
  })
  .refine((corpo) => contarSinais(corpo) > 0, {
    message: "Nenhum sinal.",
  });

export type CorpoDoClique = z.infer<typeof corpoDoCliqueSchema>;

/** Quantos dos sinais vieram (vai no log como `count`). */
export function contarSinais(corpo: SinaisDoRastreio): number {
  return PARAMETROS_DO_RASTREIO.filter((nome) => corpo[nome] !== undefined)
    .length;
}

export type LeituraDoCorpo =
  | { ok: true; corpo: CorpoDoClique }
  | { ok: false; motivo: "json_invalido" | "fora_do_formato" };

/** Le o texto do corpo (ja limitado em bytes pela rota). */
export function lerCorpoDoClique(texto: string): LeituraDoCorpo {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  const resultado = corpoDoCliqueSchema.safeParse(bruto);
  if (!resultado.success) {
    return { ok: false, motivo: "fora_do_formato" };
  }
  return { ok: true, corpo: resultado.data };
}

/**
 * Host do site que mandou o aviso, tirado do cabecalho Origin. So o host:
 * nunca o caminho da pagina, que pode revelar interesse de saude. Origin
 * ausente, "null" (iframe isolado, politica no-referrer) ou fora do formato
 * (IPv6): null, que o banco aceita.
 */
export function hostDoOrigin(origin: string | null): string | null {
  if (!origin) {
    return null;
  }
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return FORMATO_DO_HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** O que registrar_clique_do_site devolve (a rota responde 204 em todos). */
export const RESULTADOS_DO_REGISTRO = [
  "ok",
  "chave_invalida",
  "desligado",
  "limite",
  "duplicado",
  "codigo_reservado",
] as const;

export type ResultadoDoRegistro = (typeof RESULTADOS_DO_REGISTRO)[number];

/**
 * O retorno da funcao como um dos resultados conhecidos, ou "desconhecido".
 * Vai para o log como `status`: lista fechada, nada que venha de fora.
 */
export function resultadoDoRegistro(
  retorno: unknown,
): ResultadoDoRegistro | "desconhecido" {
  return (
    RESULTADOS_DO_REGISTRO.find((resultado) => resultado === retorno) ??
    "desconhecido"
  );
}

export type ArgumentosDoRegistro =
  Database["public"]["Functions"]["registrar_clique_do_site"]["Args"];

/** Os argumentos dos sinais, iguais em registrar_clique_do_site e _do_link. */
export type ArgumentosDosSinais = Pick<
  ArgumentosDoRegistro,
  | "p_gclid"
  | "p_gbraid"
  | "p_wbraid"
  | "p_gad_source"
  | "p_google_campaign_id"
  | "p_google_adgroup_id"
  | "p_fbclid"
  | "p_meta_ad_id"
  | "p_utm_source"
  | "p_utm_medium"
  | "p_utm_campaign"
  | "p_utm_content"
  | "p_utm_term"
>;

/**
 * Os sinais como argumentos do banco. Campo ausente fica FORA do objeto (o
 * default da funcao e null). Campanha: o sufixo `cz_campanha` ({campaignid})
 * vence o `gad_campaignid` quando os dois vem, porque e o valor documentado
 * do ValueTrack; que os dois sejam iguais ainda e SUPOSICAO a conferir no
 * primeiro clique real.
 */
export function argumentosDosSinais(
  sinais: SinaisDoRastreio,
): ArgumentosDosSinais {
  const argumentos: ArgumentosDosSinais = {};
  if (sinais.gclid !== undefined) {
    argumentos.p_gclid = sinais.gclid;
  }
  if (sinais.gbraid !== undefined) {
    argumentos.p_gbraid = sinais.gbraid;
  }
  if (sinais.wbraid !== undefined) {
    argumentos.p_wbraid = sinais.wbraid;
  }
  if (sinais.gad_source !== undefined) {
    argumentos.p_gad_source = sinais.gad_source;
  }
  const campanha = sinais.cz_campanha ?? sinais.gad_campaignid;
  if (campanha !== undefined) {
    argumentos.p_google_campaign_id = campanha;
  }
  if (sinais.cz_grupo !== undefined) {
    argumentos.p_google_adgroup_id = sinais.cz_grupo;
  }
  if (sinais.fbclid !== undefined) {
    argumentos.p_fbclid = sinais.fbclid;
  }
  if (sinais.cz_anuncio !== undefined) {
    argumentos.p_meta_ad_id = sinais.cz_anuncio;
  }
  if (sinais.utm_source !== undefined) {
    argumentos.p_utm_source = sinais.utm_source;
  }
  if (sinais.utm_medium !== undefined) {
    argumentos.p_utm_medium = sinais.utm_medium;
  }
  if (sinais.utm_campaign !== undefined) {
    argumentos.p_utm_campaign = sinais.utm_campaign;
  }
  if (sinais.utm_content !== undefined) {
    argumentos.p_utm_content = sinais.utm_content;
  }
  if (sinais.utm_term !== undefined) {
    argumentos.p_utm_term = sinais.utm_term;
  }
  return argumentos;
}

/** Argumentos de registrar_clique_do_site (os sinais, a chave e o host). */
export function argumentosDoRegistro(
  corpo: CorpoDoClique,
  origin: string | null,
): ArgumentosDoRegistro {
  const argumentos: ArgumentosDoRegistro = {
    p_chave: corpo.chave,
    p_codigo: corpo.codigo,
    ...argumentosDosSinais(corpo),
  };
  const host = hostDoOrigin(origin);
  if (host !== null) {
    argumentos.p_site_host = host;
  }
  return argumentos;
}

// ---------------------------------------------------------------------------
// Frases do botao sem mensagem pronta (o script aplica as mesmas regras)
// ---------------------------------------------------------------------------
//
// Regras dos checks de rastreio_do_site.frases (migration 20261005110000):
// de 1 a 5 frases; cada uma com pelo menos um caractere alem de espaco, ate
// 300 caracteres (code points: emoji conta 1), sem quebra de linha (nem
// U+2028 e U+2029), sem caractere de controle (C0, DEL e C1) e sem '[', ']'
// ou '#'. Colchete e cerquilha ficam fora para nenhuma frase virar candidata
// a codigo: a ingestao procura "#XXXXXX" no texto inteiro.

/** O que nao pode aparecer numa frase. */
const PROIBIDO_NA_FRASE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029[\]#]/;
const SEM_PROIBIDO_NA_FRASE =
  /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029[\]#]*$/;

/** Par substituto UTF-16 (um emoji, por exemplo): conta como 1 caractere. */
const PAR_SUBSTITUTO = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** Caracteres como o banco conta (char_length, em code points). */
export function caracteresDaFrase(frase: string): number {
  return frase.replace(PAR_SUBSTITUTO, "_").length;
}

/**
 * A frase passa no check do banco, exatamente: e o que a rota confere na
 * saida da funcao e o que o script confere na resposta da rota. Nao apara:
 * quem grava (a acao) apara antes, com frasesDoRastreioSchema.
 */
export function fraseNoFormato(frase: unknown): frase is string {
  return (
    typeof frase === "string" &&
    /[^ ]/.test(frase) &&
    caracteresDaFrase(frase) <= TAMANHO_MAXIMO_DA_FRASE &&
    !PROIBIDO_NA_FRASE.test(frase)
  );
}

/**
 * A lista de frases, copiada, se ela inteira passa nos checks do banco; null
 * se nao for lista, tiver 0 ou mais de 5 itens ou algum item fora da regra.
 * Tudo ou nada: com qualquer item estranho, o script fica com FRASE_PADRAO.
 */
export function frasesNoFormato(lista: unknown): string[] | null {
  if (
    !Array.isArray(lista) ||
    lista.length < 1 ||
    lista.length > LIMITE_DE_FRASES
  ) {
    return null;
  }
  const frases: string[] = [];
  for (const frase of lista as unknown[]) {
    if (!fraseNoFormato(frase)) {
      return null;
    }
    frases.push(frase);
  }
  return frases;
}

/**
 * As frases do corpo que a rota GET devolve ({"frases": [...]}), ou null.
 * Campo a mais no objeto e ignorado (uma rota mais nova nao quebra um script
 * que ficou no cache do navegador).
 */
export function frasesDaResposta(corpo: unknown): string[] | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return null;
  }
  return frasesNoFormato((corpo as { frases?: unknown }).frases);
}

/**
 * Entrada da tela (Server Action): apara cada frase e confere as regras do
 * banco antes do 23514, com a mensagem certa. O .max do Zod conta unidades
 * UTF-16, entao e igual ou mais estrito que o banco (emoji conta 2 aqui e 1
 * la): nunca aceita o que o banco recusa.
 */
export const fraseDoRastreioSchema = z
  .string()
  .trim()
  .min(1, "Escreva a frase.")
  .max(
    TAMANHO_MAXIMO_DA_FRASE,
    `Use até ${TAMANHO_MAXIMO_DA_FRASE} caracteres.`,
  )
  .regex(
    SEM_PROIBIDO_NA_FRASE,
    "A frase não pode ter quebra de linha, colchetes nem o sinal #.",
  );

export const frasesDoRastreioSchema = z
  .array(fraseDoRastreioSchema)
  .min(1, "Cadastre pelo menos uma frase.")
  .max(LIMITE_DE_FRASES, `Cadastre no máximo ${LIMITE_DE_FRASES} frases.`);

/** Tentativas do sorteio antes de desistir e ficar com a primeira frase. */
const TENTATIVAS_DO_SORTEIO = 32;

/**
 * Uma frase sorteada da lista, um byte por tentativa de `preencher` (no
 * script, crypto.getRandomValues). Byte de `limite` para cima e descartado,
 * para nao viciar o sorteio (256 nao divide por 3 nem por 5). Uma frase so:
 * nem sorteia. Lista fora da regra: FRASE_PADRAO.
 */
export function sortearFrase(
  frases: readonly string[],
  preencher: (bytes: Uint8Array) => void,
): string {
  const lista = frasesNoFormato(frases);
  if (!lista) {
    return FRASE_PADRAO;
  }
  const primeira = lista[0] ?? FRASE_PADRAO;
  if (lista.length < 2) {
    return primeira;
  }
  const limite = 256 - (256 % lista.length);
  const byte = new Uint8Array(1);
  for (let tentativa = 0; tentativa < TENTATIVAS_DO_SORTEIO; tentativa++) {
    preencher(byte);
    const valor = byte[0] ?? 255;
    if (valor < limite) {
      return lista[valor % lista.length] ?? primeira;
    }
  }
  return primeira;
}

/** O caminho da rota GET das frases para a chave (null fora do formato). */
export function caminhoDasFrases(chave: string): string | null {
  return FORMATO_DA_CHAVE.test(chave) ? `${CAMINHO_DAS_FRASES}${chave}` : null;
}

// ---------------------------------------------------------------------------
// Link do WhatsApp com o codigo (o script aplica a mesma regra no clique)
// ---------------------------------------------------------------------------

// wa.me/<numero>, api.whatsapp.com/send, web.whatsapp.com/send e
// whatsapp://send, com ou sem barra no fim. Fora: wa.me/message/... (link
// curto sem texto editavel), wa.link e outros encurtadores, grupos.
const LINK_DO_WHATSAPP =
  /^(?:(?:https?:)?\/\/(?:www\.)?(?:wa\.me\/\d*|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send)|whatsapp:\/\/send)\/?(?=[?#]|$)/i;

function decodificar(valor: string): string | null {
  try {
    return decodeURIComponent(valor.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/**
 * O href do link do WhatsApp com ` [#CODIGO]` no fim do texto pre-preenchido,
 * ou null quando o link nao deve ser tocado:
 * - nao e link do WhatsApp com texto editavel;
 * - o texto ja tem um codigo (#XXXXXX no alfabeto). Codigo fixo de
 *   campaign_link vence o clique do site, e a ingestao so le o PRIMEIRO
 *   codigo do texto: o nosso nunca seria lido;
 * - o texto esta mal codificado (% quebrado).
 *
 * Espaco nas pontas do href e descartado (o navegador tambem descarta).
 * O texto da clinica fica byte a byte como estava: o sufixo codificado e
 * colado no fim do valor bruto, sem decodificar e recodificar (um `+` ou um
 * `%20` do site continuam iguais). Sem texto, ou com texto em branco, vai
 * `frase` antes do codigo (no script, a sorteada entre as da clinica; fora
 * da regra, ou sem ela, FRASE_PADRAO). Com texto pronto, a frase nao entra.
 */
export function linkComCodigo(
  hrefDoSite: string,
  codigo: string,
  frase: string = FRASE_PADRAO,
): string | null {
  const href = hrefDoSite.trim();
  const inicio = LINK_DO_WHATSAPP.exec(href);
  if (!inicio || !FORMATO_DO_CODIGO.test(codigo)) {
    return null;
  }
  const base = inicio[0];
  const cauda = href.slice(base.length);
  const posicaoDoHash = cauda.indexOf("#");
  const hash = posicaoDoHash >= 0 ? cauda.slice(posicaoDoHash) : "";
  const busca = posicaoDoHash >= 0 ? cauda.slice(0, posicaoDoHash) : cauda;
  const partes = busca.length > 1 ? busca.slice(1).split("&") : [];
  const sufixo = ` [#${codigo}]`;
  const antes = fraseNoFormato(frase) ? frase : FRASE_PADRAO;
  const textoNovo = `text=${encodeURIComponent(antes + sufixo)}`;

  let achou = false;
  for (let indice = 0; indice < partes.length; indice++) {
    const parte = partes[indice] ?? "";
    const igual = parte.indexOf("=");
    const nome = igual >= 0 ? parte.slice(0, igual) : parte;
    if (decodificar(nome) !== "text") {
      continue;
    }
    const bruto = igual >= 0 ? parte.slice(igual + 1) : "";
    const texto = decodificar(bruto);
    if (texto === null || extrairToken(texto) !== null) {
      return null;
    }
    partes[indice] =
      texto.trim() === ""
        ? textoNovo
        : `${nome}=${bruto}${encodeURIComponent(sufixo)}`;
    achou = true;
    break;
  }
  if (!achou) {
    partes.push(textoNovo);
  }
  return `${base}?${partes.join("&")}${hash}`;
}

/**
 * A linha que a clinica cola no site, antes do </body> ou numa tag HTML
 * personalizada do Gerenciador de Tags em todas as paginas. `enderecoDoApp`
 * e o endereco publico do sistema (PUBLIC_APP_URL). Chave ou endereco fora
 * do formato: null (a tela mostra o erro em vez de uma linha que nao
 * funciona). So https, salvo localhost em desenvolvimento: o site da clinica
 * em https bloqueia script em http (conteudo misto), e o rastreio pararia
 * calado.
 *
 * `referrerpolicy="no-referrer"`: o pedido do proprio v1.js nao leva o
 * endereco da pagina da clinica (caminho, que pode revelar interesse de
 * saude, e o gclid) no Referer, mesmo em site com politica de referrer
 * frouxa (unsafe-url). Vale so para a carga do script: o aviso que ele
 * manda segue a politica da pagina, e o cabecalho Origin dele (de onde sai o
 * host do site) continua indo.
 */
export function linhaDoScript(
  enderecoDoApp: string,
  chave: string,
): string | null {
  if (!FORMATO_DA_CHAVE.test(chave)) {
    return null;
  }
  let src: string;
  try {
    const url = new URL(CAMINHO_DO_SCRIPT, enderecoDoApp);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return null;
    }
    src = url.href;
  } catch {
    return null;
  }
  return `<script src="${src}" data-chave="${chave}" referrerpolicy="no-referrer" async></script>`;
}
