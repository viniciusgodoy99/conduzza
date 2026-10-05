// Cliente unico da Anthropic (SDK oficial @anthropic-ai/sdk) e a
// classificacao dos erros dele.
//
// Regras deste arquivo (plano de seguranca 2.3, CLAUDE.md 4):
//  - Chave sempre explicita. Sem chave, nao ha cliente (null): quem chama
//    trata como falha fechada. O SDK, sem apiKey, procuraria credencial em
//    arquivo de configuracao e em outras variaveis; aqui isso nao acontece.
//  - URL da Anthropic fixa no codigo: uma ANTHROPIC_BASE_URL no ambiente nao
//    desvia conversa de paciente para outro servidor.
//  - Timeout e maxRetries explicitos (o padrao do SDK e 10 minutos e 2
//    tentativas). Cada chamada ainda passa o proprio prazo.
//  - Log do SDK desligado (logLevel "off" e logger mudo): ANTHROPIC_LOG=debug
//    registraria o corpo da requisicao, com texto de paciente.
//  - Erro classificado pelas classes tipadas do SDK, nunca pela mensagem.
//    error.message pode ecoar conteudo: nao vai para log em hipotese alguma.
//
// Nos testes, "@anthropic-ai/sdk" e trocado por tests/stubs/anthropic-proibido.ts
// (alias nas configs do vitest): o construtor lanca, entao nenhum teste
// chama a Anthropic de verdade.

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import type { MotivoDaFalha } from "@/lib/domain/conformidade/veredicto";

const URL_DA_ANTHROPIC = "https://api.anthropic.com";

/** Prazo padrao de uma requisicao (o de cada chamada pode ser menor). */
export const PRAZO_PADRAO_DO_CLIENTE_MS = 25_000;
/** Uma nova tentativa no maximo (o prazo do job e curto). */
export const TENTATIVAS_EXTRAS = 1;

const LOGGER_MUDO = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

export function criarClienteAnthropic(opcoes: {
  apiKey: string;
  timeoutMs?: number;
}): Anthropic {
  const apiKey = opcoes.apiKey.trim();
  if (apiKey === "") {
    throw new Error("Chave da Anthropic ausente.");
  }
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: URL_DA_ANTHROPIC,
    timeout: opcoes.timeoutMs ?? PRAZO_PADRAO_DO_CLIENTE_MS,
    maxRetries: TENTATIVAS_EXTRAS,
    logLevel: "off",
    logger: LOGGER_MUDO,
  });
}

/**
 * Cliente com a ANTHROPIC_API_KEY do ambiente, ou null sem ela. Nao confere
 * se a IA esta ligada (isso e de lib/ia/liberacao.ts): so monta o cliente.
 */
export function clienteAnthropicDoAmbiente(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Anthropic | null {
  const chave = env.ANTHROPIC_API_KEY?.trim();
  if (!chave) {
    return null;
  }
  return criarClienteAnthropic({ apiKey: chave });
}

/** error.type da API (enum fechado); qualquer outra coisa vira null. */
const TIPOS_DE_ERRO_DA_API = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "timeout_error",
  "overloaded_error",
  "api_error",
  "billing_error",
]);

export type ErroClassificado = {
  motivo: MotivoDaFalha;
  httpStatus: number | null;
  /** error.type da API, so se for um dos conhecidos. */
  codigo: string | null;
  /**
   * Erro de configuracao (400, 401, 403, 404): nao melhora tentando de novo,
   * vai para log.error e conta para o desligamento automatico.
   */
  grave: boolean;
};

/**
 * Classifica um erro lancado pelo SDK sem ler a mensagem dele. Ordem do
 * mais especifico para o mais geral (timeout e subclasse de conexao, que e
 * subclasse de APIError).
 */
export function classificarErroDoLlm(erro: unknown): ErroClassificado {
  const codigoDe = (e: APIError): string | null =>
    typeof e.type === "string" && TIPOS_DE_ERRO_DA_API.has(e.type)
      ? e.type
      : null;
  const statusDe = (e: APIError): number | null =>
    typeof e.status === "number" ? e.status : null;

  if (erro instanceof APIUserAbortError) {
    return { motivo: "abortado", httpStatus: null, codigo: null, grave: false };
  }
  if (erro instanceof APIConnectionTimeoutError) {
    return { motivo: "timeout", httpStatus: null, codigo: null, grave: false };
  }
  if (erro instanceof APIConnectionError) {
    return { motivo: "conexao", httpStatus: null, codigo: null, grave: false };
  }
  if (erro instanceof BadRequestError) {
    return {
      motivo: "requisicao_invalida",
      httpStatus: 400,
      codigo: codigoDe(erro),
      grave: true,
    };
  }
  if (erro instanceof AuthenticationError) {
    return {
      motivo: "autenticacao",
      httpStatus: 401,
      codigo: codigoDe(erro),
      grave: true,
    };
  }
  if (erro instanceof PermissionDeniedError) {
    return {
      motivo: "permissao",
      httpStatus: 403,
      codigo: codigoDe(erro),
      grave: true,
    };
  }
  if (erro instanceof NotFoundError) {
    return {
      motivo: "nao_encontrado",
      httpStatus: 404,
      codigo: codigoDe(erro),
      grave: true,
    };
  }
  if (erro instanceof RateLimitError) {
    return {
      motivo: "limite",
      httpStatus: 429,
      codigo: codigoDe(erro),
      grave: false,
    };
  }
  if (erro instanceof InternalServerError) {
    const status = statusDe(erro);
    return {
      motivo: status === 529 ? "sobrecarga" : "servidor",
      httpStatus: status,
      codigo: codigoDe(erro),
      grave: false,
    };
  }
  if (erro instanceof APIError) {
    return {
      motivo: "outro_http",
      httpStatus: statusDe(erro),
      codigo: codigoDe(erro),
      grave: false,
    };
  }
  if (erro instanceof AnthropicError) {
    // Erro do proprio SDK fora do HTTP: na pratica, saida estruturada que
    // nao bateu com o esquema (helpers/zod lanca AnthropicError).
    return {
      motivo: "saida_invalida",
      httpStatus: null,
      codigo: null,
      grave: false,
    };
  }
  return {
    motivo: "desconhecida",
    httpStatus: null,
    codigo: null,
    grave: false,
  };
}
