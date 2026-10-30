// As travas da SAIDA da transcricao (AG6b, desenho 4.1): a defesa contra a
// frase que o whisper-1 inventa no silencio, no ruido e na musica ("Legendas
// pela comunidade Amara.org" e o classico em portugues). PURO, zero I/O.
//
// Le as metricas de cada segmento do verbose_json (os limites sao os do
// proprio Whisper):
//  - segmento em SILENCIO: no_speech_prob acima de 0,6 E avg_logprob abaixo
//    de -1. O texto dele e descartado (e o que o Whisper faz por padrao);
//  - segmento RUIM fora do silencio: compression_ratio acima de 2,4 (texto
//    repetido) ou avg_logprob abaixo de -1 (baixa confianca). O audio
//    inteiro vira "sem fala";
//  - o texto final vazio, so pontuacao, acima de 4.000 caracteres, ou com
//    uma frase-fantasma da lista fechada: "sem fala".
// Nunca "conserta" o texto: ou ele passa inteiro (menos os segmentos em
// silencio), ou o audio e "sem fala" e a conversa vai para a equipe, que
// ouve o audio. Sem os segmentos (a resposta nao trouxe), nao da para
// conferir: "sem fala" (falha fechada).
//
// Os limites e a lista sao PROPOSTA (desenho 4.1), a calibrar na prova paga
// (D-100, scripts/ia/prova-da-midia.ts). Mudar um deles muda a versao da
// transcricao (lib/integrations/llm/transcricao.ts).

import { createHash } from "node:crypto";

/** Os limites das travas (PROPOSTA, a calibrar na prova paga). */
export const LIMITES_DA_QUALIDADE = {
  silencio: { noSpeechProbAcimaDe: 0.6, avgLogprobAbaixoDe: -1 },
  repeticao: { compressionRatioAcimaDe: 2.4 },
  confianca: { avgLogprobAbaixoDe: -1 },
  /** O teto do texto final (o CHECK de ia_leitura_da_midia.transcricao). */
  caracteres: 4000,
} as const;

/**
 * As frases-fantasma do Whisper em portugues (PROPOSTA inicial, a calibrar
 * na prova): normalizadas, sem acento e em minusculas. Aparecer uma delas
 * no texto e "sem fala", nunca o texto sem ela.
 */
export const FRASES_FANTASMA = [
  "amara.org",
  "legendas pela comunidade",
  "inscreva-se",
  "obrigado por assistir",
  "legendado por",
  "transcrito por",
] as const;

/** As metricas de um segmento do verbose_json que as travas leem. */
export type SegmentoDaTranscricao = {
  text: string;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

/** Por que o audio virou "sem fala" (lista fechada: pode ir para log). */
export const MOTIVOS_DO_SEM_FALA = [
  "sem_segmentos",
  "segmento_ruim",
  "repeticao",
  "vazio",
  "so_pontuacao",
  "longo",
  "frase_fantasma",
] as const;
export type MotivoDoSemFala = (typeof MOTIVOS_DO_SEM_FALA)[number];

export type QualidadeDaTranscricao =
  | { tipo: "transcrita"; texto: string }
  | { tipo: "sem_fala"; motivo: MotivoDoSemFala };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** O segmento e silencio (o texto dele e descartado). */
export function segmentoEmSilencio(segmento: SegmentoDaTranscricao): boolean {
  return (
    segmento.no_speech_prob > LIMITES_DA_QUALIDADE.silencio.noSpeechProbAcimaDe &&
    segmento.avg_logprob < LIMITES_DA_QUALIDADE.silencio.avgLogprobAbaixoDe
  );
}

/**
 * Avalia a transcricao pelas travas. Devolve o texto final (os segmentos
 * fora do silencio, juntos) ou "sem fala" com o motivo. Nunca lanca.
 */
export function avaliarTranscricao(entrada: {
  segmentos: readonly SegmentoDaTranscricao[];
}): QualidadeDaTranscricao {
  const { segmentos } = entrada;
  if (segmentos.length === 0) {
    return { tipo: "sem_fala", motivo: "sem_segmentos" };
  }
  const falados: string[] = [];
  for (const segmento of segmentos) {
    if (
      !Number.isFinite(segmento.no_speech_prob) ||
      !Number.isFinite(segmento.avg_logprob) ||
      !Number.isFinite(segmento.compression_ratio)
    ) {
      return { tipo: "sem_fala", motivo: "segmento_ruim" };
    }
    if (segmentoEmSilencio(segmento)) {
      continue;
    }
    if (
      segmento.compression_ratio >
      LIMITES_DA_QUALIDADE.repeticao.compressionRatioAcimaDe
    ) {
      return { tipo: "sem_fala", motivo: "repeticao" };
    }
    if (segmento.avg_logprob < LIMITES_DA_QUALIDADE.confianca.avgLogprobAbaixoDe) {
      return { tipo: "sem_fala", motivo: "segmento_ruim" };
    }
    falados.push(segmento.text);
  }
  const texto = falados.join(" ").replace(/\s+/g, " ").trim();
  if (texto === "") {
    return { tipo: "sem_fala", motivo: "vazio" };
  }
  if (!/[\p{L}\p{N}]/u.test(texto)) {
    return { tipo: "sem_fala", motivo: "so_pontuacao" };
  }
  if (Array.from(texto).length > LIMITES_DA_QUALIDADE.caracteres) {
    return { tipo: "sem_fala", motivo: "longo" };
  }
  const normal = normalizar(texto);
  if (FRASES_FANTASMA.some((frase) => normal.includes(frase))) {
    return { tipo: "sem_fala", motivo: "frase_fantasma" };
  }
  return { tipo: "transcrita", texto };
}

/** Tudo que e fixo nas travas: a fonte da versao. */
export const FONTES_DA_QUALIDADE_DA_TRANSCRICAO = {
  limites: LIMITES_DA_QUALIDADE,
  frases: FRASES_FANTASMA,
  regras: [
    "silencio: no_speech_prob acima E avg_logprob abaixo; o texto sai",
    "fora do silencio: compression_ratio acima ou avg_logprob abaixo; o audio inteiro sem fala",
    "texto final vazio, so pontuacao, longo ou com frase-fantasma: sem fala",
    "sem segmentos: sem fala",
    "nunca conserta o texto",
  ],
} as const;

/** A versao das travas ("qualidade-" e 12 hex). */
export const VERSAO_DA_QUALIDADE_DA_TRANSCRICAO = `qualidade-${createHash(
  "sha256",
)
  .update(JSON.stringify(FONTES_DA_QUALIDADE_DA_TRANSCRICAO), "utf8")
  .digest("hex")
  .slice(0, 12)}`;
