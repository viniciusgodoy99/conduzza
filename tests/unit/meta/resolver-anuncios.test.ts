import { afterEach, describe, expect, it, vi } from "vitest";

import {
  desfechoDaFalhaDoAnuncio,
  paraGravarResolucao,
  resolverAnuncios,
  RESOLVER_MAX_ANUNCIOS,
  type ConfigDeLeitura,
  type FalhaDeLeitura,
  type ResolucaoDeAnuncios,
} from "@/lib/integrations/meta/insights";
import { GRAPH_VERSION } from "@/lib/integrations/meta/versao";
import type { Database } from "@/lib/supabase/database.types";

// Resolucao de anuncio -> campanha e conjunto pela Meta (frente B da origem
// real do lead de anuncio, 04/10/2026), com fetch dublado: nada de rede.

const TOKEN = "EAABtokenDeTeste1234567890SEGREDO";
const CONTA = "act_123456789" as const;
const AGORA = Date.parse("2026-10-04T15:00:00.000Z");
const MENSAGEM_DA_META =
  "Unsupported get request. Object with ID '120240624148610289' SEGREDO-DA-MENSAGEM";

const AD1 = "120240624148610289";
const AD2 = "120240624148610290";
const AD3 = "120240624148610291";
const AD4 = "120240624148610292";
const CAMPANHA = "6720000000000001";
const CONJUNTO = "238500000000000001";

type TipoDaChamada = "insights" | "objeto" | "conta";
type Chamada = { url: URL; init: RequestInit; adId: string; tipo: TipoDaChamada };

function json(
  corpo: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function erroMeta(code: number, subcode?: number, status = 400): Response {
  return json(
    {
      error: {
        message: MENSAGEM_DA_META,
        type: "OAuthException",
        code,
        ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        fbtrace_id: "AbCdEf",
      },
    },
    status,
  );
}

function linhaDoInsights(adId: string, extra: Record<string, unknown> = {}) {
  return {
    account_id: "123456789",
    ad_id: adId,
    ad_name: "Anúncio botox vídeo 1",
    adset_id: CONJUNTO,
    adset_name: "Mulheres 30 a 55, Fortaleza",
    campaign_id: CAMPANHA,
    campaign_name: "Botox outubro",
    date_start: "2023-10-04",
    date_stop: "2026-10-04",
    ...extra,
  };
}

function objetoDoAnuncio(adId: string, extra: Record<string, unknown> = {}) {
  return {
    id: adId,
    account_id: "123456789",
    name: "Anúncio novo, sem entrega",
    adset_id: CONJUNTO,
    campaign_id: CAMPANHA,
    adset: { name: "Conjunto novo", id: CONJUNTO },
    campaign: { name: "Campanha nova", id: CAMPANHA },
    ...extra,
  };
}

/**
 * Meta de mentira: /{ad}/insights, /{ad} e /act_X/insights (a conferencia da
 * conta) pelos manipuladores dados (padrao: insights com a linha completa e a
 * conta respondendo), gravando toda chamada.
 */
function metaFalsa(rotas: {
  insights?: (adId: string, url: URL) => Response | Promise<Response>;
  objeto?: (adId: string, url: URL) => Response | Promise<Response>;
  conta?: (url: URL) => Response | Promise<Response>;
}) {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const partes = url.pathname.split("/").filter(Boolean);
    const adId = partes[1] ?? "";
    if (partes[0] !== GRAPH_VERSION) {
      return json({ error: { code: 803 } }, 404);
    }
    if (partes.length === 3 && adId.startsWith("act_") && partes[2] === "insights") {
      chamadas.push({ url, init: init ?? {}, adId, tipo: "conta" });
      return rotas.conta
        ? rotas.conta(url)
        : json({ data: [{ spend: "152.30", date_start: "2026-09-05", date_stop: "2026-10-04" }] });
    }
    if (partes.length === 3 && partes[2] === "insights") {
      chamadas.push({ url, init: init ?? {}, adId, tipo: "insights" });
      return rotas.insights
        ? rotas.insights(adId, url)
        : json({ data: [linhaDoInsights(adId)] });
    }
    if (partes.length === 2) {
      chamadas.push({ url, init: init ?? {}, adId, tipo: "objeto" });
      return rotas.objeto ? rotas.objeto(adId, url) : json(objetoDoAnuncio(adId));
    }
    return json({ error: { code: 803 } }, 404);
  }) as typeof fetch;
  return {
    fetchFn,
    chamadas,
    doTipo(tipo: TipoDaChamada) {
      return chamadas.filter((c) => c.tipo === tipo);
    },
  };
}

function config(extra: Partial<ConfigDeLeitura> = {}): ConfigDeLeitura {
  return {
    adAccountId: CONTA,
    accessToken: TOKEN,
    prazoEm: AGORA + 60_000,
    agora: () => AGORA,
    dormir: async () => {},
    aleatorio: () => 0.5,
    ...extra,
  };
}

function ok(r: ResolucaoDeAnuncios | FalhaDeLeitura): ResolucaoDeAnuncios {
  if (!r.ok) {
    throw new Error(`esperava ok, veio ${r.problema}`);
  }
  return r;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("1. dado completo", () => {
  it("uma chamada ao insights do anúncio dá campanha, conjunto e nomes", async () => {
    const meta = metaFalsa({});
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));

    expect(r).toEqual({
      ok: true,
      resolvidos: [
        {
          adId: AD1,
          adName: "Anúncio botox vídeo 1",
          adsetId: CONJUNTO,
          adsetName: "Mulheres 30 a 55, Fortaleza",
          campaignId: CAMPANHA,
          campaignName: "Botox outubro",
          adAccountId: CONTA,
        },
      ],
      recusados: [],
      naoTentados: [],
    });

    expect(meta.chamadas).toHaveLength(1);
    const { url, init } = meta.chamadas[0]!;
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe(`/v26.0/${AD1}/insights`);
    expect(url.searchParams.get("fields")?.split(",")).toEqual([
      "account_id",
      "ad_id",
      "ad_name",
      "adset_id",
      "adset_name",
      "campaign_id",
      "campaign_name",
    ]);
    expect(url.searchParams.get("date_preset")).toBe("maximum");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.has("level")).toBe(false);
    expect(url.searchParams.has("time_range")).toBe(false);
    const cabecalhos = init.headers as Record<string, string>;
    expect(cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.method).toBe("GET");
    expect(url.toString()).not.toContain(TOKEN);
    expect(url.searchParams.has("access_token")).toBe(false);
  });

  it("conta com act_ na resposta, conjunto ausente e nomes vazios ou longos", async () => {
    const longo = `${"x".repeat(399)}😀😀`;
    const meta = metaFalsa({
      insights: (adId) =>
        json({
          data: [
            linhaDoInsights(adId, {
              account_id: "act_123456789",
              adset_id: "",
              adset_name: "   ",
              ad_name: null,
              campaign_name: `  ${longo}  `,
            }),
          ],
        }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    const [a] = r.resolvidos;
    expect(a).toMatchObject({
      adsetId: null,
      adsetName: null,
      adName: null,
      adAccountId: CONTA,
    });
    // Corta por caractere: 399 x e um emoji inteiro, nunca meio emoji.
    expect(Array.from(a!.campaignName ?? "")).toHaveLength(400);
    expect(a!.campaignName).toBe(`${"x".repeat(399)}😀`);
  });

  it("ids repetidos contam uma vez e id que não é número nunca vai para a URL", async () => {
    const meta = metaFalsa({});
    const r = ok(
      await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [
        AD1,
        "12/../me",
        AD1,
        "abc",
        "",
        ` ${AD2}`,
        AD2,
      ]),
    );
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD1, AD2]);
    expect(r.naoTentados).toEqual([]);
    expect(meta.chamadas.map((c) => c.adId)).toEqual([AD1, AD2]);
  });

  it("conta ou token fora do formato nem chamam a Meta", async () => {
    const meta = metaFalsa({});
    const semConta = await resolverAnuncios(
      config({ fetchFn: meta.fetchFn, adAccountId: "act_12/../me" as `act_${string}` }),
      [AD1],
    );
    expect(semConta).toMatchObject({ ok: false, problema: "conta_sem_acesso" });
    const semToken = await resolverAnuncios(
      config({ fetchFn: meta.fetchFn, accessToken: "curto" }),
      [AD1],
    );
    expect(semToken).toMatchObject({ ok: false, problema: "token_invalido" });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("lista vazia não chama a Meta", async () => {
    const meta = metaFalsa({});
    expect(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [])).toEqual({
      ok: true,
      resolvidos: [],
      recusados: [],
      naoTentados: [],
    });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("as dependências do terceiro argumento valem mais que as da config", async () => {
    const naConfig = metaFalsa({});
    const nasDeps = metaFalsa({});
    ok(
      await resolverAnuncios(config({ fetchFn: naConfig.fetchFn }), [AD1], {
        fetchFn: nasDeps.fetchFn,
      }),
    );
    expect(naConfig.chamadas).toHaveLength(0);
    expect(nasDeps.chamadas).toHaveLength(1);
  });
});

describe("2. insights sem dados e a segunda chamada", () => {
  it("insights vazio lê o objeto do anúncio com conjunto e campanha expandidos", async () => {
    const meta = metaFalsa({ insights: () => json({ data: [] }) });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.resolvidos).toEqual([
      {
        adId: AD1,
        adName: "Anúncio novo, sem entrega",
        adsetId: CONJUNTO,
        adsetName: "Conjunto novo",
        campaignId: CAMPANHA,
        campaignName: "Campanha nova",
        adAccountId: CONTA,
      },
    ]);
    expect(r.recusados).toEqual([]);

    expect(meta.chamadas.map((c) => c.tipo)).toEqual(["insights", "objeto"]);
    const objeto = meta.doTipo("objeto")[0]!;
    expect(objeto.url.pathname).toBe(`/v26.0/${AD1}`);
    expect(objeto.url.searchParams.get("fields")).toBe(
      "account_id,name,adset_id,campaign_id,adset{name},campaign{name}",
    );
    expect((objeto.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(objeto.url.toString()).not.toContain(TOKEN);
  });

  it("sem adset_id e campaign_id planos, usa os ids das expansões", async () => {
    const meta = metaFalsa({
      insights: () => json({ data: [] }),
      objeto: (adId) =>
        json(objetoDoAnuncio(adId, { adset_id: undefined, campaign_id: undefined })),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.resolvidos[0]).toMatchObject({ adsetId: CONJUNTO, campaignId: CAMPANHA });
  });

  it.each([
    [200, undefined, 403],
    [10, undefined, 400],
    [100, 33, 400],
    [803, undefined, 404],
    [100, undefined, 400],
  ] as const)(
    "segunda chamada recusada com %s/%s vira sem_entrega_ainda, sem falha",
    async (code, subcode, status) => {
      const meta = metaFalsa({
        insights: () => json({ data: [] }),
        objeto: () => erroMeta(code, subcode, status),
      });
      const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
      expect(r.recusados).toEqual([
        { adId: AD1, motivo: "sem_entrega_ainda", codigo: code },
        { adId: AD2, motivo: "sem_entrega_ainda", codigo: code },
      ]);
      expect(r.resolvidos).toEqual([]);
    },
  );

  it.each([
    [190, undefined, 401, "token_invalido", "pausar"],
    [613, undefined, 400, "limite_da_meta", "reagendar"],
    [2635, undefined, 400, "versao_descontinuada", "desistir"],
  ] as const)(
    "segunda chamada com %s interrompe o lote (%s)",
    async (code, subcode, status, problema, acao) => {
      const meta = metaFalsa({
        insights: () => json({ data: [] }),
        objeto: () => erroMeta(code, subcode, status),
      });
      const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
      expect(r).toMatchObject({ ok: false, problema, acao, codigoDaMeta: code });
      expect(meta.chamadas.map((c) => c.adId)).toEqual([AD1, AD1]);
    },
  );

  it("consulta pesada no insights também lê o objeto", async () => {
    const meta = metaFalsa({ insights: () => erroMeta(100, 1504018) });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.resolvidos[0]).toMatchObject({ adId: AD1, campaignId: CAMPANHA });
    expect(meta.chamadas.map((c) => c.tipo)).toEqual(["insights", "objeto"]);
  });
});

describe("3. 100/33, 803 e 404: só daquele anúncio, sem pausar", () => {
  it.each([
    [100, 33, 400, 100],
    [803, undefined, 400, 803],
    [100, undefined, 404, 100],
    [null, null, 404, null],
  ] as const)(
    "%s/%s (HTTP %s) vira inacessivel e o lote segue",
    async (code, subcode, status, codigo) => {
      const meta = metaFalsa({
        insights: (adId) => {
          if (adId !== AD1) return json({ data: [linhaDoInsights(adId)] });
          if (code === null) return new Response(null, { status });
          return erroMeta(code, subcode ?? undefined, status);
        },
      });
      const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
      // Nunca a FalhaDeLeitura (conta_sem_acesso pausaria a leitura diaria).
      expect(r.ok).toBe(true);
      const resolucao = ok(r);
      expect(resolucao.recusados).toEqual([{ adId: AD1, motivo: "inacessivel", codigo }]);
      expect(resolucao.resolvidos.map((a) => a.adId)).toEqual([AD2]);
      // O inacessivel no insights nao tenta o objeto.
      expect(meta.chamadas.map((c) => `${c.tipo}:${c.adId}`)).toEqual([
        `insights:${AD1}`,
        `insights:${AD2}`,
      ]);
      expect(JSON.stringify(r)).not.toContain("conta_sem_acesso");
    },
  );

  it("código 100 genérico ou desconhecido no insights vira resposta_invalida daquele anúncio", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        adId === AD1
          ? erroMeta(100)
          : adId === AD2
            ? erroMeta(99999)
            : json({ data: [linhaDoInsights(adId)] }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3]));
    expect(r.recusados).toEqual([
      { adId: AD1, motivo: "resposta_invalida", codigo: 100 },
      { adId: AD2, motivo: "resposta_invalida", codigo: 99999 },
    ]);
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD3]);
  });
});

describe("4. token, prova do app, limite e versão interrompem o lote", () => {
  it.each([
    [190, undefined, 401, "token_invalido", "pausar"],
    [190, 463, 400, "token_invalido", "pausar"],
    [102, undefined, 400, "token_invalido", "pausar"],
    [4, undefined, 400, "limite_da_meta", "reagendar"],
    [17, undefined, 400, "limite_da_meta", "reagendar"],
    [80004, undefined, 400, "limite_da_meta", "reagendar"],
    [2635, undefined, 400, "versao_descontinuada", "desistir"],
  ] as const)(
    "%s/%s (HTTP %s) no segundo anúncio devolve %s e não chama o terceiro",
    async (code, subcode, status, problema, acao) => {
      const meta = metaFalsa({
        insights: (adId) =>
          adId === AD2 ? erroMeta(code, subcode, status) : json({ data: [linhaDoInsights(adId)] }),
      });
      const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3]);
      expect(r).toMatchObject({
        ok: false,
        problema,
        acao,
        codigoDaMeta: code,
        subcodigoDaMeta: subcode ?? null,
        http: status,
      });
      expect(meta.chamadas.map((c) => c.adId)).toEqual([AD1, AD2]);
      // Nada disso confere a conta: o lote para na hora.
      expect(meta.doTipo("conta")).toHaveLength(0);
      if (problema === "limite_da_meta") {
        expect((r as FalhaDeLeitura).tentarEmMs).toBeGreaterThan(0);
      }
    },
  );

  it("app que exige appsecret_proof interrompe com pausar, sem conferir a conta", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        adId === AD2
          ? json(
              {
                error: {
                  message: "API calls from the server require an appsecret_proof argument",
                  type: "GraphMethodException",
                  code: 100,
                },
              },
              400,
            )
          : json({ data: [linhaDoInsights(adId)] }),
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3]);
    expect(r).toMatchObject({ ok: false, problema: "exige_prova_do_app", acao: "pausar" });
    expect(meta.chamadas.map((c) => `${c.tipo}:${c.adId}`)).toEqual([
      `insights:${AD1}`,
      `insights:${AD2}`,
    ]);
    expect(JSON.stringify(r)).not.toContain("appsecret_proof");
  });

  it("190 no primeiro anúncio: uma chamada só, sem retry", async () => {
    const meta = metaFalsa({ insights: () => erroMeta(190, undefined, 401) });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
    expect(r).toMatchObject({ ok: false, problema: "token_invalido", acao: "pausar" });
    expect(meta.chamadas).toHaveLength(1);
  });

  it("HTTP 429 sem corpo é limite da Meta", async () => {
    const meta = metaFalsa({ insights: () => new Response(null, { status: 429 }) });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]);
    expect(r).toMatchObject({ ok: false, problema: "limite_da_meta", acao: "reagendar" });
  });

  it("uso de 96% depois do primeiro anúncio para antes do segundo", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        json({ data: [linhaDoInsights(adId)] }, 200, {
          "x-fb-ads-insights-throttle": JSON.stringify({
            app_id_util_pct: 96,
            acc_id_util_pct: 10,
          }),
        }),
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
    expect(r).toMatchObject({ ok: false, problema: "limite_da_meta", acao: "reagendar" });
    expect(meta.chamadas).toHaveLength(1);
  });

  it("Meta fora do ar depois das novas tentativas interrompe com repetir", async () => {
    const meta = metaFalsa({ insights: () => new Response(null, { status: 503 }) });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
    expect(r).toMatchObject({ ok: false, problema: "meta_indisponivel", acao: "repetir" });
    expect(meta.chamadas).toHaveLength(3);
  });

  it("resposta 200 que não é JSON interrompe com repetir", async () => {
    const meta = metaFalsa({
      insights: () => new Response("<html>", { status: 200 }),
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]);
    expect(r).toMatchObject({ ok: false, problema: "resposta_invalida", acao: "repetir" });
  });
});

describe("4b. permissão recusada num anúncio: confere a conta salva antes de pausar", () => {
  // Anuncio na conta de uma agencia, ou post impulsionado por outra conta: o
  // token le a conta salva, mas a Meta recusa aquele anuncio. Isso nao pode
  // pausar a leitura diaria do gasto (que leria normalmente) nem travar o
  // lote: vira inacessivel so daquele anuncio, e o banco tenta de novo com
  // outra conta ou outro token.
  it.each([
    [10, undefined, 400],
    [200, undefined, 403],
    [270, undefined, 400],
    [273, undefined, 400],
    [299, undefined, 400],
    [294, undefined, 400],
    [100, 3191001, 400],
    [null, undefined, 403],
  ] as const)(
    "%s/%s (HTTP %s) no segundo anúncio, com a conta respondendo, vira inacessivel e o lote segue",
    async (code, subcode, status) => {
      const meta = metaFalsa({
        insights: (adId) => {
          if (adId !== AD2) return json({ data: [linhaDoInsights(adId)] });
          if (code === null) return new Response(null, { status });
          return erroMeta(code, subcode, status);
        },
      });
      const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3]);
      // Nunca a FalhaDeLeitura: sem_permissao pausaria a leitura diaria.
      expect(r.ok).toBe(true);
      const resolucao = ok(r);
      expect(resolucao.resolvidos.map((a) => a.adId)).toEqual([AD1, AD3]);
      expect(resolucao.recusados).toEqual([{ adId: AD2, motivo: "inacessivel", codigo: code }]);
      expect(resolucao.naoTentados).toEqual([]);
      // Uma conferencia da conta, e o terceiro anuncio e chamado.
      expect(meta.chamadas.map((c) => `${c.tipo}:${c.adId}`)).toEqual([
        `insights:${AD1}`,
        `insights:${AD2}`,
        `conta:${CONTA}`,
        `insights:${AD3}`,
      ]);
      expect(JSON.stringify(r)).not.toContain("sem_permissao");
      expect(JSON.stringify(r)).not.toContain("SEGREDO");
    },
  );

  it("a conferência é a leitura do Testar leitura, com o token só no cabeçalho", async () => {
    const meta = metaFalsa({
      insights: (adId) => (adId === AD1 ? erroMeta(200, undefined, 403) : json({ data: [] })),
    });
    ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    const [conferencia] = meta.doTipo("conta");
    expect(conferencia).toBeDefined();
    const { url, init } = conferencia!;
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe(`/v26.0/${CONTA}/insights`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      level: "account",
      fields: "spend",
      date_preset: "last_30d",
      limit: "1",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url.toString()).not.toContain(TOKEN);
    // Permissao recusada no insights nao tenta o objeto.
    expect(meta.doTipo("objeto")).toHaveLength(0);
  });

  it("conta sem gasto em 30 dias (lista vazia) também conta como respondendo", async () => {
    const meta = metaFalsa({
      insights: () => erroMeta(200, undefined, 403),
      conta: () => json({ data: [] }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.recusados).toEqual([{ adId: AD1, motivo: "inacessivel", codigo: 200 }]);
  });

  it("vários anúncios com permissão recusada no mesmo lote conferem a conta uma vez só", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        adId === AD3 ? json({ data: [linhaDoInsights(adId)] }) : erroMeta(adId === AD1 ? 10 : 200),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3, AD4]));
    expect(r.recusados).toEqual([
      { adId: AD1, motivo: "inacessivel", codigo: 10 },
      { adId: AD2, motivo: "inacessivel", codigo: 200 },
      { adId: AD4, motivo: "inacessivel", codigo: 200 },
    ]);
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD3]);
    expect(meta.doTipo("conta")).toHaveLength(1);
    expect(meta.chamadas.map((c) => c.tipo)).toEqual([
      "insights",
      "conta",
      "insights",
      "insights",
      "insights",
    ]);
  });

  it("uma nova execução confere a conta de novo (a confirmação vale só para o lote)", async () => {
    const meta = metaFalsa({ insights: () => erroMeta(200, undefined, 403) });
    ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD2]));
    expect(meta.doTipo("conta")).toHaveLength(2);
  });

  it.each([
    ["200 (sem ads_read)", () => erroMeta(200, undefined, 403), "sem_permissao", "pausar", 200],
    ["10", () => erroMeta(10), "sem_permissao", "pausar", 10],
    ["100/33 (conta inacessível)", () => erroMeta(100, 33), "conta_sem_acesso", "pausar", 100],
    ["190 (token)", () => erroMeta(190, undefined, 401), "token_invalido", "pausar", 190],
    ["613 (limite)", () => erroMeta(613), "limite_da_meta", "reagendar", 613],
  ] as const)(
    "a conta também recusa com %s: o lote para com a falha DA CONTA",
    async (_nome, respostaDaConta, problema, acao, codigoDaConta) => {
      const meta = metaFalsa({
        insights: (adId) =>
          adId === AD2 ? erroMeta(270) : json({ data: [linhaDoInsights(adId)] }),
        conta: respostaDaConta,
      });
      const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD3]);
      expect(r).toMatchObject({ ok: false, problema, acao, codigoDaMeta: codigoDaConta });
      // O terceiro anuncio nao e chamado e nenhuma recusa sai.
      expect(meta.chamadas.map((c) => `${c.tipo}:${c.adId}`)).toEqual([
        `insights:${AD1}`,
        `insights:${AD2}`,
        `conta:${CONTA}`,
      ]);
      expect(JSON.stringify(r)).not.toContain("SEGREDO");
    },
  );

  it("a conta fora do ar interrompe com repetir, depois das novas tentativas locais", async () => {
    const meta = metaFalsa({
      insights: () => erroMeta(200, undefined, 403),
      conta: () => new Response(null, { status: 503 }),
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]);
    expect(r).toMatchObject({ ok: false, problema: "meta_indisponivel", acao: "repetir" });
    expect(meta.doTipo("conta")).toHaveLength(3);
    expect(meta.doTipo("insights").map((c) => c.adId)).toEqual([AD1]);
  });

  it("a conta que responde sem lista de dados interrompe com repetir", async () => {
    const meta = metaFalsa({
      insights: () => erroMeta(200, undefined, 403),
      conta: () => json({ resumo: "x" }),
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]);
    expect(r).toMatchObject({ ok: false, problema: "resposta_invalida", acao: "repetir" });
  });

  it("sem prazo para conferir a conta, o anúncio volta em naoTentados, sem recusa", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      insights: (adId) => {
        if (adId === AD1) {
          relogio += 1_000;
          return json({ data: [linhaDoInsights(adId)] });
        }
        // 13,5 s: sobram 1,5 s, menos que os 2 s minimos da conferencia.
        relogio += 12_500;
        return erroMeta(200, undefined, 403);
      },
    });
    const r = ok(
      await resolverAnuncios(config({ fetchFn: meta.fetchFn, agora: () => relogio }), [
        AD1,
        AD2,
        AD3,
      ]),
    );
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD1]);
    expect(r.recusados).toEqual([]);
    expect(r.naoTentados).toEqual([AD2, AD3]);
    expect(meta.doTipo("conta")).toHaveLength(0);
  });

  it("sem prazo para conferir a conta no primeiro anúncio, é falha prazo_esgotado", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      insights: () => {
        relogio += 13_500;
        return erroMeta(200, undefined, 403);
      },
    });
    const r = await resolverAnuncios(config({ fetchFn: meta.fetchFn, agora: () => relogio }), [
      AD1,
      AD2,
    ]);
    expect(r).toMatchObject({ ok: false, problema: "prazo_esgotado", acao: "repetir" });
    expect(meta.doTipo("conta")).toHaveLength(0);
  });

  it("a recusa por permissão sai no formato da gravação, com o código da Meta", async () => {
    const meta = metaFalsa({
      insights: (adId) => (adId === AD1 ? erroMeta(273) : json({ data: [linhaDoInsights(adId)] })),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
    const payload = paraGravarResolucao(r);
    expect(payload.p_recusas).toEqual([{ ad_id: AD1, motivo: "inacessivel", codigo: 273 }]);
    expect(payload.p_resolvidos.map((x) => x.ad_id)).toEqual([AD2]);
  });
});

describe("5. outra conta e resposta torta", () => {
  it("anúncio de outra conta vira outra_conta e não entra nos resolvidos", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        json({
          data: [linhaDoInsights(adId, { account_id: adId === AD1 ? "987654321" : "123456789" })],
        }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
    expect(r.recusados).toEqual([{ adId: AD1, motivo: "outra_conta", codigo: null }]);
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD2]);
    expect(r.resolvidos.every((a) => a.adAccountId === CONTA)).toBe(true);
  });

  it("outra conta também pela segunda chamada", async () => {
    const meta = metaFalsa({
      insights: () => json({ data: [] }),
      objeto: (adId) => json(objetoDoAnuncio(adId, { account_id: "act_987654321" })),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.recusados).toEqual([{ adId: AD1, motivo: "outra_conta", codigo: null }]);
    expect(r.resolvidos).toEqual([]);
  });

  it.each([
    ["sem campanha", { campaign_id: undefined }],
    ["campanha que não é número", { campaign_id: "abc" }],
    ["conjunto que não é número", { adset_id: "12x" }],
    ["sem conta", { account_id: undefined }],
    ["conta ilegível", { account_id: "conta" }],
    ["outro anúncio na linha", { ad_id: AD3 }],
  ] as const)("linha %s vira resposta_invalida", async (_nome, extra) => {
    const meta = metaFalsa({
      insights: (adId) => json({ data: [linhaDoInsights(adId, extra)] }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1]));
    expect(r.recusados).toEqual([{ adId: AD1, motivo: "resposta_invalida", codigo: null }]);
    expect(r.resolvidos).toEqual([]);
  });

  it("insights sem lista de dados, ou linha que não é objeto, vira resposta_invalida", async () => {
    const meta = metaFalsa({
      insights: (adId) => json(adId === AD1 ? { data: "x" } : { data: ["linha"] }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
    expect(r.recusados.map((x) => x.motivo)).toEqual(["resposta_invalida", "resposta_invalida"]);
  });

  it("objeto de outro id ou sem campanha vira resposta_invalida", async () => {
    const meta = metaFalsa({
      insights: () => json({ data: [] }),
      objeto: (adId) =>
        json(
          adId === AD1
            ? objetoDoAnuncio(AD3)
            : objetoDoAnuncio(adId, { campaign_id: undefined, campaign: { name: "x" } }),
        ),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
    expect(r.recusados).toEqual([
      { adId: AD1, motivo: "resposta_invalida", codigo: null },
      { adId: AD2, motivo: "resposta_invalida", codigo: null },
    ]);
  });
});

describe("6. prazo, teto de anúncios e timeout", () => {
  it("o que não cabe no prazo de 15 s volta em naoTentados, mesmo com prazoEm maior", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      insights: (adId) => {
        relogio += 7_000;
        return json({ data: [linhaDoInsights(adId)] });
      },
    });
    const r = ok(
      await resolverAnuncios(
        config({ fetchFn: meta.fetchFn, agora: () => relogio, prazoEm: AGORA + 120_000 }),
        [AD1, AD2, AD3, "120240624148610292"],
      ),
    );
    // 0 s, 7 s e 14 s: o terceiro ja nao tem os 2 s minimos ate os 15 s.
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD1, AD2]);
    expect(r.naoTentados).toEqual([AD3, "120240624148610292"]);
    expect(meta.chamadas).toHaveLength(2);
  });

  it("o prazoEm de quem chama, se menor, vale", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      insights: (adId) => {
        relogio += 3_000;
        return json({ data: [linhaDoInsights(adId)] });
      },
    });
    const r = ok(
      await resolverAnuncios(
        config({ fetchFn: meta.fetchFn, agora: () => relogio, prazoEm: AGORA + 4_500 }),
        [AD1, AD2],
      ),
    );
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD1]);
    expect(r.naoTentados).toEqual([AD2]);
  });

  it("anúncio que fica sem tempo entre as duas chamadas volta em naoTentados", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      insights: (adId) => {
        relogio += adId === AD1 ? 1_000 : 13_000;
        return json({ data: adId === AD1 ? [linhaDoInsights(adId)] : [] });
      },
    });
    const r = ok(
      await resolverAnuncios(config({ fetchFn: meta.fetchFn, agora: () => relogio }), [
        AD1,
        AD2,
        AD3,
      ]),
    );
    expect(r.resolvidos.map((a) => a.adId)).toEqual([AD1]);
    expect(r.recusados).toEqual([]);
    expect(r.naoTentados).toEqual([AD2, AD3]);
    expect(meta.doTipo("objeto")).toHaveLength(0);
  });

  it("prazo que acaba antes de qualquer anúncio terminar é falha prazo_esgotado", async () => {
    const meta = metaFalsa({});
    const semTempo = await resolverAnuncios(
      config({ fetchFn: meta.fetchFn, prazoEm: AGORA + 1_000 }),
      [AD1, AD2],
    );
    expect(semTempo).toMatchObject({ ok: false, problema: "prazo_esgotado", acao: "repetir" });
    expect(meta.chamadas).toHaveLength(0);

    let relogio = AGORA;
    const lenta = metaFalsa({
      insights: () => {
        relogio += 14_000;
        return json({ data: [] });
      },
    });
    const r = await resolverAnuncios(
      config({ fetchFn: lenta.fetchFn, agora: () => relogio }),
      [AD1, AD2],
    );
    expect(r).toMatchObject({ ok: false, problema: "prazo_esgotado", acao: "repetir" });
  });

  it(`até ${RESOLVER_MAX_ANUNCIOS} anúncios por execução; o resto volta em naoTentados, na ordem`, async () => {
    // Montado como texto: o id passa de Number.MAX_SAFE_INTEGER.
    const ids = Array.from({ length: 25 }, (_, i) => `1202406241486${String(i).padStart(5, "0")}`);
    const meta = metaFalsa({});
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), ids));
    expect(r.resolvidos).toHaveLength(RESOLVER_MAX_ANUNCIOS);
    expect(r.resolvidos.map((a) => a.adId)).toEqual(ids.slice(0, 20));
    expect(r.naoTentados).toEqual(ids.slice(20));
    expect(meta.chamadas).toHaveLength(20);
  });

  it("cada requisição tem 8 s, mesmo com timeoutMs maior; o insights mudo lê o objeto", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const inicio = Date.now();
    const duracoes: Array<{ tipo: string; ms: number }> = [];
    const fetchFn = ((entrada: unknown, init?: RequestInit) => {
      const url = new URL(String(entrada));
      const tipo = url.pathname.endsWith("/insights") ? "insights" : "objeto";
      const comecou = Date.now();
      return new Promise<Response>((_resolve, rejeitar) => {
        init?.signal?.addEventListener("abort", () => {
          duracoes.push({ tipo, ms: Date.now() - comecou });
          rejeitar(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    const promessa = resolverAnuncios(
      config({
        fetchFn,
        timeoutMs: 60_000,
        agora: () => inicio,
        prazoEm: inicio + 60_000,
      }),
      [AD1],
    );
    await vi.advanceTimersByTimeAsync(8_000 * 4 + 100);
    const r = await promessa;

    // Insights: 1 chamada, sem retry no silencio. Objeto: 3 (2 novas
    // tentativas). Todas cortadas em 8 s; depois, Meta indisponivel.
    expect(duracoes).toEqual([
      { tipo: "insights", ms: 8_000 },
      { tipo: "objeto", ms: 8_000 },
      { tipo: "objeto", ms: 8_000 },
      { tipo: "objeto", ms: 8_000 },
    ]);
    expect(r).toMatchObject({ ok: false, problema: "meta_indisponivel", acao: "repetir" });
  });
});

describe("7. nada de valor em log nem no resultado", () => {
  it("não escreve nada e não carrega mensagem, token nem URL da Meta", async () => {
    const escritas: string[] = [];
    const guardar = (valor: unknown) => {
      escritas.push(String(valor));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(guardar);
    vi.spyOn(process.stderr, "write").mockImplementation(guardar);
    for (const metodo of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, metodo).mockImplementation(guardar);
    }

    const meta = metaFalsa({
      insights: (adId) =>
        adId === AD1
          ? json({ data: [linhaDoInsights(adId, { campaign_name: "Campanha SEGREDO-DO-NOME" })] })
          : adId === AD2
            ? erroMeta(100, 33)
            : adId === AD4
              ? erroMeta(200, undefined, 403)
              : erroMeta(190, undefined, 401),
    });
    const parcial = ok(
      await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2, AD4]),
    );
    expect(parcial.recusados.map((x) => x.motivo)).toEqual(["inacessivel", "inacessivel"]);
    const interrompida = await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD3]);

    expect(escritas).toEqual([]);

    const recusasSemTexto = JSON.stringify(parcial.recusados);
    const falhaSemTexto = JSON.stringify(interrompida);
    for (const texto of [recusasSemTexto, falhaSemTexto]) {
      expect(texto).not.toContain("SEGREDO");
      expect(texto).not.toContain(TOKEN);
      expect(texto).not.toContain("graph.facebook.com");
      expect(texto).not.toContain("Unsupported");
    }
    expect(interrompida).toEqual({
      ok: false,
      problema: "token_invalido",
      acao: "pausar",
      tentarEmMs: null,
      codigoDaMeta: 190,
      subcodigoDaMeta: null,
      http: 401,
    });
  });
});

describe("8. desfechoDaFalhaDoAnuncio, linha a linha", () => {
  function f(
    problema: FalhaDeLeitura["problema"],
    codigoDaMeta: number | null = null,
    subcodigoDaMeta: number | null = null,
    http: number | null = 400,
  ): FalhaDeLeitura {
    return { ok: false, problema, acao: "desistir", tentarEmMs: null, codigoDaMeta, subcodigoDaMeta, http };
  }

  it.each([
    ["insights", f("prazo_esgotado"), { tipo: "sem_tempo" }],
    ["insights", f("token_invalido", 190), { tipo: "interromper" }],
    ["insights", f("sem_permissao", 200), { tipo: "conferir_conta", codigo: 200 }],
    ["insights", f("sem_permissao", 10), { tipo: "conferir_conta", codigo: 10 }],
    ["insights", f("sem_permissao", 100, 3191001), { tipo: "conferir_conta", codigo: 100 }],
    ["insights", f("sem_permissao", null, null, 403), { tipo: "conferir_conta", codigo: null }],
    ["insights", f("exige_prova_do_app", 100), { tipo: "interromper" }],
    ["insights", f("limite_da_meta", 17), { tipo: "interromper" }],
    ["insights", f("versao_descontinuada", 2635), { tipo: "interromper" }],
    ["insights", f("meta_indisponivel", 2), { tipo: "interromper" }],
    ["insights", f("resposta_invalida", null, null, 200), { tipo: "interromper" }],
    ["insights", f("conta_sem_acesso", 100, 33), { tipo: "recusar", motivo: "inacessivel", codigo: 100 }],
    ["insights", f("conta_sem_acesso", 803), { tipo: "recusar", motivo: "inacessivel", codigo: 803 }],
    ["insights", f("parametro_recusado", 100, null, 404), { tipo: "recusar", motivo: "inacessivel", codigo: 100 }],
    ["insights", f("consulta_pesada", 100, 1504018), { tipo: "ler_objeto" }],
    ["insights", f("parametro_recusado", 2500), { tipo: "recusar", motivo: "resposta_invalida", codigo: 2500 }],
    ["insights", f("outro", 99999), { tipo: "recusar", motivo: "resposta_invalida", codigo: 99999 }],
    ["objeto", f("prazo_esgotado"), { tipo: "sem_tempo" }],
    ["objeto", f("token_invalido", 102), { tipo: "interromper" }],
    ["objeto", f("limite_da_meta", 4), { tipo: "interromper" }],
    ["objeto", f("meta_indisponivel", 1, null, 500), { tipo: "interromper" }],
    ["objeto", f("sem_permissao", 10), { tipo: "recusar", motivo: "sem_entrega_ainda", codigo: 10 }],
    ["objeto", f("exige_prova_do_app", 100), { tipo: "recusar", motivo: "sem_entrega_ainda", codigo: 100 }],
    ["objeto", f("conta_sem_acesso", 100, 33), { tipo: "recusar", motivo: "sem_entrega_ainda", codigo: 100 }],
    ["objeto", f("consulta_pesada", 100, 1504018), { tipo: "recusar", motivo: "sem_entrega_ainda", codigo: 100 }],
  ] as const)("%s, %j", (chamada, falha, esperado) => {
    expect(desfechoDaFalhaDoAnuncio(falha, chamada)).toEqual(esperado);
  });
});

describe("9. paraGravarResolucao", () => {
  it("monta p_resolvidos e p_recusas no formato da gravar_resolucao_de_anuncios_meta", async () => {
    const meta = metaFalsa({
      insights: (adId) =>
        adId === AD2 ? erroMeta(100, 33) : json({ data: [linhaDoInsights(adId)] }),
    });
    const r = ok(await resolverAnuncios(config({ fetchFn: meta.fetchFn }), [AD1, AD2]));
    const payload = paraGravarResolucao(r);
    expect(payload).toEqual({
      p_resolvidos: [
        {
          ad_id: AD1,
          ad_account_id: CONTA,
          campaign_id: CAMPANHA,
          campaign_name: "Botox outubro",
          adset_id: CONJUNTO,
          adset_name: "Mulheres 30 a 55, Fortaleza",
          ad_name: "Anúncio botox vídeo 1",
        },
      ],
      p_recusas: [{ ad_id: AD2, motivo: "inacessivel", codigo: 100 }],
    });

    // Cabe nos tipos gerados da RPC (falha de compilacao se o formato mudar).
    const args: Database["public"]["Functions"]["gravar_resolucao_de_anuncios_meta"]["Args"] = {
      p_job_id: "00000000-0000-0000-0000-000000000000",
      p_worker: "teste",
      p_clinic_id: "00000000-0000-0000-0000-000000000000",
      p_ad_account_id: CONTA,
      p_token_sha256: "0".repeat(64),
      p_resolvidos: payload.p_resolvidos,
      p_recusas: payload.p_recusas,
    };
    expect(args.p_recusas).toBe(payload.p_recusas);
  });

  it("código que o banco não aceita vira null", () => {
    const payload = paraGravarResolucao({
      resolvidos: [],
      recusados: [
        { adId: AD1, motivo: "inacessivel", codigo: 1_000_000_000 },
        { adId: AD2, motivo: "resposta_invalida", codigo: -5 },
        { adId: AD3, motivo: "sem_entrega_ainda", codigo: null },
      ],
    });
    expect(payload.p_recusas.map((x) => x.codigo)).toEqual([null, -5, null]);
  });
});
