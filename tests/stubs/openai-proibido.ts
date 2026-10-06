// Substituto de "openai" em TODOS os testes (alias exato nas configs do
// vitest: unidade, integracao e RLS). Guarda da Fase 3: nenhum teste chama a
// OpenAI, nem por engano, nem com chave no ambiente.
//
// Todo construtor de cliente lanca (OpenAI, AzureOpenAI, BedrockOpenAI). As
// classes de erro sao equivalentes as do SDK 7.x (mesmos nomes, mesma
// heranca, mesmo construtor e os mesmos campos: status, headers, error,
// code, param, type, requestID), para os testes de classificacao de erro
// construirem o erro que o SDK lancaria. Subcaminhos como
// "openai/helpers/zod" NAO passam por aqui: continuam reais, e nao fazem
// rede.

export const MENSAGEM_DA_GUARDA =
  "Teste tentou criar um cliente da OpenAI. Nenhum teste chama a API: injete um cliente falso.";

export class OpenAIError extends Error {}

export class APIError extends OpenAIError {
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  readonly error: object | undefined;
  readonly code: string | null | undefined;
  readonly param: string | null | undefined;
  readonly type: string | undefined;
  readonly requestID: string | null | undefined;

  constructor(
    status: number | undefined,
    error: object | undefined,
    message: string | undefined,
    headers: Headers | undefined,
  ) {
    super(message ?? "(sem mensagem)");
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("x-request-id");
    this.error = error;
    const dados = error as Record<string, unknown> | undefined;
    this.code = dados?.code as string | null | undefined;
    this.param = dados?.param as string | null | undefined;
    this.type = dados?.type as string | undefined;
  }
}

export class APIUserAbortError extends APIError {
  constructor({ message }: { message?: string } = {}) {
    super(undefined, undefined, message ?? "Request was aborted.", undefined);
  }
}

export class APIConnectionError extends APIError {
  constructor({ message }: { message?: string; cause?: Error }) {
    super(undefined, undefined, message ?? "Connection error.", undefined);
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

export class LengthFinishReasonError extends OpenAIError {}
export class ContentFilterFinishReasonError extends OpenAIError {}
export class InvalidWebhookSignatureError extends Error {}

export class OpenAI {
  static OpenAIError = OpenAIError;
  static APIError = APIError;
  static APIUserAbortError = APIUserAbortError;
  static APIConnectionError = APIConnectionError;
  static APIConnectionTimeoutError = APIConnectionTimeoutError;
  static BadRequestError = BadRequestError;
  static AuthenticationError = AuthenticationError;
  static PermissionDeniedError = PermissionDeniedError;
  static NotFoundError = NotFoundError;
  static ConflictError = ConflictError;
  static UnprocessableEntityError = UnprocessableEntityError;
  static RateLimitError = RateLimitError;
  static InternalServerError = InternalServerError;

  constructor() {
    throw new Error(MENSAGEM_DA_GUARDA);
  }
}

export class AzureOpenAI extends OpenAI {}
export class BedrockOpenAI extends OpenAI {}

export default OpenAI;
