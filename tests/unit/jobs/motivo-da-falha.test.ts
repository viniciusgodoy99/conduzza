import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
// Toda falha e definitiva aqui: o toque fecha na hora como 'falha_envio'.
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

import { sendWhatsAppMenu } from "@/lib/integrations/whatsapp/send";
import { executarPassoDeRegua, motivoDaFalhaDeEnvio } from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate } from "./banco-falso";

// Fase 3 (migration 20261002110000): o toque que fecha como 'falha_envio'
// leva o codigo do envio em cadence_run.motivo_da_falha, para o cartao "Nao
// enviadas" de Confirmacoes mostrar o motivo mais comum. A coluna tem CHECK
// (^[a-z0-9_]{1,64}$ e so com skipped_reason = 'falha_envio'): o codigo e
// normalizado pela mesma regra de fechar_runs_orfas, e os outros motivos de
// pulo continuam gravando so skipped_reason.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const CONSULTA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const WORKER = "worker-de-teste";

const MIN = 60_000;
const HORA = 60 * MIN;
// 12h em Fortaleza (UTC-3): dentro da janela de envio aberta o dia todo.
const AGORA = new Date("2026-09-25T15:00:00.000Z").getTime();

function banco() {
  const iso = (epoch: number) => new Date(epoch).toISOString();
  const inicioDaConsulta = AGORA + 20 * HORA;
  const run = {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: CONSULTA,
    scheduled_for: iso(inicioDaConsulta - 1440 * MIN),
    sent_at: null,
    skipped_reason: null,
    cadence_step: {
      id: "passo",
      offset_minutes: -1440,
      fixed_body: "Oi, {{nome}}! Mensagem da clínica (teste).",
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
      cadence: {
        id: "regua",
        kind: "confirmacao",
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
      funnel_stage_changed_at: iso(AGORA - 2 * HORA),
      last_contact_at: null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
  const consulta = {
    id: CONSULTA,
    status: "agendado",
    starts_at: iso(inicioDaConsulta),
    send_confirmation: true,
    remarcacao_pedida_em: null,
    service_link: { procedure: { name: "Consulta", prep_instructions: null } },
    professional: { name: "Dra. Teste" },
  };
  return bancoFalso({
    tabelas: {
      cadence_run: (chamada) =>
        eUpdate(chamada)
          ? { data: null, error: null }
          : { data: run, error: null },
      appointment: () => ({ data: consulta, error: null }),
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
      consentimento_vigente: () => ({ data: true, error: null }),
      regua_da_consulta: () => ({ data: "regua", error: null }),
      numero_do_job: () => ({
        data: { estado: "ok", whatsapp_account_id: NUMERO },
        error: null,
      }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      confirmar_posse_job: () => ({ data: true, error: null }),
      reagendar_job: () => ({ data: true, error: null }),
    },
  });
}

function job(): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "executar_passo_de_regua",
    payload: { cadence_run_id: RUN },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
  };
}

function falhaDoEnvio(code: string | undefined) {
  return { ok: false, reason: "falha_envio", code, message: "" };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppMenu).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("motivoDaFalhaDeEnvio: a mesma regra de fechar_runs_orfas", () => {
  it.each([
    ["uazapi_500", "uazapi_500"],
    ["whatsapp_463", "whatsapp_463"],
    ["envio_incerto", "envio_incerto"],
    // So o trecho antes do primeiro ':' (o resto pode trazer detalhe do
    // provedor), sem espaco nas pontas e em minusculas.
    ["pular_run_falhou: 42501", "pular_run_falhou"],
    ["STORAGE_FALHOU:413:EntityTooLarge", "storage_falhou"],
    ["  envio_incerto  ", "envio_incerto"],
    ["a".repeat(64), "a".repeat(64)],
  ])("%s vira %s", (codigo, esperado) => {
    expect(motivoDaFalhaDeEnvio(codigo)).toBe(esperado);
  });

  it.each([
    [undefined],
    [null],
    [""],
    [":uazapi_500"],
    ["Fetch failed (timeout)"],
    ["uazapi-500"],
    ["envío_incerto"],
    ["a".repeat(65)],
  ])("%s fora do formato vira 'desconhecido'", (codigo) => {
    expect(motivoDaFalhaDeEnvio(codigo)).toBe("desconhecido");
  });

  it("o resultado sempre cabe no CHECK da coluna", () => {
    for (const codigo of ["x", "Uazapi 500", "a:b:c", "\n", "ÇÃO", "1_2"]) {
      expect(motivoDaFalhaDeEnvio(codigo)).toMatch(/^[a-z0-9_]{1,64}$/);
    }
  });
});

describe("toque que falha de vez grava o motivo junto com 'falha_envio'", () => {
  it("o código do envio vai para motivo_da_falha", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(
      falhaDoEnvio("uazapi_500") as never,
    );
    const b = banco();
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "uazapi_500",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "falha_envio", motivo_da_falha: "uazapi_500" },
    ]);
  });

  it("código com detalhe depois de ':' grava só o código", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(
      falhaDoEnvio("Uazapi_400: corpo recusado") as never,
    );
    const b = banco();
    await executarPassoDeRegua(b.admin, job(), WORKER);
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "falha_envio", motivo_da_falha: "uazapi_400" },
    ]);
  });

  it("sem código, o motivo é 'desconhecido' (nunca nulo calado nem texto livre)", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(
      falhaDoEnvio(undefined) as never,
    );
    const b = banco();
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "falha_envio",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "falha_envio", motivo_da_falha: "desconhecido" },
    ]);
  });

  it("outro motivo de pulo continua sem motivo_da_falha (o CHECK recusaria)", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue({
      ok: false,
      reason: "sem_consentimento",
      code: "sem_consentimento_no_envio",
      message: "",
    } as never);
    const b = banco();
    await executarPassoDeRegua(b.admin, job(), WORKER);
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "sem_consentimento" },
    ]);
  });
});
