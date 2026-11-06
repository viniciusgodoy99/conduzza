import "server-only";

import { createHash } from "node:crypto";

import type OpenAI from "openai";
import { z } from "zod";

import {
  avaliarTranscricao,
  FONTES_DA_QUALIDADE_DA_TRANSCRICAO,
} from "@/lib/domain/conformidade/qualidade-da-transcricao";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import {
  detectarUrgencia,
  type TipoDeUrgencia,
} from "@/lib/domain/conformidade/urgencia";
import type { MotivoDaFalha } from "@/lib/domain/conformidade/veredicto";
import {
  classificarErroDoLlm,
  idDaRequisicao,
  TENTATIVAS_EXTRAS,
  type ErroClassificado,
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
// repetir.
//
// PRAZO (CORTE DURO; revisao da AG6b, o mesmo desenho do leitor de midia,
// lib/integrations/llm/leitor-de-midia.ts): a transcricao inteira (as
// chamadas, a espera entre elas e a leitura do corpo) corre dentro de
// correrComPrazo, com o prazo de quem chama mais
// FOLGA_DO_CORTE_DA_TRANSCRICAO_MS. O sinal do corte vai ao SDK junto com o
// de quem chama (o corte da porta e do laco): qualquer um aborta a chamada, e
// o de quem chama encerra a transcricao na hora, mesmo com um cliente que nao
// respeita o sinal (a requisicao nao fica rodando ate o prazo dela). A nova
// tentativa e feita AQUI, nao pelo SDK (maxRetries 0): no openai 7.28 o
// timeout vale por tentativa, a tentativa que estoura e repetida (as duas
// podem ser cobradas) e o SDK dorme o retry-after de ate 60 s no 429 e no
// 5xx. Aqui cada chamada recebe so o prazo que sobra, repete so rede, prazo
// da chamada, 429 de ritmo, 5xx, 408 e 409 (e respeita o x-should-retry), e
// a espera (retry-after ou ESPERA_PADRAO_DA_NOVA_TENTATIVA_MS) so acontece
// se ela e uma chamada de PRAZO_MINIMO_DA_CHAMADA_MS couberem no prazo;
// senao, a falha volta na hora.
//
// GASTO: `uso` e `motivo` sao os da ULTIMA chamada (na falha que pode ter
// sido cobrada, a duracao medida). A chamada anterior que falhou sem
// resposta e pode ter sido cobrada volta em `tentativasSemUso`, para quem
// chama somar o pior caso dela (a duracao medida). Corte antes de qualquer
// chamada sair (prazo curto, quem chama ja desistiu): "prazo", que nunca e
// cobrado. O pior caso de um audio e MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO
// chamadas (a reserva do turno, lib/agente/laco.ts).
//
// Os helpers da nova tentativa repetem os do leitor de proposito: sao dois
// casos de uso, e a camada generica so vem no terceiro (CLAUDE.md, secao 4).
//
// A resposta passa por um esquema (fora dele: saida_invalida) e pelas travas
// da saida (lib/domain/conformidade/qualidade-da-transcricao.ts): silencio,
// repeticao, confianca e frases-fantasma viram "sem fala". Falha fechada:
// erro, prazo, cota ou saida invalida devolvem "falhou" e a conversa vai
// para a equipe (quem chama decide).
//
// A URGENCIA NO TEXTO DESCARTADO (revisao R2 de d1a15f6, M3): as travas
// descartam a fala curta incerta ("Quero morrer." com no_speech_prob 0,35)
// e o segmento em silencio ("Socorro, minha mae desmaiou" com 0,65 e ruido
// de fundo), e o texto descartado nunca chega ao portao do laco. Por isso a
// urgencia (lib/domain/conformidade/urgencia.ts, local) e lida AQUI, no
// texto inteiro de todos os segmentos, inclusive os descartados, no "sem
// fala" e na transcricao (que pode ter descartado parte do audio: a fala
// real com um segmento urgente no ruido). Sai so o TIPO (`urgencia`,
// ausente quando nao ha); o texto descartado nunca sai daqui: nem no
// resultado, nem no log, nem no banco, nem no agente. RR2 de 88e9560: quem
// chama (a porta, lib/agente/midia.ts, urgenciaDaTranscricao) le tambem o
// texto mantido, nao grava a leitura quando a urgencia esta so no
// descartado (o job repetido transcreve de novo e acha de novo) e leva a
// urgencia na falha que vem depois da transcricao (a gravacao recusada, o
// corte durante a RPC).
//
// TRANSCRICAO_CALIBRADA (verdadeira desde a decisao do dono de 06/11/2026, que
// dispensou a prova paga, D-100): com ela falsa, o plano do turno
// (lib/agente/midia.ts) marca todo audio como fora, e nada chega aqui.
//
// LGPD: log so com ids, o resultado, os segundos, a tentativa e a duracao
// da chamada; nunca o texto, nem error.message, nem a urgencia (e dado de
// saude derivado do texto).

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
 * Prazo de uma transcricao: as chamadas e a espera entre elas cabem nele. Vai
 * ao SDK (o timeout de cada chamada, so o que sobra) e ao corte duro.
 * shortcut: valor sem medir (prova paga dispensada pelo dono em 06/11/2026), trocar quando houver medida.
 */
export const PRAZO_DA_TRANSCRICAO_MS = 12_000;
/**
 * O corte duro e o prazo da transcricao mais esta folga (a mesma do leitor
 * e do agente). A folga so existe para o corte pegar o que nao respeita o
 * sinal (cliente pendurado, corpo travado depois dos cabecalhos). Quem chama
 * passa um prazo que poe este corte ANTES do dele (lib/agente/midia.ts).
 */
export const FOLGA_DO_CORTE_DA_TRANSCRICAO_MS = 500;
/**
 * As chamadas de uma transcricao, no maximo: a primeira e UMA nova
 * tentativa (TENTATIVAS_EXTRAS do cliente), feita aqui e nao pelo SDK. Cada
 * uma pode ser cobrada (a duracao do audio): e o pior caso de um audio na
 * reserva do gasto.
 */
export const MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO = 1 + TENTATIVAS_EXTRAS;
/** Nenhuma chamada (a primeira ou a nova tentativa) comeca com menos. */
const PRAZO_MINIMO_DA_CHAMADA_MS = 1_000;
/** A espera antes da nova tentativa quando a API nao pede outra (a do SDK). */
const ESPERA_PADRAO_DA_NOVA_TENTATIVA_MS = 500;

/**
 * O audio vai a transcricao? Falsa, todo audio e "fora" no plano do turno,
 * mesmo com a habilidade ligada (o jeito de desligar sem mexer em clinica).
 * As travas da saida (silencio, repeticao, confianca, frases-fantasma) e o
 * prazo continuam com os valores propostos, e o que elas nao garantem vai
 * para a equipe.
 * shortcut: valor sem medir (prova paga dispensada pelo dono em 06/11/2026), trocar quando houver medida.
 */
export const TRANSCRICAO_CALIBRADA = true;

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

/**
 * `uso` (e, na falha, `motivo`) sao os da ULTIMA chamada que saiu; na falha
 * que pode ter sido cobrada, o uso e a duracao medida. `tentativasSemUso`,
 * so quando houver (0 fica ausente): quantas chamadas ANTERIORES a ultima
 * sairam, falharam sem resposta e podem ter sido cobradas (rede, prazo da
 * chamada, 5xx, 408, 409; nunca o 429, que a API recusa antes de
 * processar). Quem chama soma o pior caso de uma chamada (a duracao medida)
 * para cada uma. Falha "prazo": nenhuma chamada saiu.
 *
 * `urgencia` (revisao R2 de d1a15f6, M3), so quando houver: o TIPO da
 * urgencia lida no texto inteiro dos segmentos, inclusive os que as travas
 * descartaram. Quem chama passa a conversa como urgente. O texto descartado
 * nunca sai daqui.
 */
export type ResultadoDaTranscricaoNoModelo =
  | {
      tipo: "transcrita";
      texto: string;
      segundos: number;
      uso: UsoDaTranscricao | null;
      urgencia?: TipoDeUrgencia;
      tentativasSemUso?: number;
    }
  | {
      tipo: "sem_fala";
      segundos: number;
      uso: UsoDaTranscricao | null;
      urgencia?: TipoDeUrgencia;
      tentativasSemUso?: number;
    }
  | {
      tipo: "falhou";
      motivo: MotivoDaFalha;
      uso: UsoDaTranscricao | null;
      tentativasSemUso?: number;
    };

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
 * Revisao R2 de d1a15f6 (M3): a urgencia no texto INTEIRO do audio, os
 * segmentos na ordem, inclusive os que as travas descartaram (o silencio, o
 * segmento ruim, a fala curta incerta, a frase-fantasma); sem segmentos, o
 * `text` da resposta. Local (a lista deterministica), sem rede. So o tipo
 * sai daqui; o texto, nunca.
 */
function urgenciaNoAudio(resposta: {
  text: string;
  segments: readonly { text: string }[];
}): TipoDeUrgencia | null {
  const texto =
    resposta.segments.length > 0
      ? resposta.segments.map((segmento) => segmento.text).join(" ")
      : resposta.text;
  return detectarUrgencia([texto])?.tipo ?? null;
}

// ---------------------------------------------------------------------------
// O corte duro e a nova tentativa (o desenho do leitor de midia)
// ---------------------------------------------------------------------------

/**
 * Os erros que valem UMA nova tentativa (os do SDK: rede, prazo da chamada,
 * 429 de ritmo e 5xx; o 408 e o 409 pelo status). Nunca os graves (400,
 * 401, 403, 404 e o 429 de cota): tentar de novo nao muda nada.
 */
const MOTIVOS_QUE_REPETEM: ReadonlySet<MotivoDaFalha> = new Set<MotivoDaFalha>([
  "conexao",
  "timeout",
  "limite",
  "sobrecarga",
  "servidor",
]);

/**
 * O que a API recusa antes de processar (o 429, de ritmo ou de cota, e os
 * 4xx de configuracao): a chamada ANTERIOR com um destes nao conta em
 * tentativasSemUso. O SDK vai com maxRetries 0, entao o erro e so daquela
 * chamada. O resto que falha sem resposta (rede, prazo da chamada, 5xx,
 * 408, 409) pode ter sido cobrado: o lado seguro, como em
 * lib/agente/gasto.ts.
 */
const CHAMADA_SEM_COBRANCA: ReadonlySet<MotivoDaFalha> = new Set<MotivoDaFalha>([
  "limite",
  "cota",
  "requisicao_invalida",
  "autenticacao",
  "permissao",
  "nao_encontrado",
]);

/** Um cabecalho da resposta de erro do SDK (APIError.headers), ou null. */
function cabecalhoDoErro(erro: unknown, nome: string): string | null {
  if (typeof erro !== "object" || erro === null) {
    return null;
  }
  const cabecalhos: unknown = (erro as { headers?: unknown }).headers;
  if (
    typeof cabecalhos !== "object" ||
    cabecalhos === null ||
    typeof (cabecalhos as { get?: unknown }).get !== "function"
  ) {
    return null;
  }
  try {
    const valor: unknown = (cabecalhos as Headers).get(nome);
    return typeof valor === "string" ? valor.trim() : null;
  } catch {
    return null;
  }
}

function podeRepetir(erro: unknown, classificado: ErroClassificado): boolean {
  if (classificado.grave) {
    return false;
  }
  // O x-should-retry manda, como no SDK (o 429 de cota ja chega com "false"
  // pelo fetch do cliente, lib/integrations/llm/openai.ts).
  const pedido = cabecalhoDoErro(erro, "x-should-retry");
  if (pedido === "false") {
    return false;
  }
  if (pedido === "true") {
    return true;
  }
  return (
    MOTIVOS_QUE_REPETEM.has(classificado.motivo) ||
    (classificado.motivo === "outro_http" &&
      (classificado.httpStatus === 408 || classificado.httpStatus === 409))
  );
}

/**
 * A espera que a API pediu, em ms (retry-after-ms; depois retry-after, em
 * segundos ou data HTTP, como no SDK); null sem pedido valido. Sem teto
 * aqui: a espera que nao cabe no prazo simplesmente nao acontece.
 */
function esperaPedida(erro: unknown): number | null {
  const emMs = cabecalhoDoErro(erro, "retry-after-ms");
  if (emMs !== null) {
    const valor = Number.parseFloat(emMs);
    if (Number.isFinite(valor) && valor >= 0) {
      return valor;
    }
  }
  const depois = cabecalhoDoErro(erro, "retry-after");
  if (depois !== null) {
    const segundos = Number.parseFloat(depois);
    if (Number.isFinite(segundos)) {
      return segundos >= 0 ? segundos * 1_000 : null;
    }
    const data = Date.parse(depois);
    if (Number.isFinite(data)) {
      return Math.max(0, data - Date.now());
    }
  }
  return null;
}

/** Espera `ms`, ou menos se o sinal abortar. Nunca rejeita. */
function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal.aborted) {
      resolve();
      return;
    }
    // pronto so roda depois que o relogio existe (no tempo ou no sinal).
    const pronto = () => {
      clearTimeout(relogio);
      sinal.removeEventListener("abort", pronto);
      resolve();
    };
    const relogio = setTimeout(pronto, Math.max(0, ms));
    sinal.addEventListener("abort", pronto, { once: true });
  });
}

/**
 * O sinal das chamadas: aborta no corte duro OU quando quem chama desiste
 * (o corte da porta ou do laco). `desistencia` resolve so no segundo caso,
 * para a transcricao terminar na hora mesmo com um cliente que nao respeita
 * o sinal.
 */
function sinalDasChamadas(
  corte: AbortSignal,
  deQuemChama: AbortSignal | undefined,
): {
  sinal: AbortSignal;
  desistencia: Promise<{ tipo: "abortado" }>;
  soltar: () => void;
} {
  const controle = new AbortController();
  let avisar: () => void = () => undefined;
  const desistencia = new Promise<{ tipo: "abortado" }>((resolve) => {
    avisar = () => resolve({ tipo: "abortado" });
  });
  const noCorte = () => controle.abort();
  const naDesistencia = () => {
    controle.abort();
    avisar();
  };
  corte.addEventListener("abort", noCorte, { once: true });
  deQuemChama?.addEventListener("abort", naDesistencia, { once: true });
  if (corte.aborted) {
    noCorte();
  }
  if (deQuemChama?.aborted) {
    naDesistencia();
  }
  return {
    sinal: controle.signal,
    desistencia,
    soltar: () => {
      corte.removeEventListener("abort", noCorte);
      deQuemChama?.removeEventListener("abort", naDesistencia);
    },
  };
}

/** Quantas chamadas sairam e quantas anteriores podem ter sido cobradas. */
type ContagemDasChamadas = { saidas: number; semUso: number };

type DesfechoDasChamadas<R> =
  | { tipo: "resposta"; resposta: R }
  | { tipo: "erro"; erro: unknown; classificado: ErroClassificado }
  /** Quem chama desistiu (o corte da porta ou do laco). */
  | { tipo: "abortado" }
  /** O corte duro, visto por dentro. */
  | { tipo: "prazo" };

/**
 * A chamada e no maximo UMA nova tentativa, ate `fim`. Cada chamada leva so
 * o prazo que sobra (o timeout do SDK) e o sinal; a nova tentativa so sai se
 * o erro repete e se a espera e uma chamada minima cabem antes de `fim`.
 * Nunca lanca: a excecao do cliente (sincrona ou nao) e o desfecho "erro".
 */
async function chamarComNovaTentativa<R>(e: {
  chamar: (opcoes: { timeout: number; signal: AbortSignal }) => PromiseLike<R>;
  sinal: AbortSignal;
  deQuemChama: AbortSignal | undefined;
  fim: number;
  agora: () => number;
  contagem: ContagemDasChamadas;
  aoRepetir: (classificado: ErroClassificado) => void;
}): Promise<DesfechoDasChamadas<R>> {
  const parada = (): DesfechoDasChamadas<R> =>
    e.deQuemChama?.aborted ? { tipo: "abortado" } : { tipo: "prazo" };
  let anterior: { erro: unknown; classificado: ErroClassificado } | null =
    null;
  for (;;) {
    if (e.sinal.aborted) {
      return parada();
    }
    const restante = Math.floor(e.fim - e.agora());
    if (anterior !== null) {
      if (restante < PRAZO_MINIMO_DA_CHAMADA_MS) {
        return { tipo: "erro", ...anterior };
      }
      // A nova tentativa vai sair: a anterior falhou sem devolver o uso.
      if (!CHAMADA_SEM_COBRANCA.has(anterior.classificado.motivo)) {
        e.contagem.semUso += 1;
      }
    }
    e.contagem.saidas += 1;
    try {
      const resposta = await e.chamar({
        timeout: Math.max(1, restante),
        signal: e.sinal,
      });
      return { tipo: "resposta", resposta };
    } catch (erro) {
      if (e.sinal.aborted) {
        return parada();
      }
      const classificado = classificarErroDoLlm(erro);
      anterior = { erro, classificado };
      if (
        e.contagem.saidas >= MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO ||
        !podeRepetir(erro, classificado)
      ) {
        return { tipo: "erro", erro, classificado };
      }
      const espera = esperaPedida(erro) ?? ESPERA_PADRAO_DA_NOVA_TENTATIVA_MS;
      if (espera + PRAZO_MINIMO_DA_CHAMADA_MS > e.fim - e.agora()) {
        // A espera e a nova chamada nao cabem no prazo: a falha volta agora.
        return { tipo: "erro", erro, classificado };
      }
      e.aoRepetir(classificado);
      await esperar(espera, e.sinal);
    }
  }
}

/**
 * Transcreve UM audio ja preparado (MP3 sem ID3, de 1 a 120 s, ate 5 MB).
 * Nunca lanca, e nunca passa de `prazoMs` mais
 * FOLGA_DO_CORTE_DA_TRANSCRICAO_MS (nem do momento em que `sinal` aborta).
 * `segundosMedidos` e a duracao que o preparo mediu pelos quadros: entra na
 * conta (o maior entre ela, a duration e o usage.seconds da API, o lado
 * seguro do custo) e e o uso da chamada que falhou depois de sair.
 */
export async function transcreverAudio(entrada: {
  cliente: ClienteDaTranscricao | null;
  modelo: ModeloDaTranscricao | null;
  bytes: Uint8Array;
  segundosMedidos: number;
  prazoMs: number;
  ids: IdsDaTranscricao;
  /**
   * O cancelamento de quem chama (o corte da porta e do laco). Opcional: o
   * corte duro vale sem ele. Abortado, a transcricao termina na hora.
   */
  sinal?: AbortSignal;
  agora?: () => number;
  /**
   * SO a medida com o script (scripts/ia/prova-da-midia.ts): as metricas de
   * cada segmento, a duration e o usage.seconds da resposta, para calibrar
   * as travas. So numeros; o motor nunca passa. Assim a chamada continua
   * existindo num lugar so.
   */
  medir?: (medida: {
    segmentos: readonly {
      avg_logprob: number;
      compression_ratio: number;
      no_speech_prob: number;
      /** Quantas palavras o segmento tem (o numero, nunca o texto). */
      palavras: number;
    }[];
    duration: number;
    usageSeconds: number | null;
  }) => void;
}): Promise<ResultadoDaTranscricaoNoModelo> {
  const agora = entrada.agora ?? Date.now;
  const { cliente, modelo } = entrada;
  const medidos = segundosInteiros(entrada.segundosMedidos);
  const contagem: ContagemDasChamadas = { saidas: 0, semUso: 0 };
  // As chamadas anteriores que podem ter sido cobradas, so quando houver.
  const semUso = () =>
    contagem.semUso > 0 ? { tentativasSemUso: contagem.semUso } : {};
  const falha = (motivo: MotivoDaFalha): ResultadoDaTranscricaoNoModelo => ({
    tipo: "falhou",
    motivo,
    uso:
      modelo === null || SEM_COBRANCA.has(motivo)
        ? null
        : { modelo, segundos: medidos },
    ...semUso(),
  });
  // Solta os ouvintes do sinal de quem chama (tambem quando o corte vence).
  let soltarOSinal: () => void = () => undefined;
  try {
    if (cliente === null) {
      return falha("sem_cliente");
    }
    if (modelo === null) {
      return falha("modelo_invalido");
    }
    const prazo = Math.floor(entrada.prazoMs);
    if (!(prazo >= PRAZO_MINIMO_DA_CHAMADA_MS)) {
      return falha("prazo");
    }
    if (entrada.sinal?.aborted) {
      // Quem chama ja desistiu: nada sai, e nada e cobrado ("prazo").
      log.warn("ia_transcricao_falhou", {
        ...idsDoLog(entrada.ids),
        modelo,
        error_code: "abortado",
        attempt: 0,
      });
      return falha("prazo");
    }

    // O File global do Node 22, com uma copia dos bytes (nunca o buffer de
    // quem chama) e o nome fixo. O mesmo arquivo nas duas chamadas.
    const arquivo = new File(
      [new Uint8Array(entrada.bytes)],
      NOME_DO_ARQUIVO_DE_AUDIO,
      { type: TIPO_DO_ARQUIVO_DE_AUDIO },
    );
    // A mesma requisicao nas duas chamadas; o SDK nunca repete sozinho.
    const chamar = (opcoes: {
      timeout: number;
      signal: AbortSignal;
    }): PromiseLike<unknown> =>
      cliente.audio.transcriptions.create(
        {
          file: arquivo,
          model: modelo,
          ...PARAMETROS_FIXOS_DA_TRANSCRICAO,
          timestamp_granularities: [
            ...PARAMETROS_FIXOS_DA_TRANSCRICAO.timestamp_granularities,
          ],
        },
        { timeout: opcoes.timeout, maxRetries: 0, signal: opcoes.signal },
      );
    const inicio = agora();
    const corrida = await correrComPrazo((corte) => {
      const ligacao = sinalDasChamadas(corte, entrada.sinal);
      soltarOSinal = ligacao.soltar;
      return Promise.race([
        chamarComNovaTentativa({
          chamar,
          sinal: ligacao.sinal,
          deQuemChama: entrada.sinal,
          fim: inicio + prazo,
          agora,
          contagem,
          aoRepetir: (classificado) => {
            log.warn("ia_transcricao", {
              ...idsDoLog(entrada.ids),
              modelo,
              status: "nova_tentativa",
              error_code: classificado.codigo ?? classificado.motivo,
              http_status: classificado.httpStatus ?? undefined,
              request_id: classificado.requestId ?? undefined,
              attempt: contagem.saidas,
              duration_ms: agora() - inicio,
            });
          },
        }),
        ligacao.desistencia,
      ]);
    }, prazo + FOLGA_DO_CORTE_DA_TRANSCRICAO_MS);
    soltarOSinal();
    const duracao = agora() - inicio;
    const comuns = {
      ...idsDoLog(entrada.ids),
      modelo,
      attempt: contagem.saidas,
      duration_ms: duracao,
    };

    if (corrida.tipo === "erro") {
      // Nao acontece (o laco nunca lanca); a falha fechada de sempre.
      log.warn("ia_transcricao_falhou", {
        ...comuns,
        error_code: "desconhecida",
      });
      return falha("desconhecida");
    }
    const desfecho =
      corrida.tipo === "prazo" ? ({ tipo: "prazo" } as const) : corrida.valor;
    if (desfecho.tipo === "prazo" || desfecho.tipo === "abortado") {
      // Sem resposta: o corte duro ("timeout") ou quem chama desistiu. Se
      // nenhuma chamada saiu, nada foi cobrado ("prazo").
      const codigo = desfecho.tipo === "prazo" ? "timeout" : "abortado";
      log.warn("ia_transcricao_falhou", { ...comuns, error_code: codigo });
      return falha(contagem.saidas === 0 ? "prazo" : codigo);
    }
    if (desfecho.tipo === "erro") {
      const { classificado } = desfecho;
      const campos = {
        ...comuns,
        error_code: classificado.codigo ?? classificado.motivo,
        http_status: classificado.httpStatus ?? undefined,
        request_id: classificado.requestId ?? undefined,
      };
      if (classificado.grave) {
        log.error("ia_transcricao_falhou", campos);
      } else {
        log.warn("ia_transcricao_falhou", campos);
      }
      return falha(classificado.motivo);
    }

    const resposta: unknown = desfecho.resposta;
    const lida = RespostaDaTranscricao.safeParse(resposta);
    const requestId =
      typeof resposta === "object" && resposta !== null
        ? (idDaRequisicao((resposta as { _request_id?: unknown })._request_id) ??
          undefined)
        : undefined;
    if (!lida.success) {
      log.warn("ia_transcricao_falhou", {
        ...comuns,
        error_code: "saida_invalida",
        request_id: requestId,
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
    const segundos = segundosInteiros(
      Math.max(daApi, entrada.segundosMedidos),
    );
    const uso: UsoDaTranscricao = { modelo, segundos };
    entrada.medir?.({
      segmentos: lida.data.segments.map((s) => ({
        avg_logprob: s.avg_logprob,
        compression_ratio: s.compression_ratio,
        no_speech_prob: s.no_speech_prob,
        palavras: s.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
      })),
      duration: lida.data.duration,
      usageSeconds: lida.data.usage?.seconds ?? null,
    });
    const qualidade = avaliarTranscricao({ segmentos: lida.data.segments });
    // Revisao R2 de d1a15f6 (M3): a urgencia no texto inteiro, inclusive o
    // descartado. So o tipo vai no resultado; nada dela vai ao log.
    const urgencia = urgenciaNoAudio(lida.data);
    const comUrgencia = urgencia === null ? {} : { urgencia };
    log.info("ia_transcricao", {
      ...comuns,
      status: qualidade.tipo,
      stop_reason: qualidade.tipo === "sem_fala" ? qualidade.motivo : undefined,
      count: segundos,
      request_id: requestId,
    });
    return qualidade.tipo === "transcrita"
      ? {
          tipo: "transcrita",
          texto: qualidade.texto,
          segundos,
          uso,
          ...comUrgencia,
          ...semUso(),
        }
      : { tipo: "sem_fala", segundos, uso, ...comUrgencia, ...semUso() };
  } catch {
    // Rede de seguranca: excecao inesperada (inclusive sincrona) vira falha
    // fechada, com o uso estimado (pode ter saido). Nunca olha a mensagem
    // do erro.
    soltarOSinal();
    log.warn("ia_transcricao_falhou", {
      ...idsDoLog(entrada.ids),
      modelo: modelo ?? undefined,
      error_code: "desconhecida",
      attempt: contagem.saidas,
    });
    return falha("desconhecida");
  }
}
