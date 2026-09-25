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

import {
  sendWhatsAppMenu,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { codigoDoErro, ErroComCodigoDeJob } from "@/lib/jobs/erro-de-job";
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate, type Resposta } from "./banco-falso";

// Leitura do banco que falha (rede, timeout, 5xx: o PostgREST devolve
// { data: null, error } sem lancar) NUNCA vira decisao definitiva: nada de
// "run inexistente", nada de pular por falta de autorizacao (com registro
// falso na trilha), nada de mandar o pos falta para quem ja remarcou. Vira
// retry do job, com o codigo seguro em last_error.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const RUN = "33333333-3333-4333-8333-333333333333";
const CONSULTA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const WORKER = "worker-de-teste";
const AGORA = new Date("2026-09-25T15:00:00.000Z").getTime();
const FALHA: Resposta = {
  data: null,
  error: { code: "57014", message: "statement timeout" },
};

function run(kind: "confirmacao" | "pos_falta") {
  return {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: CONSULTA,
    scheduled_for: new Date(AGORA - 60_000).toISOString(),
    sent_at: null,
    skipped_reason: null,
    cadence_step: {
      id: "passo",
      offset_minutes: kind === "confirmacao" ? -1440 : 0,
      fixed_body: "Oi, {{nome}}! Mensagem da clínica (teste).",
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
      cadence: {
        id: "regua",
        kind,
        active: true,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_weekdays: [0, 1, 2, 3, 4, 5, 6],
        trigger_stage: null,
      },
    },
    contact: {
      name: "Paciente",
      funnel_stage: "agendou",
      funnel_stage_changed_at: null,
      last_contact_at: null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
}

function jobDeRegua(): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "executar_passo_de_regua",
    payload: { cadence_run_id: RUN },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: null,
  };
}

function rpcsBase(consentimento: Resposta = { data: true, error: null }) {
  return {
    confirmar_posse_job: () => ({ data: true, error: null }),
    consentimento_vigente: () => consentimento,
    falhar_job: () => ({ data: null, error: null }),
    reagendar_job: () => ({ data: true, error: null }),
  };
}

function efeitosNaRun(b: ReturnType<typeof bancoFalso>) {
  return b.tabelas.filter((t) => t.tabela === "cadence_run" && eUpdate(t));
}

function insercoesNaTrilha(b: ReturnType<typeof bancoFalso>) {
  return b.tabelas.filter(
    (t) =>
      t.tabela === "audit_log" && t.metodos.some((m) => m.metodo === "insert"),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppText).mockReset();
  vi.mocked(sendWhatsAppMenu).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("régua: leitura com erro vira retry, nunca decisão", () => {
  it("a run ilegível não é 'run inexistente' (que fecharia a run como falha_envio)", async () => {
    const b = bancoFalso({
      tabelas: { cadence_run: () => FALHA },
      rpcs: rpcsBase(),
    });
    await expect(
      executarPassoDeRegua(b.admin, jobDeRegua(), WORKER),
    ).rejects.toThrow("run_ilegivel: 57014");

    expect(await executarJobComPosse(b.admin, WORKER, jobDeRegua())).toBe(
      "falhou",
    );
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "run_ilegivel: 57014",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
  });

  it("consentimento sem resposta: não pula a run nem registra bloqueio na trilha", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence_run: (chamada) =>
          eUpdate(chamada)
            ? { data: null, error: null }
            : { data: run("confirmacao"), error: null },
      },
      rpcs: rpcsBase(FALHA),
    });
    await expect(
      executarPassoDeRegua(b.admin, jobDeRegua(), WORKER),
    ).rejects.toThrow("consentimento_ilegivel: 57014");
    expect(efeitosNaRun(b)).toEqual([]);
    expect(insercoesNaTrilha(b)).toEqual([]);
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
  });

  it("consentimento revogado de fato continua pulando e registrando (controle)", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence_run: (chamada) =>
          eUpdate(chamada)
            ? { data: null, error: null }
            : { data: run("confirmacao"), error: null },
      },
      rpcs: rpcsBase({ data: false, error: null }),
    });
    expect(await executarPassoDeRegua(b.admin, jobDeRegua(), WORKER)).toEqual({
      ok: true,
    });
    expect(efeitosNaRun(b)).toHaveLength(1);
    expect(insercoesNaTrilha(b)).toHaveLength(1);
  });

  it.each(["appointment_status_history", "contagem"] as const)(
    "pós falta com a leitura da remarcação falhando (%s): não sai e não para a cadeia",
    async (qual) => {
      let leiturasDeConsulta = 0;
      const b = bancoFalso({
        tabelas: {
          cadence_run: (chamada) =>
            eUpdate(chamada)
              ? { data: null, error: null }
              : { data: run("pos_falta"), error: null },
          appointment: () => {
            leiturasDeConsulta += 1;
            // 1a leitura: a consulta da falta; a seguinte e a contagem.
            if (leiturasDeConsulta === 1) {
              return {
                data: {
                  id: CONSULTA,
                  status: "faltou",
                  starts_at: new Date(AGORA - 86_400_000).toISOString(),
                  send_confirmation: true,
                  remarcacao_pedida_em: null,
                  service_link: null,
                  professional: null,
                },
                error: null,
              };
            }
            return qual === "contagem" ? FALHA : { data: null, error: null };
          },
          appointment_status_history: () =>
            qual === "appointment_status_history"
              ? FALHA
              : { data: null, error: null },
        },
        rpcs: rpcsBase(),
      });
      await expect(
        executarPassoDeRegua(b.admin, jobDeRegua(), WORKER),
      ).rejects.toThrow("remarcacao_ilegivel: 57014");
      expect(efeitosNaRun(b)).toEqual([]);
      expect(sendWhatsAppText).not.toHaveBeenCalled();
    },
  );
});

describe("envio ativo: consentimento sem resposta", () => {
  it("vira retry com o código seguro, sem registro na trilha", async () => {
    const b = bancoFalso({
      rpcs: {
        ...rpcsBase(FALHA),
        numero_do_job: () => ({
          data: { estado: "ok", whatsapp_account_id: "numero" },
          error: null,
        }),
      },
    });
    const job: Job = {
      id: JOB,
      clinic_id: CLINICA,
      kind: "enviar_mensagem_ativa",
      payload: { contact_id: CONTATO, body: "Mensagem automática (teste)" },
      attempts: 1,
      max_attempts: 8,
      whatsapp_account_id: "numero",
    };
    expect(await executarJobComPosse(b.admin, WORKER, job)).toBe("falhou");
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "consentimento_ilegivel: 57014",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(insercoesNaTrilha(b)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe("executor: só o código seguro sai do processo", () => {
  it("exceção comum continua 'excecao_no_worker' (texto livre nunca vai para last_error)", async () => {
    const b = bancoFalso({
      tabelas: {
        cadence_run: () => {
          throw new Error("Paciente Fulana, telefone 84 9...");
        },
      },
      rpcs: rpcsBase(),
    });
    expect(await executarJobComPosse(b.admin, WORKER, jobDeRegua())).toBe(
      "falhou",
    );
    expect(b.chamadasDe("falhar_job")[0]?.p_erro).toBe("excecao_no_worker");
  });

  it("código vazio (rede caiu, sem resposta) vira 'sem_resposta'", () => {
    expect(codigoDoErro({ code: "" })).toBe("sem_resposta");
    expect(codigoDoErro({ code: null })).toBe("desconhecido");
    expect(codigoDoErro({ code: "57014" })).toBe("57014");
  });

  it("ErroComCodigoDeJob guarda o código como mensagem", () => {
    const erro = new ErroComCodigoDeJob("run_ilegivel: 57014");
    expect(erro.codigo).toBe("run_ilegivel: 57014");
    expect(erro.message).toBe("run_ilegivel: 57014");
    expect(erro).toBeInstanceOf(Error);
  });
});
