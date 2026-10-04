import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Rota publica do aviso de clique (F1 do Google). O contrato com o mundo:
// responde SEMPRE 204, venha o que vier; so chama o banco com corpo de ate
// 2 KB, no formato estrito e com sinal do Google; nunca escreve chave, gclid
// ou codigo no log.

type RespostaDoBanco = { data: unknown; error: { code?: string } | null };

const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
const sinaisDeTempo: AbortSignal[] = [];
let respostaDoBanco: RespostaDoBanco | Error = { data: "ok", error: null };
let clienteQuebrado = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (clienteQuebrado) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY ausente no ambiente do servidor.",
      );
    }
    return {
      rpc: (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return {
          abortSignal: (sinal: AbortSignal) => {
            sinaisDeTempo.push(sinal);
            return respostaDoBanco instanceof Error
              ? Promise.reject(respostaDoBanco)
              : Promise.resolve(respostaDoBanco);
          },
        };
      },
    };
  },
}));

const { OPTIONS, POST } = await import("@/app/api/publico/clique/route");

const URL_DA_ROTA = "https://app.conduzza.test/api/publico/clique";
const CHAVE = "0123456789abcdef0123";
const CODIGO = "K7Q2MX";
const GCLID = "EAIaIQobChMIsegredo_do_clique-123";

let escrito: string[] = [];

function pedido(
  corpo: string | ReadableStream<Uint8Array> | null,
  cabecalhos: Record<string, string> = {},
): NextRequest {
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...cabecalhos },
    body: corpo,
  };
  if (corpo instanceof ReadableStream) {
    init.duplex = "half";
  }
  return new NextRequest(
    URL_DA_ROTA,
    init as ConstructorParameters<typeof NextRequest>[1],
  );
}

function corpoValido(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    chave: CHAVE,
    codigo: CODIGO,
    gclid: GCLID,
    gad_campaignid: "111",
    cz_campanha: "222",
    cz_grupo: "333",
    ...extra,
  });
}

async function esperar204(resposta: Response): Promise<void> {
  expect(resposta.status).toBe(204);
  expect(await resposta.text()).toBe("");
  expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
  expect(resposta.headers.get("cache-control")).toBe("no-store");
}

function nadaSensivelNoLog(): void {
  const tudo = escrito.join("");
  expect(tudo).not.toContain(CHAVE);
  expect(tudo).not.toContain(GCLID);
  expect(tudo).not.toContain(CODIGO);
  for (const linha of escrito) {
    const campos = Object.keys(JSON.parse(linha) as Record<string, unknown>);
    for (const campo of campos) {
      expect([
        "ts",
        "nivel",
        "evento",
        "status",
        "count",
        "error_code",
      ]).toContain(campo);
    }
  }
}

beforeEach(() => {
  chamadas.length = 0;
  sinaisDeTempo.length = 0;
  respostaDoBanco = { data: "ok", error: null };
  clienteQuebrado = false;
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

describe("OPTIONS /api/publico/clique", () => {
  it("204 com CORS permissivo", async () => {
    const resposta = OPTIONS();
    await esperar204(resposta);
    expect(resposta.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(resposta.headers.get("access-control-allow-headers")).toBe(
      "Content-Type",
    );
  });
});

describe("POST /api/publico/clique", () => {
  it("corpo valido: chama a funcao com a service role e responde 204", async () => {
    const resposta = await POST(
      pedido(corpoValido(), { origin: "https://www.Clinica.com.br" }),
    );
    await esperar204(resposta);
    expect(chamadas).toEqual([
      {
        nome: "registrar_clique_do_site",
        args: {
          p_chave: CHAVE,
          p_codigo: CODIGO,
          p_gclid: GCLID,
          // cz_campanha ({campaignid}) vence gad_campaignid.
          p_google_campaign_id: "222",
          p_google_adgroup_id: "333",
          p_site_host: "www.clinica.com.br",
        },
      },
    ]);
    // Timeout explicito na chamada ao banco.
    expect(sinaisDeTempo).toHaveLength(1);
    expect(sinaisDeTempo[0]?.aborted).toBe(false);
    nadaSensivelNoLog();
    expect(escrito.join("")).toContain('"status":"ok"');
    expect(escrito.join("")).toContain('"count":4');
  });

  it("sem Origin (ou Origin 'null'): sem host", async () => {
    await POST(pedido(corpoValido()));
    await POST(pedido(corpoValido(), { origin: "null" }));
    expect(chamadas).toHaveLength(2);
    for (const chamada of chamadas) {
      expect(chamada.args).not.toHaveProperty("p_site_host");
    }
  });

  it("todo resultado da funcao responde 204 igual", async () => {
    for (const resultado of [
      "ok",
      "chave_invalida",
      "desligado",
      "limite",
      "duplicado",
      "codigo_reservado",
    ]) {
      respostaDoBanco = { data: resultado, error: null };
      await esperar204(await POST(pedido(corpoValido())));
      expect(escrito.join("")).toContain(`"status":"${resultado}"`);
    }
    nadaSensivelNoLog();
  });

  it("chave errada (bem formada) vai ao banco, volta chave_invalida e responde 204", async () => {
    respostaDoBanco = { data: "chave_invalida", error: null };
    const resposta = await POST(
      pedido(corpoValido({ chave: "ffffffffffffffffffff" })),
    );
    await esperar204(resposta);
    expect(chamadas).toHaveLength(1);
    expect(escrito.join("")).not.toContain("ffffffffffffffffffff");
  });

  it("chave fora do formato nem chega ao banco", async () => {
    for (const chave of [
      "",
      "slug-da-clinica",
      "0123456789ABCDEF0123",
      "abc",
    ]) {
      await esperar204(await POST(pedido(corpoValido({ chave }))));
    }
    expect(chamadas).toHaveLength(0);
  });

  it("campo extra: 204 sem tocar no banco", async () => {
    for (const extra of [
      { pagina: "/tratamento-x" },
      { ip: "200.1.2.3" },
      { user_agent: "Mozilla" },
      { clinic_id: "00000000-0000-0000-0000-000000000000" },
    ]) {
      await esperar204(await POST(pedido(corpoValido(extra))));
    }
    expect(chamadas).toHaveLength(0);
    expect(escrito.join("")).toContain('"status":"fora_do_formato"');
    nadaSensivelNoLog();
  });

  it("sem sinal do Google, formato errado ou JSON quebrado: 204 sem banco", async () => {
    const corpos = [
      JSON.stringify({ chave: CHAVE, codigo: CODIGO }),
      corpoValido({ codigo: "K7Q2M0" }),
      corpoValido({ gclid: "a".repeat(513) }),
      corpoValido({ cz_campanha: "abc" }),
      "{nao e json",
      "",
      "[]",
    ];
    for (const corpo of corpos) {
      await esperar204(await POST(pedido(corpo)));
    }
    await esperar204(await POST(pedido(null)));
    expect(chamadas).toHaveLength(0);
  });

  it("corpo maior que 2 KB: 204 sem banco", async () => {
    const grande = corpoValido({ gbraid: "b".repeat(3000) });
    expect(Buffer.byteLength(grande)).toBeGreaterThan(2048);
    await esperar204(await POST(pedido(grande)));
    expect(chamadas).toHaveLength(0);
    expect(escrito.join("")).toContain('"status":"corpo_grande"');
    nadaSensivelNoLog();
  });

  it("Content-Length declarado acima de 2 KB corta antes de ler", async () => {
    await esperar204(
      await POST(pedido(corpoValido(), { "content-length": "4096" })),
    );
    expect(chamadas).toHaveLength(0);
  });

  it("corpo em pedacos sem fim: para de ler logo depois do teto", async () => {
    let entregues = 0;
    let cancelado = false;
    const infinito = new ReadableStream<Uint8Array>({
      pull(controle) {
        entregues += 1;
        controle.enqueue(new Uint8Array(512).fill(0x61));
      },
      cancel() {
        cancelado = true;
      },
    });
    await esperar204(await POST(pedido(infinito)));
    expect(chamadas).toHaveLength(0);
    expect(cancelado).toBe(true);
    // 2 KB em pedacos de 512: o quinto estoura. Folga para o que o
    // ReadableStream puxa adiantado.
    expect(entregues).toBeLessThanOrEqual(8);
  });

  it("UTF-8 invalido: 204 sem banco", async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const corpo = new ReadableStream<Uint8Array>({
      start(controle) {
        controle.enqueue(bytes);
        controle.close();
      },
    });
    await esperar204(await POST(pedido(corpo)));
    expect(chamadas).toHaveLength(0);
  });

  it("o maior corpo valido (os 3 identificadores cheios) passa", async () => {
    const maior = corpoValido({
      gclid: "a".repeat(512),
      gbraid: "b".repeat(512),
      wbraid: "c".repeat(512),
      gad_source: "d".repeat(32),
      gad_campaignid: "1".repeat(20),
      cz_campanha: "2".repeat(20),
      cz_grupo: "3".repeat(20),
    });
    expect(Buffer.byteLength(maior)).toBeLessThanOrEqual(2048);
    await esperar204(await POST(pedido(maior)));
    expect(chamadas).toHaveLength(1);
  });

  it("erro do banco (22023): 204, log so com o codigo e a contagem", async () => {
    respostaDoBanco = { data: null, error: { code: "22023" } };
    await esperar204(await POST(pedido(corpoValido())));
    expect(chamadas).toHaveLength(1);
    const linha = escrito.find((l) => l.includes("clique_do_site_falhou"));
    expect(linha).toBeDefined();
    expect(JSON.parse(linha ?? "{}")).toMatchObject({
      nivel: "error",
      error_code: "22023",
      count: 4,
    });
    nadaSensivelNoLog();
  });

  it("banco fora do ar ou tempo esgotado: 204", async () => {
    respostaDoBanco = new Error("fetch failed");
    await esperar204(await POST(pedido(corpoValido())));
    const abortado = new Error("The operation was aborted due to timeout");
    abortado.name = "TimeoutError";
    respostaDoBanco = abortado;
    await esperar204(await POST(pedido(corpoValido())));
    expect(escrito.join("")).toContain('"error_code":"TimeoutError"');
    nadaSensivelNoLog();
  });

  it("sem a service role no ambiente: 204", async () => {
    clienteQuebrado = true;
    await esperar204(await POST(pedido(corpoValido())));
    expect(chamadas).toHaveLength(0);
    nadaSensivelNoLog();
  });

  it("retorno estranho do banco vira 'desconhecido' no log", async () => {
    respostaDoBanco = { data: `vazou ${GCLID}`, error: null };
    await esperar204(await POST(pedido(corpoValido())));
    expect(escrito.join("")).toContain('"status":"desconhecido"');
    nadaSensivelNoLog();
  });
});
