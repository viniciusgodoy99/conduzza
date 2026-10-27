import { randomUUID } from "node:crypto";

import { vi } from "vitest";

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { mascararNome } from "@/lib/agente/historico";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import type { ConfigDoAgente } from "@/lib/domain/agente/config";
import type {
  EntradaDoVerificador,
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import { bancoDaAg3 } from "./ag3-contrato";
import {
  comOCarimboDoBanco,
  consultaDoContato,
  rpcsDaAg4,
  type MensagemNoBanco,
  type OpcoesDaAg4,
} from "./ag4-contrato";
import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// O cenario das conversas da AG4 (remarcar e cancelar) com o LLM FALSO de
// roteiro, sobre o contrato das RPCs em memoria (ag4-contrato.ts): cada fala
// do paciente roda um turno inteiro, com o estado gravado do turno anterior
// (o instante do pedido carimbado como o banco faz) e um job novo, dois
// minutos depois. Nenhum teste fala com a OpenAI nem com o banco.
//
// Revisao da AG4: a conversa tambem como o banco guarda (`noBanco`, a ordem
// e o instante de cada mensagem, com o autor de verdade: a resposta e da IA,
// a frase fixa e do sistema), para a ancora forte do "sim" no contrato; e
// cada fala da clinica no historico leva a autoria real (`daClinica` poe a
// mensagem de uma campanha, de um lembrete ou da equipe no meio).
//
// A clinica ficticia (agenda-fixtures e cadastro-fixtures): agora e terca,
// 20/10/2026, 09:00 em Fortaleza. A Dra. Ana Lima atende de segunda a sexta,
// de manha na Aldeota e a tarde no Centro; o Dr. Bruno Costa, terca e quinta
// a tarde. As consultas que a pessoa ja tem:
//  - C1: quinta, 22/10 as 14:00, Consulta com a Dra. Ana, no Centro
//    (particular, marcada pela recepcao);
//  - C2: terca, 27/10 as 09:00, Consulta com a Dra. Ana, na Aldeota,
//    pendente da equipe (marcada pela IA).

export const CATALOGO_DA_AG4 = catalogoDoCadastro();
export const IDENTIFICADOR = "a".repeat(64);
export const NOME_DO_CONTATO = "Maria Souza";

export const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
export const C2 = "c1c1c1c1-0000-4000-8000-000000000002";

/** Os prazos e as habilidades da clinica ficticia (24 horas para os dois). */
export const PRAZOS = { cancelarHoras: 24, remarcarHoras: 24 };

const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};
const USO_LIDO = {
  tokensEntrada: 1_000,
  tokensSaida: 60,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO,
    _request_id: "req_1",
  };
}

/** Uma rodada do LLM falso que chama uma ferramenta. */
export function ferramenta(name: string, args: unknown) {
  const callId = randomUUID();
  return resposta([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

/** A resposta final do LLM falso. */
export function final(mensagem: string) {
  return resposta([
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            mensagem,
            encerra_a_conversa: false,
            perguntas_da_base: [],
          }),
          annotations: [],
        },
      ],
    },
  ]);
}

/** Um verificador que aprova e guarda o que recebeu (o resumo dos fatos). */
export function verificadorQueAprova(): {
  verificador: Verificador;
  pedidos: EntradaDoVerificador[];
} {
  const pedidos: EntradaDoVerificador[] = [];
  const verificador: Verificador = async (
    entrada,
  ): Promise<ResultadoDoVerificador> => {
    pedidos.push(entrada);
    return {
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: { ...USO_LIDO },
    };
  };
  return { verificador, pedidos };
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};
export const classificadorLimpo: ClassificadorDeEntrada = async () => LIMPO;

/** As saidas das ferramentas que o modelo leu numa chamada. */
export function saidas(corpo: Record<string, unknown> | undefined) {
  return ((corpo?.input as { type?: string; output?: string }[]) ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

/** A configuracao com agendar, cancelar e remarcar ligadas e os prazos. */
export function configDaAg4(
  extra: Partial<ConfigDoAgente> = {},
): ConfigDoAgente {
  const base = configComAgenda();
  return {
    ...base,
    habilidades: {
      ...base.habilidades,
      agendar: true,
      cancelar: true,
      remarcar: true,
    },
    prazos: PRAZOS,
    ...extra,
  };
}

/** As duas consultas do contato (C1 e C2) no banco. */
export function consultasDoContato(banco: AgendaEmMemoria): {
  c1: Linha;
  c2: Linha;
} {
  const c1 = consultaDoContato({
    id: C1,
    inicio: iso("2026-10-22", "14:00"),
    fim: iso("2026-10-22", "14:30"),
    vinculo: VINC.consultaAna,
    profissional: PROF.ana,
    unidade: UNID.centro,
  });
  const c2 = consultaDoContato({
    id: C2,
    inicio: iso("2026-10-27", "09:00"),
    fim: iso("2026-10-27", "09:30"),
    vinculo: VINC.consultaAna,
    profissional: PROF.ana,
    unidade: UNID.aldeota,
    aprovacao: "pendente",
    criadaPor: "ia",
  });
  banco.inserir("appointment", c1, c2);
  return { c1, c2 };
}

export type Fala = {
  /** O que o paciente escreveu (o original). */
  texto: string;
  roteiro: unknown[];
};

/**
 * O cenario: o banco com as jornadas e o contato, as RPCs da AG4 sobre o
 * estado gravado da conversa, o relogio e a conversa.
 */
export class CenarioDaAg4 {
  agora = AGORA;
  readonly banco: AgendaEmMemoria;
  mensagens: MensagemDaConversa[] = [];
  /** O estado GRAVADO (o que o banco devolveria no turno seguinte). */
  atendimento: AtendimentoDoTurno;
  corpos: Record<string, unknown>[] = [];
  jobs: string[] = [];
  config: ConfigDoAgente;
  readonly verificacao = verificadorQueAprova();
  readonly opcoes: OpcoesDaAg4;
  /** Revisao da AG4: a conversa como o banco guarda (a ancora do "sim"). */
  readonly noBanco: MensagemNoBanco[] = [];

  constructor(
    e: {
      config?: ConfigDoAgente;
      atendimento?: AtendimentoDoTurno;
      opcoes?: Partial<OpcoesDaAg4>;
    } = {},
  ) {
    this.config = e.config ?? configDaAg4();
    this.atendimento = e.atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(),
    };
    this.banco = bancoDaAg3();
    this.opcoes = {
      catalogo: CATALOGO_DA_AG4,
      exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
      agora: () => this.agora,
      estado: () => this.atendimento.estado,
      conversa: () => this.noBanco,
      cancelar: {
        ligada: this.config.habilidades.cancelar === true,
        prazoHoras: this.config.prazos.cancelarHoras,
      },
      remarcar: {
        ligada: this.config.habilidades.remarcar === true,
        prazoHoras: this.config.prazos.remarcarHoras,
      },
      ...e.opcoes,
    };
    rpcsDaAg4(this.banco, this.opcoes);
  }

  get estado(): EstadoDoAtendimento {
    return this.atendimento.estado;
  }

  /** O instante de uma mensagem nova (sempre depois da anterior). */
  private instante(minimo: number): number {
    const ultima = this.noBanco.at(-1)?.em ?? Number.NEGATIVE_INFINITY;
    return Math.max(minimo, ultima + 1);
  }

  /**
   * Revisao da AG4: uma mensagem da clinica fora do turno da IA (campanha,
   * lembrete, mensagem agendada: "sistema"; a equipe: "usuario"), no
   * historico como "assistente" com a autoria real.
   */
  daClinica(
    texto: string,
    autoria: "sistema" | "usuario" | "ia" = "sistema",
    falhou = false,
  ): void {
    this.mensagens.push({ autor: "assistente", autoria, texto });
    this.noBanco.push({
      direcao: "saida",
      autor: autoria,
      em: this.instante(this.agora),
      ...(falhou ? { falhou: true } : {}),
    });
  }

  /** Uma fala do paciente: um turno inteiro, dois minutos depois do outro. */
  async fala(
    { texto, roteiro }: Fala,
    extra: Partial<EntradaDoTurno> = {},
  ): Promise<ResultadoDoTurno> {
    if (this.jobs.length > 0) {
      this.agora += 2 * 60_000;
    }
    const job = randomUUID();
    this.jobs.push(job);
    this.mensagens.push({
      autor: "paciente",
      texto: mascararNome(texto, NOME_DO_CONTATO),
      textoOriginal: texto,
    });
    this.noBanco.push({
      direcao: "entrada",
      autor: "paciente",
      em: this.instante(this.agora),
    });
    const create = vi.fn(async (corpo: unknown) => {
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
      return roteiro.shift();
    });
    const momento = this.agora;
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: IDENTIFICADOR,
      config: this.config,
      catalogo: CATALOGO_DA_AG4,
      mensagens: [...this.mensagens],
      agoraMs: momento,
      fuso: FUSO,
      verificador: this.verificacao.verificador,
      classificador: classificadorLimpo,
      agenda: portaDaAgendaDoWhatsapp(this.banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: job,
        agora: () => momento,
      }),
      atendimento: this.atendimento,
      agora: () => momento,
      ...extra,
    });
    // A resposta sai como mensagem da IA; a frase fixa da passagem, como do
    // sistema (lib/jobs/responder-com-ia.ts). As duas DEPOIS do gravar (o
    // instante do pedido e o do turno).
    const autoria = r.tipo === "resposta" ? "ia" : "sistema";
    this.mensagens.push({ autor: "assistente", autoria, texto: r.resposta });
    this.noBanco.push({
      direcao: "saida",
      autor: autoria,
      em: this.instante(momento + 1),
    });
    if (r.atendimento) {
      // O executor grava o estado (gravar_atendimento_da_ia): o banco
      // carimba o instante do pedido.
      this.atendimento = {
        estado: comOCarimboDoBanco(
          this.atendimento.estado,
          r.atendimento.estado,
          momento,
        ),
        dados: r.atendimento.dados,
      };
    }
    return r;
  }

  /** As instrucoes da primeira chamada ao modelo do turno n (0 = primeira). */
  instrucoesDaChamada(indice: number): string {
    return String(this.corpos[indice]?.instructions ?? "");
  }
}
