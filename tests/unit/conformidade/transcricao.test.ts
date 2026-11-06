import {
  APIConnectionError,
  APIConnectionTimeoutError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { OpenAI as SdkDeVerdade } from "openai/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA,
} from "@/lib/agente/midia";
import {
  avaliarTranscricao,
  FRASES_FANTASMA,
  FRASES_FANTASMA_INTEIRAS,
  LIMITES_DA_QUALIDADE,
  MOTIVOS_DO_SEM_FALA,
  segmentoEmSilencio,
  VERSAO_DA_QUALIDADE_DA_TRANSCRICAO,
  type SegmentoDaTranscricao,
} from "@/lib/domain/conformidade/qualidade-da-transcricao";
import {
  interpretarResposta,
  interpretarRespostaAListaDeEspera,
  interpretarRespostaAoCancelamento,
} from "@/lib/domain/resposta-paciente";
import { TENTATIVAS_EXTRAS } from "@/lib/integrations/llm/openai";
import {
  FOLGA_DO_CORTE_DA_TRANSCRICAO_MS,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO,
  MODELOS_DA_TRANSCRICAO,
  modeloDaTranscricao,
  NOME_DO_ARQUIVO_DE_AUDIO,
  PARAMETROS_FIXOS_DA_TRANSCRICAO,
  PRAZO_DA_TRANSCRICAO_MS,
  TRANSCRICAO_CALIBRADA,
  transcreverAudio,
  VERSAO_DA_TRANSCRICAO,
  type ClienteDaTranscricao,
} from "@/lib/integrations/llm/transcricao";

// A transcricao do audio (AG6b, desenho 4.1; a excecao do D-56) com cliente
// FALSO: o corpo exato da chamada, a lista fechada do modelo, o prazo, a
// nova tentativa e a cota, cada trava da saida, os segundos conservadores e
// a versao. Nenhum teste chama a OpenAI (o pacote e o stub e o fetch dos
// testes recusa o host).

const IDS = {
  clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
  conversationId: "c0000000-0000-4000-8000-000000000001",
  jobId: "10000000-0000-4000-8000-000000000001",
  messageId: "m0000000-0000-4000-8000-000000000001",
};

function segmento(
  text: string,
  extra: Partial<SegmentoDaTranscricao> = {},
): SegmentoDaTranscricao {
  return {
    text,
    avg_logprob: -0.2,
    compression_ratio: 1.3,
    no_speech_prob: 0.01,
    ...extra,
  };
}

function verboso(
  segmentos: SegmentoDaTranscricao[],
  extra: Record<string, unknown> = {},
) {
  return {
    text: segmentos.map((s) => s.text).join(""),
    duration: 15.2,
    language: "portuguese",
    segments: segmentos.map((s, i) => ({ id: i, start: i, end: i + 1, ...s })),
    usage: { type: "duration", seconds: 16 },
    ...extra,
  };
}

function clienteFalso(impl: () => Promise<unknown>) {
  const create = vi.fn(impl);
  return {
    cliente: {
      audio: { transcriptions: { create } },
    } as unknown as ClienteDaTranscricao,
    create,
  };
}

function silenciarLog() {
  const linhas: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    linhas.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    linhas.push(String(t));
    return true;
  });
  return linhas;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const BYTES = Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]);

function transcrever(
  cliente: ClienteDaTranscricao | null,
  extra: Partial<Parameters<typeof transcreverAudio>[0]> = {},
) {
  return transcreverAudio({
    cliente,
    modelo: "whisper-1",
    bytes: BYTES,
    segundosMedidos: 15,
    prazoMs: PRAZO_DA_TRANSCRICAO_MS,
    ids: IDS,
    ...extra,
  });
}

describe("o pedido da transcricao (o corpo exato)", () => {
  it("whisper-1, pt, verbose_json, segment, temperature 0; sem prompt, include, stream, chunking, keywords, languages, known_speaker", async () => {
    silenciarLog();
    const { cliente, create } = clienteFalso(async () =>
      verboso([segmento(" Quanto custa a limpeza de pele?")]),
    );
    await transcrever(cliente);
    expect(create).toHaveBeenCalledTimes(1);
    const [corpo, opcoes] = create.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "file",
        "language",
        "model",
        "response_format",
        "temperature",
        "timestamp_granularities",
      ].sort(),
    );
    expect(corpo).toMatchObject({
      model: "whisper-1",
      language: "pt",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      temperature: 0,
    });
    for (const proibido of [
      "prompt",
      "include",
      "stream",
      "chunking_strategy",
      "keywords",
      "languages",
      "known_speaker_names",
      "known_speaker_references",
      "store",
      "safety_identifier",
      "user",
      "metadata",
    ]) {
      expect(corpo, proibido).not.toHaveProperty(proibido);
    }
    // O arquivo: File global, "audio.mp3", audio/mpeg, os bytes que vieram.
    const arquivo = corpo.file as File;
    expect(arquivo).toBeInstanceOf(File);
    expect(arquivo.name).toBe(NOME_DO_ARQUIVO_DE_AUDIO);
    expect(arquivo.name).toBe("audio.mp3");
    expect(arquivo.type).toBe("audio/mpeg");
    expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(BYTES);
    // Revisao da AG6b (a juncao): a nova tentativa e da transcricao, nunca
    // do SDK (maxRetries 0: o SDK repetia a tentativa que estourou e dormia
    // o retry-after de ate 60 s); a chamada leva o prazo que sobra e o sinal
    // do corte duro.
    expect(opcoes.maxRetries).toBe(0);
    expect(opcoes.timeout).toBeLessThanOrEqual(PRAZO_DA_TRANSCRICAO_MS);
    expect(opcoes.timeout).toBeGreaterThan(PRAZO_DA_TRANSCRICAO_MS - 1_000);
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
    expect(PARAMETROS_FIXOS_DA_TRANSCRICAO).toEqual({
      language: "pt",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      temperature: 0,
    });
  });

  it("a transcricao boa volta com o texto, os segundos e o uso", async () => {
    silenciarLog();
    const { cliente } = clienteFalso(async () =>
      verboso([
        segmento(" Oi, queria saber quanto custa a limpeza de pele"),
        segmento(" e se tem horário sábado de manhã."),
      ]),
    );
    const r = await transcrever(cliente);
    expect(r).toEqual({
      tipo: "transcrita",
      texto:
        "Oi, queria saber quanto custa a limpeza de pele e se tem horário sábado de manhã.",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
  });
});

describe("o modelo, pela lista fechada (D-90)", () => {
  it("vazio e whisper-1; fora da lista e null (nada sai)", () => {
    expect(MODELOS_DA_TRANSCRICAO).toEqual(["whisper-1"]);
    expect(modeloDaTranscricao({})).toBe("whisper-1");
    expect(modeloDaTranscricao({ IA_MODELO_TRANSCRICAO: " whisper-1 " })).toBe(
      "whisper-1",
    );
    expect(
      modeloDaTranscricao({ IA_MODELO_TRANSCRICAO: "gpt-4o-mini-transcribe" }),
    ).toBeNull();
    expect(modeloDaTranscricao({ IA_MODELO_TRANSCRICAO: "toString" })).toBeNull();
  });

  it("sem cliente ou sem modelo, falha sem chamar", async () => {
    const { cliente, create } = clienteFalso(async () => verboso([]));
    expect(await transcrever(null)).toEqual({
      tipo: "falhou",
      motivo: "sem_cliente",
      uso: null,
    });
    expect(await transcrever(cliente, { modelo: null })).toEqual({
      tipo: "falhou",
      motivo: "modelo_invalido",
      uso: null,
    });
    expect(await transcrever(cliente, { prazoMs: 500 })).toEqual({
      tipo: "falhou",
      motivo: "prazo",
      uso: null,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("a calibragem: ligada desde a decisao do dono de 06/11/2026, que dispensou a prova paga", () => {
    expect(TRANSCRICAO_CALIBRADA).toBe(true);
  });
});

describe("falha fechada: prazo, erro, cota, saida invalida", () => {
  it("o cliente que nunca responde e cortado no prazo (uso pela duracao medida)", async () => {
    vi.useFakeTimers();
    try {
      const linhas = silenciarLog();
      const { cliente } = clienteFalso(() => new Promise(() => undefined));
      const promessa = transcrever(cliente, { prazoMs: 2_000 });
      await vi.advanceTimersByTimeAsync(2_600);
      expect(await promessa).toEqual({
        tipo: "falhou",
        motivo: "timeout",
        uso: { modelo: "whisper-1", segundos: 15 },
      });
      expect(linhas.join("")).toContain("ia_transcricao_falhou");
    } finally {
      vi.useRealTimers();
    }
  });

  it("o timeout do SDK, o 5xx e o 429 de ritmo falham (podem ter sido cobrados), depois de UMA nova tentativa", async () => {
    silenciarLog();
    for (const [erro, semUso] of [
      // Sem cabecalho: a espera padrao (0,5 s) antes da nova tentativa.
      [new APIConnectionTimeoutError(), 1],
      [new InternalServerError(500, {}, "erro", new Headers({ "retry-after-ms": "1" })), 1],
      // O 429 anterior nao conta: a API recusa antes de processar.
      [
        new RateLimitError(
          429,
          { code: "rate_limit_exceeded" },
          "x",
          new Headers({ "retry-after-ms": "1" }),
        ),
        0,
      ],
    ] as const) {
      const { cliente, create } = clienteFalso(async () => {
        throw erro;
      });
      const r = await transcrever(cliente);
      expect(r.tipo).toBe("falhou");
      expect(r.uso).toEqual({ modelo: "whisper-1", segundos: 15 });
      expect(create).toHaveBeenCalledTimes(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO);
      expect(r.tentativasSemUso).toBe(semUso === 0 ? undefined : semUso);
    }
  });

  it("a cota (429 de cobranca) falha como cota; o 400 falha sem uso", async () => {
    silenciarLog();
    const cota = clienteFalso(async () => {
      throw new RateLimitError(
        429,
        { code: "credit_balance_exhausted", type: "insufficient_quota" },
        "x",
        new Headers(),
      );
    });
    expect((await transcrever(cota.cliente)).tipo).toBe("falhou");
    expect(await transcrever(cota.cliente)).toMatchObject({ motivo: "cota" });
    const invalido = clienteFalso(async () => {
      throw new BadRequestError(400, {}, "x", new Headers());
    });
    expect(await transcrever(invalido.cliente)).toEqual({
      tipo: "falhou",
      motivo: "requisicao_invalida",
      uso: null,
    });
  });

  it("a resposta fora do esquema e saida_invalida (nunca o texto)", async () => {
    silenciarLog();
    for (const resposta of [
      null,
      "texto puro",
      { text: "oi" },
      { text: "oi", duration: 3 },
      { text: "oi", duration: 3, segments: [{ text: "oi" }] },
    ]) {
      const { cliente } = clienteFalso(async () => resposta);
      expect(await transcrever(cliente)).toMatchObject({
        tipo: "falhou",
        motivo: "saida_invalida",
      });
    }
  });

  it("o log nunca leva o texto do audio", async () => {
    const linhas = silenciarLog();
    const { cliente } = clienteFalso(async () =>
      verboso([segmento(" meu nome e Maria Souza e meu CPF e 123")]),
    );
    await transcrever(cliente);
    const log = linhas.join("");
    expect(log).toContain("ia_transcricao");
    expect(log).not.toContain("Maria");
    expect(log).not.toContain("CPF");
  });
});

// ---------------------------------------------------------------------------
// O corte duro e a nova tentativa (revisao da AG6b, a juncao: a transcricao
// no desenho do leitor de midia; nunca a nova tentativa do SDK)
// ---------------------------------------------------------------------------

const PRAZO_CURTO = 1_000;
/** O corte duro (o prazo mais a folga) com uma margem para o relogio do teste. */
const ATE_O_CORTE = PRAZO_CURTO + FOLGA_DO_CORTE_DA_TRANSCRICAO_MS + 400;

function cronometro() {
  const inicio = performance.now();
  return () => performance.now() - inicio;
}

function dormir(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Nunca responde, nem ao sinal (o pior cliente). */
function pendurado(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function erro429(cabecalhos: Record<string, string>) {
  return new RateLimitError(
    429,
    { code: "rate_limit_exceeded", type: "rate_limit_error" },
    "x",
    new Headers(cabecalhos),
  );
}

function erro500(cabecalhos: Record<string, string> = {}) {
  return new InternalServerError(500, {}, "x", new Headers(cabecalhos));
}

type OpcoesDaChamada = { timeout: number; maxRetries: number; signal: AbortSignal };

function chamadaDe(
  create: { mock: { calls: unknown[][] } },
  i: number,
): [{ file: File } & Record<string, unknown>, OpcoesDaChamada] {
  return create.mock.calls[i] as unknown as [
    { file: File } & Record<string, unknown>,
    OpcoesDaChamada,
  ];
}

const TRANSCRITA = () => verboso([segmento(" Quero marcar uma limpeza de pele.")]);

describe("o corte duro: a transcricao nunca passa do prazo mais a folga", () => {
  it("as constantes: a folga de 0,5 s, UMA nova tentativa e o espelho que a porta usa", () => {
    expect(FOLGA_DO_CORTE_DA_TRANSCRICAO_MS).toBe(500);
    expect(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO).toBe(1 + TENTATIVAS_EXTRAS);
    expect(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO).toBe(2);
    // lib/agente/midia.ts nao importa este modulo (server-only): o espelho
    // que a porta e a reserva do laco usam tem de ser igual.
    expect(FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS).toBe(
      FOLGA_DO_CORTE_DA_TRANSCRICAO_MS,
    );
    expect(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA).toBe(
      MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO,
    );
  });

  it("cliente que nunca responde (nem ao sinal): termina no corte, com timeout e o uso pela duracao medida; o sinal do SDK aborta", async () => {
    silenciarLog();
    const { cliente, create } = clienteFalso(() => pendurado());
    const passou = cronometro();
    const r = await transcrever(cliente, { prazoMs: PRAZO_CURTO });
    const ms = passou();
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "timeout",
      uso: { modelo: "whisper-1", segundos: 15 },
    });
    expect(ms).toBeGreaterThanOrEqual(PRAZO_CURTO);
    expect(ms).toBeLessThan(ATE_O_CORTE);
    expect(create).toHaveBeenCalledTimes(1);
    const [, opcoes] = chamadaDe(create, 0);
    expect(opcoes.maxRetries).toBe(0);
    expect(opcoes.timeout).toBeLessThanOrEqual(PRAZO_CURTO);
    // O sinal do corte chegou ao SDK e abortou.
    expect(opcoes.signal.aborted).toBe(true);
  });

  it("a nova tentativa leva so o prazo que sobra, o mesmo arquivo e maxRetries 0", async () => {
    silenciarLog();
    let chamadas = 0;
    const { cliente, create } = clienteFalso(async () => {
      chamadas += 1;
      if (chamadas === 1) {
        await dormir(200);
        throw erro500({ "retry-after-ms": "10" });
      }
      return TRANSCRITA();
    });
    const r = await transcrever(cliente, { prazoMs: 3_000 });
    expect(r).toMatchObject({ tipo: "transcrita", tentativasSemUso: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    const [corpo1, opcoes1] = chamadaDe(create, 0);
    const [corpo2, opcoes2] = chamadaDe(create, 1);
    expect(opcoes1.timeout).toBeLessThanOrEqual(3_000);
    expect(opcoes2.timeout).toBeLessThanOrEqual(3_000 - 200);
    expect(opcoes2.maxRetries).toBe(0);
    // O pedido fixo nas duas (o nome fixo, nunca o do paciente).
    expect(corpo2.file).toBe(corpo1.file);
    expect(corpo2.file.name).toBe(NOME_DO_ARQUIVO_DE_AUDIO);
    expect(corpo2).toMatchObject({ language: "pt", temperature: 0 });
  });

  it("429 com retry-after longo (60 s): nao espera nem repete, o limite volta na hora", async () => {
    silenciarLog();
    const { cliente, create } = clienteFalso(async () => {
      throw erro429({ "retry-after": "60" });
    });
    const passou = cronometro();
    const r = await transcrever(cliente);
    expect(passou()).toBeLessThan(500);
    expect(create).toHaveBeenCalledTimes(1);
    // A ultima chamada fica com a estimativa de sempre (o lado seguro);
    // nenhuma anterior.
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "limite",
      uso: { modelo: "whisper-1", segundos: 15 },
    });
  });

  it("429 com retry-after que cabe: espera o pedido e repete UMA vez (o 429 nao conta como chamada cobrada)", async () => {
    silenciarLog();
    let chamadas = 0;
    const { cliente, create } = clienteFalso(async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw erro429({ "retry-after-ms": "120" });
      }
      return TRANSCRITA();
    });
    const passou = cronometro();
    const r = await transcrever(cliente);
    expect(passou()).toBeGreaterThanOrEqual(100);
    expect(create).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({
      tipo: "transcrita",
      uso: { modelo: "whisper-1", segundos: 16 },
    });
    expect(r).not.toHaveProperty("tentativasSemUso");
  });

  it("o erro que chega perto do fim nao repete: a espera e a nova chamada nao cabem", async () => {
    silenciarLog();
    const { cliente, create } = clienteFalso(async () => {
      await dormir(300);
      throw erro500();
    });
    const passou = cronometro();
    const r = await transcrever(cliente, { prazoMs: PRAZO_CURTO });
    expect(passou()).toBeLessThan(PRAZO_CURTO);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "servidor",
      uso: { modelo: "whisper-1", segundos: 15 },
    });
  });

  it("x-should-retry false (o nosso fetch marca o 429 de cota): nao repete", async () => {
    silenciarLog();
    const { cliente, create } = clienteFalso(async () => {
      throw erro429({ "x-should-retry": "false", "retry-after-ms": "1" });
    });
    expect(await transcrever(cliente)).toMatchObject({
      tipo: "falhou",
      motivo: "limite",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("o que nao melhora tentando de novo sai uma vez so (400, cota, excecao do cliente, sincrona ou nao)", async () => {
    silenciarLog();
    for (const impl of [
      async () => {
        throw new BadRequestError(400, {}, "x", new Headers({ "retry-after-ms": "1" }));
      },
      async () => {
        throw new RateLimitError(
          429,
          { code: "credit_balance_exhausted", type: "insufficient_quota" },
          "x",
          new Headers({ "retry-after-ms": "1" }),
        );
      },
      async () => {
        throw new Error("conteudo do paciente no erro");
      },
      () => {
        throw new Error("conteudo do paciente no erro, sincrono");
      },
    ]) {
      const linhas = silenciarLog();
      const { cliente, create } = clienteFalso(impl);
      expect((await transcrever(cliente)).tipo).toBe("falhou");
      expect(create).toHaveBeenCalledTimes(1);
      expect(linhas.join("")).not.toContain("paciente");
    }
  });
});

describe("o gasto da nova tentativa (tentativasSemUso)", () => {
  it("5xx e depois a resposta: o uso e o da segunda, e a primeira volta em tentativasSemUso", async () => {
    silenciarLog();
    let chamadas = 0;
    const { cliente } = clienteFalso(async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw erro500({ "retry-after-ms": "1" });
      }
      return TRANSCRITA();
    });
    expect(await transcrever(cliente)).toEqual({
      tipo: "transcrita",
      texto: "Quero marcar uma limpeza de pele.",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
      tentativasSemUso: 1,
    });
  });

  it("5xx e depois o sem fala: a tentativa sem uso vem junto", async () => {
    silenciarLog();
    let chamadas = 0;
    const { cliente } = clienteFalso(async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw erro500({ "retry-after-ms": "1" });
      }
      return verboso([segmento(" Legendas pela comunidade Amara.org")]);
    });
    expect(await transcrever(cliente)).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
      tentativasSemUso: 1,
    });
  });

  it("5xx duas vezes: no maximo duas chamadas, falha servidor e uma tentativa sem uso (o log so com o codigo e a tentativa)", async () => {
    const linhas = silenciarLog();
    const { cliente, create } = clienteFalso(async () => {
      throw erro500({ "retry-after-ms": "1" });
    });
    expect(await transcrever(cliente)).toEqual({
      tipo: "falhou",
      motivo: "servidor",
      uso: { modelo: "whisper-1", segundos: 15 },
      tentativasSemUso: 1,
    });
    expect(create).toHaveBeenCalledTimes(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO);
    const log = linhas.join("");
    expect(log).toContain('"status":"nova_tentativa"');
    expect(log).toContain('"attempt":2');
  });

  it("a rede caiu e depois a resposta veio: a primeira conta (pode ter sido cobrada)", async () => {
    silenciarLog();
    let chamadas = 0;
    const { cliente } = clienteFalso(async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw new APIConnectionError({ message: "x" });
      }
      return TRANSCRITA();
    });
    expect(await transcrever(cliente, { prazoMs: 3_000 })).toMatchObject({
      tipo: "transcrita",
      tentativasSemUso: 1,
    });
  });
});

describe("o sinal de quem chama (o corte da porta e do laco)", () => {
  it("abortado no meio da chamada: termina na hora, com abortado e o uso estimado, mesmo com cliente que ignora o sinal", async () => {
    silenciarLog();
    const porta = new AbortController();
    const { cliente, create } = clienteFalso(() => pendurado());
    setTimeout(() => porta.abort(), 100);
    const passou = cronometro();
    const r = await transcrever(cliente, { sinal: porta.signal });
    expect(passou()).toBeLessThan(400);
    // A chamada saiu: pode ter sido cobrada (a duracao medida).
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "abortado",
      uso: { modelo: "whisper-1", segundos: 15 },
    });
    expect(chamadaDe(create, 0)[1].signal.aborted).toBe(true);
  });

  it("abortado na espera da nova tentativa: a segunda chamada nao sai", async () => {
    silenciarLog();
    const porta = new AbortController();
    const { cliente, create } = clienteFalso(async () => {
      throw erro500({ "retry-after-ms": "2000" });
    });
    setTimeout(() => porta.abort(), 100);
    const passou = cronometro();
    const r = await transcrever(cliente, { sinal: porta.signal });
    expect(passou()).toBeLessThan(400);
    expect(create).toHaveBeenCalledTimes(1);
    // A unica chamada que saiu e a ultima: o uso dela ja e a estimativa,
    // sem tentativasSemUso.
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "abortado",
      uso: { modelo: "whisper-1", segundos: 15 },
    });
  });

  it("ja abortado: nada sai, e o motivo e prazo (nunca cobrado)", async () => {
    const linhas = silenciarLog();
    const porta = new AbortController();
    porta.abort();
    const { cliente, create } = clienteFalso(async () => TRANSCRITA());
    expect(await transcrever(cliente, { sinal: porta.signal })).toEqual({
      tipo: "falhou",
      motivo: "prazo",
      uso: null,
    });
    expect(create).not.toHaveBeenCalled();
    expect(linhas.join("")).toContain('"error_code":"abortado"');
  });
});

// O SDK de verdade (subcaminho "openai/client", que o alias nao cobre) so
// com um fetch FALSO: o fetch global e trocado por um que lanca, entao nada
// sai da maquina. O erro que o SDK lanca e da classe de verdade, nao da do
// stub de "openai" que lib/integrations/llm/openai.ts importa nos testes: a
// classificacao cai em "desconhecida" (na producao seria o motivo certo).
// Por isso estes testes provam o TEMPO e as chamadas, nao o motivo. O fetch
// falso expoe o Response: sem ele, o SDK sonda o fetch com "data:," antes do
// primeiro envio multipart (internal/uploads.js, supportsFormData), e so a
// chamada da API passa por aqui.
function sdkComFetchFalso(
  responder: (sinal: AbortSignal | null) => Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("rede proibida nos testes");
    }),
  );
  const falso = Object.assign(
    vi.fn<typeof fetch>(async (_url, init) => responder(init?.signal ?? null)),
    { Response },
  );
  const cliente = new SdkDeVerdade({
    apiKey: "sk-falsa-de-teste",
    organization: null,
    project: null,
    baseURL: "https://api.openai.com/v1",
    // O do cliente de producao (TENTATIVAS_EXTRAS): a chamada da
    // transcricao manda 0.
    maxRetries: 1,
    logLevel: "off",
    fetch: falso,
  });
  return { cliente: cliente as unknown as ClienteDaTranscricao, falso };
}

describe("o corte duro com o SDK de verdade (openai 7.28) e um fetch falso", () => {
  it("fetch que nunca responde (nem ao sinal): o corte encerra em prazo mais a folga, uma chamada so", async () => {
    silenciarLog();
    let sinalDoFetch: AbortSignal | null = null;
    const { cliente, falso } = sdkComFetchFalso((sinal) => {
      sinalDoFetch = sinal;
      return pendurado();
    });
    const passou = cronometro();
    const r = await transcrever(cliente, { prazoMs: PRAZO_CURTO });
    expect(passou()).toBeLessThan(ATE_O_CORTE);
    expect(r).toMatchObject({ tipo: "falhou", motivo: "timeout" });
    expect(falso).toHaveBeenCalledTimes(1);
    expect(String(falso.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect((sinalDoFetch as AbortSignal | null)?.aborted).toBe(true);
  });

  it("429 com retry-after de 60 s: o SDK nao dorme nem repete (maxRetries 0)", async () => {
    silenciarLog();
    const { cliente, falso } = sdkComFetchFalso(
      async () =>
        new Response(
          JSON.stringify({
            error: { type: "rate_limit_error", code: "rate_limit_exceeded" },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60" },
          },
        ),
    );
    const passou = cronometro();
    const r = await transcrever(cliente);
    expect(passou()).toBeLessThan(1_000);
    expect(r.tipo).toBe("falhou");
    expect(falso).toHaveBeenCalledTimes(1);
  });

  it("o sinal de quem chama chega ao fetch e encerra a transcricao na hora", async () => {
    silenciarLog();
    let sinalDoFetch: AbortSignal | null = null;
    const { cliente } = sdkComFetchFalso((sinal) => {
      sinalDoFetch = sinal;
      return pendurado();
    });
    const porta = new AbortController();
    setTimeout(() => porta.abort(), 100);
    const passou = cronometro();
    const r = await transcrever(cliente, {
      prazoMs: PRAZO_CURTO,
      sinal: porta.signal,
    });
    expect(passou()).toBeLessThan(400);
    expect(r).toMatchObject({ tipo: "falhou", motivo: "abortado" });
    expect((sinalDoFetch as AbortSignal | null)?.aborted).toBe(true);
  });
});

describe("as travas da saida (qualidade-da-transcricao)", () => {
  it("o segmento em silencio e descartado", () => {
    expect(
      avaliarTranscricao({
        segmentos: [
          segmento(" Quero marcar uma consulta."),
          segmento(" Legendas.", { no_speech_prob: 0.9, avg_logprob: -1.4 }),
        ],
      }),
    ).toEqual({ tipo: "transcrita", texto: "Quero marcar uma consulta." });
  });

  // 3a rodada (M3): o audio que so tinha silencio tem motivo proprio
  // ("silencio"); "vazio" ficou para o segmento falado sem texto.
  it("so silencio: sem fala (silencio)", () => {
    expect(
      avaliarTranscricao({
        segmentos: [segmento(" Obrigada.", { no_speech_prob: 0.95, avg_logprob: -1.2 })],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "silencio" });
  });

  it("o segmento falado sem texto: sem fala (vazio)", () => {
    expect(avaliarTranscricao({ segmentos: [segmento("   ")] })).toEqual({
      tipo: "sem_fala",
      motivo: "vazio",
    });
  });

  it("repeticao (compressao acima de 2,4): sem fala, o audio inteiro", () => {
    expect(
      avaliarTranscricao({
        segmentos: [
          segmento(" Quero marcar."),
          segmento(" sim sim sim sim sim sim sim", { compression_ratio: 3.1 }),
        ],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "repeticao" });
  });

  it("baixa confianca fora do silencio: sem fala", () => {
    expect(
      avaliarTranscricao({
        segmentos: [segmento(" talvez sim", { avg_logprob: -1.3, no_speech_prob: 0.2 })],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "segmento_ruim" });
  });

  it("so pontuacao e acima de 4.000 caracteres: sem fala", () => {
    expect(avaliarTranscricao({ segmentos: [segmento(" ... ?!")] })).toEqual({
      tipo: "sem_fala",
      motivo: "so_pontuacao",
    });
    expect(
      avaliarTranscricao({
        segmentos: [segmento("a".repeat(LIMITES_DA_QUALIDADE.caracteres + 1))],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "longo" });
  });

  it.each(FRASES_FANTASMA.map((f) => [f]))(
    "a frase-fantasma %s: sem fala, nunca o texto sem ela",
    (frase) => {
      expect(
        avaliarTranscricao({
          segmentos: [segmento(` Quero marcar. ${frase.toUpperCase()}`)],
        }),
      ).toEqual({ tipo: "sem_fala", motivo: "frase_fantasma" });
    },
  );

  it("o classico em portugues, com acento e caixa: sem fala", () => {
    expect(
      avaliarTranscricao({
        segmentos: [segmento(" Legendas pela comunidade Amara.org")],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "frase_fantasma" });
  });

  it("sem segmentos: sem fala (nao da para conferir)", () => {
    expect(avaliarTranscricao({ segmentos: [] })).toEqual({
      tipo: "sem_fala",
      motivo: "sem_segmentos",
    });
  });

  it("pelo cliente: o sem fala volta com os segundos e o uso (foi cobrado)", async () => {
    silenciarLog();
    const { cliente } = clienteFalso(async () =>
      verboso([segmento(" Legendas pela comunidade Amara.org")]),
    );
    expect(await transcrever(cliente)).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
  });
});

// 3a rodada da AG6b (revisao de 6eae43d, M3): o "sim" inventado no
// silencio. A IA pergunta "Confirma o cancelamento...?", o paciente manda
// sem querer 3 s de ruido, o Whisper escreve "Ok." e a consulta e
// cancelada. O segmento so era silencio com no_speech_prob acima de 0,6 E
// avg_logprob abaixo de -1: a frase inventada com decodificacao confiante
// passava.
describe("M3: o sim inventado no silencio nunca vira transcricao", () => {
  const PERFIS_DO_REVISOR = [
    [" Ok.", 0.92, -0.35],
    [" Sim.", 0.85, -0.6],
    [" Certo.", 0.75, -0.9],
  ] as const;

  it.each(PERFIS_DO_REVISOR)(
    "%s (no_speech %f, logprob %f): sem fala (silencio)",
    (texto, noSpeech, logprob) => {
      expect(
        avaliarTranscricao({
          segmentos: [segmento(texto, { no_speech_prob: noSpeech, avg_logprob: logprob })],
        }),
      ).toEqual({ tipo: "sem_fala", motivo: "silencio" });
    },
  );

  it("o porque: transcrito, o mesmo texto seria um sim nas tres leituras", () => {
    expect(interpretarRespostaAoCancelamento(["Ok."])).toBe("sim");
    expect(interpretarRespostaAListaDeEspera(["Ok."])).toBe("sim");
    expect(interpretarResposta("Ok.")).toBe("confirmar");
    expect(interpretarRespostaAoCancelamento(["Sim."])).toBe("sim");
    expect(interpretarRespostaAoCancelamento(["Certo."])).toBe("sim");
  });

  it("acima do limite o segmento nao e fala, qualquer que seja o logprob", () => {
    expect(LIMITES_DA_QUALIDADE.silencio).toEqual({ noSpeechProbAcimaDe: 0.6 });
    for (const logprob of [-0.05, -0.35, -0.99, -1.5]) {
      expect(
        segmentoEmSilencio(segmento(" Sim.", { no_speech_prob: 0.61, avg_logprob: logprob })),
        String(logprob),
      ).toBe(true);
    }
    expect(segmentoEmSilencio(segmento(" Sim.", { no_speech_prob: 0.6 }))).toBe(false);
  });

  it("o segmento inventado no fim de uma fala longa sai; a fala fica", () => {
    expect(
      avaliarTranscricao({
        segmentos: [
          segmento(" Quero remarcar a consulta de sexta."),
          segmento(" Obrigado.", { no_speech_prob: 0.88, avg_logprob: -0.3 }),
        ],
      }),
    ).toEqual({ tipo: "transcrita", texto: "Quero remarcar a consulta de sexta." });
  });

  it.each([
    ["Sim.", 0.45, -0.2],
    ["Ok.", 0.3, -0.1],
    ["Pode cancelar.", 0.5, -0.3],
    ["Sim, pode cancelar.", 0.35, -0.2],
    ["Certo.", 0.21, -0.15],
  ] as const)(
    "a resposta curta %s com no_speech %f (abaixo de 0,6): sem fala (curta_incerta)",
    (texto, noSpeech, logprob) => {
      expect(
        avaliarTranscricao({
          segmentos: [segmento(` ${texto}`, { no_speech_prob: noSpeech, avg_logprob: logprob })],
        }),
      ).toEqual({ tipo: "sem_fala", motivo: "curta_incerta" });
    },
  );

  it("a resposta curta exige no_speech_prob baixo em TODOS os segmentos, inclusive o descartado", () => {
    expect(
      avaliarTranscricao({
        segmentos: [
          segmento(" Sim."),
          segmento(" Obrigado.", { no_speech_prob: 0.9, avg_logprob: -0.3 }),
        ],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "curta_incerta" });
  });

  it.each([
    ["Sim.", 0.05, -0.2],
    ["Ok.", 0.1, -0.3],
    ["Pode cancelar.", 0.12, -0.25],
    ["Sim, pode cancelar.", 0.2, -0.25],
  ] as const)(
    "controle: a fala curta de verdade %s com no_speech %f baixo vale (e e um sim)",
    (texto, noSpeech, logprob) => {
      const r = avaliarTranscricao({
        segmentos: [segmento(` ${texto}`, { no_speech_prob: noSpeech, avg_logprob: logprob })],
      });
      expect(r).toEqual({ tipo: "transcrita", texto });
      expect(interpretarRespostaAoCancelamento([texto])).toBe("sim");
    },
  );

  it("controle: a fala longa com no_speech moderado continua valendo (a trava curta e so para a curta)", () => {
    expect(
      avaliarTranscricao({
        segmentos: [
          segmento(" Quero marcar uma limpeza de pele no sábado.", {
            no_speech_prob: 0.4,
            avg_logprob: -0.3,
          }),
        ],
      }),
    ).toEqual({
      tipo: "transcrita",
      texto: "Quero marcar uma limpeza de pele no sábado.",
    });
  });

  it("os limites e os motivos novos (proposta, a calibrar na prova paga)", () => {
    expect(LIMITES_DA_QUALIDADE.curta).toEqual({ palavrasAte: 3, noSpeechProbAcimaDe: 0.2 });
    expect(MOTIVOS_DO_SEM_FALA).toEqual(
      expect.arrayContaining(["silencio", "curta_incerta"]),
    );
  });

  it("pelo cliente: o Ok. inventado volta como sem fala, com os segundos e o uso", async () => {
    silenciarLog();
    const { cliente } = clienteFalso(async () =>
      verboso([segmento(" Ok.", { no_speech_prob: 0.92, avg_logprob: -0.35 })]),
    );
    expect(await transcrever(cliente)).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
  });
});

// 3a rodada (revisao de 6eae43d): as frases-fantasma que faltavam. A
// marca de som entre colchetes passava como transcricao ("[Musica]").
describe("as frases-fantasma da 3a rodada", () => {
  it.each([
    " [Música]",
    " [MÚSICA]",
    " (Música)",
    " [Música de fundo]",
    " [Aplausos]",
    " (Aplausos)",
    " [Risos]",
    " Legenda Adriana Zanotto",
    " Legendas: Adriana Zanotto",
    " Transcrição e Legendas",
    " Obrigada por assistir!",
    " Obrigado por assistir.",
    " Inscrevam-se no canal!",
    " Inscreva-se no canal!",
    " Legendas pela comunidade Amara.org",
    " ♪ Música de fundo ♪",
  ])("%s: sem fala (frase_fantasma)", (texto) => {
    expect(avaliarTranscricao({ segmentos: [segmento(texto)] })).toEqual({
      tipo: "sem_fala",
      motivo: "frase_fantasma",
    });
  });

  it.each([
    " Tem música ambiente na sala de espera?",
    " Quero marcar com a Dra. Adriana amanhã de manhã.",
    " Obrigada pelo atendimento de ontem.",
    " Vocês mandam a transcrição do laudo por e-mail?",
    " Posso me inscrever na lista de espera?",
    " Assisti o vídeo de vocês e quero marcar.",
    " Meu marido deu risada quando viu o preço.",
  ])("controle %s: a fala real com palavra parecida passa", (texto) => {
    expect(avaliarTranscricao({ segmentos: [segmento(texto)] })).toEqual({
      tipo: "transcrita",
      texto: texto.trim(),
    });
  });
});

describe("os segundos, conservadores", () => {
  it("o maior entre o usage, a duration e a medida do preparo", async () => {
    silenciarLog();
    const semUsage = clienteFalso(async () => {
      const r = verboso([segmento(" oi")]);
      return { ...r, usage: undefined, duration: 9.2 };
    });
    expect(
      await transcrever(semUsage.cliente, { segundosMedidos: 10.4 }),
    ).toMatchObject({ segundos: 11, uso: { segundos: 11 } });
    const maior = clienteFalso(async () =>
      verboso([segmento(" oi")], { usage: { type: "duration", seconds: 30 } }),
    );
    expect(
      await transcrever(maior.cliente, { segundosMedidos: 10 }),
    ).toMatchObject({ segundos: 30 });
  });

  it("a divergencia acima de 10% vira log so com os numeros", async () => {
    const linhas = silenciarLog();
    const { cliente } = clienteFalso(async () =>
      verboso([segmento(" oi")], {
        duration: 40,
        usage: { type: "duration", seconds: 40 },
      }),
    );
    await transcrever(cliente, { segundosMedidos: 15 });
    const log = linhas.join("");
    expect(log).toContain("ia_transcricao_duracao_divergente");
    expect(log).not.toContain("oi");
  });
});

describe("a versao", () => {
  it("transcricao- e 12 hex; as travas tem a propria", () => {
    expect(VERSAO_DA_TRANSCRICAO).toMatch(/^transcricao-[0-9a-f]{12}$/);
    expect(VERSAO_DA_QUALIDADE_DA_TRANSCRICAO).toMatch(/^qualidade-[0-9a-f]{12}$/);
  });

  // 3a rodada (M3 e as frases-fantasma): as travas mudaram, e a versao com
  // elas (a de 6eae43d ficou para tras).
  it("as travas mudaram desde a revisao de 6eae43d", () => {
    expect(VERSAO_DA_QUALIDADE_DA_TRANSCRICAO).not.toBe("qualidade-19ca28f472a1");
  });
});

// Revisao R2 de d1a15f6 (B2): as despedidas que o Whisper inventa no fim do
// silencio ou da musica so contam quando sao a transcricao INTEIRA
// (igualdade depois de normalizar), nunca como pedaco da fala real.
describe("as frases-fantasma inteiras da revisao R2", () => {
  it("a lista: tchau, tchau e ate a proxima", () => {
    expect(FRASES_FANTASMA_INTEIRAS).toEqual(["tchau tchau", "ate a proxima"]);
  });

  it.each([
    " Tchau, tchau!",
    " Tchau tchau.",
    " TCHAU, TCHAU",
    " Até a próxima!",
    " até a próxima.",
    " Até a próxima...",
  ])("%s sozinha: sem fala (frase_fantasma)", (texto) => {
    expect(avaliarTranscricao({ segmentos: [segmento(texto)] })).toEqual({
      tipo: "sem_fala",
      motivo: "frase_fantasma",
    });
  });

  it("a frase inteira em dois segmentos tambem conta", () => {
    expect(
      avaliarTranscricao({
        segmentos: [segmento(" Tchau,"), segmento(" tchau!")],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "frase_fantasma" });
  });

  it.each([
    " Quero remarcar para sexta. Tchau, tchau!",
    " Obrigada, até a próxima consulta.",
    " Até a próxima semana, então. Pode confirmar?",
    " Tchau.",
  ])("controle %s: a fala real com a despedida passa", (texto) => {
    expect(avaliarTranscricao({ segmentos: [segmento(texto)] })).toEqual({
      tipo: "transcrita",
      texto: texto.trim(),
    });
  });

  it("as travas mudaram desde a revisao R2 de d1a15f6", () => {
    expect(VERSAO_DA_QUALIDADE_DA_TRANSCRICAO).not.toBe(
      "qualidade-5ca3cb77ed57",
    );
  });
});
