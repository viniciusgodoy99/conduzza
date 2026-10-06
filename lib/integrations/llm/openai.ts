// Cliente unico da OpenAI (SDK oficial "openai", Responses API) e a
// classificacao dos erros dele. Provedor do agente de IA desde 05/10/2026
// (decisao do dono: troca de provedor para ficar mais barato).
// Pesquisa oficial de 05/10/2026 resumida em docs/03_arquitetura.md, secao 14.
//
// Regras deste arquivo (plano de seguranca 2.3, CLAUDE.md 4):
//  - Chave sempre explicita (OPENAI_API_KEY, projeto producao-agente). Sem
//    chave, nao ha cliente (null): quem chama trata como falha fechada.
//    organization, project, adminAPIKey e webhookSecret vao null de
//    proposito: sem isso o SDK leria OPENAI_ORG_ID, OPENAI_PROJECT_ID,
//    OPENAI_ADMIN_KEY e OPENAI_WEBHOOK_SECRET do ambiente. UAZAPI_OPENAI_KEY
//    (transcricao pela uazapi) nunca e lida aqui.
//  - URL da OpenAI fixa no codigo: uma OPENAI_BASE_URL no ambiente nao desvia
//    conversa de paciente para outro servidor. Regiao de processamento
//    (dataResidency) e decisao pendente do dono; enquanto isso, Global.
//  - OPENAI_CUSTOM_HEADERS no ambiente: o SDK poria esses cabecalhos POR CIMA
//    dos nossos, inclusive Authorization, OpenAI-Organization e
//    OpenAI-Project (client.js do SDK 7.28), trocando a chave ou o projeto
//    sem passar por este arquivo. Com ela presente, nao ha cliente (a fabrica
//    devolve null e criarClienteOpenAi lanca). Segunda trava: o fetch do
//    cliente reescreve Authorization com a nossa chave e apaga
//    OpenAI-Organization e OpenAI-Project antes de cada envio.
//  - Timeout e maxRetries explicitos (o padrao do SDK e 10 minutos e 2
//    tentativas). Cada chamada ainda passa o proprio prazo.
//  - Log do SDK desligado (logLevel "off" e logger mudo): OPENAI_LOG=debug
//    registraria o corpo da requisicao, com texto de paciente.
//  - 429 de cobranca ou cota (credito acabou, limite de gasto do projeto ou
//    da organizacao) NAO e repetido: tentar de novo nao devolve o acesso. O
//    fetch do cliente marca a resposta com x-should-retry: false (o SDK
//    obedece) e a classificacao trata como grave (conta para o desligamento).
//  - Erro classificado pelas classes tipadas do SDK e por codigos de lista
//    fechada, nunca pela mensagem. error.message pode ecoar conteudo: nao vai
//    para log em hipotese alguma. O id da requisicao (x-request-id) pode ir,
//    conferido por formato (idDaRequisicao).
//
// Toda chamada usa store: false (a OpenAI guardaria a resposta por 30 dias
// no painel). Proibido com dado de paciente: Conversations,
// previous_response_id, Files, Vector Stores, Evals, Batch, /v1/agents e o
// Agents SDK.
//
// Nos testes, "openai" (so o nome exato) e trocado por
// tests/stubs/openai-proibido.ts (alias nas configs do vitest): o construtor
// lanca, entao nenhum teste chama a OpenAI de verdade. E, por qualquer
// caminho de import (inclusive "openai/client"), o fetch dos testes recusa
// host da OpenAI ou da Anthropic (tests/setup/sem-rede-de-llm.ts).

import { createHmac } from "node:crypto";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { z } from "zod";

import type { MotivoDaFalha } from "@/lib/domain/conformidade/veredicto";
import { log } from "@/lib/log";

const URL_DA_OPENAI = "https://api.openai.com/v1";

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

/**
 * 429 de cobranca ou cota, pelo error.code da API (guia de erros da OpenAI,
 * 05/10/2026). error.type pode vir "insufficient_quota" nos mesmos casos.
 */
export const CODIGOS_DE_COTA: ReadonlySet<string> = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);
const TIPO_DE_COTA = "insufficient_quota";

type Fetch = typeof fetch;

type Ambiente = Readonly<Record<string, string | undefined>>;

/**
 * Variavel que o SDK le no construtor e cujos cabecalhos ele poe por cima
 * dos nossos (Authorization inclusive). Presente e nao vazia, nao ha cliente.
 */
export const VARIAVEL_DE_CABECALHOS_EXTRAS = "OPENAI_CUSTOM_HEADERS";

/**
 * O ambiente traz cabecalhos extras para o SDK? Vazio ou so espacos nao
 * conta (o SDK tambem ignora, porque apara o valor).
 */
export function haCabecalhosExtras(env: Ambiente): boolean {
  return (env[VARIAVEL_DE_CABECALHOS_EXTRAS] ?? "").trim() !== "";
}

/**
 * Embrulha o fetch do cliente: antes de cada envio, Authorization volta a
 * ser a NOSSA chave e OpenAI-Organization e OpenAI-Project saem (o projeto
 * e o da chave, producao-agente). Vale para qualquer origem do cabecalho:
 * ambiente, opcao do construtor ou opcao por chamada.
 */
export function fetchComCabecalhosFixos(base: Fetch, apiKey: string): Fetch {
  const autorizacao = `Bearer ${apiKey}`;
  return (entrada, opcoes) => {
    const cabecalhos = new Headers(
      opcoes?.headers ??
        (entrada instanceof Request ? entrada.headers : undefined),
    );
    cabecalhos.set("authorization", autorizacao);
    cabecalhos.delete("openai-organization");
    cabecalhos.delete("openai-project");
    return base(entrada, { ...opcoes, headers: cabecalhos });
  };
}

/**
 * fetch global lido na hora de cada envio (nao na criacao do cliente): nos
 * testes, a trava de rede de tests/setup vale mesmo para um cliente criado
 * antes de um fetch falso ser desfeito.
 */
const fetchGlobal: Fetch = (entrada, opcoes) =>
  globalThis.fetch(entrada, opcoes);

/**
 * Embrulha o fetch do cliente: um 429 de cobranca ou cota volta com
 * x-should-retry: false, e o SDK nao repete. Le so o JSON de erro de um 429
 * (nunca registra nada) e devolve o mesmo status e corpo.
 */
export function fetchQueNaoRepeteCota(base: Fetch): Fetch {
  return async (entrada, opcoes) => {
    const resposta = await base(entrada, opcoes);
    if (resposta.status !== 429) {
      return resposta;
    }
    const corpo = await resposta.text().catch(() => "");
    const cabecalhos = new Headers(resposta.headers);
    if (eCota(corpo)) {
      cabecalhos.set("x-should-retry", "false");
    }
    return new Response(corpo, {
      status: resposta.status,
      statusText: resposta.statusText,
      headers: cabecalhos,
    });
  };
}

function eCota(corpo: string): boolean {
  try {
    const lido: unknown = JSON.parse(corpo);
    const erro =
      typeof lido === "object" && lido !== null && "error" in lido
        ? (lido as { error: unknown }).error
        : null;
    if (typeof erro !== "object" || erro === null) {
      return false;
    }
    const { code, type } = erro as { code?: unknown; type?: unknown };
    return (
      (typeof code === "string" && CODIGOS_DE_COTA.has(code)) ||
      type === TIPO_DE_COTA
    );
  } catch {
    return false;
  }
}

export function criarClienteOpenAi(opcoes: {
  apiKey: string;
  timeoutMs?: number;
}): OpenAI {
  const apiKey = opcoes.apiKey.trim();
  if (apiKey === "") {
    throw new Error("Chave da OpenAI ausente.");
  }
  // O SDK le o process.env de verdade, entao a conferencia e nele.
  if (haCabecalhosExtras(process.env)) {
    throw new Error(
      `${VARIAVEL_DE_CABECALHOS_EXTRAS} definida no ambiente: cliente da OpenAI recusado.`,
    );
  }
  return new OpenAI({
    apiKey,
    organization: null,
    project: null,
    adminAPIKey: null,
    webhookSecret: null,
    baseURL: URL_DA_OPENAI,
    timeout: opcoes.timeoutMs ?? PRAZO_PADRAO_DO_CLIENTE_MS,
    maxRetries: TENTATIVAS_EXTRAS,
    logLevel: "off",
    logger: LOGGER_MUDO,
    fetch: fetchQueNaoRepeteCota(fetchComCabecalhosFixos(fetchGlobal, apiKey)),
  });
}

/**
 * Cliente com a OPENAI_API_KEY do ambiente, ou null sem ela. Tambem null com
 * OPENAI_CUSTOM_HEADERS presente (no env recebido ou no process.env, que e o
 * que o SDK le), com log.error para quem opera saber por que a IA nao
 * responde. Nao confere se a IA esta ligada (isso e de lib/ia/liberacao.ts):
 * so monta o cliente.
 */
export function clienteOpenAiDoAmbiente(
  env: Ambiente = process.env,
): OpenAI | null {
  const chave = env.OPENAI_API_KEY?.trim();
  if (!chave) {
    return null;
  }
  if (haCabecalhosExtras(env) || haCabecalhosExtras(process.env)) {
    log.error("ia_cliente_recusado", {
      provider: "openai",
      error_code: "cabecalhos_extras_no_ambiente",
    });
    return null;
  }
  return criarClienteOpenAi({ apiKey: chave });
}

// ---------------------------------------------------------------------------
// Modelo do agente (E2): so a configuracao, nada chama o agente ainda
// ---------------------------------------------------------------------------

/**
 * Lista fechada do agente, com o esforco de raciocinio de cada um.
 * gpt-6-luna e o padrao (o mais barato; o esforco padrao dele e "medium",
 * entao fica fixado em "low"). gpt-6.1-sol e a alternativa (nao aceita
 * "none": devolve 400). A escolha final depende da bateria de conformidade
 * com o modelo real (docs/05, Fase 3).
 */
export const MODELOS_DO_AGENTE = {
  "gpt-6-luna": { esforco: "low" },
  "gpt-6.1-sol": { esforco: "low" },
} as const;

export type ModeloDoAgente = keyof typeof MODELOS_DO_AGENTE;

export const MODELO_PADRAO_DO_AGENTE: ModeloDoAgente = "gpt-6-luna";

/**
 * Modelo do agente pelo ambiente (IA_MODELO_AGENTE). Vazio usa o padrao;
 * fora da lista devolve null, e o agente sem modelo nao responde (escala).
 */
export function modeloDoAgente(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModeloDoAgente | null {
  const valor = env.IA_MODELO_AGENTE?.trim();
  if (!valor) {
    return MODELO_PADRAO_DO_AGENTE;
  }
  // Lista de chaves explicita: "toString" in {} seria true.
  return (Object.keys(MODELOS_DO_AGENTE) as string[]).includes(valor)
    ? (valor as ModeloDoAgente)
    : null;
}

/**
 * Parametros fixos de toda chamada do agente. store false sempre; com
 * raciocinio ligado, o item de raciocinio volta cifrado
 * (reasoning.encrypted_content) para o historico ir inteiro na proxima
 * chamada sem guardar nada na OpenAI. Sem temperature (com raciocinio a API
 * recusa) e service_tier "default" (o preco de llm_preco e o Standard).
 */
export function parametrosFixosDoAgente(modelo: ModeloDoAgente) {
  return {
    model: modelo,
    reasoning: { effort: MODELOS_DO_AGENTE[modelo].esforco },
    include: ["reasoning.encrypted_content"],
    store: false,
    service_tier: "default",
  } as const;
}

// ---------------------------------------------------------------------------
// Identificador de seguranca e chave de cache (nenhum dado de paciente)
// ---------------------------------------------------------------------------

/** Segredo do HMAC: abaixo disto, o ambiente esta mal configurado. */
const TAMANHO_MINIMO_DO_SEGREDO = 32;

/**
 * safety_identifier da OpenAI: HMAC-SHA256 de clinic_id e contact_id com
 * IA_SEGREDO_DO_IDENTIFICADOR (64 caracteres hex, o maximo da API). Nunca o
 * telefone. Estavel por contato, entao um bloqueio da OpenAI por abuso cai
 * so naquele contato, nao na organizacao inteira. Sem segredo valido,
 * devolve null: quem chama decide (o agente do E2 trata como configuracao
 * invalida).
 */
export function identificadorDeSeguranca(entrada: {
  clinicId: string;
  contactId: string;
  segredo: string | null | undefined;
}): string | null {
  const segredo = entrada.segredo?.trim() ?? "";
  if (segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    return null;
  }
  return createHmac("sha256", segredo)
    .update(
      `${entrada.clinicId.toLowerCase()}:${entrada.contactId.toLowerCase()}`,
      "utf8",
    )
    .digest("hex");
}

/** IA_SEGREDO_DO_IDENTIFICADOR do ambiente (null se ausente). */
export function segredoDoIdentificador(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return env.IA_SEGREDO_DO_IDENTIFICADOR?.trim() || null;
}

/**
 * prompt_cache_key por clinica: separa a contabilidade do cache e impede
 * sondagem de cache entre clinicas. So o papel e a id da clinica.
 */
export function chaveDeCacheDaClinica(
  papel: "agente" | "verificador" | "classificador",
  clinicId: string,
): string {
  return `conduzza:${papel}:${clinicId.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Classificacao dos erros
// ---------------------------------------------------------------------------

/**
 * error.code e error.type da API que podem ir para log (lista fechada, do
 * guia de erros da OpenAI). Qualquer outra coisa vira null.
 */
const CODIGOS_DE_ERRO_DA_API: ReadonlySet<string> = new Set([
  ...CODIGOS_DE_COTA,
  "rate_limit_exceeded",
  "slow_down",
  "server_is_overloaded",
  "invalid_request_error",
  "rate_limit_error",
  "insufficient_quota",
  "service_unavailable_error",
]);

export type ErroClassificado = {
  motivo: MotivoDaFalha;
  httpStatus: number | null;
  /** error.code (ou error.type) da API, so se for um dos conhecidos. */
  codigo: string | null;
  /**
   * Erro de configuracao ou de cota (400, 401, 403, 404, 429 de cobranca):
   * nao melhora tentando de novo, vai para log.error e conta para o
   * desligamento automatico.
   */
  grave: boolean;
  /** x-request-id da resposta de erro (idDaRequisicao), ou null. */
  requestId: string | null;
};

/** Formato aceito para o id da requisicao (a OpenAI usa "req_" e hex). */
const FORMATO_DO_ID_DA_REQUISICAO = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Id da requisicao na OpenAI pronto para log (chave request_id): o
 * requestID do erro ou o _request_id da resposta. Qualquer coisa fora do
 * formato vira null; nunca e corpo nem mensagem.
 */
export function idDaRequisicao(valor: unknown): string | null {
  return typeof valor === "string" && FORMATO_DO_ID_DA_REQUISICAO.test(valor)
    ? valor
    : null;
}

function codigoDe(erro: APIError): string | null {
  for (const valor of [erro.code, erro.type]) {
    if (typeof valor === "string" && CODIGOS_DE_ERRO_DA_API.has(valor)) {
      return valor;
    }
  }
  return null;
}

function statusDe(erro: APIError): number | null {
  return typeof erro.status === "number" ? erro.status : null;
}

/** O 429 e de cobranca ou cota (credito, limite de gasto, limite de uso)? */
export function eErroDeCota(erro: unknown): boolean {
  return (
    erro instanceof APIError &&
    ((typeof erro.code === "string" && CODIGOS_DE_COTA.has(erro.code)) ||
      erro.type === TIPO_DE_COTA)
  );
}

/**
 * Classifica um erro lancado pelo SDK sem ler a mensagem dele, com o id da
 * requisicao quando a API respondeu.
 */
export function classificarErroDoLlm(erro: unknown): ErroClassificado {
  return {
    ...classificarSemId(erro),
    requestId: erro instanceof APIError ? idDaRequisicao(erro.requestID) : null,
  };
}

/**
 * Ordem do mais especifico para o mais geral (timeout e subclasse de
 * conexao, que e subclasse de APIError).
 */
function classificarSemId(erro: unknown): Omit<ErroClassificado, "requestId"> {
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
    // Cota (credito, limite de gasto ou de uso): falha de credencial, nao de
    // ritmo, com motivo proprio. "limite" fica so para o 429 de ritmo.
    const cota = eErroDeCota(erro);
    return {
      motivo: cota ? "cota" : "limite",
      httpStatus: 429,
      codigo: codigoDe(erro),
      grave: cota,
    };
  }
  if (erro instanceof InternalServerError) {
    const status = statusDe(erro);
    const codigo = codigoDe(erro);
    return {
      motivo:
        status === 503 || codigo === "server_is_overloaded"
          ? "sobrecarga"
          : "servidor",
      httpStatus: status,
      codigo,
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
  if (
    erro instanceof OpenAIError ||
    erro instanceof SyntaxError ||
    erro instanceof z.core.$ZodError
  ) {
    // Fora do HTTP: na pratica, saida estruturada que nao e JSON
    // (SyntaxError) ou nao bateu com o esquema (o helpers/zod lanca o erro
    // do proprio zod).
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
