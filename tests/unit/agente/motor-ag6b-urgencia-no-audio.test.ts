import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

import {
  executarTurnoDoAgente,
  PASSO_DA_CONFERENCIA_DA_ENTRADA,
  PASSO_DA_URGENCIA,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  PASSOS_DA_MIDIA,
  portaDaMidiaDoWhatsapp,
  urgenciaDaTranscricao,
  type DependenciasDaPortaDoWhatsapp,
  type PortaDaMidia,
} from "@/lib/agente/midia";
import { TEXTO_DO_EVENTO_DA_IA } from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { SegmentoDaTranscricao } from "@/lib/domain/conformidade/qualidade-da-transcricao";
import type { TipoDeUrgencia } from "@/lib/domain/conformidade/urgencia";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  transcreverAudio,
  type ClienteDaTranscricao,
  type ResultadoDaTranscricaoNoModelo,
} from "@/lib/integrations/llm/transcricao";

import type { Resposta } from "../ia-whatsapp/banco-em-memoria";
import { eventosDoFio } from "./ag6-contrato";
import {
  agenteQueResponde,
  AUDIO,
  AUDIO_2,
  audioNoLaco,
  CLINICA,
  CONVERSA,
  JOB,
  linhaDeMidia,
  mp3Sintetico,
  portaFalsa,
  semFala,
  transcrita,
  usoDaTranscricao,
} from "./ag6b-contrato";
import {
  AGORA,
  CATALOGO_DA_AG6B,
  configComMidia,
  decisaoDo,
  EXECUTOR,
  montarCenario,
  type EntradaDaTranscricaoFalsa,
  type OpcoesDoCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// Segunda rodada da revisao (R2 de d1a15f6, M3, MEDIO): a fala curta urgente
// perdia a marca Urgente. As travas da transcricao descartam a fala curta
// incerta ("Quero morrer.", no_speech_prob 0,35) e o segmento no ruido
// ("Socorro, minha mae desmaiou e nao acorda.", 0,65), e o portao do laco so
// ve o texto que passou: a conversa ia para a equipe como midia, sem a
// marca. Agora a transcricao le a urgencia no texto INTEIRO (inclusive o
// descartado) e devolve so o tipo; a porta repassa; o laco passa a conversa
// com o motivo urgencia pelo MESMO caminho da urgencia do 1c (a trilha, a
// decisao, o evento e a marca Urgente do banco). O texto descartado nunca
// sai da integracao. Nenhum teste chama a OpenAI.
//
// Terceira rodada (RR2 de 88e9560, a urgencia do audio em TODOS os
// caminhos): a urgencia que vem na falha da gravacao da leitura (medio 2),
// o job repetido que acha a urgencia de novo (medio 3: a leitura com a
// urgencia so no descartado nao e gravada) e o audio ruim que nao impede
// mais a transcricao dos bons (baixo 7).

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

const USO = { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 };
const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
};
const verificador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
});

/** As palavras de 4 letras ou mais (o texto que nunca pode sair). */
function palavras(texto: string): string[] {
  return texto.split(/[^\p{L}]+/u).filter((p) => p.length >= 4);
}

// ---------------------------------------------------------------------------
// No laco, com a porta falsa
// ---------------------------------------------------------------------------

describe("no laco: o audio com urgencia passa como urgente, pelo caminho do 1c", () => {
  function turno(mensagens: MensagemDaConversa[], extra: Partial<EntradaDoTurno>) {
    const agente = agenteQueResponde("Claro, posso ajudar.");
    const classificador = vi.fn<ClassificadorDeEntrada>(async () => LIMPO);
    const promessa = executarTurnoDoAgente({
      cliente: agente.cliente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: configComMidia(),
      catalogo: CATALOGO_DA_AG6B,
      mensagens,
      agoraMs: AGORA,
      fuso: "America/Fortaleza",
      verificador,
      classificador,
      ...extra,
    });
    return { promessa, agente, classificador };
  }

  it.each(["fisica", "risco_de_vida"] as const)(
    "o sem fala com urgencia (%s): urgencia, com a trilha do 1c, sem classificador nem agente; o audio continua nao lido",
    async (tipo) => {
      const { porta } = portaFalsa({ transcricao: { [AUDIO]: semFala(tipo) } });
      const { promessa, agente, classificador } = turno([audioNoLaco()], {
        midia: porta,
      });
      const r = await promessa;
      expect(r.tipo).toBe("frase_fixa");
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
      expect(r.desfecho).toEqual({
        tipo: "escalou",
        motivo: "urgencia",
        gatilho: "urgencia",
        origem: "portao",
      });
      // A trilha da urgencia do 1c, nunca a do sem fala.
      expect(r.trilha.map((p) => p.texto)).toEqual([
        PASSO_DA_CONFERENCIA_DA_ENTRADA,
        PASSO_DA_URGENCIA,
      ]);
      // A equipe ouve o audio (D-96): ele continua nao lido.
      expect(r.midiaNaoLida).toBe(true);
      expect(classificador).not.toHaveBeenCalled();
      expect(agente.create).not.toHaveBeenCalled();
      expect(r.uso).toEqual([usoDaTranscricao()]);
    },
  );

  it("o sem fala SEM urgencia continua a midia de sempre (o controle)", async () => {
    const { porta } = portaFalsa({ transcricao: { [AUDIO]: semFala(null) } });
    const { promessa } = turno([audioNoLaco()], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "midia_nao_suportada",
      gatilho: "midia",
      origem: "portao",
    });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.semFala);
    expect(r.trilha.map((p) => p.texto)).not.toContain(PASSO_DA_URGENCIA);
  });

  it("a transcricao sem urgencia no texto que passou, com urgencia no descartado: urgencia (o portao sozinho nao a acharia)", async () => {
    const { porta } = portaFalsa({
      transcricao: {
        [AUDIO]: transcrita("Quero marcar uma consulta.", undefined, "fisica"),
      },
    });
    const { promessa, agente, classificador } = turno([audioNoLaco()], {
      midia: porta,
    });
    const r = await promessa;
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "urgencia",
      gatilho: "urgencia",
      origem: "portao",
    });
    expect(r.trilha.map((p) => p.texto)).toEqual([
      PASSOS_DA_MIDIA.transcreveu,
      PASSO_DA_CONFERENCIA_DA_ENTRADA,
      PASSO_DA_URGENCIA,
    ]);
    // O audio foi lido (a parte que passou): a midia nao fica "nao lida".
    expect(r.midiaNaoLida).toBeUndefined();
    expect(classificador).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("a urgencia de um audio vence a falha tecnica do outro: a conversa passa como urgente", async () => {
    const { porta } = portaFalsa({
      transcricao: {
        [AUDIO]: semFala("risco_de_vida"),
        [AUDIO_2]: { tipo: "falhou", motivo: "timeout", uso: usoDaTranscricao() },
      },
    });
    const { promessa, agente } = turno([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: porta,
    });
    const r = await promessa;
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "urgencia",
      gatilho: "urgencia",
      origem: "portao",
    });
    expect(r.trilha.map((p) => p.texto)).toEqual([
      PASSO_DA_CONFERENCIA_DA_ENTRADA,
      PASSO_DA_URGENCIA,
    ]);
    expect(r.trilha.map((p) => p.texto)).not.toContain(
      PASSOS_DA_MIDIA.transcricaoFalhou,
    );
    // O gasto das duas transcricoes entra do mesmo jeito.
    expect(r.uso).toEqual([usoDaTranscricao(), usoDaTranscricao()]);
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("sem urgencia, a falha de um audio continua a falha tecnica (o controle)", async () => {
    const { porta } = portaFalsa({
      transcricao: {
        [AUDIO]: transcrita("Quero marcar uma consulta."),
        [AUDIO_2]: { tipo: "falhou", motivo: "timeout", uso: usoDaTranscricao() },
      },
    });
    const { promessa } = turno([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: porta,
    });
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
    expect(r.trilha.map((p) => p.texto)).toContain(
      PASSOS_DA_MIDIA.transcricaoFalhou,
    );
  });
});

// ---------------------------------------------------------------------------
// Pelo executor, com a transcricao, a porta e o laco de verdade
// ---------------------------------------------------------------------------

type Perfil = [texto: string, noSpeechProb: number, avgLogprob: number];

function segmento([text, noSpeechProb, avgLogprob]: Perfil): SegmentoDaTranscricao {
  return {
    text,
    no_speech_prob: noSpeechProb,
    avg_logprob: avgLogprob,
    compression_ratio: 1.1,
  };
}

/** O cliente da transcricao que devolve o verbose_json com estes segmentos. */
function clienteQueTranscreve(perfis: readonly Perfil[]): ClienteDaTranscricao {
  const segmentos = perfis.map(segmento);
  return {
    audio: {
      transcriptions: {
        create: vi.fn(async () => ({
          text: segmentos.map((s) => s.text).join(""),
          duration: 15.2,
          language: "portuguese",
          segments: segmentos.map((s, i) => ({ id: i, start: i, end: i + 1, ...s })),
          usage: { type: "duration", seconds: 16 },
        })),
      },
    },
  } as unknown as ClienteDaTranscricao;
}

/**
 * O cenario do executor com a transcricao de verdade (so o cliente da OpenAI
 * falso), sem rodar: os testes do job repetido rodam duas vezes.
 */
function cenarioComTranscricao(
  perfis: readonly Perfil[],
  extra: Partial<OpcoesDoCenario> = {},
) {
  const cliente = clienteQueTranscreve(perfis);
  const cenario = montarCenario(estado, {
    mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
    transcrever: (t: EntradaDaTranscricaoFalsa & { bytes?: Uint8Array }) =>
      transcreverAudio({
        cliente,
        modelo: "whisper-1",
        bytes: t.bytes ?? new Uint8Array(),
        segundosMedidos: t.segundosMedidos,
        prazoMs: t.prazoMs,
        ids: {
          clinicId: CLINICA,
          conversationId: CONVERSA,
          jobId: JOB,
          messageId: t.messageId,
        },
        sinal: t.sinal,
      }),
    ...extra,
  });
  // O classificador do cenario, espiado.
  const classificador = vi.fn(cenario.deps.criarClassificador(""));
  cenario.deps.criarClassificador = () => classificador;
  return { cenario, classificador, cliente };
}

/** O executor com a transcricao de verdade (so o cliente da OpenAI falso). */
function rodar(perfis: readonly Perfil[], extra: Partial<OpcoesDoCenario> = {}) {
  const { cenario, classificador, cliente } = cenarioComTranscricao(perfis, extra);
  const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, classificador, cliente, promessa };
}

/** Quantas vezes o audio foi a OpenAI (o cliente falso). */
function transcricoesNaOpenAi(cliente: ClienteDaTranscricao): number {
  return vi.mocked(cliente.audio.transcriptions.create).mock.calls.length;
}

/** O texto descartado em lugar nenhum: banco, RPCs, log, agente. */
function nadaDoTexto(
  cenario: ReturnType<typeof montarCenario>,
  texto: string,
) {
  const banco = JSON.stringify({
    tabelas: [...cenario.banco.tabelas.entries()],
    chamadas: cenario.banco.chamadas,
  }).toLowerCase();
  const log = escrito.join("").toLowerCase();
  const agente = JSON.stringify(cenario.agente.corpos).toLowerCase();
  for (const palavra of palavras(texto)) {
    expect(banco).not.toContain(palavra.toLowerCase());
    expect(log).not.toContain(palavra.toLowerCase());
    expect(agente).not.toContain(palavra.toLowerCase());
  }
}

/** A passagem por urgencia (o mesmo do 1c): a decisao, o evento e a marca. */
function passouComoUrgente(cenario: ReturnType<typeof montarCenario>) {
  expect(decisaoDo(cenario.banco)).toMatchObject({
    desfecho: "escalou",
    escalation_reason: "urgencia",
    gatilho_entrada: "urgencia",
    aprovado: false,
  });
  const trilha = (
    decisaoDo(cenario.banco)?.context_read as { trilha: { texto: string }[] }
  ).trilha.map((p) => p.texto);
  expect(trilha).toContain(PASSO_DA_URGENCIA);
  expect(trilha).not.toContain(PASSOS_DA_MIDIA.semFala);
  expect(cenario.banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
    { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
  ]);
  expect(eventosDoFio(cenario.banco)).toContain(TEXTO_DO_EVENTO_DA_IA.urgencia);
  expect(cenario.banco.linhas("conversa_urgente")).toMatchObject([
    { conversation_id: CONVERSA, clinic_id: CLINICA, job_id: JOB, encerrada_em: null },
  ]);
  // A urgencia nunca atribui (vai para a fila de todos) e a frase de sempre sai.
  expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
  expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
  expect(cenario.enviarResposta).not.toHaveBeenCalled();
  expect(cenario.agente.create).not.toHaveBeenCalled();
}

describe("pelo executor: os perfis do revisor R2 viram Urgente", () => {
  it.each([
    ["Não consigo respirar. (0,3, curta incerta)", [" Não consigo respirar.", 0.3, -0.3]],
    ["Quero morrer. (0,35, curta incerta)", [" Quero morrer.", 0.35, -0.4]],
    ["Vou me matar. (0,5, curta incerta)", [" Vou me matar.", 0.5, -0.3]],
    [
      "Socorro, minha mãe desmaiou e não acorda. (0,65, silencio)",
      [" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3],
    ],
  ] as [string, Perfil][])(
    "%s: a passagem e urgente, a leitura NAO e gravada (o job repetido transcreve de novo), e o texto em lugar nenhum",
    async (_nome, perfil) => {
      const { cenario, classificador, promessa } = rodar([perfil]);
      expect(await promessa).toEqual({ ok: true });
      passouComoUrgente(cenario);
      expect(classificador).not.toHaveBeenCalled();
      // RR2 de 88e9560 (medio 3): a urgencia so no texto descartado. Gravado,
      // o sem fala faria o job repetido passar a conversa como midia, sem a
      // marca; sem a leitura, ele transcreve de novo e acha de novo. A
      // bolha fica sem a linha da leitura (a equipe ouve o audio).
      expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
      expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
      nadaDoTexto(cenario, perfil[0]);
    },
  );

  it("a frase-fantasma com uma frase urgente junto: urgente, sem gravar a leitura", async () => {
    const perfis: Perfil[] = [
      [" Socorro, minha mãe desmaiou.", 0.1, -0.3],
      [" Obrigado por assistir.", 0.1, -0.2],
    ];
    const { cenario, promessa } = rodar(perfis);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    nadaDoTexto(cenario, perfis.map((p) => p[0]).join(" "));
  });

  it("a fala real com o segmento urgente no ruido: urgente, sem gravar a leitura (nem a fala real)", async () => {
    const { cenario, promessa } = rodar([
      [" Quero marcar uma consulta.", 0.1, -0.3],
      [" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3],
    ]);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    // RR2 de 88e9560 (medio 3): gravada so a fala real, o job repetido le a
    // transcricao sem a urgencia e a IA responde normalmente.
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    nadaDoTexto(cenario, "Socorro, minha mãe desmaiou e não acorda.");
  });

  it("a urgencia no texto MANTIDO: grava a transcricao como sempre (o portao do job repetido a acha no texto relido) e passa como urgente", async () => {
    const { cenario, promessa } = rodar([
      [" Socorro, minha mãe desmaiou e não acorda.", 0.1, -0.3],
    ]);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({
        tipo: "transcricao",
        transcricao: "Socorro, minha mãe desmaiou e não acorda.",
      }),
    ]);
    // Nem a transcricao gravada vai para log.
    expect(escrito.join("").toLowerCase()).not.toContain("desmaiou");
  });

  it("o Ok. inventado no silencio nao vira urgente: a midia de sempre, sem a marca", async () => {
    const { cenario, promessa } = rodar([[" Ok.", 0.92, -0.35]]);
    expect(await promessa).toEqual({ ok: true });
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "midia_nao_suportada",
    });
    expect(cenario.banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "midia_nao_suportada" },
    ]);
    expect(cenario.banco.linhas("conversa_urgente")).toEqual([]);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({ tipo: "sem_fala", transcricao: null }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Terceira rodada (RR2 de 88e9560): a urgencia do audio em todos os caminhos
// ---------------------------------------------------------------------------

/** A urgencia no texto MANTIDO (passa nas travas): a leitura e gravada. */
const URGENTE_NO_MANTIDO: Perfil = [
  " Socorro, minha mãe desmaiou e não acorda.",
  0.1,
  -0.3,
];
/** O perfil do revisor: a urgencia so no descartado (a curta incerta). */
const QUERO_MORRER: Perfil = [" Quero morrer.", 0.35, -0.4];
/** A fala real com o segmento urgente no ruido (so no descartado). */
const FALA_REAL_E_URGENCIA_NO_RUIDO: Perfil[] = [
  [" Quero marcar uma consulta.", 0.1, -0.3],
  [" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3],
];
/** A versao publicada com o audio ligado e o banco com ele desligado. */
const DESLIGADA_NA_GRAVACAO: Partial<OpcoesDoCenario> = {
  skills: { ler_audio: false, ler_imagem_e_documento: true },
};

/** O turno no laco, com a porta falsa (o classificador espiado). */
function turnoNoLaco(mensagens: MensagemDaConversa[], extra: Partial<EntradaDoTurno>) {
  const agente = agenteQueResponde("Claro, posso ajudar.");
  const classificador = vi.fn<ClassificadorDeEntrada>(async () => LIMPO);
  const promessa = executarTurnoDoAgente({
    cliente: agente.cliente,
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: "a".repeat(64),
    config: configComMidia(),
    catalogo: CATALOGO_DA_AG6B,
    mensagens,
    agoraMs: AGORA,
    fuso: "America/Fortaleza",
    verificador,
    classificador,
    ...extra,
  });
  return { promessa, agente, classificador };
}

const DESFECHO_DA_URGENCIA = {
  tipo: "escalou",
  motivo: "urgencia",
  gatilho: "urgencia",
  origem: "portao",
} as const;

describe("RR2 (medio 2): a urgencia sobrevive a falha da gravacao da leitura do proprio audio", () => {
  it.each(["08006", "57014", "40001"])(
    "a urgencia no texto mantido e a RPC da leitura com o erro %s: urgente, nunca falha tecnica",
    async (codigo) => {
      const { cenario, promessa } = rodar([URGENTE_NO_MANTIDO], {
        opcoesDoBanco: { erroDaGravacao: () => codigo },
      });
      expect(await promessa).toEqual({ ok: true });
      passouComoUrgente(cenario);
      // A gravacao saiu e falhou: nada gravado.
      expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toHaveLength(1);
      expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
      expect(escrito.join("")).toContain("ia_leitura_nao_gravada");
      expect(escrito.join("").toLowerCase()).not.toContain("desmaiou");
    },
  );

  it("a urgencia no texto mantido e a habilidade desligada entre o plano e a gravacao (leitura_desligada): urgente", async () => {
    const { cenario, promessa } = rodar([URGENTE_NO_MANTIDO], DESLIGADA_NA_GRAVACAO);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toHaveLength(1);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
  });

  it.each(["08006", "57014", "40001", "leitura_desligada"])(
    "o caso do revisor, Quero morrer. (0,35) com %s na gravacao: urgente; a RPC nem sai (a urgencia so no descartado nao grava)",
    async (caso) => {
      const { cenario, promessa } = rodar(
        [QUERO_MORRER],
        caso === "leitura_desligada"
          ? DESLIGADA_NA_GRAVACAO
          : { opcoesDoBanco: { erroDaGravacao: () => caso } },
      );
      expect(await promessa).toEqual({ ok: true });
      passouComoUrgente(cenario);
      expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
      nadaDoTexto(cenario, QUERO_MORRER[0]);
    },
  );

  it("o corte da porta com a RPC da leitura pendurada (a urgencia no texto mantido): urgente, pelo corte", async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { cenario } = cenarioComTranscricao([URGENTE_NO_MANTIDO], {
      tempo: () => Date.now(),
    });
    // A RPC que nunca volta (a trava longa no banco).
    cenario.banco.rpc(
      "gravar_leitura_da_midia",
      () => new Promise<Resposta>(() => undefined),
    );
    const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(escrito.join("")).toContain("ia_midia_cortada");
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
  });

  it("no laco: a falha que traz a urgencia passa como urgente, sem a trilha da falha", async () => {
    const { porta } = portaFalsa({
      transcricao: {
        [AUDIO]: {
          tipo: "falhou",
          motivo: "desconhecida",
          uso: usoDaTranscricao(),
          urgencia: "fisica",
        },
      },
    });
    const { promessa, agente, classificador } = turnoNoLaco([audioNoLaco()], {
      midia: porta,
    });
    const r = await promessa;
    expect(r.desfecho).toEqual(DESFECHO_DA_URGENCIA);
    expect(r.trilha.map((p) => p.texto)).toEqual([
      PASSO_DA_CONFERENCIA_DA_ENTRADA,
      PASSO_DA_URGENCIA,
    ]);
    expect(r.uso).toEqual([usoDaTranscricao()]);
    expect(r.midiaNaoLida).toBe(true);
    expect(classificador).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("no laco: a falha SEM urgencia continua a falha tecnica (o controle)", async () => {
    const { porta } = portaFalsa({
      transcricao: {
        [AUDIO]: { tipo: "falhou", motivo: "desconhecida", uso: usoDaTranscricao() },
      },
    });
    const r = await turnoNoLaco([audioNoLaco()], { midia: porta }).promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.transcricaoFalhou);
  });
});

describe("RR2 (medio 2 e 3): a porta de verdade leva a urgencia e so grava o que o job repetido rele", () => {
  const AUDIO_PRONTO = {
    tipo: "audio" as const,
    messageId: AUDIO,
    bytes: new Uint8Array(),
    segundos: 10,
  };
  const USO_DA_CHAMADA = { modelo: "whisper-1", segundos: 10 };

  /** O admin so com a RPC da leitura (as chamadas guardadas). */
  function bancoDaLeitura(resposta: () => Promise<Resposta>) {
    const chamadas: Record<string, unknown>[] = [];
    const admin = {
      rpc: (nome: string, args: Record<string, unknown>) => {
        if (nome === "gravar_leitura_da_midia") {
          chamadas.push(args);
        }
        return resposta();
      },
    } as unknown as SupabaseClient;
    return { admin, chamadas };
  }
  const gravou = async (): Promise<Resposta> => ({
    data: { ok: true, reutilizado: false, id: "x" },
    error: null,
  });

  function porta(
    admin: SupabaseClient,
    transcrever: DependenciasDaPortaDoWhatsapp["transcrever"],
  ): PortaDaMidia {
    return portaDaMidiaDoWhatsapp(admin, {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      jobId: JOB,
      workerId: EXECUTOR,
      mascarar: (t) => t,
      lerArquivo: async () => ({ tipo: "ok", bytes: new Uint8Array() }),
      transcrever,
      lerComOModelo: async () => {
        throw new Error("nao usado");
      },
      versaoDaTranscricao: "transcricao-0123456789ab",
      modeloDoLeitor: "gpt-6-luna",
      modeloDaTranscricao: "whisper-1",
      tetosDoLeitor: { imagem: 1_600, pagina: 1_800 },
    });
  }

  /** A transcricao da integracao (o campo urgencia so quando dado). */
  function daIntegracao(
    e:
      | { tipo: "transcrita"; texto: string; urgencia?: TipoDeUrgencia }
      | { tipo: "sem_fala"; urgencia?: TipoDeUrgencia },
  ): ResultadoDaTranscricaoNoModelo {
    return { ...e, segundos: 10, uso: USO_DA_CHAMADA };
  }

  it("a gravacao recusada com a urgencia no texto mantido: falhou COM a urgencia (lida pela porta no texto mantido, mesmo sem o campo da integracao)", async () => {
    const { admin, chamadas } = bancoDaLeitura(async () => ({
      data: null,
      error: { code: "08006" },
    }));
    const r = await porta(admin, async () =>
      daIntegracao({
        tipo: "transcrita",
        texto: "Socorro, minha mãe desmaiou e não acorda.",
      }),
    ).transcrever(AUDIO_PRONTO, 10_000);
    expect(chamadas).toHaveLength(1);
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "desconhecida",
      uso: expect.objectContaining({ papel: "transcricao", segundosDeAudio: 10 }),
      urgencia: "fisica",
    });
  });

  it("o corte da porta com a RPC pendurada: falhou por prazo, com a urgencia e o uso da chamada que voltou", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { admin, chamadas } = bancoDaLeitura(() => new Promise<Resposta>(() => undefined));
    const promessa = porta(admin, async () =>
      daIntegracao({
        tipo: "transcrita",
        texto: "Socorro, minha mãe desmaiou e não acorda.",
        urgencia: "fisica",
      }),
    ).transcrever(AUDIO_PRONTO, 10_000);
    await vi.advanceTimersByTimeAsync(11_000);
    const r = await promessa;
    expect(chamadas).toHaveLength(1);
    expect(r).toEqual({
      tipo: "falhou",
      motivo: "timeout",
      // O uso que voltou (nunca o pior caso de duas chamadas).
      uso: expect.objectContaining({ papel: "transcricao", segundosDeAudio: 10 }),
      urgencia: "fisica",
    });
  });

  it("o sinal de quem chama abortado depois da transcricao: falhou, com a urgencia, sem gravar", async () => {
    const { admin, chamadas } = bancoDaLeitura(gravou);
    const controle = new AbortController();
    const r = await porta(admin, async () => {
      controle.abort();
      return daIntegracao({ tipo: "sem_fala", urgencia: "risco_de_vida" });
    }).transcrever(AUDIO_PRONTO, 10_000, controle.signal);
    expect(chamadas).toEqual([]);
    expect(r).toMatchObject({ tipo: "falhou", urgencia: "risco_de_vida" });
  });

  it("a urgencia so no texto descartado: a RPC nem sai, e a porta devolve o resultado com a urgencia", async () => {
    const semFalaUrgente = bancoDaLeitura(gravou);
    expect(
      await porta(semFalaUrgente.admin, async () =>
        daIntegracao({ tipo: "sem_fala", urgencia: "risco_de_vida" }),
      ).transcrever(AUDIO_PRONTO, 10_000),
    ).toMatchObject({ tipo: "sem_fala", urgencia: "risco_de_vida" });
    expect(semFalaUrgente.chamadas).toEqual([]);

    const falaRealComRuido = bancoDaLeitura(gravou);
    expect(
      await porta(falaRealComRuido.admin, async () =>
        daIntegracao({
          tipo: "transcrita",
          texto: "Quero marcar uma consulta.",
          urgencia: "fisica",
        }),
      ).transcrever(AUDIO_PRONTO, 10_000),
    ).toMatchObject({
      tipo: "transcrita",
      texto: "Quero marcar uma consulta.",
      urgencia: "fisica",
    });
    expect(falaRealComRuido.chamadas).toEqual([]);
  });

  it("sem urgencia, ou com ela no texto mantido: grava como sempre", async () => {
    for (const feito of [
      daIntegracao({ tipo: "transcrita", texto: "Quero marcar uma consulta." }),
      daIntegracao({ tipo: "sem_fala" }),
      daIntegracao({
        tipo: "transcrita",
        texto: "Socorro, minha mãe desmaiou e não acorda.",
        urgencia: "fisica",
      }),
    ]) {
      const { admin, chamadas } = bancoDaLeitura(gravou);
      const r = await porta(admin, async () => feito).transcrever(AUDIO_PRONTO, 10_000);
      expect(chamadas).toHaveLength(1);
      expect(r.tipo).toBe(feito.tipo);
    }
  });
});

describe("urgenciaDaTranscricao (pura): onde a urgencia esta", () => {
  const uso = { modelo: "whisper-1", segundos: 10 };
  it("no texto mantido (com ou sem o campo da integracao): grava", () => {
    expect(
      urgenciaDaTranscricao({
        tipo: "transcrita",
        texto: "to com uma dor no peito muito forte",
        segundos: 10,
        uso,
      }),
    ).toEqual({ tipo: "fisica", soNoDescartado: false });
    expect(
      urgenciaDaTranscricao({
        tipo: "transcrita",
        texto: "to com uma dor no peito muito forte",
        segundos: 10,
        uso,
        urgencia: "fisica",
      }),
    ).toEqual({ tipo: "fisica", soNoDescartado: false });
  });

  it("so no descartado (a transcricao sem ela, o sem fala com ela): nao grava", () => {
    expect(
      urgenciaDaTranscricao({
        tipo: "transcrita",
        texto: "Quero marcar uma consulta.",
        segundos: 10,
        uso,
        urgencia: "fisica",
      }),
    ).toEqual({ tipo: "fisica", soNoDescartado: true });
    expect(
      urgenciaDaTranscricao({ tipo: "sem_fala", segundos: 10, uso, urgencia: "risco_de_vida" }),
    ).toEqual({ tipo: "risco_de_vida", soNoDescartado: true });
  });

  it("nenhuma: grava", () => {
    expect(
      urgenciaDaTranscricao({
        tipo: "transcrita",
        texto: "Quero marcar uma consulta.",
        segundos: 10,
        uso,
      }),
    ).toEqual({ tipo: null, soNoDescartado: false });
    expect(urgenciaDaTranscricao({ tipo: "sem_fala", segundos: 10, uso })).toEqual({
      tipo: null,
      soNoDescartado: false,
    });
  });
});

describe("RR2 (medio 3): o job repetido acha a urgencia de novo", () => {
  /**
   * A primeira tentativa morre logo depois do laco (a invocacao derrubada):
   * a transcricao e a gravacao da leitura aconteceram; nada depois delas (a
   * decisao, a passagem, a frase).
   */
  async function primeiraTentativaMorreDepoisDoLaco(
    cenario: ReturnType<typeof montarCenario>,
  ) {
    const real = cenario.deps.executarTurno;
    let terminou: () => void = () => undefined;
    const lacoTerminou = new Promise<void>((resolve) => {
      terminou = resolve;
    });
    cenario.deps.executarTurno = async (entrada) => {
      await real(entrada);
      terminou();
      return new Promise<never>(() => undefined);
    };
    void executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    await lacoTerminou;
    cenario.deps.executarTurno = real;
    expect(cenario.banco.linhas("ai_decision_log")).toEqual([]);
    expect(cenario.banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([]);
  }

  it("a fala real com o segmento urgente no ruido: a primeira tentativa morre depois do laco; a segunda transcreve de novo e passa como urgente (a IA nunca responde)", async () => {
    const { cenario, cliente } = cenarioComTranscricao(FALA_REAL_E_URGENCIA_NO_RUIDO);
    await primeiraTentativaMorreDepoisDoLaco(cenario);
    expect(transcricoesNaOpenAi(cliente)).toBe(1);
    // Nada gravado: o job repetido nao tem leitura para reaproveitar.
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({
      ok: true,
    });
    expect(transcricoesNaOpenAi(cliente)).toBe(2);
    passouComoUrgente(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    nadaDoTexto(cenario, "Socorro, minha mãe desmaiou e não acorda.");
  });

  it("o sem fala urgente (Quero morrer.): a posse perdida na primeira tentativa; a segunda transcreve de novo e passa como urgente", async () => {
    const { cenario, cliente } = cenarioComTranscricao([QUERO_MORRER]);
    const gravarEstado = cenario.banco.manipuladores.get("gravar_atendimento_da_ia");
    let comPosse = false;
    cenario.banco.rpc("gravar_atendimento_da_ia", (args) =>
      comPosse && gravarEstado !== undefined
        ? gravarEstado(args)
        : { data: { ok: false, motivo: "sem_posse" }, error: null },
    );
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({
      ok: false,
      erro: "sem_posse",
    });
    expect(decisaoDo(cenario.banco)).toBeUndefined();
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    comPosse = true;
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({
      ok: true,
    });
    expect(transcricoesNaOpenAi(cliente)).toBe(2);
    passouComoUrgente(cenario);
  });

  it("o controle, a urgencia no texto mantido: gravada; a segunda tentativa a acha no texto relido, sem transcrever de novo nem reservar, mesmo com o teto do dia cheio", async () => {
    const { cenario, cliente } = cenarioComTranscricao([URGENTE_NO_MANTIDO]);
    await primeiraTentativaMorreDepoisDoLaco(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({ tipo: "transcricao" }),
    ]);
    expect(cenario.banco.chamadasDe("reservar_gasto_da_ia")).toHaveLength(1);
    // A reserva perdida da primeira tentativa encheu o teto do dia: sem o
    // 7c depois do plano, a segunda passava como teto_atingido, sem a marca.
    cenario.marcas.reservas.push(null);
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({
      ok: true,
    });
    expect(transcricoesNaOpenAi(cliente)).toBe(1);
    expect(cenario.banco.chamadasDe("reservar_gasto_da_ia")).toHaveLength(1);
    passouComoUrgente(cenario);
  });
});

describe("RR2 (baixo 7): um audio ruim nao impede a transcricao dos bons (so para ler a urgencia)", () => {
  it("um audio fora da regra e outro com a urgencia: o bom e transcrito so para ler a urgencia; urgente", async () => {
    const { porta, transcrever } = portaFalsa({
      preparo: { [AUDIO_2]: "fora" },
      transcricao: { [AUDIO]: semFala("risco_de_vida") },
    });
    const { promessa, agente, classificador } = turnoNoLaco(
      [audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)],
      { midia: porta },
    );
    const r = await promessa;
    expect(r.desfecho).toEqual(DESFECHO_DA_URGENCIA);
    expect(r.trilha.map((p) => p.texto)).toEqual([
      PASSO_DA_CONFERENCIA_DA_ENTRADA,
      PASSO_DA_URGENCIA,
    ]);
    expect(transcrever).toHaveBeenCalledTimes(1);
    expect(transcrever.mock.calls[0]?.[0].messageId).toBe(AUDIO);
    expect(r.uso).toEqual([usoDaTranscricao()]);
    expect(r.midiaNaoLida).toBe(true);
    expect(classificador).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("o Storage que falhou num audio e a urgencia no texto mantido do outro (a porta sem o campo): urgente, nunca a falha tecnica", async () => {
    const { porta } = portaFalsa({
      preparo: { [AUDIO_2]: "falhou" },
      transcricao: { [AUDIO]: transcrita("to com uma dor no peito muito forte") },
    });
    const r = await turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: porta,
    }).promessa;
    expect(r.desfecho).toEqual(DESFECHO_DA_URGENCIA);
    expect(r.trilha.map((p) => p.texto)).not.toContain(
      PASSOS_DA_MIDIA.transcricaoFalhou,
    );
  });

  it("sem urgencia, o audio fora da regra passa como antes (a midia); o bom foi transcrito so para ler, e o texto dele nao vale neste turno", async () => {
    const { porta, transcrever } = portaFalsa({
      preparo: { [AUDIO_2]: "fora" },
      transcricao: { [AUDIO]: transcrita("Quero marcar uma consulta.") },
    });
    const { promessa, classificador, agente } = turnoNoLaco(
      [audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)],
      { midia: porta },
    );
    const r = await promessa;
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "midia_nao_suportada",
      gatilho: "midia",
      origem: "portao",
    });
    expect(transcrever).toHaveBeenCalledTimes(1);
    expect(r.uso).toEqual([usoDaTranscricao()]);
    expect(r.midiaNaoLida).toBe(true);
    expect(classificador).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("sem urgencia, o Storage que falhou num audio continua a falha tecnica", async () => {
    const { porta, transcrever } = portaFalsa({
      preparo: { [AUDIO_2]: "falhou" },
      transcricao: { [AUDIO]: transcrita("Quero marcar uma consulta.") },
    });
    const r = await turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: porta,
    }).promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.transcricaoFalhou);
    expect(transcrever).toHaveBeenCalledTimes(1);
  });

  it("a gravacao do audio bom com job_antigo (D-A) vem antes: o executor so conclui", async () => {
    const { porta } = portaFalsa({
      preparo: { [AUDIO_2]: "fora" },
      transcricao: { [AUDIO]: { tipo: "job_antigo", uso: usoDaTranscricao() } },
    });
    const r = await turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: porta,
    }).promessa;
    expect(r.jobAntigo).toBe(true);
  });

  it("sem prazo para os bons depois do preparo: fica como antes, sem transcrever (o turno nunca passa do prazo)", async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { porta, transcrever } = portaFalsa({
      transcricao: { [AUDIO]: semFala("risco_de_vida") },
    });
    const preparar = vi.fn<PortaDaMidia["preparar"]>(async (_midias, prazo) => {
      // O preparo devolve quase no limite dele: sobra menos de 1 s de midia.
      await new Promise((resolve) => setTimeout(resolve, prazo - 200));
      return [
        { tipo: "audio", messageId: AUDIO, bytes: mp3Sintetico(15), segundos: 15 },
        { tipo: "fora", messageId: AUDIO_2, motivo: "longo_demais" },
      ];
    });
    const { promessa } = turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: { ...porta, preparar },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await promessa;
    expect(transcrever).not.toHaveBeenCalled();
    expect(r.desfecho).toMatchObject({ motivo: "midia_nao_suportada", gatilho: "midia" });
  });

  it("pelo executor: o audio longo demais e o urgente (Quero morrer.): urgente; so o bom vai a OpenAI, e nada e gravado", async () => {
    const { cenario, cliente, promessa } = rodar([QUERO_MORRER], {
      mensagens: [
        linhaDeMidia({ id: AUDIO, contentType: "audio" }),
        linhaDeMidia({
          id: AUDIO_2,
          contentType: "audio",
          criadaEm: "2026-10-13T14:58:35.000Z",
        }),
      ],
      arquivos: { [AUDIO_2]: { tipo: "ok", bytes: mp3Sintetico(130) } },
    });
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.lerArquivo).toHaveBeenCalledTimes(2);
    expect(transcricoesNaOpenAi(cliente)).toBe(1);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
  });
});

// Rev4 (checagem final): no caminho do audio ruim, o audio bom era lido
// SOZINHO para a urgencia, sem a juncao com as outras mensagens do turno:
// "minha mae" escrito e "nao responde mais, ta caida no chao" falado viravam
// midia, sem Urgente. Agora a rajada inteira, como no 1c (os textos do turno
// e as transcricoes que voltaram). O mesmo na falha de outro audio.
describe("rev4: a urgencia da rajada inteira nos caminhos que nao chegam ao 1c", () => {
  const ESCRITO = "minha mae";
  const FALADO = "nao responde mais, ta caida no chao";

  it.each([
    ["o outro audio fora da regra", { preparo: { [AUDIO_2]: "fora" as const } }],
    ["o Storage que falhou no outro audio", { preparo: { [AUDIO_2]: "falhou" as const } }],
    [
      "a transcricao que falhou no outro audio",
      {
        transcricao: {
          [AUDIO_2]: {
            tipo: "falhou" as const,
            motivo: "timeout" as const,
            uso: usoDaTranscricao(),
          },
        },
      },
    ],
  ])(
    "'%s': 'minha mae' escrito e o audio bom 'nao responde mais, ta caida no chao' viram Urgente",
    async (_nome, roteiro) => {
      const { porta } = portaFalsa({
        ...roteiro,
        transcricao: {
          [AUDIO]: transcrita(FALADO),
          ...("transcricao" in roteiro ? roteiro.transcricao : {}),
        },
      });
      const { promessa, agente, classificador } = turnoNoLaco(
        [{ autor: "paciente", texto: ESCRITO }, audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)],
        { midia: porta },
      );
      const r = await promessa;
      expect(r.desfecho).toEqual(DESFECHO_DA_URGENCIA);
      expect(r.trilha.map((p) => p.texto)).toEqual([
        PASSO_DA_CONFERENCIA_DA_ENTRADA,
        PASSO_DA_URGENCIA,
      ]);
      expect(classificador).not.toHaveBeenCalled();
      expect(agente.create).not.toHaveBeenCalled();
    },
  );

  it("o controle: sem o 'minha mae' escrito, o audio sozinho nao e urgencia, e o turno passa como antes", async () => {
    const fora = await turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: portaFalsa({
        preparo: { [AUDIO_2]: "fora" },
        transcricao: { [AUDIO]: transcrita(FALADO) },
      }).porta,
    }).promessa;
    expect(fora.desfecho).toMatchObject({ motivo: "midia_nao_suportada", gatilho: "midia" });
    const falhou = await turnoNoLaco([audioNoLaco(AUDIO), audioNoLaco(AUDIO_2)], {
      midia: portaFalsa({
        transcricao: {
          [AUDIO]: transcrita(FALADO),
          [AUDIO_2]: { tipo: "falhou", motivo: "timeout", uso: usoDaTranscricao() },
        },
      }).porta,
    }).promessa;
    expect(falhou.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
  });

  it("pelo executor: 'minha mae' escrito, o audio bom e um audio longo demais no mesmo turno: Urgente; so o bom vai a OpenAI", async () => {
    const { cenario, cliente, promessa } = rodar(
      [[" Não responde mais, tá caída no chão.", 0.1, -0.3]],
      {
        mensagens: [
          {
            id: "m0",
            clinic_id: CLINICA,
            conversation_id: CONVERSA,
            author: "paciente",
            direction: "entrada",
            content_type: "texto",
            body: "minha mãe",
            media_url: null,
            deleted_at: null,
            is_internal_note: false,
            pelo_celular: false,
            created_at: "2026-10-13T14:58:20.000Z",
          },
          linhaDeMidia({ id: AUDIO, contentType: "audio" }),
          linhaDeMidia({
            id: AUDIO_2,
            contentType: "audio",
            criadaEm: "2026-10-13T14:58:35.000Z",
          }),
        ],
        arquivos: { [AUDIO_2]: { tipo: "ok", bytes: mp3Sintetico(130) } },
      },
    );
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(transcricoesNaOpenAi(cliente)).toBe(1);
    // O texto do audio bom, sozinho, nao tem a urgencia: a leitura e gravada
    // como sempre (o job repetido a rele junto com o "minha mae" no 7c).
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({ tipo: "transcricao" }),
    ]);
  });
});
