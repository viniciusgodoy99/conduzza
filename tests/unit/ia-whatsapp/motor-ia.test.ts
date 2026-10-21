import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("o teste injeta o admin");
  },
}));

const worker = vi.hoisted(() => ({
  executarJobComPosse: vi.fn<
    (
      admin: unknown,
      workerId: string,
      job: { id: string },
      opcoes: unknown,
    ) => Promise<string>
  >(async () => "concluido"),
}));
vi.mock("@/lib/jobs/worker", () => worker);

import { BancoEmMemoria } from "./banco-em-memoria";

const { executarPassagemDaIa } = await import("@/lib/jobs/motor-ia");

// O motor da IA (E3): sem T1 nao reivindica; o claim proprio pede no maximo
// 4 jobs, so das clinicas da lista e sem as de teste em producao; cada job
// roda no proprio grupo, em paralelo, com o prazo da invocacao e o executor
// unico da invocacao; a batida e 'motor-ia'.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";

function jobDe(id: string) {
  return {
    id,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: "c0000000-0000-4000-8000-000000000001" },
    attempts: 1,
    max_attempts: 3,
  };
}

let banco: BancoEmMemoria;

beforeEach(() => {
  banco = new BancoEmMemoria();
  worker.executarJobComPosse.mockReset();
  worker.executarJobComPosse.mockResolvedValue("concluido");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("executarPassagemDaIa", () => {
  it("sem T1: bate o ponto e não reivindica nada", async () => {
    const resumo = await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: false, clinicas: [] },
      },
    });
    expect(resumo).toEqual({
      reivindicados: 0,
      concluidos: 0,
      falhos: 0,
      reagendados: 0,
      semPosse: 0,
    });
    expect(banco.chamadasDe("claim_jobs_da_ia")).toEqual([]);
    expect(banco.chamadasDe("bater_ponto_do_worker")[0]).toEqual({
      p_worker_id: "motor-ia",
      p_ultimo_lote: 0,
    });
  });

  it("baterPonto: false (as suítes) não grava a batida 'motor-ia', nem antes nem depois", async () => {
    banco.rpc("claim_jobs_da_ia", () => ({ data: [jobDe("j1")], error: null }));
    const resumo = await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      baterPonto: false,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    expect(resumo.concluidos).toBe(1);
    expect(banco.chamadasDe("bater_ponto_do_worker")).toEqual([]);
    // Sem a opcao (a rota de producao), as duas batidas continuam.
    await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    expect(banco.chamadasDe("bater_ponto_do_worker")).toHaveLength(2);
  });

  it("com T1: claim próprio com a lista e sem as de teste; cada job com o prazo e o executor", async () => {
    banco.rpc("claim_jobs_da_ia", () => ({
      data: [jobDe("j1"), jobDe("j2"), jobDe("j3")],
      error: null,
    }));
    worker.executarJobComPosse
      .mockResolvedValueOnce("concluido")
      .mockResolvedValueOnce("reagendado")
      .mockResolvedValueOnce("sem_posse");
    const prazoFinalMs = Date.now() + 55_000;
    const resumo = await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    expect(banco.chamadasDe("claim_jobs_da_ia")).toEqual([
      {
        p_worker: EXECUTOR,
        p_max: 4,
        p_clinic_ids: [CLINICA],
        p_incluir_teste: false,
      },
    ]);
    expect(resumo).toEqual({
      reivindicados: 3,
      concluidos: 1,
      falhos: 0,
      reagendados: 1,
      semPosse: 1,
    });
    for (const [, workerId, , opcoes] of worker.executarJobComPosse.mock
      .calls) {
      expect(workerId).toBe(EXECUTOR);
      expect(opcoes).toMatchObject({
        prazoFinalMs,
        dependenciasDaIa: expect.objectContaining({
          prazoFinalMs,
          incluirClinicasDeTeste: false,
        }),
      });
    }
  });

  it("os jobs correm em paralelo, cada um no seu grupo", async () => {
    banco.rpc("claim_jobs_da_ia", () => ({
      data: [jobDe("j1"), jobDe("j2")],
      error: null,
    }));
    const iniciados: string[] = [];
    let liberar: () => void = () => {};
    const portao = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    worker.executarJobComPosse.mockImplementation(async (_a, _w, job) => {
      iniciados.push(job.id);
      await portao;
      return "concluido";
    });
    const passagem = executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    await vi.waitFor(() => expect(iniciados).toEqual(["j1", "j2"]));
    liberar();
    expect((await passagem).concluidos).toBe(2);
  });

  it("claim com erro: nada roda", async () => {
    banco.rpc("claim_jobs_da_ia", () => ({
      data: null,
      error: { code: "57014" },
    }));
    const resumo = await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    expect(resumo.reivindicados).toBe(0);
    expect(worker.executarJobComPosse).not.toHaveBeenCalled();
  });

  describe("a lista das clínicas vem do banco (onda 1)", () => {
    /** O ambiente da IA de pe (T1): producao, chave e segredo. */
    function ambienteLigado() {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("OPENAI_API_KEY", "chave-de-mentira");
      vi.stubEnv("IA_SEGREDO_DO_IDENTIFICADOR", "s".repeat(40));
    }

    it("sem config injetada: lê a lista uma vez e a MESMA vai ao claim e ao executor", async () => {
      ambienteLigado();
      const OUTRA = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
      banco.rpc("ia_clinicas_da_fase_controlada", () => ({
        data: [CLINICA.toUpperCase(), OUTRA],
        error: null,
      }));
      banco.rpc("claim_jobs_da_ia", () => ({
        data: [jobDe("j1")],
        error: null,
      }));
      const resumo = await executarPassagemDaIa({
        executorId: EXECUTOR,
        prazoFinalMs: Date.now() + 55_000,
        dependencias: { admin: banco.cliente() },
      });
      expect(resumo.concluidos).toBe(1);
      expect(banco.chamadasDe("ia_clinicas_da_fase_controlada")).toHaveLength(
        1,
      );
      expect(banco.chamadasDe("claim_jobs_da_ia")[0]).toMatchObject({
        p_clinic_ids: [CLINICA, OUTRA],
      });
      const [, , , opcoes] = worker.executarJobComPosse.mock.calls[0]!;
      expect(opcoes).toMatchObject({
        dependenciasDaIa: {
          config: { ligado: true, clinicas: [CLINICA, OUTRA] },
        },
      });
    });

    it("lista ilegível: bate o ponto e não reivindica nada (falha fechada)", async () => {
      ambienteLigado();
      banco.rpc("ia_clinicas_da_fase_controlada", () => ({
        data: null,
        error: { code: "57014" },
      }));
      const resumo = await executarPassagemDaIa({
        executorId: EXECUTOR,
        prazoFinalMs: Date.now() + 55_000,
        dependencias: { admin: banco.cliente() },
      });
      expect(resumo.reivindicados).toBe(0);
      expect(banco.chamadasDe("claim_jobs_da_ia")).toEqual([]);
      expect(banco.chamadasDe("bater_ponto_do_worker")).toHaveLength(1);
      expect(worker.executarJobComPosse).not.toHaveBeenCalled();
    });

    it("lista vazia (nenhuma clínica em teste): nada é reivindicado", async () => {
      ambienteLigado();
      banco.rpc("ia_clinicas_da_fase_controlada", () => ({
        data: [],
        error: null,
      }));
      await executarPassagemDaIa({
        executorId: EXECUTOR,
        prazoFinalMs: Date.now() + 55_000,
        dependencias: { admin: banco.cliente() },
      });
      expect(banco.chamadasDe("claim_jobs_da_ia")).toEqual([]);
    });

    it("sem T1 nem lê a lista", async () => {
      banco.rpc("ia_clinicas_da_fase_controlada", () => ({
        data: [CLINICA],
        error: null,
      }));
      await executarPassagemDaIa({
        executorId: EXECUTOR,
        prazoFinalMs: Date.now() + 55_000,
        dependencias: { admin: banco.cliente() },
      });
      expect(banco.chamadasDe("ia_clinicas_da_fase_controlada")).toEqual([]);
      expect(banco.chamadasDe("claim_jobs_da_ia")).toEqual([]);
    });
  });

  it("incluirClinicasDeTeste lança em produção; fora dela vai ao claim", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(
      executarPassagemDaIa({
        executorId: EXECUTOR,
        prazoFinalMs: Date.now() + 55_000,
        incluirClinicasDeTeste: true,
        dependencias: {
          admin: banco.cliente(),
          config: { ligado: true, clinicas: [CLINICA] },
        },
      }),
    ).rejects.toThrow();
    expect(banco.chamadas).toEqual([]);
    vi.stubEnv("VERCEL_ENV", "preview");
    await executarPassagemDaIa({
      executorId: EXECUTOR,
      prazoFinalMs: Date.now() + 55_000,
      incluirClinicasDeTeste: true,
      dependencias: {
        admin: banco.cliente(),
        config: { ligado: true, clinicas: [CLINICA] },
      },
    });
    expect(banco.chamadasDe("claim_jobs_da_ia")[0]).toMatchObject({
      p_incluir_teste: true,
    });
  });
});

describe("rota /api/webhooks/motor-ia", () => {
  // vi.doMock (nao hoisted): o objeto pode nascer aqui dentro.
  const passagem = {
    executarPassagemDaIa:
      vi.fn<
        (opcoes: {
          executorId: string;
          prazoFinalMs: number;
        }) => Promise<unknown>
      >(),
  };

  async function rota() {
    vi.resetModules();
    vi.doMock("@/lib/jobs/motor-ia", () => passagem);
    return import("@/app/api/webhooks/motor-ia/route");
  }

  function pedido(segredo: string | null, corpo: unknown = { origem: "cron" }) {
    return new NextRequest("https://exemplo.test/api/webhooks/motor-ia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(segredo ? { authorization: `Bearer ${segredo}` } : {}),
      },
      body: JSON.stringify(corpo),
    });
  }

  beforeEach(() => {
    passagem.executarPassagemDaIa.mockReset();
    passagem.executarPassagemDaIa.mockResolvedValue({
      reivindicados: 1,
      concluidos: 1,
      falhos: 0,
      reagendados: 0,
      semPosse: 0,
    });
  });

  it("contrato da rota: nodejs, dinâmica e 60 s", async () => {
    const modulo = await rota();
    expect(modulo.runtime).toBe("nodejs");
    expect(modulo.dynamic).toBe("force-dynamic");
    expect(modulo.maxDuration).toBe(60);
  });

  it("sem o segredo no ambiente ou com o segredo errado: 401, sem passagem", async () => {
    const { POST } = await rota();
    vi.stubEnv("MOTOR_TICK_SECRET", "");
    expect((await POST(pedido("qualquer"))).status).toBe(401);
    vi.stubEnv("MOTOR_TICK_SECRET", "segredo-certo");
    expect((await POST(pedido("errado"))).status).toBe(401);
    expect((await POST(pedido(null))).status).toBe(401);
    expect(passagem.executarPassagemDaIa).not.toHaveBeenCalled();
  });

  it("com o segredo: um executor novo por invocação e o resumo do motor ia", async () => {
    const { POST } = await rota();
    vi.stubEnv("MOTOR_TICK_SECRET", "segredo-certo");
    const antes = Date.now();
    const resposta = await POST(pedido("segredo-certo"));
    await POST(pedido("segredo-certo", {}));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      ok: true,
      motor: "ia",
      reivindicados: 1,
      concluidos: 1,
      falhos: 0,
      reagendados: 0,
      semPosse: 0,
    });
    const [primeira, segunda] = passagem.executarPassagemDaIa.mock.calls.map(
      (c) => c[0],
    );
    expect(primeira?.executorId).toMatch(
      /^motor-ia:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(primeira?.executorId).not.toBe(segunda?.executorId);
    expect(primeira!.prazoFinalMs).toBeGreaterThanOrEqual(antes + 50_000);
    expect(primeira!.prazoFinalMs).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("corpo inválido: 400; erro na passagem: 500 só com o nome do erro", async () => {
    const { POST } = await rota();
    vi.stubEnv("MOTOR_TICK_SECRET", "segredo-certo");
    expect((await POST(pedido("segredo-certo", { origem: 1 }))).status).toBe(
      400,
    );
    passagem.executarPassagemDaIa.mockRejectedValue(new TypeError("detalhe"));
    const resposta = await POST(pedido("segredo-certo"));
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "TypeError" });
  });
});
