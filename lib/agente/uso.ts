// Livro de gasto da IA (ia_uso): o custo de cada chamada ao modelo, em
// microdolar, a partir de llm_preco (migration 20261006100000, secoes 6 e 7).
// UMA linha por chamada (agente, verificador, classificador), inclusive no
// simulador. A soma das ultimas 24 horas entra no teto diario
// (ia_liberacao_vigente): chamada sem linha deixa o teto cego.
//
// Regras:
//  - preco vive na tabela, nunca no codigo. Modelo que nao esta em
//    llm_preco (um id datado que a OpenAI devolveu, por exemplo) usa o
//    prefixo conhecido mais longo; sem nenhum, o MAIOR preco de cada parte
//    (conservador: o teto conta a mais, nunca a menos) e log.warn;
//  - arredonda para cima (o teto nunca fica abaixo do gasto real);
//  - so a service role grava (authenticated nao tem INSERT em ia_uso);
//  - erro ao gravar nao derruba a resposta: log.warn so com ids, codigo e
//    contagem. Nada de texto de paciente aqui, nem em log.
//
// O simulador nao grava por aqui desde a revisao de 06/10/2026: ele reserva
// o custo maximo antes do turno e troca a reserva pelas linhas daqui
// (linhasDoUso) no fim, pela RPC acertar_gasto_da_ia (lib/agente/gasto.ts).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UsoDoLlm } from "@/lib/domain/conformidade/veredicto";
import { log } from "@/lib/log";

export type PapelDoModelo =
  | "agente"
  | "verificador"
  | "classificador"
  // [AG6b mídia] início
  // AG6b (migration 20261030100000, CHECK ia_uso_papel_valido): a
  // transcricao do audio (tokens 0, custo pelos segundos) e o leitor de
  // midia (tokens).
  | "transcricao"
  | "leitor_de_midia";
// [AG6b mídia] fim
export type OrigemDoUso = "whatsapp" | "simulador" | "avaliacao";

/** Uma chamada que a API respondeu (o uso pode vir zerado). */
export type UsoDoModelo = {
  papel: PapelDoModelo;
  modelo: string;
  uso: UsoDoLlm;
  // [AG6b mídia] início
  /**
   * AG6b: os segundos de audio cobrados (so a transcricao). O custo e
   * ceil(segundos x audioPorMinuto / 60), somado ao dos tokens.
   */
  segundosDeAudio?: number;
  // [AG6b mídia] fim
};

/** Uma linha de llm_preco, em microdolar por milhao de tokens. */
export type PrecoDoModelo = {
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  // [AG6b mídia] início
  /**
   * AG6b: microdolar por minuto de audio (llm_preco.audio_microdolar_por_
   * minuto, lido a parte por lerPrecoDaTranscricao). Ausente: 0.
   */
  audioPorMinuto?: number;
  // [AG6b mídia] fim
};

export const USO_ZERADO: UsoDoLlm = Object.freeze({
  tokensEntrada: 0,
  tokensSaida: 0,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
});

const UM_MILHAO = 1_000_000;

function inteiroNaoNegativo(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? Math.floor(valor)
    : 0;
}

/**
 * Custo em microdolar: cada parte do uso vezes o preco por milhao, somadas
 * e arredondadas para cima. tokensEntrada ja vem sem o cache (usoDaResposta).
 */
export function custoEmMicrodolar(
  uso: UsoDoLlm,
  preco: PrecoDoModelo,
  // [AG6b mídia] início
  segundosDeAudio = 0,
  // [AG6b mídia] fim
): number {
  const total =
    inteiroNaoNegativo(uso.tokensEntrada) * preco.entrada +
    inteiroNaoNegativo(uso.tokensSaida) * preco.saida +
    inteiroNaoNegativo(uso.tokensCacheLidos) * preco.cacheLeitura +
    inteiroNaoNegativo(uso.tokensCacheGravados) * preco.cacheEscrita;
  // [AG6b mídia] início
  // AG6b: o audio pelos segundos (a transcricao), arredondado para cima.
  const audio = Math.ceil(
    (Math.max(0, Math.ceil(segundosDeAudio)) *
      inteiroNaoNegativo(preco.audioPorMinuto ?? 0)) /
      60,
  );
  return Math.ceil(total / UM_MILHAO) + audio;
  // [AG6b mídia] fim
}

/**
 * O preco do modelo: igual, depois o prefixo conhecido mais longo
 * ("gpt-6-luna-2026-10-01" usa "gpt-6-luna"); sem nenhum, o maior de cada
 * parte (conservador). null so quando nao ha preco nenhum.
 */
export function precoDoModelo(
  precos: readonly PrecoDoModelo[],
  modelo: string,
): { preco: PrecoDoModelo; conhecido: boolean } | null {
  if (precos.length === 0) {
    return null;
  }
  const exato = precos.find((p) => p.modelo === modelo);
  if (exato) {
    return { preco: exato, conhecido: true };
  }
  const prefixo = precos
    .filter((p) => modelo.startsWith(`${p.modelo}-`))
    .sort((a, b) => b.modelo.length - a.modelo.length)[0];
  if (prefixo) {
    return { preco: prefixo, conhecido: true };
  }
  return {
    preco: {
      modelo,
      entrada: Math.max(...precos.map((p) => p.entrada)),
      saida: Math.max(...precos.map((p) => p.saida)),
      cacheLeitura: Math.max(...precos.map((p) => p.cacheLeitura)),
      cacheEscrita: Math.max(...precos.map((p) => p.cacheEscrita)),
      // [AG6b mídia] início
      audioPorMinuto: Math.max(...precos.map((p) => p.audioPorMinuto ?? 0)),
      // [AG6b mídia] fim
    },
    conhecido: false,
  };
}

type LinhaDoPreco = {
  modelo: string;
  entrada_microdolar_por_milhao: number | string;
  saida_microdolar_por_milhao: number | string;
  cache_leitura_microdolar_por_milhao: number | string;
  cache_escrita_microdolar_por_milhao: number | string;
};

function numeroDoBanco(valor: number | string): number | null {
  // bigint chega como numero ou texto, conforme o tamanho.
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

/**
 * Os precos de llm_preco. Lanca se a leitura falhar ou vier vazia: quem
 * chama nao roda o modelo sem saber o custo (o teto ficaria cego).
 */
export async function lerPrecos(
  cliente: SupabaseClient,
): Promise<PrecoDoModelo[]> {
  const { data, error } = await cliente
    .from("llm_preco")
    .select(
      "modelo, entrada_microdolar_por_milhao, saida_microdolar_por_milhao, cache_leitura_microdolar_por_milhao, cache_escrita_microdolar_por_milhao",
    );
  if (error) {
    throw new Error("leitura de llm_preco falhou");
  }
  const precos: PrecoDoModelo[] = [];
  for (const linha of (data ?? []) as LinhaDoPreco[]) {
    const entrada = numeroDoBanco(linha.entrada_microdolar_por_milhao);
    const saida = numeroDoBanco(linha.saida_microdolar_por_milhao);
    const cacheLeitura = numeroDoBanco(
      linha.cache_leitura_microdolar_por_milhao,
    );
    const cacheEscrita = numeroDoBanco(
      linha.cache_escrita_microdolar_por_milhao,
    );
    if (
      typeof linha.modelo === "string" &&
      entrada !== null &&
      saida !== null &&
      cacheLeitura !== null &&
      cacheEscrita !== null
    ) {
      precos.push({
        modelo: linha.modelo,
        entrada,
        saida,
        cacheLeitura,
        cacheEscrita,
      });
    }
  }
  if (precos.length === 0) {
    throw new Error("llm_preco vazio");
  }
  return precos;
}

// [AG6b mídia] início
/**
 * AG6b: o preco por minuto da transcricao (llm_preco.audio_microdolar_por_
 * minuto da linha do modelo), numa consulta PROPRIA e tolerante: a coluna
 * nasce na migration 20261030100000, e lerPrecos (o turno inteiro) nunca
 * pode cair se ela faltar. null em qualquer erro, sem a linha ou fora do
 * formato: sem preco, o audio nao sai (o plano do turno o marca como fora).
 */
export async function lerPrecoDaTranscricao(
  cliente: SupabaseClient,
  modelo: string,
): Promise<number | null> {
  try {
    const { data, error } = await cliente
      .from("llm_preco")
      .select("modelo, audio_microdolar_por_minuto")
      .eq("modelo", modelo)
      .maybeSingle();
    if (error || data === null || typeof data !== "object") {
      return null;
    }
    const valor = numeroDoBanco(
      (data as { audio_microdolar_por_minuto?: number | string })
        .audio_microdolar_por_minuto ?? -1,
    );
    return valor;
  } catch {
    return null;
  }
}

/**
 * AG6b: os precos com o da transcricao (o modelo com o preco por minuto; a
 * linha que lerPrecos ja trouxe ganha o campo, ou entra uma com os tokens
 * a zero). Sem preco por minuto (nulo), os precos voltam como estao.
 */
export function comPrecoDaTranscricao(
  precos: readonly PrecoDoModelo[],
  modelo: string,
  audioPorMinuto: number | null,
): PrecoDoModelo[] {
  if (audioPorMinuto === null) {
    return [...precos];
  }
  const existente = precos.find((p) => p.modelo === modelo);
  if (existente === undefined) {
    return [
      ...precos,
      {
        modelo,
        entrada: 0,
        saida: 0,
        cacheLeitura: 0,
        cacheEscrita: 0,
        audioPorMinuto,
      },
    ];
  }
  return precos.map((p) => (p === existente ? { ...p, audioPorMinuto } : p));
}
// [AG6b mídia] fim

/** Linha de ia_uso pronta para o INSERT (sem texto nenhum). */
export type LinhaDoUso = {
  clinic_id: string;
  conversation_id: string | null;
  job_id: string | null;
  origem: OrigemDoUso;
  papel: PapelDoModelo;
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_lidos: number;
  tokens_cache_gravados: number;
  custo_microdolar: number;
};

/** Teto do CHECK ia_uso_modelo_tamanho. */
const TAMANHO_MAXIMO_DO_MODELO = 100;

export function linhasDoUso(entrada: {
  clinicId: string;
  origem: OrigemDoUso;
  usos: readonly UsoDoModelo[];
  precos: readonly PrecoDoModelo[];
  conversationId?: string | null;
  jobId?: string | null;
}): { linhas: LinhaDoUso[]; semPreco: string[] } {
  const linhas: LinhaDoUso[] = [];
  const semPreco: string[] = [];
  // [AG6b mídia] Os segundos de audio da transcricao entram no custo.
  for (const { papel, modelo, uso, segundosDeAudio } of entrada.usos) {
    const nome = (modelo.trim() || "desconhecido").slice(
      0,
      TAMANHO_MAXIMO_DO_MODELO,
    );
    const achado = precoDoModelo(entrada.precos, nome);
    if (achado === null || !achado.conhecido) {
      semPreco.push(nome);
    }
    linhas.push({
      clinic_id: entrada.clinicId,
      conversation_id: entrada.conversationId ?? null,
      job_id: entrada.jobId ?? null,
      origem: entrada.origem,
      papel,
      modelo: nome,
      tokens_entrada: inteiroNaoNegativo(uso.tokensEntrada),
      tokens_saida: inteiroNaoNegativo(uso.tokensSaida),
      tokens_cache_lidos: inteiroNaoNegativo(uso.tokensCacheLidos),
      tokens_cache_gravados: inteiroNaoNegativo(uso.tokensCacheGravados),
      // [AG6b mídia] com os segundos do audio (era sem o terceiro argumento).
      custo_microdolar:
        achado === null
          ? 0
          : custoEmMicrodolar(uso, achado.preco, segundosDeAudio ?? 0),
    });
  }
  return { linhas, semPreco };
}

/**
 * Grava o uso em ia_uso com o cliente de SERVICE ROLE. Nunca lanca: erro
 * vira log.warn (so clinica, contagem e codigo) e a resposta segue.
 */
export async function registrarUso(
  admin: SupabaseClient,
  entrada: Parameters<typeof linhasDoUso>[0],
): Promise<{ gravadas: number }> {
  if (entrada.usos.length === 0) {
    return { gravadas: 0 };
  }
  try {
    const { linhas, semPreco } = linhasDoUso(entrada);
    for (const modelo of new Set(semPreco)) {
      log.warn("ia_preco_ausente", {
        clinic_id: entrada.clinicId,
        modelo,
      });
    }
    const { error } = await admin.from("ia_uso").insert(linhas);
    if (error) {
      log.warn("ia_uso_nao_gravado", {
        clinic_id: entrada.clinicId,
        count: linhas.length,
        error_code: (error as { code?: string }).code ?? null,
      });
      return { gravadas: 0 };
    }
    return { gravadas: linhas.length };
  } catch {
    log.warn("ia_uso_nao_gravado", {
      clinic_id: entrada.clinicId,
      count: entrada.usos.length,
      error_code: "desconhecida",
    });
    return { gravadas: 0 };
  }
}
