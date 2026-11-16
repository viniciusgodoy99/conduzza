import { z } from "zod";

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

/** Cliques e leads de uma origem nos ultimos 30 dias (link rastreado). */
export type ResumoDoLink = { cliques: number; leads: number };

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
 * Argumentos de registrar_clique_do_link. Sem gravar (robo, previa, segunda
 * tentativa), os sinais nem viajam.
 */
export function argumentosDoCliqueDoLink(
  codigoPublico: string,
  gravar: boolean,
  sinais: SinaisDoRastreio | null,
): ArgumentosDoCliqueDoLink {
  return {
    p_codigo_publico: codigoPublico,
    p_gravar: gravar,
    ...(gravar && sinais ? argumentosDosSinais(sinais) : {}),
  };
}

const destinoSchema = z.object({
  digitos: z.string().regex(/^[0-9]{10,15}$/),
  mensagem: z.string().min(1),
  codigo_fixo: z.string().nullable(),
});

const respostaSchema = z.discriminatedUnion("resultado", [
  destinoSchema.extend({
    resultado: z.literal("ok"),
    codigo: z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/),
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
): string | null {
  if (
    resposta.resultado === "indisponivel" ||
    resposta.resultado === "sem_numero"
  ) {
    return null;
  }
  const codigo =
    resposta.resultado === "ok" ? resposta.codigo : resposta.codigo_fixo;
  return linkDoWhatsApp(resposta.digitos, resposta.mensagem, codigo);
}
