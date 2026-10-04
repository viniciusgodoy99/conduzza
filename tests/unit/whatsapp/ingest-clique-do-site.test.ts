import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  atribuirOrigem,
  codigosDoCliqueDoSite,
  extrairToken,
  extrairTokens,
  MAX_CODIGOS_DE_CLIQUE,
  removerCodigosDoClique,
  type CampaignRule,
} from "@/lib/domain/attribution";
import type {
  AnuncioDeOrigem,
  InboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";

// Clique rastreado pelo site na ingestao (F1 do Google, frente de ingestao).
// Precedencia: anuncio da Meta, codigo fixo (campaign_link), clique do site,
// mensagem padrao, palavra-chave. O banco falso imita a RPC
// casar_clique_do_site da migration 20261005100000 (mesma clinica, nao
// casado, no prazo; origem so em contato sem origem e sem sinal da Meta) e o
// gatilho impedir_reatribuicao_de_origem. O teste contra o banco real esta em
// tests/integration/atribuicao-clique-do-site.test.ts.

vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: vi.fn(async () => undefined),
}));

type Linha = Record<string, unknown>;
type ErroFalso = { code: string; message: string };
type Resultado = { data: unknown; error: ErroFalso | null };
type Filtro = { coluna: string; valor: unknown };

type CliqueFalso = {
  clinic_id: string;
  codigo: string;
  vencido: boolean;
  contact_id: string | null;
  google_campaign_id: string | null;
  google_adgroup_id: string | null;
};

const CLINICA = "11111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const OUTRO_CONTATO = "55555555-5555-4555-8555-555555555555";
const NUMERO = "33333333-3333-4333-8333-333333333333";

const CODIGO = "K7Q2MX";
const CAMPANHA_GOOGLE = "21987654321";
const GRUPO_GOOGLE = "16543210987";

const FORMATO_DO_CODIGO = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

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
  erroNasCampanhas: ErroFalso | null = null;
  cliques: CliqueFalso[] = [];
  ingestao: Linha = {};
  /** Erro forcado em toda chamada de casar_clique_do_site. */
  erroNoCasar: ErroFalso | null = null;
  /** Resposta forcada (fora do contrato) de casar_clique_do_site. */
  respostaForcadaDoCasar: { valor: unknown } | null = null;
  readonly rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  readonly updates: { patch: Linha; filtros: Filtro[] }[] = [];

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
      source_google_campaign_id: null,
      source_google_adgroup_id: null,
    };
    this.campanhas = [];
    this.erroNasCampanhas = null;
    this.cliques = [];
    this.ingestao = {
      inserted: true,
      contact_id: CONTATO,
      contact_created: true,
      conversation_id: "conversa-1",
      message_id: "mensagem-1",
      whatsapp_account_id: NUMERO,
    };
    this.erroNoCasar = null;
    this.respostaForcadaDoCasar = null;
    this.rpcs.length = 0;
    this.updates.length = 0;
  }

  clique(parcial: Partial<CliqueFalso> = {}): CliqueFalso {
    const clique: CliqueFalso = {
      clinic_id: CLINICA,
      codigo: CODIGO,
      vencido: false,
      contact_id: null,
      google_campaign_id: CAMPANHA_GOOGLE,
      google_adgroup_id: GRUPO_GOOGLE,
      ...parcial,
    };
    this.cliques.push(clique);
    return clique;
  }

  chamadasDoCasar(): Record<string, unknown>[] {
    return this.rpcs
      .filter((rpc) => rpc.nome === "casar_clique_do_site")
      .map((rpc) => rpc.args);
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
        if (nome === "casar_clique_do_site") {
          return this.casar(args);
        }
        if (nome === "enfileirar_resolucao_de_anuncios_meta") {
          return { data: { codigo: "sem_configuracao" }, error: null };
        }
        return { data: null, error: null };
      },
    };
    return cliente as unknown as SupabaseClient;
  }

  /** O corpo de casar_clique_do_site, na mesma ordem de decisao. */
  private casar(args: Record<string, unknown>): Resultado {
    if (this.erroNoCasar) {
      return { data: null, error: this.erroNoCasar };
    }
    if (this.respostaForcadaDoCasar) {
      return { data: this.respostaForcadaDoCasar.valor, error: null };
    }
    const codigo = String(args.p_codigo ?? "")
      .trim()
      .toUpperCase();
    if (!FORMATO_DO_CODIGO.test(codigo)) {
      return { data: "nao_achado", error: null };
    }
    if (
      this.contato.id !== args.p_contact_id ||
      this.contato.clinic_id !== args.p_clinic_id
    ) {
      return { data: "nao_achado", error: null };
    }
    const clique = this.cliques.find(
      (linha) =>
        linha.clinic_id === args.p_clinic_id && linha.codigo === codigo,
    );
    if (!clique) {
      return { data: "nao_achado", error: null };
    }
    if (clique.contact_id !== null) {
      return {
        data:
          clique.contact_id === args.p_contact_id ? "vinculado" : "nao_achado",
        error: null,
      };
    }
    if (clique.vencido) {
      return { data: "expirado", error: null };
    }
    clique.contact_id = String(args.p_contact_id);
    const semOrigem =
      this.contato.source_channel === null &&
      this.contato.source_method === null &&
      this.contato.source_campaign === null &&
      this.contato.ctwa_clid === null &&
      this.contato.source_ad_id === null &&
      this.contato.source_adset_id === null &&
      this.contato.source_campaign_id === null;
    if (!semOrigem) {
      return { data: "vinculado", error: null };
    }
    this.contato = {
      ...this.contato,
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_medium: null,
      source_campaign: null,
      source_method: "clique_site",
      source_captured_at: "2026-10-05T12:00:00.000Z",
      source_google_campaign_id: clique.google_campaign_id,
      source_google_adgroup_id: clique.google_adgroup_id,
    };
    return { data: "origem_gravada", error: null };
  }

  /** Update de contato com o gatilho impedir_reatribuicao_de_origem. */
  atualizarContato(patch: Linha, filtros: Filtro[]): Resultado {
    const casa = filtros.every(
      (filtro) => this.contato[filtro.coluna] === filtro.valor,
    );
    if (!casa) {
      return { data: [], error: null };
    }
    const novo = { ...this.contato, ...patch };
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
      };
    }
    this.contato = novo;
    return { data: [{ id: this.contato.id }], error: null };
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
      if (this.banco.erroNasCampanhas) {
        return { data: null, error: this.banco.erroNasCampanhas };
      }
      return { data: this.banco.campanhas, error: null };
    }
    if (this.tabela === "contact" && this.patch) {
      this.banco.updates.push({
        patch: this.patch,
        filtros: [...this.filtros],
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

function mensagem(
  body: string | null,
  anuncio: AnuncioDeOrigem | null = null,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone: "+5584970000001",
    name: "Paciente",
    waMessageId: "wa-1",
    contentType: "texto",
    body,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio,
    instanceToken: null,
  };
}

function anuncioDaMeta(): AnuncioDeOrigem {
  return {
    ctwaClid: "Af-CLIQUE-META",
    adId: "120240624148610289",
    adsetId: null,
    campaignId: null,
    sourceUrl: "https://fb.me/abcXYZ",
    plataforma: "Instagram",
    tipo: "ad",
    chavesVistas: { anuncio: ["ctwaClid"], contexto: [] },
  };
}

function campanhaFixa(parcial: Linha = {}): Linha {
  return {
    id: "campanha-1",
    token: "C7K3F9",
    channel: "redes_sociais",
    origin: "Instagram orgânico",
    medium: null,
    campaign: "Botox Outubro",
    default_message: null,
    keywords: [],
    ...parcial,
  };
}

function regra(parcial: Partial<CampaignRule> & { id: string }): CampaignRule {
  return {
    token: null,
    channel: "trafego_pago",
    origin: null,
    medium: null,
    campaign: null,
    defaultMessage: null,
    keywords: [],
    ...parcial,
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

function errosDeLog(): Linha[] {
  return eventosDeLog().filter((linha) => linha.nivel === "error");
}

async function ingerir(evento: MensagemRecebida) {
  return ingerirMensagemRecebida(banco.cliente(), CLINICA, NUMERO, evento);
}

describe("extrairTokens e codigosDoCliqueDoSite (decisao pura)", () => {
  it("extrairTokens: todos, em maiusculo, sem repetir, na ordem; o primeiro e o de extrairToken", () => {
    const corpo = "oi [#k7q2mx] e [#C7K3F9] de novo [#K7Q2MX]";
    expect(extrairTokens(corpo)).toEqual(["K7Q2MX", "C7K3F9"]);
    expect(extrairToken(corpo)).toBe("K7Q2MX");
    expect(extrairTokens("Quero agendar uma consulta")).toEqual([]);
  });

  it("sem regras, todo token é candidato, do último para o primeiro", () => {
    expect(codigosDoCliqueDoSite("Olá! [#K7Q2MX]", [])).toEqual(["K7Q2MX"]);
    expect(
      codigosDoCliqueDoSite("#AGENDA quero horário [#K7Q2MX]", []),
    ).toEqual(["K7Q2MX", "AGENDA"]);
  });

  it("código fixo em qualquer posição tira o clique da vez", () => {
    const regras = [regra({ id: "a", token: "c7k3f9" })];
    expect(codigosDoCliqueDoSite("oi [#C7K3F9] [#K7Q2MX]", regras)).toEqual([]);
    expect(codigosDoCliqueDoSite("oi [#K7Q2MX] [#C7K3F9]", regras)).toEqual([]);
    expect(codigosDoCliqueDoSite("oi [#K7Q2MX]", regras)).toEqual(["K7Q2MX"]);
  });

  it("corpo nulo ou sem token: nada a tentar", () => {
    expect(codigosDoCliqueDoSite(null, [])).toEqual([]);
    expect(codigosDoCliqueDoSite("bom dia", [])).toEqual([]);
  });

  it(`no máximo ${MAX_CODIGOS_DE_CLIQUE} códigos por mensagem`, () => {
    const corpo = "[#AAAAAA] [#BBBBBB] [#CCCCCC] [#DDDDDD] [#EEEEEE]";
    expect(codigosDoCliqueDoSite(corpo, [])).toEqual([
      "EEEEEE",
      "DDDDDD",
      "CCCCCC",
    ]);
  });

  it("atribuirOrigem acha o código fixo mesmo quando ele não é o primeiro token", () => {
    const regras = [
      regra({ id: "a", token: "C7K3F9", channel: "redes_sociais" }),
    ];
    expect(atribuirOrigem("oi [#K7Q2MX] [#C7K3F9]", regras)).toMatchObject({
      method: "link_token",
      channel: "redes_sociais",
    });
  });
});

describe("removerCodigosDoClique e a mensagem padrão depois do clique perdido (decisão pura)", () => {
  const TEXTO_DO_BOTAO = "Olá! Quero agendar uma avaliação";

  it("tira o sufixo ' [#XXXXXX]' do script, sem diferenciar maiúscula e minúscula", () => {
    expect(
      removerCodigosDoClique(`${TEXTO_DO_BOTAO} [#K7Q2MX]`, ["K7Q2MX"]),
    ).toBe(TEXTO_DO_BOTAO);
    expect(
      removerCodigosDoClique(`${TEXTO_DO_BOTAO} [#k7q2mx]`, ["K7Q2MX"]),
    ).toBe(TEXTO_DO_BOTAO);
    expect(removerCodigosDoClique("[#K7Q2MX] oi [#K7Q2MX]", ["K7Q2MX"])).toBe(
      " oi",
    );
  });

  it("botão sem texto: o script manda 'Olá! [#X]', e sobra 'Olá!'", () => {
    expect(removerCodigosDoClique("Olá! [#K7Q2MX]", ["K7Q2MX"])).toBe("Olá!");
  });

  it("vários códigos; '#XXXXXX' solto (hashtag) fica", () => {
    const corpo = "#AGENDA quero [#BBBBBB] horário [#CCCCCC]";
    const codigos = codigosDoCliqueDoSite(corpo, []);
    expect(codigos).toEqual(["CCCCCC", "BBBBBB", "AGENDA"]);
    expect(removerCodigosDoClique(corpo, codigos)).toBe(
      "#AGENDA quero horário",
    );
  });

  it("código fixo nunca entra na lista e nunca sai do texto", () => {
    const regras = [regra({ id: "a", token: "C7K3F9" })];
    const corpo = "oi [#C7K3F9] [#K7Q2MX]";
    expect(codigosDoCliqueDoSite(corpo, regras)).toEqual([]);
    expect(removerCodigosDoClique(corpo, ["K7Q2MX"])).toBe("oi [#C7K3F9]");
  });

  it(`só saem os códigos tentados: além do ${MAX_CODIGOS_DE_CLIQUE}º, o sufixo fica`, () => {
    const corpo = "oi [#AAAAAA] [#BBBBBB] [#CCCCCC] [#DDDDDD] [#EEEEEE]";
    expect(
      removerCodigosDoClique(corpo, codigosDoCliqueDoSite(corpo, [])),
    ).toBe("oi [#AAAAAA] [#BBBBBB]");
  });

  it("código fora do formato é ignorado e nunca vira expressão regular", () => {
    const corpo = "oi [#K7Q2MX] [x]";
    expect(
      removerCodigosDoClique(corpo, [
        ".*",
        "K7Q2M.",
        "[#K7Q2MX]",
        "OOOOOO",
        "",
      ]),
    ).toBe(corpo);
  });

  it("sem a lista, o sufixo impede a igualdade; com ela, vale a mensagem padrão", () => {
    const regras = [
      regra({
        id: "site",
        channel: "busca_organica",
        origin: "Site",
        defaultMessage: TEXTO_DO_BOTAO,
      }),
    ];
    const corpo = `${TEXTO_DO_BOTAO} [#K7Q2MX]`;
    expect(atribuirOrigem(corpo, regras)).toBeNull();
    expect(atribuirOrigem(corpo, regras, ["K7Q2MX"])).toMatchObject({
      method: "mensagem_padrao",
      channel: "busca_organica",
      origin: "Site",
    });
  });

  it("a mensagem padrão vence a palavra-chave de outra campanha mesmo vindo depois na ordem", () => {
    const regras = [
      regra({ id: "insta", channel: "redes_sociais", keywords: ["avaliação"] }),
      regra({
        id: "site",
        channel: "busca_organica",
        defaultMessage: TEXTO_DO_BOTAO,
      }),
    ];
    expect(
      atribuirOrigem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`, regras, ["K7Q2MX"]),
    ).toMatchObject({ method: "mensagem_padrao", channel: "busca_organica" });
  });

  it("o texto como chegou continua casando: mensagem padrão com hashtag e o código do clique", () => {
    const regras = [
      regra({
        id: "a",
        channel: "busca_organica",
        defaultMessage: "Quero agendar #AGENDA",
      }),
    ];
    expect(
      atribuirOrigem("Quero agendar #AGENDA", regras, ["AGENDA"]),
    ).toMatchObject({ method: "mensagem_padrao" });
    expect(
      atribuirOrigem("Quero agendar #AGENDA [#K7Q2MX]", regras, [
        "K7Q2MX",
        "AGENDA",
      ]),
    ).toMatchObject({ method: "mensagem_padrao" });
  });

  it("texto editado pelo paciente continua sem casar a mensagem padrão", () => {
    const regras = [
      regra({
        id: "a",
        channel: "busca_organica",
        defaultMessage: TEXTO_DO_BOTAO,
      }),
    ];
    expect(
      atribuirOrigem(`${TEXTO_DO_BOTAO} amanhã [#K7Q2MX]`, regras, ["K7Q2MX"]),
    ).toBeNull();
  });

  it("corpo só com o código não casa mensagem padrão em branco", () => {
    const regras = [
      regra({ id: "a", channel: "busca_organica", defaultMessage: "   " }),
    ];
    expect(atribuirOrigem("[#K7Q2MX]", regras, ["K7Q2MX"])).toBeNull();
  });

  it("a palavra-chave olha o texto como chegou, com ou sem a lista", () => {
    const regras = [
      regra({ id: "a", channel: "busca_organica", keywords: ["agenda"] }),
    ];
    const corpo = "#AGENDA quero horário [#K7Q2MX]";
    expect(atribuirOrigem(corpo, regras)).toMatchObject({
      method: "palavra_chave",
    });
    expect(
      atribuirOrigem(corpo, regras, codigosDoCliqueDoSite(corpo, regras)),
    ).toMatchObject({ method: "palavra_chave" });
  });
});

describe("ingestão com código de clique do site", () => {
  it("sem campaign_link nenhum, o clique vivo grava Tráfego pago, Google, clique_site e os ids", async () => {
    banco.clique();

    const { error } = await ingerir(mensagem("Olá! Quero agendar [#k7q2mx]"));
    expect(error).toBeNull();

    expect(banco.chamadasDoCasar()).toEqual([
      { p_clinic_id: CLINICA, p_contact_id: CONTATO, p_codigo: CODIGO },
    ]);
    expect(banco.contato).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_medium: null,
      source_campaign: null,
      source_method: "clique_site",
      source_google_campaign_id: CAMPANHA_GOOGLE,
      source_google_adgroup_id: GRUPO_GOOGLE,
      ctwa_clid: null,
      source_ad_id: null,
      source_campaign_id: null,
    });
    // A origem vem do banco (RPC); a ingestao nao faz update proprio.
    expect(banco.updates).toEqual([]);
    expect(banco.cliques[0]?.contact_id).toBe(CONTATO);
  });

  it("log só com ids, status e contagem: nunca o código", async () => {
    banco.clique();

    await ingerir(mensagem("Olá! Quero agendar [#K7Q2MX]"));

    const [linha] = eventosDeLog().filter(
      (evento) => evento.evento === "clique_do_site_na_ingestao",
    );
    expect(linha).toMatchObject({
      clinic_id: CLINICA,
      contact_id: CONTATO,
      status: "origem_gravada",
      count: 1,
    });
    expect(linhasDeLog.join("")).not.toContain(CODIGO);
    expect(linhasDeLog.join("").toLowerCase()).not.toContain(
      CODIGO.toLowerCase(),
    );
  });

  it("código fixo de campaign_link vence o clique: nem chama o casamento", async () => {
    banco.campanhas = [campanhaFixa()];
    banco.clique();

    await ingerir(mensagem("Quero agendar [#C7K3F9] [#K7Q2MX]"));

    expect(banco.chamadasDoCasar()).toEqual([]);
    expect(banco.contato).toMatchObject({
      source_channel: "redes_sociais",
      source_method: "link_token",
      source_campaign: "Botox Outubro",
      source_google_campaign_id: null,
    });
    expect(banco.cliques[0]?.contact_id).toBeNull();
  });

  it("código fixo depois do código do clique também vence", async () => {
    banco.campanhas = [campanhaFixa()];
    banco.clique();

    await ingerir(mensagem("Quero agendar [#K7Q2MX] [#c7k3f9]"));

    expect(banco.chamadasDoCasar()).toEqual([]);
    expect(banco.contato).toMatchObject({
      source_channel: "redes_sociais",
      source_method: "link_token",
    });
  });

  it("anúncio da Meta vence: a origem fica Meta e o clique só é vinculado", async () => {
    banco.clique();

    await ingerir(mensagem("Quero agendar [#K7Q2MX]", anuncioDaMeta()));

    expect(banco.contato).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_google_campaign_id: null,
      source_google_adgroup_id: null,
    });
    expect(banco.cliques[0]?.contact_id).toBe(CONTATO);
    const [linha] = eventosDeLog().filter(
      (evento) => evento.evento === "clique_do_site_na_ingestao",
    );
    expect(linha).toMatchObject({ status: "vinculado" });
    expect(errosDeLog()).toEqual([]);
  });

  it("contato antigo com origem manual só ganha o vínculo com o clique", async () => {
    banco.contato = {
      ...banco.contato,
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: "2026-09-01T10:00:00.000Z",
    };
    banco.ingestao = { ...banco.ingestao, contact_created: false };
    banco.clique();

    await ingerir(mensagem("oi de novo [#K7Q2MX]"));

    expect(banco.contato).toMatchObject({
      source_channel: "indicacao",
      source_method: "manual",
      source_origin: null,
      source_captured_at: "2026-09-01T10:00:00.000Z",
      source_google_campaign_id: null,
    });
    expect(banco.cliques[0]?.contact_id).toBe(CONTATO);
    expect(errosDeLog()).toEqual([]);
  });

  it("contato antigo sem origem ganha a origem do clique numa mensagem posterior", async () => {
    banco.ingestao = { ...banco.ingestao, contact_created: false };
    banco.clique();

    await ingerir(mensagem("voltei pelo site [#K7Q2MX]"));

    expect(banco.contato).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_method: "clique_site",
    });
  });

  it("código que não é de clique (não achado) segue para a palavra-chave no contato novo", async () => {
    banco.campanhas = [
      campanhaFixa({
        token: null,
        channel: "busca_organica",
        keywords: ["agendar"],
      }),
    ];

    await ingerir(mensagem("quero agendar [#ZZZZZZ]"));

    expect(banco.chamadasDoCasar()).toHaveLength(1);
    expect(banco.contato).toMatchObject({
      source_channel: "busca_organica",
      source_method: "palavra_chave",
      source_google_campaign_id: null,
    });
  });

  it("clique vencido não grava nada e segue para a palavra-chave", async () => {
    banco.campanhas = [
      campanhaFixa({
        token: null,
        channel: "busca_organica",
        keywords: ["agendar"],
      }),
    ];
    banco.clique({ vencido: true });

    await ingerir(mensagem("quero agendar [#K7Q2MX]"));

    expect(banco.cliques[0]?.contact_id).toBeNull();
    expect(banco.contato).toMatchObject({
      source_channel: "busca_organica",
      source_method: "palavra_chave",
    });
    const [linha] = eventosDeLog().filter(
      (evento) => evento.evento === "clique_do_site_na_ingestao",
    );
    expect(linha).toMatchObject({ status: "expirado", count: 1 });
  });

  describe("mensagem padrão igual ao texto do botão do site, com o clique perdido", () => {
    const TEXTO_DO_BOTAO = "Olá! Quero agendar uma avaliação";

    function campanhaDoSite(parcial: Linha = {}): Linha {
      return campanhaFixa({
        id: "campanha-site",
        token: null,
        channel: "busca_organica",
        origin: "Site",
        campaign: null,
        default_message: TEXTO_DO_BOTAO,
        ...parcial,
      });
    }

    function campanhaDaPalavra(): Linha {
      return campanhaFixa({
        id: "campanha-palavra",
        token: null,
        channel: "redes_sociais",
        origin: "Instagram orgânico",
        campaign: "Avaliação",
        keywords: ["avaliação"],
      });
    }

    it("não achado (rastreio desligado, aviso perdido, limite, despejo): grava a mensagem padrão no contato novo", async () => {
      banco.campanhas = [campanhaDoSite()];

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.chamadasDoCasar()).toHaveLength(1);
      expect(banco.contato).toMatchObject({
        source_channel: "busca_organica",
        source_origin: "Site",
        source_campaign: null,
        source_method: "mensagem_padrao",
        source_google_campaign_id: null,
        source_google_adgroup_id: null,
      });
      expect(banco.updates).toHaveLength(1);
      const [linha] = eventosDeLog().filter(
        (evento) => evento.evento === "clique_do_site_na_ingestao",
      );
      expect(linha).toMatchObject({ status: "nao_achado", count: 1 });
      expect(errosDeLog()).toEqual([]);
    });

    it("clique vencido (mais de 7 dias): grava a mensagem padrão e o clique fica sem contato", async () => {
      banco.campanhas = [campanhaDoSite()];
      banco.clique({ vencido: true });

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.cliques[0]?.contact_id).toBeNull();
      expect(banco.contato).toMatchObject({
        source_channel: "busca_organica",
        source_origin: "Site",
        source_method: "mensagem_padrao",
        source_google_campaign_id: null,
      });
      const [linha] = eventosDeLog().filter(
        (evento) => evento.evento === "clique_do_site_na_ingestao",
      );
      expect(linha).toMatchObject({ status: "expirado", count: 1 });
    });

    it("a palavra-chave de outra campanha também casa, e a mensagem padrão vence (não a palavra-chave)", async () => {
      // A campanha da palavra vem PRIMEIRO na ordem: quem decide e a
      // precedencia, nao a ordem.
      banco.campanhas = [campanhaDaPalavra(), campanhaDoSite()];

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.contato).toMatchObject({
        source_channel: "busca_organica",
        source_origin: "Site",
        source_method: "mensagem_padrao",
      });
    });

    it("vinculado (contato com id de anúncio da Meta sem prova de anúncio pago): a mensagem padrão vale como sem o script", async () => {
      banco.campanhas = [campanhaDoSite()];
      banco.clique();
      const semProvaDeAnuncioPago: AnuncioDeOrigem = {
        ctwaClid: null,
        adId: "120240624148610289",
        adsetId: null,
        campaignId: null,
        sourceUrl: null,
        plataforma: null,
        tipo: null,
        chavesVistas: { anuncio: ["sourceId"], contexto: [] },
      };

      await ingerir(
        mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`, semProvaDeAnuncioPago),
      );

      expect(banco.cliques[0]?.contact_id).toBe(CONTATO);
      expect(banco.contato).toMatchObject({
        source_ad_id: "120240624148610289",
        source_channel: "busca_organica",
        source_origin: "Site",
        source_method: "mensagem_padrao",
        source_google_campaign_id: null,
      });
      const [linha] = eventosDeLog().filter(
        (evento) => evento.evento === "clique_do_site_na_ingestao",
      );
      expect(linha).toMatchObject({ status: "vinculado" });
      expect(errosDeLog()).toEqual([]);
    });

    it("mensagem padrão com hashtag da própria clínica: o '#XXXXXX' solto fica e o texto casa", async () => {
      banco.campanhas = [
        campanhaDoSite({ default_message: "Quero agendar #AGENDA" }),
      ];

      await ingerir(mensagem("Quero agendar #AGENDA [#K7Q2MX]"));

      expect(banco.chamadasDoCasar().map((args) => args.p_codigo)).toEqual([
        "K7Q2MX",
        "AGENDA",
      ]);
      expect(banco.contato).toMatchObject({
        source_origin: "Site",
        source_method: "mensagem_padrao",
      });
    });

    it("contato antigo: o código não achado não abre a porta para a mensagem padrão", async () => {
      banco.ingestao = { ...banco.ingestao, contact_created: false };
      banco.campanhas = [campanhaDoSite()];

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.chamadasDoCasar()).toHaveLength(1);
      expect(banco.contato.source_channel).toBeNull();
      expect(banco.updates).toEqual([]);
    });

    it("falha no casamento: nem a mensagem padrão grava (na dúvida, origem vazia)", async () => {
      banco.campanhas = [campanhaDoSite()];
      banco.erroNoCasar = { code: "57014", message: "timeout" };

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.contato.source_channel).toBeNull();
      expect(banco.updates).toEqual([]);
    });

    it("clique vivo continua vencendo a mensagem padrão", async () => {
      banco.campanhas = [campanhaDoSite()];
      banco.clique();

      await ingerir(mensagem(`${TEXTO_DO_BOTAO} [#K7Q2MX]`));

      expect(banco.contato).toMatchObject({
        source_origin: "Google",
        source_method: "clique_site",
        source_google_campaign_id: CAMPANHA_GOOGLE,
      });
      expect(banco.updates).toEqual([]);
    });
  });

  it("contato antigo: código não achado não abre a porta para a palavra-chave", async () => {
    banco.ingestao = { ...banco.ingestao, contact_created: false };
    banco.campanhas = [
      campanhaFixa({
        token: null,
        channel: "busca_organica",
        keywords: ["agendar"],
      }),
    ];

    await ingerir(mensagem("quero agendar [#ZZZZZZ]"));

    expect(banco.contato.source_channel).toBeNull();
    expect(banco.updates).toEqual([]);
  });

  it("clique de outra clínica não casa", async () => {
    banco.clique({ clinic_id: OUTRA_CLINICA });

    await ingerir(mensagem("Olá! [#K7Q2MX]"));

    expect(banco.contato.source_channel).toBeNull();
    expect(banco.cliques[0]?.contact_id).toBeNull();
  });

  it("código já usado por outro contato (mensagem encaminhada) não casa", async () => {
    banco.clique({ contact_id: OUTRO_CONTATO });

    await ingerir(mensagem("me mandaram isto [#K7Q2MX]"));

    expect(banco.contato.source_channel).toBeNull();
    expect(banco.cliques[0]?.contact_id).toBe(OUTRO_CONTATO);
  });

  it("reentrega do webhook: vinculado, origem intacta, sem erro", async () => {
    banco.clique();
    await ingerir(mensagem("Olá! [#K7Q2MX]"));
    const depoisDaPrimeira = { ...banco.contato };

    banco.ingestao = {
      ...banco.ingestao,
      inserted: false,
      contact_created: false,
    };
    await ingerir(mensagem("Olá! [#K7Q2MX]"));

    expect(banco.contato).toEqual(depoisDaPrimeira);
    const status = eventosDeLog()
      .filter((evento) => evento.evento === "clique_do_site_na_ingestao")
      .map((evento) => evento.status);
    expect(status).toEqual(["origem_gravada", "vinculado"]);
    expect(errosDeLog()).toEqual([]);
  });

  it("vários códigos: tenta do último para o primeiro e para no primeiro clique achado", async () => {
    banco.clique({ codigo: "BBBBBB" });

    await ingerir(mensagem("#AGENDA [#BBBBBB] texto [#CCCCCC]"));

    expect(banco.chamadasDoCasar().map((args) => args.p_codigo)).toEqual([
      "CCCCCC",
      "BBBBBB",
    ]);
    expect(banco.contato.source_method).toBe("clique_site");
    const [linha] = eventosDeLog().filter(
      (evento) => evento.evento === "clique_do_site_na_ingestao",
    );
    expect(linha).toMatchObject({ status: "origem_gravada", count: 2 });
  });

  it("falha no casamento: para a atribuição (nada de palavra-chave) e loga só o código de erro", async () => {
    banco.campanhas = [
      campanhaFixa({
        token: null,
        channel: "busca_organica",
        keywords: ["agendar"],
      }),
    ];
    banco.erroNoCasar = { code: "PGRST202", message: "função não encontrada" };

    const { error } = await ingerir(mensagem("quero agendar [#K7Q2MX]"));

    expect(error).toBeNull();
    expect(banco.contato.source_channel).toBeNull();
    expect(banco.updates).toEqual([]);
    expect(errosDeLog()).toEqual([
      expect.objectContaining({
        evento: "clique_do_site_casar_falhou",
        clinic_id: CLINICA,
        contact_id: CONTATO,
        error_code: "PGRST202",
        count: 1,
      }),
    ]);
    expect(linhasDeLog.join("")).not.toContain(CODIGO);
  });

  it("resposta fora do contrato também para a atribuição", async () => {
    banco.campanhas = [
      campanhaFixa({
        token: null,
        channel: "busca_organica",
        keywords: ["agendar"],
      }),
    ];
    banco.respostaForcadaDoCasar = { valor: null };

    await ingerir(mensagem("quero agendar [#K7Q2MX]"));

    expect(banco.contato.source_channel).toBeNull();
    expect(errosDeLog()).toEqual([
      expect.objectContaining({ evento: "clique_do_site_resposta_inesperada" }),
    ]);
  });

  it("sem conseguir ler campaign_link, não tenta o clique (não dá para saber se há código fixo)", async () => {
    banco.erroNasCampanhas = { code: "57014", message: "timeout" };
    banco.clique();

    await ingerir(mensagem("Olá! [#K7Q2MX]"));

    expect(banco.chamadasDoCasar()).toEqual([]);
    expect(banco.contato.source_channel).toBeNull();
  });

  it("mensagem sem código não chama o casamento", async () => {
    await ingerir(mensagem("Olá! Quero agendar"));

    expect(banco.chamadasDoCasar()).toEqual([]);
  });
});
