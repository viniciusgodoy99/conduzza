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
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate, type Resposta } from "./banco-falso";

// Reguas de follow-up por etiqueta (onda 4, item 16; decisoes D1 a D4 do
// dono). A etapa pode ter varias reguas (as com etiqueta e a geral), e para
// cada lead vale UMA, escolhida no banco por regua_de_followup_do_contato (a
// mesma funcao do planejador). Antes de um toque de follow-up, o executor
// pergunta qual vale AGORA para o contato: se nao e a regua da run (a
// etiqueta mudou no meio, D3; outra regua da etapa foi ligada; esta foi
// desligada ou reordenada), ESTE toque e pulado como 'condicao_parada' e
// nada sai. A cadeia nao para: os toques da vigente sao outras runs. Leitura
// com erro vira retry do job, nunca decisao, e a funcao AUSENTE tambem
// (correcao de 22/10/2026: o codigo sobe depois das migrations e falha
// fechado sem elas). Com a vigente certa, a trava de toque repetido e
// conferida de novo na hora de enviar: o passo que nasceu vencido nao sai se
// OUTRA regua de follow-up da etapa tocou o contato nos ultimos 30 minutos
// (o toque que ainda estava saindo quando o planejador rodou).
// Consentimento, janela, numero, slot de massa e custo nao mudam.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const REGUA_DA_RUN = "77777777-7777-4777-8777-777777777777";
const OUTRA_REGUA = "88888888-8888-4888-8888-888888888888";
const TOQUE_RECENTE = "99999999-9999-4999-8999-999999999999";
const WORKER = "worker-de-teste";

const MIN = 60_000;
// 12h em Fortaleza (UTC-3): dentro da janela de envio aberta o dia todo.
const AGORA = new Date("2026-10-24T15:00:00.000Z").getTime();
const ENVIADA = { ok: true, messageId: "mensagem-1" };

type Cenario = {
  /** O que regua_de_followup_do_contato responde. */
  vigente: Resposta;
  /** Etapa do contato (padrao: a da regua). */
  etapaDoContato?: string;
  /** O contato respondeu depois de entrar na etapa. */
  respondeu?: boolean;
  /** consentimento_vigente (padrao: true). */
  consentimento?: boolean;
  /**
   * Quando a run foi criada, em minutos depois do scheduled_for (negativo:
   * nasceu antes de vencer; zero ou mais: nasceu vencida). Padrao: nasceu
   * 30 minutos antes de vencer (o planejador adianta ate 60).
   */
  criadaMinutosDepois?: number;
  /** A leitura dos toques recentes do contato (a trava na hora de enviar). */
  toquesRecentes?: Resposta;
};

/** Um toque enviado ha pouco, da regua dada (com o tipo e a etapa dela). */
function toque(cadence: {
  id: string;
  kind?: string;
  trigger_stage?: string | null;
}) {
  return {
    id: TOQUE_RECENTE,
    cadence_step: {
      cadence: {
        id: cadence.id,
        kind: cadence.kind ?? "followup",
        trigger_stage:
          cadence.trigger_stage === undefined
            ? "em_contato"
            : cadence.trigger_stage,
      },
    },
  };
}

/** A consulta dos toques recentes (a trava), e nao a leitura da run. */
function eTrava(chamada: { metodos: { metodo: string }[] }): boolean {
  return chamada.metodos.some((m) => m.metodo === "gt");
}

function banco(cenario: Cenario) {
  const iso = (epoch: number) => new Date(epoch).toISOString();
  const offset = 60;
  const scheduledFor = AGORA - MIN;
  const entrada = scheduledFor - offset * MIN;
  const run = {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: null,
    scheduled_for: iso(scheduledFor),
    created_at: iso(scheduledFor + (cenario.criadaMinutosDepois ?? -30) * MIN),
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
        kind: "followup",
        active: true,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_weekdays: [0, 1, 2, 3, 4, 5, 6],
        trigger_stage: "em_contato",
      },
    },
    contact: {
      name: "Paciente",
      funnel_stage: cenario.etapaDoContato ?? "em_contato",
      funnel_stage_changed_at: iso(entrada),
      last_contact_at: cenario.respondeu ? iso(entrada + 5 * MIN) : null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
  return bancoFalso({
    tabelas: {
      cadence_run: (chamada) =>
        eUpdate(chamada)
          ? { data: null, error: null }
          : eTrava(chamada)
            ? (cenario.toquesRecentes ?? { data: [], error: null })
            : { data: run, error: null },
      cadence_step: () => ({ data: [{ id: "passo" }], error: null }),
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
      consentimento_vigente: () => ({
        data: cenario.consentimento ?? true,
        error: null,
      }),
      regua_de_followup_do_contato: () => cenario.vigente,
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

/** Os updates em cadence_run, com o filtro de cada um (a run ou a cadeia). */
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
  vi.mocked(sendWhatsAppText).mockReset();
  vi.mocked(sendWhatsAppText).mockResolvedValue(ENVIADA as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("follow-up: a run ainda é da régua que vale para o contato?", () => {
  it("é (a geral única, ou a da etiqueta dele): o toque sai, e a pergunta vai com o contato", async () => {
    const b = banco({ vigente: { data: REGUA_DA_RUN, error: null } });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_de_followup_do_contato")).toEqual([
      { p_contact_id: CONTATO },
    ]);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    // Envio de massa de sempre: slot de massa, sem caminho novo.
    expect(vi.mocked(sendWhatsAppText).mock.calls[0]?.[1]).toMatchObject({
      envioAutomatico: true,
      jobId: JOB,
      contactId: CONTATO,
    });
    expect(updatesNaRun(b).map((u) => u.valores)).toEqual([
      expect.objectContaining({ message_id: "mensagem-1" }),
    ]);
  });

  it("outra régua vale agora (a etiqueta mudou no meio): pula SÓ esta run, sem enviar", async () => {
    const b = banco({ vigente: { data: OUTRA_REGUA, error: null } });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    // Nem pede numero nem conversa.
    expect(b.chamadasDe("numero_do_job")).toEqual([]);
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    // O update e da run (filtro por id), nao da cadeia: os toques da
    // regua vigente sao outras runs e continuam de pe.
    expect(updatesNaRun(b)).toEqual([
      { valores: { skipped_reason: "condicao_parada" }, filtros: ["id"] },
    ]);
  });

  it("nenhuma régua vale (tirou a etiqueta e a etapa não tem geral): pula do mesmo jeito", async () => {
    const b = banco({ vigente: { data: null, error: null } });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(updatesNaRun(b)).toEqual([
      { valores: { skipped_reason: "condicao_parada" }, filtros: ["id"] },
    ]);
  });

  it("leitura com erro: exceção para retry, sem pular a run e sem enviar", async () => {
    const b = banco({
      vigente: {
        data: null,
        error: { code: "57014", message: "statement timeout" },
      },
    });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "regua_vigente_ilegivel: 57014",
    );
    expect(updatesNaRun(b)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("pelo executor da fila, o erro vira falhar_job NÃO definitivo com o código seguro", async () => {
    const b = banco({
      vigente: { data: null, error: { code: "", message: "fetch failed" } },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("falhou");
    expect(b.chamadasDe("falhar_job")).toEqual([
      {
        p_id: JOB,
        p_erro: "regua_vigente_ilegivel: sem_resposta",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    expect(updatesNaRun(b)).toEqual([]);
  });

  it.each(["PGRST202", "42883"])(
    "função ausente (%s): falha fechada, exceção para retry, sem pular e sem enviar (correção de 22/10/2026)",
    async (codigo) => {
      const b = banco({
        vigente: { data: null, error: { code: codigo, message: "nao achou" } },
      });
      await expect(
        executarPassoDeRegua(b.admin, job(), WORKER),
      ).rejects.toThrow(`regua_vigente_ilegivel: ${codigo}`);
      expect(updatesNaRun(b)).toEqual([]);
      expect(sendWhatsAppText).not.toHaveBeenCalled();
      // Nada de conferir o esquema para decidir seguir: so a run foi lida.
      expect(b.tabelas.map((c) => c.tabela)).toEqual(["cadence_run"]);
    },
  );
});

describe("follow-up: a trava de toque repetido de novo, na hora de enviar", () => {
  it("o passo nasceu vencido e OUTRA régua da etapa tocou há pouco: pula só esta run, sem enviar", async () => {
    const b = banco({
      vigente: { data: REGUA_DA_RUN, error: null },
      criadaMinutosDepois: 0,
      toquesRecentes: { data: [toque({ id: OUTRA_REGUA })], error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(b.chamadasDe("numero_do_job")).toEqual([]);
    expect(updatesNaRun(b)).toEqual([
      { valores: { skipped_reason: "condicao_parada" }, filtros: ["id"] },
    ]);
    // A consulta: os toques ENVIADOS do contato nos ultimos 30 minutos,
    // desta entrada na etapa, fora a propria run.
    const trava = b.tabelas.find(
      (c) => c.tabela === "cadence_run" && eTrava(c),
    );
    expect(trava?.metodos.map((m) => [m.metodo, ...m.args])).toEqual([
      [
        "select",
        "id, cadence_step:cadence_step_id ( cadence:cadence_id ( id, kind, trigger_stage ) )",
      ],
      ["eq", "clinic_id", CLINICA],
      ["eq", "contact_id", CONTATO],
      ["neq", "id", RUN],
      ["gt", "sent_at", new Date(AGORA - 30 * MIN).toISOString()],
      ["gte", "scheduled_for", new Date(AGORA - 61 * MIN).toISOString()],
      ["limit", 50],
    ]);
  });

  it.each([
    ["da mesma régua (a sequência dela)", toque({ id: REGUA_DA_RUN })],
    [
      "de outra régua de outra etapa",
      toque({ id: OUTRA_REGUA, trigger_stage: "novo" }),
    ],
    [
      "de uma régua que não é de follow-up",
      toque({ id: OUTRA_REGUA, kind: "confirmacao", trigger_stage: null }),
    ],
  ])(
    "o toque recente é %s: a trava não vale e o toque sai",
    async (_rotulo, recente) => {
      const b = banco({
        vigente: { data: REGUA_DA_RUN, error: null },
        criadaMinutosDepois: 5,
        toquesRecentes: { data: [recente], error: null },
      });
      expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
        ok: true,
      });
      expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    },
  );

  it("o passo nasceu antes de vencer (o próximo da régua nova): sai, sem consultar a trava", async () => {
    const b = banco({
      vigente: { data: REGUA_DA_RUN, error: null },
      criadaMinutosDepois: -10,
      toquesRecentes: { data: [toque({ id: OUTRA_REGUA })], error: null },
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(
      b.tabelas.filter((c) => c.tabela === "cadence_run" && eTrava(c)),
    ).toEqual([]);
  });

  it("a leitura dos toques recentes falha: exceção para retry, sem pular e sem enviar", async () => {
    const b = banco({
      vigente: { data: REGUA_DA_RUN, error: null },
      criadaMinutosDepois: 0,
      toquesRecentes: {
        data: null,
        error: { code: "57014", message: "statement timeout" },
      },
    });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "toque_recente_ilegivel: 57014",
    );
    expect(updatesNaRun(b)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("toque manual: quem pediu foi uma pessoa, não passa pela trava", async () => {
    const b = banco({
      vigente: { data: OUTRA_REGUA, error: null },
      criadaMinutosDepois: 0,
      toquesRecentes: { data: [toque({ id: OUTRA_REGUA })], error: null },
    });
    expect(
      await executarPassoDeRegua(b.admin, job({ manual: true }), WORKER),
    ).toEqual({ ok: true });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(
      b.tabelas.filter((c) => c.tabela === "cadence_run" && eTrava(c)),
    ).toEqual([]);
  });
});

describe("as paradas de sempre vêm antes da régua vigente", () => {
  it("saiu da etapa: a cadeia da régua para, sem perguntar pela vigente", async () => {
    const b = banco({
      vigente: { data: OUTRA_REGUA, error: null },
      etapaDoContato: "agendou",
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_de_followup_do_contato")).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    // pararCadeiaDeFollowup: contato e passos da regua, nao so a run.
    expect(updatesNaRun(b)).toEqual([
      {
        valores: { skipped_reason: "condicao_parada" },
        filtros: ["clinic_id", "contact_id"],
      },
    ]);
  });

  it("respondeu depois de entrar: a cadeia para, sem perguntar pela vigente", async () => {
    const b = banco({
      vigente: { data: REGUA_DA_RUN, error: null },
      respondeu: true,
    });
    await executarPassoDeRegua(b.admin, job(), WORKER);
    expect(b.chamadasDe("regua_de_followup_do_contato")).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("sem autorização: pula e conta antes de tudo, sem perguntar pela vigente", async () => {
    const b = banco({
      vigente: { data: REGUA_DA_RUN, error: null },
      consentimento: false,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("regua_de_followup_do_contato")).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(updatesNaRun(b).map((u) => u.valores)).toEqual([
      { skipped_reason: "sem_consentimento" },
    ]);
  });

  it("toque manual: quem pediu foi uma pessoa, não passa pela conferência", async () => {
    const b = banco({ vigente: { data: OUTRA_REGUA, error: null } });
    expect(
      await executarPassoDeRegua(b.admin, job({ manual: true }), WORKER),
    ).toEqual({ ok: true });
    expect(b.chamadasDe("regua_de_followup_do_contato")).toEqual([]);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
});
