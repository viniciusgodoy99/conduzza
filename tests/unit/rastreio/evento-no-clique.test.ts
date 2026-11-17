import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  avisoDaMetaNoClique,
  ipDoVisitante,
  lerRespostaDoCliqueDoLink,
  paginaDoPixel,
} from "@/lib/domain/link-rastreado";
import {
  fbcDoClique,
  montarEventoDoCliqueDoLink,
} from "@/lib/integrations/meta/payload";

// Evento para a Meta no clique do link rastreado (etapa 3e do plano de
// 16/11/2026). O contrato: so com a origem pedindo E a clinica com o Pixel e
// o envio ligados a pessoa ve a pagina do Pixel (que nunca a prende); o
// mesmo Contact vai pelo servidor, depois da resposta, com o mesmo id; o IP
// e o navegador so viajam ate a Meta, nunca para o log; robo nao gera evento.

type RespostaDoBanco = { data: unknown; error: { code?: string } | null };

const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
let respostas: (RespostaDoBanco | Error)[] = [];
const depoisDaResposta: (() => unknown)[] = [];
const eventosDoServidor: Record<string, unknown>[] = [];

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (tarefa: () => unknown) => {
    depoisDaResposta.push(tarefa);
  },
}));
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
vi.mock("@/lib/integrations/meta/evento-do-clique", () => ({
  enviarEventoDoCliqueDoLink: async (
    _admin: unknown,
    clique: Record<string, unknown>,
  ) => {
    eventosDoServidor.push(clique);
  },
}));

const { GET } = await import("@/app/l/[codigo]/route");

const CODIGO_PUBLICO = "k7q2mxab";
const BASE = "https://go.exemplo.com.br";
const NAVEGADOR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const NUMERO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CLIQUE = "11111111-2222-4333-8444-555555555555";
const CLINICA = "c1111111-1111-4111-8111-111111111111";
const PIXEL = "626829132163238";
const FBCLID = "IwAR0segredo_do_clique-123";
const IP = "203.0.113.77";
const MENSAGEM = "Olá! Vi o perfil e quero agendar uma avaliação.";
const COM_PIXEL = {
  resultado: "ok",
  digitos: "5585999990000",
  mensagem: MENSAGEM,
  codigo_fixo: "F7X2AB",
  numero: NUMERO,
  codigo: "K7Q2MX",
  pixel_id: PIXEL,
  clique_id: CLIQUE,
  clinica: CLINICA,
};

let escrito: string[] = [];

function pedido(
  busca = "",
  userAgent = NAVEGADOR,
): [NextRequest, { params: Promise<{ codigo: string }> }] {
  return [
    new NextRequest(`${BASE}/l/${CODIGO_PUBLICO}${busca}`, {
      headers: { "user-agent": userAgent, "x-forwarded-for": `${IP}, 10.0.0.1` },
    }),
    { params: Promise.resolve({ codigo: CODIGO_PUBLICO }) },
  ];
}

beforeEach(() => {
  chamadas.length = 0;
  respostas = [];
  depoisDaResposta.length = 0;
  eventosDoServidor.length = 0;
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

describe("o aviso deste clique", () => {
  it("só existe com o Pixel, o id do clique e a clínica juntos, num clique gravado", () => {
    expect(avisoDaMetaNoClique(lerRespostaDoCliqueDoLink(COM_PIXEL)!)).toEqual({
      pixelId: PIXEL,
      eventoId: CLIQUE,
      clinicId: CLINICA,
    });
    for (const falta of ["pixel_id", "clique_id", "clinica"]) {
      const resposta = lerRespostaDoCliqueDoLink({
        ...COM_PIXEL,
        [falta]: undefined,
      })!;
      expect(avisoDaMetaNoClique(resposta)).toBeNull();
    }
    // Pixel que nao e so numero: a resposta inteira sai do contrato.
    expect(
      lerRespostaDoCliqueDoLink({ ...COM_PIXEL, pixel_id: "123'); alert(1)//" }),
    ).toBeNull();
    const semGravar = lerRespostaDoCliqueDoLink({
      ...COM_PIXEL,
      resultado: "sem_gravar",
      codigo: undefined,
    })!;
    expect(avisoDaMetaNoClique(semGravar)).toBeNull();
  });
});

describe("a página do Pixel", () => {
  const DESTINO = "https://wa.me/5585999990000?text=Ol%C3%A1!%20%5B%23K7Q2MX%5D";
  const html = paginaDoPixel({ pixelId: PIXEL, eventoId: CLIQUE, destino: DESTINO });

  it("dispara PageView e Contact com o id do clique e segue para o WhatsApp, sem nunca prender a pessoa", () => {
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(html).toContain(`fbq('init', "${PIXEL}")`);
    expect(html).toContain("fbq('track', 'PageView')");
    expect(html).toContain(`fbq('track', 'Contact', {}, { eventID: "${CLIQUE}" })`);
    // Segue quando o Pixel carrega, na hora se ele falha e, de todo jeito, em
    // 1,5 s; sem JavaScript, o navegador redireciona sozinho; e ha o link.
    expect(html).toContain("setTimeout(seguir, 1500)");
    expect(html).toContain("t.onerror=seguir");
    expect(html).toContain("t.onload=function(){setTimeout(seguir,400)}");
    expect(html).toContain(
      `<noscript><meta http-equiv="refresh" content="0;url=${DESTINO}"></noscript>`,
    );
    expect(html).toContain("Abrindo o WhatsApp");
    expect(html).toContain("Se não abrir, toque aqui");
    expect(html).toContain('content="noindex, nofollow"');
  });

  it("sem cor fixa (vale o claro e o escuro do sistema) e sem travessão", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/[–—]/);
  });

  it("nada do destino quebra o HTML nem o script", () => {
    const malicioso = paginaDoPixel({
      pixelId: PIXEL,
      eventoId: CLIQUE,
      destino: 'https://wa.me/1?text=</script><script>alert(1)</script>"&x=\u2028',
    });
    // So existe a tag de script da propria pagina.
    expect(malicioso.match(/<script>/g)).toHaveLength(1);
    expect(malicioso.match(/<\/script>/g)).toHaveLength(1);
    expect(malicioso).toContain("\\u003c/script>");
    expect(malicioso).toContain("&lt;/script&gt;");
    expect(malicioso).toContain("&quot;&amp;x=");
    // Dentro do script, o separador de linha vai escapado (cru, ele quebraria
    // a string em navegador antigo).
    const script = /<script>([\s\S]*)<\/script>/.exec(malicioso)?.[1] ?? "";
    expect(script).not.toContain("\u2028");
    expect(script).toContain("\\u2028");
  });
});

describe("o evento do servidor", () => {
  it("é de site, com o mesmo id do clique, o navegador, o IP e o fbc quando veio de anúncio", () => {
    const evento = montarEventoDoCliqueDoLink({
      eventId: CLIQUE,
      cliqueEmMs: 1_775_000_000_123,
      eventSourceUrl: `${BASE}/l/${CODIGO_PUBLICO}`,
      userAgent: NAVEGADOR,
      ip: IP,
      fbclid: FBCLID,
    });
    expect(evento).toEqual({
      event_name: "Contact",
      event_time: 1_775_000_000,
      event_id: CLIQUE,
      action_source: "website",
      event_source_url: `${BASE}/l/${CODIGO_PUBLICO}`,
      user_data: {
        client_user_agent: NAVEGADOR,
        client_ip_address: IP,
        fbc: fbcDoClique(FBCLID, 1_775_000_000_123),
      },
    });
    const semExtras = montarEventoDoCliqueDoLink({
      eventId: CLIQUE,
      cliqueEmMs: 1_775_000_000_123,
      eventSourceUrl: `${BASE}/l/${CODIGO_PUBLICO}`,
      userAgent: NAVEGADOR,
      ip: null,
      fbclid: null,
    });
    expect(semExtras.user_data).toEqual({ client_user_agent: NAVEGADOR });
  });

  it("o IP vem do primeiro endereço do cabeçalho, e só se parecer um IP", () => {
    expect(ipDoVisitante(`${IP}, 10.0.0.1`)).toBe(IP);
    expect(ipDoVisitante("2001:db8::1")).toBe("2001:db8::1");
    for (const ruim of [null, "", "desconhecido", "<script>", "1"]) {
      expect(ipDoVisitante(ruim)).toBeNull();
    }
  });
});

describe("GET /l/<codigo> com aviso à Meta", () => {
  it("gente: responde a página do Pixel e, depois da resposta, manda o mesmo evento pelo servidor", async () => {
    respostas = [{ data: COM_PIXEL, error: null }];
    const resposta = await GET(...pedido(`?fbclid=${FBCLID}&utm_source=ig`));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(resposta.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await resposta.text();
    expect(html).toContain(`fbq('init', "${PIXEL}")`);
    expect(html).toContain(`eventID: "${CLIQUE}"`);
    expect(html).toContain("https://wa.me/5585999990000?text=");
    // A clinica e o token nunca vao ao navegador.
    expect(html).not.toContain(CLINICA);
    // O cookie do numero continua sendo gravado.
    expect(resposta.headers.get("set-cookie")).toContain(
      `cz_lk_${CODIGO_PUBLICO}=${NUMERO}`,
    );

    // Nada foi enviado ANTES de responder: so depois (after).
    expect(eventosDoServidor).toEqual([]);
    expect(depoisDaResposta).toHaveLength(1);
    await depoisDaResposta[0]!();
    expect(eventosDoServidor).toEqual([
      expect.objectContaining({
        clinicId: CLINICA,
        pixelId: PIXEL,
        eventId: CLIQUE,
        // Sem a query: as UTMs e o fbclid nao vao no endereco do evento.
        eventSourceUrl: `${BASE}/l/${CODIGO_PUBLICO}`,
        userAgent: NAVEGADOR,
        ip: IP,
        fbclid: FBCLID,
      }),
    ]);
    // O IP, o navegador e o identificador do clique nunca vao para o log.
    const tudo = escrito.join("");
    for (const segredo of [IP, "iPhone", FBCLID, PIXEL, CLIQUE]) {
      expect(tudo).not.toContain(segredo);
    }
  });

  it("origem sem o aviso (ou clínica sem o Pixel): redirecionamento comum, sem evento", async () => {
    respostas = [
      {
        data: { ...COM_PIXEL, pixel_id: undefined, clique_id: undefined, clinica: undefined },
        error: null,
      },
    ];
    const resposta = await GET(...pedido());
    expect(resposta.status).toBe(302);
    expect(depoisDaResposta).toEqual([]);
  });

  it("robô e prévia nunca veem a página do Pixel nem geram evento", async () => {
    respostas = [
      { data: { ...COM_PIXEL, resultado: "sem_gravar", codigo: undefined }, error: null },
    ];
    const resposta = await GET(...pedido("", "facebookexternalhit/1.1"));
    expect(resposta.status).toBe(302);
    expect(depoisDaResposta).toEqual([]);
  });
});
