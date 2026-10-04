import {
  classificarErroOAuth,
  criarContexto,
  ehObjeto,
  falhaGoogle,
  pedir,
  type Contexto,
  type FalhaGoogle,
  type OpcoesDeChamada,
} from "@/lib/integrations/google/erros";
import {
  GOOGLE_ADS_SCOPE,
  GOOGLE_CONSENT_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
} from "@/lib/integrations/google/versao";

// OAuth web do Google para o modo "login" (F2b), em fetch puro.
//
// Fatos (developers.google.com/identity/protocols/oauth2/web-server e
// google-ads/api/docs/oauth/internals, conferidos no levantamento):
// - access_type=offline e obrigatorio para receber refresh token; o refresh
//   token so volta na primeira autorizacao, a menos que se use
//   prompt=consent. Por isso os dois vao sempre.
// - A pessoa pode desmarcar escopos: o escopo concedido e conferido na troca.
// - Acesso por tempo limitado devolve refresh_token_expires_in: o vencimento
//   volta para quem chama guardar e avisar a clinica.
// - O access token vale 3.600 s e nunca e gravado.
//
// Credenciais (client id, client secret) chegam por parametro: quem chama le
// das variaveis de ambiente do servidor. O `state` tambem vem de quem chama
// (gerado e conferido na rota, com a tabela oauth_estado e o cookie).
// Nada aqui loga; o resultado de falha nunca leva code, token nem descricao
// do Google.

export type ClienteOAuth = {
  clientId: string;
  clientSecret: string;
  /** Endereco de retorno exato, igual ao cadastrado no Google Cloud. */
  redirectUri: string;
};

export type TokensDoConsentimento = {
  accessToken: string;
  /** Instante (ms) em que o access token vence. */
  accessTokenExpiraEm: number;
  refreshToken: string;
  /**
   * So no acesso por tempo limitado (refresh_token_expires_in): instante
   * (ms) em que o refresh token deixa de valer. null quando nao vence.
   */
  refreshTokenExpiraEm: number | null;
  escopos: string[];
};

export type AcessoRenovado = {
  ok: true;
  accessToken: string;
  expiraEm: number;
  /** Escopos informados na renovacao (null quando o Google nao repetiu). */
  escopos: string[] | null;
  refreshTokenExpiraEm: number | null;
};

const CLIENT_ID_VALIDO = /^[A-Za-z0-9._-]{8,200}$/;
// Segredo, code e tokens: so ASCII visivel (vao em formulario e cabecalho).
const SEGREDO_VALIDO = /^[\x21-\x7e]{8,512}$/;
const CODE_VALIDO = /^[\x21-\x7e]{10,2048}$/;
const TOKEN_VALIDO = /^[\x21-\x7e]{20,4096}$/;
const REFRESH_TOKEN_VALIDO = /^[\x21-\x7e]{10,2048}$/;
// state com pelo menos 128 bits em base64url (22 caracteres).
const STATE_VALIDO = /^[A-Za-z0-9_-]{22,512}$/;
const VALIDADE_MAXIMA_S = 366 * 24 * 60 * 60;

function redirectValido(valor: string): boolean {
  try {
    const u = new URL(valor);
    if (u.hash !== "" || u.username !== "" || u.password !== "") return false;
    if (u.protocol === "https:") return true;
    // Excecao do Google para desenvolvimento local.
    return (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function segundosValidos(valor: unknown): number | null {
  const n =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && /^\d{1,9}$/.test(valor)
        ? Number(valor)
        : null;
  return n !== null && Number.isInteger(n) && n > 0 && n <= VALIDADE_MAXIMA_S
    ? n
    : null;
}

/** Os escopos de um campo `scope` (separados por espaco), sem repeticao. */
export function escoposConcedidos(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return [...new Set(scope.split(/\s+/).filter((s) => s.length > 0))];
}

/** Confere se o escopo da Google Ads API veio entre os concedidos. */
export function conferirEscopo(scope: unknown): {
  concedeAds: boolean;
  escopos: string[];
} {
  const escopos = escoposConcedidos(scope);
  return { concedeAds: escopos.includes(GOOGLE_ADS_SCOPE), escopos };
}

/**
 * URL da tela de consentimento: response_type=code, escopo adwords (mais
 * openid e email quando `pedirEmail`), access_type=offline, prompt=consent e
 * o `state` de quem chama. Recusa (entrada_invalida) client id, endereco de
 * retorno ou state fora do formato.
 */
export function montarUrlDeConsentimento(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  pedirEmail?: boolean;
}): { ok: true; url: string } | FalhaGoogle {
  if (
    !CLIENT_ID_VALIDO.test(params.clientId) ||
    !redirectValido(params.redirectUri) ||
    !STATE_VALIDO.test(params.state)
  ) {
    return falhaGoogle("entrada_invalida");
  }
  const escopos = params.pedirEmail
    ? ["openid", "email", GOOGLE_ADS_SCOPE]
    : [GOOGLE_ADS_SCOPE];
  const url = new URL(GOOGLE_CONSENT_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", escopos.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return { ok: true, url: url.toString() };
}

// ---------------------------------------------------------------------------
// Endpoint de token (compartilhado com a conta de servico)
// ---------------------------------------------------------------------------

/**
 * POST de formulario em oauth2.googleapis.com/token. Devolve o corpo JSON
 * (objeto) ou a falha classificada. Exportado para conta-de-servico.ts.
 */
export async function pedirTokenAoGoogle(
  ctx: Contexto,
  campos: Record<string, string>,
  opcoes: { maxRetries?: number } = {},
): Promise<
  | { ok: true; corpo: Record<string, unknown>; requestId: string | null }
  | FalhaGoogle
> {
  const resposta = await pedir(
    ctx,
    {
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      corpo: new URLSearchParams(campos).toString(),
    },
    classificarErroOAuth,
    opcoes,
  );
  if (!resposta.ok) {
    return resposta;
  }
  if (!ehObjeto(resposta.corpo)) {
    return falhaGoogle("resposta_invalida", {
      http: resposta.http,
      requestId: resposta.requestId,
    });
  }
  return { ok: true, corpo: resposta.corpo, requestId: resposta.requestId };
}

/** access_token e expires_in de uma resposta de token, ou null. */
export function lerAccessToken(
  corpo: Record<string, unknown>,
  agoraMs: number,
): { accessToken: string; expiraEm: number } | null {
  const token = corpo.access_token;
  const segundos = segundosValidos(corpo.expires_in);
  const tipo = corpo.token_type;
  if (
    typeof token !== "string" ||
    !TOKEN_VALIDO.test(token) ||
    segundos === null ||
    (tipo !== undefined &&
      (typeof tipo !== "string" || tipo.toLowerCase() !== "bearer"))
  ) {
    return null;
  }
  return { accessToken: token, expiraEm: agoraMs + segundos * 1_000 };
}

function vencimentoDoRefreshToken(
  corpo: Record<string, unknown>,
  agoraMs: number,
): number | null | "invalido" {
  if (corpo.refresh_token_expires_in === undefined) return null;
  const segundos = segundosValidos(corpo.refresh_token_expires_in);
  return segundos === null ? "invalido" : agoraMs + segundos * 1_000;
}

function clienteValido(cliente: {
  clientId: string;
  clientSecret: string;
}): boolean {
  return (
    CLIENT_ID_VALIDO.test(cliente.clientId) &&
    SEGREDO_VALIDO.test(cliente.clientSecret)
  );
}

// ---------------------------------------------------------------------------
// Entradas publicas
// ---------------------------------------------------------------------------

/**
 * Troca o `code` do retorno por tokens (grant_type=authorization_code).
 * UMA tentativa so: o code e de uso unico, e repetir depois de uma resposta
 * perdida devolveria invalid_grant, que pareceria token revogado.
 * Confere o escopo concedido (escopo_faltando quando o adwords foi
 * desmarcado) e exige o refresh token (prompt=consent garante que ele vem).
 */
export async function trocarCodigoPorTokens(
  cliente: ClienteOAuth,
  code: string,
  opcoes: OpcoesDeChamada = {},
): Promise<{ ok: true; tokens: TokensDoConsentimento } | FalhaGoogle> {
  if (
    !clienteValido(cliente) ||
    !redirectValido(cliente.redirectUri) ||
    !CODE_VALIDO.test(code)
  ) {
    return falhaGoogle("entrada_invalida");
  }
  const ctx = criarContexto(opcoes);
  const resposta = await pedirTokenAoGoogle(
    ctx,
    {
      grant_type: "authorization_code",
      code,
      client_id: cliente.clientId,
      client_secret: cliente.clientSecret,
      redirect_uri: cliente.redirectUri,
    },
    { maxRetries: 0 },
  );
  if (!resposta.ok) {
    return resposta;
  }
  const agoraMs = ctx.agora();
  const acesso = lerAccessToken(resposta.corpo, agoraMs);
  const refreshToken = resposta.corpo.refresh_token;
  const vencimento = vencimentoDoRefreshToken(resposta.corpo, agoraMs);
  if (
    !acesso ||
    typeof refreshToken !== "string" ||
    !REFRESH_TOKEN_VALIDO.test(refreshToken) ||
    vencimento === "invalido"
  ) {
    return falhaGoogle("resposta_invalida", { requestId: resposta.requestId });
  }
  const escopo = conferirEscopo(resposta.corpo.scope);
  if (!escopo.concedeAds) {
    return falhaGoogle("escopo_faltando", { requestId: resposta.requestId });
  }
  return {
    ok: true,
    tokens: {
      accessToken: acesso.accessToken,
      accessTokenExpiraEm: acesso.expiraEm,
      refreshToken,
      refreshTokenExpiraEm: vencimento,
      escopos: escopo.escopos,
    },
  };
}

/**
 * Novo access token pelo refresh token (grant_type=refresh_token), com retry
 * local so em falha transitoria. invalid_grant vira token_revogado (pessoa
 * revogou, 6 meses sem uso, acesso por tempo limitado vencido, teto de 100
 * tokens por conta). Se o Google informar o escopo e ele nao tiver mais o
 * adwords, devolve escopo_faltando.
 */
export async function renovarAcesso(
  cliente: { clientId: string; clientSecret: string },
  refreshToken: string,
  opcoes: OpcoesDeChamada = {},
): Promise<AcessoRenovado | FalhaGoogle> {
  if (!clienteValido(cliente)) {
    return falhaGoogle("entrada_invalida");
  }
  if (!REFRESH_TOKEN_VALIDO.test(refreshToken)) {
    return falhaGoogle("token_revogado");
  }
  const ctx = criarContexto(opcoes);
  const resposta = await pedirTokenAoGoogle(ctx, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cliente.clientId,
    client_secret: cliente.clientSecret,
  });
  if (!resposta.ok) {
    return resposta;
  }
  const agoraMs = ctx.agora();
  const acesso = lerAccessToken(resposta.corpo, agoraMs);
  const vencimento = vencimentoDoRefreshToken(resposta.corpo, agoraMs);
  if (!acesso || vencimento === "invalido") {
    return falhaGoogle("resposta_invalida", { requestId: resposta.requestId });
  }
  let escopos: string[] | null = null;
  if (resposta.corpo.scope !== undefined) {
    const escopo = conferirEscopo(resposta.corpo.scope);
    if (!escopo.concedeAds) {
      return falhaGoogle("escopo_faltando", { requestId: resposta.requestId });
    }
    escopos = escopo.escopos;
  }
  return {
    ok: true,
    accessToken: acesso.accessToken,
    expiraEm: acesso.expiraEm,
    escopos,
    refreshTokenExpiraEm: vencimento,
  };
}

/**
 * Revoga o refresh token (ou o access token) em oauth2.googleapis.com/revoke,
 * com o token no corpo do formulario (nunca na URL). Token ja invalido
 * (400 invalid_token) conta como revogado: jaEstavaInvalido = true.
 */
export async function revogarToken(
  token: string,
  opcoes: OpcoesDeChamada = {},
): Promise<{ ok: true; jaEstavaInvalido: boolean } | FalhaGoogle> {
  if (!REFRESH_TOKEN_VALIDO.test(token) && !TOKEN_VALIDO.test(token)) {
    return falhaGoogle("entrada_invalida");
  }
  const ctx = criarContexto(opcoes);
  const resposta = await pedir(
    ctx,
    {
      url: GOOGLE_REVOKE_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      corpo: new URLSearchParams({ token }).toString(),
    },
    classificarErroOAuth,
  );
  if (resposta.ok) {
    return { ok: true, jaEstavaInvalido: false };
  }
  if (resposta.http === 400 && resposta.codigoDoGoogle === "invalid_token") {
    return { ok: true, jaEstavaInvalido: true };
  }
  return resposta;
}
