import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// worker.ts (roteamento e passagem do motor) puxa o envio de WhatsApp; nada
// disso roda aqui.
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
  RESOLVER_MAX_ANUNCIOS,
  RESOLVER_PRAZO_MS,
  type FalhaDeLeitura,
  type ResolucaoDeAnuncios,
} from "@/lib/integrations/meta/insights";
import { executarSincronizacaoDeGastoMeta } from "@/lib/jobs/gasto-meta";
import {
  executarPassagemDoMotor,
  montarGruposDaPassagem,
} from "@/lib/jobs/motor";
import {
  executarResolucaoDeAnunciosMeta,
  lerListaDeAnuncios,
  type ResolverAnuncios,
} from "@/lib/jobs/resolver-anuncio-meta";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

import { bancoFalso, type Resposta } from "./banco-falso";

// Job resolver_anuncio_meta (origem real do lead de anuncio, frente C da
// critica de 04/10/2026), com o banco e a Meta dublados. O que importa:
//   - o token so vai para a integracao; no banco vai so o sha256 e nada dele
//     (nem id ou nome de anuncio) sai em log;
//   - sem configuracao ou com a leitura pausada, conclui sem chamar a Meta;
//   - o que a Meta devolve vira exatamente o formato da
//     gravar_resolucao_de_anuncios_meta (snake_case, pelo mapeamento da
//     integracao), sem nada que leve a funcao ao 22023;
//   - a volta: agora se ainda ha anuncio devido, na hora da nova tentativa
//     se ha uma marcada, senao conclui;
//   - token ou permissao recusados pausam pela mesma funcao do gasto, com o
//     id do job do resolvedor; limite da Meta reagenda; configuracao trocada
//     no meio nunca grava;
//   - o motor reivindica o tipo no trilho do gasto, num grupo so dele;
//   - o fim do gasto que deu certo pede a consulta (origem 'gasto').

const CLINICA = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "77777777-7777-4777-8777-777777777777";
const WORKER = "motor-de-teste";
const TOKEN = "EAABtokenDeTeste1234567890SEGREDO";
const CONTA = "act_123456789";
const AGORA = Date.parse("2026-10-04T15:00:00.000Z");
const SHA = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const ANUNCIO_A = "120240624148610289";
const ANUNCIO_B = "120240624148610300";
const PROXIMA = "2026-10-04T16:00:00.123456+00:00";

function job(extra: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    clinic_id: CLINICA,
    kind: "resolver_anuncio_meta",
    payload: { origem: "ingestao" },
    attempts: 1,
    max_attempts: 5,
    ...extra,
  };
}

function lista(
  adIds: string[],
  extra: { restantes?: number; proxima_tentativa_em?: string | null } = {},
): Resposta {
  return {
    data: {
      codigo: "ok",
      ad_ids: adIds,
      restantes: extra.restantes ?? 0,
      proxima_tentativa_em: extra.proxima_tentativa_em ?? null,
    },
    error: null,
  };
}

function banco(
  o: {
    conta?: Resposta;
    segredo?: Resposta;
    leitura?: Resposta;
    /** Respostas da anuncios_meta_a_resolver, na ordem das chamadas. */
    listas?: Resposta[];
    gravar?: Resposta;
    registrar?: Resposta;
  } = {},
) {
  const listas = [...(o.listas ?? [lista([ANUNCIO_A, ANUNCIO_B]), lista([])])];
  return bancoFalso({
    tabelas: {
      meta_ads_account: () =>
        o.conta ?? { data: { ad_account_id: CONTA }, error: null },
      meta_ads_account_secret: () =>
        o.segredo ?? { data: { insights_access_token: TOKEN }, error: null },
      meta_gasto_leitura: () =>
        o.leitura ?? { data: { situacao: "funcionando", problema: null }, error: null },
    },
    rpcs: {
      confirmar_posse_job: () => ({ data: true, error: null }),
      anuncios_meta_a_resolver: () => listas.shift() ?? lista([]),
      gravar_resolucao_de_anuncios_meta: () => o.gravar ?? { data: "ok", error: null },
      registrar_falha_do_gasto_meta: () =>
        o.registrar ?? { data: "ok", error: null },
    },
  });
}

type Resolvido = ResolucaoDeAnuncios["resolvidos"][number];
type Resultado = ResolucaoDeAnuncios | FalhaDeLeitura;

const RESOLVIDO_A: Resolvido = {
  adId: ANUNCIO_A,
  adName: "Botox | vídeo 1",
  adsetId: "238500000000000001",
  adsetName: "Mulheres 30 a 50, Fortaleza",
  campaignId: "6720000000000001",
  campaignName: "Botox outubro",
  adAccountId: CONTA,
};

function sucesso(extra: Partial<ResolucaoDeAnuncios> = {}): Resultado {
  return {
    ok: true,
    resolvidos: [RESOLVIDO_A],
    recusados: [{ adId: ANUNCIO_B, motivo: "sem_entrega_ainda", codigo: null }],
    naoTentados: [],
    ...extra,
  };
}

function falhaDaMeta(
  problema: FalhaDeLeitura["problema"],
  acao: FalhaDeLeitura["acao"],
  extra: Partial<FalhaDeLeitura> = {},
): FalhaDeLeitura {
  return {
    ok: false,
    problema,
    acao,
    tentarEmMs: null,
    codigoDaMeta: null,
    subcodigoDaMeta: null,
    http: null,
    ...extra,
  };
}

function resolverFalso(resposta: Resultado) {
  const chamadas: { config: Parameters<ResolverAnuncios>[0]; adIds: readonly string[] }[] =
    [];
  const resolver: ResolverAnuncios = async (config, adIds) => {
    chamadas.push({ config, adIds });
    return resposta;
  };
  return { resolver, chamadas };
}

const semEspera = async () => {};

function rodar(
  db: ReturnType<typeof banco>,
  resolver: ResolverAnuncios,
  extra: { job?: Partial<Job> } = {},
) {
  return executarResolucaoDeAnunciosMeta(db.admin, job(extra.job), WORKER, {
    resolver,
    agora: () => AGORA,
    dormir: semEspera,
  });
}

function tudoQueSaiu(db: ReturnType<typeof bancoFalso>): string {
  const chamadasDeLog = [
    ...vi.mocked(log.info).mock.calls,
    ...vi.mocked(log.warn).mock.calls,
    ...vi.mocked(log.error).mock.calls,
  ];
  return JSON.stringify({ rpcs: db.rpcs, tabelas: db.tabelas, log: chamadasDeLog });
}

function logs(): string {
  return JSON.stringify([
    ...vi.mocked(log.info).mock.calls,
    ...vi.mocked(log.warn).mock.calls,
    ...vi.mocked(log.error).mock.calls,
  ]);
}

beforeEach(() => {
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
});

describe("constantes do contrato", () => {
  it("20 anúncios por execução e 15 s de prazo (os tetos da integração)", () => {
    expect(RESOLVER_MAX_ANUNCIOS).toBe(20);
    expect(RESOLVER_PRAZO_MS).toBe(15_000);
  });
});

describe("executarResolucaoDeAnunciosMeta: consulta que dá certo", () => {
  it("lista, consulta a Meta com a conta e o token salvos e grava com o sha256", async () => {
    const db = banco();
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({ ok: true });

    // Lista com a conta e o sha256, 20 por vez.
    const [primeira, segunda] = db.chamadasDe("anuncios_meta_a_resolver");
    expect(primeira).toEqual({
      p_clinic_id: CLINICA,
      p_ad_account_id: CONTA,
      p_token_sha256: SHA,
      p_limite: 20,
    });
    // Depois de gravar, pergunta de novo o que sobrou (basta 1).
    expect(segunda).toMatchObject({ p_limite: 1, p_token_sha256: SHA });

    // A Meta recebe a conta, o token e o prazo; e so os anuncios pedidos.
    expect(meta.chamadas).toHaveLength(1);
    expect(meta.chamadas[0]?.adIds).toEqual([ANUNCIO_A, ANUNCIO_B]);
    expect(meta.chamadas[0]?.config).toMatchObject({
      adAccountId: CONTA,
      accessToken: TOKEN,
      prazoEm: AGORA + 15_000,
    });

    // Gravacao no formato exato da funcao do banco.
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toEqual([
      {
        p_job_id: JOB_ID,
        p_worker: WORKER,
        p_clinic_id: CLINICA,
        p_ad_account_id: CONTA,
        p_token_sha256: SHA,
        p_resolvidos: [
          {
            ad_id: ANUNCIO_A,
            ad_account_id: CONTA,
            campaign_id: "6720000000000001",
            campaign_name: "Botox outubro",
            adset_id: "238500000000000001",
            adset_name: "Mulheres 30 a 50, Fortaleza",
            ad_name: "Botox | vídeo 1",
          },
        ],
        p_recusas: [{ ad_id: ANUNCIO_B, motivo: "sem_entrega_ainda", codigo: null }],
      },
    ]);
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toHaveLength(0);

    // Token so na integracao; no banco e no log, nunca. Nem id nem nome de
    // anuncio no log: so contagens.
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
    expect(logs()).not.toContain(ANUNCIO_A);
    expect(logs()).not.toContain("Botox");
    expect(log.info).toHaveBeenCalledWith(
      "resolver_anuncio_meta_gravado",
      expect.objectContaining({ clinic_id: CLINICA, job_id: JOB_ID, count: 1 }),
    );
    expect(log.info).toHaveBeenCalledWith(
      "resolver_anuncio_meta_recusados",
      expect.objectContaining({ count: 1 }),
    );
    // O segredo pelo cliente de servico, so a coluna do token de leitura.
    const segredo = db.tabelas.find((t) => t.tabela === "meta_ads_account_secret");
    expect(segredo?.metodos[0]).toEqual({
      metodo: "select",
      args: ["insights_access_token"],
    });
  });

  it("ainda há anúncio devido depois de gravar: volta agora", async () => {
    const db = banco({ listas: [lista([ANUNCIO_A], { restantes: 30 }), lista([ANUNCIO_B])] });
    const meta = resolverFalso(sucesso({ recusados: [] }));
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "mais_anuncios",
    });
  });

  it("nova tentativa marcada depois de gravar: volta nessa hora, exatamente como o banco deu", async () => {
    const db = banco({
      listas: [lista([ANUNCIO_A, ANUNCIO_B]), lista([], { proxima_tentativa_em: PROXIMA })],
    });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: PROXIMA,
      motivo: "nova_tentativa",
    });
  });

  it("o que não coube no prazo fica para a volta seguinte, agora", async () => {
    const db = banco({ listas: [lista([ANUNCIO_A, ANUNCIO_B]), lista([ANUNCIO_B])] });
    const meta = resolverFalso(sucesso({ recusados: [], naoTentados: [ANUNCIO_B] }));
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "mais_anuncios",
    });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")[0]).toMatchObject({
      p_recusas: [],
    });
  });

  it("nada devido agora, mas nova tentativa marcada: volta nessa hora sem chamar a Meta", async () => {
    const db = banco({ listas: [lista([], { proxima_tentativa_em: PROXIMA })] });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: PROXIMA,
      motivo: "nova_tentativa",
    });
    expect(meta.chamadas).toHaveLength(0);
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });

  it("nada devido e nada marcado: conclui sem chamar a Meta", async () => {
    const db = banco({ listas: [lista([])] });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({ ok: true });
    expect(meta.chamadas).toHaveLength(0);
  });
});

describe("executarResolucaoDeAnunciosMeta: o que vai para a gravação", () => {
  it("código da Meta fora do inteiro gravável vira null (nada leva a função ao 22023)", async () => {
    const db = banco();
    const meta = resolverFalso({
      ok: true,
      resolvidos: [],
      recusados: [
        { adId: ANUNCIO_A, motivo: "inacessivel", codigo: 100 },
        { adId: ANUNCIO_B, motivo: "resposta_invalida", codigo: 12_345_678_901 },
      ],
      naoTentados: [],
    });
    await rodar(db, meta.resolver);
    const [args] = db.chamadasDe("gravar_resolucao_de_anuncios_meta");
    expect(args?.p_resolvidos).toEqual([]);
    expect(args?.p_recusas).toEqual([
      { ad_id: ANUNCIO_A, motivo: "inacessivel", codigo: 100 },
      { ad_id: ANUNCIO_B, motivo: "resposta_invalida", codigo: null },
    ]);
  });

  it("conjunto e nomes ausentes vão como null", async () => {
    const db = banco();
    const meta = resolverFalso(
      sucesso({
        resolvidos: [
          { ...RESOLVIDO_A, adsetId: null, adsetName: null, adName: null, campaignName: null },
        ],
        recusados: [],
      }),
    );
    await rodar(db, meta.resolver);
    const [args] = db.chamadasDe("gravar_resolucao_de_anuncios_meta");
    expect(args?.p_resolvidos).toEqual([
      {
        ad_id: ANUNCIO_A,
        ad_account_id: CONTA,
        campaign_id: "6720000000000001",
        campaign_name: null,
        adset_id: null,
        adset_name: null,
        ad_name: null,
      },
    ]);
  });

  it("nada terminou: backoff, sem gravar e sem voltar em laço", async () => {
    const db = banco();
    const meta = resolverFalso({
      ok: true,
      resolvidos: [],
      recusados: [],
      naoTentados: [ANUNCIO_A, ANUNCIO_B],
    });
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "prazo_esgotado",
    });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });

  it("prazo esgotado antes do primeiro anúncio (falha da integração): backoff", async () => {
    const db = banco();
    const meta = resolverFalso(falhaDaMeta("prazo_esgotado", "repetir"));
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "prazo_esgotado",
    });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });
});

describe("executarResolucaoDeAnunciosMeta com a integração de verdade", () => {
  // Sem resolver injetado: o job chama resolverAnuncios de
  // lib/integrations/meta/insights.ts, com a Meta dublada no fetch. Prova a
  // corrente inteira job -> integracao -> formato da gravacao.
  function json(corpo: unknown, status = 200) {
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("anúncio com entrega resolve; sem entrega e objeto recusado vira sem_entrega_ainda", async () => {
    const urls: URL[] = [];
    const cabecalhos: unknown[] = [];
    const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
      const url = new URL(String(entrada));
      urls.push(url);
      cabecalhos.push(init?.headers);
      if (url.pathname.endsWith(`/${ANUNCIO_A}/insights`)) {
        return json({
          data: [
            {
              account_id: "123456789",
              ad_id: ANUNCIO_A,
              ad_name: "Botox | vídeo 1",
              adset_id: "238500000000000001",
              adset_name: "Mulheres 30 a 50, Fortaleza",
              campaign_id: "6720000000000001",
              campaign_name: "Botox outubro",
            },
          ],
        });
      }
      if (url.pathname.endsWith(`/${ANUNCIO_B}/insights`)) {
        return json({ data: [] });
      }
      // Objeto do anuncio B: recusado (expansao de campo sem permissao).
      return json(
        { error: { message: "Mensagem da Meta com SEGREDO", code: 100, type: "OAuthException" } },
        400,
      );
    }) as typeof fetch;

    const db = banco();
    const r = await executarResolucaoDeAnunciosMeta(db.admin, job(), WORKER, {
      fetchFn,
      agora: () => AGORA,
      dormir: semEspera,
    });
    expect(r).toEqual({ ok: true });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")[0]).toMatchObject({
      p_token_sha256: SHA,
      p_resolvidos: [
        {
          ad_id: ANUNCIO_A,
          ad_account_id: CONTA,
          campaign_id: "6720000000000001",
          campaign_name: "Botox outubro",
          adset_id: "238500000000000001",
          adset_name: "Mulheres 30 a 50, Fortaleza",
          ad_name: "Botox | vídeo 1",
        },
      ],
      p_recusas: [{ ad_id: ANUNCIO_B, motivo: "sem_entrega_ainda", codigo: 100 }],
    });
    // Token so no cabecalho; nunca na URL, no banco ou no log. A mensagem da
    // Meta nao sai.
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.toString()).not.toContain(TOKEN);
    }
    for (const h of cabecalhos) {
      expect((h as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
    expect(tudoQueSaiu(db)).not.toContain("SEGREDO");
  });

  it("token recusado pela Meta pausa pela função do gasto", async () => {
    const fetchFn = (async () =>
      json({ error: { message: "x", code: 190, type: "OAuthException" } }, 401)) as typeof fetch;
    const db = banco();
    const r = await executarResolucaoDeAnunciosMeta(db.admin, job(), WORKER, {
      fetchFn,
      agora: () => AGORA,
      dormir: semEspera,
    });
    expect(r).toEqual({ ok: false, erro: "token_invalido:190", definitivo: true });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")[0]).toMatchObject({
      p_job_id: JOB_ID,
      p_problema: "token_invalido",
      p_codigo: 190,
    });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });
});

describe("executarResolucaoDeAnunciosMeta: configuração", () => {
  it("sem token de leitura conclui sem listar nem chamar a Meta", async () => {
    const db = banco({ segredo: { data: { insights_access_token: null }, error: null } });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({ ok: true });
    expect(meta.chamadas).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it("sem conta salva conclui sem chamar a Meta", async () => {
    const db = banco({ conta: { data: null, error: null } });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({ ok: true });
    expect(meta.chamadas).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it.each(["token_invalido", "sem_permissao", "conta_sem_acesso", "exige_prova_do_app"])(
    "leitura pausada (%s): conclui sem listar nem chamar a Meta",
    async (problema) => {
      const db = banco({
        leitura: { data: { situacao: "com_problema", problema }, error: null },
      });
      const meta = resolverFalso(sucesso());
      expect(await rodar(db, meta.resolver)).toEqual({ ok: true });
      expect(meta.chamadas).toHaveLength(0);
      expect(db.rpcs).toHaveLength(0);
    },
  );

  it("problema que não pausa (meta_indisponivel) e leitura nunca testada: consulta normalmente", async () => {
    for (const leitura of [
      { data: { situacao: "com_problema", problema: "meta_indisponivel" }, error: null },
      { data: { situacao: "nao_testada", problema: null }, error: null },
      { data: null, error: null },
    ]) {
      const db = banco({ leitura });
      const meta = resolverFalso(sucesso());
      expect(await rodar(db, meta.resolver)).toEqual({ ok: true });
      expect(meta.chamadas).toHaveLength(1);
    }
  });

  it("leitura da configuração que falha é retry, nunca 'sem configuração'", async () => {
    const db = banco({
      leitura: { data: null, error: { code: "57014", message: "statement timeout" } },
    });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "config_ilegivel:57014",
    });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("conta salva fora do formato para de vez", async () => {
    const db = banco({ conta: { data: { ad_account_id: "123456789" }, error: null } });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "conta_fora_do_formato",
      definitivo: true,
    });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("conta ou token trocados antes de listar: volta agora, sem chamar a Meta", async () => {
    const db = banco({ listas: [{ data: { codigo: "config_mudou" }, error: null }] });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "config_mudou",
    });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("lista que falha é retry com o código do banco", async () => {
    const db = banco({ listas: [{ data: null, error: { code: "", message: "rede" } }] });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "listar_anuncios_falhou:sem_resposta",
    });
  });

  it("lista fora do contrato é defeito nosso: para de vez", async () => {
    const db = banco({ listas: [{ data: { codigo: "ok", ad_ids: ["abc"] }, error: null }] });
    const meta = resolverFalso(sucesso());
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "lista_invalida",
      definitivo: true,
    });
    expect(meta.chamadas).toHaveLength(0);
  });
});

describe("executarResolucaoDeAnunciosMeta: falhas da Meta", () => {
  it("token recusado: grava o problema pela função do gasto, com o job do resolvedor, e para", async () => {
    const db = banco();
    const meta = resolverFalso(
      falhaDaMeta("token_invalido", "pausar", { codigoDaMeta: 190, http: 401 }),
    );
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "token_invalido:190",
      definitivo: true,
    });
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
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
  });

  it("token trocado durante a consulta: não pausa a configuração nova, volta já", async () => {
    const db = banco({ registrar: { data: "config_mudou", error: null } });
    const meta = resolverFalso(falhaDaMeta("sem_permissao", "pausar", { codigoDaMeta: 200 }));
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "config_mudou",
    });
  });

  it("registrar sem posse não conclui; registrar que falha é retry", async () => {
    const semPosse = banco({ registrar: { data: "sem_posse", error: null } });
    const pausar = falhaDaMeta("conta_sem_acesso", "pausar", { codigoDaMeta: 10 });
    expect(await rodar(semPosse, resolverFalso(pausar).resolver)).toEqual({
      ok: false,
      erro: "sem_posse",
    });
    const quebrado = banco({ registrar: { data: null, error: { code: "08006" } } });
    expect(await rodar(quebrado, resolverFalso(pausar).resolver)).toEqual({
      ok: false,
      erro: "registrar_falha_falhou:08006",
    });
  });

  it.each([
    [19 * 60_000, 19 * 60_000],
    [60_000, 5 * 60_000],
    [120 * 60_000, 60 * 60_000],
    [null, 15 * 60_000],
  ])("limite da Meta (%s ms) reagenda sem gravar nada", async (tentarEmMs, espera) => {
    const db = banco();
    const meta = resolverFalso(falhaDaMeta("limite_da_meta", "reagendar", { tentarEmMs }));
    expect(await rodar(db, meta.resolver)).toEqual({
      reagendar: new Date(AGORA + espera).toISOString(),
      motivo: "limite_da_meta",
    });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toHaveLength(0);
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });

  it("passageiro segue o backoff, sem mexer na situação da leitura (nem na última tentativa)", async () => {
    for (const attempts of [1, 5]) {
      const db = banco();
      const meta = resolverFalso(falhaDaMeta("meta_indisponivel", "repetir", { http: 503 }));
      expect(await rodar(db, meta.resolver, { job: { attempts } })).toEqual({
        ok: false,
        erro: "meta_indisponivel",
      });
      expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toHaveLength(0);
    }
  });

  it("pedido recusado (versão descontinuada) desiste sem mexer na situação da leitura", async () => {
    const db = banco();
    const meta = resolverFalso(
      falhaDaMeta("versao_descontinuada", "desistir", { codigoDaMeta: 2635 }),
    );
    expect(await rodar(db, meta.resolver)).toEqual({
      ok: false,
      erro: "versao_descontinuada:2635",
      definitivo: true,
    });
    expect(db.chamadasDe("registrar_falha_do_gasto_meta")).toHaveLength(0);
  });
});

describe("executarResolucaoDeAnunciosMeta: gravação", () => {
  it("configuração trocada durante a consulta: nada gravado, volta já", async () => {
    const db = banco({ gravar: { data: "config_mudou", error: null } });
    expect(await rodar(db, resolverFalso(sucesso()).resolver)).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "config_mudou",
    });
    // Nem pergunta o que sobrou.
    expect(db.chamadasDe("anuncios_meta_a_resolver")).toHaveLength(1);
  });

  it("sem posse não conclui", async () => {
    const db = banco({ gravar: { data: "sem_posse", error: null } });
    expect(await rodar(db, resolverFalso(sucesso()).resolver)).toEqual({
      ok: false,
      erro: "sem_posse",
    });
  });

  it("erro da própria RPC é passageiro; 22023 (formato recusado) para de vez", async () => {
    const passageiro = banco({ gravar: { data: null, error: { code: "57014" } } });
    expect(await rodar(passageiro, resolverFalso(sucesso()).resolver)).toEqual({
      ok: false,
      erro: "gravar_resolucao_falhou:57014",
    });
    const formato = banco({ gravar: { data: null, error: { code: "22023" } } });
    expect(await rodar(formato, resolverFalso(sucesso()).resolver)).toEqual({
      ok: false,
      erro: "gravar_resolucao_falhou:22023",
      definitivo: true,
    });
  });

  it("desfecho desconhecido não conclui", async () => {
    const db = banco({ gravar: { data: "talvez", error: null } });
    expect(await rodar(db, resolverFalso(sucesso()).resolver)).toEqual({
      ok: false,
      erro: "gravar_desfecho_desconhecido",
    });
  });

  it("a lista depois de gravar que falha é retry (o gravado fica)", async () => {
    const db = banco({
      listas: [lista([ANUNCIO_A, ANUNCIO_B]), { data: null, error: { code: "57014" } }],
    });
    expect(await rodar(db, resolverFalso(sucesso()).resolver)).toEqual({
      ok: false,
      erro: "listar_anuncios_falhou:57014",
    });
    expect(db.chamadasDe("gravar_resolucao_de_anuncios_meta")).toHaveLength(1);
  });
});

describe("lerListaDeAnuncios", () => {
  it("aceita o contrato e guarda a nova tentativa como veio", () => {
    expect(
      lerListaDeAnuncios({
        codigo: "ok",
        ad_ids: [ANUNCIO_A],
        restantes: 3,
        proxima_tentativa_em: PROXIMA,
      }),
    ).toEqual({
      codigo: "ok",
      adIds: [ANUNCIO_A],
      restantes: 3,
      proximaTentativaEm: PROXIMA,
    });
    expect(lerListaDeAnuncios({ codigo: "config_mudou" })).toEqual({
      codigo: "config_mudou",
    });
  });

  it.each([
    null,
    "ok",
    { codigo: "outro" },
    { codigo: "ok", ad_ids: "111", restantes: 0 },
    { codigo: "ok", ad_ids: ["12a"], restantes: 0 },
    { codigo: "ok", ad_ids: [111], restantes: 0 },
    { codigo: "ok", ad_ids: [], restantes: -1 },
    { codigo: "ok", ad_ids: [], restantes: 1.5 },
    { codigo: "ok", ad_ids: [], restantes: 0, proxima_tentativa_em: "amanhã" },
  ])("recusa o que está fora do contrato (%j)", (data) => {
    expect(lerListaDeAnuncios(data)).toBeNull();
  });
});

describe("roteamento no worker", () => {
  it("o kind resolver_anuncio_meta cai no executor do resolvedor e conclui", async () => {
    // Sem token: o executor conclui sem rede, o que prova o caminho inteiro
    // (posse, roteamento, concluir_job) sem depender da Meta.
    const db = banco({ segredo: { data: null, error: null } });
    const desfecho = await executarJobComPosse(db.admin, WORKER, job());
    expect(desfecho).toBe("concluido");
    expect(db.chamadasDe("concluir_job")).toEqual([{ p_id: JOB_ID, p_worker: WORKER }]);
    expect(db.chamadasDe("falhar_job")).toHaveLength(0);
    expect(db.tabelas.map((t) => t.tabela)).toContain("meta_ads_account_secret");
  });

  it("a volta pedida pelo executor vai para reagendar_job com o motivo", async () => {
    const db = bancoFalso({
      tabelas: {
        meta_ads_account: () => ({ data: { ad_account_id: CONTA }, error: null }),
        meta_ads_account_secret: () => ({
          data: { insights_access_token: TOKEN },
          error: null,
        }),
        meta_gasto_leitura: () => ({ data: null, error: null }),
      },
      rpcs: {
        confirmar_posse_job: () => ({ data: true, error: null }),
        anuncios_meta_a_resolver: () => lista([], { proxima_tentativa_em: PROXIMA }),
        reagendar_job: () => ({ data: true, error: null }),
      },
    });
    expect(await executarJobComPosse(db.admin, WORKER, job())).toBe("reagendado");
    expect(db.chamadasDe("reagendar_job")).toEqual([
      { p_id: JOB_ID, p_worker: WORKER, p_run_at: PROXIMA, p_motivo: "nova_tentativa" },
    ]);
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
  });
});

describe("motor: a consulta dos anúncios no trilho do gasto", () => {
  function umJob(id: string, kind: Job["kind"], extra: Partial<Job> = {}): Job {
    return {
      id,
      clinic_id: CLINICA,
      kind,
      payload: {},
      attempts: 1,
      max_attempts: 5,
      whatsapp_account_id: null,
      ...extra,
    };
  }

  it("cada consulta é um grupo só dela, fora da raia da clínica", () => {
    const grupos = montarGruposDaPassagem({
      envios: [umJob("e1", "enviar_mensagem_ativa")],
      midias: [],
      integracoes: [umJob("i1", "enviar_conversao_meta")],
      gastos: [umJob("g1", "sincronizar_gasto_meta"), umJob("r1", "resolver_anuncio_meta")],
    });
    expect(grupos.map((g) => g.map((j) => j.id))).toEqual([["e1", "i1"], ["g1"], ["r1"]]);
  });

  it("o claim do gasto traz os dois tipos, 2 raias, e a consulta roda e conclui", async () => {
    const consulta = umJob(JOB_ID, "resolver_anuncio_meta");
    const db = bancoFalso({
      tabelas: {
        // Sem conta: o executor de verdade conclui sem rede.
        meta_ads_account: () => ({ data: null, error: null }),
      },
      rpcs: {
        claim_jobs_por_clinica: (args) => {
          const kinds = args.p_kinds as string[];
          return {
            data: kinds.includes("resolver_anuncio_meta") ? [consulta] : [],
            error: null,
          };
        },
        confirmar_posse_job: () => ({ data: true, error: null }),
      },
    });
    const resultado = await executarPassagemDoMotor(db.admin, {
      executorId: WORKER,
    });
    const claims = db.chamadasDe("claim_jobs_por_clinica");
    expect(claims).toHaveLength(4);
    expect(claims[3]).toMatchObject({
      p_kinds: ["sincronizar_gasto_meta", "resolver_anuncio_meta"],
      p_max_clinicas: 2,
      p_incluir_teste: false,
    });
    // Nenhum outro trilho reivindica o tipo.
    expect(
      claims.slice(0, 3).some((c) => (c.p_kinds as string[]).includes("resolver_anuncio_meta")),
    ).toBe(false);
    // Coube no orcamento (20 s estimados, comeca perto de 0) e concluiu.
    expect(resultado).toMatchObject({ reivindicados: 1, concluidos: 1, nao_couberam: 0 });
    expect(db.chamadasDe("reagendar_job")).toHaveLength(0);
    expect(db.chamadasDe("concluir_job")).toEqual([{ p_id: JOB_ID, p_worker: WORKER }]);
  });
});

describe("fim do sincronizar_gasto_meta: pede a consulta dos anúncios", () => {
  const CONTA_OK = {
    id: CONTA,
    name: "Clínica Sol",
    currency: "BRL",
    timezone_name: "America/Sao_Paulo",
    account_status: 1,
  };

  function json(corpo: unknown, status = 200) {
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function metaDoGasto(conta: () => Response = () => json(CONTA_OK)) {
    return (async (entrada: unknown) => {
      const url = new URL(String(entrada));
      if (!url.pathname.endsWith("/insights")) {
        return conta();
      }
      if (url.searchParams.get("level") === "ad") {
        return json({
          data: [
            {
              ad_id: "111",
              adset_id: "238500000000000001",
              campaign_id: "6720000000000001",
              campaign_name: "Botox outubro",
              spend: "5.00",
              account_currency: "BRL",
              date_start: "2026-10-03",
              date_stop: "2026-10-03",
            },
          ],
        });
      }
      return json({
        data: [
          { spend: "5.00", account_currency: "BRL", date_start: "2026-10-03", date_stop: "2026-10-03" },
        ],
      });
    }) as typeof fetch;
  }

  function bancoDoGasto(o: { regravar?: Resposta; enfileirar?: Resposta } = {}) {
    return bancoFalso({
      tabelas: {
        meta_ads_account: () => ({ data: { ad_account_id: CONTA }, error: null }),
        meta_ads_account_secret: () => ({
          data: { insights_access_token: TOKEN },
          error: null,
        }),
        meta_gasto_leitura: () => ({ data: null, error: null }),
      },
      rpcs: {
        regravar_gasto_meta: () => o.regravar ?? { data: "ok", error: null },
        registrar_falha_do_gasto_meta: () => ({ data: "ok", error: null }),
        enfileirar_resolucao_de_anuncios_meta: () =>
          o.enfileirar ?? { data: { codigo: "enfileirado" }, error: null },
      },
    });
  }

  function rodarGasto(db: ReturnType<typeof bancoDoGasto>, fetchFn: typeof fetch) {
    return executarSincronizacaoDeGastoMeta(
      db.admin,
      job({ kind: "sincronizar_gasto_meta", payload: { origem: "diario" } }),
      WORKER,
      { fetchFn, agora: () => AGORA, dormir: semEspera },
    );
  }

  it("leitura que deu certo pede com a origem 'gasto', depois de regravar", async () => {
    const db = bancoDoGasto();
    expect(await rodarGasto(db, metaDoGasto())).toEqual({ ok: true });
    expect(db.chamadasDe("enfileirar_resolucao_de_anuncios_meta")).toEqual([
      { p_clinic_id: CLINICA, p_origem: "gasto" },
    ]);
    const nomes = db.rpcs.map((r) => r.nome);
    expect(nomes.indexOf("enfileirar_resolucao_de_anuncios_meta")).toBeGreaterThan(
      nomes.indexOf("regravar_gasto_meta"),
    );
    expect(tudoQueSaiu(db)).not.toContain(TOKEN);
  });

  it("pedido que falha não derruba a leitura gravada e deixa só o código no log", async () => {
    const db = bancoDoGasto({ enfileirar: { data: null, error: { code: "PGRST202" } } });
    expect(await rodarGasto(db, metaDoGasto())).toEqual({ ok: true });
    expect(log.warn).toHaveBeenCalledWith("resolver_anuncio_meta_nao_pedido", {
      clinic_id: CLINICA,
      job_id: JOB_ID,
      error_code: "PGRST202",
    });
  });

  it("leitura que falha ou que não grava não pede a consulta", async () => {
    const recusada = bancoDoGasto();
    await rodarGasto(
      recusada,
      metaDoGasto(() =>
        json({ error: { message: "x", code: 190, type: "OAuthException" } }, 401),
      ),
    );
    expect(recusada.chamadasDe("enfileirar_resolucao_de_anuncios_meta")).toHaveLength(0);

    const semGravar = bancoDoGasto({ regravar: { data: "config_mudou", error: null } });
    await rodarGasto(semGravar, metaDoGasto());
    expect(semGravar.chamadasDe("enfileirar_resolucao_de_anuncios_meta")).toHaveLength(0);
  });
});
