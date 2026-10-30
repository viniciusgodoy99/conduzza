import { InternalServerError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

// Os tetos de tokens do leitor como se a prova paga os tivesse medido (os
// mesmos do cenario do executor, 1.600 e 1.800): sem eles o corte do laco
// nao tem o pior caso do arquivo. O leitor de verdade continua o mesmo.
vi.mock("@/lib/integrations/llm/leitor-de-midia", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/llm/leitor-de-midia")>()),
  TETO_DE_TOKENS_POR_IMAGEM: 1_600,
  TETO_DE_TOKENS_POR_PAGINA: 1_800,
}));

import { usoEstimadoDoLeitor } from "@/lib/agente/gasto";
import {
  executarTurnoDoAgente,
  FOLGA_DO_CORTE_DA_MIDIA_MS,
  PRAZO_DO_TURNO_MS,
  RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS,
  RESERVA_DO_FILTRO_MS,
} from "@/lib/agente/laco";
import {
  FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
  itensDoCatalogo,
  MARGEM_ENTRE_OS_CORTES_MS,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA,
  prazoParaAIntegracao,
  type PortaDaMidia,
} from "@/lib/agente/midia";
import { custoEmMicrodolar, USO_ZERADO } from "@/lib/agente/uso";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import {
  FOLGA_DO_CORTE_DO_LEITOR_MS,
  lerArquivoComOModelo,
  MAXIMO_DE_CHAMADAS_DO_LEITOR,
  type ClienteDoLeitor,
} from "@/lib/integrations/llm/leitor-de-midia";
import {
  transcreverAudio,
  type ClienteDaTranscricao,
  type ResultadoDaTranscricaoNoModelo,
} from "@/lib/integrations/llm/transcricao";

import {
  agenteQueResponde,
  AUDIO,
  CLINICA,
  FOTO,
  fotoNoLaco,
  linhaDeMidia,
  portaFalsa,
  PRECO_DO_WHISPER_POR_MINUTO,
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
  type OpcoesDoCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// AG6b, revisao da JUNCAO entre o leitor, a transcricao e o motor (frente
// F6). Ponta a ponta pelo executor: o laco, a porta e a integracao DE
// VERDADE (lerArquivoComOModelo e transcreverAudio), so o cliente da OpenAI
// falso (nenhum teste chama a OpenAI: o pacote e o stub e a rede e recusada).
//
// O defeito: a porta cortava em P e passava o mesmo P a integracao, que
// cortava em P + 0,5 s. Quando a demora era da integracao, a porta cortava
// primeiro, o resultado se perdia com as tentativasSemUso, e a porta
// estimava UMA chamada quando podiam ter sido duas. Agora o corte da
// integracao cai MARGEM_ENTRE_OS_CORTES_MS antes do da porta, e a porta so
// corta (com o pior caso) a integracao que nao respeita nada. Relogio falso:
// nada espera de verdade.

const WHISPER = {
  modelo: "whisper-1",
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  audioPorMinuto: PRECO_DO_WHISPER_POR_MINUTO,
};

/** O prazo final da invocacao da rota da IA (60 s de maxDuration - 5 s). */
const PRAZO_DA_INVOCACAO_MS = 55_000;

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** O relogio falso: o turno, as integracoes e os cortes andam juntos. */
function relogioFalso() {
  vi.useFakeTimers({ now: AGORA, toFake: ["setTimeout", "clearTimeout", "Date"] });
}

/** Nunca responde, nem ao sinal (o pior cliente). */
function pendurado<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function erro500() {
  return new InternalServerError(500, {}, "x", new Headers({ "retry-after-ms": "1" }));
}

/**
 * O cliente da transcricao que falha com 5xx na primeira chamada e nunca
 * responde na segunda (nem ao sinal): a primeira pode ter sido cobrada, e a
 * segunda so termina pelo corte.
 */
function transcricaoQueFalhaEPendura() {
  let chamadas = 0;
  const sinais: AbortSignal[] = [];
  const create = vi.fn(
    (_corpo: unknown, opcoes: { signal: AbortSignal }): Promise<unknown> => {
      chamadas += 1;
      sinais.push(opcoes.signal);
      return chamadas === 1 ? Promise.reject(erro500()) : pendurado();
    },
  );
  const cliente = {
    audio: { transcriptions: { create } },
  } as unknown as ClienteDaTranscricao;
  return { cliente, create, sinais };
}

/** O mesmo, para o leitor (responses.parse). */
function leitorQueFalhaEPendura() {
  let chamadas = 0;
  const sinais: AbortSignal[] = [];
  const parse = vi.fn(
    (_corpo: unknown, opcoes: { signal: AbortSignal }): Promise<unknown> => {
      chamadas += 1;
      sinais.push(opcoes.signal);
      return chamadas === 1 ? Promise.reject(erro500()) : pendurado();
    },
  );
  const cliente = { responses: { parse } } as unknown as ClienteDoLeitor;
  return { cliente, parse, sinais };
}

function rodar(o: OpcoesDoCenario) {
  const cenario = montarCenario(estado, { tempo: () => Date.now(), ...o });
  const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, promessa };
}

const IDS = {
  clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
  conversationId: "c0000000-0000-4000-8000-000000000001",
  jobId: "10000000-0000-4000-8000-000000000001",
};

/** A transcricao de verdade, como o executor de producao a liga na porta. */
function transcricaoDeVerdade(
  cliente: ClienteDaTranscricao,
  recebidas: EntradaDaTranscricaoFalsa[],
) {
  return (t: EntradaDaTranscricaoFalsa & { bytes?: Uint8Array }) => {
    recebidas.push(t);
    return transcreverAudio({
      cliente,
      modelo: "whisper-1",
      bytes: t.bytes ?? new Uint8Array(),
      segundosMedidos: t.segundosMedidos,
      prazoMs: t.prazoMs,
      ids: { ...IDS, messageId: t.messageId },
      sinal: t.sinal,
    });
  };
}

/** O leitor de verdade, como o executor de producao o liga na porta. */
function leitorDeVerdade(
  cliente: ClienteDoLeitor,
  recebidos: EntradaDoLeitorFalso[],
) {
  return (l: EntradaDoLeitorFalso) => {
    recebidos.push(l);
    const completo = l as EntradaDoLeitorFalso &
      Pick<Parameters<typeof lerArquivoComOModelo>[0], "arquivo" | "catalogo">;
    return lerArquivoComOModelo({
      cliente,
      modelo: "gpt-6-luna",
      identificadorDeSeguranca: "b".repeat(64),
      arquivo: completo.arquivo,
      catalogo: completo.catalogo,
      prazoMs: l.prazoMs,
      ids: { ...IDS, messageId: l.messageId, midia: "imagem" },
      sinal: l.sinal,
    });
  };
}

describe("os cortes em ordem: a integracao, a porta e o laco", () => {
  it("o corte duro da integracao cai a margem antes do da porta, e o da porta a folga antes do do laco", () => {
    for (const prazoDoLaco of [2_500, 9_000, 13_500, 16_500, 27_000]) {
      const prazoDaPorta = prazoDoLaco - FOLGA_DO_CORTE_DA_MIDIA_MS;
      for (const folga of [
        FOLGA_DO_CORTE_DO_LEITOR_MS,
        FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
      ]) {
        const corteDaIntegracao = prazoParaAIntegracao(prazoDaPorta, folga) + folga;
        expect(prazoDaPorta - corteDaIntegracao).toBe(MARGEM_ENTRE_OS_CORTES_MS);
        expect(MARGEM_ENTRE_OS_CORTES_MS).toBeGreaterThan(0);
        expect(prazoDoLaco - prazoDaPorta).toBe(FOLGA_DO_CORTE_DA_MIDIA_MS);
      }
    }
  });
});

describe("a transcricao de verdade dentro da porta (o corte dela vence o da porta)", () => {
  it("5xx e depois o cliente pendurado: a transcricao corta sozinha, a porta recebe a tentativa sem uso e o acerto soma as DUAS chamadas", async () => {
    relogioFalso();
    const { cliente, create, sinais } = transcricaoQueFalhaEPendura();
    const recebidas: EntradaDaTranscricaoFalsa[] = [];
    const { cenario, promessa } = rodar({
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcrever: transcricaoDeVerdade(cliente, recebidas),
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    // As duas chamadas sairam; a segunda foi abortada pelo corte da propria
    // transcricao (o sinal dela), nunca pelo da porta nem pelo do laco.
    expect(create).toHaveBeenCalledTimes(MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA);
    expect(sinais[1]?.aborted).toBe(true);
    expect(recebidas[0]?.sinal?.aborted).toBe(false);
    expect(escrito.join("")).not.toContain("ia_midia_cortada");
    expect(escrito.join("")).toContain('"status":"nova_tentativa"');
    // Falha fechada: a passagem e a frase de sempre, nada gravado.
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      motivo_da_falha: "timeout",
    });
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
    // O gasto: a ultima chamada (o prazo: pode ter sido cobrada) e a
    // anterior (o 5xx), cada uma pela duracao medida no preparo.
    const medidos = Math.ceil(Number(recebidas[0]?.segundosMedidos));
    expect(medidos).toBeGreaterThanOrEqual(15);
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linha = (acerto?.p_linhas as Record<string, unknown>[]).find(
      (l) => l.papel === "transcricao",
    );
    expect(linha).toMatchObject({ modelo: "whisper-1" });
    expect(linha?.custo_microdolar).toBe(
      custoEmMicrodolar(USO_ZERADO, WHISPER, 2 * medidos),
    );
  });

  it("a transcricao que nao respeita nada (nunca volta): a porta corta e o acerto conta o pior caso, MAXIMO_DE_CHAMADAS chamadas", async () => {
    relogioFalso();
    const recebidas: EntradaDaTranscricaoFalsa[] = [];
    const { cenario, promessa } = rodar({
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcrever: (t) => {
        recebidas.push(t);
        return pendurado<ResultadoDaTranscricaoNoModelo>();
      },
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    expect(recebidas[0]?.sinal?.aborted).toBe(true);
    expect(escrito.join("")).toContain("ia_midia_cortada");
    expect(decisaoDo(cenario.banco)).toMatchObject({ motivo_da_falha: "timeout" });
    const medidos = Math.ceil(Number(recebidas[0]?.segundosMedidos));
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linha = (acerto?.p_linhas as Record<string, unknown>[]).find(
      (l) => l.papel === "transcricao",
    );
    expect(linha?.custo_microdolar).toBe(
      custoEmMicrodolar(
        USO_ZERADO,
        WHISPER,
        MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * medidos,
      ),
    );
  });
});

describe("o leitor de verdade dentro da porta (o corte dele vence o da porta)", () => {
  const umaChamada = () =>
    usoEstimadoDoLeitor({
      catalogo: itensDoCatalogo(CATALOGO_DA_AG6B),
      tokensDoArquivo: 1_600,
    });

  it("5xx e depois o cliente pendurado: o leitor corta sozinho, a porta recebe a tentativa sem uso e o acerto soma as DUAS chamadas", async () => {
    relogioFalso();
    const { cliente, parse, sinais } = leitorQueFalhaEPendura();
    const recebidos: EntradaDoLeitorFalso[] = [];
    const { cenario, promessa } = rodar({
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem", body: "quanto fica?" })],
      lerComOModelo: leitorDeVerdade(cliente, recebidos),
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_INVOCACAO_MS);
    expect(await promessa).toEqual({ ok: true });
    expect(parse).toHaveBeenCalledTimes(MAXIMO_DE_CHAMADAS_DO_LEITOR);
    expect(sinais[1]?.aborted).toBe(true);
    expect(recebidos[0]?.sinal?.aborted).toBe(false);
    expect(escrito.join("")).not.toContain("ia_midia_cortada");
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      motivo_da_falha: "timeout",
    });
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    const estimado = umaChamada();
    expect(estimado).not.toBeNull();
    const [acerto] = cenario.banco.chamadasDe("acertar_gasto_da_ia");
    const linha = (acerto?.p_linhas as Record<string, unknown>[]).find(
      (l) => l.papel === "leitor_de_midia",
    );
    // A ultima (o prazo) e a anterior (o 5xx), cada uma no teto do arquivo.
    expect(linha).toMatchObject({
      modelo: "gpt-6-luna",
      tokens_entrada: 2 * (estimado?.tokensEntrada ?? NaN),
      tokens_saida: 2 * (estimado?.tokensSaida ?? NaN),
    });
  });

  it("a porta que nao respeita nada (a leitura nunca volta): o laco corta e conta o pior caso, MAXIMO_DE_CHAMADAS_DO_LEITOR chamadas", async () => {
    relogioFalso();
    const { porta } = portaFalsa();
    const ler = vi.fn<PortaDaMidia["ler"]>(() => pendurado());
    const classificador: ClassificadorDeEntrada = async () => ({
      tipo: "classificacao",
      classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    });
    const verificador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    });
    const agente = agenteQueResponde("Claro, posso ajudar.");
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
      classificador,
      // O executor sempre passa o modelo do leitor (o do verificador).
      modeloDosClassificadores: "gpt-6-luna",
      midia: { ...porta, ler },
    });
    await vi.advanceTimersByTimeAsync(
      PRAZO_DO_TURNO_MS - RESERVA_DO_FILTRO_MS - RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS,
    );
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
    expect(ler.mock.calls[0]?.[3]?.aborted).toBe(true);
    const estimado = umaChamada();
    expect(r.uso).toContainEqual({
      papel: "leitor_de_midia",
      modelo: "gpt-6-luna",
      uso: {
        tokensEntrada: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensEntrada ?? NaN),
        tokensSaida: MAXIMO_DE_CHAMADAS_DO_LEITOR * (estimado?.tokensSaida ?? NaN),
        tokensCacheLidos: 0,
        tokensCacheGravados: 0,
      },
    });
    expect(agente.create).not.toHaveBeenCalled();
  });
});
