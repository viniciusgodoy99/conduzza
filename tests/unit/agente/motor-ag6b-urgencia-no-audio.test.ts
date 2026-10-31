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
import { PASSOS_DA_MIDIA } from "@/lib/agente/midia";
import { TEXTO_DO_EVENTO_DA_IA } from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { SegmentoDaTranscricao } from "@/lib/domain/conformidade/qualidade-da-transcricao";
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
} from "@/lib/integrations/llm/transcricao";

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

/** O executor com a transcricao de verdade (so o cliente da OpenAI falso). */
function rodar(perfis: readonly Perfil[]) {
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
  });
  // O classificador do cenario, espiado.
  const classificador = vi.fn(cenario.deps.criarClassificador(""));
  cenario.deps.criarClassificador = () => classificador;
  const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, classificador, promessa };
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
    "%s: a leitura e o sem fala, a passagem e urgente, e o texto em lugar nenhum",
    async (_nome, perfil) => {
      const { cenario, classificador, promessa } = rodar([perfil]);
      expect(await promessa).toEqual({ ok: true });
      passouComoUrgente(cenario);
      expect(classificador).not.toHaveBeenCalled();
      // A leitura gravada e o sem fala de sempre (sem texto): a bolha mostra
      // "nao deu para entender fala neste audio".
      expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
        expect.objectContaining({ tipo: "sem_fala", transcricao: null }),
      ]);
      nadaDoTexto(cenario, perfil[0]);
    },
  );

  it("a frase-fantasma com uma frase urgente junto: urgente", async () => {
    const perfis: Perfil[] = [
      [" Socorro, minha mãe desmaiou.", 0.1, -0.3],
      [" Obrigado por assistir.", 0.1, -0.2],
    ];
    const { cenario, promessa } = rodar(perfis);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({ tipo: "sem_fala", transcricao: null }),
    ]);
    nadaDoTexto(cenario, perfis.map((p) => p[0]).join(" "));
  });

  it("a fala real com o segmento urgente no ruido: urgente; a leitura so com a fala real", async () => {
    const { cenario, promessa } = rodar([
      [" Quero marcar uma consulta.", 0.1, -0.3],
      [" Socorro, minha mãe desmaiou e não acorda.", 0.65, -0.3],
    ]);
    expect(await promessa).toEqual({ ok: true });
    passouComoUrgente(cenario);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({
        tipo: "transcricao",
        transcricao: "Quero marcar uma consulta.",
      }),
    ]);
    nadaDoTexto(cenario, "Socorro, minha mãe desmaiou e não acorda.");
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
