// Gasto da IA reservado ANTES do turno e acertado no fim (revisao de
// 06/10/2026, achados 7, 15 e 21). Sem a reserva, o teto diario so via o
// gasto dos turnos que ja tinham terminado: turnos em paralelo passavam
// todos pela trava e o teto estourava em N vezes o custo de um turno.
//
// Contrato com o banco (migration 20261006150000, SO service role):
//  - reservar_gasto_da_ia(p_clinic_id, p_origem, p_custo_microdolar): sob
//    trava por clinica, confere a soma das ultimas 24 horas MAIS o pedido
//    contra o teto e grava uma linha de reserva em ia_uso; devolve o id, ou
//    NULL quando passaria do teto;
//  - acertar_gasto_da_ia(p_reserva, p_linhas): apaga a reserva e grava as
//    linhas reais (o formato de linhasDoUso). Reserva nao acertada (processo
//    morreu no meio) continua contando no teto: conservador.
//
// A reserva e o custo MAXIMO do turno, com contas que so erram para cima:
// cada byte do texto conta como um token (o tokenizador por bytes nunca
// gera mais tokens que bytes), toda rodada gasta o teto de saida, a entrada
// cresce a cada rodada com a saida anterior e a maior resposta possivel da
// ferramenta, e o token de entrada custa o maior preco entre entrada comum,
// cache lido e cache gravado.
//
// Chamada abortada (prazo, erro de rede, resposta sem usage) tambem entra no
// acerto, com a estimativa daqui: a OpenAI pode ter cobrado a chamada que o
// motor desistiu de esperar. Nada de texto em log: so ids, codigos e somas.

import type { SupabaseClient } from "@supabase/supabase-js";

import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import type {
  MotivoDaFalha,
  UsoDoLlm,
} from "@/lib/domain/conformidade/veredicto";
import {
  MAX_TOKENS_DO_CLASSIFICADOR,
  montarEnvelopeDeEntrada,
  POLITICA_DO_CLASSIFICADOR,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  MAX_TOKENS_DO_VERIFICADOR,
  montarEnvelope,
  POLITICA_DO_VERIFICADOR,
} from "@/lib/integrations/llm/verificador";
import { log } from "@/lib/log";

import {
  linhasDoUso,
  precoDoModelo,
  type OrigemDoUso,
  type PrecoDoModelo,
  type UsoDoModelo,
} from "./uso";

/**
 * Tokens que nao estao no texto: papeis, separadores, o esquema da saida
 * estruturada e as definicoes das ferramentas que a API acrescenta.
 */
export const FOLGA_DA_CHAMADA = 1_024;

/** Um nonce do tamanho do real (24 hex), so para medir o envelope. */
const NONCE_DE_MEDIDA = "0".repeat(24);

/** Bytes de um codigo de ponto no pior caso (UTF-8). */
const BYTES_POR_CARACTERE = 4;

/**
 * Teto de tokens de um texto: os bytes em UTF-8. Um tokenizador por bytes
 * (o da OpenAI) junta bytes em tokens e nunca gera mais tokens que bytes.
 */
export function tokensNoMaximo(texto: string): number {
  return Buffer.byteLength(texto, "utf8");
}

function usoDeEstimativa(entrada: number, saida: number): UsoDoLlm {
  return {
    tokensEntrada: Math.max(0, Math.ceil(entrada)),
    tokensSaida: Math.max(0, Math.ceil(saida)),
    tokensCacheLidos: 0,
    tokensCacheGravados: 0,
  };
}

/** O maximo de uma chamada do classificador de entrada. */
export function usoEstimadoDoClassificador(
  mensagens: readonly string[],
): UsoDoLlm {
  return usoDeEstimativa(
    tokensNoMaximo(POLITICA_DO_CLASSIFICADOR) +
      tokensNoMaximo(
        montarEnvelopeDeEntrada({ mensagens, nonce: NONCE_DE_MEDIDA }),
      ) +
      FOLGA_DA_CHAMADA,
    MAX_TOKENS_DO_CLASSIFICADOR,
  );
}

/**
 * O maximo de uma chamada do verificador. rascunho null = o pior caso (o
 * maior texto que o filtro deixa chegar ao verificador).
 */
export function usoEstimadoDoVerificador(
  rascunho: string | null,
  mensagensDoPaciente: readonly string[],
): UsoDoLlm {
  const envelope = montarEnvelope({
    rascunho: rascunho ?? "",
    mensagensDoPaciente,
    nonce: NONCE_DE_MEDIDA,
  });
  return usoDeEstimativa(
    tokensNoMaximo(POLITICA_DO_VERIFICADOR) +
      tokensNoMaximo(envelope) +
      (rascunho === null ? LIMITE_DO_RASCUNHO * BYTES_POR_CARACTERE : 0) +
      FOLGA_DA_CHAMADA,
    MAX_TOKENS_DO_VERIFICADOR,
  );
}

/**
 * O maximo de uma rodada do agente: tudo que vai no corpo (instrucoes,
 * historico com as rodadas anteriores, ferramentas e formato) e o teto de
 * saida.
 */
export function usoEstimadoDaRodada(
  corpo: unknown,
  maxTokensDeSaida: number,
): UsoDoLlm {
  let tamanho: number;
  try {
    tamanho = tokensNoMaximo(JSON.stringify(corpo) ?? "");
  } catch {
    tamanho = 0;
  }
  return usoDeEstimativa(tamanho + FOLGA_DA_CHAMADA, maxTokensDeSaida);
}

/**
 * Motivos de falha em que a chamada certamente nao foi cobrada: nem saiu
 * (sem cliente, modelo ou identificador; sem prazo; contexto truncado) ou a
 * API recusou antes de processar (400, 401, 403, 404). O resto (prazo
 * estourado, rede, 429 depois de uma tentativa, 5xx, saida sem usage) pode
 * ter sido cobrado e entra com a estimativa.
 */
const MOTIVOS_SEM_COBRANCA: ReadonlySet<string> = new Set<MotivoDaFalha>([
  "sem_cliente",
  "modelo_invalido",
  "requisicao_invalida",
  "autenticacao",
  "permissao",
  "nao_encontrado",
  "prazo",
  "contexto_truncado",
]);

export function chamadaPodeTerSidoCobrada(motivo: unknown): boolean {
  return !(typeof motivo === "string" && MOTIVOS_SEM_COBRANCA.has(motivo));
}

/**
 * Teto do custo de uma chamada, em microdolar: a entrada pelo maior preco
 * de entrada (comum, cache lido ou gravado) e a saida pelo preco de saida.
 * null so quando nao ha preco nenhum (quem chama falha fechado).
 */
export function custoMaximoDaChamada(
  uso: UsoDoLlm,
  modelo: string,
  precos: readonly PrecoDoModelo[],
): number | null {
  const achado = precoDoModelo(precos, modelo);
  if (achado === null) {
    return null;
  }
  const { preco } = achado;
  const porTokenDeEntrada = Math.max(
    preco.entrada,
    preco.cacheLeitura,
    preco.cacheEscrita,
  );
  const entrada =
    uso.tokensEntrada + uso.tokensCacheLidos + uso.tokensCacheGravados;
  return Math.ceil(
    (entrada * porTokenDeEntrada + uso.tokensSaida * preco.saida) / 1_000_000,
  );
}

export type ReservaDoGasto =
  { tipo: "reservado"; id: string } | { tipo: "teto" } | { tipo: "erro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reserva o custo maximo do turno (reservar_gasto_da_ia, service role).
 * "teto": passaria do teto de hoje, nada pode ser chamado. "erro": nao deu
 * para conferir (falha fechada). Nunca lanca.
 */
export async function reservarGasto(
  admin: SupabaseClient,
  entrada: {
    clinicId: string;
    origem: OrigemDoUso;
    custoMicrodolar: number;
  },
): Promise<ReservaDoGasto> {
  const custo = Math.ceil(entrada.custoMicrodolar);
  if (!Number.isSafeInteger(custo) || custo < 0) {
    return { tipo: "erro" };
  }
  try {
    const { data, error } = await admin.rpc("reservar_gasto_da_ia", {
      p_clinic_id: entrada.clinicId,
      p_origem: entrada.origem,
      p_custo_microdolar: custo,
    });
    if (error) {
      log.warn("ia_reserva_falhou", {
        clinic_id: entrada.clinicId,
        error_code: (error as { code?: string }).code ?? null,
      });
      return { tipo: "erro" };
    }
    if (data === null) {
      return { tipo: "teto" };
    }
    return typeof data === "string" && UUID.test(data)
      ? { tipo: "reservado", id: data }
      : { tipo: "erro" };
  } catch {
    log.warn("ia_reserva_falhou", {
      clinic_id: entrada.clinicId,
      error_code: "desconhecida",
    });
    return { tipo: "erro" };
  }
}

/**
 * Troca a reserva pelas linhas reais, uma por chamada (acertar_gasto_da_ia,
 * service role). Sem nenhuma chamada, so solta a reserva. Erro: a reserva
 * fica (ela e maior que o gasto real, o teto continua certo) e vira
 * log.warn. Nunca lanca.
 */
export async function acertarGasto(
  admin: SupabaseClient,
  entrada: {
    reservaId: string;
    clinicId: string;
    origem: OrigemDoUso;
    usos: readonly UsoDoModelo[];
    precos: readonly PrecoDoModelo[];
  },
): Promise<boolean> {
  try {
    const { linhas, semPreco } = linhasDoUso({
      clinicId: entrada.clinicId,
      origem: entrada.origem,
      usos: entrada.usos,
      precos: entrada.precos,
    });
    for (const modelo of new Set(semPreco)) {
      log.warn("ia_preco_ausente", { clinic_id: entrada.clinicId, modelo });
    }
    const { error } = await admin.rpc("acertar_gasto_da_ia", {
      p_reserva: entrada.reservaId,
      p_linhas: linhas,
    });
    if (error) {
      log.warn("ia_uso_nao_acertado", {
        clinic_id: entrada.clinicId,
        count: linhas.length,
        error_code: (error as { code?: string }).code ?? null,
      });
      return false;
    }
    return true;
  } catch {
    log.warn("ia_uso_nao_acertado", {
      clinic_id: entrada.clinicId,
      count: entrada.usos.length,
      error_code: "desconhecida",
    });
    return false;
  }
}
