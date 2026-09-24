import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A rota que o monitor externo chama. O que importa aqui e o contrato com o
// monitor: 200 so quando tudo esta em dia, 503 em qualquer alerta ou quando a
// saude nem pode ser lida, 401 com segredo errado ou ausente no ambiente.

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

const { GET } = await import("@/app/api/webhooks/saude/route");

const SEGREDO = "segredo-do-monitor-de-teste";
const URL_BASE = "https://exemplo.test/api/webhooks/saude";

function saudavel() {
  const agora = Date.now();
  return {
    fila: { batida_em: new Date(agora - 10_000).toISOString(), ultimo_erro: null },
    planner: {
      batida_em: new Date(agora - 30_000).toISOString(),
      ultimo_erro: null,
    },
    atrasados: 0,
  };
}

function pedido(opcoes: { cabecalho?: string; query?: string } = {}) {
  const url = opcoes.query ? `${URL_BASE}?token=${opcoes.query}` : URL_BASE;
  return new NextRequest(url, {
    headers: opcoes.cabecalho ? { authorization: opcoes.cabecalho } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("MOTOR_SAUDE_SECRET", SEGREDO);
  rpc.mockReset();
  // O log escreve em stdout/stderr; o teste nao precisa do ruido.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/webhooks/saude", () => {
  it("sem segredo no ambiente responde 401 sempre", async () => {
    vi.stubEnv("MOTOR_SAUDE_SECRET", "");
    const resposta = await GET(pedido({ cabecalho: "Bearer " }));
    expect(resposta.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("segredo errado responde 401 sem tocar no banco", async () => {
    const resposta = await GET(pedido({ cabecalho: "Bearer outro" }));
    expect(resposta.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aceita o segredo no cabecalho e na query", async () => {
    rpc.mockResolvedValue({ data: saudavel(), error: null });
    expect((await GET(pedido({ cabecalho: `Bearer ${SEGREDO}` }))).status).toBe(
      200,
    );
    expect((await GET(pedido({ query: SEGREDO }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("saude_do_motor");
  });

  it("saudavel: 200, sem cache e com corpo curto", async () => {
    rpc.mockResolvedValue({ data: saudavel(), error: null });
    const resposta = await GET(pedido({ query: SEGREDO }));
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    const corpo = (await resposta.json()) as Record<string, unknown>;
    expect(corpo.ok).toBe(true);
    expect(corpo.alertas).toEqual([]);
    expect(corpo.atrasados).toBe(0);
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "alertas",
        "atrasados",
        "fila_ha_s",
        "ok",
        "planner_erro",
        "planner_ha_s",
      ].sort(),
    );
  });

  it("fila vencida: 503", async () => {
    const saude = saudavel();
    saude.fila.batida_em = new Date(Date.now() - 10 * 60_000).toISOString();
    rpc.mockResolvedValue({ data: saude, error: null });
    const resposta = await GET(pedido({ query: SEGREDO }));
    expect(resposta.status).toBe(503);
    expect(((await resposta.json()) as { alertas: string[] }).alertas).toEqual([
      "fila_parada",
    ]);
  });

  it("fila atrasada com as batidas em dia: 503", async () => {
    rpc.mockResolvedValue({
      data: { ...saudavel(), atrasados: 2 },
      error: null,
    });
    const resposta = await GET(pedido({ query: SEGREDO }));
    expect(resposta.status).toBe(503);
  });

  it("planner com erro na ultima passagem: 503", async () => {
    const saude = saudavel();
    rpc.mockResolvedValue({
      data: {
        ...saude,
        planner: { ...saude.planner, ultimo_erro: "planejar_reguas:42P01" },
      },
      error: null,
    });
    const resposta = await GET(pedido({ query: SEGREDO }));
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { planner_erro: string | null };
    expect(corpo.planner_erro).toBe("planejar_reguas:42P01");
  });

  it("saude ilegivel (erro da RPC ou excecao): 503, nunca 200", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST000" } });
    expect((await GET(pedido({ query: SEGREDO }))).status).toBe(503);
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    expect((await GET(pedido({ query: SEGREDO }))).status).toBe(503);
  });
});
