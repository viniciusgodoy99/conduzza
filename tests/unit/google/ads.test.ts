import { describe, expect, it } from "vitest";

import {
  buscar,
  conferirConvite,
  CONSULTA_DA_CONTA,
  convidarContaPelaMcc,
  lerCliquesPorGclid,
  lerDadosDaConta,
  lerGastoDiarioPorCampanha,
  listarContasAcessiveis,
  listarHierarquia,
  MAX_PAGINAS,
  microsParaCentavos,
  montarConsultaDeCliques,
  montarConsultaDoGasto,
  normalizarCustomerId,
  normalizarMicros,
  type ConfigDoAds,
} from "@/lib/integrations/google/ads";
import { GOOGLE_ADS_API_VERSION } from "@/lib/integrations/google/versao";

// Google Ads API em REST (F2.2), com fetch falso: nada de rede.

const TOKEN = "ya29.a0AccessTokenDoAds-SEGREDO";
const CLIENTE = "1234567890";
const MCC = "9876543210";
const GCLID = "Cj0KCQjwgclidDeTeste_123-abc";
const MENSAGEM =
  "User doesn't have permission to access customer SEGREDO-DA-MENSAGEM";

type Chamada = {
  url: URL;
  init: RequestInit;
  corpo: Record<string, unknown> | null;
  headers: Record<string, string>;
};

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

function erroAds(
  http: number,
  status: string,
  errorCode: Record<string, string>,
  retryDelay?: string,
): Response {
  return json(
    {
      error: {
        code: http,
        message: MENSAGEM,
        status,
        details: [
          {
            "@type": `type.googleapis.com/google.ads.googleads.${GOOGLE_ADS_API_VERSION}.errors.GoogleAdsFailure`,
            errors: [
              {
                errorCode,
                message: MENSAGEM,
                ...(retryDelay
                  ? { details: { quotaErrorDetails: { retryDelay } } }
                  : {}),
              },
            ],
            requestId: "reqDoErro1",
          },
        ],
      },
    },
    http,
  );
}

/** Google de mentira: responde pela funcao dada e grava toda chamada. */
function googleFalso(responder: (chamada: Chamada, n: number) => Response) {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
    const texto = typeof init?.body === "string" ? init.body : null;
    const chamada: Chamada = {
      url: new URL(String(entrada)),
      init: init ?? {},
      corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    chamadas.push(chamada);
    return responder(chamada, chamadas.length);
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

function config(
  fetchFn: typeof fetch,
  extra: Partial<ConfigDoAds> = {},
): ConfigDoAds {
  return {
    accessToken: TOKEN,
    fetchFn,
    dormir: async () => {},
    aleatorio: () => 0,
    ...extra,
  };
}

function linhaDeGasto(
  dia: string,
  campanha: string,
  micros: string | undefined,
  nome = "Botox outubro",
) {
  return {
    customer: {
      resourceName: `customers/${CLIENTE}`,
      currencyCode: "BRL",
      timeZone: "America/Fortaleza",
    },
    campaign: {
      resourceName: `customers/${CLIENTE}/campaigns/${campanha}`,
      id: campanha,
      name: nome,
    },
    segments: { date: dia },
    metrics: micros === undefined ? {} : { costMicros: micros },
  };
}

const PERIODO = { de: "2026-09-01", ate: "2026-09-30" };

describe("funcoes puras", () => {
  it("normalizarCustomerId", () => {
    expect(normalizarCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizarCustomerId(" 1234567890 ")).toBe("1234567890");
    expect(normalizarCustomerId("123456789")).toBeNull();
    expect(normalizarCustomerId("1234567890/../x")).toBeNull();
    expect(normalizarCustomerId("abc-def-ghij")).toBeNull();
  });

  it("micros para centavos, meio para cima, sem float", () => {
    expect(microsParaCentavos("12345678")).toBe(1235); // 12,345678
    expect(microsParaCentavos("12344999")).toBe(1234);
    expect(microsParaCentavos("5000")).toBe(1); // meio centavo sobe
    expect(microsParaCentavos("4999")).toBe(0);
    expect(microsParaCentavos("0")).toBe(0);
    expect(microsParaCentavos(1_000_000)).toBe(100);
    expect(microsParaCentavos("9223372036854775807")).toBe(922337203685478);
    expect(microsParaCentavos("-1")).toBeNull();
    expect(microsParaCentavos("1e6")).toBeNull();
    expect(microsParaCentavos("1.5")).toBeNull();
    expect(microsParaCentavos("")).toBeNull();
    expect(microsParaCentavos("9223372036854775808")).toBeNull(); // acima do int64
    expect(normalizarMicros("000123")).toBe("123");
  });

  it("consultas so com valores validados", () => {
    expect(montarConsultaDoGasto(PERIODO)).toBe(
      "SELECT customer.currency_code, customer.time_zone, campaign.id, campaign.name, " +
        "segments.date, metrics.cost_micros FROM campaign " +
        "WHERE segments.date BETWEEN '2026-09-01' AND '2026-09-30' AND metrics.cost_micros > 0",
    );
    expect(
      montarConsultaDeCliques("2026-10-01", ["a1234567", "b1234567"]),
    ).toContain("click_view.gclid IN ('a1234567', 'b1234567')");
  });
});

describe("cabecalhos e endereco", () => {
  it("manda Authorization e login-customer-id, e nunca developer-token", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({ results: [] }));
    await buscar(
      config(fetchFn, { loginCustomerId: "987-654-3210" }),
      "123-456-7890",
      CONSULTA_DA_CONTA,
    );
    const chamada = chamadas[0]!;
    expect(chamada.url.toString()).toBe(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${CLIENTE}/googleAds:search`,
    );
    expect(chamada.init.method).toBe("POST");
    expect(chamada.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(chamada.headers["login-customer-id"]).toBe(MCC);
    const nomes = Object.keys(chamada.headers).map((n) => n.toLowerCase());
    expect(nomes).not.toContain("developer-token");
    expect(chamada.url.toString()).not.toContain("SEGREDO");
    expect(chamada.corpo).toEqual({ query: CONSULTA_DA_CONTA });
  });

  it("sem loginCustomerId, nao manda o cabecalho", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({ results: [] }));
    await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA);
    expect(
      Object.keys(chamadas[0]!.headers).map((n) => n.toLowerCase()),
    ).not.toContain("login-customer-id");
  });

  it("customer id ou login fora do formato nem chama o Google", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({ results: [] }));
    expect(
      await buscar(config(fetchFn), "../../evil", CONSULTA_DA_CONTA),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(
      await buscar(
        config(fetchFn, { loginCustomerId: "abc" }),
        CLIENTE,
        CONSULTA_DA_CONTA,
      ),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(
      await buscar(
        config(fetchFn, { accessToken: "x" }),
        CLIENTE,
        CONSULTA_DA_CONTA,
      ),
    ).toMatchObject({ problema: "credencial_invalida" });
    expect(chamadas).toHaveLength(0);
  });
});

describe("paginacao", () => {
  it("segue o nextPageToken com a MESMA consulta e o pageToken no corpo", async () => {
    const { fetchFn, chamadas } = googleFalso((chamada) => {
      const token = chamada.corpo?.pageToken;
      if (token === undefined)
        return json({ results: [{ n: 1 }, { n: 2 }], nextPageToken: "pag2" });
      if (token === "pag2")
        return json({ results: [{ n: 3 }], nextPageToken: "pag3" });
      return json({ results: [{ n: 4 }] });
    });
    const r = await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA);
    expect(r).toEqual({
      ok: true,
      linhas: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
      paginas: 3,
    });
    expect(chamadas.map((c) => c.corpo)).toEqual([
      { query: CONSULTA_DA_CONTA },
      { query: CONSULTA_DA_CONTA, pageToken: "pag2" },
      { query: CONSULTA_DA_CONTA, pageToken: "pag3" },
    ]);
    expect(chamadas.every((c) => !c.url.search)).toBe(true);
  });

  it("token de pagina vencido recomeca do zero uma vez", async () => {
    let vencido = true;
    const { fetchFn, chamadas } = googleFalso((chamada) => {
      const token = chamada.corpo?.pageToken;
      if (token === undefined)
        return json({ results: [{ n: 1 }], nextPageToken: "pag2" });
      if (vencido) {
        vencido = false;
        return erroAds(400, "INVALID_ARGUMENT", {
          requestError: "EXPIRED_PAGE_TOKEN",
        });
      }
      return json({ results: [{ n: 2 }] });
    });
    const r = await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA);
    expect(r).toEqual({ ok: true, linhas: [{ n: 1 }, { n: 2 }], paginas: 2 });
    expect(chamadas).toHaveLength(4);
  });

  it("token de pagina invalido duas vezes devolve o erro", async () => {
    const { fetchFn } = googleFalso((chamada) =>
      chamada.corpo?.pageToken === undefined
        ? json({ results: [{ n: 1 }], nextPageToken: "pag2" })
        : erroAds(400, "INVALID_ARGUMENT", {
            requestError: "INVALID_PAGE_TOKEN",
          }),
    );
    expect(
      await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA),
    ).toMatchObject({
      ok: false,
      problema: "parametro_recusado",
      codigoDoGoogle: "INVALID_PAGE_TOKEN",
    });
  });

  it("pagina demais e consulta pesada", async () => {
    const { fetchFn, chamadas } = googleFalso((_c, n) =>
      json({ results: [{ n }], nextPageToken: `p${n + 1}` }),
    );
    expect(
      await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA),
    ).toMatchObject({ problema: "consulta_pesada" });
    expect(chamadas).toHaveLength(MAX_PAGINAS);
  });

  it("consulta sem linha pode vir sem results", async () => {
    const { fetchFn } = googleFalso(() => json({ fieldMask: "customer.id" }));
    expect(await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA)).toEqual({
      ok: true,
      linhas: [],
      paginas: 1,
    });
  });
});

describe("erros", () => {
  it("erro definitivo (USER_PERMISSION_DENIED) nao repete e nao leva a mensagem", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      erroAds(403, "PERMISSION_DENIED", {
        authorizationError: "USER_PERMISSION_DENIED",
      }),
    );
    const r = await lerDadosDaConta(config(fetchFn), CLIENTE);
    expect(r).toEqual({
      ok: false,
      problema: "sem_permissao",
      acao: "pausar",
      transitorio: false,
      tentarEmMs: null,
      codigoDoGoogle: "USER_PERMISSION_DENIED",
      http: 403,
      requestId: "reqDoErro1",
    });
    expect(chamadas).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
  });

  it("CUSTOMER_NOT_ENABLED e AUTHENTICATION_ERROR tambem nao repetem", async () => {
    for (const [codigo, problema] of [
      [{ authorizationError: "CUSTOMER_NOT_ENABLED" }, "conta_inativa"],
      [{ authenticationError: "AUTHENTICATION_ERROR" }, "credencial_invalida"],
    ] as const) {
      const { fetchFn, chamadas } = googleFalso(() =>
        erroAds(403, "PERMISSION_DENIED", codigo),
      );
      expect(await lerDadosDaConta(config(fetchFn), CLIENTE)).toMatchObject({
        problema,
      });
      expect(chamadas).toHaveLength(1);
    }
  });

  it("INTERNAL_ERROR repete e depois le", async () => {
    const { fetchFn, chamadas } = googleFalso((_c, n) =>
      n === 1
        ? erroAds(500, "INTERNAL", { internalError: "INTERNAL_ERROR" })
        : json({ results: [] }),
    );
    expect((await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA)).ok).toBe(
      true,
    );
    expect(chamadas).toHaveLength(2);
  });

  it("RESOURCE_EXHAUSTED com espera longa volta para reagendar, com a espera", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      erroAds(
        429,
        "RESOURCE_EXHAUSTED",
        { quotaError: "RESOURCE_EXHAUSTED" },
        "1800s",
      ),
    );
    expect(
      await buscar(config(fetchFn), CLIENTE, CONSULTA_DA_CONTA),
    ).toMatchObject({
      problema: "limite_do_google",
      acao: "reagendar",
      tentarEmMs: 1_800_000,
    });
    expect(chamadas).toHaveLength(1);
  });
});

describe("(Q1) gasto diario por campanha", () => {
  it("le, converte micros e devolve moeda e fuso da conta", async () => {
    const { fetchFn, chamadas } = googleFalso((chamada) =>
      chamada.corpo?.pageToken === undefined
        ? json({
            results: [
              linhaDeGasto("2026-09-02", "222", "12345678"),
              linhaDeGasto("2026-09-01", "111", "1000000", "  Lentes  "),
            ],
            nextPageToken: "p2",
          })
        : json({ results: [linhaDeGasto("2026-09-01", "222", "5000")] }),
    );
    const r = await lerGastoDiarioPorCampanha(
      config(fetchFn),
      CLIENTE,
      PERIODO,
    );
    expect(r).toEqual({
      ok: true,
      moeda: "BRL",
      fuso: "America/Fortaleza",
      paginas: 2,
      linhas: [
        {
          dia: "2026-09-01",
          campaignId: "111",
          campaignName: "Lentes",
          custoMicros: "1000000",
          custoCentavos: 100,
        },
        {
          dia: "2026-09-01",
          campaignId: "222",
          campaignName: "Botox outubro",
          custoMicros: "5000",
          custoCentavos: 1,
        },
        {
          dia: "2026-09-02",
          campaignId: "222",
          campaignName: "Botox outubro",
          custoMicros: "12345678",
          custoCentavos: 1235,
        },
      ],
    });
    expect(chamadas[0]!.corpo?.query).toBe(montarConsultaDoGasto(PERIODO));
  });

  it("custo ausente vale zero (proto3 omite o padrao)", async () => {
    const { fetchFn } = googleFalso(() =>
      json({ results: [linhaDeGasto("2026-09-03", "111", undefined)] }),
    );
    const r = await lerGastoDiarioPorCampanha(
      config(fetchFn),
      CLIENTE,
      PERIODO,
    );
    expect(r.ok && r.linhas[0]).toMatchObject({
      custoMicros: "0",
      custoCentavos: 0,
    });
  });

  it("sem gasto: lista vazia, moeda e fuso null", async () => {
    const { fetchFn } = googleFalso(() => json({}));
    expect(
      await lerGastoDiarioPorCampanha(config(fetchFn), CLIENTE, PERIODO),
    ).toEqual({
      ok: true,
      moeda: null,
      fuso: null,
      linhas: [],
      paginas: 1,
    });
  });

  it("linha torta, fora da janela ou repetida na pagina e resposta invalida", async () => {
    const tortas = [
      [linhaDeGasto("2026-10-01", "111", "1")], // fora da janela
      [linhaDeGasto("2026-09-31", "111", "1")], // dia inexistente
      [linhaDeGasto("2026-09-01", "abc", "1")], // id nao numerico
      [linhaDeGasto("2026-09-01", "111", "-5")], // custo negativo
      [
        linhaDeGasto("2026-09-01", "111", "1"),
        linhaDeGasto("2026-09-01", "111", "2"),
      ], // repetida
      [
        linhaDeGasto("2026-09-01", "111", "1"),
        {
          ...linhaDeGasto("2026-09-02", "111", "1"),
          customer: { currencyCode: "USD", timeZone: "America/Fortaleza" },
        },
      ],
    ];
    for (const results of tortas) {
      const { fetchFn } = googleFalso(() => json({ results }));
      expect(
        await lerGastoDiarioPorCampanha(config(fetchFn), CLIENTE, PERIODO),
      ).toMatchObject({
        problema: "resposta_invalida",
      });
    }
  });

  it("periodo invalido nem chama o Google", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({}));
    for (const periodo of [
      { de: "2026-09-30", ate: "2026-09-01" },
      { de: "2026-01-01", ate: "2026-12-31" },
      { de: "2026-09-01' OR '1'='1", ate: "2026-09-30" },
    ]) {
      expect(
        await lerGastoDiarioPorCampanha(config(fetchFn), CLIENTE, periodo),
      ).toMatchObject({
        problema: "entrada_invalida",
      });
    }
    expect(chamadas).toHaveLength(0);
  });
});

describe("(Q2) dados da conta", () => {
  it("le nome, moeda, fuso, situacao e o padrao false dos booleanos", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      json({
        results: [
          {
            customer: {
              resourceName: `customers/${CLIENTE}`,
              id: CLIENTE,
              descriptiveName: "Clínica Sol",
              currencyCode: "BRL",
              timeZone: "America/Sao_Paulo",
              status: "ENABLED",
            },
          },
        ],
      }),
    );
    expect(await lerDadosDaConta(config(fetchFn), CLIENTE)).toEqual({
      ok: true,
      conta: {
        id: CLIENTE,
        nome: "Clínica Sol",
        moeda: "BRL",
        fuso: "America/Sao_Paulo",
        status: "ENABLED",
        ativa: true,
        gerente: false,
        contaDeTeste: false,
      },
    });
    expect(chamadas[0]!.corpo?.query).toBe(CONSULTA_DA_CONTA);
  });

  it("conta de administrador volta com gerente true; id trocado e resposta invalida", async () => {
    const conta = (id: string) => ({
      results: [
        {
          customer: {
            id,
            currencyCode: "BRL",
            timeZone: "America/Sao_Paulo",
            status: "ENABLED",
            manager: true,
          },
        },
      ],
    });
    const ok = googleFalso(() => json(conta(CLIENTE)));
    const lida = await lerDadosDaConta(config(ok.fetchFn), CLIENTE);
    expect(lida.ok && lida.conta.gerente).toBe(true);
    const trocado = googleFalso(() => json(conta("1111111111")));
    expect(
      await lerDadosDaConta(config(trocado.fetchFn), CLIENTE),
    ).toMatchObject({ problema: "resposta_invalida" });
  });
});

describe("(Q3) contas acessiveis e hierarquia", () => {
  it("listAccessibleCustomers por GET, sem login-customer-id", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      json({
        resourceNames: [
          `customers/${CLIENTE}`,
          `customers/${MCC}`,
          `customers/${CLIENTE}`,
        ],
      }),
    );
    const r = await listarContasAcessiveis(
      config(fetchFn, { loginCustomerId: MCC }),
    );
    expect(r).toEqual({ ok: true, contas: [CLIENTE, MCC] });
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(chamadas[0]!.url.pathname).toBe(
      `/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    );
    expect(
      Object.keys(chamadas[0]!.headers).map((n) => n.toLowerCase()),
    ).not.toContain("login-customer-id");
  });

  it("nenhuma conta pode vir sem resourceNames", async () => {
    const { fetchFn } = googleFalso(() => json({}));
    expect(await listarContasAcessiveis(config(fetchFn))).toEqual({
      ok: true,
      contas: [],
    });
  });

  it("hierarquia pelo customer_client, com nivel ausente valendo 0", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      json({
        results: [
          {
            customerClient: {
              clientCustomer: `customers/${CLIENTE}`,
              id: CLIENTE,
              level: "1",
              descriptiveName: "Clínica Sol",
              currencyCode: "BRL",
              timeZone: "America/Fortaleza",
              status: "ENABLED",
            },
          },
          {
            customerClient: {
              clientCustomer: `customers/${MCC}`,
              id: MCC,
              descriptiveName: "Agência",
              manager: true,
              status: "ENABLED",
              currencyCode: "BRL",
              timeZone: "America/Sao_Paulo",
            },
          },
        ],
      }),
    );
    const r = await listarHierarquia(
      config(fetchFn, { loginCustomerId: MCC }),
      MCC,
    );
    expect(r).toEqual({
      ok: true,
      contas: [
        {
          id: MCC,
          nome: "Agência",
          nivel: 0,
          gerente: true,
          status: "ENABLED",
          moeda: "BRL",
          fuso: "America/Sao_Paulo",
          contaDeTeste: false,
          oculta: false,
        },
        {
          id: CLIENTE,
          nome: "Clínica Sol",
          nivel: 1,
          gerente: false,
          status: "ENABLED",
          moeda: "BRL",
          fuso: "America/Fortaleza",
          contaDeTeste: false,
          oculta: false,
        },
      ],
    });
    expect(chamadas[0]!.url.pathname).toBe(
      `/${GOOGLE_ADS_API_VERSION}/customers/${MCC}/googleAds:search`,
    );
    expect(String(chamadas[0]!.corpo?.query)).toContain(
      "FROM customer_client WHERE customer_client.level <= 1",
    );
    expect(chamadas[0]!.headers["login-customer-id"]).toBe(MCC);
  });
});

describe("(Q4) click_view por gclid num dia", () => {
  it("consulta um dia e devolve a campanha de cada gclid", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      json({
        results: [
          {
            clickView: { resourceName: "x", gclid: GCLID },
            campaign: { id: "333", name: "Implante" },
            adGroup: { id: "444" },
            segments: { date: "2026-10-01" },
          },
        ],
      }),
    );
    const r = await lerCliquesPorGclid(config(fetchFn), CLIENTE, {
      dia: "2026-10-01",
      gclids: [GCLID],
    });
    expect(r).toEqual({
      ok: true,
      cliques: [
        {
          gclid: GCLID,
          dia: "2026-10-01",
          campaignId: "333",
          campaignName: "Implante",
          adGroupId: "444",
        },
      ],
    });
    expect(chamadas[0]!.corpo?.query).toBe(
      "SELECT click_view.gclid, segments.date, campaign.id, campaign.name, ad_group.id FROM click_view " +
        `WHERE segments.date = '2026-10-01' AND click_view.gclid = '${GCLID}'`,
    );
  });

  it("gclid com aspas ou espaco nao entra na GAQL", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({}));
    expect(
      await lerCliquesPorGclid(config(fetchFn), CLIENTE, {
        dia: "2026-10-01",
        gclids: ["abc' OR 1=1 --"],
      }),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(
      await lerCliquesPorGclid(config(fetchFn), CLIENTE, {
        dia: "2026-10-01",
        gclids: [],
      }),
    ).toMatchObject({
      problema: "entrada_invalida",
    });
    expect(chamadas).toHaveLength(0);
  });

  it("gclid que nao foi pedido e resposta invalida", async () => {
    const { fetchFn } = googleFalso(() =>
      json({
        results: [
          {
            clickView: { gclid: "OutroGclid12345" },
            campaign: { id: "1" },
            segments: { date: "2026-10-01" },
          },
        ],
      }),
    );
    expect(
      await lerCliquesPorGclid(config(fetchFn), CLIENTE, {
        dia: "2026-10-01",
        gclids: [GCLID],
      }),
    ).toMatchObject({ problema: "resposta_invalida" });
  });
});

describe("convite pela MCC", () => {
  it("cria o CustomerClientLink como PENDING a partir da MCC", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      json({
        result: {
          resourceName: `customers/${MCC}/customerClientLinks/${CLIENTE}~555`,
        },
      }),
    );
    const r = await convidarContaPelaMcc(
      config(fetchFn, { loginCustomerId: MCC }),
      {
        gerenteId: MCC,
        clienteId: "123-456-7890",
      },
    );
    expect(r).toEqual({
      ok: true,
      resourceName: `customers/${MCC}/customerClientLinks/${CLIENTE}~555`,
      managerLinkId: "555",
    });
    const chamada = chamadas[0]!;
    expect(chamada.url.pathname).toBe(
      `/${GOOGLE_ADS_API_VERSION}/customers/${MCC}/customerClientLinks:mutate`,
    );
    expect(chamada.corpo).toEqual({
      operation: {
        create: { clientCustomer: `customers/${CLIENTE}`, status: "PENDING" },
      },
    });
    expect(chamada.headers["login-customer-id"]).toBe(MCC);
    expect(
      Object.keys(chamada.headers).map((n) => n.toLowerCase()),
    ).not.toContain("developer-token");
  });

  it("convite repetido e conta ja vinculada voltam como falha propria", async () => {
    const repetido = googleFalso(() =>
      erroAds(400, "INVALID_ARGUMENT", {
        customerClientLinkError: "CLIENT_ALREADY_INVITED_BY_THIS_MANAGER",
      }),
    );
    expect(
      await convidarContaPelaMcc(config(repetido.fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toMatchObject({ problema: "convite_ja_existe" });
    expect(repetido.chamadas).toHaveLength(1);
    const vinculada = googleFalso(() =>
      erroAds(400, "INVALID_ARGUMENT", {
        customerClientLinkError: "CLIENT_ALREADY_MANAGED_IN_HIERARCHY",
      }),
    );
    expect(
      await convidarContaPelaMcc(config(vinculada.fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toMatchObject({ problema: "conta_ja_vinculada" });
  });

  // O mutate nao e idempotente: se o Google gravou o PENDING e a resposta se
  // perdeu, repetir devolveria convite_ja_existe sem o managerLinkId.
  it.each([
    ["503 sem corpo", () => new Response("", { status: 503 })],
    [
      "500 INTERNAL_ERROR",
      () => erroAds(500, "INTERNAL", { internalError: "INTERNAL_ERROR" }),
    ],
    [
      "erro de rede",
      (): Response => {
        throw new TypeError("fetch failed");
      },
    ],
  ])(
    "convite com resposta perdida (%s) nao repete e volta google_indisponivel",
    async (_nome, primeira) => {
      const { fetchFn, chamadas } = googleFalso((_c, n) =>
        n === 1
          ? primeira()
          : erroAds(400, "INVALID_ARGUMENT", {
              customerClientLinkError: "CLIENT_ALREADY_INVITED_BY_THIS_MANAGER",
            }),
      );
      const r = await convidarContaPelaMcc(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      });
      expect(r).toMatchObject({
        ok: false,
        problema: "google_indisponivel",
      });
      expect(r).not.toMatchObject({ problema: "convite_ja_existe" });
      expect(chamadas).toHaveLength(1);
    },
  );

  it("convite que estoura o timeout nao repete e volta google_indisponivel", async () => {
    const chamadas: string[] = [];
    // Fica pendurado ate o nosso timer abortar, como um Google que nao responde.
    const fetchFn = ((entrada: unknown, init?: RequestInit) => {
      chamadas.push(String(entrada));
      return new Promise<Response>((_resolve, rejeitar) => {
        init?.signal?.addEventListener("abort", () =>
          rejeitar(new DOMException("aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    const r = await convidarContaPelaMcc(config(fetchFn, { timeoutMs: 5 }), {
      gerenteId: MCC,
      clienteId: CLIENTE,
    });
    expect(r).toMatchObject({ ok: false, problema: "google_indisponivel" });
    expect(chamadas).toHaveLength(1);
  });

  it("convite com limite curto do Google tambem nao repete localmente", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      erroAds(
        429,
        "RESOURCE_EXHAUSTED",
        { quotaError: "RESOURCE_EXHAUSTED" },
        "1s",
      ),
    );
    expect(
      await convidarContaPelaMcc(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toMatchObject({ problema: "limite_do_google", tentarEmMs: 1_000 });
    expect(chamadas).toHaveLength(1);
  });

  it("leitura continua repetindo em falha transitoria (so o convite e de uma tentativa)", async () => {
    const { fetchFn, chamadas } = googleFalso((_c, n) =>
      n === 1 ? new Response("", { status: 503 }) : json({ results: [] }),
    );
    expect(
      await conferirConvite(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toEqual({ ok: true, situacao: "inexistente", managerLinkId: null });
    expect(chamadas).toHaveLength(2);
  });

  it("gerente igual ao cliente nem chama", async () => {
    const { fetchFn, chamadas } = googleFalso(() => json({}));
    expect(
      await convidarContaPelaMcc(config(fetchFn), {
        gerenteId: MCC,
        clienteId: MCC,
      }),
    ).toMatchObject({ problema: "entrada_invalida" });
    expect(chamadas).toHaveLength(0);
  });

  const vinculos = (...lista: Array<[string, string]>) =>
    json({
      results: lista.map(([id, status]) => ({
        customerClientLink: {
          resourceName: `customers/${MCC}/customerClientLinks/${CLIENTE}~${id}`,
          clientCustomer: `customers/${CLIENTE}`,
          managerLinkId: id,
          status,
        },
      })),
    });

  it("confere o convite: ACTIVE depois do aceite", async () => {
    const { fetchFn, chamadas } = googleFalso(() =>
      vinculos(["555", "ACTIVE"]),
    );
    expect(
      await conferirConvite(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
        managerLinkId: "555",
      }),
    ).toEqual({ ok: true, situacao: "ativo", managerLinkId: "555" });
    expect(chamadas[0]!.url.pathname).toBe(
      `/${GOOGLE_ADS_API_VERSION}/customers/${MCC}/googleAds:search`,
    );
    expect(String(chamadas[0]!.corpo?.query)).toContain(
      `WHERE customer_client_link.client_customer = 'customers/${CLIENTE}'`,
    );
  });

  it("com managerLinkId, so aquele convite conta", async () => {
    const { fetchFn } = googleFalso(() =>
      vinculos(["100", "ACTIVE"], ["555", "PENDING"]),
    );
    expect(
      await conferirConvite(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
        managerLinkId: "555",
      }),
    ).toEqual({ ok: true, situacao: "pendente", managerLinkId: "555" });
    expect(
      await conferirConvite(config(fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
        managerLinkId: "999",
      }),
    ).toEqual({ ok: true, situacao: "inexistente", managerLinkId: null });
  });

  it("sem managerLinkId: ACTIVE vence, depois PENDING, depois o mais recente", async () => {
    const a = googleFalso(() =>
      vinculos(["100", "CANCELED"], ["200", "ACTIVE"]),
    );
    expect(
      await conferirConvite(config(a.fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toMatchObject({
      situacao: "ativo",
      managerLinkId: "200",
    });
    const b = googleFalso(() =>
      vinculos(["100", "REFUSED"], ["300", "CANCELED"]),
    );
    expect(
      await conferirConvite(config(b.fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toMatchObject({
      situacao: "cancelado",
      managerLinkId: "300",
    });
    const c = googleFalso(() => json({}));
    expect(
      await conferirConvite(config(c.fetchFn), {
        gerenteId: MCC,
        clienteId: CLIENTE,
      }),
    ).toEqual({
      ok: true,
      situacao: "inexistente",
      managerLinkId: null,
    });
  });
});
