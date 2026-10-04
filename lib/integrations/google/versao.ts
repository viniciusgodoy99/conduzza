// Versao da Google Ads API e enderecos do Google, num lugar so (F2.2).
//
// Calendario (developers.google.com/google-ads/api/docs/sunset-dates,
// conferido em 04/10/2026): a v25 saiu em 22/07/2026 e cai em agosto de 2027;
// a v26 esta prevista para outubro de 2026. Versao menor (v25.2) atualiza o
// mesmo endereco; versao maior troca o endereco, entao a troca e so aqui.
//
// O developer token acabou em 09/09/2026 ("optional and ignored", e o Google
// promete recusa-lo numa versao maior futura): nenhum arquivo desta pasta
// manda o cabecalho developer-token.
export const GOOGLE_ADS_API_VERSION = "v25";

/** Host fixo da Google Ads API (o caminho leva a versao). */
export const GOOGLE_ADS_HOST = "https://googleads.googleapis.com";

/** Troca de code, refresh token e JWT da conta de servico por access token. */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Revogacao de refresh token ou access token. */
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Tela de consentimento do OAuth web (o navegador vai ate ela). */
export const GOOGLE_CONSENT_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** Escopo unico da Google Ads API (nao existe versao so de leitura). */
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

/**
 * Hosts que as chamadas de servidor podem alcancar. Qualquer URL fora desta
 * lista e recusada antes do fetch: o token nunca sai para outro lugar.
 */
export const HOSTS_DO_GOOGLE: ReadonlySet<string> = new Set([
  "googleads.googleapis.com",
  "oauth2.googleapis.com",
]);
