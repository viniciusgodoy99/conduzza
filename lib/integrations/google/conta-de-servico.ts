import { createPrivateKey, sign, type KeyObject } from "node:crypto";

import {
  criarContexto,
  ehObjeto,
  falhaGoogle,
  type FalhaGoogle,
  type OpcoesDeChamada,
} from "@/lib/integrations/google/erros";
import {
  lerAccessToken,
  pedirTokenAoGoogle,
} from "@/lib/integrations/google/oauth";
import {
  GOOGLE_ADS_SCOPE,
  GOOGLE_TOKEN_URL,
} from "@/lib/integrations/google/versao";

// Conta de servico da Conduzza (modo "administrador", F2): JWT RS256
// assinado com node:crypto (sem dependencia nova) e trocado por access token
// em oauth2.googleapis.com/token (grant_type jwt-bearer).
//
// Fato (developers.google.com/identity/protocols/oauth2/service-account):
// cabecalho {"alg":"RS256","typ":"JWT","kid"}, claims iss (e-mail da conta),
// scope, aud = endpoint de token, iat e exp de no maximo 1 hora.
// A conta de servico e usuaria na MCC da Conduzza (sem delegacao de dominio,
// sem `sub`).
//
// A chave vem de quem chama (variavel GOOGLE_SERVICE_ACCOUNT_JSON, lida no
// servidor), fica num KeyObject (JSON.stringify dele da "{}", entao nem um
// log acidental do objeto vaza a chave) e nunca vai para o banco.
// O token_uri do arquivo e ignorado: o endpoint e sempre o fixo.
//
// Cache em memoria por instancia, por (e-mail, id da chave, escopo), ate
// MARGEM_DE_RENOVACAO_MS antes do vencimento. Pedidos simultaneos dividem a
// mesma troca (a primeira chamada define fetch e prazo dessa troca).
// Qualquer falha definitiva da troca e problema do SISTEMA
// (credencial_do_sistema): chave apagada, assinatura recusada, relogio, escopo.

/** Renova o token quando falta menos que isto para vencer. */
export const MARGEM_DE_RENOVACAO_MS = 5 * 60_000;
/** Validade pedida no JWT (o Google aceita no maximo 1 hora). */
export const VALIDADE_DO_JWT_S = 3_600;
const GRANT_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

const EMAIL_DA_CONTA =
  /^[A-Za-z0-9._%+-]{1,128}@[A-Za-z0-9.-]{1,128}\.gserviceaccount\.com$/;
const ID_DA_CHAVE = /^[A-Za-z0-9]{8,128}$/;

export type ChaveDaContaDeServico = {
  email: string;
  idDaChave: string | null;
  chavePrivada: KeyObject;
};

export type TokenDaContaDeServico = {
  ok: true;
  accessToken: string;
  expiraEm: number;
  doCache: boolean;
};

type Entrada = { accessToken: string; expiraEm: number };

export type CacheDeToken = {
  entradas: Map<string, Entrada>;
  emVoo: Map<string, Promise<TokenDaContaDeServico | FalhaGoogle>>;
};

export function criarCacheDeToken(): CacheDeToken {
  return { entradas: new Map(), emVoo: new Map() };
}

const CACHE_PADRAO = criarCacheDeToken();

function base64url(dados: Buffer | string): string {
  const bytes = typeof dados === "string" ? Buffer.from(dados, "utf8") : dados;
  return bytes.toString("base64url");
}

/**
 * Le o JSON da chave da conta de servico. Falha sempre como
 * credencial_do_sistema, sem repetir nada do conteudo.
 */
export function lerChaveDaContaDeServico(
  json: string,
): { ok: true; chave: ChaveDaContaDeServico } | FalhaGoogle {
  let dados: unknown;
  try {
    dados = JSON.parse(json) as unknown;
  } catch {
    return falhaGoogle("credencial_do_sistema");
  }
  if (!ehObjeto(dados) || dados.type !== "service_account") {
    return falhaGoogle("credencial_do_sistema");
  }
  const email = dados.client_email;
  const pem = dados.private_key;
  const idDaChave = dados.private_key_id;
  if (
    typeof email !== "string" ||
    !EMAIL_DA_CONTA.test(email) ||
    typeof pem !== "string" ||
    !pem.includes("PRIVATE KEY") ||
    (idDaChave !== undefined &&
      (typeof idDaChave !== "string" || !ID_DA_CHAVE.test(idDaChave)))
  ) {
    return falhaGoogle("credencial_do_sistema");
  }
  // Colada na Vercel, a quebra de linha as vezes chega como "\n" literal.
  const pemNormalizado = pem.includes("\n") ? pem : pem.replace(/\\n/g, "\n");
  let chavePrivada: KeyObject;
  try {
    chavePrivada = createPrivateKey(pemNormalizado);
  } catch {
    return falhaGoogle("credencial_do_sistema");
  }
  if (chavePrivada.asymmetricKeyType !== "rsa") {
    return falhaGoogle("credencial_do_sistema");
  }
  return {
    ok: true,
    chave: {
      email,
      idDaChave: typeof idDaChave === "string" ? idDaChave : null,
      chavePrivada,
    },
  };
}

/** O JWT RS256 que a conta de servico troca por access token. */
export function montarJwtDaContaDeServico(
  chave: ChaveDaContaDeServico,
  params: { agoraMs: number; escopo?: string },
): string {
  const iat = Math.floor(params.agoraMs / 1_000);
  const cabecalho = {
    alg: "RS256",
    typ: "JWT",
    ...(chave.idDaChave ? { kid: chave.idDaChave } : {}),
  };
  const claims = {
    iss: chave.email,
    scope: params.escopo ?? GOOGLE_ADS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + VALIDADE_DO_JWT_S,
  };
  const entrada = `${base64url(JSON.stringify(cabecalho))}.${base64url(JSON.stringify(claims))}`;
  const assinatura = sign("sha256", Buffer.from(entrada), chave.chavePrivada);
  return `${entrada}.${base64url(assinatura)}`;
}

function chaveDoCache(chave: ChaveDaContaDeServico, escopo: string): string {
  return `${chave.email}|${chave.idDaChave ?? ""}|${escopo}`;
}

async function trocarJwt(
  chave: ChaveDaContaDeServico,
  escopo: string,
  opcoes: OpcoesDeChamada,
  cache: CacheDeToken,
  chaveCache: string,
): Promise<TokenDaContaDeServico | FalhaGoogle> {
  const ctx = criarContexto(opcoes);
  const jwt = montarJwtDaContaDeServico(chave, {
    agoraMs: ctx.agora(),
    escopo,
  });
  const resposta = await pedirTokenAoGoogle(ctx, {
    grant_type: GRANT_JWT,
    assertion: jwt,
  });
  if (!resposta.ok) {
    if (
      resposta.transitorio ||
      resposta.problema === "prazo_esgotado" ||
      resposta.problema === "resposta_invalida" ||
      resposta.problema === "entrada_invalida"
    ) {
      return resposta;
    }
    // invalid_grant aqui nao e "clinica revogou": e a chave ou o relogio da
    // Conduzza. Tudo que e definitivo vira problema do sistema.
    return falhaGoogle("credencial_do_sistema", {
      http: resposta.http,
      codigoDoGoogle: resposta.codigoDoGoogle,
      requestId: resposta.requestId,
    });
  }
  const acesso = lerAccessToken(resposta.corpo, ctx.agora());
  if (!acesso) {
    return falhaGoogle("resposta_invalida", { requestId: resposta.requestId });
  }
  cache.entradas.set(chaveCache, acesso);
  return {
    ok: true,
    accessToken: acesso.accessToken,
    expiraEm: acesso.expiraEm,
    doCache: false,
  };
}

/**
 * Access token da conta de servico, do cache quando ainda vale por mais de
 * MARGEM_DE_RENOVACAO_MS, ou trocando um JWT novo.
 */
export async function obterTokenDaContaDeServico(
  chave: ChaveDaContaDeServico,
  opcoes: OpcoesDeChamada & { escopo?: string; cache?: CacheDeToken } = {},
): Promise<TokenDaContaDeServico | FalhaGoogle> {
  const {
    escopo = GOOGLE_ADS_SCOPE,
    cache = CACHE_PADRAO,
    ...chamada
  } = opcoes;
  const agora = chamada.agora ?? Date.now;
  const chaveCache = chaveDoCache(chave, escopo);
  const guardada = cache.entradas.get(chaveCache);
  if (guardada && guardada.expiraEm - agora() > MARGEM_DE_RENOVACAO_MS) {
    return {
      ok: true,
      accessToken: guardada.accessToken,
      expiraEm: guardada.expiraEm,
      doCache: true,
    };
  }
  const emVoo = cache.emVoo.get(chaveCache);
  if (emVoo) {
    return emVoo;
  }
  const troca = trocarJwt(chave, escopo, chamada, cache, chaveCache).finally(
    () => {
      cache.emVoo.delete(chaveCache);
    },
  );
  cache.emVoo.set(chaveCache, troca);
  return troca;
}

/**
 * Esquece o token guardado (a Ads API respondeu acesso_expirado ou
 * credencial_invalida com ele): a proxima chamada troca um JWT novo.
 */
export function invalidarTokenDaContaDeServico(
  chave: ChaveDaContaDeServico,
  opcoes: { escopo?: string; cache?: CacheDeToken } = {},
): void {
  const cache = opcoes.cache ?? CACHE_PADRAO;
  cache.entradas.delete(chaveDoCache(chave, opcoes.escopo ?? GOOGLE_ADS_SCOPE));
}
