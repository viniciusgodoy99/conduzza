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
  sendWhatsAppMedia,
  sendWhatsAppMenu,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate } from "./banco-falso";

// Toque de regua com o WhatsApp da clinica fora do ar (numero desconectado
// ou clinica sem numero). Defeito corrigido: a espera somava no teto de 20
// devolucoes da fila e a confirmacao morria em cerca de 95 minutos; nos
// demais kinds o prazo era "agora + 12h" recalculado a cada volta, e nunca
// chegava. Agora: prazo FIXO (confirmacao ate a consulta, demais reguas ate
// 12h depois da primeira abertura da janela a partir de scheduled_for),
// espera crescente de 5 ate 30 minutos e o motivo ('desconectado' ou
// 'sem_numero') sempre gravado na devolucao. O numero ja desconectado no
// banco espera antes de pedir a conversa e de baixar o anexo.

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

const JANELA_O_DIA_TODO = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

type JanelaDaRegua = typeof JANELA_O_DIA_TODO;

/** O numero do job como a leitura de whatsapp_account o devolve. */
const CONTA_CONECTADA = { connection_status: "conectado", removido_em: null };
const CONTA_DESCONECTADA = {
  connection_status: "desconectado",
  removido_em: null,
};

type Cenario = {
  kind: "confirmacao" | "followup";
  /** Deslocamento do passo em minutos (negativo na confirmacao). */
  offset: number;
  scheduledFor: number;
  /** So confirmacao: quando a consulta comeca. */
  inicioDaConsulta?: number;
  /** O que numero_do_job responde. */
  numero: { estado: string; whatsapp_account_id?: string };
  /** Janela de envio da regua (padrao: o dia todo). */
  janela?: JanelaDaRegua;
  /** Status do numero no banco (padrao: conectado). */
  conta?: { connection_status: string; removido_em: string | null };
  /** O passo leva anexo (um PDF de preparo). */
  anexo?: boolean;
  /** Qual leitura da consulta (1 = a primeira) devolve erro do PostgREST. */
  leituraDaConsultaQueFalha?: number;
  /** A recepcao remarca (+1h) entre a condicao de parada e a defesa. */
  remarcadaNaDefesa?: boolean;
};

function banco(cenario: Cenario) {
  const iso = (epoch: number) => new Date(epoch).toISOString();
  const run = {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: cenario.kind === "confirmacao" ? CONSULTA : null,
    scheduled_for: iso(cenario.scheduledFor),
    sent_at: null,
    skipped_reason: null,
    cadence_step: {
      id: "passo",
      offset_minutes: cenario.offset,
      fixed_body: "Oi, {{nome}}! Mensagem da clínica (teste).",
      media_path: cenario.anexo ? `${CLINICA}/preparo.pdf` : null,
      media_type: cenario.anexo ? "document" : null,
      media_mimetype: cenario.anexo ? "application/pdf" : null,
      media_filename: cenario.anexo ? "preparo.pdf" : null,
      cadence: {
        id: "regua",
        kind: cenario.kind,
        active: true,
        ...(cenario.janela ?? JANELA_O_DIA_TODO),
        trigger_stage: cenario.kind === "followup" ? "em_contato" : null,
      },
    },
    contact: {
      name: "Paciente",
      funnel_stage: "em_contato",
      // Follow-up: a entrada na etapa que gerou este vencimento.
      funnel_stage_changed_at: iso(cenario.scheduledFor - cenario.offset * MIN),
      last_contact_at: null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
  const consulta =
    cenario.inicioDaConsulta === undefined
      ? null
      : {
          id: CONSULTA,
          status: "agendado",
          starts_at: iso(cenario.inicioDaConsulta),
          send_confirmation: true,
          remarcacao_pedida_em: null,
          service_link: {
            procedure: { name: "Consulta", prep_instructions: null },
          },
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
        if (leiturasDaConsulta === cenario.leituraDaConsultaQueFalha) {
          return {
            data: null,
            error: { code: "08006", message: "sem conexão" },
          };
        }
        const remarcada =
          consulta && cenario.remarcadaNaDefesa && leiturasDaConsulta > 1
            ? {
                ...consulta,
                starts_at: iso(new Date(consulta.starts_at).getTime() + HORA),
              }
            : null;
        return { data: remarcada ?? consulta, error: null };
      },
      whatsapp_account: () => ({
        data: { provider: "fake", ...(cenario.conta ?? CONTA_CONECTADA) },
        error: null,
      }),
    },
    storage: (chamada) =>
      chamada.metodo === "download"
        ? { data: new Blob(["%PDF-teste"]), error: null }
        : { data: null, error: null },
    rpcs: {
      consentimento_vigente: () => ({ data: true, error: null }),
      numero_do_job: () => ({ data: cenario.numero, error: null }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      confirmar_posse_job: () => ({ data: true, error: null }),
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

const SEM_NUMERO = { estado: "sem_numero" };
const NUMERO_OK = { estado: "ok", whatsapp_account_id: NUMERO };
const DESCONECTADO = {
  ok: false,
  reason: "desconectado",
  code: "desconectado",
  message: "",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppMedia).mockReset();
  vi.mocked(sendWhatsAppMenu).mockReset();
  vi.mocked(sendWhatsAppText).mockReset();
});

/** Quantas vezes a consulta foi lida (updates nao contam). */
function leiturasDaConsulta(b: ReturnType<typeof banco>): number {
  return b.tabelas.filter((c) => c.tabela === "appointment" && !eUpdate(c))
    .length;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("confirmação com o WhatsApp fora do ar", () => {
  const consultaAmanha = {
    kind: "confirmacao" as const,
    offset: -1440,
    inicioDaConsulta: AGORA + 20 * HORA,
    scheduledFor: AGORA + 20 * HORA - 1440 * MIN,
  };

  it("clínica sem número: espera 5 minutos, com o motivo, sem pedir conversa", async () => {
    const b = banco({ ...consultaAmanha, numero: SEM_NUMERO });
    const resultado = await executarPassoDeRegua(b.admin, job(), WORKER);
    expect(resultado).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "sem_numero",
    });
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("número desconectado: a devolução leva o motivo 'desconectado' (antes ia sem)", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(DESCONECTADO as never);
    const b = banco({ ...consultaAmanha, numero: NUMERO_OK });
    const resultado = await executarPassoDeRegua(b.admin, job(), WORKER);
    expect(resultado).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("a espera cresce com as esperas já feitas e para em 30 minutos", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(DESCONECTADO as never);
    const esperas: number[] = [];
    for (const feitas of [0, 1, 3, 5, 25]) {
      const b = banco({ ...consultaAmanha, numero: NUMERO_OK });
      const resultado = await executarPassoDeRegua(
        b.admin,
        job({ esperas_do_canal: feitas }),
        WORKER,
      );
      expect("reagendar" in resultado).toBe(true);
      if ("reagendar" in resultado) {
        esperas.push((new Date(resultado.reagendar).getTime() - AGORA) / MIN);
      }
    }
    // A 26a espera continua esperando: o executor nao conta voltas, so prazo.
    expect(esperas).toEqual([5, 10, 20, 30, 30]);
  });

  it("perto da consulta, a última volta cai 1 minuto antes dela", async () => {
    const inicio = AGORA + 3 * MIN;
    const b = banco({
      kind: "confirmacao",
      offset: -180,
      inicioDaConsulta: inicio,
      scheduledFor: inicio - 180 * MIN,
      numero: SEM_NUMERO,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(inicio - MIN).toISOString(),
      motivo: "sem_numero",
    });
  });

  it("sem tempo útil antes da consulta: pula a run como 'desconectado'", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(DESCONECTADO as never);
    const inicio = AGORA + 30_000;
    const b = banco({
      kind: "confirmacao",
      offset: -180,
      inicioDaConsulta: inicio,
      scheduledFor: inicio - 180 * MIN,
      numero: NUMERO_OK,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "desconectado",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "desconectado" },
    ]);
  });
});

describe("demais réguas: prazo fixo de 12 horas depois do vencimento", () => {
  it("dentro do prazo, espera", async () => {
    const b = banco({
      kind: "followup",
      offset: 60,
      scheduledFor: AGORA - 11 * HORA,
      numero: SEM_NUMERO,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "sem_numero",
    });
  });

  it("vencido há mais de 12 horas, desiste (antes o prazo andava com o relógio e nunca chegava)", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const b = banco({
      kind: "followup",
      offset: 60,
      scheduledFor: AGORA - 12 * HORA - MIN,
      numero: NUMERO_OK,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "desconectado",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "desconectado" },
    ]);
  });
});

describe("demais réguas com janela de 08:00 às 18:00: o prazo conta da abertura", () => {
  // Fortaleza e UTC-3 o ano todo. Sexta 25/09/2026 19h local = 22h UTC.
  const SEXTA_19H = new Date("2026-09-25T22:00:00.000Z").getTime();
  const SABADO_8H = new Date("2026-09-26T11:00:00.000Z").getTime();
  const DOMINGO_8H = new Date("2026-09-27T11:00:00.000Z").getTime();
  const SABADO_10H = new Date("2026-09-26T13:00:00.000Z").getTime();
  const SEGUNDA_8H = new Date("2026-09-28T11:00:00.000Z").getTime();
  const DAS_8_AS_18 = {
    send_window_start: "08:00",
    send_window_end: "18:00",
    send_weekdays: [0, 1, 2, 3, 4, 5, 6],
  };
  const DIAS_UTEIS = { ...DAS_8_AS_18, send_weekdays: [1, 2, 3, 4, 5] };

  it("vencido às 19h, tentado às 8h do dia seguinte com o número caído: espera 5 minutos (antes morria na hora)", async () => {
    vi.setSystemTime(SABADO_8H);
    const b = banco({
      kind: "followup",
      offset: 60,
      scheduledFor: SEXTA_19H,
      numero: NUMERO_OK,
      janela: DAS_8_AS_18,
      conta: CONTA_DESCONECTADA,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(SABADO_8H + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("passadas 12 horas da abertura, desiste como 'desconectado'", async () => {
    // Sabado 20h ja e fora da janela; a volta seguinte cai no domingo 8h.
    vi.setSystemTime(DOMINGO_8H);
    const b = banco({
      kind: "followup",
      offset: 60,
      scheduledFor: SEXTA_19H,
      numero: NUMERO_OK,
      janela: DAS_8_AS_18,
      conta: CONTA_DESCONECTADA,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "desconectado",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "desconectado" },
    ]);
  });

  it("vencido no sábado com janela de segunda a sexta: na segunda às 8h ainda espera", async () => {
    vi.setSystemTime(SEGUNDA_8H);
    const b = banco({
      kind: "followup",
      offset: 60,
      scheduledFor: SABADO_10H,
      numero: NUMERO_OK,
      janela: DIAS_UTEIS,
      conta: CONTA_DESCONECTADA,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(SEGUNDA_8H + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });
});

describe("número já desconectado no banco: espera antes de pedir a conversa e de baixar o anexo", () => {
  const consultaAmanha = {
    kind: "confirmacao" as const,
    offset: -1440,
    inicioDaConsulta: AGORA + 20 * HORA,
    scheduledFor: AGORA + 20 * HORA - 1440 * MIN,
    numero: NUMERO_OK,
  };

  it("toque com anexo: não baixa, não copia, não gera base64", async () => {
    const b = banco({
      ...consultaAmanha,
      anexo: true,
      conta: CONTA_DESCONECTADA,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.storage).toEqual([]);
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(sendWhatsAppMedia).not.toHaveBeenCalled();
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("toque de texto: não pede a conversa", async () => {
    const b = banco({ ...consultaAmanha, conta: CONTA_DESCONECTADA });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
  });

  it("a defesa da remarcação vem antes: consulta remarcada pula a run em vez de esperar", async () => {
    const b = banco({
      ...consultaAmanha,
      conta: CONTA_DESCONECTADA,
      remarcadaNaDefesa: true,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "consulta_remarcada" },
    ]);
  });

  it("controle, número conectado no banco: baixa o anexo e, se o envio responder desconectado, apaga a cópia e espera", async () => {
    vi.mocked(sendWhatsAppMedia).mockResolvedValue(DESCONECTADO as never);
    const b = banco({ ...consultaAmanha, anexo: true });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(b.storage.map((c) => `${c.bucket}:${c.metodo}`)).toEqual([
      "midia-de-regua:download",
      "midia-conversas:upload",
      "midia-conversas:remove",
    ]);
  });

  it("número removido não espera a reconexão: segue para o envio e volta na hora para recarimbar", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue({
      ok: false,
      reason: "desconectado",
      code: "numero_removido",
      message: "",
    } as never);
    const b = banco({
      ...consultaAmanha,
      conta: {
        connection_status: "desconectado",
        removido_em: new Date(AGORA - HORA).toISOString(),
      },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "numero_removido",
    });
    expect(b.chamadasDe("garantir_conversa_aberta")).toHaveLength(1);
  });
});

describe("consulta ilegível (erro do PostgREST) não é consulta que sumiu", () => {
  const consultaAmanha = {
    kind: "confirmacao" as const,
    offset: -1440,
    inicioDaConsulta: AGORA + 20 * HORA,
    scheduledFor: AGORA + 20 * HORA - 1440 * MIN,
    numero: NUMERO_OK,
  };

  it("na condição de parada: exceção para retry, sem pular a run nem parar a cadeia", async () => {
    const b = banco({ ...consultaAmanha, leituraDaConsultaQueFalha: 1 });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "consulta_ilegivel: 08006",
    );
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("na releitura da defesa: idem, e nada de espera nem envio", async () => {
    const b = banco({
      ...consultaAmanha,
      conta: CONTA_DESCONECTADA,
      leituraDaConsultaQueFalha: 2,
    });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "consulta_ilegivel: 08006",
    );
    expect(b.updatesEm("cadence_run")).toEqual([]);
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(sendWhatsAppMenu).not.toHaveBeenCalled();
  });

  it("pelo executor da fila: vira tentativa com retry (falhar_job não definitivo), com a run intacta", async () => {
    const b = banco({ ...consultaAmanha, leituraDaConsultaQueFalha: 1 });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("falhou");
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "consulta_ilegivel: 08006",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(b.chamadasDe("reagendar_job")).toEqual([]);
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });

  it("confirmação 13h atrasada com a consulta longe: a espera usa a consulta da defesa, sem terceira leitura que possa falhar", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(DESCONECTADO as never);
    const b = banco({
      kind: "confirmacao",
      offset: -2880,
      inicioDaConsulta: AGORA + 35 * HORA,
      scheduledFor: AGORA - 13 * HORA,
      numero: NUMERO_OK,
      // Antes, a terceira leitura falhava, o prazo caia em scheduled_for +
      // 12h (ja passado) e a run era pulada com a consulta 35h a frente.
      leituraDaConsultaQueFalha: 3,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      reagendar: new Date(AGORA + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    expect(leiturasDaConsulta(b)).toBe(2);
    expect(b.updatesEm("cadence_run")).toEqual([]);
  });
});

describe("o que não muda", () => {
  it("número removido depois de gravar mensagem continua morrendo sem trocar de número", async () => {
    const b = banco({
      kind: "confirmacao",
      offset: -1440,
      inicioDaConsulta: AGORA + 20 * HORA,
      scheduledFor: AGORA + 20 * HORA - 1440 * MIN,
      numero: { estado: "numero_removido" },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: false,
      erro: "numero_removido",
      definitivo: true,
    });
    expect(b.updatesEm("cadence_run")).toEqual([
      { skipped_reason: "numero_removido" },
    ]);
  });
});

describe("pelo executor da fila", () => {
  it("a espera vira reagendar_job com o motivo, sem falhar_job (não queima tentativa)", async () => {
    vi.mocked(sendWhatsAppMenu).mockResolvedValue(DESCONECTADO as never);
    const b = banco({
      kind: "confirmacao",
      offset: -1440,
      inicioDaConsulta: AGORA + 20 * HORA,
      scheduledFor: AGORA + 20 * HORA - 1440 * MIN,
      numero: NUMERO_OK,
    });
    const desfecho = await executarJobComPosse(
      b.admin,
      WORKER,
      job({ esperas_do_canal: 2 }),
    );
    expect(desfecho).toBe("reagendado");
    expect(b.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: WORKER,
        p_run_at: new Date(AGORA + 15 * MIN).toISOString(),
        p_motivo: "desconectado",
      },
    ]);
    expect(b.chamadasDe("falhar_job")).toEqual([]);
  });
});
