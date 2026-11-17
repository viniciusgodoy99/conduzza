import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { separarCodigoInvisivel } from "@/lib/domain/codigo-invisivel";
import {
  argumentosDoCliqueDoLink,
  baseDosLinks,
  cookieDoNumeroFixado,
  destinoDoCliqueDoLink,
  ehRoboOuPrevia,
  enderecoDoLinkRastreado,
  lerRespostaDoCliqueDoLink,
  numeroFixadoDoCookie,
} from "@/lib/domain/link-rastreado";

// Link rastreado da origem (etapa 3a do plano de 16/11/2026, o link da bio
// com endereco proprio): as regras puras e a rota publica app/l/[codigo]. O
// contrato com o mundo: quem toca no link SEMPRE chega ao WhatsApp enquanto
// o banco souber o numero; robo e previa nao contam clique; o destino nunca
// sai do pedido; o log nunca leva codigo, numero ou identificador de clique.

type RespostaDoBanco = { data: unknown; error: { code?: string } | null };

const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
let respostas: (RespostaDoBanco | Error)[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      const resposta = respostas.shift() ?? { data: null, error: null };
      return {
        abortSignal: () =>
          resposta instanceof Error
            ? Promise.reject(resposta)
            : Promise.resolve(resposta),
      };
    },
  }),
}));

const { GET, HEAD } = await import("@/app/l/[codigo]/route");

const CODIGO_PUBLICO = "k7q2mxab";
const BASE = "https://go.exemplo.com.br";
const NAVEGADOR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const NUMERO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OUTRO_NUMERO = "11111111-2222-4333-8444-555555555555";
const DESTINO = {
  digitos: "5585999990000",
  mensagem: "Olá! Vi o perfil e quero agendar uma avaliação.",
  codigo_fixo: "F1X0AB",
  numero: NUMERO,
};
const FBCLID = "IwAR0segredo_do_clique-123";

let escrito: string[] = [];

function pedido(
  busca = "",
  userAgent: string | null = NAVEGADOR,
  codigo = CODIGO_PUBLICO,
  cookie: string | null = null,
): [NextRequest, { params: Promise<{ codigo: string }> }] {
  const cabecalhos: Record<string, string> = {};
  if (userAgent !== null) {
    cabecalhos["user-agent"] = userAgent;
  }
  if (cookie !== null) {
    cabecalhos.cookie = cookie;
  }
  return [
    new NextRequest(`${BASE}/l/${codigo}${busca}`, { headers: cabecalhos }),
    { params: Promise.resolve({ codigo }) },
  ];
}

function textoDoDestino(resposta: Response): string {
  const destino = new URL(resposta.headers.get("location") ?? "");
  expect(destino.origin + destino.pathname).toBe(
    "https://wa.me/5585999990000",
  );
  return destino.searchParams.get("text") ?? "";
}

beforeEach(() => {
  chamadas.length = 0;
  respostas = [];
  escrito = [];
  const guardar = (pedaco: string | Uint8Array): boolean => {
    escrito.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(guardar);
  vi.spyOn(process.stderr, "write").mockImplementation(guardar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ehRoboOuPrevia", () => {
  it("previa de link, buscador, ferramenta e pedido sem user agent sao robo", () => {
    for (const ua of [
      null,
      "",
      "WhatsApp/2.23.20.0 A",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "TelegramBot (like TwitterBot)",
      "Twitterbot/1.0",
      "curl/8.4.0",
      "python-requests/2.31.0",
    ]) {
      expect(ehRoboOuPrevia(ua)).toBe(true);
    }
  });

  it("gente de verdade nao e robo, nem dentro do Instagram e do Facebook", () => {
    for (const ua of [
      NAVEGADOR,
      "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ]) {
      expect(ehRoboOuPrevia(ua)).toBe(false);
    }
  });
});

describe("enderecoDoLinkRastreado e baseDosLinks", () => {
  it("monta <base>/l/<codigo>; so https (http so em localhost)", () => {
    expect(enderecoDoLinkRastreado(BASE, CODIGO_PUBLICO)).toBe(
      `${BASE}/l/${CODIGO_PUBLICO}`,
    );
    expect(enderecoDoLinkRastreado(`${BASE}/qualquer/`, CODIGO_PUBLICO)).toBe(
      `${BASE}/l/${CODIGO_PUBLICO}`,
    );
    expect(
      enderecoDoLinkRastreado("http://localhost:3000", CODIGO_PUBLICO),
    ).toBe(`http://localhost:3000/l/${CODIGO_PUBLICO}`);
    expect(
      enderecoDoLinkRastreado("http://exemplo.com.br", CODIGO_PUBLICO),
    ).toBeNull();
    expect(enderecoDoLinkRastreado("nao e url", CODIGO_PUBLICO)).toBeNull();
    expect(enderecoDoLinkRastreado(null, CODIGO_PUBLICO)).toBeNull();
    expect(enderecoDoLinkRastreado(BASE, "K7Q2MXAB")).toBeNull();
    expect(enderecoDoLinkRastreado(BASE, "k7q2mx")).toBeNull();
  });

  it("o dominio curto vence o endereco do sistema; os dois vazios, nada", () => {
    expect(baseDosLinks("https://go.x.com", "https://app.x.com")).toBe(
      "https://go.x.com",
    );
    expect(baseDosLinks("  ", "https://app.x.com")).toBe("https://app.x.com");
    expect(baseDosLinks(undefined, undefined)).toBeNull();
  });
});

describe("resposta do banco e destino", () => {
  it("clique gravado: o codigo do clique vai na mensagem", () => {
    const resposta = lerRespostaDoCliqueDoLink({
      ...DESTINO,
      resultado: "ok",
      codigo: "K7Q2MX",
    });
    expect(resposta).not.toBeNull();
    expect(destinoDoCliqueDoLink(resposta!)).toBe(
      `https://wa.me/5585999990000?text=${encodeURIComponent(`${DESTINO.mensagem} [#K7Q2MX]`)}`,
    );
  });

  it("sem gravar ou no limite: o codigo fixo da origem; origem sem codigo, so a mensagem", () => {
    for (const resultado of ["sem_gravar", "limite"]) {
      const resposta = lerRespostaDoCliqueDoLink({ ...DESTINO, resultado });
      expect(destinoDoCliqueDoLink(resposta!)).toContain(
        encodeURIComponent("[#F1X0AB]"),
      );
    }
    const semCodigo = lerRespostaDoCliqueDoLink({
      ...DESTINO,
      codigo_fixo: null,
      resultado: "limite",
    });
    expect(destinoDoCliqueDoLink(semCodigo!)).toBe(
      `https://wa.me/5585999990000?text=${encodeURIComponent(DESTINO.mensagem)}`,
    );
  });

  it("indisponivel e sem numero nao tem destino; retorno fora do contrato e null", () => {
    for (const resultado of ["indisponivel", "sem_numero"]) {
      const resposta = lerRespostaDoCliqueDoLink({ resultado });
      expect(destinoDoCliqueDoLink(resposta!)).toBeNull();
    }
    expect(lerRespostaDoCliqueDoLink(null)).toBeNull();
    expect(lerRespostaDoCliqueDoLink({ resultado: "outro" })).toBeNull();
    expect(
      lerRespostaDoCliqueDoLink({
        ...DESTINO,
        digitos: "https://malicioso.exemplo",
        resultado: "sem_gravar",
      }),
    ).toBeNull();
    expect(
      lerRespostaDoCliqueDoLink({ ...DESTINO, resultado: "ok" }),
    ).toBeNull();
    // Sem o numero (banco de antes do rodizio) ou com um que nao e id.
    for (const numero of [undefined, "nao e id"]) {
      expect(
        lerRespostaDoCliqueDoLink({
          ...DESTINO,
          numero,
          resultado: "sem_gravar",
        }),
      ).toBeNull();
    }
  });

  it("os argumentos: sem gravar, os sinais nem viajam", () => {
    const sinais = { fbclid: FBCLID, utm_source: "ig", cz_anuncio: "99" };
    expect(argumentosDoCliqueDoLink(CODIGO_PUBLICO, true, sinais)).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: true,
      p_fbclid: FBCLID,
      p_utm_source: "ig",
      p_meta_ad_id: "99",
    });
    expect(argumentosDoCliqueDoLink(CODIGO_PUBLICO, false, sinais)).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: false,
    });
  });
});

describe("o numero fixado do visitante (rodizio, etapa 3b)", () => {
  it("o cookie e um por origem e so vale com um id de numero", () => {
    expect(cookieDoNumeroFixado(CODIGO_PUBLICO)).toBe(`cz_lk_${CODIGO_PUBLICO}`);
    expect(numeroFixadoDoCookie(NUMERO)).toBe(NUMERO);
    for (const valor of [null, undefined, "", "5585999990000", `${NUMERO}x`]) {
      expect(numeroFixadoDoCookie(valor)).toBeNull();
    }
    expect(
      argumentosDoCliqueDoLink(CODIGO_PUBLICO, true, null, NUMERO),
    ).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: true,
      p_numero_fixado: NUMERO,
    });
  });

  it("gente: o cookie do pedido vira o numero fixado e a resposta grava o numero escolhido por 90 dias", async () => {
    respostas = [
      {
        data: {
          ...DESTINO,
          numero: OUTRO_NUMERO,
          resultado: "ok",
          codigo: "K7Q2MX",
        },
        error: null,
      },
    ];
    const resposta = await GET(
      ...pedido(
        "",
        NAVEGADOR,
        CODIGO_PUBLICO,
        `outro=1; cz_lk_${CODIGO_PUBLICO}=${NUMERO}`,
      ),
    );
    expect(chamadas[0]?.args).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: true,
      p_numero_fixado: NUMERO,
    });
    const gravado = resposta.headers.get("set-cookie") ?? "";
    expect(gravado).toContain(`cz_lk_${CODIGO_PUBLICO}=${OUTRO_NUMERO}`);
    expect(gravado).toContain("Max-Age=7776000");
    expect(gravado).toContain("Path=/l/");
    expect(gravado).toContain("HttpOnly");
    expect(gravado).toContain("Secure");
    expect(gravado.toLowerCase()).toContain("samesite=lax");
  });

  it("cookie adulterado e ignorado; sem cookie, nenhum numero fixado", async () => {
    for (const cookie of [`cz_lk_${CODIGO_PUBLICO}=5585999990000`, null]) {
      chamadas.length = 0;
      respostas = [
        { data: { ...DESTINO, resultado: "ok", codigo: "K7Q2MX" }, error: null },
      ];
      await GET(...pedido("", NAVEGADOR, CODIGO_PUBLICO, cookie));
      expect(chamadas[0]?.args).toEqual({
        p_codigo_publico: CODIGO_PUBLICO,
        p_gravar: true,
      });
    }
  });

  it("robo e previa: o cookie nao e lido nem gravado", async () => {
    respostas = [{ data: { ...DESTINO, resultado: "sem_gravar" }, error: null }];
    const resposta = await GET(
      ...pedido(
        "",
        "WhatsApp/2.23.20.0 A",
        CODIGO_PUBLICO,
        `cz_lk_${CODIGO_PUBLICO}=${NUMERO}`,
      ),
    );
    expect(chamadas[0]?.args).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: false,
    });
    expect(resposta.headers.get("set-cookie")).toBeNull();
  });

  it("gravar falhou: a segunda chamada leva o mesmo numero fixado e o cookie e gravado", async () => {
    respostas = [
      new Error("timeout"),
      { data: { ...DESTINO, resultado: "sem_gravar" }, error: null },
    ];
    const resposta = await GET(
      ...pedido(
        "",
        NAVEGADOR,
        CODIGO_PUBLICO,
        `cz_lk_${CODIGO_PUBLICO}=${NUMERO}`,
      ),
    );
    expect(chamadas.map((chamada) => chamada.args)).toEqual([
      { p_codigo_publico: CODIGO_PUBLICO, p_gravar: true, p_numero_fixado: NUMERO },
      {
        p_codigo_publico: CODIGO_PUBLICO,
        p_gravar: false,
        p_numero_fixado: NUMERO,
      },
    ]);
    expect(resposta.headers.get("set-cookie")).toContain(
      `cz_lk_${CODIGO_PUBLICO}=${NUMERO}`,
    );
  });
});

describe("GET /l/<codigo>", () => {
  it("gente: grava o clique com os sinais da URL e manda ao WhatsApp com o codigo do clique", async () => {
    respostas = [
      { data: { ...DESTINO, resultado: "ok", codigo: "K7Q2MX" }, error: null },
    ];
    const resposta = await GET(
      ...pedido(`?utm_source=instagram&utm_medium=bio&fbclid=${FBCLID}&lixo=1`),
    );
    expect(resposta.status).toBe(302);
    expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#K7Q2MX]`);
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(resposta.headers.get("referrer-policy")).toBe("no-referrer");
    expect(chamadas).toEqual([
      {
        nome: "registrar_clique_do_link",
        args: {
          p_codigo_publico: CODIGO_PUBLICO,
          p_gravar: true,
          p_utm_source: "instagram",
          p_utm_medium: "bio",
          p_fbclid: FBCLID,
        },
      },
    ]);
    // O log nunca leva o codigo, o numero nem o identificador do clique.
    const tudo = escrito.join("");
    for (const segredo of [CODIGO_PUBLICO, FBCLID, "K7Q2MX", DESTINO.digitos]) {
      expect(tudo).not.toContain(segredo);
    }
    expect(tudo).toContain('"status":"ok"');
    expect(tudo).toContain('"count":3');
  });

  it("robo e previa: chegam ao destino com o codigo fixo, sem gravar nem mandar sinal", async () => {
    respostas = [{ data: { ...DESTINO, resultado: "sem_gravar" }, error: null }];
    const resposta = await GET(
      ...pedido(`?fbclid=${FBCLID}`, "WhatsApp/2.23.20.0 A"),
    );
    expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#F1X0AB]`);
    expect(chamadas[0]?.args).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: false,
    });
  });

  it("HEAD nunca conta clique, mesmo de navegador", async () => {
    respostas = [{ data: { ...DESTINO, resultado: "sem_gravar" }, error: null }];
    const resposta = await HEAD(...pedido("?utm_source=ig"));
    expect(resposta.status).toBe(302);
    expect(chamadas[0]?.args).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: false,
    });
  });

  it("gravar falhou (erro ou excecao): pede de novo sem gravar e a pessoa chega com o codigo fixo", async () => {
    for (const falha of [
      { data: null, error: { code: "22023" } },
      new Error("timeout"),
    ]) {
      chamadas.length = 0;
      respostas = [
        falha,
        { data: { ...DESTINO, resultado: "sem_gravar" }, error: null },
      ];
      const resposta = await GET(...pedido("?utm_source=ig"));
      expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#F1X0AB]`);
      expect(chamadas.map((chamada) => chamada.args.p_gravar)).toEqual([
        true,
        false,
      ]);
    }
  });

  it("limite: nao gravou, vai o codigo fixo, numa chamada so", async () => {
    respostas = [{ data: { ...DESTINO, resultado: "limite" }, error: null }];
    const resposta = await GET(...pedido());
    expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#F1X0AB]`);
    expect(chamadas).toHaveLength(1);
  });

  it("link desativado, clinica sem numero ou banco sem resposta: a pagina de indisponivel, nunca erro", async () => {
    const casos: (RespostaDoBanco | Error)[][] = [
      [{ data: { resultado: "indisponivel" }, error: null }],
      [{ data: { resultado: "sem_numero" }, error: null }],
      [new Error("fora"), new Error("fora")],
      [{ data: "lixo", error: null }, { data: "lixo", error: null }],
    ];
    for (const caso of casos) {
      respostas = [...caso];
      const resposta = await GET(...pedido());
      expect(resposta.status).toBe(302);
      expect(resposta.headers.get("location")).toBe(`${BASE}/l/indisponivel`);
    }
  });

  it("codigo fora do formato: indisponivel sem tocar no banco", async () => {
    for (const codigo of ["K7Q2MXAB", "curto", "com espaco", "k7q2mxa1"]) {
      const resposta = await GET(...pedido("", NAVEGADOR, codigo));
      expect(resposta.headers.get("location")).toBe(`${BASE}/l/indisponivel`);
    }
    expect(chamadas).toHaveLength(0);
  });

  it("o destino nunca sai do pedido: parametro de redirecionamento e ignorado", async () => {
    respostas = [
      { data: { ...DESTINO, resultado: "ok", codigo: "K7Q2MX" }, error: null },
    ];
    const resposta = await GET(
      ...pedido("?url=https://malicioso.exemplo&text=outra&phone=5511999999999"),
    );
    expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#K7Q2MX]`);
  });
});

describe("código invisível (etapa 3c): desligado até o teste com celular real", () => {
  const ok = () => ({
    data: { ...DESTINO, resultado: "ok", codigo: "K7Q2MX" },
    error: null,
  });

  it("por padrão o código vai à vista", async () => {
    respostas = [ok()];
    const resposta = await GET(...pedido("?utm_source=ig"));
    expect(textoDoDestino(resposta)).toBe(`${DESTINO.mensagem} [#K7Q2MX]`);
  });

  it("?cz_invisivel=1 esconde o código naquele clique, sem virar sinal do clique", async () => {
    respostas = [ok()];
    const resposta = await GET(...pedido("?cz_invisivel=1&utm_source=ig"));
    const texto = textoDoDestino(resposta);
    expect(texto).not.toContain("[#");
    expect(separarCodigoInvisivel(texto)).toEqual({
      texto: DESTINO.mensagem,
      codigo: "K7Q2MX",
    });
    expect(chamadas[0]?.args).toEqual({
      p_codigo_publico: CODIGO_PUBLICO,
      p_gravar: true,
      p_utm_source: "ig",
    });
  });

  it("com LINK_CODIGO_INVISIVEL=1 todo clique gravado esconde o código; o não gravado leva o fixo à vista", async () => {
    vi.stubEnv("LINK_CODIGO_INVISIVEL", "1");
    try {
      respostas = [ok()];
      const escondido = textoDoDestino(await GET(...pedido()));
      expect(separarCodigoInvisivel(escondido).codigo).toBe("K7Q2MX");

      respostas = [{ data: { ...DESTINO, resultado: "limite" }, error: null }];
      expect(textoDoDestino(await GET(...pedido()))).toBe(
        `${DESTINO.mensagem} [#F1X0AB]`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
