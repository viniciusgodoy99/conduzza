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
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate, type Resposta } from "./banco-falso";

// Regua vinculada a medico, especialidade ou procedimento (decisao do dono
// de 29/09/2026). Antes de um toque de confirmacao ou de pos falta, o
// executor pergunta ao banco (regua_da_consulta) qual regua vale AGORA para
// a consulta. Se nao e a regua da run (a consulta trocou de medico, uma regua
// mais especifica foi ligada no meio da sequencia), ESTE toque e pulado como
// 'condicao_parada' e nada sai; a cadeia da consulta nao para. Leitura com
// erro vira retry do job, nunca decisao. O toque manual (Cobrar agora) nao
// passa pela conferencia.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const CONSULTA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const REGUA_DA_RUN = "77777777-7777-4777-8777-777777777777";
const OUTRA_REGUA = "88888888-8888-4888-8888-888888888888";
const WORKER = "worker-de-teste";

const MIN = 60_000;
const HORA = 60 * MIN;
// 12h em Fortaleza (UTC-3): dentro da janela de envio aberta o dia todo.
const AGORA = new Date("2026-09-25T15:00:00.000Z").getTime();
const FALHA: Resposta = {
  data: null,
  error: { code: "57014", message: "statement timeout" },
};
const ENVIADA = { ok: true, messageId: "mensagem-1" };

type Kind = "confirmacao" | "pos_falta" | "followup";

type Cenario = {
  kind: Kind;
  /** O que regua_da_consulta responde. */
  vigente: Resposta;
  /** Status da consulta (padrao: agendado na confirmacao, faltou no pos falta). */
  status?: string;
};

function banco(cenario: Cenario) {
  const iso = (epoch: number) => new Date(epoch).toISOString();
  const confirmacao = cenario.kind === "confirmacao";
  const followup = cenario.kind === "followup";
  // Confirmacao: consulta amanha, toque de 24h vencido ha 4 horas (mesmo dia
  // civil, sem toque atrasado). Pos falta: falta de ontem, toque de agora.
  const inicio = confirmacao ? AGORA + 20 * HORA : AGORA - 24 * HORA;
  const offset = confirmacao ? -1440 : followup ? 60 : 0;
  const scheduledFor = confirmacao ? inicio - 1440 * MIN : AGORA - MIN;
  const run = {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: followup ? null : CONSULTA,
    scheduled_for: iso(scheduledFor),
    sent_at: null,
    skipped_reason: null,
    cadence_step: {
      id: "passo",
      offset_minutes: offset,
      fixed_body: "Oi, {{nome}}! Mensagem da clínica (teste).",
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
      cadence: {
        id: REGUA_DA_RUN,
        kind: cenario.kind,
        active: true,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_weekdays: [0, 1, 2, 3, 4, 5, 6],
        trigger_stage: followup ? "em_contato" : null,
      },
    },
    contact: {
      name: "Paciente",
      funnel_stage: "em_contato",
      funnel_stage_changed_at: iso(scheduledFor - offset * MIN),
      last_contact_at: null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
  const consulta = {
    id: CONSULTA,
    status: cenario.status ?? (confirmacao ? "agendado" : "faltou"),
    starts_at: iso(inicio),
    send_confirmation: true,
    remarcacao_pedida_em: null,
    service_link: { procedure: { name: "Consulta", prep_instructions: null } },
    professional: { name: "Dra. Teste" },
  };
  let leiturasDaConsulta = 0;
  return bancoFalso({
    tabelas: {
      cadence_run: (chamada) =>
        eUpdate(chamada)
          ? { data: null, error: null }
          : { data: run, error: null },
      appointment: () => {
        leiturasDaConsulta += 1;
        // Pos falta: a 2a leitura de appointment e a contagem de consultas
        // futuras (remarcou depois da falta?), que aqui da zero.
        if (!confirmacao && leiturasDaConsulta > 1) {
          return { data: null, error: null };
        }
        return { data: consulta, error: null };
      },
      whatsapp_account: () => ({
        data: {
          provider: "fake",
          connection_status: "conectado",
          removido_em: null,
        },
        error: null,
      }),
    },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      consentimento_vigente: () => ({ data: true, error: null }),
      regua_da_consulta: () => cenario.vigente,
      numero_do_job: () => ({
        data: { estado: "ok", whatsapp_account_id: NUMERO },
        error: null,
      }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      falhar_job: () => ({ data: null, error: null }),
      reagendar_job: () => ({ data: true, error: null }),
    },
  });
}

function job(payload: Record<string, unknown> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "executar_passo_de_regua",
    payload: { cadence_run_id: RUN, ...payload },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
  };
}

/** Os updates em cadence_run, com o filtro de cada um (so a run ou a cadeia). */
function updatesNaRun(b: ReturnType<typeof banco>) {
  return b.tabelas
    .filter((t) => t.tabela === "cadence_run" && eUpdate(t))
    .map((t) => ({
      valores: t.metodos.find((m) => m.metodo === "update")?.args[0],
      filtros: t.metodos
        .filter((m) => m.metodo === "eq")
        .map((m) => m.args[0] as string),
    }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppMenu).mockReset();
  vi.mocked(sendWhatsAppText).mockReset();
  vi.mocked(sendWhatsAppMenu).mockResolvedValue(ENVIADA as never);
  vi.mocked(sendWhatsAppText).mockResolvedValue(ENVIADA as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("confirmação: a run ainda é da régua vigente da consulta?", () => {
  it("é: o toque sai, e a pergunta vai com a consulta e o tipo", async () => {
    const b = banco({
      kind: "confirmacao",
      vigente: { data: REGUA_DA_RUN, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([
      { p_appointment_id: CONSULTA, p_kind: "confirmacao" },
    ]);
    expect(sendWhatsAppMenu).toHaveBeenCalledTimes(1);
    expect(updatesNaRun(b).map((u) => u.valores)).toEqual([
      expect.objectContaining({ message_id: "mensagem-1" }),
    ]);
  });

  it("outra régua vale agora (médico trocado no meio da sequência): pula SÓ esta run, sem enviar", async () => {
    const b = banco({
      kind: "confirmacao",
      vigente: { data: OUTRA_REGUA, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
    // Nem chega a pedir numero nem conversa.
    expect(b.chamadasDe("numero_do_job")).toEqual([]);
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    // O update e da run (filtro por id), nao da cadeia da consulta: os
    // toques da regua vigente sao outras runs e continuam de pe.
    expect(updatesNaRun(b)).toEqual([
      {
        valores: { skipped_reason: "condicao_parada" },
        filtros: ["id"],
      },
    ]);
  });

  it("nenhuma régua ativa casa mais com a consulta: pula do mesmo jeito", async () => {
    const b = banco({
      kind: "confirmacao",
      vigente: { data: null, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
    expect(updatesNaRun(b).map((u) => u.valores)).toEqual([
      { skipped_reason: "condicao_parada" },
    ]);
  });

  it("leitura com erro: exceção para retry, sem pular a run e sem enviar", async () => {
    const b = banco({ kind: "confirmacao", vigente: FALHA });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "regua_vigente_ilegivel: 57014",
    );
    expect(updatesNaRun(b)).toEqual([]);
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
  });

  it("pelo executor da fila, o erro vira falhar_job NÃO definitivo com o código seguro", async () => {
    const b = banco({ kind: "confirmacao", vigente: FALHA });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("falhou");
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "regua_vigente_ilegivel: 57014",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(updatesNaRun(b)).toEqual([]);
  });

  it("consulta cancelada: a cadeia para antes, sem perguntar pela régua vigente", async () => {
    const b = banco({
      kind: "confirmacao",
      vigente: { data: OUTRA_REGUA, error: null },
      status: "cancelado_paciente",
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([]);
    // pararCadeia: filtro pela consulta, nao so pela run.
    expect(updatesNaRun(b)).toEqual([
      {
        valores: { skipped_reason: "condicao_parada" },
        filtros: ["clinic_id", "appointment_id"],
      },
    ]);
  });

  it("toque manual (Cobrar agora): não passa pela conferência e sai", async () => {
    const b = banco({
      kind: "confirmacao",
      vigente: { data: OUTRA_REGUA, error: null },
    });
    expect(
      await executarPassoDeRegua(b.admin, job({ manual: true }), WORKER),
    ).toEqual({ ok: true });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([]);
    expect(sendWhatsAppMenu).toHaveBeenCalledTimes(1);
  });
});

describe("pós falta: a mesma conferência", () => {
  it("régua vigente: o toque sai", async () => {
    const b = banco({
      kind: "pos_falta",
      vigente: { data: REGUA_DA_RUN, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([
      { p_appointment_id: CONSULTA, p_kind: "pos_falta" },
    ]);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("uma régua vinculada ao médico foi ligada depois da falta: a run da geral é pulada", async () => {
    const b = banco({
      kind: "pos_falta",
      vigente: { data: OUTRA_REGUA, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(updatesNaRun(b)).toEqual([
      {
        valores: { skipped_reason: "condicao_parada" },
        filtros: ["id"],
      },
    ]);
  });

  it("leitura com erro: exceção para retry, nada sai", async () => {
    const b = banco({ kind: "pos_falta", vigente: FALHA });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "regua_vigente_ilegivel: 57014",
    );
    expect(updatesNaRun(b)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe("follow-up não tem consulta nem vínculo", () => {
  it("não pergunta pela régua vigente e o toque sai", async () => {
    const b = banco({
      kind: "followup",
      vigente: { data: OUTRA_REGUA, error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([]);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
});
