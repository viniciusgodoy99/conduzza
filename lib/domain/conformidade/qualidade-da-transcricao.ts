// As travas da SAIDA da transcricao (AG6b, desenho 4.1): a defesa contra a
// frase que o whisper-1 inventa no silencio, no ruido e na musica ("Legendas
// pela comunidade Amara.org" e o classico em portugues). PURO, zero I/O.
//
// Le as metricas de cada segmento do verbose_json (os limites partem dos do
// proprio Whisper):
//  - segmento em SILENCIO: no_speech_prob acima de 0,6, QUALQUER que seja o
//    avg_logprob (revisao de 30/10/2026, M3). O texto dele nao conta como
//    fala e e descartado. O Whisper so descarta quando a decodificacao
//    tambem e fraca (avg_logprob abaixo de -1), e e justamente no perfil
//    "silencio provavel e decodificacao confiante" que a frase inventada
//    sobrevive (" Ok." com 0,92 e -0,35; " Sim." com 0,85 e -0,6). Se todo o
//    texto vinha desses segmentos, o audio e "sem fala" (motivo silencio);
//  - segmento RUIM fora do silencio: compression_ratio acima de 2,4 (texto
//    repetido) ou avg_logprob abaixo de -1 (baixa confianca). O audio
//    inteiro vira "sem fala";
//  - o texto final vazio, so pontuacao, acima de 4.000 caracteres, ou com
//    uma frase-fantasma da lista fechada: "sem fala";
//  - o texto final CURTO (ate 3 palavras, o tamanho de "sim", "ok" ou "sim,
//    pode cancelar") so vale com no_speech_prob baixo (ate 0,2) em TODOS os
//    segmentos: e ele que vira o "sim" falado do cancelamento, da lista de
//    espera e da confirmacao (D-97). Fora disso, "sem fala" (motivo
//    curta_incerta), e a equipe ouve o audio.
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
  /**
   * Acima disso o segmento nao conta como fala, qualquer que seja o
   * avg_logprob (revisao de 30/10/2026, M3).
   */
  silencio: { noSpeechProbAcimaDe: 0.6 },
  repeticao: { compressionRatioAcimaDe: 2.4 },
  confianca: { avgLogprobAbaixoDe: -1 },
  /**
   * A transcricao curta (revisao de 30/10/2026, M3): com ate `palavrasAte`
   * palavras, TODOS os segmentos precisam de no_speech_prob ate
   * `noSpeechProbAcimaDe` (o "baixo"). PROPOSTA: a prova paga mede o "sim"
   * falado de verdade (o roteiro tem um) contra o silencio e o ruido.
   */
  curta: { palavrasAte: 3, noSpeechProbAcimaDe: 0.2 },
  /** O teto do texto final (o CHECK de ia_leitura_da_midia.transcricao). */
  caracteres: 4000,
} as const;

/**
 * As frases-fantasma do Whisper em portugues (PROPOSTA inicial, a calibrar
 * na prova): normalizadas, sem acento e em minusculas. Aparecer uma delas
 * no texto e "sem fala", nunca o texto sem ela.
 *
 * Revisao de 30/10/2026: os creditos de legenda que o Whisper aprendeu com
 * as legendas de video ("Legenda Adriana Zanotto", "Transcricao e
 * Legendas"), o fim de video no feminino ("Obrigada por assistir"), o
 * plural do "inscreva-se" e as marcas de som entre colchetes ou parenteses
 * ("[Musica]", "[Aplausos]", "[Risos]") e as notas musicais. A fala real
 * nunca vem com colchete nem com nota; "tem musica na sala de espera?"
 * passa (so a marca, com o colchete, conta).
 */
export const FRASES_FANTASMA = [
  "amara.org",
  "legendas pela comunidade",
  "inscreva-se",
  "inscrevam-se",
  "obrigado por assistir",
  "obrigada por assistir",
  "legendado por",
  "transcrito por",
  "adriana zanotto",
  "transcricao e legendas",
  "[musica",
  "(musica",
  "[aplausos",
  "(aplausos",
  "[risos",
  "(risos",
  "\u266a",
  "\u266b",
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
  "silencio",
  "vazio",
  "so_pontuacao",
  "longo",
  "frase_fantasma",
  "curta_incerta",
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

/**
 * O segmento e silencio: nao conta como fala, e o texto dele e descartado.
 * So o no_speech_prob decide (revisao de 30/10/2026, M3): a decodificacao
 * confiante no silencio e o perfil da frase inventada.
 */
export function segmentoEmSilencio(segmento: SegmentoDaTranscricao): boolean {
  return (
    segmento.no_speech_prob > LIMITES_DA_QUALIDADE.silencio.noSpeechProbAcimaDe
  );
}

/** As palavras do texto (letras ou digitos seguidos). */
function contarPalavras(texto: string): number {
  return texto.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
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
  let emSilencio = 0;
  for (const segmento of segmentos) {
    if (
      !Number.isFinite(segmento.no_speech_prob) ||
      !Number.isFinite(segmento.avg_logprob) ||
      !Number.isFinite(segmento.compression_ratio)
    ) {
      return { tipo: "sem_fala", motivo: "segmento_ruim" };
    }
    if (segmentoEmSilencio(segmento)) {
      emSilencio += 1;
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
    // Todo o texto vinha de segmentos que nao contam como fala.
    return {
      tipo: "sem_fala",
      motivo: emSilencio > 0 ? "silencio" : "vazio",
    };
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
  // A resposta curta ("Sim.", "Ok.", "Certo.") so com no_speech_prob baixo
  // em TODOS os segmentos, inclusive os descartados acima.
  if (
    contarPalavras(texto) <= LIMITES_DA_QUALIDADE.curta.palavrasAte &&
    segmentos.some(
      (segmento) =>
        segmento.no_speech_prob > LIMITES_DA_QUALIDADE.curta.noSpeechProbAcimaDe,
    )
  ) {
    return { tipo: "sem_fala", motivo: "curta_incerta" };
  }
  return { tipo: "transcrita", texto };
}

/** Tudo que e fixo nas travas: a fonte da versao. */
export const FONTES_DA_QUALIDADE_DA_TRANSCRICAO = {
  limites: LIMITES_DA_QUALIDADE,
  frases: FRASES_FANTASMA,
  regras: [
    "silencio: no_speech_prob acima, qualquer que seja o avg_logprob; o texto sai",
    "todo o texto vinha do silencio: sem fala (silencio)",
    "fora do silencio: compression_ratio acima ou avg_logprob abaixo; o audio inteiro sem fala",
    "texto final vazio, so pontuacao, longo ou com frase-fantasma: sem fala",
    "texto final curto: no_speech_prob baixo em todos os segmentos, senao sem fala (curta_incerta)",
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
