import {
  APIConnectionTimeoutError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  avaliarTranscricao,
  FRASES_FANTASMA,
  LIMITES_DA_QUALIDADE,
  VERSAO_DA_QUALIDADE_DA_TRANSCRICAO,
  type SegmentoDaTranscricao,
} from "@/lib/domain/conformidade/qualidade-da-transcricao";
import {
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
});

const BYTES = Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]);

function transcrever(cliente: ClienteDaTranscricao | null, extra = {}) {
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
    // Prazo e UMA nova tentativa, com o sinal do corte duro.
    expect(opcoes.timeout).toBe(PRAZO_DA_TRANSCRICAO_MS);
    expect(opcoes.maxRetries).toBe(1);
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

  it("a calibragem: falsa ate a prova paga (D-100)", () => {
    expect(TRANSCRICAO_CALIBRADA).toBe(false);
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

  it("o timeout do SDK, o 5xx e o 429 de ritmo falham (podem ter sido cobrados)", async () => {
    silenciarLog();
    for (const erro of [
      new APIConnectionTimeoutError(),
      new InternalServerError(500, {}, "erro", new Headers()),
      new RateLimitError(429, { code: "rate_limit_exceeded" }, "x", new Headers()),
    ]) {
      const { cliente } = clienteFalso(async () => {
        throw erro;
      });
      const r = await transcrever(cliente);
      expect(r.tipo).toBe("falhou");
      expect(r.uso).toEqual({ modelo: "whisper-1", segundos: 15 });
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

  it("so silencio: sem fala (vazio)", () => {
    expect(
      avaliarTranscricao({
        segmentos: [segmento(" Obrigada.", { no_speech_prob: 0.95, avg_logprob: -1.2 })],
      }),
    ).toEqual({ tipo: "sem_fala", motivo: "vazio" });
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
});
