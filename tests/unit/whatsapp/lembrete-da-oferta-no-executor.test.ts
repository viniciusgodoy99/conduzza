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

import { CHAVE_DO_LEMBRETE } from "@/lib/domain/lembrete-da-oferta";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, type Resposta } from "../jobs/banco-falso";

// AG5, revisao (achado 2): o LEMBRETE da oferta (T-E4) e um eco do
// interceptador com payload.lembrete_da_oferta e SEM offer_id, entao a guarda
// da mensagem da oferta (payload.offer_id) nao o via, e ele saia depois de a
// oferta fechar: reoferta cancelada, a onda que outro candidato ganhou, ou o
// numero caido por horas ("responda SIM ate as 10:30" lido as 13:00; sem
// consulta no payload, o job espera o canal ate 12 h). Agora o executor le a
// oferta do payload a cada tentativa e so manda com ela de pe para o contato
// (oferecida a ele, aberta, no prazo e sem a recusa dele); senao morre
// definitivo como 'oferta_encerrada', antes de qualquer efeito colateral
// (nem a autorizacao, nem o numero, nem a conversa).

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const OUTRO_CONTATO = "55555555-5555-4555-8555-555555555556";
const OFERTA = "99999999-9999-4999-8999-999999999999";
const JOB = "66666666-6666-4666-8666-666666666666";
const WORKER = "worker-de-teste";

const MIN = 60_000;
const AGORA = new Date("2026-10-28T13:00:00.000Z").getTime();
const iso = (epoch: number) => new Date(epoch).toISOString();

const OFERTA_DE_PE = {
  status: "aberta",
  expires_at: iso(AGORA + 30 * MIN),
  declined_by: [] as string[],
  offered_to: [CONTATO, OUTRO_CONTATO],
};

const ENVIOU = { ok: true, messageId: "m-1" };
const DESCONECTADO = {
  ok: false,
  reason: "desconectado",
  code: "desconectado",
  message: "",
};

function banco(oferta: Resposta) {
  return bancoFalso({
    tabelas: { waitlist_offer: () => oferta },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      consentimento_vigente: () => ({ data: true, error: null }),
      numero_do_job: () => ({
        data: { estado: "ok", whatsapp_account_id: NUMERO },
        error: null,
      }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      reagendar_job: () => ({ data: true, error: null }),
      concluir_job: () => ({ data: null, error: null }),
      falhar_job: () => ({ data: null, error: null }),
    },
  });
}

/** O job do lembrete como o interceptador o enfileira. */
function lembrete(payload: Record<string, unknown> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    payload: {
      contact_id: CONTATO,
      body: "Lembrete da oferta (teste)",
      resposta_ao_paciente: true,
      [CHAVE_DO_LEMBRETE]: OFERTA,
      ...payload,
    },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
    created_at: iso(AGORA - 2 * MIN),
  };
}

/** As leituras de waitlist_offer, com os filtros encadeados. */
function leiturasDaOferta(b: ReturnType<typeof banco>) {
  return b.tabelas
    .filter((c) => c.tabela === "waitlist_offer")
    .map((c) => c.metodos.map((m) => [m.metodo, ...m.args]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppText).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a guarda do lembrete da oferta no executor", () => {
  it("a oferta de pé para o contato: o lembrete sai, e a leitura é a da oferta do payload, nesta clínica", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(ENVIOU as never);
    const b = banco({ data: OFERTA_DE_PE, error: null });
    expect(await executarJobComPosse(b.admin, WORKER, lembrete())).toBe(
      "concluido",
    );
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(leiturasDaOferta(b)).toEqual([
      [
        ["select", "status, expires_at, declined_by, offered_to"],
        ["eq", "clinic_id", CLINICA],
        ["eq", "id", OFERTA],
      ],
    ]);
    expect(b.chamadasDe("falhar_job")).toEqual([]);
  });

  it.each([
    [
      "outro candidato aceitou durante a onda",
      { ...OFERTA_DE_PE, status: "preenchida" },
    ],
    ["a reoferta foi cancelada", { ...OFERTA_DE_PE, status: "cancelada" }],
    [
      "o número ficou caído e a oferta venceu",
      { ...OFERTA_DE_PE, expires_at: iso(AGORA - MIN) },
    ],
    [
      "venceu agora (o prazo é exclusivo)",
      { ...OFERTA_DE_PE, expires_at: iso(AGORA) },
    ],
    ["ela respondeu NÃO QUERO", { ...OFERTA_DE_PE, declined_by: [CONTATO] }],
    [
      "a oferta não foi para este contato",
      { ...OFERTA_DE_PE, offered_to: [OUTRO_CONTATO] },
    ],
    ["a oferta sumiu", null],
  ])(
    "%s: morre definitivo como 'oferta_encerrada', sem autorização, número, conversa nem envio",
    async (_nome, oferta) => {
      const b = banco({ data: oferta, error: null });
      expect(await executarJobComPosse(b.admin, WORKER, lembrete())).toBe(
        "falhou",
      );
      expect(b.chamadasDe("falhar_job")).toEqual([
        {
          p_id: JOB,
          p_erro: "oferta_encerrada",
          p_definitivo: true,
          p_worker: WORKER,
        },
      ]);
      expect(b.chamadasDe("consentimento_vigente")).toEqual([]);
      expect(b.chamadasDe("numero_do_job")).toEqual([]);
      expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
      expect(sendWhatsAppText).not.toHaveBeenCalled();
    },
  );

  it("a leitura da oferta falhou: nova tentativa (não definitiva), nada sai", async () => {
    const b = banco({ data: null, error: { code: "57014" } });
    expect(await executarJobComPosse(b.admin, WORKER, lembrete())).toBe(
      "falhou",
    );
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "leitura_falhou",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("a chave do lembrete que não é texto: payload_invalido, definitivo", async () => {
    const b = banco({ data: OFERTA_DE_PE, error: null });
    await executarJobComPosse(
      b.admin,
      WORKER,
      lembrete({ [CHAVE_DO_LEMBRETE]: 42 }),
    );
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "payload_invalido",
        p_definitivo: true,
        p_worker: WORKER,
      },
    ]);
    expect(leiturasDaOferta(b)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("esperando o canal: com a oferta de pé, reagenda; na volta depois do prazo da oferta, morre sem enviar", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(DESCONECTADO as never);
    const antes = banco({ data: OFERTA_DE_PE, error: null });
    expect(await executarJobComPosse(antes.admin, WORKER, lembrete())).toBe(
      "reagendado",
    );
    expect(antes.chamadasDe("reagendar_job")[0]?.p_motivo).toBe(
      "desconectado",
    );

    // O numero voltou horas depois: a oferta ja venceu.
    vi.setSystemTime(AGORA + 3 * 60 * MIN);
    vi.mocked(sendWhatsAppText).mockClear();
    const depois = banco({ data: OFERTA_DE_PE, error: null });
    expect(await executarJobComPosse(depois.admin, WORKER, lembrete())).toBe(
      "falhou",
    );
    expect(depois.chamadasDe("falhar_job")[0]).toMatchObject({
      p_erro: "oferta_encerrada",
      p_definitivo: true,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("o eco comum (sem a chave do lembrete) não lê oferta nenhuma", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue(ENVIOU as never);
    const b = banco({ data: null, error: { code: "57014" } });
    const eco = lembrete();
    delete eco.payload[CHAVE_DO_LEMBRETE];
    expect(await executarJobComPosse(b.admin, WORKER, eco)).toBe("concluido");
    expect(leiturasDaOferta(b)).toEqual([]);
  });
});
