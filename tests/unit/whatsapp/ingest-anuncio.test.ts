import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AnuncioDeOrigem,
  InboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import {
  argumentosDosDetalhesDoAnuncio,
  chavesDoAnuncioParaLog,
  horarioDaMensagemDoAnuncio,
  idsDoAnuncio,
  ingerirMensagemRecebida,
  origemDoAnuncio,
} from "@/lib/integrations/whatsapp/ingest";

// Origem real do lead de anuncio na ingestao (frente D, 04/10/2026), com um
// banco falso que aplica os filtros do update e imita as duas regras do banco
// que importam aqui: o CHECK contact_origem_de_anuncio_coerente (23514) e o
// gatilho impedir_reatribuicao_de_origem (origem gravada nunca muda). O teste
// contra o banco real esta em tests/integration/funil-e-atribuicao.test.ts.

vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: vi.fn(async () => undefined),
}));

type Linha = Record<string, unknown>;
type ErroFalso = { code: string; message: string };
type Resultado = { data: unknown; error: ErroFalso | null };
type Filtro = { coluna: string; valor: unknown };

const CLINICA = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const NUMERO = "33333333-3333-4333-8333-333333333333";

const COLUNAS_DA_ORIGEM = [
  "source_channel",
  "source_origin",
  "source_medium",
  "source_campaign",
  "source_method",
  "source_captured_at",
] as const;

class BancoFalso {
  contato: Linha = {};
  campanhas: Linha[] = [];
  ingestao: Linha = {};
  respostaDoEnfileirar: Resultado = {
    data: { codigo: "sem_configuracao" },
    error: null,
  };
  /** Erro forcado para o PROXIMO update de contato que gravar a origem. */
  erroNaOrigem: ErroFalso | null = null;
  /** Resposta de registrar_anuncio_do_whatsapp (os detalhes do anuncio). */
  respostaDosDetalhes: Resultado = { data: "inserido", error: null };
  /** A RPC dos detalhes lanca (rede caiu no meio). */
  detalhesLancam = false;
  readonly rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  readonly updates: { patch: Linha; filtros: Filtro[]; select: boolean }[] = [];

  constructor() {
    this.limpar();
  }

  limpar(): void {
    this.contato = {
      id: CONTATO,
      clinic_id: CLINICA,
      ctwa_clid: null,
      source_ad_id: null,
      source_adset_id: null,
      source_campaign_id: null,
      source_channel: null,
      source_origin: null,
      source_medium: null,
      source_campaign: null,
      source_method: null,
      source_captured_at: null,
    };
    this.campanhas = [];
    this.ingestao = {
      inserted: true,
      contact_id: CONTATO,
      contact_created: true,
      conversation_id: "conversa-1",
      message_id: "mensagem-1",
      whatsapp_account_id: NUMERO,
    };
    this.respostaDoEnfileirar = {
      data: { codigo: "sem_configuracao" },
      error: null,
    };
    this.erroNaOrigem = null;
    this.respostaDosDetalhes = { data: "inserido", error: null };
    this.detalhesLancam = false;
    this.rpcs.length = 0;
    this.updates.length = 0;
  }

  cliente(): SupabaseClient {
    const cliente = {
      from: (tabela: string) => new ConsultaFalsa(this, tabela),
      rpc: async (
        nome: string,
        args: Record<string, unknown>,
      ): Promise<Resultado> => {
        this.rpcs.push({ nome, args });
        if (nome === "ingest_inbound_message") {
          return { data: this.ingestao, error: null };
        }
        if (nome === "enfileirar_resolucao_de_anuncios_meta") {
          return this.respostaDoEnfileirar;
        }
        if (nome === "registrar_anuncio_do_whatsapp") {
          if (this.detalhesLancam) {
            throw new Error("fetch failed");
          }
          return this.respostaDosDetalhes;
        }
        return { data: null, error: null };
      },
    };
    return cliente as unknown as SupabaseClient;
  }

  /** Aplica um update no contato com as regras do banco real. */
  atualizarContato(
    patch: Linha,
    filtros: Filtro[],
  ): Resultado & {
    casou: boolean;
  } {
    const casa = filtros.every(
      (filtro) => this.contato[filtro.coluna] === filtro.valor,
    );
    if (!casa) {
      return { data: [], error: null, casou: false };
    }
    if (this.erroNaOrigem && "source_method" in patch) {
      const erro = this.erroNaOrigem;
      this.erroNaOrigem = null;
      return { data: null, error: erro, casou: false };
    }
    const novo = { ...this.contato, ...patch };
    // impedir_reatribuicao_de_origem
    if (
      this.contato.source_channel !== null &&
      COLUNAS_DA_ORIGEM.some((coluna) => novo[coluna] !== this.contato[coluna])
    ) {
      return {
        data: null,
        error: {
          code: "P0001",
          message:
            "A origem do contato é capturada uma vez e preservada para sempre.",
        },
        casou: false,
      };
    }
    // contact_origem_de_anuncio_coerente
    if (
      novo.source_method === "anuncio_ctwa" &&
      !(
        novo.source_channel === "trafego_pago" &&
        novo.source_origin === "Meta" &&
        (novo.source_medium === null ||
          novo.source_medium === "Facebook" ||
          novo.source_medium === "Instagram") &&
        novo.source_campaign === null
      )
    ) {
      return {
        data: null,
        error: {
          code: "23514",
          message: "contact_origem_de_anuncio_coerente",
        },
        casou: false,
      };
    }
    this.contato = novo;
    return { data: [{ id: this.contato.id }], error: null, casou: true };
  }
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  private readonly filtros: Filtro[] = [];
  private patch: Linha | null = null;
  private comSelect = false;

  constructor(
    private readonly banco: BancoFalso,
    private readonly tabela: string,
  ) {}

  select(): this {
    if (this.patch) {
      this.comSelect = true;
    }
    return this;
  }

  update(patch: Linha): this {
    this.patch = patch;
    return this;
  }

  eq(coluna: string, valor: unknown): this {
    this.filtros.push({ coluna, valor });
    return this;
  }

  is(coluna: string, valor: null): this {
    this.filtros.push({ coluna, valor });
    return this;
  }

  order(): this {
    return this;
  }

  private executar(): Resultado {
    if (this.tabela === "campaign_link") {
      return { data: this.banco.campanhas, error: null };
    }
    if (this.tabela === "contact" && this.patch) {
      this.banco.updates.push({
        patch: this.patch,
        filtros: [...this.filtros],
        select: this.comSelect,
      });
      const { data, error } = this.banco.atualizarContato(
        this.patch,
        this.filtros,
      );
      return { data: this.comSelect ? data : null, error };
    }
    throw new Error(`consulta inesperada em ${this.tabela}`);
  }

  then<T1 = Resultado, T2 = never>(
    aoResolver?: ((valor: Resultado) => T1 | PromiseLike<T1>) | null,
    aoFalhar?: ((motivo: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.executar())
      .then(aoResolver, aoFalhar);
  }
}

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

function anuncio(parcial: Partial<AnuncioDeOrigem> = {}): AnuncioDeOrigem {
  return {
    ctwaClid: "Af-CLIQUE-PRIMEIRO",
    adId: "120240624148610289",
    adsetId: null,
    campaignId: null,
    sourceUrl: "https://fb.me/abcXYZ",
    titulo: null,
    descricao: null,
    plataforma: null,
    tipo: "ad",
    chavesVistas: {
      anuncio: ["ctwaClid", "sourceApp", "sourceID", "sourceType"],
      contexto: ["entryPointConversionApp", "externalAdReply"],
    },
    ...parcial,
  };
}

function mensagem(
  body: string | null,
  comAnuncio: AnuncioDeOrigem | null,
  waMessageId = "wa-1",
  enviadaEm?: string | null,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone: "+5584970000001",
    name: "Paciente",
    waMessageId,
    contentType: "texto",
    body,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    ...(enviadaEm === undefined ? {} : { enviadaEm }),
    anuncio: comAnuncio,
    instanceToken: null,
  };
}

const banco = new BancoFalso();
let linhasDeLog: string[] = [];

beforeEach(() => {
  banco.limpar();
  linhasDeLog = [];
  const capturar = (pedaco: string | Uint8Array): boolean => {
    linhasDeLog.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function eventosDeLog(): Linha[] {
  return linhasDeLog.map((linha) => JSON.parse(linha) as Linha);
}

function enfileiramentos() {
  return banco.rpcs.filter(
    (rpc) => rpc.nome === "enfileirar_resolucao_de_anuncios_meta",
  );
}

async function ingerir(evento: MensagemRecebida) {
  return ingerirMensagemRecebida(banco.cliente(), CLINICA, NUMERO, evento);
}

describe("origemDoAnuncio (o que vai para o contato)", () => {
  const agora = "2026-10-04T12:00:00.000Z";

  it("anúncio pago: Tráfego pago, Meta, meio = plataforma, sem source_campaign", () => {
    const origem = origemDoAnuncio(anuncio({ plataforma: "Instagram" }), agora);
    expect(origem).toEqual({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_captured_at: agora,
    });
    expect(origem).not.toHaveProperty("source_campaign");
  });

  it("sem plataforma o meio fica nulo", () => {
    expect(origemDoAnuncio(anuncio(), agora)?.source_medium).toBeNull();
  });

  it("post nunca vira origem, nem com clique", () => {
    expect(origemDoAnuncio(anuncio({ tipo: "post" }), agora)).toBeNull();
  });

  it("sem tipo: só com o id do clique", () => {
    expect(origemDoAnuncio(anuncio({ tipo: null }), agora)).not.toBeNull();
    expect(
      origemDoAnuncio(anuncio({ tipo: null, ctwaClid: null }), agora),
    ).toBeNull();
  });

  it("tipo ad sem clique ainda é anúncio pago", () => {
    expect(
      origemDoAnuncio(anuncio({ ctwaClid: null }), agora)?.source_method,
    ).toBe("anuncio_ctwa");
  });

  it("idsDoAnuncio: só os que vieram; post não grava id nenhum", () => {
    expect(idsDoAnuncio(anuncio({ adsetId: "238500000000000001" }))).toEqual({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
      source_adset_id: "238500000000000001",
    });
    expect(idsDoAnuncio(anuncio({ tipo: "post" }))).toBeNull();
    expect(
      idsDoAnuncio(anuncio({ ctwaClid: null, adId: null, tipo: null })),
    ).toBeNull();
  });

  it("idsDoAnuncio: o id do anúncio vai aparado pela regra do JavaScript (espaço Unicode)", () => {
    expect(
      idsDoAnuncio(anuncio({ adId: "\u{a0}120240624148610289\t" })),
    ).toEqual({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
    });
    // Só espaço: nenhum id de anúncio.
    expect(
      idsDoAnuncio(anuncio({ ctwaClid: null, adId: "\u{3000} \u{feff}" })),
    ).toBeNull();
  });

  it("chaves para log: só nomes, com contagem", () => {
    expect(chavesDoAnuncioParaLog(anuncio())).toEqual({
      path: "anuncio=ctwaClid,sourceApp,sourceID,sourceType;contexto=entryPointConversionApp,externalAdReply",
      count: 6,
    });
  });
});

describe("ingestão de mensagem de anúncio", () => {
  it("anúncio novo grava ids e origem (source_campaign nulo) e pede a campanha à Meta", async () => {
    const { data, error } = await ingerir(
      mensagem("Olá! Quero saber mais", anuncio({ plataforma: "Instagram" })),
    );
    expect(error).toBeNull();
    expect(data?.contact_id).toBe(CONTATO);

    expect(banco.contato).toMatchObject({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
    expect(banco.contato.source_captured_at).toEqual(expect.any(String));

    // Ids: primeiro clique vence, com select para saber se foi o primeiro.
    const [ids, origem] = banco.updates;
    expect(ids?.select).toBe(true);
    expect(ids?.filtros).toEqual([
      { coluna: "clinic_id", valor: CLINICA },
      { coluna: "id", valor: CONTATO },
      { coluna: "ctwa_clid", valor: null },
      { coluna: "source_ad_id", valor: null },
    ]);
    // Origem: update separado, so em origem vazia.
    expect(origem?.patch).not.toHaveProperty("source_campaign");
    expect(origem?.filtros).toEqual([
      { coluna: "clinic_id", valor: CLINICA },
      { coluna: "id", valor: CONTATO },
      { coluna: "source_channel", valor: null },
      { coluna: "source_method", valor: null },
      { coluna: "source_campaign", valor: null },
    ]);

    expect(enfileiramentos()).toEqual([
      {
        nome: "enfileirar_resolucao_de_anuncios_meta",
        args: { p_clinic_id: CLINICA, p_origem: "ingestao" },
      },
    ]);
  });

  it("segundo anúncio não muda a origem nem os ids e não pede de novo", async () => {
    await ingerir(
      mensagem("primeiro", anuncio({ plataforma: "Instagram" }), "wa-1"),
    );
    const capturadaEm = banco.contato.source_captured_at;
    banco.ingestao = { ...banco.ingestao, contact_created: false };

    await ingerir(
      mensagem(
        "segundo",
        anuncio({
          ctwaClid: "Af-CLIQUE-SEGUNDO",
          adId: "999999999999999999",
          plataforma: "Facebook",
        }),
        "wa-2",
      ),
    );

    expect(banco.contato).toMatchObject({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_captured_at: capturadaEm,
    });
    expect(enfileiramentos()).toHaveLength(1);
    expect(
      eventosDeLog().filter((linha) => linha.evento === "anuncio_recebido"),
    ).toHaveLength(1);
    // Nenhum erro: o filtro de origem vazia evita bater no gatilho.
    expect(eventosDeLog().filter((linha) => linha.nivel === "error")).toEqual(
      [],
    );
  });

  it("origem manual se mantém e os ids continuam sendo gravados", async () => {
    banco.contato = {
      ...banco.contato,
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: "2026-09-01T10:00:00.000Z",
    };
    banco.ingestao = { ...banco.ingestao, contact_created: false };

    await ingerir(
      mensagem("vi o anúncio", anuncio({ plataforma: "Facebook" })),
    );

    expect(banco.contato).toMatchObject({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
      source_channel: "indicacao",
      source_method: "manual",
      source_origin: null,
      source_medium: null,
      source_captured_at: "2026-09-01T10:00:00.000Z",
    });
    // O anuncio ainda pede a campanha: a gaveta mostra a campanha da Meta
    // pelo source_ad_id mesmo com origem manual.
    expect(enfileiramentos()).toHaveLength(1);
  });

  it("contato importado com campanha em texto não ganha origem de anúncio (sem 23514)", async () => {
    banco.contato = {
      ...banco.contato,
      source_campaign: "Planilha de setembro",
      source_method: "importacao",
    };
    banco.ingestao = { ...banco.ingestao, contact_created: false };

    await ingerir(mensagem("oi", anuncio()));

    expect(banco.contato).toMatchObject({
      source_ad_id: "120240624148610289",
      source_channel: null,
      source_method: "importacao",
      source_campaign: "Planilha de setembro",
    });
    expect(eventosDeLog().filter((linha) => linha.nivel === "error")).toEqual(
      [],
    );
  });

  it("anúncio e código de campanha na mesma mensagem: vence o anúncio", async () => {
    banco.campanhas = [
      {
        id: "campanha-1",
        token: "C7K3F9",
        channel: "redes_sociais",
        origin: "Instagram orgânico",
        medium: null,
        campaign: "Botox Setembro",
        default_message: null,
        keywords: [],
      },
    ];

    await ingerir(
      mensagem("Quero agendar [#c7k3f9]", anuncio({ plataforma: "Instagram" })),
    );

    expect(banco.contato).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
  });

  it("sem anúncio, o código de campanha continua atribuindo como antes", async () => {
    banco.campanhas = [
      {
        id: "campanha-1",
        token: "C7K3F9",
        channel: "redes_sociais",
        origin: null,
        medium: null,
        campaign: "Botox Setembro",
        default_message: null,
        keywords: [],
      },
    ];

    await ingerir(mensagem("Quero agendar [#c7k3f9]", null));

    expect(banco.contato).toMatchObject({
      source_channel: "redes_sociais",
      source_method: "link_token",
      source_campaign: "Botox Setembro",
    });
    expect(enfileiramentos()).toEqual([]);
  });

  it("post não vira Tráfego pago e não grava id nenhum", async () => {
    await ingerir(
      mensagem(
        "vi a publicação",
        anuncio({ tipo: "post", adId: "1789000000000001" }),
      ),
    );

    expect(banco.updates).toEqual([]);
    expect(banco.contato).toMatchObject({
      ctwa_clid: null,
      source_ad_id: null,
      source_channel: null,
      source_method: null,
    });
    expect(enfileiramentos()).toEqual([]);
    const [diagnostico] = eventosDeLog().filter(
      (linha) => linha.evento === "anuncio_recebido",
    );
    expect(diagnostico).toMatchObject({ kind: "post" });
  });

  it("depois de um post, o primeiro anúncio de verdade ainda é o primeiro clique", async () => {
    await ingerir(mensagem("post", anuncio({ tipo: "post" }), "wa-1"));
    banco.ingestao = { ...banco.ingestao, contact_created: false };
    await ingerir(mensagem("anúncio", anuncio({ tipo: "ad" }), "wa-2"));

    expect(banco.contato).toMatchObject({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: "120240624148610289",
      source_channel: "trafego_pago",
    });
    expect(enfileiramentos()).toHaveLength(1);
  });

  it("id de anúncio sem clique e sem tipo grava o id, mas não a origem", async () => {
    await ingerir(mensagem("oi", anuncio({ ctwaClid: null, tipo: null })));

    expect(banco.contato).toMatchObject({
      source_ad_id: "120240624148610289",
      source_channel: null,
      source_method: null,
    });
    expect(enfileiramentos()).toHaveLength(1);
  });

  it("id sem clique e sem tipo, depois anúncio real de outra plataforma: origem do clique real, ids do primeiro (L8 da Fase 4)", async () => {
    // Comportamento ATUAL, documentado de proposito (pendente de decisao do
    // dono: tratar o id sem clique e sem tipo como post?). As colunas
    // imutaveis saem todas do clique que provou o anuncio; os ids continuam
    // os do primeiro referral pela regra L8, e esses o sistema ainda regrava.
    await ingerir(
      mensagem(
        "primeira",
        anuncio({ ctwaClid: null, adId: "1789000000000001", tipo: null }),
        "wa-1",
      ),
    );
    expect(banco.contato.source_channel).toBeNull();

    banco.ingestao = { ...banco.ingestao, contact_created: false };
    await ingerir(
      mensagem(
        "segunda",
        anuncio({
          ctwaClid: "Af-REAL",
          adId: "120240624148610289",
          tipo: "ad",
          plataforma: "Instagram",
        }),
        "wa-2",
      ),
    );

    expect(banco.contato).toMatchObject({
      ctwa_clid: null,
      source_ad_id: "1789000000000001",
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
    expect(banco.contato.source_captured_at).not.toBeNull();
    // So o primeiro referral (o que gravou o id) pediu a resolucao.
    expect(enfileiramentos()).toHaveLength(1);
  });

  it("só o clique, sem id de anúncio: grava origem e não pede resolução", async () => {
    await ingerir(mensagem("oi", anuncio({ adId: null, tipo: null })));

    expect(banco.contato).toMatchObject({
      ctwa_clid: "Af-CLIQUE-PRIMEIRO",
      source_ad_id: null,
      source_channel: "trafego_pago",
    });
    expect(enfileiramentos()).toEqual([]);
    expect(
      eventosDeLog().filter((linha) => linha.evento === "anuncio_recebido"),
    ).toHaveLength(1);
  });

  it("origem que falhou uma vez é completada pelo anúncio seguinte", async () => {
    banco.erroNaOrigem = { code: "57014", message: "statement timeout" };
    await ingerir(mensagem("primeiro", anuncio(), "wa-1"));
    expect(banco.contato.source_channel).toBeNull();
    expect(banco.contato.source_ad_id).toBe("120240624148610289");
    const [falha] = eventosDeLog().filter(
      (linha) => linha.evento === "origem_do_anuncio_falhou",
    );
    expect(falha).toMatchObject({ error_code: "57014", contact_id: CONTATO });

    banco.ingestao = { ...banco.ingestao, contact_created: false };
    await ingerir(
      mensagem("segundo", anuncio({ plataforma: "Facebook" }), "wa-2"),
    );
    expect(banco.contato).toMatchObject({
      source_channel: "trafego_pago",
      source_medium: "Facebook",
      source_method: "anuncio_ctwa",
    });
    // O pedido a Meta foi so no primeiro clique.
    expect(enfileiramentos()).toHaveLength(1);
  });

  it("falha ao pedir a campanha não derruba a ingestão", async () => {
    banco.respostaDoEnfileirar = {
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    };
    const { data, error } = await ingerir(mensagem("oi", anuncio()));
    expect(error).toBeNull();
    expect(data?.message_id).toBe("mensagem-1");
    expect(banco.contato.source_channel).toBe("trafego_pago");
    const [falha] = eventosDeLog().filter(
      (linha) => linha.evento === "resolucao_de_anuncio_nao_pedida",
    );
    expect(falha).toMatchObject({ clinic_id: CLINICA, error_code: "PGRST202" });
  });

  it("reentrega do webhook não pede a campanha de novo nem repete o diagnóstico", async () => {
    await ingerir(mensagem("oi", anuncio(), "wa-1"));
    banco.ingestao = {
      ...banco.ingestao,
      inserted: false,
      contact_created: false,
    };
    await ingerir(mensagem("oi", anuncio(), "wa-1"));
    expect(enfileiramentos()).toHaveLength(1);
    expect(
      eventosDeLog().filter((linha) => linha.evento === "anuncio_recebido"),
    ).toHaveLength(1);
  });

  it("o log do anúncio leva só nomes de chave e códigos, nunca valores", async () => {
    await ingerir(
      mensagem("Olá, meu nome é Maria", anuncio({ plataforma: "Instagram" })),
    );
    const diagnostico = eventosDeLog().find(
      (linha) => linha.evento === "anuncio_recebido",
    );
    expect(diagnostico).toMatchObject({
      nivel: "info",
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: NUMERO,
      kind: "ad",
      status: "com_plataforma",
      path: "anuncio=ctwaClid,sourceApp,sourceID,sourceType;contexto=entryPointConversionApp,externalAdReply",
      count: 6,
    });
    const pedido = eventosDeLog().find(
      (linha) => linha.evento === "resolucao_de_anuncio_pedida",
    );
    expect(pedido).toMatchObject({ status: "sem_configuracao" });

    const tudo = linhasDeLog.join("");
    for (const valor of [
      "Af-CLIQUE-PRIMEIRO",
      "120240624148610289",
      "fb.me",
      "Maria",
      "+5584970000001",
      "Instagram",
    ]) {
      expect(tudo).not.toContain(valor);
    }
  });
});

// Detalhes do anuncio (pedido do dono em 20/10/2026): titulo, descricao e
// link vao para anuncio_do_whatsapp pela RPC registrar_anuncio_do_whatsapp,
// em TODA mensagem de anuncio com detalhe (nova ou reentrega; a RPC e
// idempotente). Falha nunca derruba a ingestao, e o texto nunca vai para log.
describe("detalhes do anúncio na ingestão", () => {
  const TITULO = "Limpeza de pele com 30% de desconto";
  const DESCRICAO = "Agende sua avaliação.\nVagas limitadas para outubro.";
  const LINK = "https://fb.me/abcXYZ";

  function comDetalhes(
    parcial: Partial<AnuncioDeOrigem> = {},
  ): AnuncioDeOrigem {
    return anuncio({
      titulo: TITULO,
      descricao: DESCRICAO,
      sourceUrl: LINK,
      plataforma: "Instagram",
      ...parcial,
    });
  }

  function chamadasDosDetalhes() {
    return banco.rpcs.filter(
      (rpc) => rpc.nome === "registrar_anuncio_do_whatsapp",
    );
  }

  const ENVIADA_EM = "2026-10-20T12:00:00.000Z";

  it("anúncio com título, descrição e link chama a RPC com os argumentos certos", async () => {
    const { data, error } = await ingerir(
      mensagem("Olá!", comDetalhes(), "wa-1", ENVIADA_EM),
    );
    expect(error).toBeNull();
    expect(data?.message_id).toBe("mensagem-1");
    expect(chamadasDosDetalhes()).toEqual([
      {
        nome: "registrar_anuncio_do_whatsapp",
        args: {
          p_clinic_id: CLINICA,
          p_ad_id: "120240624148610289",
          p_titulo: TITULO,
          p_descricao: DESCRICAO,
          p_link: LINK,
          p_plataforma: "Instagram",
          p_tipo: "ad",
          p_visto_em: ENVIADA_EM,
        },
      },
    ]);
    const gravados = eventosDeLog().filter(
      (linha) => linha.evento === "anuncio_detalhes_gravados",
    );
    expect(gravados).toEqual([
      expect.objectContaining({
        nivel: "info",
        clinic_id: CLINICA,
        whatsapp_account_id: NUMERO,
        contact_id: CONTATO,
        status: "inserido",
      }),
    ]);
    // Os ids e a origem continuam sendo gravados como antes.
    expect(banco.contato).toMatchObject({
      source_ad_id: "120240624148610289",
      source_method: "anuncio_ctwa",
    });
  });

  it("campo que não veio não vai na chamada (a RPC nunca apaga o guardado)", async () => {
    await ingerir(
      mensagem(
        "oi",
        comDetalhes({
          descricao: null,
          sourceUrl: null,
          plataforma: null,
          tipo: null,
        }),
        "wa-1",
        ENVIADA_EM,
      ),
    );
    expect(chamadasDosDetalhes()[0]?.args).toEqual({
      p_clinic_id: CLINICA,
      p_ad_id: "120240624148610289",
      p_titulo: TITULO,
      p_visto_em: ENVIADA_EM,
    });
  });

  it("o horário da mensagem vai junto: o envio no aparelho; sem ele, a chegada", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-20T15:30:00.000Z"));
      await ingerir(mensagem("oi", comDetalhes(), "wa-1", ENVIADA_EM));
      await ingerir(mensagem("oi", comDetalhes(), "wa-2"));
      await ingerir(mensagem("oi", comDetalhes(), "wa-3", null));
    } finally {
      vi.useRealTimers();
    }
    expect(chamadasDosDetalhes().map((rpc) => rpc.args.p_visto_em)).toEqual([
      ENVIADA_EM,
      "2026-10-20T15:30:00.000Z",
      "2026-10-20T15:30:00.000Z",
    ]);
  });

  it("a reentrega atrasada manda o horário do envio, nunca o da nova chegada", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-20T12:00:05.000Z"));
      await ingerir(mensagem("oi", comDetalhes(), "wa-1", ENVIADA_EM));
      banco.ingestao = {
        ...banco.ingestao,
        inserted: false,
        contact_created: false,
      };
      // Uma hora depois, o provedor entrega a mesma mensagem de novo.
      vi.setSystemTime(new Date("2026-10-20T13:00:05.000Z"));
      await ingerir(mensagem("oi", comDetalhes(), "wa-1", ENVIADA_EM));
    } finally {
      vi.useRealTimers();
    }
    expect(chamadasDosDetalhes().map((rpc) => rpc.args.p_visto_em)).toEqual([
      ENVIADA_EM,
      ENVIADA_EM,
    ]);
  });

  it("o id do anúncio com espaço Unicode nas pontas vai aparado para o contato e para a RPC", async () => {
    await ingerir(
      mensagem(
        "oi",
        comDetalhes({ adId: "\u{a0}120240624148610289\u{2003}" }),
        "wa-1",
        ENVIADA_EM,
      ),
    );
    expect(banco.contato.source_ad_id).toBe("120240624148610289");
    expect(chamadasDosDetalhes()[0]?.args.p_ad_id).toBe("120240624148610289");
  });

  it("reentrega do webhook chama de novo (idempotente) e não repete o log", async () => {
    await ingerir(mensagem("oi", comDetalhes(), "wa-1", ENVIADA_EM));
    banco.ingestao = {
      ...banco.ingestao,
      inserted: false,
      contact_created: false,
    };
    banco.respostaDosDetalhes = { data: "sem_mudanca", error: null };
    await ingerir(mensagem("oi", comDetalhes(), "wa-1", ENVIADA_EM));
    expect(chamadasDosDetalhes()).toHaveLength(2);
    expect(
      eventosDeLog().filter(
        (linha) => linha.evento === "anuncio_detalhes_gravados",
      ),
    ).toHaveLength(1);
    expect(eventosDeLog().filter((linha) => linha.nivel === "error")).toEqual(
      [],
    );
  });

  it("texto novo do mesmo anúncio: a RPC atualiza e o log diz atualizado", async () => {
    await ingerir(mensagem("oi", comDetalhes(), "wa-1"));
    banco.ingestao = { ...banco.ingestao, contact_created: false };
    banco.respostaDosDetalhes = { data: "atualizado", error: null };
    await ingerir(
      mensagem(
        "oi de novo",
        comDetalhes({ titulo: "Texto novo do anúncio" }),
        "wa-2",
      ),
    );
    expect(chamadasDosDetalhes()[1]?.args).toMatchObject({
      p_titulo: "Texto novo do anúncio",
    });
    expect(
      eventosDeLog()
        .filter((linha) => linha.evento === "anuncio_detalhes_gravados")
        .map((linha) => linha.status),
    ).toEqual(["inserido", "atualizado"]);
  });

  it("só com o código do anúncio (sem título, descrição e link) não chama", async () => {
    await ingerir(mensagem("oi", anuncio({ sourceUrl: null })));
    expect(chamadasDosDetalhes()).toEqual([]);
    expect(banco.contato.source_ad_id).toBe("120240624148610289");
  });

  it("post não grava detalhe (não é anúncio pago)", async () => {
    await ingerir(mensagem("oi", comDetalhes({ tipo: "post" })));
    expect(chamadasDosDetalhes()).toEqual([]);
  });

  it("id do anúncio fora do formato não chama", async () => {
    await ingerir(mensagem("oi", comDetalhes({ adId: "abc-123" })));
    await ingerir(mensagem("oi", comDetalhes({ adId: null })));
    expect(chamadasDosDetalhes()).toEqual([]);
  });

  it("falha da RPC vira log só com códigos e a ingestão segue", async () => {
    banco.respostaDosDetalhes = {
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    };
    const { data, error } = await ingerir(mensagem("oi", comDetalhes()));
    expect(error).toBeNull();
    expect(data?.message_id).toBe("mensagem-1");
    expect(banco.contato.source_method).toBe("anuncio_ctwa");
    const [falha] = eventosDeLog().filter(
      (linha) => linha.evento === "anuncio_detalhes_falhou",
    );
    expect(falha).toEqual(
      expect.objectContaining({
        nivel: "error",
        clinic_id: CLINICA,
        contact_id: CONTATO,
        error_code: "PGRST202",
      }),
    );
  });

  it("exceção na chamada (rede) também não derruba a ingestão nem a captura", async () => {
    banco.detalhesLancam = true;
    const { data, error } = await ingerir(mensagem("oi", comDetalhes()));
    expect(error).toBeNull();
    expect(data?.message_id).toBe("mensagem-1");
    expect(banco.contato).toMatchObject({
      source_ad_id: "120240624148610289",
      source_channel: "trafego_pago",
    });
    expect(
      eventosDeLog().filter(
        (linha) => linha.evento === "anuncio_detalhes_falhou",
      ),
    ).toHaveLength(1);
    expect(
      eventosDeLog().filter((linha) => linha.evento === "captura_ctwa_falhou"),
    ).toEqual([]);
  });

  it("resposta fora do contrato vira log de resposta inesperada", async () => {
    banco.respostaDosDetalhes = { data: { ok: true }, error: null };
    await ingerir(mensagem("oi", comDetalhes()));
    expect(
      eventosDeLog().filter(
        (linha) => linha.evento === "anuncio_detalhes_resposta_inesperada",
      ),
    ).toHaveLength(1);
  });

  it("o log nunca leva o título, a descrição nem o link", async () => {
    await ingerir(mensagem("Olá, meu nome é Maria", comDetalhes()));
    banco.respostaDosDetalhes = {
      data: null,
      error: { code: "23514", message: `valor ${TITULO} recusado` },
    };
    await ingerir(mensagem("de novo", comDetalhes(), "wa-2"));
    const tudo = linhasDeLog.join("");
    for (const valor of [
      "Limpeza de pele",
      "Agende sua",
      "Vagas limitadas",
      "fb.me",
      "abcXYZ",
      "120240624148610289",
      "Maria",
      "recusado",
    ]) {
      expect(tudo).not.toContain(valor);
    }
  });
});

describe("argumentosDosDetalhesDoAnuncio", () => {
  const VISTO_EM = "2026-10-20T12:00:00.000Z";

  it("só o que veio, com o id do anúncio aparado e o horário da mensagem", () => {
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({
          adId: " 120240624148610289 ",
          titulo: "Título",
          sourceUrl: null,
        }),
        VISTO_EM,
      ),
    ).toEqual({
      p_clinic_id: CLINICA,
      p_ad_id: "120240624148610289",
      p_titulo: "Título",
      p_tipo: "ad",
      p_visto_em: VISTO_EM,
    });
  });

  it("link de redirecionador, grupo ou conversa não vai (só endereço do anúncio)", () => {
    for (const sourceUrl of [
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://chat.whatsapp.com/ConviteDeGrupo",
      "https://wa.me/5584999990000?text=Pague",
    ]) {
      expect(
        argumentosDosDetalhesDoAnuncio(
          CLINICA,
          anuncio({ titulo: "Título", sourceUrl }),
          VISTO_EM,
        ),
      ).not.toHaveProperty("p_link");
    }
  });

  it("evento montado à mão é saneado de novo: nada que o banco recusaria, nada fora da Meta", () => {
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({
          titulo: "  Título\ncom quebra  ",
          descricao: "Linha 1\r\nLinha 2\t!",
          sourceUrl: "https://golpe.example.com/fb.me",
        }),
        VISTO_EM,
      ),
    ).toEqual({
      p_clinic_id: CLINICA,
      p_ad_id: "120240624148610289",
      p_titulo: "Título com quebra",
      p_descricao: "Linha 1\nLinha 2 !",
      p_tipo: "ad",
      p_visto_em: VISTO_EM,
    });
    // So o link fora dos enderecos do anuncio: nada para guardar.
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({ sourceUrl: "http://fb.me/sem-https" }),
        VISTO_EM,
      ),
    ).toBeNull();
  });

  it("sem detalhe, post ou id inválido: null", () => {
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({ sourceUrl: null }),
        VISTO_EM,
      ),
    ).toBeNull();
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({ tipo: "post", titulo: "x" }),
        VISTO_EM,
      ),
    ).toBeNull();
    expect(
      argumentosDosDetalhesDoAnuncio(
        CLINICA,
        anuncio({ adId: "1".repeat(33), titulo: "x" }),
        VISTO_EM,
      ),
    ).toBeNull();
  });
});

describe("horarioDaMensagemDoAnuncio", () => {
  const CHEGADA = "2026-10-20T15:30:00.000Z";

  it("o envio no aparelho quando é data ISO; senão, a chegada", () => {
    expect(
      horarioDaMensagemDoAnuncio("2026-10-20T12:00:00.000Z", CHEGADA),
    ).toBe("2026-10-20T12:00:00.000Z");
    expect(horarioDaMensagemDoAnuncio(null, CHEGADA)).toBe(CHEGADA);
    expect(horarioDaMensagemDoAnuncio(undefined, CHEGADA)).toBe(CHEGADA);
    expect(horarioDaMensagemDoAnuncio("ontem", CHEGADA)).toBe(CHEGADA);
    // Ano com 6 dígitos: o Postgres recusaria a chamada inteira.
    expect(
      horarioDaMensagemDoAnuncio(new Date(8.64e15).toISOString(), CHEGADA),
    ).toBe(CHEGADA);
  });
});
