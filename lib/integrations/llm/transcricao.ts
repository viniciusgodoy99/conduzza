import "server-only";

import { createHash } from "node:crypto";

import type OpenAI from "openai";
import { z } from "zod";

import {
  avaliarTranscricao,
  FONTES_DA_QUALIDADE_DA_TRANSCRICAO,
} from "@/lib/domain/conformidade/qualidade-da-transcricao";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import type { MotivoDaFalha } from "@/lib/domain/conformidade/veredicto";
import {
  classificarErroDoLlm,
  idDaRequisicao,
} from "@/lib/integrations/llm/openai";
import { log } from "@/lib/log";

// A transcricao do audio do paciente (AG6b, desenho 4.1). A UNICA chamada do
// codigo inteiro fora da Responses API: a EXCECAO liberada pelo dono em
// 28/10/2026 (D-56, "Pode usar o whisper"; CLAUDE.md, secao 2). Um teste
// varre o codigo e so aceita audio.transcriptions neste arquivo
// (tests/unit/conformidade/guarda-openai-caminhos.test.ts).
//
// O endpoint (/v1/audio/transcriptions, SDK openai 7.28) NAO tem store, nem
// safety_identifier, nem user, nem metadata, nem cache: por isso vai SO o
// audio, e o minimo dele:
//  - os bytes do MP3 sem as etiquetas ID3 (lib/domain/midia-para-o-modelo.ts),
//    como "audio.mp3" (nunca o nome do arquivo do paciente), no File global
//    do Node 22;
//  - o pedido fixo: o modelo da lista fechada (whisper-1, D-90),
//    language "pt", response_format "verbose_json" (as metricas de cada
//    segmento para as travas e a duracao cobrada), timestamp_granularities
//    ["segment"] e temperature 0. Sem prompt (o whisper-1 repete o prompt
//    no silencio), sem include, stream, chunking_strategy, keywords,
//    languages e known_speaker_*.
// O cliente e o da OpenAI de sempre (criarClienteOpenAi, a chave do agente,
// D-94): URL fixa, cabecalhos fixos, log do SDK mudo e o 429 de cota sem
// repetir. Prazo duro por chamada (PRAZO_DA_TRANSCRICAO_MS, passado ao SDK e
// cortado por correrComPrazo) e UMA nova tentativa do SDK dentro dele.
//
// A resposta passa por um esquema (fora dele: saida_invalida) e pelas travas
// da saida (lib/domain/conformidade/qualidade-da-transcricao.ts): silencio,
// repeticao, confianca e frases-fantasma viram "sem fala". Falha fechada:
// erro, prazo, cota ou saida invalida devolvem "falhou" e a conversa vai
// para a equipe (quem chama decide).
//
// TRANSCRICAO_CALIBRADA (falsa ate a prova paga, D-100): com ela falsa, o
// plano do turno (lib/agente/midia.ts) marca todo audio como fora, e nada
// chega aqui.
//
// LGPD: log so com ids, o resultado, os segundos e a duracao da chamada;
// nunca o texto, nem error.message.

/** So audio.transcriptions; os testes injetam um falso. */
export type ClienteDaTranscricao = Pick<OpenAI, "audio">;

/** A lista fechada (D-90): so o whisper-1, o que o dono liberou. */
export const MODELOS_DA_TRANSCRICAO = ["whisper-1"] as const;
export type ModeloDaTranscricao = (typeof MODELOS_DA_TRANSCRICAO)[number];
export const MODELO_PADRAO_DA_TRANSCRICAO: ModeloDaTranscricao = "whisper-1";

/**
 * O modelo pelo ambiente (IA_MODELO_TRANSCRICAO). Vazio usa o padrao; fora
 * da lista, null, e nada sai (o plano marca o audio como fora).
 */
export function modeloDaTranscricao(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModeloDaTranscricao | null {
  const valor = env.IA_MODELO_TRANSCRICAO?.trim();
  if (!valor) {
    return MODELO_PADRAO_DA_TRANSCRICAO;
  }
  return (MODELOS_DA_TRANSCRICAO as readonly string[]).includes(valor)
    ? (valor as ModeloDaTranscricao)
    : null;
}

/**
 * Prazo de uma transcricao (PROPOSTA, a calibrar na prova paga: 15, 60 e
 * 120 s de audio). Vai ao SDK (timeout) e ao corte duro.
 */
export const PRAZO_DA_TRANSCRICAO_MS = 12_000;

/**
 * As travas da saida (silencio, repeticao, confianca, frases-fantasma) e o
 * prazo foram calibrados pela prova paga (D-100)? Enquanto for falsa, todo
 * audio e "fora" no plano do turno, mesmo com a habilidade ligada. Vira
 * verdadeira num commit pequeno depois da prova, com os limites medidos.
 */
export const TRANSCRICAO_CALIBRADA = false;

/** O pedido fixo (fora o arquivo e o modelo). */
export const PARAMETROS_FIXOS_DA_TRANSCRICAO = {
  language: "pt",
  response_format: "verbose_json",
  timestamp_granularities: ["segment"],
  temperature: 0,
} as const;

/** O nome do arquivo que vai a OpenAI: nunca o do paciente. */
export const NOME_DO_ARQUIVO_DE_AUDIO = "audio.mp3";
export const TIPO_DO_ARQUIVO_DE_AUDIO = "audio/mpeg";

/** Tolerancia entre a duracao medida e a da API antes do log. */
const DIVERGENCIA_ACEITA = 0.1;

/**
 * A versao da transcricao ("transcricao-" e 12 hex do sha256 de tudo que e
 * fixo: os modelos, os parametros, o nome do arquivo e as travas da saida).
 * Vai em ia_leitura_da_midia.versao.
 */
export const VERSAO_DA_TRANSCRICAO = `transcricao-${createHash("sha256")
  .update(
    JSON.stringify({
      modelos: MODELOS_DA_TRANSCRICAO,
      parametros: PARAMETROS_FIXOS_DA_TRANSCRICAO,
      arquivo: [NOME_DO_ARQUIVO_DE_AUDIO, TIPO_DO_ARQUIVO_DE_AUDIO],
      qualidade: FONTES_DA_QUALIDADE_DA_TRANSCRICAO,
      divergencia: DIVERGENCIA_ACEITA,
    }),
    "utf8",
  )
  .digest("hex")
  .slice(0, 12)}`;

/** A resposta do verbose_json que o motor le (o resto e ignorado). */
const RespostaDaTranscricao = z.object({
  text: z.string(),
  duration: z.number().nonnegative(),
  segments: z
    .array(
      z.object({
        text: z.string(),
        avg_logprob: z.number(),
        compression_ratio: z.number(),
        no_speech_prob: z.number(),
      }),
    )
    .max(2_000),
  usage: z
    .object({ type: z.literal("duration"), seconds: z.number().nonnegative() })
    .optional(),
});

/** O que a chamada custou (para ia_uso): o modelo e os segundos cobrados. */
export type UsoDaTranscricao = { modelo: string; segundos: number };

export type ResultadoDaTranscricaoNoModelo =
  | {
      tipo: "transcrita";
      texto: string;
      segundos: number;
      uso: UsoDaTranscricao | null;
    }
  | { tipo: "sem_fala"; segundos: number; uso: UsoDaTranscricao | null }
  | { tipo: "falhou"; motivo: MotivoDaFalha; uso: UsoDaTranscricao | null };

/**
 * Motivos em que a chamada certamente nao foi cobrada (o espelho de
 * MOTIVOS_SEM_COBRANCA de lib/agente/gasto.ts): nem saiu, ou a API recusou
 * antes de processar. O resto entra com a duracao medida (o lado seguro).
 */
const SEM_COBRANCA: ReadonlySet<string> = new Set<MotivoDaFalha>([
  "sem_cliente",
  "modelo_invalido",
  "requisicao_invalida",
  "autenticacao",
  "permissao",
  "nao_encontrado",
  "prazo",
  "contexto_truncado",
]);

/** Os ids de sempre do log (nunca texto). */
export type IdsDaTranscricao = {
  clinicId: string;
  conversationId: string;
  jobId: string;
  messageId: string;
};

function idsDoLog(ids: IdsDaTranscricao) {
  return {
    provider: "openai",
    kind: "transcricao",
    clinic_id: ids.clinicId,
    conversation_id: ids.conversationId,
    job_id: ids.jobId,
    message_id: ids.messageId,
  };
}

/** Os segundos cobrados, sempre inteiros e para cima. */
function segundosInteiros(segundos: number): number {
  return Math.max(1, Math.ceil(segundos));
}

/**
 * Transcreve UM audio ja preparado (MP3 sem ID3, de 1 a 120 s, ate 5 MB).
 * Nunca lanca. `segundosMedidos` e a duracao que o preparo mediu pelos
 * quadros: entra na conta (o maior entre ela, a duration e o usage.seconds
 * da API, o lado seguro do custo) e e o uso da chamada que falhou depois de
 * sair.
 */
export async function transcreverAudio(entrada: {
  cliente: ClienteDaTranscricao | null;
  modelo: ModeloDaTranscricao | null;
  bytes: Uint8Array;
  segundosMedidos: number;
  prazoMs: number;
  ids: IdsDaTranscricao;
  agora?: () => number;
  /**
   * SO a prova paga (scripts/ia/prova-da-midia.ts, D-100): as metricas de
   * cada segmento, a duration e o usage.seconds da resposta, para calibrar
   * as travas. So numeros; o motor nunca passa. Assim a chamada continua
   * existindo num lugar so.
   */
  medir?: (medida: {
    segmentos: readonly {
      avg_logprob: number;
      compression_ratio: number;
      no_speech_prob: number;
    }[];
    duration: number;
    usageSeconds: number | null;
  }) => void;
}): Promise<ResultadoDaTranscricaoNoModelo> {
  const agora = entrada.agora ?? Date.now;
  const { cliente, modelo } = entrada;
  const medidos = segundosInteiros(entrada.segundosMedidos);
  const falha = (motivo: MotivoDaFalha): ResultadoDaTranscricaoNoModelo => ({
    tipo: "falhou",
    motivo,
    uso:
      modelo === null || SEM_COBRANCA.has(motivo)
        ? null
        : { modelo, segundos: medidos },
  });
  if (cliente === null) {
    return falha("sem_cliente");
  }
  if (modelo === null) {
    return falha("modelo_invalido");
  }
  const prazo = Math.floor(entrada.prazoMs);
  if (!(prazo >= 1_000)) {
    return falha("prazo");
  }

  // O File global do Node 22, com uma copia dos bytes (nunca o buffer de
  // quem chama) e o nome fixo.
  const arquivo = new File([new Uint8Array(entrada.bytes)], NOME_DO_ARQUIVO_DE_AUDIO, {
    type: TIPO_DO_ARQUIVO_DE_AUDIO,
  });
  const inicio = agora();
  const corrida = await correrComPrazo(async (sinal) => {
    try {
      const resposta: unknown = await cliente.audio.transcriptions.create(
        {
          file: arquivo,
          model: modelo,
          ...PARAMETROS_FIXOS_DA_TRANSCRICAO,
          timestamp_granularities: [
            ...PARAMETROS_FIXOS_DA_TRANSCRICAO.timestamp_granularities,
          ],
        },
        { timeout: prazo, maxRetries: 1, signal: sinal },
      );
      return { ok: true as const, resposta };
    } catch (erro) {
      return { ok: false as const, erro };
    }
  }, prazo + 500);
  const duracao = agora() - inicio;

  if (corrida.tipo !== "resultado") {
    const motivo: MotivoDaFalha =
      corrida.tipo === "prazo" ? "timeout" : "desconhecida";
    log.warn("ia_transcricao_falhou", {
      ...idsDoLog(entrada.ids),
      modelo,
      error_code: motivo,
      duration_ms: duracao,
    });
    return falha(motivo);
  }
  if (!corrida.valor.ok) {
    const classificado = classificarErroDoLlm(corrida.valor.erro);
    const campos = {
      ...idsDoLog(entrada.ids),
      modelo,
      error_code: classificado.codigo ?? classificado.motivo,
      http_status: classificado.httpStatus ?? undefined,
      request_id: classificado.requestId ?? undefined,
      duration_ms: duracao,
    };
    if (classificado.grave) {
      log.error("ia_transcricao_falhou", campos);
    } else {
      log.warn("ia_transcricao_falhou", campos);
    }
    return falha(classificado.motivo);
  }

  const lida = RespostaDaTranscricao.safeParse(corrida.valor.resposta);
  const requestId =
    typeof corrida.valor.resposta === "object" &&
    corrida.valor.resposta !== null
      ? (idDaRequisicao(
          (corrida.valor.resposta as { _request_id?: unknown })._request_id,
        ) ?? undefined)
      : undefined;
  if (!lida.success) {
    log.warn("ia_transcricao_falhou", {
      ...idsDoLog(entrada.ids),
      modelo,
      error_code: "saida_invalida",
      request_id: requestId,
      duration_ms: duracao,
    });
    return falha("saida_invalida");
  }

  // Os segundos: o maior entre o usage, a duration e a medida do preparo
  // (o custo nunca fica abaixo do real). A divergencia grande vira log,
  // so com os numeros.
  const daApi = Math.max(lida.data.usage?.seconds ?? 0, lida.data.duration);
  if (
    daApi > 0 &&
    Math.abs(daApi - entrada.segundosMedidos) >
      DIVERGENCIA_ACEITA * Math.max(daApi, entrada.segundosMedidos)
  ) {
    log.warn("ia_transcricao_duracao_divergente", {
      ...idsDoLog(entrada.ids),
      modelo,
      count: medidos,
      duration_ms: Math.round(daApi * 1000),
    });
  }
  const segundos = segundosInteiros(Math.max(daApi, entrada.segundosMedidos));
  const uso: UsoDaTranscricao = { modelo, segundos };
  entrada.medir?.({
    segmentos: lida.data.segments.map((s) => ({
      avg_logprob: s.avg_logprob,
      compression_ratio: s.compression_ratio,
      no_speech_prob: s.no_speech_prob,
    })),
    duration: lida.data.duration,
    usageSeconds: lida.data.usage?.seconds ?? null,
  });
  const qualidade = avaliarTranscricao({ segmentos: lida.data.segments });
  log.info("ia_transcricao", {
    ...idsDoLog(entrada.ids),
    modelo,
    status: qualidade.tipo,
    stop_reason: qualidade.tipo === "sem_fala" ? qualidade.motivo : undefined,
    count: segundos,
    request_id: requestId,
    duration_ms: duracao,
  });
  return qualidade.tipo === "transcrita"
    ? { tipo: "transcrita", texto: qualidade.texto, segundos, uso }
    : { tipo: "sem_fala", segundos, uso };
}
