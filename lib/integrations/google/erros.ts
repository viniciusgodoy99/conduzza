import { HOSTS_DO_GOOGLE } from "@/lib/integrations/google/versao";

// Erros do Google e a politica de tentativa (F2.2), compartilhados por
// oauth.ts, conta-de-servico.ts e ads.ts.
//
// Mesmo molde de lib/integrations/meta/insights.ts (Fase 4):
// - criarContexto/pedir com fetch, relogio, espera e sorteio injetaveis;
// - timeout explicito de 15 s por chamada (AbortController), sempre limitado
//   ao prazo total (prazoEm): nenhuma requisicao comeca sem tempo para
//   terminar, e nenhuma espera de retry estoura o prazo;
// - retry LOCAL so em falha transitoria (rede, timeout, 5xx, TRANSIENT_ERROR,
//   INTERNAL_ERROR e afins), com backoff exponencial e jitter. Limite do
//   Google (RESOURCE_EXHAUSTED e afins) so repete aqui quando o proprio
//   Google diz quanto esperar e a espera e curta; senao volta para quem chama
//   reagendar. Erro definitivo (AUTHENTICATION_ERROR, AUTHORIZATION_ERROR,
//   USER_PERMISSION_DENIED, CUSTOMER_NOT_ENABLED, escopo faltando...) nunca
//   repete;
// - o resultado de falha leva so o enum nosso, o nome do enum do Google
//   (validado), o HTTP e o requestId. NUNCA a mensagem do Google (vem em
//   ingles e pode trazer dado da conta), a URL, o corpo nem token;
// - a URL so sai para os hosts de HOSTS_DO_GOOGLE, sem seguir redirecionamento.
//
// Nada aqui escreve log. Quem chama loga so `problema`, `http` e `requestId`.

/** Timeout de cada requisicao, quando quem chama nao passa outro. */
export const TIMEOUT_PADRAO_MS = 15_000;
/** Prazo total padrao, contado a partir de criarContexto. */
export const PRAZO_PADRAO_MS = 30_000;
/** Novas tentativas locais em falha transitoria. */
export const MAX_RETRIES_PADRAO = 2;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_TETO_MS = 8_000;
/** Requisicao com menos tempo que isto ate o prazo nem comeca. */
export const TEMPO_MINIMO_DA_REQUISICAO_MS = 2_000;
/** Limite do Google com espera informada ate isto repete aqui mesmo. */
export const ESPERA_LOCAL_MAXIMA_MS = 10_000;
/** Espera sugerida no limite quando o Google nao diz quanto. */
export const ESPERA_DO_LIMITE_PADRAO_MS = 15 * 60_000;
const ESPERA_DO_LIMITE_MINIMA_MS = 1_000;
const ESPERA_DO_LIMITE_MAXIMA_MS = 24 * 60 * 60_000;

/**
 * Problemas, no vocabulario nosso. Transitorios: google_indisponivel e
 * limite_do_google. O resto e definitivo para esta chamada.
 */
export const PROBLEMAS_GOOGLE = [
  // Transitorios
  "google_indisponivel", // rede, timeout, 5xx, TRANSIENT_ERROR, INTERNAL_ERROR, ABORTED
  "limite_do_google", // RESOURCE_EXHAUSTED, RESOURCE_TEMPORARILY_EXHAUSTED, 429
  // Repetir mais tarde, sem retry local
  "consulta_pesada", // DEADLINE_EXCEEDED (504): dividir a consulta
  "conta_nao_encontrada", // CUSTOMER_NOT_FOUND (conta recem-criada)
  "acesso_expirado", // OAUTH_TOKEN_EXPIRED: renovar o access token
  // Da clinica (pausa a leitura)
  "token_revogado", // invalid_grant, OAUTH_TOKEN_REVOKED, OAUTH_TOKEN_DISABLED
  "credencial_invalida", // AUTHENTICATION_ERROR sem codigo mais especifico, 401
  "exige_verificacao", // TWO_STEP_VERIFICATION_NOT_ENROLLED, ADVANCED_PROTECTION_NOT_ENROLLED
  "sem_permissao", // AUTHORIZATION_ERROR, USER_PERMISSION_DENIED, 403
  "escopo_faltando", // escopo adwords nao concedido, ACCESS_TOKEN_SCOPE_INSUFFICIENT
  "conta_inativa", // CUSTOMER_NOT_ENABLED, INCOMPLETE_SIGNUP
  "conta_de_administrador", // metricas pedidas a uma conta de administrador (MCC)
  // Do sistema (a Conduzza resolve; alerta interno, sem pausar a clinica)
  "projeto_sem_acesso", // CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION, SERVICE_DISABLED...
  "credencial_do_sistema", // chave da conta de servico, invalid_client
  // Convite pela MCC
  "convite_ja_existe", // ja ha convite pendente desta MCC
  "conta_ja_vinculada", // a conta ja esta sob esta MCC (ou na hierarquia dela)
  "vinculo_impossivel", // outro erro de vinculo (limite de gerentes, ciclo...)
  // Da chamada
  "parametro_recusado", // 400, QueryError, RequestError
  "versao_descontinuada", // UNIMPLEMENTED ou 404 (SUPOSICAO, caminhos sao fixos)
  "entrada_invalida", // recusado aqui, antes de chamar o Google
  "resposta_invalida", // corpo fora do formato esperado
  "prazo_esgotado",
  "outro",
] as const;

export type ProblemaGoogle = (typeof PROBLEMAS_GOOGLE)[number];

/**
 * O que quem chama faz com a falha (mesmo vocabulario da Meta):
 * - pausar: problema da conexao da clinica; grava o problema.
 * - reagendar: limite do Google; volta depois de `tentarEmMs`.
 * - repetir: passageiro; o backoff do job tenta de novo.
 * - desistir: repetir nao conserta, e nao e configuracao da clinica.
 */
export type AcaoDaFalha = "pausar" | "reagendar" | "repetir" | "desistir";

const ACAO_DO_PROBLEMA: Record<ProblemaGoogle, AcaoDaFalha> = {
  google_indisponivel: "repetir",
  limite_do_google: "reagendar",
  consulta_pesada: "repetir",
  conta_nao_encontrada: "repetir",
  acesso_expirado: "repetir",
  token_revogado: "pausar",
  credencial_invalida: "pausar",
  exige_verificacao: "pausar",
  sem_permissao: "pausar",
  escopo_faltando: "pausar",
  conta_inativa: "pausar",
  conta_de_administrador: "pausar",
  projeto_sem_acesso: "desistir",
  credencial_do_sistema: "desistir",
  convite_ja_existe: "desistir",
  conta_ja_vinculada: "desistir",
  vinculo_impossivel: "desistir",
  parametro_recusado: "desistir",
  versao_descontinuada: "desistir",
  entrada_invalida: "desistir",
  resposta_invalida: "repetir",
  prazo_esgotado: "repetir",
  outro: "desistir",
};

const TRANSITORIOS: ReadonlySet<ProblemaGoogle> = new Set<ProblemaGoogle>([
  "google_indisponivel",
  "limite_do_google",
]);

export function acaoDoProblema(problema: ProblemaGoogle): AcaoDaFalha {
  return ACAO_DO_PROBLEMA[problema];
}

/** Transitorio: o unico tipo de falha que pode ser repetido localmente. */
export function ehTransitorio(problema: ProblemaGoogle): boolean {
  return TRANSITORIOS.has(problema);
}

export type FalhaGoogle = {
  ok: false;
  problema: ProblemaGoogle;
  acao: AcaoDaFalha;
  transitorio: boolean;
  /** So em limite_do_google: quanto esperar (dica do Google ou 15 min). */
  tentarEmMs: number | null;
  /** Nome do enum do Google (ex.: "USER_PERMISSION_DENIED"), nunca a mensagem. */
  codigoDoGoogle: string | null;
  http: number | null;
  /** request-id do Google, para abrir chamado com eles. */
  requestId: string | null;
};

export function falhaGoogle(
  problema: ProblemaGoogle,
  extra: Partial<
    Pick<FalhaGoogle, "tentarEmMs" | "codigoDoGoogle" | "http" | "requestId">
  > = {},
): FalhaGoogle {
  return {
    ok: false,
    problema,
    acao: acaoDoProblema(problema),
    transitorio: ehTransitorio(problema),
    tentarEmMs:
      extra.tentarEmMs ??
      (problema === "limite_do_google" ? ESPERA_DO_LIMITE_PADRAO_MS : null),
    codigoDoGoogle: extra.codigoDoGoogle ?? null,
    http: extra.http ?? null,
    requestId: extra.requestId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Utilitarios puros
// ---------------------------------------------------------------------------

export function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// Nome de enum do Google: maiusculas na Ads API, minusculas no OAuth.
const NOME_DE_ENUM = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

function nomeDeEnum(valor: unknown): string | null {
  return typeof valor === "string" && NOME_DE_ENUM.test(valor) ? valor : null;
}

/** Espera antes da nova tentativa n (0, 1...): metade fixa, metade sorteada. */
export function esperaDoBackoff(
  tentativa: number,
  aleatorio: () => number,
): number {
  const teto = Math.min(BACKOFF_TETO_MS, BACKOFF_BASE_MS * 2 ** tentativa);
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}

const DURACAO = /^(\d{1,9})(?:\.(\d{1,9}))?s$/;

/**
 * Duracao do Google ("30s", "1.5s" ou {seconds, nanos}) para ms, ou null.
 * E o formato de QuotaErrorDetails.retry_delay e de google.rpc.RetryInfo.
 */
export function esperaDoRetryDelay(valor: unknown): number | null {
  let ms: number | null = null;
  if (typeof valor === "string") {
    const casou = DURACAO.exec(valor);
    if (casou) {
      const fracao = (casou[2] ?? "").padEnd(3, "0").slice(0, 3);
      ms = Number(casou[1]) * 1_000 + Number(fracao);
    }
  } else if (ehObjeto(valor)) {
    const segundos =
      typeof valor.seconds === "string" && /^\d{1,9}$/.test(valor.seconds)
        ? Number(valor.seconds)
        : typeof valor.seconds === "number" && Number.isInteger(valor.seconds)
          ? valor.seconds
          : null;
    const nanos =
      typeof valor.nanos === "number" && Number.isInteger(valor.nanos)
        ? valor.nanos
        : 0;
    if (segundos !== null && segundos >= 0 && nanos >= 0) {
      ms = segundos * 1_000 + Math.floor(nanos / 1_000_000);
    }
  }
  if (ms === null || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return Math.min(
    ESPERA_DO_LIMITE_MAXIMA_MS,
    Math.max(ESPERA_DO_LIMITE_MINIMA_MS, ms),
  );
}

function esperaDoRetryAfter(headers: Headers): number | null {
  const valor = headers.get("retry-after");
  if (!valor || !/^\d{1,6}$/.test(valor.trim())) {
    return null;
  }
  return esperaDoRetryDelay(`${valor.trim()}s`);
}

/** O request-id do Google: cabecalho `request-id` ou o do corpo do erro. */
export function lerRequestId(headers: Headers, corpo: unknown): string | null {
  const doCabecalho = headers.get("request-id");
  if (doCabecalho && REQUEST_ID.test(doCabecalho)) {
    return doCabecalho;
  }
  for (const detalhe of detalhesDoErro(corpo)) {
    if (
      typeof detalhe.requestId === "string" &&
      REQUEST_ID.test(detalhe.requestId)
    ) {
      return detalhe.requestId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classificacao
// ---------------------------------------------------------------------------

/**
 * O envelope do erro. Em REST vem {error:{code,status,details}}; o
 * searchStream manda um array com ele; a documentacao tambem mostra o
 * google.rpc.Status cru ({code,message,details}). Aceita os tres.
 */
function envelopeDoErro(corpo: unknown): Record<string, unknown> | null {
  const base = Array.isArray(corpo) ? corpo[0] : corpo;
  if (!ehObjeto(base)) return null;
  if (ehObjeto(base.error)) return base.error;
  if (Array.isArray(base.details) || typeof base.status === "string")
    return base;
  return null;
}

function detalhesDoErro(corpo: unknown): Record<string, unknown>[] {
  const envelope = envelopeDoErro(corpo);
  if (!envelope || !Array.isArray(envelope.details)) return [];
  return envelope.details.filter(ehObjeto);
}

type CodigoDoAds = { categoria: string; codigo: string };

type LidoDoErro = {
  codigos: CodigoDoAds[];
  motivos: string[];
  status: string | null;
  retryDelayMs: number | null;
};

function lerErroDoAds(corpo: unknown): LidoDoErro {
  const lido: LidoDoErro = {
    codigos: [],
    motivos: [],
    status: null,
    retryDelayMs: null,
  };
  const envelope = envelopeDoErro(corpo);
  if (!envelope) return lido;
  lido.status = nomeDeEnum(envelope.status);
  for (const detalhe of detalhesDoErro(corpo)) {
    // GoogleAdsFailure: errors[].errorCode = { authorizationError: "..." }
    if (Array.isArray(detalhe.errors)) {
      for (const erro of detalhe.errors) {
        if (!ehObjeto(erro)) continue;
        if (ehObjeto(erro.errorCode)) {
          for (const [categoria, codigo] of Object.entries(erro.errorCode)) {
            const nome = nomeDeEnum(codigo);
            if (nome && /^[a-z][A-Za-z]{1,60}$/.test(categoria)) {
              lido.codigos.push({ categoria, codigo: nome });
            }
          }
        }
        const quota =
          ehObjeto(erro.details) && ehObjeto(erro.details.quotaErrorDetails)
            ? erro.details.quotaErrorDetails
            : null;
        const espera = quota ? esperaDoRetryDelay(quota.retryDelay) : null;
        if (espera !== null) {
          lido.retryDelayMs = Math.max(lido.retryDelayMs ?? 0, espera);
        }
      }
    }
    // google.rpc.ErrorInfo
    const motivo = nomeDeEnum(detalhe.reason);
    if (motivo) lido.motivos.push(motivo);
    // google.rpc.RetryInfo
    const espera = esperaDoRetryDelay(detalhe.retryDelay);
    if (espera !== null) {
      lido.retryDelayMs = Math.max(lido.retryDelayMs ?? 0, espera);
    }
  }
  return lido;
}

function comPrefixoDoProjeto(codigo: string): boolean {
  return (
    codigo.startsWith("CLOUD_PROJECT_") ||
    codigo.startsWith("DEVELOPER_TOKEN_") ||
    codigo.startsWith("ORGANIZATION_")
  );
}

/** O problema de cada codigo da Ads API (familia + nome), ou null. */
function problemaDoCodigoDoAds({
  categoria,
  codigo,
}: CodigoDoAds): ProblemaGoogle | null {
  switch (categoria) {
    case "authenticationError":
      if (codigo === "OAUTH_TOKEN_EXPIRED") return "acesso_expirado";
      if (
        codigo === "OAUTH_TOKEN_REVOKED" ||
        codigo === "OAUTH_TOKEN_DISABLED" ||
        codigo === "GOOGLE_ACCOUNT_DELETED"
      ) {
        return "token_revogado";
      }
      if (
        codigo === "TWO_STEP_VERIFICATION_NOT_ENROLLED" ||
        codigo === "ADVANCED_PROTECTION_NOT_ENROLLED"
      ) {
        return "exige_verificacao";
      }
      if (codigo === "NOT_ADS_USER") return "sem_permissao";
      if (codigo === "CUSTOMER_NOT_FOUND") return "conta_nao_encontrada";
      if (comPrefixoDoProjeto(codigo)) return "projeto_sem_acesso";
      if (
        codigo.startsWith("CLIENT_CUSTOMER_ID_") ||
        codigo.startsWith("LOGIN_CUSTOMER_ID_")
      ) {
        return "parametro_recusado";
      }
      return "credencial_invalida";
    case "authorizationError":
      if (codigo === "CUSTOMER_NOT_ENABLED" || codigo === "INCOMPLETE_SIGNUP") {
        return "conta_inativa";
      }
      if (
        codigo === "PROJECT_DISABLED" ||
        codigo === "MISSING_TOS" ||
        codigo === "SERVICE_ACCESS_DENIED" ||
        codigo === "ACCESS_DENIED_FOR_ACCOUNT_TYPE" ||
        codigo === "METRIC_ACCESS_DENIED" ||
        comPrefixoDoProjeto(codigo)
      ) {
        return "projeto_sem_acesso";
      }
      return "sem_permissao";
    case "quotaError":
      return codigo === "ACCESS_PROHIBITED"
        ? "projeto_sem_acesso"
        : "limite_do_google";
    case "internalError":
      return codigo === "DEADLINE_EXCEEDED"
        ? "consulta_pesada"
        : "google_indisponivel";
    case "databaseError":
      return codigo === "CONCURRENT_MODIFICATION"
        ? "google_indisponivel"
        : null;
    case "queryError":
      return codigo === "REQUESTED_METRICS_FOR_MANAGER"
        ? "conta_de_administrador"
        : "parametro_recusado";
    case "requestError":
    case "headerError":
    case "fieldError":
    case "fieldMaskError":
    case "mutateError":
    case "distinctError":
    case "rangeError":
    case "stringFormatError":
    case "stringLengthError":
      return "parametro_recusado";
    case "customerClientLinkError":
      if (codigo === "CLIENT_ALREADY_INVITED_BY_THIS_MANAGER")
        return "convite_ja_existe";
      if (codigo === "CLIENT_ALREADY_MANAGED_IN_HIERARCHY")
        return "conta_ja_vinculada";
      return "vinculo_impossivel";
    case "managerLinkError":
      if (codigo === "ALREADY_INVITED_BY_THIS_MANAGER")
        return "convite_ja_existe";
      if (
        codigo === "ALREADY_MANAGED_BY_THIS_MANAGER" ||
        codigo === "ALREADY_MANAGED_IN_HIERARCHY"
      ) {
        return "conta_ja_vinculada";
      }
      return "vinculo_impossivel";
    default:
      return null;
  }
}

const PROBLEMA_DO_MOTIVO: Readonly<Record<string, ProblemaGoogle>> = {
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: "escopo_faltando",
  ACCESS_TOKEN_EXPIRED: "acesso_expirado",
  ACCESS_TOKEN_TYPE_UNSUPPORTED: "credencial_invalida",
  CREDENTIALS_MISSING: "credencial_invalida",
  SERVICE_DISABLED: "projeto_sem_acesso",
  BILLING_DISABLED: "projeto_sem_acesso",
  CONSUMER_INVALID: "projeto_sem_acesso",
  USER_PROJECT_DENIED: "projeto_sem_acesso",
  RATE_LIMIT_EXCEEDED: "limite_do_google",
  RESOURCE_EXHAUSTED: "limite_do_google",
};

const PROBLEMA_DO_STATUS: Readonly<Record<string, ProblemaGoogle>> = {
  UNAVAILABLE: "google_indisponivel",
  INTERNAL: "google_indisponivel",
  ABORTED: "google_indisponivel",
  DEADLINE_EXCEEDED: "consulta_pesada",
  RESOURCE_EXHAUSTED: "limite_do_google",
  UNAUTHENTICATED: "credencial_invalida",
  PERMISSION_DENIED: "sem_permissao",
  INVALID_ARGUMENT: "parametro_recusado",
  FAILED_PRECONDITION: "parametro_recusado",
  OUT_OF_RANGE: "parametro_recusado",
  UNIMPLEMENTED: "versao_descontinuada",
  NOT_FOUND: "versao_descontinuada",
};

function problemaDoHttp(http: number): ProblemaGoogle {
  if (http === 429) return "limite_do_google";
  if (http === 504) return "consulta_pesada";
  if (http >= 500 || http === 409 || http === 408) return "google_indisponivel";
  if (http === 401) return "credencial_invalida";
  if (http === 403) return "sem_permissao";
  if (http === 404 || http === 501) return "versao_descontinuada";
  if (http === 400) return "parametro_recusado";
  return "outro";
}

function montarFalha(
  problema: ProblemaGoogle,
  http: number,
  codigoDoGoogle: string | null,
  corpo: unknown,
  headers: Headers,
  retryDelayMs: number | null,
): FalhaGoogle {
  return falhaGoogle(problema, {
    http,
    codigoDoGoogle,
    requestId: lerRequestId(headers, corpo),
    tentarEmMs:
      problema === "limite_do_google"
        ? (retryDelayMs ??
          esperaDoRetryAfter(headers) ??
          ESPERA_DO_LIMITE_PADRAO_MS)
        : null,
  });
}

/**
 * Classifica a resposta de erro da Google Ads API (REST). Ordem: o codigo da
 * GoogleAdsFailure (mais especifico), o motivo do ErrorInfo, o status do
 * google.rpc e, por fim, o HTTP. A mensagem do Google nunca e lida.
 */
export function classificarErroAds(
  http: number,
  corpo: unknown,
  headers: Headers,
): FalhaGoogle {
  const lido = lerErroDoAds(corpo);
  for (const codigo of lido.codigos) {
    const problema = problemaDoCodigoDoAds(codigo);
    if (problema) {
      return montarFalha(
        problema,
        http,
        codigo.codigo,
        corpo,
        headers,
        lido.retryDelayMs,
      );
    }
  }
  for (const motivo of lido.motivos) {
    const problema = PROBLEMA_DO_MOTIVO[motivo];
    if (problema) {
      return montarFalha(
        problema,
        http,
        motivo,
        corpo,
        headers,
        lido.retryDelayMs,
      );
    }
  }
  const doStatus = lido.status ? PROBLEMA_DO_STATUS[lido.status] : undefined;
  const problema = doStatus ?? problemaDoHttp(http);
  const codigo = lido.codigos[0]?.codigo ?? lido.motivos[0] ?? lido.status;
  return montarFalha(problema, http, codigo, corpo, headers, lido.retryDelayMs);
}

const PROBLEMA_DO_ERRO_OAUTH: Readonly<Record<string, ProblemaGoogle>> = {
  invalid_grant: "token_revogado",
  invalid_token: "token_revogado",
  invalid_client: "credencial_do_sistema",
  unauthorized_client: "credencial_do_sistema",
  invalid_scope: "escopo_faltando",
  access_denied: "sem_permissao",
  admin_policy_enforced: "sem_permissao",
  invalid_request: "parametro_recusado",
  unsupported_grant_type: "parametro_recusado",
  temporarily_unavailable: "google_indisponivel",
  server_error: "google_indisponivel",
};

/**
 * Classifica a resposta de erro de oauth2.googleapis.com (token e revoke):
 * {error:"invalid_grant", error_description:"..."}. A descricao nunca e
 * lida. Se vier no formato da Google API ({error:{status}}), usa a mesma
 * leitura da Ads API. invalid_grant aqui e "token revogado" (refresh token);
 * a conta de servico remapeia para credencial_do_sistema.
 */
export function classificarErroOAuth(
  http: number,
  corpo: unknown,
  headers: Headers,
): FalhaGoogle {
  const codigo = ehObjeto(corpo) ? nomeDeEnum(corpo.error) : null;
  if (codigo) {
    const problema =
      PROBLEMA_DO_ERRO_OAUTH[codigo] ??
      (http === 401 ? "credencial_do_sistema" : problemaDoHttp(http));
    return montarFalha(problema, http, codigo, corpo, headers, null);
  }
  if (envelopeDoErro(corpo)) {
    return classificarErroAds(http, corpo, headers);
  }
  const problema =
    http === 401 ? "credencial_do_sistema" : problemaDoHttp(http);
  return montarFalha(problema, http, null, corpo, headers, null);
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

export type OpcoesDeChamada = {
  /** Instante (ms, no relogio de `agora`) em que tudo acaba. Padrao: 30 s. */
  prazoEm?: number;
  /** Timeout de cada requisicao (padrao 15 s), sempre limitado ao prazo. */
  timeoutMs?: number;
  /** Novas tentativas locais em falha transitoria (padrao 2). */
  maxRetries?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
};

export type Contexto = {
  prazoEm: number;
  timeoutMs: number;
  maxRetries: number;
  fetchFn: typeof fetch;
  agora: () => number;
  dormir: (ms: number) => Promise<void>;
  aleatorio: () => number;
};

export function criarContexto(opcoes: OpcoesDeChamada = {}): Contexto {
  const agora = opcoes.agora ?? Date.now;
  return {
    prazoEm: opcoes.prazoEm ?? agora() + PRAZO_PADRAO_MS,
    timeoutMs: opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS,
    maxRetries: opcoes.maxRetries ?? MAX_RETRIES_PADRAO,
    fetchFn: opcoes.fetchFn ?? fetch,
    agora,
    dormir:
      opcoes.dormir ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    aleatorio: opcoes.aleatorio ?? Math.random,
  };
}

export type RequisicaoGoogle = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  corpo?: string;
};

export type RespostaGoogle = {
  ok: true;
  http: number;
  /** JSON da resposta, ou null quando veio vazia. */
  corpo: unknown;
  requestId: string | null;
};

export type Classificador = (
  http: number,
  corpo: unknown,
  headers: Headers,
) => FalhaGoogle;

function urlPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      HOSTS_DO_GOOGLE.has(u.hostname) &&
      u.port === "" &&
      u.username === "" &&
      u.password === ""
    );
  } catch {
    return false;
  }
}

async function umaChamada(
  ctx: Contexto,
  req: RequisicaoGoogle,
  timeoutMs: number,
  classificar: Classificador,
): Promise<RespostaGoogle | FalhaGoogle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let recebida: { status: number; headers: Headers; texto: string } | null =
    null;
  try {
    const resposta = await ctx.fetchFn(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.corpo !== undefined ? { body: req.corpo } : {}),
      signal: controller.signal,
      cache: "no-store",
      // Redirecionamento levaria o Authorization junto: nunca seguir.
      redirect: "error",
    });
    recebida = {
      status: resposta.status,
      headers: resposta.headers,
      texto: await resposta.text(),
    };
  } catch {
    // Sem resposta: nosso timer (abort), rede ou redirecionamento recusado.
    return falhaGoogle("google_indisponivel");
  } finally {
    clearTimeout(timer);
  }

  let corpo: unknown = null;
  let jsonInvalido = false;
  if (recebida.texto.trim() !== "") {
    try {
      corpo = JSON.parse(recebida.texto) as unknown;
    } catch {
      jsonInvalido = true;
    }
  }
  if (recebida.status >= 200 && recebida.status < 300) {
    const requestId = lerRequestId(recebida.headers, null);
    if (jsonInvalido) {
      return falhaGoogle("resposta_invalida", {
        http: recebida.status,
        requestId,
      });
    }
    return { ok: true, http: recebida.status, corpo, requestId };
  }
  return classificar(recebida.status, corpo, recebida.headers);
}

/**
 * Uma requisicao ao Google com timeout, prazo e retry local so em falha
 * transitoria. `maxRetries` sobrepoe o do contexto (a troca de code usa 0).
 */
export async function pedir(
  ctx: Contexto,
  req: RequisicaoGoogle,
  classificar: Classificador,
  opcoes: { maxRetries?: number } = {},
): Promise<RespostaGoogle | FalhaGoogle> {
  if (!urlPermitida(req.url)) {
    return falhaGoogle("entrada_invalida");
  }
  const maxRetries = opcoes.maxRetries ?? ctx.maxRetries;
  for (let tentativa = 0; ; tentativa += 1) {
    const restante = ctx.prazoEm - ctx.agora();
    if (restante < TEMPO_MINIMO_DA_REQUISICAO_MS) {
      return falhaGoogle("prazo_esgotado");
    }
    const resultado = await umaChamada(
      ctx,
      req,
      Math.min(ctx.timeoutMs, restante),
      classificar,
    );
    if (resultado.ok || !resultado.transitorio || tentativa >= maxRetries) {
      return resultado;
    }
    let espera: number;
    if (resultado.problema === "limite_do_google") {
      // So repete aqui com espera curta informada; senao quem chama reagenda.
      if (
        resultado.tentarEmMs === null ||
        resultado.tentarEmMs > ESPERA_LOCAL_MAXIMA_MS
      ) {
        return resultado;
      }
      espera = resultado.tentarEmMs;
      if (ctx.agora() + espera + TEMPO_MINIMO_DA_REQUISICAO_MS > ctx.prazoEm) {
        return resultado;
      }
    } else {
      espera = esperaDoBackoff(tentativa, ctx.aleatorio);
      if (ctx.agora() + espera + TEMPO_MINIMO_DA_REQUISICAO_MS > ctx.prazoEm) {
        return falhaGoogle("prazo_esgotado", {
          http: resultado.http,
          codigoDoGoogle: resultado.codigoDoGoogle,
          requestId: resultado.requestId,
        });
      }
    }
    await ctx.dormir(espera);
  }
}
