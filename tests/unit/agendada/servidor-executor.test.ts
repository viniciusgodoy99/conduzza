import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registros = vi.hoisted(() => ({ linhas: [] as unknown[][] }));

vi.mock("@/lib/log", () => {
  const gravar =
    (nivel: string) =>
    (...args: unknown[]) => {
      registros.linhas.push([nivel, ...args]);
    };
  return {
    log: { info: gravar("info"), warn: gravar("warn"), error: gravar("error") },
  };
});
vi.mock("@/lib/integrations/whatsapp/send", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/integrations/whatsapp/send")
  >()),
  sendWhatsAppText: vi.fn(),
}));

import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, type Resposta } from "../jobs/banco-falso";

// Executor da mensagem agendada (lib/jobs/mensagem-agendada.ts), rodando
// pelo worker de verdade (executarJobComPosse): a ordem da secao 2.2 do
// desenho revisado, a madrugada (A2), o assinante (A1) e o fechamento da
// agendada pela reconciliacao depois de concluir ou falhar. O banco e um
// duble: as RPCs e as leituras respondem o que cada cenario pede. O caminho
// real (planejadora, reconciliacao, RLS) fica nos testes de integracao.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const OUTRO_NUMERO = "77777777-7777-4777-8777-777777777777";
const AGENDADA = "33333333-3333-4333-8333-333333333333";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const OUTRO_CONTATO = "56565656-5656-4565-8565-565656565656";
const JOB = "66666666-6666-4666-8666-666666666666";
const OUTRO_JOB = "67676767-6767-4676-8676-676767676767";
const ANA = "a1a1a1a1-0000-4000-8000-000000000001";
const BRUNO = "b2b2b2b2-0000-4000-8000-000000000002";
const CONVERSA = "c3c3c3c3-0000-4000-8000-000000000003";
const WORKER = "worker-de-teste";

const TEXTO = "Olá Maria, sua consulta de retorno com a Dra. Paula é amanhã.";

const MIN = 60_000;
const HORA = 60 * MIN;
// 15:00 em Fortaleza (UTC-3): fora da faixa de silencio.
const AGORA = new Date("2026-10-07T18:00:00.000Z").getTime();
const iso = (epoch: number) => new Date(epoch).toISOString();

type Cenario = {
  mensagem?: Resposta;
  agendada?: Resposta;
  numero?: Resposta;
  consentimento?: Resposta;
  conversa?: Resposta;
  reconciliar?: () => Resposta;
};

function agendada(campos: Record<string, unknown> = {}) {
  return {
    situacao: "enviando",
    job_id: JOB,
    texto: TEXTO,
    enviar_em: iso(AGORA - 2 * MIN),
    criada_por: ANA,
    editada_por: null,
    whatsapp_account_id: NUMERO,
    contact_id: CONTATO,
    clinic: { timezone: "America/Fortaleza" },
    ...campos,
  };
}

function banco(cenario: Cenario = {}) {
  return bancoFalso({
    tabelas: {
      message: () => cenario.mensagem ?? { data: null, error: null },
      mensagem_agendada: () =>
        cenario.agendada ?? { data: agendada(), error: null },
      whatsapp_account: () =>
        cenario.numero ?? {
          data: { connection_status: "conectado", removido_em: null },
          error: null,
        },
    },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      consentimento_vigente: () =>
        cenario.consentimento ?? { data: true, error: null },
      garantir_conversa_aberta: () =>
        cenario.conversa ?? { data: CONVERSA, error: null },
      reagendar_job: () => ({ data: true, error: null }),
      concluir_job: () => ({ data: null, error: null }),
      falhar_job: () => ({ data: null, error: null }),
      reconciliar_mensagem_agendada: () =>
        cenario.reconciliar?.() ?? { data: "enviada", error: null },
    },
  });
}

function job(campos: Partial<Job> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_agendada",
    payload: { contact_id: CONTATO, mensagem_agendada_id: AGENDADA },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
    created_at: iso(AGORA - MIN),
    ...campos,
  };
}

const ENVIADO = { ok: true, messageId: "mensagem-1" };

function falhou(b: ReturnType<typeof banco>) {
  return b.chamadasDe("falhar_job");
}

function nadaSaiu(b: ReturnType<typeof banco>) {
  expect(sendWhatsAppText).not.toHaveBeenCalled();
  expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppText).mockReset();
  vi.mocked(sendWhatsAppText).mockResolvedValue(ENVIADO as never);
  registros.linhas = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("caminho feliz", () => {
  it("envia em nome de quem agendou, pelo número da agendada, no trilho automático, sem derrubar o Aguardando", async () => {
    const b = banco();
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(b.chamadasDe("garantir_conversa_aberta")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_contact_id: CONTATO,
        p_whatsapp_account_id: NUMERO,
      },
    ]);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const [, envio] = vi.mocked(sendWhatsAppText).mock.calls[0]!;
    expect(envio).toMatchObject({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      body: TEXTO,
      authorUserId: ANA,
      author: "usuario",
      envioAutomatico: true,
      esperaMaximaMs: 3_000,
      jobId: JOB,
      whatsappAccountId: NUMERO,
      manterAguardando: true,
      trilhaDoSistema: true,
    });
    // Espacamento de massa (anti-ban do disparo automatico): 10 a 30 s.
    expect(envio.espacamentoMs).toBeGreaterThanOrEqual(10_000);
    expect(envio.espacamentoMs).toBeLessThanOrEqual(30_000);
    expect(b.chamadasDe("concluir_job")).toHaveLength(1);
    // Fecha a agendada logo depois de concluir.
    expect(b.chamadasDe("reconciliar_mensagem_agendada")).toEqual([
      { p_agendada_id: AGENDADA },
    ]);
  });

  it("A1: quem editou por último assina", async () => {
    const b = banco({
      agendada: { data: agendada({ editada_por: BRUNO }), error: null },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(vi.mocked(sendWhatsAppText).mock.calls[0]![1].authorUserId).toBe(
      BRUNO,
    );
  });

  it("lê a agendada e o número presos à clínica do job, com o fuso da clínica embutido", async () => {
    const b = banco();
    await executarJobComPosse(b.admin, WORKER, job());
    const leitura = b.tabelas.find((t) => t.tabela === "mensagem_agendada")!;
    expect(leitura.metodos).toContainEqual({
      metodo: "eq",
      args: ["clinic_id", CLINICA],
    });
    expect(leitura.metodos).toContainEqual({
      metodo: "eq",
      args: ["id", AGENDADA],
    });
    expect(String(leitura.metodos[0]!.args[0])).toContain(
      "clinic:clinic_id (timezone)",
    );
    const numero = b.tabelas.find((t) => t.tabela === "whatsapp_account")!;
    expect(numero.metodos).toContainEqual({
      metodo: "eq",
      args: ["clinic_id", CLINICA],
    });
    expect(numero.metodos).toContainEqual({
      metodo: "eq",
      args: ["id", NUMERO],
    });
  });
});

describe("payload", () => {
  it.each([
    ["sem a agendada", { contact_id: CONTATO }, false],
    ["sem o contato", { mensagem_agendada_id: AGENDADA }, true],
    [
      "contato que não é uuid",
      { contact_id: "contato", mensagem_agendada_id: AGENDADA },
      true,
    ],
    [
      "agendada que não é texto",
      { contact_id: CONTATO, mensagem_agendada_id: 42 },
      false,
    ],
  ])(
    "%s: definitivo 'payload_invalido', sem ler nada",
    async (_nome, payload, reconcilia) => {
      const b = banco();
      await executarJobComPosse(b.admin, WORKER, job({ payload }));
      expect(falhou(b)).toEqual([
        {
          p_id: JOB,
          p_erro: "payload_invalido",
          p_definitivo: true,
          p_worker: WORKER,
        },
      ]);
      expect(b.tabelas).toEqual([]);
      nadaSaiu(b);
      // Sem id de agendada valido, nao ha o que reconciliar.
      expect(b.chamadasDe("reconciliar_mensagem_agendada")).toEqual(
        reconcilia ? [{ p_agendada_id: AGENDADA }] : [],
      );
    },
  );

  it("um texto no payload é ignorado: o texto sai sempre da agendada", async () => {
    const b = banco();
    await executarJobComPosse(
      b.admin,
      WORKER,
      job({
        payload: {
          contact_id: CONTATO,
          mensagem_agendada_id: AGENDADA,
          body: "outro texto",
        },
      }),
    );
    expect(vi.mocked(sendWhatsAppText).mock.calls[0]![1].body).toBe(TEXTO);
  });
});

describe("idempotência pela mensagem do job, antes de tudo", () => {
  it("mensagem já enviada: conclui sem reenviar e sem ler a agendada", async () => {
    for (const status of ["enviada", "entregue", "lida"]) {
      vi.mocked(sendWhatsAppText).mockClear();
      const b = banco({
        mensagem: {
          data: { delivery_status: status, error_code: null },
          error: null,
        },
      });
      expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
        "concluido",
      );
      nadaSaiu(b);
      expect(b.tabelas.map((t) => t.tabela)).toEqual(["message"]);
      expect(b.chamadasDe("reconciliar_mensagem_agendada")).toHaveLength(1);
    }
  });

  it("a leitura da mensagem é presa à clínica e ao job", async () => {
    const b = banco();
    await executarJobComPosse(b.admin, WORKER, job());
    const leitura = b.tabelas.find((t) => t.tabela === "message")!;
    expect(leitura.metodos).toContainEqual({
      metodo: "eq",
      args: ["clinic_id", CLINICA],
    });
    expect(leitura.metodos).toContainEqual({
      metodo: "eq",
      args: ["job_id", JOB],
    });
  });

  it("mensagem 'enviando' (pode ter chegado): definitivo 'envio_incerto', nada sai", async () => {
    const b = banco({
      mensagem: {
        data: { delivery_status: "enviando", error_code: null },
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("falhou");
    expect(falhou(b)).toEqual([
      {
        p_id: JOB,
        p_erro: "envio_incerto",
        p_definitivo: true,
        p_worker: WORKER,
      },
    ]);
    nadaSaiu(b);
    expect(b.chamadasDe("reconciliar_mensagem_agendada")).toEqual([
      { p_agendada_id: AGENDADA },
    ]);
  });

  it("falha que pode ter chegado ('envio_incerto' ou erro do provedor): definitivo com o código", async () => {
    for (const codigo of ["envio_incerto", "uazapi_500"]) {
      const b = banco({
        mensagem: {
          data: { delivery_status: "falhou", error_code: codigo },
          error: null,
        },
      });
      await executarJobComPosse(b.admin, WORKER, job());
      expect(falhou(b)[0]).toMatchObject({
        p_erro: codigo,
        p_definitivo: true,
      });
      nadaSaiu(b);
    }
  });

  it("falha que com certeza não saiu: segue e envia de novo (send.ts reusa a linha)", async () => {
    const b = banco({
      mensagem: {
        data: {
          delivery_status: "falhou",
          error_code: "provider_indisponivel",
        },
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("leitura da mensagem falhou: retry, sem enviar", async () => {
    const b = banco({
      mensagem: { data: null, error: { code: "57014", message: "timeout" } },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)).toEqual([
      {
        p_id: JOB,
        p_erro: "leitura_falhou",
        p_definitivo: false,
        p_worker: WORKER,
      },
    ]);
    nadaSaiu(b);
  });
});

describe("a agendada ainda é deste job", () => {
  it.each([
    ["cancelada no meio do caminho", { situacao: "cancelada", texto: null }],
    ["fechada como não enviada", { situacao: "nao_enviada" }],
    ["já enviada", { situacao: "enviada", texto: null }],
    ["de outro job", { job_id: OUTRO_JOB }],
    ["de outro contato", { contact_id: OUTRO_CONTATO }],
    ["sem texto", { texto: "   " }],
  ])("%s: definitivo 'agendada_encerrada', nada sai", async (_nome, campos) => {
    const b = banco({ agendada: { data: agendada(campos), error: null } });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("falhou");
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "agendada_encerrada",
      p_definitivo: true,
    });
    nadaSaiu(b);
    expect(b.chamadasDe("consentimento_vigente")).toEqual([]);
  });

  it("agendada sumida (apagada com o contato): definitivo 'agendada_encerrada'", async () => {
    const b = banco({ agendada: { data: null, error: null } });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "agendada_encerrada",
      p_definitivo: true,
    });
    nadaSaiu(b);
  });

  it("leitura da agendada falhou: retry", async () => {
    const b = banco({
      agendada: { data: null, error: { code: "", message: "rede" } },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "leitura_falhou",
      p_definitivo: false,
    });
    nadaSaiu(b);
  });
});

describe("prazo de 12 horas depois da hora marcada", () => {
  it("passado o prazo e a folga de 5 minutos: definitivo 'atrasou', antes de olhar o número", async () => {
    const b = banco({
      agendada: {
        data: agendada({ enviar_em: iso(AGORA - 12 * HORA - 6 * MIN) }),
        error: null,
      },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "atrasou",
      p_definitivo: true,
    });
    expect(b.tabelas.some((t) => t.tabela === "whatsapp_account")).toBe(false);
    nadaSaiu(b);
  });
});

describe("número fixo, conferido antes de abrir conversa", () => {
  it("job carimbado com outro número (ou sem número): definitivo 'conta_divergente'", async () => {
    for (const carimbo of [OUTRO_NUMERO, null, undefined]) {
      const b = banco();
      await executarJobComPosse(
        b.admin,
        WORKER,
        job({ whatsapp_account_id: carimbo }),
      );
      expect(falhou(b)[0]).toMatchObject({
        p_erro: "conta_divergente",
        p_definitivo: true,
      });
      expect(b.tabelas.some((t) => t.tabela === "whatsapp_account")).toBe(
        false,
      );
      nadaSaiu(b);
    }
  });

  it("número removido ou que não existe mais: definitivo 'numero_removido', nunca troca de número", async () => {
    for (const numero of [
      {
        data: {
          connection_status: "conectado",
          removido_em: iso(AGORA - HORA),
        },
        error: null,
      },
      { data: null, error: null },
    ]) {
      const b = banco({ numero });
      await executarJobComPosse(b.admin, WORKER, job());
      expect(falhou(b)[0]).toMatchObject({
        p_erro: "numero_removido",
        p_definitivo: true,
      });
      expect(b.chamadasDe("reagendar_job")).toEqual([]);
      nadaSaiu(b);
    }
  });

  it("número desconectado: espera a reconexão sem criar conversa nem conferir mais nada", async () => {
    const b = banco({
      numero: {
        data: { connection_status: "desconectado", removido_em: null },
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(b.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: WORKER,
        p_run_at: iso(AGORA + 5 * MIN),
        p_motivo: "desconectado",
      },
    ]);
    expect(falhou(b)).toEqual([]);
    expect(b.chamadasDe("consentimento_vigente")).toEqual([]);
    nadaSaiu(b);
    // Reagendado nao fecha a agendada: ela continua na fila.
    expect(b.chamadasDe("reconciliar_mensagem_agendada")).toEqual([]);
  });

  it("a espera do número cresce pelas esperas já feitas e para 1 minuto antes do prazo da agendada", async () => {
    const b = banco({
      numero: {
        data: { connection_status: "conectando", removido_em: null },
        error: null,
      },
      agendada: {
        data: agendada({ enviar_em: iso(AGORA - 12 * HORA + 10 * MIN) }),
        error: null,
      },
    });
    await executarJobComPosse(
      b.admin,
      WORKER,
      job({
        payload: {
          contact_id: CONTATO,
          mensagem_agendada_id: AGENDADA,
          esperas_do_canal: 3,
        },
      }),
    );
    // 4a volta pediria 20 min; o prazo (10 min) corta para 9 min.
    expect(b.chamadasDe("reagendar_job")[0]).toMatchObject({
      p_run_at: iso(AGORA + 9 * MIN),
      p_motivo: "desconectado",
    });
  });

  it("com a madrugada cortando o prazo, a espera do número para antes das 21:00 (F4)", async () => {
    // 20:50 em Fortaleza; marcada para 14:58 (prazo 02:58), mas das 21:00
    // em diante a atrasada nao sai: a 4a volta pediria 20 min, e o limite
    // corta para as 20:59.
    vi.setSystemTime(new Date("2026-10-07T23:50:00.000Z").getTime());
    const b = banco({
      numero: {
        data: { connection_status: "desconectado", removido_em: null },
        error: null,
      },
      agendada: {
        data: agendada({ enviar_em: "2026-10-07T17:58:00.000Z" }),
        error: null,
      },
    });
    await executarJobComPosse(
      b.admin,
      WORKER,
      job({
        payload: {
          contact_id: CONTATO,
          mensagem_agendada_id: AGENDADA,
          esperas_do_canal: 3,
        },
      }),
    );
    expect(b.chamadasDe("reagendar_job")[0]).toMatchObject({
      p_run_at: "2026-10-07T23:59:00.000Z",
      p_motivo: "desconectado",
    });
  });

  it("número ainda caído no limite da madrugada: definitivo 'madrugada' (F4)", async () => {
    // 20:59:30 em Fortaleza, marcada para 14:58: nao sobra volta util antes
    // das 21:00, e depois delas ela cairia de madrugada.
    vi.setSystemTime(new Date("2026-10-07T23:59:30.000Z").getTime());
    const b = banco({
      numero: {
        data: { connection_status: "desconectado", removido_em: null },
        error: null,
      },
      agendada: {
        data: agendada({ enviar_em: "2026-10-07T17:58:00.000Z" }),
        error: null,
      },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "madrugada",
      p_definitivo: true,
    });
    nadaSaiu(b);
  });

  it("sem tempo útil antes do prazo: definitivo 'desconectado'", async () => {
    const b = banco({
      numero: {
        data: { connection_status: "desconectado", removido_em: null },
        error: null,
      },
      agendada: {
        data: agendada({ enviar_em: iso(AGORA - 12 * HORA + 30_000) }),
        error: null,
      },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "desconectado",
      p_definitivo: true,
    });
    nadaSaiu(b);
  });
});

describe("autorização para receber mensagens", () => {
  it("sem autorização: trilha sem pessoa, definitivo 'sem_consentimento', nenhuma conversa nasce", async () => {
    const b = banco({ consentimento: { data: false, error: null } });
    await executarJobComPosse(b.admin, WORKER, job());
    const trilha = b.tabelas.filter((t) => t.tabela === "audit_log");
    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.metodos[0]).toEqual({
      metodo: "insert",
      args: [
        {
          clinic_id: CLINICA,
          user_id: null,
          action: "envio_bloqueado_sem_autorizacao",
          entity: "contact",
          entity_id: CONTATO,
        },
      ],
    });
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "sem_consentimento",
      p_definitivo: true,
    });
    nadaSaiu(b);
  });

  it("autorização ilegível: retry com o código, sem registrar bloqueio", async () => {
    const b = banco({
      consentimento: { data: null, error: { code: "57014", message: "x" } },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "consentimento_ilegivel: 57014",
      p_definitivo: false,
    });
    expect(b.tabelas.some((t) => t.tabela === "audit_log")).toBe(false);
    nadaSaiu(b);
  });
});

describe("madrugada (A2): a atrasada não chega entre 21:00 e 08:00", () => {
  it("atrasada na faixa: reagenda para as 08:00 da clínica, sem abrir conversa", async () => {
    // 02:00 em Fortaleza; marcada para 00:30 (1h30 de atraso).
    const agora = new Date("2026-10-07T05:00:00.000Z").getTime();
    vi.setSystemTime(agora);
    const b = banco({
      agendada: {
        data: agendada({ enviar_em: "2026-10-07T03:30:00.000Z" }),
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(b.chamadasDe("reagendar_job")).toEqual([
      {
        p_id: JOB,
        p_worker: WORKER,
        p_run_at: "2026-10-07T11:00:00.000Z",
        p_motivo: "silencio_noturno",
      },
    ]);
    nadaSaiu(b);
  });

  it("o fuso é o da clínica: a mesma hora UTC em Tóquio já é dia e sai", async () => {
    const agora = new Date("2026-10-07T05:00:00.000Z").getTime();
    vi.setSystemTime(agora);
    const b = banco({
      agendada: {
        data: agendada({
          enviar_em: "2026-10-07T03:30:00.000Z",
          clinic: { timezone: "Asia/Tokyo" },
        }),
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("o 08:00 depois do prazo: desiste com 'madrugada', não 'atrasou' (F4)", async () => {
    // 02:00 em Fortaleza; marcada para 15:30 da vespera (prazo 03:30): o
    // atraso e de 10h30, e o motivo diz que cairia de madrugada.
    vi.setSystemTime(new Date("2026-10-07T05:00:00.000Z").getTime());
    const b = banco({
      agendada: {
        data: agendada({ enviar_em: "2026-10-06T18:30:00.000Z" }),
        error: null,
      },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "madrugada",
      p_definitivo: true,
    });
    nadaSaiu(b);
  });

  it("marcada 20:00 que esperou o 08:00 (o próprio prazo) sai na volta do motor (F4)", async () => {
    // 21:30 em Fortaleza; marcada para 20:00: espera o 08:00 = prazo.
    vi.setSystemTime(new Date("2026-10-07T00:30:00.000Z").getTime());
    const ida = banco({
      agendada: {
        data: agendada({ enviar_em: "2026-10-06T23:00:00.000Z" }),
        error: null,
      },
    });
    expect(await executarJobComPosse(ida.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(ida.chamadasDe("reagendar_job")[0]).toMatchObject({
      p_run_at: "2026-10-07T11:00:00.000Z",
      p_motivo: "silencio_noturno",
    });
    // A volta: o motor reivindica as 08:00:20, segundos depois do prazo.
    vi.setSystemTime(new Date("2026-10-07T11:00:20.000Z").getTime());
    const volta = banco({
      agendada: {
        data: agendada({ enviar_em: "2026-10-06T23:00:00.000Z" }),
        error: null,
      },
    });
    expect(await executarJobComPosse(volta.admin, WORKER, job())).toBe(
      "concluido",
    );
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("marcada pela pessoa para as 22:00 sai na hora", async () => {
    // 22:02 em Fortaleza; marcada para 22:00.
    vi.setSystemTime(new Date("2026-10-08T01:02:00.000Z").getTime());
    const b = banco({
      agendada: {
        data: agendada({ enviar_em: "2026-10-08T01:00:00.000Z" }),
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("sem fuso gravado, vale o de Fortaleza", async () => {
    vi.setSystemTime(new Date("2026-10-07T05:00:00.000Z").getTime());
    const b = banco({
      agendada: {
        data: agendada({
          enviar_em: "2026-10-07T03:30:00.000Z",
          clinic: null,
        }),
        error: null,
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(b.chamadasDe("reagendar_job")[0]?.p_run_at).toBe(
      "2026-10-07T11:00:00.000Z",
    );
  });
});

describe("conversa e resultado do envio", () => {
  it("conversa indisponível: retry, sem enviar", async () => {
    const b = banco({
      conversa: { data: null, error: { code: "23502", message: "x" } },
    });
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "conversa_indisponivel",
      p_definitivo: false,
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("canal ocupado: volta quando o canal abre, sem fechar a agendada", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "slot_adiado",
      code: "canal_ocupado",
      livreEm: iso(AGORA + 25_000),
      message: "",
    } as never);
    const b = banco();
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(b.chamadasDe("reagendar_job")[0]).toMatchObject({
      p_run_at: iso(AGORA + 25_000),
      p_motivo: "canal_ocupado",
    });
    expect(b.chamadasDe("reconciliar_mensagem_agendada")).toEqual([]);
  });

  it("número removido no envio: definitivo (a agendada nunca troca de número)", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "desconectado",
      code: "numero_removido",
      message: "",
    } as never);
    const b = banco();
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "numero_removido",
      p_definitivo: true,
    });
  });

  it("número caiu entre a leitura e o envio: espera a reconexão", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "desconectado",
      code: "desconectado",
      message: "",
    } as never);
    const b = banco();
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe(
      "reagendado",
    );
    expect(b.chamadasDe("reagendar_job")[0]).toMatchObject({
      p_motivo: "desconectado",
    });
  });

  it("ja_enviado (outra execução do mesmo job): conclui, e a reconciliação lê a mensagem", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "ja_enviado",
      code: "ja_enviado",
      message: "",
    } as never);
    const b = banco();
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(b.chamadasDe("reconciliar_mensagem_agendada")).toHaveLength(1);
  });

  it("revogou durante a espera do slot: definitivo com o código do envio", async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({
      ok: false,
      reason: "sem_consentimento",
      code: "sem_consentimento_no_envio",
      message: "",
    } as never);
    const b = banco();
    await executarJobComPosse(b.admin, WORKER, job());
    expect(falhou(b)[0]).toMatchObject({
      p_erro: "sem_consentimento_no_envio",
      p_definitivo: true,
    });
  });

  it("só repete o que com certeza não chegou", async () => {
    for (const [codigo, definitivo] of [
      ["provider_indisponivel", false],
      ["slot_indisponivel", false],
      ["envio_incerto", true],
      ["conta_divergente", true],
      ["registro_falhou", true],
    ] as const) {
      vi.mocked(sendWhatsAppText).mockResolvedValue({
        ok: false,
        reason: "falha_envio",
        code: codigo,
        message: "",
      } as never);
      const b = banco();
      await executarJobComPosse(b.admin, WORKER, job());
      expect(falhou(b)[0]).toMatchObject({
        p_erro: codigo,
        p_definitivo: definitivo,
      });
    }
  });
});

describe("fechamento da agendada e dados de paciente", () => {
  it("reconciliação com erro: só um aviso com ids, e o job continua concluído", async () => {
    const b = banco({
      reconciliar: () => ({
        data: null,
        error: { code: "40P01", message: TEXTO },
      }),
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    const aviso = registros.linhas.find(
      (linha) => linha[1] === "agendada_fechamento_falhou",
    );
    expect(aviso).toEqual([
      "warn",
      "agendada_fechamento_falhou",
      { job_id: JOB, clinic_id: CLINICA, error_code: "40P01" },
    ]);
  });

  it("reconciliação que lança não derruba o fechamento do job", async () => {
    const b = banco({
      reconciliar: () => {
        throw new Error(TEXTO);
      },
    });
    expect(await executarJobComPosse(b.admin, WORKER, job())).toBe("concluido");
    expect(
      registros.linhas.find(
        (linha) => linha[1] === "agendada_fechamento_falhou",
      ),
    ).toEqual([
      "warn",
      "agendada_fechamento_falhou",
      { job_id: JOB, clinic_id: CLINICA, error_code: "excecao" },
    ]);
  });

  it("o texto da agendada nunca vai para log, last_error nem trilha", async () => {
    const cenarios: Cenario[] = [
      {},
      { consentimento: { data: false, error: null } },
      {
        mensagem: {
          data: { delivery_status: "enviando", error_code: null },
          error: null,
        },
      },
      {
        numero: {
          data: { connection_status: "desconectado", removido_em: null },
          error: null,
        },
      },
    ];
    for (const cenario of cenarios) {
      const b = banco(cenario);
      await executarJobComPosse(b.admin, WORKER, job());
      const gravado = JSON.stringify([
        b.rpcs.filter((r) => r.nome !== "garantir_conversa_aberta"),
        b.tabelas.filter((t) => t.tabela === "audit_log"),
        registros.linhas,
      ]);
      expect(gravado).not.toContain("Maria");
      expect(gravado).not.toContain("retorno");
    }
  });
});
