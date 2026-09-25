import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso } from "./banco-falso";

// Envio ativo (aviso de remarcacao, eco da resposta ao toque, mensagem da
// oferta de espera) com o WhatsApp da clinica fora do ar. Defeito corrigido:
// 'desconectado' e 'sem_numero' viravam retry que QUEIMAVA tentativa com
// backoff, e o envio morria em cerca de meia hora. Agora e espera do canal:
// reagendar_job com o motivo, sem queimar tentativa, ate o prazo FIXO (a
// consulta do payload, ou created_at + 12h); passado o prazo, falha
// definitiva 'desconectado'.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const OUTRO_NUMERO = "77777777-7777-4777-8777-777777777777";
const CONSULTA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const PROFISSIONAL = "88888888-8888-4888-8888-888888888888";
const JOB = "66666666-6666-4666-8666-666666666666";
const WORKER = "worker-de-teste";

const MIN = 60_000;
const HORA = 60 * MIN;
const AGORA = new Date("2026-09-25T15:00:00.000Z").getTime();
const iso = (epoch: number) => new Date(epoch).toISOString();

const SEM_NUMERO = { estado: "sem_numero" };
const NUMERO_OK = { estado: "ok", whatsapp_account_id: NUMERO };
const DESCONECTADO = {
  ok: false,
  reason: "desconectado",
  code: "desconectado",
  message: "",
};

function banco(opcoes: {
  numero: Record<string, unknown>;
  inicioDaConsulta?: number;
}) {
  return bancoFalso({
    tabelas: {
      appointment: () => ({
        data:
          opcoes.inicioDaConsulta === undefined
            ? null
            : {
                status: "agendado",
                starts_at: iso(opcoes.inicioDaConsulta),
                professional_id: PROFISSIONAL,
              },
        error: null,
      }),
    },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      consentimento_vigente: () => ({ data: true, error: null }),
      numero_do_job: () => ({ data: opcoes.numero, error: null }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      reagendar_job: () => ({ data: true, error: null }),
      falhar_job: () => ({ data: null, error: null }),
    },
  });
}

function job(campos: {
  payload?: Record<string, unknown>;
  criadoEm?: number | null;
  numeroCarimbado?: string | null;
}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    payload: {
      contact_id: CONTATO,
      body: "Mensagem automática (teste)",
      ...campos.payload,
    },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: campos.numeroCarimbado ?? NUMERO,
    ...(campos.criadoEm === null
      ? {}
      : { created_at: iso(campos.criadoEm ?? AGORA - HORA) }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppText).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("envio ativo esperando o canal", () => {
  it("clínica sem número: reagenda em 5 minutos com 'sem_numero', sem queimar tentativa nem abrir conversa", async () => {
    const b = banco({ numero: SEM_NUMERO });
    const desfecho = await executarJobComPosse(b.admin, WORKER, job({}));
    expect(desfecho).toBe("reagendado");
    expect(b.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: WORKER,
        p_run_at: iso(AGORA + 5 * MIN),
        p_motivo: "sem_numero",
      },
    ]);
    expect(b.chamadasDe("falhar_job")).toEqual([]);
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("número desconectado: espera crescente pelo mesmo número, com o motivo 'desconectado'", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const esperas: number[] = [];
    for (const feitas of [0, 2, 5, 40]) {
      const b = banco({ numero: NUMERO_OK });
      const desfecho = await executarJobComPosse(
        b.admin,
        WORKER,
        job({ payload: { esperas_do_canal: feitas } }),
      );
      expect(desfecho).toBe("reagendado");
      const [chamada] = b.chamadasDe("reagendar_job");
      expect(chamada?.p_motivo).toBe("desconectado");
      esperas.push(
        (new Date(chamada?.p_run_at as string).getTime() - AGORA) / MIN,
      );
      expect(b.chamadasDe("falhar_job")).toEqual([]);
    }
    expect(esperas).toEqual([5, 15, 30, 30]);
  });

  it("sem consulta, o prazo é created_at mais 12 horas: passado, falha definitiva 'desconectado'", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const b = banco({ numero: NUMERO_OK });
    const desfecho = await executarJobComPosse(
      b.admin,
      WORKER,
      job({ criadoEm: AGORA - 12 * HORA - MIN }),
    );
    expect(desfecho).toBe("falhou");
    expect(b.chamadasDe("reagendar_job")).toEqual([]);
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "desconectado",
        p_definitivo: true,
        p_worker: WORKER,
      },
    ]);
  });

  it("sem número depois do prazo também encerra como 'desconectado'", async () => {
    const b = banco({ numero: SEM_NUMERO });
    await executarJobComPosse(
      b.admin,
      WORKER,
      job({ criadoEm: AGORA - 13 * HORA }),
    );
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "desconectado",
        p_definitivo: true,
        p_worker: WORKER,
      },
    ]);
  });

  it("job sem created_at (montado à mão) espera como recém-criado", async () => {
    const b = banco({ numero: SEM_NUMERO });
    expect(
      await executarJobComPosse(b.admin, WORKER, job({ criadoEm: null })),
    ).toBe("reagendado");
  });
});

describe("aviso de remarcação: o prazo é a hora da consulta", () => {
  function aviso(inicio: number) {
    return {
      appointment_id: CONSULTA,
      starts_at: iso(inicio),
      professional_id: PROFISSIONAL,
    };
  }

  it("job com mais de 12 horas ainda espera, porque a consulta não chegou", async () => {
    const inicio = AGORA + 30 * HORA;
    const b = banco({ numero: SEM_NUMERO, inicioDaConsulta: inicio });
    const desfecho = await executarJobComPosse(
      b.admin,
      WORKER,
      job({ payload: aviso(inicio), criadoEm: AGORA - 13 * HORA }),
    );
    expect(desfecho).toBe("reagendado");
    expect(b.chamadasDe("reagendar_job")[0]?.p_run_at).toBe(
      iso(AGORA + 5 * MIN),
    );
  });

  it("perto da consulta, a última volta cai 1 minuto antes dela", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const inicio = AGORA + 3 * MIN;
    const b = banco({ numero: NUMERO_OK, inicioDaConsulta: inicio });
    await executarJobComPosse(b.admin, WORKER, job({ payload: aviso(inicio) }));
    expect(b.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: WORKER,
        p_run_at: iso(inicio - MIN),
        p_motivo: "desconectado",
      },
    ]);
  });

  it("sem tempo útil antes da consulta, falha definitiva 'desconectado'", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const inicio = AGORA + 30_000;
    const b = banco({ numero: NUMERO_OK, inicioDaConsulta: inicio });
    await executarJobComPosse(b.admin, WORKER, job({ payload: aviso(inicio) }));
    expect(b.chamadasDe("falhar_job")[0]).toMatchObject({
      p_erro: "desconectado",
      p_definitivo: true,
    });
  });
});

describe("eco da resposta ao toque (D4) e número removido: nada muda", () => {
  const eco = { resposta_ao_paciente: true };

  it("o eco espera a reconexão do número que recebeu a resposta", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const b = banco({ numero: NUMERO_OK });
    expect(
      await executarJobComPosse(b.admin, WORKER, job({ payload: eco })),
    ).toBe("reagendado");
    expect(b.chamadasDe("reagendar_job")[0]?.p_motivo).toBe("desconectado");
  });

  it("o eco cujo número saiu morre como 'numero_removido', nunca espera outro número", async () => {
    for (const numero of [
      SEM_NUMERO,
      { estado: "ok", whatsapp_account_id: OUTRO_NUMERO },
      { estado: "numero_removido" },
    ]) {
      const b = banco({ numero });
      expect(
        await executarJobComPosse(b.admin, WORKER, job({ payload: eco })),
      ).toBe("falhou");
      expect(b.chamadasDe("falhar_job")).toEqual([
        {
          p_id: JOB,
          p_erro: "numero_removido",
          p_definitivo: true,
          p_worker: WORKER,
        },
      ]);
      expect(b.chamadasDe("reagendar_job")).toEqual([]);
    }
  });

  it("número removido no envio (não eco) continua indo para a próxima tentativa", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "desconectado",
      code: "numero_removido",
      message: "",
    } as never);
    const b = banco({ numero: NUMERO_OK });
    await executarJobComPosse(b.admin, WORKER, job({}));
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "numero_removido",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(b.chamadasDe("reagendar_job")).toEqual([]);
  });
});
