import { vi } from "vitest";

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { executarTurnoDoAgente } from "@/lib/agente/laco";
import {
  portaDaMidiaDoWhatsapp,
  type MidiaDaConversa,
} from "@/lib/agente/midia";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import type { ResultadoDoLeitor } from "@/lib/integrations/llm/leitor-de-midia";
import type { ArquivoDoStorage } from "@/lib/integrations/storage/arquivo-para-a-ia";
import type { ResultadoDaTranscricaoNoModelo } from "@/lib/integrations/llm/transcricao";
import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";
import { AGORA, CRIADO, EXECUTOR, NUMERO, PARA_O_RESPONSAVEL } from "./ag6-contrato";
import {
  agenteQueResponde,
  bancoDaAg6b,
  CLINICA,
  CONVERSA,
  JOB,
  jpegSintetico,
  mp3Sintetico,
} from "./ag6b-contrato";

// O cenario do EXECUTOR do WhatsApp com a midia (AG6b): o banco em memoria
// da AG6a com as mensagens dadas, as RPCs da AG6b, o laco DE VERDADE com o
// LLM falso, e a porta da midia de verdade (portaDaMidiaDoWhatsapp) com as
// integracoes FALSAS (o Storage, a transcricao e o leitor). Quem usa declara
// o vi.mock de "@/lib/agente/contexto" lendo `estado` (config e catalogo).

export const HEMOGRAMA = "11111111-1111-4111-8111-111111111111";
export const GLICEMIA = "22222222-2222-4222-8222-222222222222";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const CATALOGO_DA_AG6B = montarCatalogoDoAgente({
  procedimentos: [
    { id: HEMOGRAMA, name: "Hemograma", active: true, bookable_by_ai: true },
    { id: GLICEMIA, name: "Glicemia de jejum", active: true, bookable_by_ai: true },
  ],
  vinculos: [HEMOGRAMA, GLICEMIA].map((procedure_id) => ({
    procedure_id,
    professional_id: PROF,
    insurance_id: null,
    price_cents: 4_000,
    covered_by_insurance: false,
    bookable_by_ai: true,
    active: true,
  })),
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [],
});

const USO = { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 };
const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
};

/** A versao publicada com as habilidades de midia (o motor e o banco). */
export function configComMidia(
  habilidades: { audio?: boolean; arquivo?: boolean } = { audio: true, arquivo: true },
  regras: "fila" | "responsavel_do_lead" = "fila",
): ConfigDoAgente {
  const base = configPadraoDoAgente();
  return {
    ...base,
    status: "publicada",
    versao: 3,
    habilidades: {
      ...base.habilidades,
      ler_audio: habilidades.audio === true,
      ler_imagem_e_documento: habilidades.arquivo === true,
    },
    ...(regras === "responsavel_do_lead" ? { regras: PARA_O_RESPONSAVEL } : {}),
  };
}

export type CenarioDoExecutor = {
  banco: BancoEmMemoria;
  deps: DependenciasDoExecutorDaIa;
  job: Job;
  agente: ReturnType<typeof agenteQueResponde>;
  marcas: {
    podeFalar: boolean[];
    consentimento: boolean;
    reservas: (string | null)[];
    eventos: string[];
    respostas: Record<string, unknown>[];
    atribuicoes: Record<string, unknown>[];
    ordem: string[];
  };
  lerArquivo: ReturnType<typeof vi.fn>;
  transcrever: ReturnType<typeof vi.fn>;
  lerComOModelo: ReturnType<typeof vi.fn>;
  enviarFrase: ReturnType<typeof vi.fn>;
  enviarResposta: ReturnType<typeof vi.fn>;
};

export type OpcoesDoCenario = {
  mensagens: Linha[];
  config?: ConfigDoAgente;
  skills?: Record<string, boolean>;
  passagemPara?: "fila" | "responsavel_do_lead";
  liberado?: () => boolean;
  precoDoAudio?: number | null;
  /** A transcricao falsa por message_id (padrao: um texto de recepcao). */
  transcricao?: Record<string, ResultadoDaTranscricaoNoModelo>;
  /** A leitura falsa por message_id. */
  leitura?: Record<string, ResultadoDoLeitor>;
  /** Os bytes do Storage por message_id (padrao: MP3 de 15 s ou JPEG). */
  arquivos?: Record<string, ArquivoDoStorage>;
  /** A midia do executor (padrao: calibrada, com os tetos). */
  midia?: Partial<NonNullable<DependenciasDoExecutorDaIa["midia"]>> | null;
  /** A resposta do agente falso. */
  resposta?: string;
  prazoFinalMs?: number;
  tempo?: () => number;
  opcoesDoBanco?: Parameters<typeof bancoDaAg6b>[1]["opcoes"];
};

/** O texto de recepcao que a transcricao falsa devolve por padrao. */
export const FALA_PADRAO = "Oi, queria saber quanto custa o hemograma";

export function montarCenario(
  estado: { config: unknown; catalogo: unknown },
  o: OpcoesDoCenario,
): CenarioDoExecutor {
  const banco = new BancoEmMemoria();
  const marcas: CenarioDoExecutor["marcas"] = {
    podeFalar: [],
    consentimento: true,
    reservas: [],
    eventos: [],
    respostas: [],
    atribuicoes: [],
    ordem: [],
  };
  const passagemPara = o.passagemPara ?? "fila";
  estado.config = o.config ?? configComMidia({ audio: true, arquivo: true }, passagemPara);
  estado.catalogo = CATALOGO_DA_AG6B;
  bancoDaAg6b(banco, {
    mensagens: o.mensagens,
    estado: marcas,
    passagemPara,
    skills: o.skills ?? { ler_audio: true, ler_imagem_e_documento: true },
    liberado: o.liberado,
    precoDoAudio: o.precoDoAudio,
    procedimentos: [
      { id: HEMOGRAMA, name: "Hemograma" },
      { id: GLICEMIA, name: "Glicemia de jejum" },
    ],
    opcoes: o.opcoesDoBanco,
  });
  const agente = agenteQueResponde(
    o.resposta ?? "Claro, posso ajudar. Qual procedimento você quer?",
  );
  const lerArquivo = vi.fn(
    async (a: { messageId: string; maximoDeBytes: number }): Promise<ArquivoDoStorage> => {
      const dado = o.arquivos?.[a.messageId];
      if (dado !== undefined) {
        return dado;
      }
      const linha = banco.linhas("message").find((m) => m.id === a.messageId);
      return {
        tipo: "ok",
        bytes: linha?.content_type === "audio" ? mp3Sintetico(15) : jpegSintetico(),
      };
    },
  );
  const transcrever = vi.fn(
    async (t: { messageId: string; segundosMedidos: number }): Promise<ResultadoDaTranscricaoNoModelo> =>
      o.transcricao?.[t.messageId] ?? {
        tipo: "transcrita",
        texto: FALA_PADRAO,
        segundos: 16,
        uso: { modelo: "whisper-1", segundos: 16 },
      },
  );
  const lerComOModelo = vi.fn(
    async (l: { messageId: string }): Promise<ResultadoDoLeitor> => {
      const feito = o.leitura?.[l.messageId];
      if (feito === undefined) {
        throw new Error("leitura sem roteiro");
      }
      return feito;
    },
  );
  const enviarFrase = vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>(async () => {
    marcas.ordem.push("frase");
    return { ok: true, messageId: "msg-frase" };
  });
  const enviarResposta = vi.fn<DependenciasDoExecutorDaIa["enviarResposta"]>(
    async () => ({ ok: true, messageId: "msg-1" }),
  );
  const verificador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  });
  const classificador: ClassificadorDeEntrada = async () => LIMPO;
  const midiaPadrao: NonNullable<DependenciasDoExecutorDaIa["midia"]> = {
    transcricaoCalibrada: true,
    tetosDoLeitor: { imagem: 1_600, pagina: 1_800 },
    modeloDaTranscricao: "whisper-1",
    modeloDoLeitor: "gpt-6-luna",
    criarPorta: (e) =>
      portaDaMidiaDoWhatsapp(banco.cliente(), {
        ...e,
        lerArquivo,
        transcrever,
        lerComOModelo,
        versaoDaTranscricao: "transcricao-0123456789ab",
        modeloDoLeitor: "gpt-6-luna",
      }),
  };
  const deps: DependenciasDoExecutorDaIa = {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: o.prazoFinalMs ?? AGORA + 55_000,
    agora: o.tempo ?? (() => AGORA),
    clienteDoAgente: () => agente.cliente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => verificador,
    criarClassificador: () => classificador,
    executarTurno: executarTurnoDoAgente,
    enviarResposta,
    enviarFrase,
    ...(o.midia === null ? {} : { midia: { ...midiaPadrao, ...o.midia } }),
  };
  const job: Job = {
    id: JOB,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: CONVERSA, ultima_mensagem_id: "m1" },
    attempts: 1,
    max_attempts: 3,
    whatsapp_account_id: NUMERO,
    created_at: CRIADO,
  };
  return {
    banco,
    deps,
    job,
    agente,
    marcas,
    lerArquivo,
    transcrever,
    lerComOModelo,
    enviarFrase,
    enviarResposta,
  };
}

export { EXECUTOR, AGORA };

/** A decisao gravada (a unica do job). */
export function decisaoDo(banco: BancoEmMemoria): Linha | undefined {
  return banco.linhas("ai_decision_log").at(-1);
}

/** O texto da ultima mensagem do paciente que o agente leu. */
export function ultimaDoPacienteNoAgente(
  corpos: Record<string, unknown>[],
): unknown {
  const input = (corpos[0]?.input ?? []) as { role?: string; content?: unknown }[];
  return input.filter((i) => i.role === "user").at(-1)?.content;
}

/** Uma leitura ja gravada no banco (o job repetido, o historico). */
export function leituraNoBanco(e: {
  messageId: string;
  midia: MidiaDaConversa["midia"];
  tipo: string;
  transcricao?: string | null;
  segundos?: number | null;
  procedimentos?: string[];
  foraDoCadastro?: number;
  confianca?: string | null;
  resumo?: string | null;
}): Linha {
  return {
    id: `leitura-${e.messageId}`,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    message_id: e.messageId,
    job_id: "99999999-0000-4000-8000-000000000001",
    midia: e.midia,
    tipo: e.tipo,
    transcricao: e.transcricao ?? null,
    segundos_de_audio: e.segundos ?? (e.midia === "audio" ? 15 : null),
    procedimentos: e.procedimentos ?? [],
    fora_do_cadastro: e.foraDoCadastro ?? 0,
    confianca: e.confianca ?? (e.midia === "audio" ? null : "alta"),
    resumo: e.resumo ?? null,
    modelo: e.midia === "audio" ? "whisper-1" : "gpt-6-luna",
    versao: e.midia === "audio" ? "transcricao-0123456789ab" : "leitor-0123456789ab",
    created_at: "2026-10-13T14:58:40.000Z",
  };
}
