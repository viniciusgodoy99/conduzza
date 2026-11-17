import { z } from "zod";

import { mensagemComCodigoInvisivel } from "@/lib/domain/codigo-invisivel";
import {
  argumentosDosSinais,
  type SinaisDoRastreio,
} from "@/lib/domain/rastreio-do-site";
import { linkDoWhatsApp } from "@/lib/domain/regras-de-origem";
import type { Database } from "@/lib/supabase/database.types";

// Regras PURAS do link rastreado da origem (etapa 3a do plano de 16/11/2026,
// "Rastreio completo"; o link da bio com endereco proprio, como no Q5): zero
// I/O, testaveis direto.
//
// Cada origem cadastrada (campaign_link) tem um endereco do Conduzza,
// <sistema>/l/<codigo publico>. A rota publica app/l/[codigo]/route.ts chama
// registrar_clique_do_link (migration 20261116120000) com a service role: o
// banco acha a origem, escolhe o numero, grava o clique com um codigo POR
// CLIQUE e devolve para onde mandar a pessoa. A mensagem que chega com esse
// codigo casa pelo mesmo casar_clique_do_site do clique do site, e o lead
// ganha a origem cadastrada.
//
// O rastreio e melhor esforco: nenhuma falha dele deixa a pessoa sem chegar
// ao WhatsApp enquanto o banco souber o numero. Sem gravar o clique, o link
// leva o codigo FIXO da origem, que a ingestao ja reconhece.

/**
 * Cliques e leads de uma origem nos ultimos 30 dias (link rastreado). Os
 * provaveis (etapa 3d) sao os casados so pela janela de 10 minutos.
 */
export type ResumoDoLink = { cliques: number; leads: number; provaveis: number };

/** O prefixo do endereco publico do link. Fora do middleware (matcher). */
export const CAMINHO_DO_LINK = "/l/";

/** A pagina de "link indisponivel" (estatica, sem login). */
export const CAMINHO_DO_LINK_INDISPONIVEL = "/l/indisponivel";

/** O mesmo formato do check campaign_link_codigo_publico_formato. */
export const FORMATO_DO_CODIGO_PUBLICO = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;

/**
 * Robo e previa de link: quem busca o endereco para montar a miniatura
 * (WhatsApp, Facebook, Slack, Telegram), buscador e ferramenta. NAO entram
 * os navegadores de dentro do Instagram e do Facebook (FBAN, FBAV,
 * Instagram): ali e gente de verdade tocando no link da bio.
 */
const ROBO_OU_PREVIA =
  /^WhatsApp\/|facebookexternalhit|facebot|meta-externalagent|twitterbot|slackbot|slack-imgproxy|telegrambot|discordbot|linkedinbot|pinterest(?:bot)?\/|skypeuripreview|iframely|embedly|googlebot|bingbot|duckduckbot|yandex|baiduspider|applebot|headlesschrome|lighthouse|bot\b|crawler|spider|curl\/|wget\/|python-requests|go-http-client|node-fetch|axios\/|okhttp/i;

/**
 * Verdadeiro para robo, previa de link e pedido sem user agent: o redirect
 * manda para o WhatsApp do mesmo jeito, mas nao grava clique (nao infla a
 * contagem nem gasta o teto de cliques vivos).
 */
export function ehRoboOuPrevia(userAgent: string | null | undefined): boolean {
  const limpo = userAgent?.trim();
  return !limpo || ROBO_OU_PREVIA.test(limpo);
}

/**
 * O endereco publico do link de uma origem. A base e o dominio curto dos
 * links (LINK_BASE_URL), quando existe, ou o endereco do sistema
 * (PUBLIC_APP_URL): a rota responde nos dois. So https (http so em
 * localhost, para desenvolvimento). Base ausente ou fora disso, ou codigo
 * fora do formato: null.
 */
export function enderecoDoLinkRastreado(
  base: string | null | undefined,
  codigoPublico: string | null | undefined,
): string | null {
  if (!base || !codigoPublico || !FORMATO_DO_CODIGO_PUBLICO.test(codigoPublico)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return null;
  }
  return `${url.origin}${CAMINHO_DO_LINK}${codigoPublico}`;
}

/** A base dos links: o dominio curto, se configurado, senao o sistema. */
export function baseDosLinks(
  dominioCurto: string | null | undefined,
  enderecoDoSistema: string | null | undefined,
): string | null {
  return dominioCurto?.trim() || enderecoDoSistema?.trim() || null;
}

export type ArgumentosDoCliqueDoLink =
  Database["public"]["Functions"]["registrar_clique_do_link"]["Args"];

/**
 * Argumentos de registrar_clique_do_link. Sem gravar (robo, previa), os
 * sinais nem viajam. O numero fixado (etapa 3b, o rodizio) e o que o cookie
 * do visitante guarda: o mesmo navegador cai sempre no mesmo numero.
 */
export function argumentosDoCliqueDoLink(
  codigoPublico: string,
  gravar: boolean,
  sinais: SinaisDoRastreio | null,
  numeroFixado: string | null = null,
): ArgumentosDoCliqueDoLink {
  return {
    p_codigo_publico: codigoPublico,
    p_gravar: gravar,
    ...(gravar && sinais ? argumentosDosSinais(sinais) : {}),
    ...(numeroFixado ? { p_numero_fixado: numeroFixado } : {}),
  };
}

// ---------------------------------------------------------------------------
// O numero fixado do visitante (etapa 3b: rodizio entre numeros)
// ---------------------------------------------------------------------------

/** 90 dias, como no Q5. */
export const VALIDADE_DO_NUMERO_FIXADO_EM_SEGUNDOS = 90 * 24 * 60 * 60;

const FORMATO_DO_NUMERO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O cookie do link: um por origem, so com o id do numero (nada da pessoa). */
export function cookieDoNumeroFixado(codigoPublico: string): string {
  return `cz_lk_${codigoPublico}`;
}

/** O id do numero que o cookie guarda, ou null se nao for um id. */
export function numeroFixadoDoCookie(
  valor: string | null | undefined,
): string | null {
  return valor && FORMATO_DO_NUMERO.test(valor) ? valor : null;
}

const destinoSchema = z.object({
  digitos: z.string().regex(/^[0-9]{10,15}$/),
  mensagem: z.string().min(1),
  codigo_fixo: z.string().nullable(),
  /** whatsapp_account.id do numero escolhido (vai para o cookie). */
  numero: z.string().regex(FORMATO_DO_NUMERO),
});

const respostaSchema = z.discriminatedUnion("resultado", [
  destinoSchema.extend({
    resultado: z.literal("ok"),
    codigo: z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/),
    // Etapa 3e: so vem quando a origem pede o aviso a Meta no clique e a
    // clinica tem o Pixel e o envio ligados. Os tres juntos ou nenhum.
    pixel_id: z.string().regex(/^[0-9]{1,20}$/).optional(),
    /** O id do clique: o id do evento no navegador e no servidor. */
    clique_id: z.string().regex(FORMATO_DO_NUMERO).optional(),
    /** So para o servidor achar o token; nunca vai ao navegador. */
    clinica: z.string().regex(FORMATO_DO_NUMERO).optional(),
  }),
  destinoSchema.extend({ resultado: z.literal("sem_gravar") }),
  destinoSchema.extend({ resultado: z.literal("limite") }),
  z.object({ resultado: z.literal("indisponivel") }),
  z.object({ resultado: z.literal("sem_numero") }),
]);

/** O que registrar_clique_do_link devolve, ja conferido. */
export type RespostaDoCliqueDoLink = z.infer<typeof respostaSchema>;

/** Le o retorno do banco; qualquer coisa fora do contrato vira null. */
export function lerRespostaDoCliqueDoLink(
  retorno: unknown,
): RespostaDoCliqueDoLink | null {
  const lido = respostaSchema.safeParse(retorno);
  return lido.success ? lido.data : null;
}

/**
 * Para onde o redirect manda a pessoa: o wa.me com a mensagem pronta e o
 * codigo do clique ou, se o clique nao foi gravado, o codigo fixo da origem
 * (que a ingestao reconhece). Sem destino (link indisponivel, clinica sem
 * numero): null, e a rota mostra a pagina de indisponivel.
 */
export function destinoDoCliqueDoLink(
  resposta: RespostaDoCliqueDoLink,
  opcoes: { codigoInvisivel?: boolean } = {},
): string | null {
  if (
    resposta.resultado === "indisponivel" ||
    resposta.resultado === "sem_numero"
  ) {
    return null;
  }
  if (resposta.resultado === "ok" && opcoes.codigoInvisivel) {
    // Etapa 3c: o codigo do clique escondido depois da primeira palavra. Se
    // nao der (mensagem de uma palavra so), vai o visivel, abaixo.
    const escondida = mensagemComCodigoInvisivel(
      resposta.mensagem,
      resposta.codigo,
    );
    if (escondida) {
      return linkDoWhatsApp(resposta.digitos, escondida, null);
    }
  }
  const codigo =
    resposta.resultado === "ok" ? resposta.codigo : resposta.codigo_fixo;
  return linkDoWhatsApp(resposta.digitos, resposta.mensagem, codigo);
}

/**
 * Codigo invisivel em todo clique. Desligado ate o teste com celular real
 * pela uazapi (decisao do plano de 16/11/2026); passado o teste, vira true
 * aqui. Nao e variavel de ambiente (decisao do dono de 17/11/2026).
 */
export const CODIGO_INVISIVEL_LIGADO: boolean = false;

/**
 * O link usa o codigo invisivel quando ele esta ligado no codigo ou quando o
 * endereco pede, para o proprio teste (?cz_invisivel=1).
 */
export function usarCodigoInvisivel(
  ligado: boolean,
  parametroDoEndereco: string | null,
): boolean {
  return ligado || parametroDoEndereco === "1";
}

// ---------------------------------------------------------------------------
// Os numeros escolhidos para o link (etapa 3b)
// ---------------------------------------------------------------------------

export const PESO_MINIMO = 1;
export const PESO_MAXIMO = 10;
/** Teto de numeros por link (a clinica nem chega perto). */
export const LIMITE_DE_NUMEROS_DO_LINK = 20;

/** Um numero escolhido para o link: whatsapp_account.id e o peso. */
export type NumeroDoLink = { id: string; peso: number };

/** O que a tela manda para salvarNumerosDoLinkAction. */
export const numerosDoLinkSchema = z.object({
  id: z.uuid(),
  numeros: z
    .array(
      z.object({
        id: z.uuid(),
        peso: z.number().int().min(PESO_MINIMO).max(PESO_MAXIMO),
      }),
    )
    .max(LIMITE_DE_NUMEROS_DO_LINK)
    .refine(
      (numeros) => new Set(numeros.map((numero) => numero.id)).size === numeros.length,
      { message: "Número repetido." },
    ),
});

export const TEXTO_DO_NUMERO_PADRAO = "o número principal da clínica";

/**
 * "Recepção (peso 2) e Comercial (peso 1)". Um so: so o nome. Nenhum (ou
 * nenhum que ainda exista na clinica): o numero principal.
 */
export function textoDosNumerosDoLink(
  escolhidos: readonly NumeroDoLink[],
  numerosDaClinica: readonly { id: string; nome: string }[],
): string {
  const comNome = escolhidos.flatMap((escolhido) => {
    const numero = numerosDaClinica.find((item) => item.id === escolhido.id);
    return numero ? [{ nome: numero.nome, peso: escolhido.peso }] : [];
  });
  if (comNome.length === 0) {
    return TEXTO_DO_NUMERO_PADRAO;
  }
  if (comNome.length === 1) {
    return comNome[0]!.nome;
  }
  const partes = comNome.map((item) => `${item.nome} (peso ${item.peso})`);
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Evento para a Meta no clique (etapa 3e)
// ---------------------------------------------------------------------------

/** O que o redirect precisa para avisar a Meta deste clique. */
export type AvisoDaMetaNoClique = {
  pixelId: string;
  /** O id do clique: o mesmo no Pixel (eventID) e no servidor (event_id). */
  eventoId: string;
  clinicId: string;
};

/** O aviso deste clique, ou null (a origem nao pede, ou a clinica nao tem). */
export function avisoDaMetaNoClique(
  resposta: RespostaDoCliqueDoLink,
): AvisoDaMetaNoClique | null {
  if (
    resposta.resultado !== "ok" ||
    !resposta.pixel_id ||
    !resposta.clique_id ||
    !resposta.clinica
  ) {
    return null;
  }
  return {
    pixelId: resposta.pixel_id,
    eventoId: resposta.clique_id,
    clinicId: resposta.clinica,
  };
}

/** Quanto a pagina espera o Pixel antes de seguir de qualquer jeito. */
export const TETO_DA_PAGINA_DO_PIXEL_MS = 1500;

function paraAtributo(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** JSON seguro dentro de <script>: nunca fecha a tag nem quebra a linha. */
function paraScript(valor: string): string {
  return JSON.stringify(valor)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * A pagina intermediaria do link com aviso a Meta: carrega o Pixel da
 * clinica, dispara PageView e Contact (com o id do clique, para a Meta
 * juntar com o evento do servidor) e segue para o WhatsApp. Nunca prende a
 * pessoa: segue logo depois de o Pixel carregar, na hora se ele falhar e, de
 * todo jeito, em 1,5 s; sem JavaScript, o proprio navegador redireciona.
 *
 * Sem cor fixa: usa as cores do sistema da pessoa (claro e escuro). O
 * destino e montado pelo servidor (wa.me); o Pixel e so numero e o id do
 * evento e um uuid, os dois conferidos antes de chegar aqui.
 */
export function paginaDoPixel(aviso: {
  pixelId: string;
  eventoId: string;
  destino: string;
}): string {
  const destinoNoAtributo = paraAtributo(aviso.destino);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Abrindo o WhatsApp</title>
<noscript><meta http-equiv="refresh" content="0;url=${destinoNoAtributo}"></noscript>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px;font-size:16px;line-height:1.5}
a{display:inline-block;min-height:40px;line-height:40px;padding:0 12px}
</style>
</head>
<body>
<main>
<p>Abrindo o WhatsApp...</p>
<p><a href="${destinoNoAtributo}" rel="noreferrer">Se não abrir, toque aqui</a></p>
</main>
<script>
(function () {
  var destino = ${paraScript(aviso.destino)};
  var seguiu = false;
  function seguir() {
    if (seguiu) return;
    seguiu = true;
    window.location.replace(destino);
  }
  setTimeout(seguir, ${TETO_DA_PAGINA_DO_PIXEL_MS});
  try {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;t.onload=function(){setTimeout(seguir,400)};t.onerror=seguir;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', ${paraScript(aviso.pixelId)});
    fbq('track', 'PageView');
    fbq('track', 'Contact', {}, { eventID: ${paraScript(aviso.eventoId)} });
  } catch (e) {
    seguir();
  }
})();
</script>
</body>
</html>
`;
}

/**
 * O IP do visitante, do cabecalho que a hospedagem preenche. So segue se
 * parecer um IP: vai a Meta junto do evento do clique e a mais nenhum lugar.
 */
export function ipDoVisitante(xForwardedFor: string | null): string | null {
  const primeiro = xForwardedFor?.split(",")[0]?.trim();
  return primeiro && /^[0-9a-fA-F:.]{3,45}$/.test(primeiro) ? primeiro : null;
}
