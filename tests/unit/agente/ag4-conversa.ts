import { randomUUID } from "node:crypto";

import { vi } from "vitest";

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { mascararNome } from "@/lib/agente/historico";
import {
  executarTurnoDoAgente,
  mensagensPendentes,
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
// Revisao curta das correcoes da AG4: a conversa mora na tabela `message`
// do banco em memoria (o motor le a saida logo antes da resposta pela porta
// do WhatsApp, como o banco; `noBanco` e a mesma tabela, para o contrato);
// o historico do modelo leva o texto com a mascara do nome, como
// lib/agente/historico.ts (o nome do contato e configuravel, para a mascara
// que colide com a unidade ou com o dia da semana); `soNoBanco` poe uma
// saida que o historico nao mostra (a apagada, a resposta automatica do
// WhatsApp Business); cada job guarda as mensagens que leu (as lidas, para
// mensagem_nova_do_paciente), `durante` escreve uma mensagem nova da pessoa
// no MEIO do turno (a corrida do "sim") e `continua` roda o job seguinte sem
// mensagem nova (o que le as pendentes que o anterior nao respondeu). O
// turno que para sem enviar (a mensagem nova) nao grava resposta.
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
  /**
   * Revisao curta das correcoes da AG4: o que acontece no MEIO do turno (na
   * primeira chamada ao modelo, depois do preparo e antes de qualquer
   * ferramenta): por exemplo, a pessoa mandando outra mensagem.
   */
  durante?: (cenario: CenarioDaAg4) => void;
  /**
   * Revisao da revisao final da AG4 (o toque atrasado): a mensagem da
   * pessoa cita (ou toca o botao de) outra mensagem.
   */
  citacao?: Citacao;
};

/**
 * Revisao da revisao final da AG4 (o toque atrasado): a citacao de uma
 * mensagem do paciente, como o webhook grava: `mensagem`, o id da mensagem
 * citada que o banco achou (reply_to_message_id); `doWhatsapp`, o id do
 * WhatsApp que veio na citacao ou no botao (reply_to_wa_message_id; sem a
 * mensagem, a citada que o banco nao achou).
 */
export type Citacao = { mensagem?: string; doWhatsapp?: string };

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
  readonly catalogo: CatalogoDoAgente;
  /** Revisao curta das correcoes da AG4: o nome do contato (a mascara). */
  readonly nomeDoContato: string;
  readonly verificacao = verificadorQueAprova();
  readonly opcoes: OpcoesDaAg4;
  /**
   * Revisao curta das correcoes da AG4 (mensagem_nova_do_paciente): os ids
   * das mensagens do paciente que cada job leu (ai_turno.mensagens_lidas).
   */
  readonly lidasPorJob = new Map<string, string[]>();
  /**
   * Revisao curta das correcoes da AG4 (R8): quando cada job foi criado
   * (job_queue.created_at): o comeco do turno.
   */
  readonly jobCriadoEm = new Map<string, number>();
  /**
   * Revisao final da AG4 (R12): o estado de ai_turno de cada job, como o
   * executor fecha: 'reservado' durante o turno; 'enviado' com a resposta;
   * 'passou_para_equipe' com a frase fixa da passagem; 'sem_envio' sem nada
   * enviado (a mensagem nova da pessoa, a liberacao que caiu). O contrato
   * soma as lidas dos que contam (idsRespondidos) no ramo nao apagado de
   * mensagem_nova_do_paciente.
   */
  readonly estadoDoTurnoPorJob = new Map<string, string>();
  /**
   * Revisao da revisao final da AG4 (o toque atrasado): o id (e o id do
   * WhatsApp) da ultima resposta que a conversa mandou (a resposta da IA ou
   * a frase fixa), para a pessoa citar.
   */
  ultimaResposta: { id: string; waMessageId: string } | null = null;

  constructor(
    e: {
      config?: ConfigDoAgente;
      atendimento?: AtendimentoDoTurno;
      opcoes?: Partial<OpcoesDaAg4>;
      catalogo?: CatalogoDoAgente;
      nomeDoContato?: string;
    } = {},
  ) {
    this.config = e.config ?? configDaAg4();
    this.catalogo = e.catalogo ?? CATALOGO_DA_AG4;
    this.nomeDoContato = e.nomeDoContato ?? NOME_DO_CONTATO;
    this.atendimento = e.atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(),
    };
    this.banco = bancoDaAg3();
    this.opcoes = {
      catalogo: this.catalogo,
      exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
      agora: () => this.agora,
      estado: () => this.atendimento.estado,
      conversa: () => this.noBanco,
      lidas: (job) => this.lidasPorJob.get(job),
      turnos: () =>
        this.jobs.map((job) => ({
          job_id: job,
          estado: this.estadoDoTurnoPorJob.get(job) ?? "reservado",
          mensagens_lidas: [...(this.lidasPorJob.get(job) ?? [])],
        })),
      jobCriadoEm: (job) => this.jobCriadoEm.get(job),
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

  /**
   * Revisao da AG4: a conversa como o banco guarda (a ancora do "sim"), na
   * ordem do instante. Revisao curta das correcoes: lida da tabela message
   * (evento e nota interna nao contam, como no banco).
   */
  get noBanco(): MensagemNoBanco[] {
    return this.banco
      .linhas("message")
      .filter(
        (m) =>
          m.conversation_id === CONVERSA &&
          (m.direction === "entrada" || m.direction === "saida") &&
          m.content_type !== "evento" &&
          m.is_internal_note !== true,
      )
      .map(
        (m): MensagemNoBanco => ({
          id: String(m.id),
          direcao: m.direction as MensagemNoBanco["direcao"],
          autor: m.author as MensagemNoBanco["autor"],
          em: Date.parse(String(m.created_at)),
          ...(m.delivery_status === "falhou" ? { falhou: true } : {}),
          ...(m.deleted_at != null ? { apagada: true } : {}),
          ...(typeof m.job_id === "string" ? { job: m.job_id } : {}),
        }),
      )
      .sort((a, b) => a.em - b.em);
  }

  /** O instante de uma mensagem nova (sempre depois da anterior). */
  private instante(minimo: number): number {
    const ultima = this.noBanco.at(-1)?.em ?? Number.NEGATIVE_INFINITY;
    return Math.max(minimo, ultima + 1);
  }

  /** Revisao curta das correcoes da AG4: uma linha da tabela message. */
  private registrar(m: {
    direcao: "entrada" | "saida";
    autor: "paciente" | "ia" | "usuario" | "sistema";
    texto: string | null;
    em: number;
    falhou?: boolean;
    apagada?: boolean;
    /** O job que escreveu a resposta (R8: message.job_id). */
    job?: string;
    /** Revisao da revisao final da AG4: a citacao (so do paciente). */
    citacao?: Citacao;
    /** Revisao da revisao final da AG4: o id do WhatsApp (so da saida). */
    waMessageId?: string;
  }): string {
    const id = randomUUID();
    this.banco.inserir("message", {
      id,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: m.direcao,
      author: m.autor,
      content_type: "texto",
      body: m.texto,
      media_url: null,
      delivery_status: m.falhou === true ? "falhou" : null,
      is_internal_note: false,
      deleted_at: m.apagada === true ? new Date(m.em).toISOString() : null,
      created_at: new Date(m.em).toISOString(),
      job_id: m.job ?? null,
      wa_message_id: m.waMessageId ?? null,
      reply_to_message_id: m.citacao?.mensagem ?? null,
      reply_to_wa_message_id: m.citacao?.doWhatsapp ?? null,
    });
    return id;
  }

  /**
   * Revisao curta das correcoes da AG4 (R7): a pessoa apagou a mensagem
   * (deleted_at; o historico do modelo deixa de mostrar).
   */
  apaga(id: string): void {
    const linha = this.banco.linhas("message").find((m) => m.id === id);
    if (linha !== undefined) {
      linha.deleted_at = new Date(this.agora).toISOString();
    }
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
  ): string {
    this.mensagens.push({
      autor: "assistente",
      autoria,
      texto: mascararNome(texto, this.nomeDoContato),
    });
    // Revisao da revisao final da AG4 (o toque atrasado): o id, para a
    // pessoa citar (ou tocar o botao de) esta mensagem depois.
    return this.registrar({
      direcao: "saida",
      autor: autoria,
      texto,
      em: this.instante(this.agora),
      falhou,
      waMessageId: `wa-${randomUUID()}`,
    });
  }

  /**
   * Revisao curta das correcoes da AG4 (achado 8): uma saida que o banco
   * conta e o historico do modelo NAO mostra (a apagada, a resposta
   * automatica do WhatsApp Business). `em`: o instante (padrao: logo depois
   * da ultima mensagem).
   */
  soNoBanco(
    autoria: "sistema" | "usuario" | "ia" = "sistema",
    e: { em?: number; falhou?: boolean; texto?: string; apagada?: boolean } = {},
  ): void {
    this.registrar({
      direcao: "saida",
      autor: autoria,
      texto: e.texto ?? "Olá! No momento estamos fora do horário.",
      em: e.em ?? this.instante(this.agora),
      falhou: e.falhou,
      apagada: e.apagada,
    });
  }

  /**
   * Revisao curta das correcoes da AG4: a pessoa escreve de novo (sem rodar
   * turno): no historico e no banco. `em`: o instante (padrao: logo depois
   * da ultima mensagem). Devolve o id da mensagem.
   */
  escreve(texto: string, em?: number, citacao?: Citacao): string {
    this.mensagens.push({
      autor: "paciente",
      texto: mascararNome(texto, this.nomeDoContato),
      textoOriginal: texto,
    });
    return this.registrar({
      direcao: "entrada",
      autor: "paciente",
      texto,
      em: em ?? this.instante(this.agora),
      citacao,
    });
  }

  /** Uma fala do paciente: um turno inteiro, dois minutos depois do outro. */
  async fala(
    { texto, roteiro, durante, citacao }: Fala,
    extra: Partial<EntradaDoTurno> = {},
  ): Promise<ResultadoDoTurno> {
    if (this.jobs.length > 0) {
      this.agora += 2 * 60_000;
    }
    this.escreve(texto, undefined, citacao);
    return this.turno(roteiro, durante, extra);
  }

  /**
   * Revisao curta das correcoes da AG4: o job seguinte SEM mensagem nova (o
   * que le as pendentes que o anterior nao respondeu, como depois de
   * mensagem_nova_do_paciente), dois minutos depois.
   */
  async continua(
    { roteiro, durante }: Omit<Fala, "texto">,
    extra: Partial<EntradaDoTurno> = {},
  ): Promise<ResultadoDoTurno> {
    this.agora += 2 * 60_000;
    return this.turno(roteiro, durante, extra);
  }

  private async turno(
    roteiro: unknown[],
    durante: Fala["durante"],
    extra: Partial<EntradaDoTurno>,
  ): Promise<ResultadoDoTurno> {
    const job = randomUUID();
    this.jobs.push(job);
    this.jobCriadoEm.set(job, this.agora);
    this.estadoDoTurnoPorJob.set(job, "reservado");
    // As lidas do job: as mensagens do paciente depois da ultima resposta
    // (as pendentes do historico).
    const pendentes = mensagensPendentes(this.mensagens).length;
    this.lidasPorJob.set(
      job,
      this.noBanco
        .filter((m) => m.direcao === "entrada" && m.autor === "paciente")
        .slice(-pendentes)
        .map((m) => m.id ?? ""),
    );
    let primeira = true;
    const create = vi.fn(async (corpo: unknown) => {
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
      if (primeira) {
        primeira = false;
        durante?.(this);
      }
      return roteiro.shift();
    });
    const momento = this.agora;
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: IDENTIFICADOR,
      config: this.config,
      catalogo: this.catalogo,
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
        // Revisao da revisao final da AG4 (o toque atrasado): as lidas do
        // job, como lib/jobs/responder-com-ia.ts.
        mensagensLidas: [...(this.lidasPorJob.get(job) ?? [])],
      }),
      atendimento: this.atendimento,
      agora: () => momento,
      ...extra,
    });
    // A resposta sai como mensagem da IA; a frase fixa da passagem, como do
    // sistema (lib/jobs/responder-com-ia.ts). As duas DEPOIS do gravar (o
    // instante do pedido e o do turno). Revisao curta das correcoes: o
    // turno sem envio (a mensagem nova da pessoa) nao manda nada.
    const semEnvio =
      r.desfecho.tipo === "falhou" && r.desfecho.motivo === "sem_mensagem";
    this.estadoDoTurnoPorJob.set(
      job,
      semEnvio ||
        (r.desfecho.tipo === "falhou" &&
          r.desfecho.motivo === "liberacao_suspensa")
        ? "sem_envio"
        : r.tipo === "resposta"
          ? "enviado"
          : "passou_para_equipe",
    );
    if (!semEnvio) {
      const autoria = r.tipo === "resposta" ? "ia" : "sistema";
      this.mensagens.push({
        autor: "assistente",
        autoria,
        texto: mascararNome(r.resposta, this.nomeDoContato),
      });
      const waMessageId = `wa-${randomUUID()}`;
      const id = this.registrar({
        direcao: "saida",
        autor: autoria,
        texto: r.resposta,
        em: this.instante(momento + 1),
        // A resposta da IA sai com o job do turno (R8).
        ...(autoria === "ia" ? { job } : {}),
        waMessageId,
      });
      this.ultimaResposta = { id, waMessageId };
    }
    if (r.atendimento && r.mensagemNova !== true) {
      // O executor grava o estado (gravar_atendimento_da_ia): o banco
      // carimba o instante do pedido. Revisao final da AG4 (B1): o turno
      // parado pela mensagem nova NAO grava (o estado nao mudou).
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
