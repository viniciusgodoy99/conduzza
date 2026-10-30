import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

import {
  custoMaximoDaChamada,
  custoMaximoDaTranscricao,
  usoEstimadoDoLeitor,
} from "@/lib/agente/gasto";
import { custoMaximoDoTurno } from "@/lib/agente/laco";
import {
  itensDoCatalogo,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA,
} from "@/lib/agente/midia";
import { MAXIMO_DE_CHAMADAS_DO_LEITOR } from "@/lib/integrations/llm/leitor-de-midia";
import {
  comPrecoDaTranscricao,
  custoEmMicrodolar,
  lerPrecoDaTranscricao,
  linhasDoUso,
  USO_ZERADO,
  type PrecoDoModelo,
} from "@/lib/agente/uso";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";
import {
  AUDIO,
  audioNoLaco,
  FOTO,
  fotoNoLaco,
  linhaDeMidia,
  PAPEIS_DO_USO_NA_AG6B,
  PRECO_DO_WHISPER_POR_MINUTO,
} from "./ag6b-contrato";
import {
  AGORA,
  CATALOGO_DA_AG6B,
  configComMidia,
  EXECUTOR,
  montarCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// AG6b, o GASTO da midia (desenho 5.3): o papel novo de ia_uso (transcricao
// e leitor_de_midia), o custo por segundo (ceil(segundos x por minuto /
// 60)), o preco por minuto numa consulta propria e tolerante, a reserva com
// o pior caso (120 s por audio; o teto de tokens do leitor) e o acerto com
// o uso real. Nenhum teste chama a OpenAI.

const LUNA: PrecoDoModelo = {
  modelo: "gpt-6-luna",
  entrada: 1_000_000,
  saida: 4_000_000,
  cacheLeitura: 100_000,
  cacheEscrita: 0,
};
const WHISPER: PrecoDoModelo = {
  modelo: "whisper-1",
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  audioPorMinuto: PRECO_DO_WHISPER_POR_MINUTO,
};

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o custo da transcricao pelos segundos", () => {
  it("ceil(segundos x por minuto / 60), somado ao dos tokens", () => {
    expect(custoEmMicrodolar(USO_ZERADO, WHISPER, 16)).toBe(1_600);
    expect(custoEmMicrodolar(USO_ZERADO, WHISPER, 15.2)).toBe(1_600);
    expect(custoEmMicrodolar(USO_ZERADO, WHISPER, 1)).toBe(100);
    // Sem segundos (as chamadas de tokens), como antes.
    expect(custoEmMicrodolar(USO_ZERADO, WHISPER)).toBe(0);
    expect(
      custoEmMicrodolar({ ...USO_ZERADO, tokensEntrada: 1_000 }, LUNA),
    ).toBe(1_000);
  });

  it("a linha de ia_uso da transcricao: o papel novo, tokens 0, o custo pelos segundos", () => {
    const { linhas, semPreco } = linhasDoUso({
      clinicId: "c",
      origem: "whatsapp",
      precos: [LUNA, WHISPER],
      usos: [
        { papel: "transcricao", modelo: "whisper-1", uso: USO_ZERADO, segundosDeAudio: 16 },
        {
          papel: "leitor_de_midia",
          modelo: "gpt-6-luna",
          uso: { tokensEntrada: 1_900, tokensSaida: 20, tokensCacheLidos: 0, tokensCacheGravados: 0 },
        },
      ],
    });
    expect(semPreco).toEqual([]);
    expect(linhas).toEqual([
      expect.objectContaining({
        papel: "transcricao",
        modelo: "whisper-1",
        tokens_entrada: 0,
        tokens_saida: 0,
        tokens_cache_lidos: 0,
        tokens_cache_gravados: 0,
        custo_microdolar: 1_600,
      }),
      expect.objectContaining({
        papel: "leitor_de_midia",
        modelo: "gpt-6-luna",
        custo_microdolar: 1_980,
      }),
    ]);
    // Os papeis do CHECK ia_uso_papel_valido da AG6b.
    expect(PAPEIS_DO_USO_NA_AG6B).toContain("transcricao");
    expect(PAPEIS_DO_USO_NA_AG6B).toContain("leitor_de_midia");
  });

  it("o teto de uma transcricao: sem o modelo nos precos ou com o preco zerado, null (o audio nao sai)", () => {
    expect(custoMaximoDaTranscricao(120, "whisper-1", [LUNA, WHISPER])).toBe(12_000);
    expect(custoMaximoDaTranscricao(120, "whisper-1", [LUNA])).toBeNull();
    expect(
      custoMaximoDaTranscricao(120, "whisper-1", [LUNA, { ...WHISPER, audioPorMinuto: 0 }]),
    ).toBeNull();
    expect(
      custoMaximoDaTranscricao(120, "whisper-1", [LUNA, { ...WHISPER, audioPorMinuto: undefined }]),
    ).toBeNull();
  });

  it("o teto do leitor so existe com o teto de tokens medido", () => {
    const itens = itensDoCatalogo(CATALOGO_DA_AG6B);
    expect(usoEstimadoDoLeitor({ catalogo: itens, tokensDoArquivo: null })).toBeNull();
    const uso = usoEstimadoDoLeitor({ catalogo: itens, tokensDoArquivo: 1_600 });
    expect(uso?.tokensSaida).toBe(300);
    expect(uso?.tokensEntrada).toBeGreaterThan(1_600);
  });
});

describe("o preco por minuto, numa consulta propria e tolerante", () => {
  it("le audio_microdolar_por_minuto da linha do modelo", async () => {
    const banco = new BancoEmMemoria();
    banco.linhas("llm_preco").push({ modelo: "whisper-1", audio_microdolar_por_minuto: 6_000 });
    expect(await lerPrecoDaTranscricao(banco.cliente(), "whisper-1")).toBe(6_000);
    expect(await lerPrecoDaTranscricao(banco.cliente(), "outro")).toBeNull();
  });

  it("a coluna que ainda nao existe (42703) ou o erro: null, sem derrubar nada", async () => {
    const banco = new BancoEmMemoria();
    banco.erros.set("llm_preco:select", { code: "42703" });
    expect(await lerPrecoDaTranscricao(banco.cliente(), "whisper-1")).toBeNull();
  });

  it("os precos ganham o por minuto (na linha que existe, ou numa nova)", () => {
    const semPorMinuto = { ...WHISPER, audioPorMinuto: undefined };
    expect(comPrecoDaTranscricao([LUNA, semPorMinuto], "whisper-1", 6_000)).toEqual([
      LUNA,
      { ...semPorMinuto, audioPorMinuto: 6_000 },
    ]);
    expect(comPrecoDaTranscricao([LUNA], "whisper-1", 6_000)).toEqual([
      LUNA,
      {
        modelo: "whisper-1",
        entrada: 0,
        saida: 0,
        cacheLeitura: 0,
        cacheEscrita: 0,
        audioPorMinuto: 6_000,
      },
    ]);
    expect(comPrecoDaTranscricao([LUNA], "whisper-1", null)).toEqual([LUNA]);
  });
});

describe("a reserva do turno com a midia (o pior caso)", () => {
  const base = {
    config: configComMidia(),
    catalogo: CATALOGO_DA_AG6B,
    agoraMs: AGORA,
    fuso: "America/Fortaleza",
    modelo: "gpt-6-luna",
    modeloDosClassificadores: "gpt-6-luna",
    precos: [LUNA, WHISPER],
  };

  it("cada audio conta 120 s e a transcricao conta como 1.000 caracteres nos modelos", () => {
    const sem = custoMaximoDoTurno({
      ...base,
      mensagens: [{ autor: "paciente", texto: "oi" }],
    });
    const com = custoMaximoDoTurno({
      ...base,
      mensagens: [audioNoLaco()],
      midia: {
        aTranscrever: 1,
        modeloDaTranscricao: "whisper-1",
        aLer: [],
        modeloDoLeitor: "gpt-6-luna",
      },
    });
    expect(sem).not.toBeNull();
    expect(com).not.toBeNull();
    // 120 s x US$ 0,006 = 12.000 microdolar por chamada, mais os 1.000
    // caracteres (no pior caso de bytes) no agente, no classificador e no
    // verificador.
    expect((com ?? 0) - (sem ?? 0)).toBeGreaterThan(12_000 + 3 * 4_000 * 1);
  });

  // Revisao da juncao: a nova tentativa e da transcricao e do leitor (o SDK
  // nunca repete): cada chamada pode ser cobrada, e a reserva conta o pior
  // caso honesto. O acerto continua cobrando o real.
  it("cada audio reserva MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO chamadas de 120 s", () => {
    const comAudio = (aTranscrever: number) =>
      custoMaximoDoTurno({
        ...base,
        mensagens: [audioNoLaco()],
        midia: {
          aTranscrever,
          modeloDaTranscricao: "whisper-1",
          aLer: [],
          modeloDoLeitor: "gpt-6-luna",
        },
      });
    const umaChamada = custoMaximoDaTranscricao(120, "whisper-1", [LUNA, WHISPER]);
    expect(umaChamada).toBe(12_000);
    expect(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA).toBe(2);
    // As mesmas mensagens nos dois: a diferenca e so a transcricao.
    expect((comAudio(1) ?? NaN) - (comAudio(0) ?? NaN)).toBe(
      MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * 12_000,
    );
    expect((comAudio(3) ?? NaN) - (comAudio(0) ?? NaN)).toBe(
      3 * MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * 12_000,
    );
  });

  it("cada arquivo reserva MAXIMO_DE_CHAMADAS_DO_LEITOR chamadas no teto do arquivo", () => {
    const comArquivos = (aLer: { tokensDoArquivo: number }[]) =>
      custoMaximoDoTurno({
        ...base,
        mensagens: [fotoNoLaco(FOTO, "quanto fica?")],
        midia: {
          aTranscrever: 0,
          modeloDaTranscricao: "whisper-1",
          aLer,
          modeloDoLeitor: "gpt-6-luna",
        },
      });
    const uso = usoEstimadoDoLeitor({
      catalogo: itensDoCatalogo(CATALOGO_DA_AG6B),
      tokensDoArquivo: 1_600,
    });
    expect(uso).not.toBeNull();
    const umaChamada =
      uso === null ? NaN : custoMaximoDaChamada(uso, "gpt-6-luna", [LUNA, WHISPER]);
    expect(MAXIMO_DE_CHAMADAS_DO_LEITOR).toBe(2);
    expect(
      (comArquivos([{ tokensDoArquivo: 1_600 }]) ?? NaN) - (comArquivos([]) ?? NaN),
    ).toBe(MAXIMO_DE_CHAMADAS_DO_LEITOR * (umaChamada ?? NaN));
  });

  it("o arquivo a ler conta o teto do leitor; sem preco da transcricao, null", () => {
    const comArquivo = custoMaximoDoTurno({
      ...base,
      mensagens: [audioNoLaco()],
      midia: {
        aTranscrever: 0,
        modeloDaTranscricao: "whisper-1",
        aLer: [{ tokensDoArquivo: 1_600 }],
        modeloDoLeitor: "gpt-6-luna",
      },
    });
    expect(comArquivo).not.toBeNull();
    expect(
      custoMaximoDoTurno({
        ...base,
        precos: [LUNA],
        mensagens: [audioNoLaco()],
        midia: {
          aTranscrever: 1,
          modeloDaTranscricao: "whisper-1",
          aLer: [],
          modeloDoLeitor: "gpt-6-luna",
        },
      }),
    ).toBeNull();
  });
});

describe("pelo executor: a reserva e o acerto", () => {
  it("a reserva cobre a transcricao no pior caso; o acerto grava o uso real com o papel novo", async () => {
    const cenario = montarCenario(estado, {
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
    });
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    const [reserva] = cenario.banco.chamadasDe("reservar_gasto_da_ia");
    // Revisao da juncao: as duas chamadas possiveis de 120 s.
    expect(Number(reserva?.p_custo_microdolar)).toBeGreaterThan(
      MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * 12_000,
    );
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linhas = acerto?.p_linhas as Record<string, unknown>[];
    expect(linhas).toContainEqual(
      expect.objectContaining({
        papel: "transcricao",
        modelo: "whisper-1",
        tokens_entrada: 0,
        custo_microdolar: 1_600,
        origem: "whatsapp",
        conversation_id: "c0000000-0000-4000-8000-000000000001",
        job_id: cenario.job.id,
      }),
    );
    expect(escrito.join("")).not.toContain("ia_midia_acima_da_reserva");
  });

  it("o leitor com a nova tentativa: o acerto soma o pior caso de cada chamada anterior sem resposta (tentativasSemUso)", async () => {
    const cenario = montarCenario(estado, {
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem", body: "quanto fica?" })],
      lerComOModelo: async () => ({
        tipo: "falha",
        motivo: "timeout",
        modelo: "gpt-6-luna",
        uso: null,
        tentativasSemUso: 1,
      }),
    });
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    const umaChamada = usoEstimadoDoLeitor({
      catalogo: itensDoCatalogo(CATALOGO_DA_AG6B),
      tokensDoArquivo: 1_600,
    });
    expect(umaChamada).not.toBeNull();
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linha = (acerto?.p_linhas as Record<string, unknown>[]).find(
      (l) => l.papel === "leitor_de_midia",
    );
    // A ultima chamada (o prazo: pode ter sido cobrada) e a anterior.
    expect(linha?.tokens_entrada).toBe(2 * (umaChamada?.tokensEntrada ?? 0));
    expect(linha?.tokens_saida).toBe(2 * (umaChamada?.tokensSaida ?? 0));
  });

  it("a transcricao com a nova tentativa: o acerto soma a duracao medida de cada chamada anterior sem resposta (tentativasSemUso)", async () => {
    const cenario = montarCenario(estado, {
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcricao: {
        [AUDIO]: {
          tipo: "transcrita",
          texto: "Oi, queria saber o valor do hemograma",
          segundos: 16,
          uso: { modelo: "whisper-1", segundos: 16 },
          tentativasSemUso: 1,
        },
      },
    });
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    // A duracao que o preparo mediu (a que a porta passou a transcricao).
    const medidos = Math.ceil(
      Number(
        (cenario.transcrever.mock.calls[0] as unknown as [{ segundosMedidos: number }])[0]
          .segundosMedidos,
      ),
    );
    expect(medidos).toBeGreaterThanOrEqual(15);
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linha = (acerto?.p_linhas as Record<string, unknown>[]).find(
      (l) => l.papel === "transcricao",
    );
    // A ultima (16 s, o que a API devolveu) e a anterior (a duracao medida).
    expect(linha?.custo_microdolar).toBe(
      custoEmMicrodolar(USO_ZERADO, WHISPER, 16 + medidos),
    );
    expect(escrito.join("")).not.toContain("ia_midia_acima_da_reserva");
    expect(escrito.join("")).not.toContain("hemograma");
  });

  it("o uso real acima da reserva vira log so com a contagem", async () => {
    const cenario = montarCenario(estado, {
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcricao: {
        [AUDIO]: {
          tipo: "transcrita",
          texto: "Oi, queria saber o valor",
          segundos: 100_000,
          uso: { modelo: "whisper-1", segundos: 100_000 },
        },
      },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const log = escrito.join("");
    expect(log).toContain("ia_midia_acima_da_reserva");
    expect(log).not.toContain("valor");
  });
});
