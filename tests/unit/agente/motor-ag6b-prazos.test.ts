import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

// As integracoes de verdade so na prova da fiacao de producao
// (dependenciasPadraoDaIa): o Storage e o leitor trocados por falsos que
// guardam o que receberam. Os outros testes injetam as integracoes.
const fiacao = vi.hoisted(() => ({
  storage: [] as { prazoMs?: number; sinal?: unknown }[],
  leitor: [] as { prazoMs?: number; sinal?: unknown }[],
  transcricao: [] as { prazoMs?: number; sinal?: unknown }[],
  bytes: new Uint8Array() as Uint8Array,
}));

vi.mock("@/lib/integrations/storage/arquivo-para-a-ia", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/storage/arquivo-para-a-ia")>()),
  lerArquivoParaAIa: async (_admin: unknown, e: { prazoMs?: number; sinal?: unknown }) => {
    fiacao.storage.push(e);
    return { tipo: "ok", bytes: fiacao.bytes };
  },
}));

vi.mock("@/lib/integrations/llm/leitor-de-midia", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/llm/leitor-de-midia")>()),
  lerArquivoComOModelo: async (e: { prazoMs?: number; sinal?: unknown }) => {
    fiacao.leitor.push(e);
    return { tipo: "falha", motivo: "timeout", modelo: "gpt-6-luna", uso: null };
  },
}));

// Revisao da juncao: a transcricao de verdade tambem trocada (so na prova
// da fiacao), para conferir o prazo e o sinal que o executor passa a ela.
vi.mock("@/lib/integrations/llm/transcricao", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/llm/transcricao")>()),
  transcreverAudio: async (e: { prazoMs?: number; sinal?: unknown }) => {
    fiacao.transcricao.push(e);
    return { tipo: "falhou", motivo: "timeout", uso: null };
  },
}));

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { usoEstimadoDoLeitor } from "@/lib/agente/gasto";
import {
  executarTurnoDoAgente,
  FOLGA_DO_CORTE_DA_MIDIA_MS,
  PRAZO_DO_TURNO_MS,
  RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS,
  RESERVA_DO_FILTRO_MS,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
  itensDoCatalogo,
  MARGEM_ENTRE_OS_CORTES_MS,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA,
  PASSOS_DA_MIDIA,
  portaDaMidiaDoWhatsapp,
  prazoParaAIntegracao,
  PRAZO_MAXIMO_DO_STORAGE_MS,
  RESERVA_DA_GRAVACAO_DA_LEITURA_MS,
  type PortaDaMidia,
} from "@/lib/agente/midia";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS } from "@/lib/domain/conformidade/prazo";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  FOLGA_DO_CORTE_DO_LEITOR_MS,
  MAXIMO_DE_CHAMADAS_DO_LEITOR,
  PRAZO_DO_LEITOR_MS,
  TETO_DE_TOKENS_POR_IMAGEM,
} from "@/lib/integrations/llm/leitor-de-midia";
import {
  FOLGA_DO_CORTE_DA_TRANSCRICAO_MS,
  PRAZO_DA_TRANSCRICAO_MS,
} from "@/lib/integrations/llm/transcricao";
import { PRAZO_DO_ARQUIVO_NO_STORAGE_MS } from "@/lib/integrations/storage/arquivo-para-a-ia";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";
import {
  agenteQueResponde,
  AUDIO,
  audioNoLaco,
  CLINICA,
  CONVERSA,
  FOTO,
  fotoNoLaco,
  JOB,
  jpegSintetico,
  linhaDeMidia,
  mp3Sintetico,
  portaFalsa,
} from "./ag6b-contrato";
import {
  AGORA,
  CATALOGO_DA_AG6B,
  configComMidia,
  decisaoDo,
  EXECUTOR,
  montarCenario,
  type EntradaDaTranscricaoFalsa,
  type EntradaDoLeitorFalso,
  type EntradaDoStorageFalso,
  type OpcoesDoCenario,
} from "./ag6b-executor";

const {
  dependenciasPadraoDaIa,
  executarRespostaComIa,
  PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS,
  RESERVA_DAS_GRAVACOES_MS,
  RESERVA_DO_ENVIO_MS,
  TURNO_SEM_A_MIDIA_MS,
} = await import("@/lib/jobs/responder-com-ia");

// AG6b, revisao do PRAZO da midia (achado medio 1 e baixo 6 da revisao do
// 6eae43d): o corte duro de cada passo da midia (o preparo de cada arquivo,
// a transcricao e a leitura), na porta (com o sinal ate a integracao e o
// gasto da chamada cortada) e de novo no laco (a porta que nao cumpre); o
// Storage com no maximo 8 s; a midia que nunca come o classificador, a
// janela do agente e o filtro; a reserva do envio sempre inteira (a frase
// sai); e a conta do prazo minimo do turno com midia. Os relogios sao
// falsos: nada espera de verdade. Nenhum teste chama a OpenAI.

/** O prazo final da invocacao da rota da IA (60 s de maxDuration - 5 s). */
const PRAZO_DA_INVOCACAO_MS = 55_000;
/** O maior turno possivel (o prazo da invocacao menos o envio e as gravacoes). */
const MAIOR_TURNO_MS =
  PRAZO_DA_INVOCACAO_MS - RESERVA_DO_ENVIO_MS - RESERVA_DAS_GRAVACOES_MS;

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  fiacao.storage = [];
  fiacao.leitor = [];
  fiacao.transcricao = [];
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** O relogio falso: o turno e os cortes andam juntos, sem esperar. */
function relogioFalso() {
  vi.useFakeTimers({ now: AGORA, toFake: ["setTimeout", "clearTimeout", "Date"] });
}

/** Uma promessa que nunca termina e nunca escuta o sinal (o pior caso). */
function nunca<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function rodar(o: OpcoesDoCenario) {
  const cenario = montarCenario(estado, o);
  let horaDaFrase: number | null = null;
  cenario.enviarFrase.mockImplementation(async () => {
    horaDaFrase = Date.now();
    return { ok: true, messageId: "msg-frase" };
  });
  const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, promessa, horaDaFrase: () => horaDaFrase };
}

const audio = () => linhaDeMidia({ id: AUDIO, contentType: "audio" });
const foto = () =>
  linhaDeMidia({ id: FOTO, contentType: "imagem", body: "quanto fica?" });

/** O prazo da midia no comeco do turno de 38 s (o relogio parado). */
const turnoDe38 = MAIOR_TURNO_MS;
const midiaDoAudio =
  turnoDe38 -
  RESERVA_DO_FILTRO_MS -
  RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS -
  PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS;
const midiaDoArquivo =
  turnoDe38 - RESERVA_DO_FILTRO_MS - RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS;

describe("pelo executor: o Storage e o leitor que travam (a porta de verdade)", () => {
  it("o Storage que trava: a midia e cortada no prazo dela, nada e transcrito e a frase sai com a reserva do envio inteira", async () => {
    relogioFalso();
    const recebidos: EntradaDoStorageFalso[] = [];
    const { cenario, promessa, horaDaFrase } = rodar({
      mensagens: [audio()],
      tempo: () => Date.now(),
      lerArquivo: (a) => {
        recebidos.push(a);
        return nunca();
      },
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    // O Storage recebeu no maximo 8 s e o sinal, abortado no corte.
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]?.prazoMs).toBe(PRAZO_MAXIMO_DO_STORAGE_MS);
    expect(recebidos[0]?.sinal?.aborted).toBe(true);
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(cenario.agente.create).not.toHaveBeenCalled();
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    // Falha fechada: a decisao, a passagem e a frase de sempre.
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      escalation_reason: "falha_tecnica",
      motivo_da_falha: "timeout",
    });
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
    // A frase saiu no prazo da midia (o corte), muito antes do fim do turno
    // e com a reserva do envio inteira.
    const hora = horaDaFrase();
    expect(hora).not.toBeNull();
    expect((hora ?? Infinity) - AGORA).toBeLessThanOrEqual(midiaDoAudio);
    expect((hora ?? Infinity) - AGORA).toBeLessThanOrEqual(
      PRAZO_DA_INVOCACAO_MS - RESERVA_DO_ENVIO_MS,
    );
    expect(escrito.join("")).toContain("ia_midia_cortada");
  });

  it("o leitor que trava: o corte da porta no prazo da midia, com o sinal abortado e o pior caso no gasto", async () => {
    relogioFalso();
    const recebidos: EntradaDoLeitorFalso[] = [];
    const { cenario, promessa, horaDaFrase } = rodar({
      mensagens: [foto()],
      tempo: () => Date.now(),
      lerComOModelo: (l) => {
        recebidos.push(l);
        return nunca();
      },
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    expect(recebidos).toHaveLength(1);
    // O leitor recebeu o prazo da midia do arquivo menos a folga do corte do
    // laco (o prazo da porta) e menos a folga do corte dele, a margem e a
    // fatia da gravacao (o corte dele cai antes do da porta, com tempo para a
    // RPC), e o sinal do corte, abortado.
    const prazoDaPorta = midiaDoArquivo - FOLGA_DO_CORTE_DA_MIDIA_MS;
    expect(recebidos[0]?.prazoMs).toBe(
      prazoDaPorta -
        FOLGA_DO_CORTE_DO_LEITOR_MS -
        MARGEM_ENTRE_OS_CORTES_MS -
        RESERVA_DA_GRAVACAO_DA_LEITURA_MS,
    );
    expect(recebidos[0]?.sinal?.aborted).toBe(true);
    // Nada gravado depois do corte; nada do agente.
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(cenario.agente.create).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      motivo_da_falha: "timeout",
    });
    // O leitor nao respeitou nada (a porta cortou): nao se sabe quantas
    // chamadas sairam, o pior caso e MAXIMO_DE_CHAMADAS_DO_LEITOR.
    const umaChamada = usoEstimadoDoLeitor({
      catalogo: itensDoCatalogo(CATALOGO_DA_AG6B),
      tokensDoArquivo: 1_600,
    });
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    expect(acerto?.p_linhas).toContainEqual(
      expect.objectContaining({
        papel: "leitor_de_midia",
        modelo: "gpt-6-luna",
        tokens_entrada: MAXIMO_DE_CHAMADAS_DO_LEITOR * (umaChamada?.tokensEntrada ?? NaN),
        tokens_saida: MAXIMO_DE_CHAMADAS_DO_LEITOR * (umaChamada?.tokensSaida ?? NaN),
      }),
    );
    expect(escrito.join("")).toContain("ia_midia_cortada");
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
    expect((horaDaFrase() ?? Infinity) - AGORA).toBeLessThanOrEqual(midiaDoArquivo);
  });

  it("o leitor que responde DEPOIS do corte: a leitura nunca e gravada", async () => {
    relogioFalso();
    const { cenario, promessa } = rodar({
      mensagens: [foto()],
      tempo: () => Date.now(),
      lerComOModelo: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tipo: "lido",
                leitura: {
                  tipo: "receita",
                  procedimentos: [],
                  codigos: [],
                  foraDoCadastro: 0,
                  confianca: "alta",
                },
                modelo: "gpt-6-luna",
                uso: { tokensEntrada: 1_900, tokensSaida: 20, tokensCacheLidos: 0, tokensCacheGravados: 0 },
              }),
            midiaDoArquivo + 5_000,
          ),
        ),
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS + 10_000);
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    expect(decisaoDo(cenario.banco)).toMatchObject({ motivo_da_falha: "timeout" });
  });

  it("a transcricao que responde DEPOIS do corte: nada gravado, e o gasto pelos segundos medidos", async () => {
    relogioFalso();
    const recebidas: EntradaDaTranscricaoFalsa[] = [];
    const { cenario, promessa } = rodar({
      mensagens: [audio()],
      tempo: () => Date.now(),
      transcrever: (t) => {
        recebidas.push(t);
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tipo: "transcrita",
                texto: "Oi, queria marcar",
                segundos: 16,
                uso: { modelo: "whisper-1", segundos: 16 },
              }),
            midiaDoAudio + 5_000,
          ),
        );
      },
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS + 10_000);
    expect(await promessa).toEqual({ ok: true });
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]?.sinal?.aborted).toBe(true);
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(decisaoDo(cenario.banco)).toMatchObject({ motivo_da_falha: "timeout" });
    // A transcricao cortada entra com os segundos medidos no preparo.
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    expect(acerto?.p_linhas).toContainEqual(
      expect.objectContaining({ papel: "transcricao", modelo: "whisper-1" }),
    );
    expect(escrito.join("")).not.toContain("marcar");
  });

  it("no caminho de sempre o Storage recebe no maximo 8 s e o sinal do corte", async () => {
    const { cenario, promessa } = rodar({ mensagens: [audio()] });
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.lerArquivo).toHaveBeenCalledWith(
      expect.objectContaining({
        prazoMs: PRAZO_MAXIMO_DO_STORAGE_MS,
        sinal: expect.any(AbortSignal),
      }),
    );
    // A transcricao recebe o resto do prazo da midia do audio (o
    // classificador, a janela do agente e o filtro ficam de fora), menos a
    // folga do corte do laco e, na porta, a folga do corte dela e a margem
    // (o corte da transcricao cai antes do da porta).
    expect(cenario.transcrever.mock.calls[0]?.[0]).toMatchObject({
      prazoMs: prazoParaAIntegracao(
        midiaDoAudio - FOLGA_DO_CORTE_DA_MIDIA_MS,
        FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
      ),
      sinal: expect.any(AbortSignal),
    });
  });
});

describe("no laco: a porta que nao cumpre o prazo (o corte do laco)", () => {
  const CATALOGO = montarCatalogoDoAgente({
    procedimentos: [],
    vinculos: [],
    profissionais: [],
    convenios: [],
  });
  const LIMPO: ResultadoDoClassificador = {
    tipo: "classificacao",
    classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 },
  };
  const classificador: ClassificadorDeEntrada = async () => LIMPO;
  const verificador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: null,
  });
  function config(): ConfigDoAgente {
    const base = configPadraoDoAgente();
    return {
      ...base,
      habilidades: { ...base.habilidades, ler_audio: true, ler_imagem_e_documento: true },
    };
  }
  function turno(mensagens: MensagemDaConversa[], extra: Partial<EntradaDoTurno>) {
    const agente = agenteQueResponde("Claro, posso ajudar.");
    const promessa = executarTurnoDoAgente({
      cliente: agente.cliente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: config(),
      catalogo: CATALOGO,
      mensagens,
      agoraMs: AGORA,
      fuso: "America/Fortaleza",
      verificador,
      classificador,
      ...extra,
    });
    return { promessa, agente };
  }
  /** O prazo da midia no comeco do turno padrao (45 s, o relogio parado). */
  const midiaDoAudioNoLaco =
    PRAZO_DO_TURNO_MS -
    RESERVA_DO_FILTRO_MS -
    RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS -
    PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS;

  it("o preparo que trava: o laco corta no prazo da midia; falha tecnica, sem transcrever", async () => {
    relogioFalso();
    const { porta, transcrever } = portaFalsa();
    const preparar = vi.fn<PortaDaMidia["preparar"]>(() => nunca());
    const { promessa, agente } = turno([audioNoLaco()], {
      midia: { ...porta, preparar },
    });
    await vi.advanceTimersByTimeAsync(midiaDoAudioNoLaco);
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.transcricaoFalhou);
    // A porta recebeu o prazo menos a folga e o sinal, abortado no corte.
    const [, prazo, sinal] = preparar.mock.calls[0] ?? [];
    expect(prazo).toBe(midiaDoAudioNoLaco - FOLGA_DO_CORTE_DA_MIDIA_MS);
    expect(sinal?.aborted).toBe(true);
    expect(transcrever).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
    expect(r.midiaNaoLida).toBe(true);
  });

  it("a transcricao que trava: o laco corta, com o gasto pelos segundos no pior caso (nao se sabe quantas chamadas sairam)", async () => {
    relogioFalso();
    const { porta } = portaFalsa();
    const transcrever = vi.fn<PortaDaMidia["transcrever"]>(() => nunca());
    const { promessa, agente } = turno([audioNoLaco()], {
      midia: { ...porta, transcrever },
    });
    await vi.advanceTimersByTimeAsync(midiaDoAudioNoLaco);
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
    expect(transcrever.mock.calls[0]?.[2]?.aborted).toBe(true);
    // Revisao da juncao: MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO chamadas de 15 s
    // (a mesma conta da reserva), nunca uma so.
    expect(r.uso).toContainEqual(
      expect.objectContaining({
        papel: "transcricao",
        segundosDeAudio: MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * 15,
      }),
    );
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("a leitura que trava: o laco corta no prazo do arquivo (o classificador ja rodou)", async () => {
    relogioFalso();
    const { porta } = portaFalsa();
    const ler = vi.fn<PortaDaMidia["ler"]>(() => nunca());
    const { promessa, agente } = turno([fotoNoLaco(FOTO, "quanto fica?")], {
      midia: { ...porta, ler },
    });
    const midiaDoArquivoNoLaco =
      PRAZO_DO_TURNO_MS - RESERVA_DO_FILTRO_MS - RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS;
    await vi.advanceTimersByTimeAsync(midiaDoArquivoNoLaco);
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.leituraFalhou);
    const [, , prazo, sinal] = ler.mock.calls[0] ?? [];
    expect(prazo).toBe(midiaDoArquivoNoLaco - FOLGA_DO_CORTE_DA_MIDIA_MS);
    expect(sinal?.aborted).toBe(true);
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("a porta que lanca: falha fechada, sem derrubar o turno", async () => {
    const { porta } = portaFalsa();
    const ler = vi.fn<PortaDaMidia["ler"]>(async () => {
      throw new Error("porta quebrada");
    });
    const { promessa } = turno([fotoNoLaco(FOTO, "quanto fica?")], {
      midia: { ...porta, ler },
    });
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(escrito.join("")).not.toContain("porta quebrada");
  });

  it("o turno curto demais para a midia: falha por prazo, sem chamar a porta", async () => {
    const { porta, preparar } = portaFalsa();
    const curto =
      RESERVA_DO_FILTRO_MS +
      RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS +
      PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS +
      500;
    const { promessa } = turno([audioNoLaco()], { midia: porta, prazoMs: curto });
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "prazo" });
    expect(preparar).not.toHaveBeenCalled();
  });
});

describe("a conta do prazo minimo do turno com midia (achado baixo 6)", () => {
  it("o minimo cobre o que a midia nunca usa e o modelo no pior caso (com a fatia da gravacao), e cabe no maior turno", () => {
    // O que a midia nunca usa: o filtro, a janela do agente e o
    // classificador que vem depois da transcricao.
    expect(TURNO_SEM_A_MIDIA_MS).toBe(
      RESERVA_DO_FILTRO_MS +
        RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS +
        PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS,
    );
    // O modelo da midia no pior caso (revisao da juncao e segunda rodada): o
    // prazo dele e os cortes em ordem, o duro da integracao (a folga dela),
    // a margem e a fatia da gravacao da leitura antes do da porta (R3 de
    // d1a15f6, 1) e o do laco (a folga do laco).
    const folgaDaIntegracao = Math.max(
      FOLGA_DO_CORTE_DA_TRANSCRICAO_MS,
      FOLGA_DO_CORTE_DO_LEITOR_MS,
    );
    const modeloNoPiorCaso =
      Math.max(PRAZO_DA_TRANSCRICAO_MS, PRAZO_DO_LEITOR_MS) +
      folgaDaIntegracao +
      MARGEM_ENTRE_OS_CORTES_MS +
      RESERVA_DA_GRAVACAO_DA_LEITURA_MS +
      FOLGA_DO_CORTE_DA_MIDIA_MS;
    expect(modeloNoPiorCaso).toBe(15_000);
    // O minimo (36 s, a medir na prova paga) cobre o pior caso do modelo; o
    // Storage, no minimo exato, sai do prazo da integracao (a fatia da
    // gravacao saiu dele, e o minimo nao subiu: a margem de 2 s antes do
    // turno, comentario de PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS).
    const folga =
      PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS - TURNO_SEM_A_MIDIA_MS - modeloNoPiorCaso;
    expect(folga).toBeGreaterThanOrEqual(0);
    expect(PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS).toBe(36_000);
    // No maior turno, o Storage tem ate 2 s com o prazo inteiro do modelo.
    expect(MAIOR_TURNO_MS - TURNO_SEM_A_MIDIA_MS - modeloNoPiorCaso).toBe(2_000);
    // O minimo nunca passa do maior turno possivel (senao o turno com
    // midia nunca comecaria) nem do prazo do turno.
    expect(PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS).toBeLessThanOrEqual(MAIOR_TURNO_MS);
    expect(PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS).toBeLessThanOrEqual(PRAZO_DO_TURNO_MS);
    // O que NAO cabe (depende da prova paga, D-100): o Storage no pior caso
    // proposto junto com o modelo no pior caso. Documentado, e a midia e
    // cortada no prazo dela.
    expect(
      TURNO_SEM_A_MIDIA_MS + PRAZO_DO_ARQUIVO_NO_STORAGE_MS + modeloNoPiorCaso,
    ).toBeGreaterThan(MAIOR_TURNO_MS);
  });

  it("no minimo exato a transcricao recebe o prazo inteiro dela (o relogio parado); no maior turno, com 2 s para o Storage; um milissegundo abaixo do minimo, volta para a fila sem custo", async () => {
    const noMinimo = rodar({
      mensagens: [audio()],
      prazoFinalMs:
        AGORA +
        PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS +
        RESERVA_DO_ENVIO_MS +
        RESERVA_DAS_GRAVACOES_MS,
    });
    expect(await noMinimo.promessa).toEqual({ ok: true });
    // O prazo que a integracao recebe ja e o das chamadas dela (o corte duro
    // dela vem depois e, com a margem e a fatia da gravacao, o da porta). No
    // minimo exato (o relogio deste teste fica parado: o Storage nao gasta
    // nada), o inteiro; o Storage de verdade sai dele (R3 de d1a15f6, 1).
    const prazo = Number(noMinimo.cenario.transcrever.mock.calls[0]?.[0]?.prazoMs);
    expect(prazo).toBe(PRAZO_DA_TRANSCRICAO_MS);

    const noMaior = rodar({
      mensagens: [audio()],
      prazoFinalMs: AGORA + PRAZO_DA_INVOCACAO_MS,
    });
    expect(await noMaior.promessa).toEqual({ ok: true });
    const prazoNoMaior = Number(
      noMaior.cenario.transcrever.mock.calls[0]?.[0]?.prazoMs,
    );
    expect(prazoNoMaior - 2_000).toBe(PRAZO_DA_TRANSCRICAO_MS);

    const abaixo = rodar({
      mensagens: [audio()],
      prazoFinalMs:
        AGORA +
        PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS +
        RESERVA_DO_ENVIO_MS +
        RESERVA_DAS_GRAVACOES_MS -
        1,
    });
    expect(await abaixo.promessa).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "orcamento_da_passagem",
    });
    expect(abaixo.cenario.banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
  });
});

describe("a fiacao de producao (dependenciasPadraoDaIa)", () => {
  it("o Storage recebe no maximo o prazo dele; o Storage e o leitor recebem o sinal do corte", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    fiacao.bytes = jpegSintetico();
    const deps = dependenciasPadraoDaIa({
      admin: new BancoEmMemoria().cliente(),
      prazoFinalMs: Date.now() + PRAZO_DA_INVOCACAO_MS,
    });
    const porta = deps.midia?.criarPorta({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      jobId: JOB,
      workerId: EXECUTOR,
      identificador: "a".repeat(64),
      mascarar: (t) => t,
    });
    expect(porta).toBeDefined();
    if (porta === undefined) {
      return;
    }
    const [pronta] = await porta.preparar(
      [
        {
          messageId: FOTO,
          midia: "imagem",
          mediaUrl: `storage://midia-conversas/${CLINICA}/${FOTO}`,
          mimetype: "image/jpeg",
        },
      ],
      30_000,
    );
    expect(fiacao.storage[0]?.prazoMs).toBe(PRAZO_DO_ARQUIVO_NO_STORAGE_MS);
    expect(fiacao.storage[0]?.sinal).toBeInstanceOf(AbortSignal);
    expect(pronta?.tipo).toBe("arquivo");
    if (pronta?.tipo !== "arquivo") {
      return;
    }
    const lida = await porta.ler(pronta, [], 30_000);
    expect(lida.tipo).toBe("falhou");
    expect(fiacao.leitor[0]?.prazoMs).toBe(PRAZO_DO_LEITOR_MS);
    expect(fiacao.leitor[0]?.sinal).toBeInstanceOf(AbortSignal);
  });

  it("a transcricao recebe o sinal do corte e, com prazo curto, o prazo que poe o corte dela antes do da porta", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    fiacao.bytes = mp3Sintetico(15);
    const deps = dependenciasPadraoDaIa({
      admin: new BancoEmMemoria().cliente(),
      prazoFinalMs: Date.now() + PRAZO_DA_INVOCACAO_MS,
    });
    const porta = deps.midia?.criarPorta({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      jobId: JOB,
      workerId: EXECUTOR,
      identificador: "a".repeat(64),
      mascarar: (t) => t,
    });
    expect(porta).toBeDefined();
    if (porta === undefined) {
      return;
    }
    const [pronta] = await porta.preparar(
      [
        {
          messageId: AUDIO,
          midia: "audio",
          mediaUrl: `storage://midia-conversas/${CLINICA}/${AUDIO}`,
          mimetype: "audio/mpeg",
        },
      ],
      30_000,
    );
    expect(pronta?.tipo).toBe("audio");
    if (pronta?.tipo !== "audio") {
      return;
    }
    // Prazo largo: o teto da transcricao.
    expect((await porta.transcrever(pronta, 30_000)).tipo).toBe("falhou");
    expect(fiacao.transcricao[0]?.prazoMs).toBe(PRAZO_DA_TRANSCRICAO_MS);
    expect(fiacao.transcricao[0]?.sinal).toBeInstanceOf(AbortSignal);
    // Prazo curto: o corte duro da transcricao (o prazo dela mais a folga)
    // cai a margem e a fatia da gravacao antes do corte da porta.
    await porta.transcrever(pronta, 9_000);
    const curto = Number(fiacao.transcricao[1]?.prazoMs);
    expect(
      curto +
        FOLGA_DO_CORTE_DA_TRANSCRICAO_MS +
        MARGEM_ENTRE_OS_CORTES_MS +
        RESERVA_DA_GRAVACAO_DA_LEITURA_MS,
    ).toBe(9_000);
    expect(fiacao.transcricao[1]?.sinal).toBeInstanceOf(AbortSignal);
  });
});

// Segunda rodada da revisao (R3 de d1a15f6, 1): a gravacao da leitura
// (gravar_leitura_da_midia trava a mensagem e a conversa) tem uma fatia
// propria do prazo da porta, descontada do prazo da integracao. O caso do
// revisor: a integracao responde 10 ms antes do prazo DELA e a RPC leva
// 1,1 s. Antes, a porta cortava com a RPC no ar (falhou) e a RPC gravava
// assim mesmo; agora a resposta e coerente: gravou e devolve o resultado.
describe("a gravacao da leitura cabe no prazo da porta (R3 de d1a15f6, 1)", () => {
  /** O admin cuja RPC grava depois de `demoraMs` (a trava no banco). */
  function adminQueDemora(demoraMs: number) {
    const gravadas: unknown[] = [];
    const admin = {
      rpc: (nome: string, args: Record<string, unknown>) =>
        new Promise((resolve) =>
          setTimeout(() => {
            if (nome === "gravar_leitura_da_midia") {
              gravadas.push(args.p_transcricao ?? args.p_tipo);
            }
            resolve({ data: { ok: true, reutilizado: false, id: "x" }, error: null });
          }, demoraMs),
        ),
    } as unknown as SupabaseClient;
    return { admin, gravadas };
  }

  function portaDeVerdade(
    admin: SupabaseClient,
    integracoes: Partial<
      Pick<
        Parameters<typeof portaDaMidiaDoWhatsapp>[1],
        "transcrever" | "lerComOModelo"
      >
    >,
  ) {
    return portaDaMidiaDoWhatsapp(admin, {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      jobId: JOB,
      workerId: EXECUTOR,
      mascarar: (t) => t,
      lerArquivo: async () => ({ tipo: "ok", bytes: new Uint8Array() }),
      transcrever:
        integracoes.transcrever ??
        (async () => {
          throw new Error("nao usado");
        }),
      lerComOModelo:
        integracoes.lerComOModelo ??
        (async () => {
          throw new Error("nao usado");
        }),
      versaoDaTranscricao: "transcricao-0123456789ab",
      modeloDoLeitor: "gpt-6-luna",
      modeloDaTranscricao: "whisper-1",
      tetosDoLeitor: { imagem: 1_600, pagina: 1_800 },
    });
  }

  const PRAZO_DA_PORTA = 10_000;
  const AUDIO_PRONTO = {
    tipo: "audio" as const,
    messageId: AUDIO,
    bytes: new Uint8Array(),
    segundos: 10,
  };

  it("o caso do revisor: a transcricao responde 10 ms antes do prazo dela e a RPC leva 1,1 s; gravou e devolve a transcricao", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { admin, gravadas } = adminQueDemora(1_100);
    const recebidos: number[] = [];
    const porta = portaDeVerdade(admin, {
      transcrever: (t) => {
        recebidos.push(t.prazoMs);
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tipo: "transcrita",
                texto: "texto do paciente",
                segundos: 10,
                uso: { modelo: "whisper-1", segundos: 10 },
              }),
            t.prazoMs - 10,
          ),
        );
      },
    });
    const promessa = porta.transcrever(AUDIO_PRONTO, PRAZO_DA_PORTA);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_PORTA + 1_000);
    const r = await promessa;
    // A integracao recebeu o prazo da porta sem a folga dela, a margem e a
    // fatia da gravacao.
    expect(recebidos).toEqual([
      PRAZO_DA_PORTA -
        FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS -
        MARGEM_ENTRE_OS_CORTES_MS -
        RESERVA_DA_GRAVACAO_DA_LEITURA_MS,
    ]);
    // Coerente: gravou E devolveu o resultado (nunca "falhou" com a leitura
    // gravada).
    expect(gravadas).toEqual(["texto do paciente"]);
    expect(r).toMatchObject({ tipo: "transcrita", texto: "texto do paciente" });
    expect(escrito.join("")).not.toContain("ia_midia_cortada");
  });

  it("no limite: a transcricao responde 10 ms antes do corte duro dela e a RPC leva 1,9 s (menos que a margem e a fatia); gravou e devolve", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { admin, gravadas } = adminQueDemora(
      MARGEM_ENTRE_OS_CORTES_MS + RESERVA_DA_GRAVACAO_DA_LEITURA_MS - 100,
    );
    const porta = portaDeVerdade(admin, {
      transcrever: (t) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tipo: "sem_fala",
                segundos: 10,
                uso: { modelo: "whisper-1", segundos: 10 },
              }),
            t.prazoMs + FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS - 10,
          ),
        ),
    });
    const promessa = porta.transcrever(AUDIO_PRONTO, PRAZO_DA_PORTA);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_PORTA + 1_000);
    const r = await promessa;
    expect(gravadas).toEqual(["sem_fala"]);
    expect(r).toMatchObject({ tipo: "sem_fala", urgencia: null });
  });

  it("o leitor: responde 10 ms antes do prazo dele e a RPC leva 1,1 s; gravou e devolve a leitura", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { admin, gravadas } = adminQueDemora(1_100);
    const recebidos: number[] = [];
    const porta = portaDeVerdade(admin, {
      lerComOModelo: (l) => {
        recebidos.push(l.prazoMs);
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                tipo: "lido",
                leitura: {
                  tipo: "receita",
                  procedimentos: [],
                  codigos: [],
                  foraDoCadastro: 0,
                  confianca: "alta",
                },
                modelo: "gpt-6-luna",
                uso: {
                  tokensEntrada: 1_900,
                  tokensSaida: 20,
                  tokensCacheLidos: 0,
                  tokensCacheGravados: 0,
                },
              }),
            l.prazoMs - 10,
          ),
        );
      },
    });
    const promessa = porta.ler(
      {
        tipo: "arquivo",
        messageId: FOTO,
        midia: "imagem",
        arquivo: { tipo: "imagem", formato: "jpeg", bytes: jpegSintetico() },
        paginas: 1,
      },
      [],
      PRAZO_DA_PORTA,
    );
    await vi.advanceTimersByTimeAsync(PRAZO_DA_PORTA + 1_000);
    const r = await promessa;
    expect(recebidos).toEqual([
      PRAZO_DA_PORTA -
        FOLGA_DO_CORTE_DO_LEITOR_MS -
        MARGEM_ENTRE_OS_CORTES_MS -
        RESERVA_DA_GRAVACAO_DA_LEITURA_MS,
    ]);
    expect(gravadas).toEqual(["receita"]);
    expect(r).toMatchObject({ tipo: "lido", leitura: { tipo: "receita" } });
  });
});

// Segunda rodada da revisao (R3 de d1a15f6, 2): o corte da leitura pelo
// laco contava o pior caso do arquivo pelas CONSTANTES do modulo do leitor
// (nulas ate a prova paga), e nao pelos tetos que o executor injeta no
// plano, na reserva e na porta: o gasto do arquivo sumia do acerto. Os
// testes de antes so passavam com o vi.mock das constantes. Aqui, sem
// vi.mock: as constantes continuam nulas.
describe("o corte do laco no leitor pelos tetos injetados (R3 de d1a15f6, 2)", () => {
  const LIMPO: ResultadoDoClassificador = {
    tipo: "classificacao",
    classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: null,
  };
  const verificador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: null,
  });
  const umaChamada = (tokensDoArquivo: number) =>
    usoEstimadoDoLeitor({
      catalogo: itensDoCatalogo(CATALOGO_DA_AG6B),
      tokensDoArquivo,
    });

  it.each([
    [
      "a foto (o teto da imagem)",
      { tipo: "imagem", formato: "jpeg", bytes: jpegSintetico() } as const,
      1,
      1_600,
    ],
    [
      "o PDF de 3 paginas (o teto da pagina, 3 vezes)",
      { tipo: "pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) } as const,
      3,
      3 * 1_800,
    ],
  ])(
    "o caso do revisor, %s: a porta que nao volta; o laco corta e conta o pior caso pelos tetos do executor",
    async (_nome, arquivo, paginas, tokensDoArquivo) => {
      relogioFalso();
      expect(TETO_DE_TOKENS_POR_IMAGEM).toBeNull();
      const { porta } = portaFalsa({
        preparo: {
          [FOTO]: {
            tipo: "arquivo",
            messageId: FOTO,
            midia: arquivo.tipo === "pdf" ? "documento" : "imagem",
            arquivo,
            paginas,
          },
        },
      });
      const ler = vi.fn<PortaDaMidia["ler"]>(() => nunca());
      const agente = agenteQueResponde("Claro.");
      const promessa = executarTurnoDoAgente({
        cliente: agente.cliente,
        modelo: "gpt-6-luna",
        clinicId: CLINICA,
        identificadorDeSeguranca: "a".repeat(64),
        config: configComMidia(),
        catalogo: CATALOGO_DA_AG6B,
        mensagens: [fotoNoLaco(FOTO, "quanto fica?")],
        agoraMs: AGORA,
        fuso: "America/Fortaleza",
        verificador,
        classificador: async () => LIMPO,
        modeloDosClassificadores: "gpt-6-luna",
        midia: { ...porta, ler },
        tetosDoLeitor: { imagem: 1_600, pagina: 1_800 },
      });
      await vi.advanceTimersByTimeAsync(
        PRAZO_DO_TURNO_MS - RESERVA_DO_FILTRO_MS - RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS,
      );
      const r = await promessa;
      expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
      expect(ler).toHaveBeenCalledTimes(1);
      const estimado = umaChamada(tokensDoArquivo);
      expect(estimado).not.toBeNull();
      // O gasto do arquivo nao some: MAXIMO_DE_CHAMADAS_DO_LEITOR chamadas
      // no teto que o executor deu.
      expect(r.uso.filter((u) => u.papel === "leitor_de_midia")).toEqual([
        {
          papel: "leitor_de_midia",
          modelo: "gpt-6-luna",
          uso: {
            tokensEntrada: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensEntrada ?? NaN),
            tokensSaida: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensSaida ?? NaN),
            tokensCacheLidos:
              MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensCacheLidos ?? NaN),
            tokensCacheGravados:
              MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensCacheGravados ?? NaN),
          },
        },
      ]);
      expect(agente.create).not.toHaveBeenCalled();
    },
  );

  it("pelo executor: os tetos do plano e da reserva chegam ao corte do laco, e o acerto conta o pior caso do arquivo", async () => {
    relogioFalso();
    expect(TETO_DE_TOKENS_POR_IMAGEM).toBeNull();
    const ler = vi.fn<PortaDaMidia["ler"]>(() => nunca());
    const { cenario, promessa } = rodar({
      mensagens: [foto()],
      tempo: () => Date.now(),
      // A porta que nao volta (nem ao sinal): so o corte do laco termina.
      midia: { criarPorta: () => ({ ...portaFalsa().porta, ler }) },
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    expect(ler).toHaveBeenCalledTimes(1);
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      motivo_da_falha: "timeout",
    });
    const estimado = umaChamada(1_600);
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    expect(acerto?.p_linhas).toContainEqual(
      expect.objectContaining({
        papel: "leitor_de_midia",
        tokens_entrada: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensEntrada ?? NaN),
        tokens_saida: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensSaida ?? NaN),
      }),
    );
  });
});

// Terceira rodada (RR2 de 88e9560, baixo 6): o executor contava o prazo do
// turno ANTES de umas idas ao banco (o estado, o nascimento, a reserva e o
// turno), e o laco contava do proprio comeco: com o banco lento, o atraso
// saia da reserva das gravacoes e do envio. Agora o laco recebe o instante
// (prazoEmMs), na mesma referencia do executor, e as idas ao banco ficam
// dentro da conta do turno.
describe("o prazo do turno numa referencia so, com o banco lento (RR2 de 88e9560, baixo 6)", () => {
  /** O atraso de cada ida lenta ao banco entre a conta do prazo e o laco. */
  const DEMORA_MS = 1_500;
  const LENTAS = ["ler_atendimento_da_ia", "reservar_gasto_da_ia"] as const;
  const ATRASO_MS = DEMORA_MS * LENTAS.length;

  /** O banco falso lento: estas RPCs so respondem depois de DEMORA_MS. */
  function bancoLento(cenario: ReturnType<typeof montarCenario>) {
    for (const nome of LENTAS) {
      const original = cenario.banco.manipuladores.get(nome);
      cenario.banco.rpc(nome, async (args) => {
        await new Promise((resolve) => setTimeout(resolve, DEMORA_MS));
        return original === undefined ? { data: null, error: null } : original(args);
      });
    }
  }

  it("com midia: a transcricao recebe o prazo que sobra da conta do executor (o atraso do banco sai do turno, nunca das gravacoes)", async () => {
    relogioFalso();
    const recebidos: EntradaDaTranscricaoFalsa[] = [];
    const cenario = montarCenario(estado, {
      mensagens: [audio()],
      tempo: () => Date.now(),
      transcrever: async (t) => {
        recebidos.push(t);
        return {
          tipo: "transcrita",
          texto: "Oi, queria saber o preco do hemograma",
          segundos: 16,
          uso: { modelo: "whisper-1", segundos: 16 },
        };
      },
    });
    bancoLento(cenario);
    const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    // O banco lento de verdade: as duas idas sairam antes do laco.
    for (const nome of LENTAS) {
      expect(cenario.banco.chamadasDe(nome)).toHaveLength(1);
    }
    expect(recebidos).toHaveLength(1);
    // O turno de 38 s conta da conta do executor: o laco comeca 3 s depois,
    // e a midia tem 3 s a menos (antes, o laco contava os 38 s do comeco
    // dele e a integracao recebia o prazo cheio, 3 s alem do turno).
    expect(recebidos[0]?.prazoMs).toBe(
      prazoParaAIntegracao(
        midiaDoAudio - ATRASO_MS - FOLGA_DO_CORTE_DA_MIDIA_MS,
        FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
      ),
    );
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
  });

  it("sem midia: o agente recebe o prazo da chamada pela mesma conta (o turno de 25 s menos o banco lento e a reserva do filtro)", async () => {
    relogioFalso();
    const turno = 25_000;
    const cenario = montarCenario(estado, {
      mensagens: [
        {
          id: "m1",
          clinic_id: CLINICA,
          conversation_id: CONVERSA,
          author: "paciente",
          direction: "entrada",
          content_type: "texto",
          body: "Quanto custa o hemograma?",
          media_url: null,
          deleted_at: null,
          is_internal_note: false,
          pelo_celular: false,
          created_at: "2026-10-13T14:58:30.000Z",
        },
      ],
      tempo: () => Date.now(),
      prazoFinalMs: AGORA + turno + RESERVA_DO_ENVIO_MS + RESERVA_DAS_GRAVACOES_MS,
    });
    bancoLento(cenario);
    const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.agente.create).toHaveBeenCalledTimes(1);
    const opcoes = (cenario.agente.create.mock.calls[0] as unknown[] | undefined)?.[1] as
      | { timeout?: number }
      | undefined;
    // Antes: 25 s do comeco do laco menos o filtro (15 s); o turno acabava
    // 3 s depois do que o executor contou, dentro da reserva das gravacoes.
    expect(opcoes?.timeout).toBe(turno - ATRASO_MS - RESERVA_DO_FILTRO_MS);
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
  });

  it("o laco recebe o instante do executor, e o que vier primeiro vale: o instante ou o comeco mais prazoMs", async () => {
    const { porta } = portaFalsa();
    const agente = agenteQueResponde("Claro, posso ajudar.");
    const preparar = vi.fn<PortaDaMidia["preparar"]>(porta.preparar);
    const entrada = (extra: Partial<EntradaDoTurno>) =>
      executarTurnoDoAgente({
        cliente: agente.cliente,
        modelo: "gpt-6-luna",
        clinicId: CLINICA,
        identificadorDeSeguranca: "a".repeat(64),
        config: configComMidia(),
        catalogo: CATALOGO_DA_AG6B,
        mensagens: [audioNoLaco()],
        agoraMs: AGORA,
        fuso: "America/Fortaleza",
        verificador: async () => ({
          tipo: "veredicto",
          veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
          modelo: "gpt-6-luna",
          uso: null,
        }),
        classificador: async () => ({
          tipo: "classificacao",
          classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
          modelo: "gpt-6-luna",
          uso: null,
        }),
        midia: { ...porta, preparar },
        agora: () => AGORA,
        ...extra,
      });
    // O instante antes do comeco mais prazoMs: vale o instante.
    await entrada({ prazoMs: PRAZO_DO_TURNO_MS, prazoEmMs: AGORA + 30_000 });
    // O comeco mais prazoMs antes do instante: vale o prazoMs.
    await entrada({ prazoMs: 30_000, prazoEmMs: AGORA + PRAZO_DO_TURNO_MS });
    // Sem instante (o simulador), ou invalido: so o prazoMs.
    await entrada({ prazoMs: 30_000 });
    await entrada({ prazoMs: 30_000, prazoEmMs: Number.NaN });
    const semAMidia =
      RESERVA_DO_FILTRO_MS +
      RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS +
      PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS +
      FOLGA_DO_CORTE_DA_MIDIA_MS;
    expect(preparar.mock.calls.map(([, prazo]) => prazo)).toEqual([
      30_000 - semAMidia,
      30_000 - semAMidia,
      30_000 - semAMidia,
      30_000 - semAMidia,
    ]);
  });
});
