import { describe, expect, it } from "vitest";

import {
  conferirEscopo,
  escoposConcedidos,
  montarUrlDeConsentimento,
  renovarAcesso,
  revogarToken,
  trocarCodigoPorTokens,
  type ClienteOAuth,
} from "@/lib/integrations/google/oauth";
import { GOOGLE_ADS_SCOPE } from "@/lib/integrations/google/versao";

// OAuth web do Google (modo login, F2b), com fetch falso: nada de rede.

const CLIENTE: ClienteOAuth = {
  clientId: "1234567890-abcdef.apps.googleusercontent.com",
  clientSecret: "GOCSPX-segredoDoCliente-SEGREDO",
  redirectUri: "https://app.conduzza.com.br/api/integracoes/google/callback",
};
const STATE = "nonceAleatorio_32bytes-em-base64url00";
const CODE = "4/0AeanS0aCodigoDeUsoUnico-SEGREDO";
const REFRESH = "1//0gRefreshTokenDeTeste-SEGREDO";
const ACCESS = "ya29.a0AccessTokenDeTeste-SEGREDO";
const AGORA = Date.parse("2026-10-04T12:00:00.000Z");

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function googleFalso(respostas: Response[]) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)]!;
    i += 1;
    return r.clone();
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

const SEM_ESPERA = { dormir: async () => {}, agora: () => AGORA };

describe("montarUrlDeConsentimento", () => {
  it("monta a URL com offline, consent, code, escopo adwords e o state de quem chama", () => {
    const r = montarUrlDeConsentimento({
      clientId: CLIENTE.clientId,
      redirectUri: CLIENTE.redirectUri,
      state: STATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const url = new URL(r.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENTE.clientId,
      redirect_uri: CLIENTE.redirectUri,
      response_type: "code",
      scope: GOOGLE_ADS_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: STATE,
    });
    expect(r.url).not.toContain(CLIENTE.clientSecret);
  });

  it("pedirEmail acrescenta openid e email", () => {
    const r = montarUrlDeConsentimento({
      clientId: CLIENTE.clientId,
      redirectUri: CLIENTE.redirectUri,
      state: STATE,
      pedirEmail: true,
    });
    expect(r.ok && new URL(r.url).searchParams.get("scope")).toBe(
      `openid email ${GOOGLE_ADS_SCOPE}`,
    );
  });

  it("recusa state curto ou com caractere estranho, retorno sem https e client id torto", () => {
    const base = {
      clientId: CLIENTE.clientId,
      redirectUri: CLIENTE.redirectUri,
      state: STATE,
    };
    for (const params of [
      { ...base, state: "curto" },
      { ...base, state: `${STATE}&x=1` },
      { ...base, redirectUri: "http://app.conduzza.com.br/callback" },
      { ...base, redirectUri: "https://app.conduzza.com.br/callback#frag" },
      { ...base, clientId: "com espaco nao" },
    ]) {
      expect(montarUrlDeConsentimento(params)).toMatchObject({
        ok: false,
        problema: "entrada_invalida",
      });
    }
    expect(
      montarUrlDeConsentimento({
        ...base,
        redirectUri: "http://localhost:3000/api/integracoes/google/callback",
      }).ok,
    ).toBe(true);
  });
});

describe("escopo concedido", () => {
  it("separa por espaco e confere o adwords", () => {
    expect(escoposConcedidos(`openid  ${GOOGLE_ADS_SCOPE} openid`)).toEqual([
      "openid",
      GOOGLE_ADS_SCOPE,
    ]);
    expect(conferirEscopo(`email ${GOOGLE_ADS_SCOPE}`).concedeAds).toBe(true);
    expect(conferirEscopo("openid email").concedeAds).toBe(false);
    expect(conferirEscopo(undefined)).toEqual({
      concedeAds: false,
      escopos: [],
    });
  });
});

describe("trocarCodigoPorTokens", () => {
  it("troca o code por tokens, com o formulario certo", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json({
        access_token: ACCESS,
        expires_in: 3599,
        refresh_token: REFRESH,
        scope: `${GOOGLE_ADS_SCOPE} openid`,
        token_type: "Bearer",
      }),
    ]);
    const r = await trocarCodigoPorTokens(CLIENTE, CODE, {
      fetchFn,
      ...SEM_ESPERA,
    });
    expect(r).toEqual({
      ok: true,
      tokens: {
        accessToken: ACCESS,
        accessTokenExpiraEm: AGORA + 3_599_000,
        refreshToken: REFRESH,
        refreshTokenExpiraEm: null,
        escopos: [GOOGLE_ADS_SCOPE, "openid"],
      },
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(chamadas[0]!.url).not.toContain("SEGREDO");
    const form = new URLSearchParams(String(chamadas[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code: CODE,
      client_id: CLIENTE.clientId,
      client_secret: CLIENTE.clientSecret,
      redirect_uri: CLIENTE.redirectUri,
    });
    expect(
      (chamadas[0]!.init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/x-www-form-urlencoded");
  });

  it("acesso por tempo limitado devolve o vencimento do refresh token", async () => {
    const { fetchFn } = googleFalso([
      json({
        access_token: ACCESS,
        expires_in: 3599,
        refresh_token: REFRESH,
        refresh_token_expires_in: 604_800,
        scope: GOOGLE_ADS_SCOPE,
        token_type: "Bearer",
      }),
    ]);
    const r = await trocarCodigoPorTokens(CLIENTE, CODE, {
      fetchFn,
      ...SEM_ESPERA,
    });
    expect(r.ok && r.tokens.refreshTokenExpiraEm).toBe(AGORA + 604_800_000);
  });

  it("escopo adwords desmarcado vira escopo_faltando, sem tokens no resultado", async () => {
    const { fetchFn } = googleFalso([
      json({
        access_token: ACCESS,
        expires_in: 3599,
        refresh_token: REFRESH,
        scope: "openid email",
      }),
    ]);
    const r = await trocarCodigoPorTokens(CLIENTE, CODE, {
      fetchFn,
      ...SEM_ESPERA,
    });
    expect(r).toMatchObject({
      ok: false,
      problema: "escopo_faltando",
      acao: "pausar",
    });
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
  });

  it("sem refresh token e resposta invalida", async () => {
    const { fetchFn } = googleFalso([
      json({ access_token: ACCESS, expires_in: 3599, scope: GOOGLE_ADS_SCOPE }),
    ]);
    expect(
      await trocarCodigoPorTokens(CLIENTE, CODE, { fetchFn, ...SEM_ESPERA }),
    ).toMatchObject({
      ok: false,
      problema: "resposta_invalida",
    });
  });

  it("uma tentativa so, mesmo em falha transitoria (o code e de uso unico)", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json({ error: "server_error" }, 503),
    ]);
    const r = await trocarCodigoPorTokens(CLIENTE, CODE, {
      fetchFn,
      ...SEM_ESPERA,
    });
    expect(r).toMatchObject({
      ok: false,
      problema: "google_indisponivel",
      http: 503,
    });
    expect(chamadas).toHaveLength(1);
  });

  it("code reusado (invalid_grant) sem retry e sem a descricao do Google", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json(
        { error: "invalid_grant", error_description: "Bad Request SEGREDO" },
        400,
      ),
    ]);
    const r = await trocarCodigoPorTokens(CLIENTE, CODE, {
      fetchFn,
      ...SEM_ESPERA,
    });
    expect(r).toMatchObject({
      ok: false,
      problema: "token_revogado",
      codigoDoGoogle: "invalid_grant",
    });
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
    expect(chamadas).toHaveLength(1);
  });

  it("entrada torta nem chama o Google", async () => {
    const { fetchFn, chamadas } = googleFalso([json({})]);
    expect(
      await trocarCodigoPorTokens(CLIENTE, "x", { fetchFn }),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(
      await trocarCodigoPorTokens({ ...CLIENTE, clientSecret: "" }, CODE, {
        fetchFn,
      }),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(chamadas).toHaveLength(0);
  });
});

describe("renovarAcesso", () => {
  it("renova pelo refresh token", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json({
        access_token: ACCESS,
        expires_in: 3599,
        scope: GOOGLE_ADS_SCOPE,
        token_type: "Bearer",
      }),
    ]);
    const r = await renovarAcesso(CLIENTE, REFRESH, { fetchFn, ...SEM_ESPERA });
    expect(r).toEqual({
      ok: true,
      accessToken: ACCESS,
      expiraEm: AGORA + 3_599_000,
      escopos: [GOOGLE_ADS_SCOPE],
      refreshTokenExpiraEm: null,
    });
    const form = new URLSearchParams(String(chamadas[0]!.init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(REFRESH);
  });

  it("invalid_grant vira token_revogado, sem retry", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json(
        {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
        400,
      ),
    ]);
    const r = await renovarAcesso(CLIENTE, REFRESH, { fetchFn, ...SEM_ESPERA });
    expect(r).toMatchObject({
      ok: false,
      problema: "token_revogado",
      acao: "pausar",
      transitorio: false,
    });
    expect(chamadas).toHaveLength(1);
  });

  it("falha transitoria repete com backoff", async () => {
    const { fetchFn, chamadas } = googleFalso([
      json({ error: "temporarily_unavailable" }, 503),
      json({ access_token: ACCESS, expires_in: 3599 }),
    ]);
    const r = await renovarAcesso(CLIENTE, REFRESH, { fetchFn, ...SEM_ESPERA });
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(2);
  });

  it("escopo informado sem adwords vira escopo_faltando", async () => {
    const { fetchFn } = googleFalso([
      json({ access_token: ACCESS, expires_in: 3599, scope: "openid" }),
    ]);
    expect(
      await renovarAcesso(CLIENTE, REFRESH, { fetchFn, ...SEM_ESPERA }),
    ).toMatchObject({
      problema: "escopo_faltando",
    });
  });
});

describe("revogarToken", () => {
  it("manda o token no corpo, nunca na URL", async () => {
    const { fetchFn, chamadas } = googleFalso([
      new Response("", { status: 200 }),
    ]);
    const r = await revogarToken(REFRESH, { fetchFn, ...SEM_ESPERA });
    expect(r).toEqual({ ok: true, jaEstavaInvalido: false });
    expect(chamadas[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(
      new URLSearchParams(String(chamadas[0]!.init.body)).get("token"),
    ).toBe(REFRESH);
  });

  it("token ja invalido conta como revogado", async () => {
    const { fetchFn } = googleFalso([
      json(
        {
          error: "invalid_token",
          error_description: "Token expired or revoked",
        },
        400,
      ),
    ]);
    expect(await revogarToken(REFRESH, { fetchFn, ...SEM_ESPERA })).toEqual({
      ok: true,
      jaEstavaInvalido: true,
    });
  });

  it("Google fora do ar devolve a falha classificada", async () => {
    const { fetchFn, chamadas } = googleFalso([json(null, 503)]);
    expect(
      await revogarToken(REFRESH, { fetchFn, ...SEM_ESPERA }),
    ).toMatchObject({
      ok: false,
      problema: "google_indisponivel",
    });
    expect(chamadas).toHaveLength(3);
  });
});
