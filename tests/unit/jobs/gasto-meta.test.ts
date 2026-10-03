import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// worker.ts (para o caso do roteamento) puxa o envio de WhatsApp; nada disso
// roda aqui.
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
  DIAS_DA_LEITURA_DIARIA,
  DIAS_DA_PRIMEIRA_LEITURA,
  diasDaLeitura,
  executarSincronizacaoDeGastoMeta,
  PRAZO_DA_LEITURA_MS,
  sha256DoToken,
} from "@/lib/jobs/gasto-meta";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

import { bancoFalso, type Resposta } from "./banco-falso";

// Job sincronizar_gasto_meta (Fase 4) em cada desfecho, com o banco e a Meta
// dublados. O que importa: o token so sai no cabecalho da chamada a Meta (no
// banco vai so o sha256), a falha de configuracao grava o problema e para, o
// limite da Meta reagenda sem queimar tentativa, o passageiro segue o backoff
// e grava o problema so na ultima tentativa, e a troca de configuracao no
// meio da leitura nunca grava dado velho.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const WORKER = "motor-de-teste";
const TOKEN = "EAABtokenDeTeste1234567890SEGREDO";
const CONTA = "act_123456789";
const AGORA = Date.parse("2026-10-02T15:00:00.000Z");
const SHA = createHash("sha256").update(TOKEN, "utf8").digest("hex");

const CONTA_OK = {
  id: CONTA,
  name: "Clínica Sol",
  currency: "BRL",
  timezone_name: "America/Sao_Paulo",
  account_status: 1,
};

function job(extra: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    clinic_id: CLINICA,
    kind: "sincronizar_gasto_meta",
    payload: { origem: "diario" },
    attempts: 1,
    max_attempts: 5,
    ...extra,
  };
}

function json(corpo: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function erroMeta(code: number, status = 400, headers: Record<string, string> = {}) {
  return json(
    { error: { message: "Mensagem da Meta com SEGREDO", code, type: "OAuthException" } },
    status,
    headers,
  );
}

function linha(dia: string, adId: string, spend: string) {
  return {
    ad_id: adId,
    adset_id: "238500000000000001",
    campaign_id: "6720000000000001",
    campaign_name: "Botox outubro",
    spend,
    account_currency: "BRL",
    date_start: dia,
    date_stop: dia,
  };
}

type Chamada = { url: URL; init: RequestInit };

function metaFalsa(rotas: {
  conta?: () => Response;
  porAnuncio?: (url: URL) => Response;
  daConta?: () => Response;
  aCadaChamada?: () => void;
} = {}) {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, init: init ?? {} });
    rotas.aCadaChamada?.();
    if (!url.pathname.endsWith("/insights")) {
      return rotas.conta ? rotas.conta() : json(CONTA_OK);
    }
    if (url.searchParams.get("level") === "ad") {
      return rotas.porAnuncio
        ? rotas.porAnuncio(url)
        : json({
            data: [
              linha("2026-10-01", "111", "18.40"),
              linha("2026-10-02", "111", "5.00"),
              linha("2026-10-02", "222", "0"),
            ],
          });
    }
    return rotas.daConta
      ? rotas.daConta()
      : json({
          data: [
            { spend: "30.00", account_currency: "BRL", date_start: "2026-10-01", date_stop: "2026-10-01" },
            { spend: "5.00", account_currency: "BRL", date_start: "2026-10-02", date_stop: "2026-10-02" },
          ],
        });
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

function banco(o: {
  conta?: Resposta;
  segredo?: Resposta;
  leitura?: Resposta;
  regravar?: Resposta;
  registrar?: Resposta;
} = {}) {
  return bancoFalso({
    tabelas: {
      meta_ads_account: () => o.conta ?? { data: { ad_account_id: CONTA }, error: null },
      meta_ads_account_secret: () =>
        o.segredo ?? { data: { insights_access_token: TOKEN }, error: null },
      meta_gasto_leitura: () => o.leitura ?? { data: null, error: null },
    },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      regravar_gasto_meta: () => o.regravar ?? { data: "ok", error: null },
      registrar_falha_do_gasto_meta: () => o.registrar ?? { data: "ok", error: null },
    },
  });
}

const semEspera = async () => {};

function rodar(
  db: ReturnType<typeof banco>,
  meta: ReturnType<typeof metaFalsa>,
  extra: { job?: Partial<Job>; agora?: () => number } = {},
) {
  return executarSincronizacaoDeGastoMeta(db.admin, job(extra.job), WORKER, {
    fetchFn: meta.fetchFn,
    agora: extra.agora ?? (() => AGORA),
    dormir: semEspera,
  });
}

function tudoQueSaiu(db: ReturnType<typeof banco>): string {
  const chamadasDeLog = [
    ...vi.mocked(log.info).mock.calls,
    ...vi.mocked(log.warn).mock.calls,
    ...vi.mocked(log.error).mock.calls,
  ];
  return JSON.stringify({ rpcs: db.rpcs, tabelas: db.tabelas, log: chamadasDeLog });
}

beforeEach(() => {
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
});

describe("diasDaLeitura (D4)", () => {
  const anterior = {
    ad_account_id: CONTA,
    lido_desde: "2026-08-04",
    lido_ate: "2026-10-01",
    fuso_da_conta: "America/Sao_Paulo",
  };

  it("as constantes são as do dono: 60 na primeira, 30 por dia", () => {
    expect(DIAS_DA_PRIMEIRA_LEITURA).toBe(60);
    expect(DIAS_DA_LEITURA_DIARIA).toBe(30);
    expect(PRAZO_DA_LEITURA_MS).toBe(35_000);
  });

  it("primeira leitura, troca de conta e buraco maior que a janela leem 60", () => {
    expect(diasDaLeitura(null, CONTA, AGORA)).toBe(60);
    expect(diasDaLeitura({ ...anterior, lido_desde: null }, CONTA, AGORA)).toBe(60);
    expect(diasDaLeitura({ ...anterior, ad_account_id: "act_999999999" }, CONTA, AGORA)).toBe(60);
    expect(diasDaLeitura({ ...anterior, lido_ate: "2026-09-01" }, CONTA, AGORA)).toBe(60);
  });

  it("leitura em dia lê 30 (até o buraco que a janela de 30 ainda cobre)", () => {
    expect(diasDaLeitura(anterior, CONTA, AGORA)).toBe(30);
    expect(diasDaLeitura({ ...anterior, lido_ate: "2026-09-02" }, CONTA, AGORA)).toBe(30);
    expect(diasDaLeitura({ ...anterior, fuso_da_conta: null }, CONTA, AGORA)).toBe(30);
  });
});

describe("executarSincronizacaoDeGastoMeta: leitura que dá certo", () => {
  it("primeira leitura: 60 dias, regrava com o sha256 do token e nunca com o token", async () => {
    const db = banco();
    const meta = metaFalsa();
    const r = await rodar(db, meta);
    expect(r).toEqual({ ok: true });

    expect(sha256DoToken(TOKEN)).toBe(SHA);
    const [args] = db.chamadasDe("regravar_gasto_meta");
    expect(args).toEqual({
      p_job_id: JOB_ID,
      p_worker: WORKER,
      p_clinic_id: CLINICA,
      p_ad_account_id: CONTA,
      p_token_sha256: SHA,
      p_desde: "2026-08-04",
      p_ate: "2026-10-02",
      p_moeda: "BRL",
      p_fuso: "America/Sao_Paulo",
      p_nome_da_conta: "Clínica Sol",
      p_conta_ativa: true,
      p_por_anuncio: [
        {
          dia: "2026-10-01",
          ad_id: "111",
          adset_id: "238500000000000001",
          campaign_id: "6720000000000001",
          campaign_name: "Botox outubro",
          spend_cents: 1840,
        },
        {
          dia: "2026-10-02",
          ad_id: "111",
          adset_id: "238500000000000001",
          campaign_id: "6720000000000001",
          campaign_name: "Botox outubro",
          spend_cents: 500,
        },
        {
          dia: "2026-10-02",
          ad_id: "222",
          adset_id: "238500000000000001",
          campaign_id: "6720000000000001",
          campaign_name: "Botox outubro",
          spend_cents: 0,
        },
      ],
      p_da_conta: [
        { dia: "2026-10-01", spend_cents: 3000 },
        { dia: "2026-10-02", spend_cents: 500 },
      ],
    });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toHaveLength(0);

    // O token so sai no cabecalho da chamada a Meta.
    for (const chamada of meta.chamadas) {
      expect((chamada.init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`,
      );
      expect(chamada.url.toString()).not.toContain(TOKEN);
    }
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
    // Le o segredo pelo cliente de servico, so a coluna do token de leitura.
    const segredo = db.tabelas.find((t) => t.tabela === "meta_ads_account_secret");
    expect(segredo?.metodos[0]).toEqual({
      metodo: "select",
      args: ["insights_access_token"],
    });
  });

  it("leitura em dia regrava só 30 dias", async () => {
    const db = banco({
      leitura: {
        data: {
          ad_account_id: CONTA,
          lido_desde: "2026-08-04",
          lido_ate: "2026-10-01",
          fuso_da_conta: "America/Sao_Paulo",
        },
        error: null,
      },
    });
    await rodar(db, metaFalsa());
    expect(db.chamadasDe("regravar_gasto_meta")[0]).toMatchObject({
      p_desde: "2026-09-03",
      p_ate: "2026-10-02",
    });
  });

  it("conta trocada desde a última leitura volta a ler 60 dias", async () => {
    const db = banco({
      leitura: {
        data: {
          ad_account_id: "act_999999999",
          lido_desde: "2026-08-04",
          lido_ate: "2026-10-01",
          fuso_da_conta: "America/Sao_Paulo",
        },
        error: null,
      },
    });
    await rodar(db, metaFalsa());
    expect(db.chamadasDe("regravar_gasto_meta")[0]).toMatchObject({
      p_desde: "2026-08-04",
    });
  });

  it("conta sem nome vai como texto vazio (o banco grava null)", async () => {
    const db = banco();
    await rodar(db, metaFalsa({ conta: () => json({ ...CONTA_OK, name: "  " }) }));
    expect(db.chamadasDe("regravar_gasto_meta")[0]).toMatchObject({
      p_nome_da_conta: "",
    });
  });
});

describe("executarSincronizacaoDeGastoMeta: configuração", () => {
  it("sem token de leitura conclui sem chamar a Meta", async () => {
    const db = banco({ segredo: { data: { insights_access_token: null }, error: null } });
    const meta = metaFalsa();
    expect(await rodar(db, meta)).toEqual({ ok: true });
    expect(meta.chamadas).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it("sem conta salva conclui sem chamar a Meta", async () => {
    const db = banco({ conta: { data: null, error: null } });
    const meta = metaFalsa();
    expect(await rodar(db, meta)).toEqual({ ok: true });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("leitura da configuração que falha é retry, nunca 'sem configuração'", async () => {
    const db = banco({
      segredo: { data: null, error: { code: "57014", message: "statement timeout" } },
    });
    const meta = metaFalsa();
    expect(await rodar(db, meta)).toEqual({
      ok: false,
      erro: "config_ilegivel:57014",
    });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("conta salva fora do formato para de vez (o CHECK do banco impede)", async () => {
    const db = banco({ conta: { data: { ad_account_id: "123456789" }, error: null } });
    const meta = metaFalsa();
    expect(await rodar(db, meta)).toEqual({
      ok: false,
      erro: "conta_fora_do_formato",
      definitivo: true,
    });
    expect(meta.chamadas).toHaveLength(0);
  });
});

describe("executarSincronizacaoDeGastoMeta: falhas da Meta", () => {
  it("token recusado grava o problema e para de vez (pausa)", async () => {
    const db = banco();
    const r = await rodar(db, metaFalsa({ conta: () => erroMeta(190, 401) }));
    expect(r).toEqual({ ok: false, erro: "token_invalido:190", definitivo: true });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toEqual([
      {
        p_job_id: JOB_ID,
        p_worker: WORKER,
        p_clinic_id: CLINICA,
        p_ad_account_id: CONTA,
        p_token_sha256: SHA,
        p_problema: "token_invalido",
        p_codigo: 190,
      },
    ]);
    expect(db.chamadasDe("regravar_gasto_meta")).toHaveLength(0);
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
    expect(tudoQueSaiu(db)).not.toContain("SEGREDO");
  });

  it("token trocado durante a leitura: não pausa a configuração nova, lê de novo já", async () => {
    const db = banco({ registrar: { data: "config_mudou", error: null } });
    const r = await rodar(db, metaFalsa({ conta: () => erroMeta(190, 401) }));
    expect(r).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "config_mudou",
    });
  });

  it("versão descontinuada grava o problema e desiste", async () => {
    const db = banco();
    const r = await rodar(db, metaFalsa({ conta: () => erroMeta(2635) }));
    expect(r).toEqual({
      ok: false,
      erro: "versao_descontinuada:2635",
      definitivo: true,
    });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")[0]).toMatchObject({
      p_problema: "versao_descontinuada",
      p_codigo: 2635,
    });
  });

  it.each([
    [{ "x-business-use-case-usage": JSON.stringify({ a: [{ estimated_time_to_regain_access: 19 }] }) }, 19 * 60_000],
    [{ "x-business-use-case-usage": JSON.stringify({ a: [{ estimated_time_to_regain_access: 1 }] }) }, 5 * 60_000],
    [{ "x-business-use-case-usage": JSON.stringify({ a: [{ estimated_time_to_regain_access: 120 }] }) }, 60 * 60_000],
    [{}, 15 * 60_000],
  ])("limite da Meta reagenda sem gravar problema (%j)", async (cabecalhos, espera) => {
    const db = banco();
    const r = await rodar(db, metaFalsa({ conta: () => erroMeta(4, 400, cabecalhos) }));
    expect(r).toEqual({
      reagendar: new Date(AGORA + espera).toISOString(),
      motivo: "limite_da_meta",
    });
    expect(db.rpcs).toHaveLength(0);
  });

  it("passageiro antes da última tentativa só devolve o erro para o backoff", async () => {
    const db = banco();
    const r = await rodar(db, metaFalsa({ conta: () => new Response(null, { status: 503 }) }));
    expect(r).toEqual({ ok: false, erro: "meta_indisponivel" });
    expect(db.rpcs).toHaveLength(0);
  });

  it("passageiro na última tentativa grava o problema para a tela", async () => {
    const db = banco();
    const r = await rodar(
      db,
      metaFalsa({ conta: () => new Response(null, { status: 503 }) }),
      { job: { attempts: 5, max_attempts: 5 } },
    );
    expect(r).toEqual({ ok: false, erro: "meta_indisponivel", definitivo: true });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")[0]).toMatchObject({
      p_problema: "meta_indisponivel",
      p_codigo: null,
    });
  });

  it("gravar o problema que falha vira retry com o código do banco", async () => {
    const db = banco({ registrar: { data: null, error: { code: "08006", message: "x" } } });
    const r = await rodar(db, metaFalsa({ conta: () => erroMeta(10) }));
    expect(r).toEqual({ ok: false, erro: "registrar_falha_falhou:08006" });
  });

  it("prazo de 35 s: o relógio que passa do prazo corta a leitura", async () => {
    let relogio = AGORA;
    const db = banco();
    const meta = metaFalsa({
      aCadaChamada: () => {
        relogio += 34_000;
      },
    });
    const r = await rodar(db, meta, { agora: () => relogio });
    expect(r).toEqual({ ok: false, erro: "prazo_esgotado" });
    // So a conta: a consulta por anuncio nem comecou.
    expect(meta.chamadas).toHaveLength(1);
    expect(db.chamadasDe("regravar_gasto_meta")).toHaveLength(0);
  });
});

describe("executarSincronizacaoDeGastoMeta: gravação", () => {
  it("configuração trocada durante a leitura não grava e lê de novo já", async () => {
    const db = banco({ regravar: { data: "config_mudou", error: null } });
    expect(await rodar(db, metaFalsa())).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "config_mudou",
    });
  });

  it("sem posse não conclui", async () => {
    const db = banco({ regravar: { data: "sem_posse", error: null } });
    expect(await rodar(db, metaFalsa())).toEqual({ ok: false, erro: "sem_posse" });
  });

  it("janela inválida é defeito nosso: para de vez", async () => {
    const db = banco({ regravar: { data: "janela_invalida", error: null } });
    expect(await rodar(db, metaFalsa())).toEqual({
      ok: false,
      erro: "janela_invalida",
      definitivo: true,
    });
  });

  it("erro da própria RPC é passageiro (o job é idempotente)", async () => {
    const db = banco({
      regravar: { data: null, error: { code: "57014", message: "statement timeout" } },
    });
    expect(await rodar(db, metaFalsa())).toEqual({
      ok: false,
      erro: "gravar_gasto_falhou:57014",
    });
  });
});

describe("roteamento no worker", () => {
  it("o kind sincronizar_gasto_meta cai no executor do gasto e conclui", async () => {
    // Sem token: o executor conclui sem rede, o que prova o caminho inteiro
    // (posse, roteamento, concluir_job) sem depender da Meta.
    const db = banco({ segredo: { data: null, error: null } });
    const desfecho = await executarJobComPosse(db.admin, WORKER, job());
    expect(desfecho).toBe("concluido");
    expect(db.chamadasDe("concluir_job")).toEqual([{ p_id: JOB_ID, p_worker: WORKER }]);
    expect(db.chamadasDe("falhar_job")).toHaveLength(0);
    expect(db.tabelas.map((t) => t.tabela)).toContain("meta_ads_account_secret");
  });
});
