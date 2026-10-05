// Substituto de "@anthropic-ai/sdk" em TODOS os testes (alias exato nas
// configs do vitest: unidade, integracao e RLS). Guarda da Fase 3: nenhum
// teste chama a Anthropic, nem por engano, nem com chave no ambiente.
//
// O construtor lanca. As classes de erro sao equivalentes as do SDK (mesmos
// nomes, mesma heranca, mesmos campos), para os testes de classificacao de
// erro construirem o erro que o SDK lancaria. Subcaminhos como
// "@anthropic-ai/sdk/helpers/zod" NAO passam por aqui: continuam reais, e
// nao fazem rede.

export const MENSAGEM_DA_GUARDA =
  "Teste tentou criar um cliente da Anthropic. Nenhum teste chama a API: injete um cliente falso.";

export class AnthropicError extends Error {}

export class APIError extends AnthropicError {
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  readonly error: unknown;
  readonly requestID: string | null | undefined;
  readonly type: string | null;

  constructor(
    status: number | undefined,
    error: unknown,
    message: string | undefined,
    headers: Headers | undefined,
    type?: string | null,
  ) {
    super(message ?? "(sem mensagem)");
    this.status = status;
    this.error = error;
    this.headers = headers;
    this.requestID = headers?.get("request-id");
    this.type = type ?? null;
  }
}

export class APIUserAbortError extends APIError {
  constructor({ message }: { message?: string } = {}) {
    super(undefined, undefined, message ?? "Request was aborted.", undefined);
  }
}

export class APIConnectionError extends APIError {
  constructor({ message }: { message?: string; cause?: Error } = {}) {
    super(undefined, undefined, message ?? "Connection error.", undefined);
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}

export class RetryableError extends AnthropicError {}
export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

export class Anthropic {
  static AnthropicError = AnthropicError;
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

export default Anthropic;
