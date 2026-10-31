import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  avaliarTranscricao,
  type SegmentoDaTranscricao,
} from "@/lib/domain/conformidade/qualidade-da-transcricao";
import {
  detectarUrgencia,
  TIPOS_DE_URGENCIA,
} from "@/lib/domain/conformidade/urgencia";
import {
  PRAZO_DA_TRANSCRICAO_MS,
  transcreverAudio,
  type ClienteDaTranscricao,
} from "@/lib/integrations/llm/transcricao";
import { log } from "@/lib/log";

// Segunda rodada da revisao (R2 de d1a15f6, M3, MEDIO): a fala curta urgente
// perdia a marca Urgente. As travas da saida descartam a fala curta incerta
// ("Quero morrer." com no_speech_prob 0,35: curta_incerta) e o segmento em
// silencio ("Socorro, minha mae desmaiou..." com 0,65 e ruido de fundo), e o
// texto descartado nunca chegava ao portao do laco: a conversa passava como
// midia, sem a marca. Na 6eae43d, as quatro falas do revisor chegavam a
// urgencia.
//
// Agora a transcricao le a urgencia (a lista deterministica, local) no texto
// INTEIRO dos segmentos, inclusive os descartados, e devolve so o TIPO
// (`urgencia`). O texto descartado nunca sai da integracao: nem no
// resultado, nem no log. Cliente FALSO; nenhum teste chama a OpenAI.

const IDS = {
  clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
  conversationId: "c0000000-0000-4000-8000-000000000001",
  jobId: "10000000-0000-4000-8000-000000000001",
  messageId: "m0000000-0000-4000-8000-000000000001",
};

type Perfil = [texto: string, noSpeechProb: number, avgLogprob: number];

function segmento([text, noSpeechProb, avgLogprob]: Perfil): SegmentoDaTranscricao {
  return {
    text,
    no_speech_prob: noSpeechProb,
    avg_logprob: avgLogprob,
    compression_ratio: 1.1,
  };
}

function verboso(segmentos: SegmentoDaTranscricao[]) {
  return {
    text: segmentos.map((s) => s.text).join(""),
    duration: 15.2,
    language: "portuguese",
    segments: segmentos.map((s, i) => ({ id: i, start: i, end: i + 1, ...s })),
    usage: { type: "duration", seconds: 16 },
  };
}

function clienteQueResponde(resposta: unknown): ClienteDaTranscricao {
  return {
    audio: { transcriptions: { create: vi.fn(async () => resposta) } },
  } as unknown as ClienteDaTranscricao;
}

/** Tudo que sai no stdout e no stderr (o log escreve la) e o que o log recebeu. */
function espiarLog() {
  const escrito: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  const chamadas = [
    vi.spyOn(log, "info"),
    vi.spyOn(log, "warn"),
    vi.spyOn(log, "error"),
  ];
  return {
    escrito,
    /** Os eventos e os campos que o codigo passou ao log (antes da lista fechada). */
    campos: () =>
      chamadas.flatMap((espiao) => espiao.mock.calls.map((c) => JSON.stringify(c))),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function transcrever(resposta: unknown) {
  return transcreverAudio({
    cliente: clienteQueResponde(resposta),
    modelo: "whisper-1",
    bytes: Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]),
    segundosMedidos: 15,
    prazoMs: PRAZO_DA_TRANSCRICAO_MS,
    ids: IDS,
  });
}

/** As palavras do texto que nunca podem sair (de 4 letras ou mais). */
function palavras(textos: readonly string[]): string[] {
  return textos
    .join(" ")
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length >= 4);
}

/** Nenhuma palavra do texto no log (o que saiu e os campos que o log recebeu). */
function semOTextoNoLog(
  espiao: ReturnType<typeof espiarLog>,
  textos: readonly string[],
) {
  const saidas = [espiao.escrito.join(""), ...espiao.campos()]
    .join("\n")
    .toLowerCase();
  for (const palavra of palavras(textos)) {
    expect(saidas).not.toContain(palavra.toLowerCase());
  }
}

/** Nenhuma palavra do texto no resultado nem no log. */
function semOTexto(
  resultado: unknown,
  espiao: ReturnType<typeof espiarLog>,
  textos: readonly string[],
) {
  const noResultado = JSON.stringify(resultado).toLowerCase();
  for (const palavra of palavras(textos)) {
    expect(noResultado).not.toContain(palavra.toLowerCase());
  }
  semOTextoNoLog(espiao, textos);
}

/**
 * O tipo que a lista deterministica da ao texto (nunca nulo aqui: o texto e
 * urgente). Pela funcao, nao fixo no teste: a lista e da frente da urgencia.
 */
function tipoDaUrgencia(texto: string) {
  const urgencia = detectarUrgencia([texto]);
  expect(urgencia).not.toBeNull();
  return urgencia?.tipo;
}

/** Os quatro perfis do revisor R2 (rev2-r2/transcricao-perfis.ts). */
const PERFIS_DO_REVISOR: [nome: string, perfil: Perfil, motivo: string][] = [
  ["Não consigo respirar. (0,3)", [" Não consigo respirar.", 0.3, -0.3], "curta_incerta"],
  ["Quero morrer. (0,35)", [" Quero morrer.", 0.35, -0.4], "curta_incerta"],
  ["Vou me matar. (0,5)", [" Vou me matar.", 0.5, -0.3], "curta_incerta"],
  [
    "Socorro, minha mãe desmaiou e não acorda. (0,65 / -0,3)",
    [" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3],
    "silencio",
  ],
];

describe("os quatro perfis do revisor viram urgentes (R2 de d1a15f6, M3)", () => {
  it.each(PERFIS_DO_REVISOR)(
    "%s: sem fala pelas travas, com o tipo da urgencia e sem o texto",
    async (_nome, perfil, motivo) => {
      const espiao = espiarLog();
      // As travas continuam descartando (a calibragem e da prova paga).
      expect(avaliarTranscricao({ segmentos: [segmento(perfil)] })).toEqual({
        tipo: "sem_fala",
        motivo,
      });
      // ...e a lista deterministica acha a urgencia no texto descartado.
      const esperada = tipoDaUrgencia(perfil[0]);
      const r = await transcrever(verboso([segmento(perfil)]));
      expect(r).toEqual({
        tipo: "sem_fala",
        segundos: 16,
        uso: { modelo: "whisper-1", segundos: 16 },
        urgencia: esperada,
      });
      expect(TIPOS_DE_URGENCIA).toContain(r.tipo === "sem_fala" ? r.urgencia : null);
      semOTexto(r, espiao, [perfil[0]]);
      // Nem a urgencia vai ao log (e dado de saude derivado do texto).
      expect(espiao.escrito.join("")).not.toMatch(/urgencia|fisica|risco_de_vida/);
      expect(espiao.campos().join("")).not.toMatch(/urgencia|fisica|risco_de_vida/);
    },
  );
});

describe("o texto descartado: o que vira e o que nao vira urgente", () => {
  it("o Ok. inventado no silencio (0,92 / -0,35) nao vira urgente: o sem fala de sempre", async () => {
    const espiao = espiarLog();
    const r = await transcrever(verboso([segmento([" Ok.", 0.92, -0.35])]));
    expect(r).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
    expect(Object.keys(r)).not.toContain("urgencia");
    semOTexto(r, espiao, [" Ok."]);
  });

  it.each([
    [
      "o socorro com o fim de video",
      [
        [" Socorro, minha mãe desmaiou.", 0.1, -0.3],
        [" Obrigado por assistir.", 0.1, -0.2],
      ] as Perfil[],
    ],
    [
      "a marca de musica com a dor no peito",
      [
        [" [Música]", 0.1, -0.3],
        [" Tô com uma dor muito forte no peito.", 0.1, -0.2],
      ] as Perfil[],
    ],
  ])(
    "a frase-fantasma com uma frase urgente junto (%s): sem fala pela frase-fantasma, e urgente",
    async (_nome, perfis) => {
      const espiao = espiarLog();
      const segmentos = perfis.map(segmento);
      expect(avaliarTranscricao({ segmentos })).toEqual({
        tipo: "sem_fala",
        motivo: "frase_fantasma",
      });
      const r = await transcrever(verboso(segmentos));
      expect(r).toEqual({
        tipo: "sem_fala",
        segundos: 16,
        uso: { modelo: "whisper-1", segundos: 16 },
        urgencia: tipoDaUrgencia(perfis.map((p) => p[0]).join(" ")),
      });
      semOTexto(r, espiao, perfis.map((p) => p[0]));
    },
  );

  it("o segmento urgente no ruido junto da fala real: a transcricao so com a fala real, e urgente (o portao nunca ve o descartado)", async () => {
    const espiao = espiarLog();
    const r = await transcrever(
      verboso([
        segmento([" Quero marcar uma consulta.", 0.1, -0.3]),
        segmento([" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3]),
      ]),
    );
    expect(r).toEqual({
      tipo: "transcrita",
      texto: "Quero marcar uma consulta.",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
      urgencia: tipoDaUrgencia("Socorro, minha mãe desmaiou e não acorda."),
    });
    // O texto que passou nao tem urgencia (o portao do laco nao a acharia);
    // o descartado nunca sai, nem no resultado, nem no log. O que passou
    // tambem nunca vai ao log.
    expect(detectarUrgencia(["Quero marcar uma consulta."])).toBeNull();
    semOTexto(r, espiao, [" Socorro, minha mãe desmaiou e não acorda."]);
    semOTextoNoLog(espiao, [" Quero marcar uma consulta."]);
  });

  it("a fala real sem urgencia: a transcricao de sempre, sem o campo", async () => {
    const espiao = espiarLog();
    const r = await transcrever(
      verboso([segmento([" Quero marcar uma limpeza de pele no sábado.", 0.05, -0.2])]),
    );
    expect(r).toEqual({
      tipo: "transcrita",
      texto: "Quero marcar uma limpeza de pele no sábado.",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
    expect(espiao.escrito.join("")).not.toContain("limpeza");
  });

  it("a negacao continua valendo no texto descartado: 'nao estou com dor no peito' nao vira urgente", async () => {
    espiarLog();
    const texto = " Não, não estou com dor no peito.";
    expect(detectarUrgencia([texto])).toBeNull();
    const r = await transcrever(verboso([segmento([texto, 0.7, -0.3])]));
    expect(r).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
    });
  });

  it("a resposta sem segmentos (sem fala, a falha fechada das travas): a urgencia pelo texto da resposta", async () => {
    const espiao = espiarLog();
    const texto = "Socorro, minha mãe desmaiou e não acorda.";
    const r = await transcrever({ ...verboso([]), text: texto });
    expect(r).toEqual({
      tipo: "sem_fala",
      segundos: 16,
      uso: { modelo: "whisper-1", segundos: 16 },
      urgencia: tipoDaUrgencia(texto),
    });
    semOTexto(r, espiao, [texto]);
  });

  it("o resultado com urgencia so tem o tipo: nenhum campo novo de texto", async () => {
    espiarLog();
    const r = await transcrever(verboso([segmento([" Quero morrer.", 0.35, -0.4])]));
    expect(Object.keys(r).sort()).toEqual(["segundos", "tipo", "urgencia", "uso"]);
    expect(typeof (r as { urgencia?: unknown }).urgencia).toBe("string");
  });
});
