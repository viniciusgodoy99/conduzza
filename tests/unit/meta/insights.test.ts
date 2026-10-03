import { describe, expect, it } from "vitest";

import {
  acaoDoProblema,
  classificarErroMeta,
  decimalParaCentavos,
  dividirPeriodo,
  esperaDoLimite,
  janelaNoFusoDaConta,
  lerGastoParaSincronizar,
  MAX_PAGINAS,
  testarLeituraDeAnuncios,
  type ConfigDeLeitura,
} from "@/lib/integrations/meta/insights";
import { enviarEventosCapi } from "@/lib/integrations/meta/capi";
import { GRAPH_VERSION } from "@/lib/integrations/meta/versao";
import { PROBLEMAS_DE_LEITURA, PROBLEMAS_QUE_PAUSAM } from "@/lib/domain/meta-anuncios";

// Leitura do investimento na Meta (Fase 4), com fetch dublado: nada de rede.
// Os 14 casos do levantamento da API (mapa-api-meta, secao 6). O caso 1
// (normalizacao da conta) vive em tests/unit/domain/meta-anuncios.test.ts,
// junto da funcao.

const TOKEN = "EAABtokenDeTeste1234567890SEGREDO";
const CONTA = "act_123456789" as const;
// 12:00 em Sao Paulo (UTC-3), dia 02/10/2026.
const AGORA = Date.parse("2026-10-02T15:00:00.000Z");
const MENSAGEM_DA_META =
  "Error validating access token: Session has expired on Thursday SEGREDO-DA-MENSAGEM";

const CONTA_OK = {
  id: CONTA,
  name: "Clínica Sol",
  currency: "BRL",
  timezone_name: "America/Sao_Paulo",
  account_status: 1,
};

type Chamada = { url: URL; init: RequestInit };

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

function erroMeta(
  code: number,
  subcode?: number,
  status = 400,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Response {
  return json(
    {
      error: {
        message: MENSAGEM_DA_META,
        type: "OAuthException",
        code,
        ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        fbtrace_id: "AbCdEf",
        ...extra,
      },
    },
    status,
    headers,
  );
}

function linhaDeAnuncio(
  dia: string,
  adId: string,
  spend = "10.00",
  extra: Record<string, unknown> = {},
) {
  return {
    ad_id: adId,
    adset_id: "238500000000000001",
    campaign_id: "6720000000000001",
    campaign_name: "Botox outubro",
    spend,
    account_currency: "BRL",
    date_start: dia,
    date_stop: dia,
    ...extra,
  };
}

function linhaDaConta(dia: string, spend = "25.00") {
  return { spend, account_currency: "BRL", date_start: dia, date_stop: dia };
}

/**
 * Meta de mentira: responde a conta, o level=ad e o level=account pelos
 * manipuladores dados, e grava toda chamada (URL e init).
 */
function metaFalsa(rotas: {
  conta?: (url: URL) => Response;
  porAnuncio?: (url: URL, n: number) => Response;
  daConta?: (url: URL, n: number) => Response;
}) {
  const chamadas: Chamada[] = [];
  let nAnuncio = 0;
  let nConta = 0;
  const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, init: init ?? {} });
    if (url.pathname === `/${GRAPH_VERSION}/${CONTA}`) {
      return rotas.conta ? rotas.conta(url) : json(CONTA_OK);
    }
    if (url.pathname === `/${GRAPH_VERSION}/${CONTA}/insights`) {
      if (url.searchParams.get("level") === "ad") {
        nAnuncio += 1;
        return rotas.porAnuncio
          ? rotas.porAnuncio(url, nAnuncio)
          : json({ data: [] });
      }
      nConta += 1;
      return rotas.daConta ? rotas.daConta(url, nConta) : json({ data: [] });
    }
    return json({ error: { code: 803 } }, 404);
  }) as typeof fetch;
  return {
    fetchFn,
    chamadas,
    doNivel(level: string) {
      return chamadas.filter(
        (c) =>
          c.url.pathname.endsWith("/insights") &&
          c.url.searchParams.get("level") === level,
      );
    },
  };
}

function config(extra: Partial<ConfigDeLeitura> = {}): ConfigDeLeitura {
  return {
    adAccountId: CONTA,
    accessToken: TOKEN,
    prazoEm: AGORA + 35_000,
    agora: () => AGORA,
    dormir: async () => {},
    aleatorio: () => 0.5,
    ...extra,
  };
}

function janelaDe(url: URL): { since: string; until: string } {
  return JSON.parse(url.searchParams.get("time_range") ?? "null") as {
    since: string;
    until: string;
  };
}

describe("2. decimalParaCentavos", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12.3", 1230],
    ["12.30", 1230],
    ["12.345", 1235],
    ["12.344", 1234],
    ["12.3449", 1234],
    ["0.005", 1],
    ["12.999", 1300],
    ["3420.00", 342000],
    ["007.5", 750],
  ])("%j vira %d", (valor, esperado) => {
    expect(decimalParaCentavos(valor)).toBe(esperado);
  });

  it.each(["1e3", "-1", "", "12.", ".5", " 12", "12,30", "abc", "99999999999999"])(
    "%j vira null",
    (valor) => {
      expect(decimalParaCentavos(valor)).toBeNull();
    },
  );
});

describe("3. janela no fuso da conta e divisão do período", () => {
  const instante = Date.parse("2026-10-02T02:30:00.000Z");

  it("o dia de hoje é o da CONTA, não o UTC nem o da clínica", () => {
    expect(janelaNoFusoDaConta("America/Sao_Paulo", instante, 30)).toEqual({
      de: "2026-09-02",
      ate: "2026-10-01",
    });
    expect(janelaNoFusoDaConta("Asia/Tokyo", instante, 30)).toEqual({
      de: "2026-09-03",
      ate: "2026-10-02",
    });
    expect(janelaNoFusoDaConta("America/Fortaleza", AGORA, 60)).toEqual({
      de: "2026-08-04",
      ate: "2026-10-02",
    });
  });

  it("divide ao meio, com o dia a mais na primeira metade", () => {
    expect(dividirPeriodo({ de: "2026-09-02", ate: "2026-10-01" })).toEqual([
      { de: "2026-09-02", ate: "2026-09-16" },
      { de: "2026-09-17", ate: "2026-10-01" },
    ]);
    expect(dividirPeriodo({ de: "2026-09-02", ate: "2026-09-16" })).toEqual([
      { de: "2026-09-02", ate: "2026-09-09" },
      { de: "2026-09-10", ate: "2026-09-16" },
    ]);
    expect(() => dividirPeriodo({ de: "2026-09-02", ate: "2026-09-02" })).toThrow();
  });
});

describe("4. requisição montada", () => {
  it("level=ad dia a dia, janela explícita, 8 campos, 500 por página, token só no cabeçalho", async () => {
    const meta = metaFalsa({
      porAnuncio: () => json({ data: [linhaDeAnuncio("2026-10-01", "111")] }),
      daConta: () => json({ data: [linhaDaConta("2026-10-01")] }),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 60,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);

    const [anuncio] = meta.doNivel("ad");
    expect(anuncio).toBeDefined();
    const url = anuncio!.url;
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v26.0/act_123456789/insights");
    expect(url.searchParams.get("level")).toBe("ad");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(janelaDe(url)).toEqual({ since: "2026-08-04", until: "2026-10-02" });
    expect(url.searchParams.get("fields")?.split(",")).toEqual([
      "ad_id",
      "adset_id",
      "campaign_id",
      "campaign_name",
      "spend",
      "account_currency",
      "date_start",
      "date_stop",
    ]);
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.has("date_preset")).toBe(false);

    const [conta] = meta.doNivel("account");
    expect(conta!.url.searchParams.get("fields")).toBe(
      "spend,account_currency,date_start,date_stop",
    );
    expect(janelaDe(conta!.url)).toEqual({
      since: "2026-08-04",
      until: "2026-10-02",
    });

    expect(meta.chamadas).toHaveLength(3);
    for (const chamada of meta.chamadas) {
      const cabecalhos = chamada.init.headers as Record<string, string>;
      expect(cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(chamada.init.method).toBe("GET");
      expect(chamada.url.toString()).not.toContain(TOKEN);
      expect(chamada.url.searchParams.has("access_token")).toBe(false);
      expect(chamada.url.pathname.startsWith(`/${GRAPH_VERSION}/`)).toBe(true);
    }
  });

  it("a conta pede id, nome, moeda, fuso e situação", async () => {
    const meta = metaFalsa({});
    await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(meta.chamadas[0]!.url.pathname).toBe("/v26.0/act_123456789");
    expect(meta.chamadas[0]!.url.searchParams.get("fields")).toBe(
      "id,name,currency,timezone_name,account_status",
    );
  });

  it("conta ou token fora do formato nem chegam a chamar a Meta", async () => {
    const meta = metaFalsa({});
    const semConta = await testarLeituraDeAnuncios(
      config({ fetchFn: meta.fetchFn, adAccountId: "act_12/../me" as `act_${string}` }),
    );
    expect(semConta).toMatchObject({ ok: false, problema: "conta_sem_acesso" });
    const tokenComQuebra = await testarLeituraDeAnuncios(
      config({ fetchFn: meta.fetchFn, accessToken: "abc\r\nX-Outro: 1234567890123" }),
    );
    expect(tokenComQuebra).toMatchObject({ ok: false, problema: "token_invalido" });
    expect(meta.chamadas).toHaveLength(0);
  });
});

describe("5. paginação", () => {
  it("segue pelo cursor after e nunca busca o paging.next", async () => {
    const meta = metaFalsa({
      porAnuncio: (url, n) => {
        if (n === 1) {
          return json({
            data: [linhaDeAnuncio("2026-10-01", "111")],
            paging: {
              cursors: { before: "B0", after: "C1" },
              next: "https://evil.example/roubar?after=C1",
            },
          });
        }
        if (n === 2) {
          expect(url.searchParams.get("after")).toBe("C1");
          // Página vazia com next presente: continua.
          return json({
            data: [],
            paging: { cursors: { after: "C2" }, next: "https://evil.example/2" },
          });
        }
        expect(url.searchParams.get("after")).toBe("C2");
        return json({
          data: [linhaDeAnuncio("2026-10-02", "222")],
          paging: { cursors: { before: "C2" } },
        });
      },
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porAnuncio.map((l) => l.adId)).toEqual(["111", "222"]);
    expect(meta.doNivel("ad")).toHaveLength(3);
    expect(meta.chamadas.every((c) => c.url.host === "graph.facebook.com")).toBe(true);
    expect(r.paginas).toBe(4); // 3 por anúncio + 1 do total da conta
  });

  it("next sem fim para em MAX_PAGINAS com erro", async () => {
    let n = 0;
    const meta = metaFalsa({
      porAnuncio: () => {
        n += 1;
        return json({
          data: [],
          paging: { cursors: { after: `C${n}` }, next: "https://graph.facebook.com/x" },
        });
      },
    });
    // 1 dia: nao da para dividir, entao a consulta pesada volta direto.
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 1,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({ ok: false, problema: "consulta_pesada", acao: "repetir" });
    expect(meta.doNivel("ad")).toHaveLength(MAX_PAGINAS);
  });

  it("next presente sem cursor after é resposta torta", async () => {
    const meta = metaFalsa({
      porAnuncio: () => json({ data: [], paging: { next: "https://graph.facebook.com/x" } }),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({ ok: false, problema: "resposta_invalida" });
  });
});

describe("6. classificarErroMeta, linha a linha", () => {
  const vazio = new Headers();
  it.each([
    [190, undefined, 401, "token_invalido", "pausar"],
    [190, 463, 400, "token_invalido", "pausar"],
    [102, undefined, 400, "token_invalido", "pausar"],
    [200, undefined, 403, "sem_permissao", "pausar"],
    [10, undefined, 400, "sem_permissao", "pausar"],
    [294, undefined, 400, "sem_permissao", "pausar"],
    [100, 3191001, 400, "sem_permissao", "pausar"],
    [100, 33, 400, "conta_sem_acesso", "pausar"],
    [803, undefined, 400, "conta_sem_acesso", "pausar"],
    [100, 1504018, 400, "consulta_pesada", "repetir"],
    [2, 1504038, 400, "consulta_pesada", "repetir"],
    [100, 1487534, 400, "consulta_pesada", "repetir"],
    [2, 1504041, 400, "parametro_recusado", "desistir"],
    [2, 1504042, 400, "parametro_recusado", "desistir"],
    [2, 1504043, 400, "meta_indisponivel", "repetir"],
    [2, 1504044, 400, "meta_indisponivel", "repetir"],
    [2, undefined, 400, "meta_indisponivel", "repetir"],
    [1, undefined, 500, "meta_indisponivel", "repetir"],
    [4, 1504022, 400, "limite_da_meta", "reagendar"],
    [4, 1504039, 400, "limite_da_meta", "reagendar"],
    [17, undefined, 400, "limite_da_meta", "reagendar"],
    [32, undefined, 400, "limite_da_meta", "reagendar"],
    [341, undefined, 400, "limite_da_meta", "reagendar"],
    [613, undefined, 400, "limite_da_meta", "reagendar"],
    [80000, undefined, 400, "limite_da_meta", "reagendar"],
    [80004, undefined, 400, "limite_da_meta", "reagendar"],
    [80014, undefined, 400, "limite_da_meta", "reagendar"],
    [2635, undefined, 400, "versao_descontinuada", "desistir"],
    [100, undefined, 400, "parametro_recusado", "desistir"],
    [3018, undefined, 400, "parametro_recusado", "desistir"],
    [2642, undefined, 400, "resposta_invalida", "repetir"],
    [99999, undefined, 400, "outro", "desistir"],
  ] as const)(
    "código %s/%s (HTTP %s) vira %s e %s",
    (code, subcode, http, problema, acao) => {
      const corpo = {
        error: {
          message: MENSAGEM_DA_META,
          code,
          ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        },
      };
      const r = classificarErroMeta(http, corpo, vazio);
      expect(r).toMatchObject({
        ok: false,
        problema,
        acao,
        codigoDaMeta: code,
        subcodigoDaMeta: subcode ?? null,
        http,
      });
    },
  );

  it("HTTP sem corpo da Meta: 429 limite, 5xx indisponível, 401/403/404 pela situação", () => {
    expect(classificarErroMeta(429, null, vazio).problema).toBe("limite_da_meta");
    expect(classificarErroMeta(500, null, vazio).problema).toBe("meta_indisponivel");
    expect(classificarErroMeta(502, undefined, vazio).problema).toBe("meta_indisponivel");
    expect(classificarErroMeta(401, null, vazio).problema).toBe("token_invalido");
    expect(classificarErroMeta(403, null, vazio).problema).toBe("sem_permissao");
    expect(classificarErroMeta(404, null, vazio).problema).toBe("conta_sem_acesso");
    expect(classificarErroMeta(418, null, vazio).problema).toBe("outro");
  });

  it("is_transient vale como passageiro; appsecret_proof vira a prova do app", () => {
    expect(
      classificarErroMeta(400, { error: { code: 100, is_transient: true } }, vazio)
        .problema,
    ).toBe("meta_indisponivel");
    const prova = classificarErroMeta(
      400,
      {
        error: {
          code: 100,
          message: "API calls from the server require an appsecret_proof argument",
        },
      },
      vazio,
    );
    expect(prova).toMatchObject({ problema: "exige_prova_do_app", acao: "pausar" });
    expect(JSON.stringify(prova)).not.toContain("appsecret");
  });

  it("pausar vale exatamente para os problemas que pausam", () => {
    for (const problema of PROBLEMAS_DE_LEITURA) {
      expect(acaoDoProblema(problema) === "pausar").toBe(
        PROBLEMAS_QUE_PAUSAM.has(problema),
      );
    }
  });
});

describe("7. retry só no passageiro", () => {
  it("código 2 duas vezes e depois 200: 3 chamadas e as esperas com jitter", async () => {
    const esperas: number[] = [];
    let n = 0;
    const meta = metaFalsa({
      conta: () => {
        n += 1;
        return n <= 2 ? erroMeta(2) : json(CONTA_OK);
      },
    });
    const r = await testarLeituraDeAnuncios(
      config({
        fetchFn: meta.fetchFn,
        dormir: async (ms) => {
          esperas.push(ms);
        },
      }),
    );
    expect(r.ok).toBe(true);
    expect(n).toBe(3);
    // Metade fixa mais metade sorteada (0,5): 1 s e 2 s de teto.
    expect(esperas).toEqual([750, 1500]);
  });

  it("5xx três vezes esgota as 2 novas tentativas", async () => {
    let n = 0;
    const meta = metaFalsa({
      conta: () => {
        n += 1;
        return new Response("<html>bad gateway</html>", { status: 502 });
      },
    });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toMatchObject({ ok: false, problema: "meta_indisponivel", http: 502 });
    expect(n).toBe(3);
  });

  it("190 não repete: 1 chamada", async () => {
    let n = 0;
    const meta = metaFalsa({
      conta: () => {
        n += 1;
        return erroMeta(190, undefined, 401);
      },
    });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toMatchObject({ ok: false, problema: "token_invalido", acao: "pausar" });
    expect(n).toBe(1);
  });

  it("limite da Meta não repete aqui e diz quanto esperar pelos cabeçalhos", async () => {
    const casos: [Record<string, string>, number][] = [
      [
        {
          "x-business-use-case-usage": JSON.stringify({
            "123456789": [
              { type: "ads_insights", call_count: 100, estimated_time_to_regain_access: 19 },
            ],
          }),
        },
        1_140_000,
      ],
      [
        { "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 100, reset_time_duration: 100 }) },
        100_000,
      ],
      [{}, 900_000],
    ];
    for (const [cabecalhos, esperado] of casos) {
      let n = 0;
      const meta = metaFalsa({
        conta: () => {
          n += 1;
          return erroMeta(4, 1504022, 400, cabecalhos);
        },
      });
      const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
      expect(r).toMatchObject({
        ok: false,
        problema: "limite_da_meta",
        acao: "reagendar",
        tentarEmMs: esperado,
      });
      expect(n).toBe(1);
    }
  });

  it("esperaDoLimite fica com o maior dos dois cabeçalhos", () => {
    const h = new Headers({
      "x-business-use-case-usage": JSON.stringify({
        a: [{ estimated_time_to_regain_access: 2 }],
      }),
      "x-ad-account-usage": JSON.stringify({ reset_time_duration: 600 }),
    });
    expect(esperaDoLimite(h)).toBe(600_000);
    expect(esperaDoLimite(new Headers({ "x-ad-account-usage": "nao e json" }))).toBe(
      900_000,
    );
  });
});

describe("8. timeout e prazo", () => {
  // A leitura da conta e o teste repetem o timeout; a pagina do Insights nao
  // (secao 12: ela divide o periodo).
  it("fetch que nunca responde (mas respeita o signal) dá indisponível depois de 3 tentativas", async () => {
    let n = 0;
    const fetchFn = ((_url: unknown, init?: RequestInit) => {
      n += 1;
      return new Promise<Response>((_resolve, rejeitar) => {
        init?.signal?.addEventListener("abort", () =>
          rejeitar(new DOMException("aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    const r = await testarLeituraDeAnuncios(
      config({
        fetchFn,
        timeoutMs: 5,
        agora: Date.now,
        prazoEm: Date.now() + 30_000,
      }),
    );
    expect(r).toMatchObject({ ok: false, problema: "meta_indisponivel", http: null });
    expect(n).toBe(3);
  });

  it("prazo que não comporta uma requisição nem chama a Meta", async () => {
    const meta = metaFalsa({});
    const r = await testarLeituraDeAnuncios(
      config({ fetchFn: meta.fetchFn, prazoEm: AGORA + 1_000 }),
    );
    expect(r).toMatchObject({ ok: false, problema: "prazo_esgotado", acao: "repetir" });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("prazo que não comporta espera mais requisição para sem dormir", async () => {
    const esperas: number[] = [];
    const meta = metaFalsa({ conta: () => new Response(null, { status: 503 }) });
    const r = await testarLeituraDeAnuncios(
      config({
        fetchFn: meta.fetchFn,
        prazoEm: AGORA + 2_500,
        dormir: async (ms) => {
          esperas.push(ms);
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, problema: "prazo_esgotado", http: 503 });
    expect(meta.chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it("o relógio que anda durante a leitura corta a página seguinte", async () => {
    let relogio = AGORA;
    const meta = metaFalsa({
      porAnuncio: () => {
        relogio += 34_000;
        return json({
          data: [linhaDeAnuncio("2026-10-01", "111")],
          paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
        });
      },
    });
    const r = await lerGastoParaSincronizar(
      config({ fetchFn: meta.fetchFn, agora: () => relogio }),
      { dias: 30, agoraMs: AGORA },
    );
    expect(r).toMatchObject({ ok: false, problema: "prazo_esgotado" });
    expect(meta.doNivel("ad")).toHaveLength(1);
  });
});

describe("9. ritmo pelos cabeçalhos de uso", () => {
  const pagina1 = (pct: number) =>
    json(
      {
        data: [linhaDeAnuncio("2026-10-01", "111")],
        paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
      },
      200,
      {
        "x-fb-ads-insights-throttle": JSON.stringify({
          app_id_util_pct: pct,
          acc_id_util_pct: 10,
          ads_api_access_tier: "development_access",
        }),
      },
    );

  it("a 80% desacelera entre as páginas", async () => {
    const esperas: number[] = [];
    const meta = metaFalsa({
      porAnuncio: (_url, n) =>
        n === 1 ? pagina1(80) : json({ data: [linhaDeAnuncio("2026-10-02", "222")] }),
    });
    const r = await lerGastoParaSincronizar(
      config({
        fetchFn: meta.fetchFn,
        dormir: async (ms) => {
          esperas.push(ms);
        },
      }),
      { dias: 30, agoraMs: AGORA },
    );
    expect(r.ok).toBe(true);
    expect(esperas).toEqual([2_000]);
  });

  it("a 96% para e devolve o limite, sem pedir a página seguinte", async () => {
    const meta = metaFalsa({ porAnuncio: () => pagina1(96) });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({
      ok: false,
      problema: "limite_da_meta",
      acao: "reagendar",
      tentarEmMs: 900_000,
    });
    expect(meta.doNivel("ad")).toHaveLength(1);
  });
});

describe("10. validação das linhas", () => {
  async function lerCom(linhas: unknown[]) {
    const meta = metaFalsa({ porAnuncio: () => json({ data: linhas }) });
    return lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
  }

  it.each([
    ["dia de início diferente do fim", linhaDeAnuncio("2026-10-01", "1", "1", { date_stop: "2026-10-02" })],
    ["spend em notação científica", linhaDeAnuncio("2026-10-01", "1", "1e3")],
    ["spend negativo", linhaDeAnuncio("2026-10-01", "1", "-5.00")],
    ["outra moeda na linha", linhaDeAnuncio("2026-10-01", "1", "1", { account_currency: "USD" })],
    ["dia fora do período pedido", linhaDeAnuncio("2026-08-01", "1")],
    ["dia que não existe no calendário", linhaDeAnuncio("2026-09-31", "1")],
    ["anúncio sem id numérico", linhaDeAnuncio("2026-10-01", "abc")],
    ["campanha ausente", linhaDeAnuncio("2026-10-01", "1", "1", { campaign_id: undefined })],
    ["conjunto torto", linhaDeAnuncio("2026-10-01", "1", "1", { adset_id: "x-1" })],
  ])("%s dá resposta_invalida", async (_nome, linha) => {
    expect(await lerCom([linha])).toMatchObject({
      ok: false,
      problema: "resposta_invalida",
      acao: "repetir",
    });
  });

  it("(dia, anúncio) repetido na MESMA página dá resposta_invalida, nunca soma", async () => {
    expect(
      await lerCom([
        linhaDeAnuncio("2026-10-01", "1", "10.00"),
        linhaDeAnuncio("2026-10-01", "1", "5.00"),
      ]),
    ).toMatchObject({ ok: false, problema: "resposta_invalida" });
  });

  it("repetido entre páginas (cursor que andou) fica com a última leitura, sem somar", async () => {
    const meta = metaFalsa({
      porAnuncio: (_url, n) =>
        n === 1
          ? json({
              data: [linhaDeAnuncio("2026-10-01", "1", "10.00")],
              paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
            })
          : json({ data: [linhaDeAnuncio("2026-10-01", "1", "12.50")] }),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porAnuncio).toHaveLength(1);
    expect(r.porAnuncio[0]!.spendCents).toBe(1250);
  });

  it("linha boa sai tipada, com conjunto opcional e nome aparado", async () => {
    const r = await lerCom([
      linhaDeAnuncio("2026-10-01", "1", "18.40", {
        adset_id: undefined,
        campaign_name: "  Botox  ",
      }),
      linhaDeAnuncio("2026-09-30", "2", "0", { campaign_name: null }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porAnuncio).toEqual([
      {
        dia: "2026-09-30",
        adId: "2",
        adsetId: "238500000000000001",
        campaignId: "6720000000000001",
        campaignName: null,
        spendCents: 0,
      },
      {
        dia: "2026-10-01",
        adId: "1",
        adsetId: null,
        campaignId: "6720000000000001",
        campaignName: "Botox",
        spendCents: 1840,
      },
    ]);
  });

  it("total da conta com dia repetido na página também é resposta torta", async () => {
    const meta = metaFalsa({
      daConta: () =>
        json({ data: [linhaDaConta("2026-10-01"), linhaDaConta("2026-10-01")] }),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({ ok: false, problema: "resposta_invalida" });
  });
});

describe("11. cursor inválido (2642)", () => {
  it("recomeça a paginação uma vez", async () => {
    let falhou = false;
    const meta = metaFalsa({
      porAnuncio: (url) => {
        const after = url.searchParams.get("after");
        if (after === null) {
          return json({
            data: [linhaDeAnuncio("2026-10-01", "1")],
            paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
          });
        }
        if (!falhou) {
          falhou = true;
          return erroMeta(2642);
        }
        return json({ data: [linhaDeAnuncio("2026-10-02", "2")] });
      },
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porAnuncio.map((l) => l.adId)).toEqual(["1", "2"]);
    // 1 (primeira pagina), 2642, recomeco (primeira pagina), segunda pagina.
    expect(meta.doNivel("ad")).toHaveLength(4);
  });

  it("na segunda vez, erro", async () => {
    const meta = metaFalsa({
      porAnuncio: (url) =>
        url.searchParams.get("after") === null
          ? json({
              data: [],
              paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
            })
          : erroMeta(2642),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({
      ok: false,
      problema: "resposta_invalida",
      codigoDaMeta: 2642,
    });
  });
});

describe("12. consulta pesada divide o período", () => {
  it("30 dias falham e as duas metades passam: 3 chamadas e as linhas unidas", async () => {
    const meta = metaFalsa({
      porAnuncio: (url, n) => {
        if (n === 1) return erroMeta(100, 1504018);
        const { since } = janelaDe(url);
        return json({ data: [linhaDeAnuncio(since, n === 2 ? "1" : "2")] });
      },
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(meta.doNivel("ad").map((c) => janelaDe(c.url))).toEqual([
      { since: "2026-09-03", until: "2026-10-02" },
      { since: "2026-09-03", until: "2026-09-17" },
      { since: "2026-09-18", until: "2026-10-02" },
    ]);
    expect(r.porAnuncio).toEqual([
      expect.objectContaining({ dia: "2026-09-03", adId: "1" }),
      expect.objectContaining({ dia: "2026-09-18", adId: "2" }),
    ]);
    expect(r.periodo).toEqual({ de: "2026-09-03", ate: "2026-10-02" });
  });

  it("divide no máximo 2 níveis e então desiste da leitura", async () => {
    const meta = metaFalsa({ porAnuncio: () => erroMeta(2, 1504038) });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({ ok: false, problema: "consulta_pesada" });
    // 30 dias, depois 15, depois 8: a primeira metade de cada nivel falha e
    // corta o resto.
    expect(meta.doNivel("ad").map((c) => janelaDe(c.url))).toEqual([
      { since: "2026-09-03", until: "2026-10-02" },
      { since: "2026-09-03", until: "2026-09-17" },
      { since: "2026-09-03", until: "2026-09-10" },
    ]);
  });

  // Pagina do Insights que nao responde dentro do NOSSO timeout: o timeout
  // da Meta costuma passar dos nossos 15 s, entao o codigo 1504018 nunca
  // chega a tempo. Repetir a mesma consulta so gastaria o prazo.
  function semResposta(init?: RequestInit): Promise<Response> {
    return new Promise<Response>((_resolve, rejeitar) => {
      init?.signal?.addEventListener("abort", () =>
        rejeitar(new DOMException("aborted", "AbortError")),
      );
    });
  }

  /** Cala as chamadas escolhidas (gravando-as) e repassa o resto a Meta falsa. */
  function comSilencio(
    meta: ReturnType<typeof metaFalsa>,
    calar: (url: URL) => boolean,
  ): typeof fetch {
    return ((entrada: unknown, init?: RequestInit) => {
      const url = new URL(String(entrada));
      if (calar(url)) {
        meta.chamadas.push({ url, init: init ?? {} });
        return semResposta(init);
      }
      return meta.fetchFn(String(entrada), init);
    }) as typeof fetch;
  }

  it.each([
    {
      dias: 30,
      cheia: { since: "2026-09-03", until: "2026-10-02" },
      primeira: { since: "2026-09-03", until: "2026-09-17" },
      segunda: { since: "2026-09-18", until: "2026-10-02" },
    },
    {
      dias: 60,
      cheia: { since: "2026-08-04", until: "2026-10-02" },
      primeira: { since: "2026-08-04", until: "2026-09-02" },
      segunda: { since: "2026-09-03", until: "2026-10-02" },
    },
  ])(
    "página do Insights sem resposta a tempo divide em vez de repetir ($dias dias)",
    async ({ dias, cheia, primeira, segunda }) => {
      const meta = metaFalsa({
        porAnuncio: (url) => {
          const { since } = janelaDe(url);
          return json({
            data: [linhaDeAnuncio(since, since === primeira.since ? "1" : "2")],
          });
        },
      });
      const fetchFn = comSilencio(
        meta,
        (url) =>
          url.searchParams.get("level") === "ad" &&
          url.searchParams.get("time_range") === JSON.stringify(cheia),
      );
      const r = await lerGastoParaSincronizar(
        config({ fetchFn, timeoutMs: 5 }),
        { dias, agoraMs: AGORA },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // A janela cheia uma unica vez, depois as duas metades.
      expect(meta.doNivel("ad").map((c) => janelaDe(c.url))).toEqual([
        cheia,
        primeira,
        segunda,
      ]);
      expect(r.porAnuncio).toEqual([
        expect.objectContaining({ dia: primeira.since, adId: "1" }),
        expect.objectContaining({ dia: segunda.since, adId: "2" }),
      ]);
      expect(r.periodo).toEqual({ de: cheia.since, ate: cheia.until });
    },
  );

  it("silêncio em todos os níveis: nenhuma janela repetida e o job tenta depois", async () => {
    const meta = metaFalsa({});
    const fetchFn = comSilencio(
      meta,
      (url) => url.searchParams.get("level") === "ad",
    );
    const r = await lerGastoParaSincronizar(config({ fetchFn, timeoutMs: 5 }), {
      dias: 30,
      agoraMs: AGORA,
    });
    // No ultimo nivel o silencio volta a ser indisponibilidade da Meta: o
    // backoff do job repete. Nada da marca interna vaza no resultado.
    expect(r).toEqual({
      ok: false,
      problema: "meta_indisponivel",
      acao: "repetir",
      tentarEmMs: null,
      codigoDaMeta: null,
      subcodigoDaMeta: null,
      http: null,
    });
    expect(meta.doNivel("ad").map((c) => janelaDe(c.url))).toEqual([
      { since: "2026-09-03", until: "2026-10-02" },
      { since: "2026-09-03", until: "2026-09-17" },
      { since: "2026-09-03", until: "2026-09-10" },
    ]);
    expect(meta.doNivel("account")).toHaveLength(0);
  });

  it("falha de rede rápida na página do Insights continua repetindo, sem dividir", async () => {
    const meta = metaFalsa({
      porAnuncio: (url) =>
        json({ data: [linhaDeAnuncio(janelaDe(url).since, "1")] }),
    });
    let falhas = 0;
    const fetchFn = ((entrada: unknown, init?: RequestInit) => {
      const url = new URL(String(entrada));
      if (url.searchParams.get("level") === "ad" && falhas < 2) {
        falhas += 1;
        meta.chamadas.push({ url, init: init ?? {} });
        return Promise.reject(new TypeError("fetch failed"));
      }
      return meta.fetchFn(String(entrada), init);
    }) as typeof fetch;
    const r = await lerGastoParaSincronizar(config({ fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    const cheia = { since: "2026-09-03", until: "2026-10-02" };
    expect(meta.doNivel("ad").map((c) => janelaDe(c.url))).toEqual([
      cheia,
      cheia,
      cheia,
    ]);
  });
});

describe("13. conta e teste", () => {
  it("conta desativada continua legível, com ativa=false", async () => {
    const meta = metaFalsa({ conta: () => json({ ...CONTA_OK, account_status: 2 }) });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toMatchObject({ ok: true, conta: { status: 2, ativa: false } });
  });

  it.each([
    ["sem fuso", { timezone_name: undefined }],
    ["fuso que não existe", { timezone_name: "America/Nao_Existe" }],
    ["sem moeda", { currency: undefined }],
    ["moeda torta", { currency: "real" }],
    ["sem situação", { account_status: undefined }],
    ["outra conta", { id: "act_999999999" }],
  ])("%s dá resposta_invalida", async (_nome, extra) => {
    const meta = metaFalsa({ conta: () => json({ ...CONTA_OK, ...extra }) });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toMatchObject({ ok: false, problema: "resposta_invalida" });
  });

  it("o teste faz 2 chamadas e data vazia é ok sem gasto", async () => {
    const meta = metaFalsa({ daConta: () => json({ data: [] }) });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toEqual({
      ok: true,
      conta: {
        id: CONTA,
        nome: "Clínica Sol",
        moeda: "BRL",
        fuso: "America/Sao_Paulo",
        status: 1,
        ativa: true,
      },
      temGastoEm30Dias: false,
    });
    expect(meta.chamadas).toHaveLength(2);
    const segunda = meta.chamadas[1]!.url;
    expect(segunda.pathname).toBe("/v26.0/act_123456789/insights");
    expect(Object.fromEntries(segunda.searchParams)).toEqual({
      level: "account",
      fields: "spend",
      date_preset: "last_30d",
      limit: "1",
    });
  });

  it("com gasto nos 30 dias, temGastoEm30Dias=true", async () => {
    const meta = metaFalsa({ daConta: () => json({ data: [{ spend: "3420.00" }] }) });
    const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
    expect(r).toMatchObject({ ok: true, temGastoEm30Dias: true });
  });

  it("a moeda e o fuso da conta seguem para a leitura do job", async () => {
    const meta = metaFalsa({
      conta: () => json({ ...CONTA_OK, currency: "USD", timezone_name: "Asia/Tokyo" }),
      porAnuncio: () =>
        json({ data: [linhaDeAnuncio("2026-10-03", "1", "1", { account_currency: "USD" })] }),
    });
    // 15:00Z de 02/10 ja e 03/10 em Toquio.
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r).toMatchObject({
      ok: true,
      conta: { moeda: "USD", fuso: "Asia/Tokyo" },
      periodo: { de: "2026-09-04", ate: "2026-10-03" },
    });
  });
});

describe("14. privacidade", () => {
  it("nenhum resultado carrega o token nem a mensagem da Meta", async () => {
    const respostas: (() => Response)[] = [
      () => erroMeta(190, 460, 401),
      () => erroMeta(10),
      () => erroMeta(100, 33),
      () => erroMeta(4, 1504022),
      () => erroMeta(2635),
      () => erroMeta(99999),
      () => new Response(MENSAGEM_DA_META, { status: 500 }),
      () => json({ notData: MENSAGEM_DA_META }),
    ];
    for (const resposta of respostas) {
      const meta = metaFalsa({ conta: resposta });
      const r = await testarLeituraDeAnuncios(config({ fetchFn: meta.fetchFn }));
      expect(r.ok).toBe(false);
      const texto = JSON.stringify(r);
      expect(texto).not.toContain(TOKEN);
      expect(texto).not.toContain("SEGREDO");
      expect(texto).not.toContain("Session has expired");
      expect(Object.keys(r).sort()).toEqual(
        [
          "acao",
          "codigoDaMeta",
          "http",
          "ok",
          "problema",
          "subcodigoDaMeta",
          "tentarEmMs",
        ].sort(),
      );
    }
  });

  it("nem o resultado de sucesso carrega o token", async () => {
    const meta = metaFalsa({
      porAnuncio: () => json({ data: [linhaDeAnuncio("2026-10-01", "1")] }),
    });
    const r = await lerGastoParaSincronizar(config({ fetchFn: meta.fetchFn }), {
      dias: 30,
      agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("versão da Graph (C10)", () => {
  it("Insights e Conversions API usam a mesma versão, a de versao.ts", async () => {
    expect(GRAPH_VERSION).toBe("v26.0");
    let urlDaCapi = "";
    const fetchFn = (async (url: unknown) => {
      urlDaCapi = String(url);
      return json({ events_received: 1 });
    }) as typeof fetch;
    await enviarEventosCapi(
      { pixelId: "111222333", accessToken: "tok", testEventCode: null, fetchFn },
      [],
    );
    expect(new URL(urlDaCapi).pathname).toBe(`/${GRAPH_VERSION}/111222333/events`);
  });
});
