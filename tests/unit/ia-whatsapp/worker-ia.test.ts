import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const executor = vi.hoisted(() => ({
  executarRespostaComIa:
    vi.fn<
      (
        job: unknown,
        workerId: string,
        deps: Record<string, unknown>,
      ) => Promise<unknown>
    >(),
  dependenciasPadraoDaIa: vi.fn((entrada: { prazoFinalMs: number }) => ({
    padrao: true,
    prazoFinalMs: entrada.prazoFinalMs,
  })),
}));
vi.mock("@/lib/jobs/responder-com-ia", () => executor);

import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { BancoEmMemoria } from "./banco-em-memoria";

// O kind 'responder_com_ia' no executor comum (lib/jobs/worker.ts): o import
// do executor da IA e tardio (o laco local nao carrega o agente), o prazo e
// as dependencias chegam a ele, e o fechamento do job que desistiu (falha
// definitiva ou tentativas esgotadas) tira o texto do turno, marca
// 'sem_envio' e devolve a conversa para a equipe, sem frase, so se o job e
// da janela atual (D-A). Fora do ambiente e sem posse nao fecham nada.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";

let banco: BancoEmMemoria;

function job(extra: Partial<Job> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: CONVERSA },
    attempts: 1,
    max_attempts: 3,
    ...extra,
  };
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("tirar_conversa_da_ia_pelo_servidor", () => ({
    data: true,
    error: null,
  }));
  banco.linhas("ai_turno").push({
    job_id: JOB,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    estado: "decidido",
    texto: "texto pendente",
  });
  executor.executarRespostaComIa.mockReset();
  executor.dependenciasPadraoDaIa.mockClear();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("responder_com_ia no worker", () => {
  it("roda o executor da IA com o prazo e as dependências trocadas; concluído não fecha nada", async () => {
    executor.executarRespostaComIa.mockResolvedValue({ ok: true });
    const desfecho = await executarJobComPosse(
      banco.cliente(),
      EXECUTOR,
      job(),
      {
        prazoFinalMs: 123,
        dependenciasDaIa: { incluirClinicasDeTeste: true },
      },
    );
    expect(desfecho).toBe("concluido");
    const [, workerId, deps] = executor.executarRespostaComIa.mock.calls[0]!;
    expect(workerId).toBe(EXECUTOR);
    expect(deps).toMatchObject({
      padrao: true,
      prazoFinalMs: 123,
      incluirClinicasDeTeste: true,
    });
    expect(banco.chamadasDe("concluir_job")).toEqual([
      { p_id: JOB, p_worker: EXECUTOR },
    ]);
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
    expect(banco.linhas("ai_turno")[0]?.texto).toBe("texto pendente");
  });

  it("falha definitiva: texto apagado, turno sem_envio e a conversa volta (falha técnica, sem frase)", async () => {
    executor.executarRespostaComIa.mockResolvedValue({
      ok: false,
      erro: "envio_incerto",
      definitivo: true,
    });
    expect(await executarJobComPosse(banco.cliente(), EXECUTOR, job())).toBe(
      "falhou",
    );
    expect(banco.chamadasDe("falhar_job")[0]).toMatchObject({
      p_id: JOB,
      p_definitivo: true,
    });
    expect(banco.linhas("ai_turno")[0]).toMatchObject({
      estado: "sem_envio",
      texto: null,
    });
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_motivo: "falha_tecnica",
        p_job_id: JOB,
      },
    ]);
  });

  it("tentativas esgotadas: fecha igual; com tentativa sobrando, não", async () => {
    executor.executarRespostaComIa.mockResolvedValue({
      ok: false,
      erro: "leitura_falhou",
    });
    await executarJobComPosse(banco.cliente(), EXECUTOR, job({ attempts: 2 }));
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
    expect(banco.linhas("ai_turno")[0]?.texto).toBe("texto pendente");
    await executarJobComPosse(banco.cliente(), EXECUTOR, job({ attempts: 3 }));
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toHaveLength(
      1,
    );
    expect(banco.linhas("ai_turno")[0]).toMatchObject({
      estado: "sem_envio",
      texto: null,
    });
  });

  it("job anterior à janela atual (Assumir e Devolver depois dele): fecha o turno, mas não tira a conversa (D-A)", async () => {
    // Revisao do E3, D-A: a sessao que o Devolver abriu continua na IA.
    banco.linhas("ia_janela_da_conversa").push({
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      desde: "2026-10-13T15:00:10.000Z",
    });
    executor.executarRespostaComIa.mockResolvedValue({
      ok: false,
      erro: "envio_incerto",
      definitivo: true,
    });
    await executarJobComPosse(
      banco.cliente(),
      EXECUTOR,
      job({ created_at: "2026-10-13T14:59:00.000Z" }),
    );
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
    expect(banco.linhas("ai_turno")[0]).toMatchObject({
      estado: "sem_envio",
      texto: null,
    });
  });

  it("job da janela atual: tira; janela que não dá para ler: não tira (a varredura devolve)", async () => {
    banco.linhas("ia_janela_da_conversa").push({
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      desde: "2026-10-13T14:58:00.000Z",
    });
    executor.executarRespostaComIa.mockResolvedValue({
      ok: false,
      erro: "envio_incerto",
      definitivo: true,
    });
    await executarJobComPosse(
      banco.cliente(),
      EXECUTOR,
      job({ created_at: "2026-10-13T14:59:00.000Z" }),
    );
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toHaveLength(
      1,
    );
    banco.erros.set("ia_janela_da_conversa:select", { code: "08006" });
    await executarJobComPosse(
      banco.cliente(),
      EXECUTOR,
      job({ created_at: "2026-10-13T14:59:00.000Z" }),
    );
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toHaveLength(
      1,
    );
  });

  it.each(["ia_fora_do_ambiente", "sem_posse"])(
    "%s: a conversa fica intocada",
    async (erro) => {
      executor.executarRespostaComIa.mockResolvedValue({
        ok: false,
        erro,
        definitivo: true,
      });
      await executarJobComPosse(
        banco.cliente(),
        EXECUTOR,
        job({ attempts: 3 }),
      );
      expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual(
        [],
      );
      expect(banco.linhas("ai_turno")[0]?.estado).toBe("decidido");
    },
  );

  it("exceção no executor: retry (excecao_no_worker), sem fechar antes da última tentativa", async () => {
    executor.executarRespostaComIa.mockRejectedValue(new Error("x"));
    expect(await executarJobComPosse(banco.cliente(), EXECUTOR, job())).toBe(
      "falhou",
    );
    expect(banco.chamadasDe("falhar_job")[0]).toMatchObject({
      p_erro: "excecao_no_worker",
      p_definitivo: false,
    });
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
  });

  it("reagendar (retomar_envio) passa pelo reagendar_job sem queimar tentativa", async () => {
    executor.executarRespostaComIa.mockResolvedValue({
      reagendar: "2026-10-13T15:00:00.000Z",
      motivo: "retomar_envio",
    });
    expect(await executarJobComPosse(banco.cliente(), EXECUTOR, job())).toBe(
      "reagendado",
    );
    expect(banco.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: EXECUTOR,
        p_run_at: "2026-10-13T15:00:00.000Z",
        p_motivo: "retomar_envio",
      },
    ]);
  });
});
