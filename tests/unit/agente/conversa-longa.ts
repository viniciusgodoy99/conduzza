import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, vi } from "vitest";

import {
  dadosQueFaltam,
  estadoDoAtendimentoValido,
  type DadosInformados,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import type {
  CatalogoDoAgente,
  PreparoEmVigor,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import { portaDaMidiaDoWhatsapp } from "@/lib/agente/midia";
import type { ConfigDoAgente } from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import { mensagemDoPreparo } from "@/lib/domain/preparo";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import type { ResultadoDoLeitor } from "@/lib/integrations/llm/leitor-de-midia";
import type { ResultadoDaTranscricaoNoModelo } from "@/lib/integrations/llm/transcricao";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  enviarFraseFixaDaIa,
  enviarPreparoAprovadoDaIa,
  enviarRespostaDaIa,
} from "@/lib/integrations/whatsapp/send";
import {
  executarRespostaComIa,
  type DependenciasDoExecutorDaIa,
} from "@/lib/jobs/responder-com-ia";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";

import {
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";
import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";
import { comOCarimboDoBanco } from "./ag4-contrato";
import { classificadorLimpo, type Citacao } from "./ag4-conversa";
import { CenarioDaAg5, configDaAg5 } from "./ag5-conversa";
import {
  EXECUTOR,
  NUMERO,
  rpcDaAtribuicaoDaAg6,
  rpcDaPassagemDaAg6,
  TELEFONE,
  type OpcoesDaPassagemDaAg6,
} from "./ag6-contrato";
import {
  jpegSintetico,
  linhaDeMidia,
  mp3Sintetico,
  PRECO_DO_WHISPER_POR_MINUTO,
  rpcsDaAg6b,
} from "./ag6b-contrato";
import {
  AGORA,
  CLINICA,
  CONTATO,
  CONVERSA,
  PROF,
} from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// As conversas LONGAS do agente (AG0): o mesmo paciente, em muitos turnos
// separados, cruzando as etapas. O que as suites por etapa nao pegam e o que
// so aparece entre elas, e o que o paciente recebe mora no EXECUTOR: por isso
// aqui cada fala roda o job inteiro, como na producao:
//
//  - o executor de verdade (executarRespostaComIa), com o laco de verdade, o
//    filtro de verdade e o envio de verdade (send.ts) sobre o provedor falso,
//    como tests/unit/ia-whatsapp/ponta-a-ponta.test.ts;
//  - o LLM falso de roteiro, por fala;
//  - os contratos das RPCs em memoria das suites por etapa (CenarioDaAg5, que
//    liga os da AG3, da AG4 e da AG5, e o da passagem da AG6), mais o que faltava
//    entre eles: o estado gravado pelo executor (com o carimbo do banco), a
//    guarda do envio e o gatilho de message.
//
// Dois bancos em memoria, um de cada suite, compartilhando as linhas de
// message, contact e ia_janela_da_conversa: o da agenda (range, contains, as
// RPCs da agenda) e o do executor (insert, update, upsert, ai_turno,
// ai_decision_log). O relogio e o da clinica ficticia (terca, 20/10/2026, 09:00
// em Fortaleza), injetado, com o Date do processo preso nele. Nenhum dado real.

/** As tabelas que so a agenda le (o resto fica no banco do executor). */
const TABELAS_DA_AGENDA: ReadonlySet<string> = new Set([
  "appointment",
  "appointment_status_history",
  "audit_log",
  "dados_informados_na_marcacao",
  "ia_pedido_de_espera",
  "professional_block",
  "professional_schedule",
  "slot_hold",
  "waitlist",
]);

const STATUS_DE_CONSULTA_ENCERRADA: ReadonlySet<string> = new Set([
  "cancelado_paciente",
  "cancelado_clinica",
  "faltou",
  "compareceu",
]);

/** O que o vi.mock de "@/lib/agente/contexto" do teste le. */
export type ContextoDoTeste = { config: unknown; catalogo: unknown };

/** A versao publicada da clinica ficticia: tudo ligado, o preparo inclusive. */
export function configPublicada(
  extra: Partial<ConfigDoAgente> = {},
): ConfigDoAgente {
  const base = configDaAg5();
  return {
    ...base,
    status: "publicada",
    versao: 3,
    habilidades: {
      ...base.habilidades,
      enviar_preparo: true,
      ler_audio: true,
      ler_imagem_e_documento: true,
    },
    ...extra,
  };
}

/** O id (uuid) da versao do preparo em vigor de um procedimento. */
function versaoDoPreparo(procedimentoId: string): string {
  return `e7e70000-0000-4000-8000-${procedimentoId.replaceAll("-", "").slice(0, 12)}`;
}

/**
 * O catalogo com a orientacao de preparo em vigor nos procedimentos dados (o
 * texto de teste, aprovado pelo RT ficticio).
 */
export function comPreparoEmVigor(
  base: CatalogoDoAgente,
  procedimentos: readonly string[],
): CatalogoDoAgente {
  const preparo = (id: string): PreparoEmVigor => ({
    versaoId: versaoDoPreparo(id),
    versao: 1,
    textoSha256: sha256DoTexto(TEXTO_DO_PREPARO_DE_TESTE),
    rtNome: RT_DE_TESTE.nome,
    aprovadoEm: "2026-10-01T13:00:00.000Z",
  });
  return {
    ...base,
    preparosEmVigor: new Map(procedimentos.map((id) => [id, preparo(id)])),
    textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE],
  };
}

export type FalaDaConversa = {
  /** O que o paciente escreveu (o original). */
  texto: string;
  /** O LLM falso deste job; tudo tem de ser consumido. Padrao: nada. */
  roteiro?: unknown[];
  /** Na primeira chamada ao modelo: a pessoa escrevendo no meio do turno. */
  durante?: () => void;
  citacao?: Citacao;
  /** O que o classificador falso diz neste job. Padrao: limpo. */
  classificacao?: ResultadoDoClassificador;
  /** O verificador falso deste job. Padrao: aprova. */
  verificador?: Verificador;
};

export type TurnoDaConversa = {
  /** A ordem do job na conversa, para a mensagem do assert. */
  indice: number;
  job: string;
  resultado: ResultadoDeJob;
  /** O que o laco devolveu; null quando ele nem rodou. */
  doLaco: ResultadoDoTurno | null;
  /** O que saiu para o paciente neste job (o que chegou ao provedor). */
  enviadas: string[];
  /** A decisao que este job gravou. */
  decisao: Linha | undefined;
  chamadasAoModelo: number;
  /** As ferramentas que rodaram, na ordem. */
  ferramentas: readonly string[];
  /** O estado gravado depois do job. */
  estado: EstadoDoAtendimento;
  statusDaConversa: string;
  /** Os corpos que este job mandou ao modelo. */
  corpos: Record<string, unknown>[];
};

/** As ferramentas que o roteiro do LLM falso pede, na ordem. */
function ferramentasDoRoteiro(roteiro: readonly unknown[]): string[] {
  return roteiro.flatMap((rodada) =>
    (((rodada as { output?: unknown } | null)?.output ?? []) as {
      type?: string;
      name?: string;
    }[]).flatMap((item) =>
      item.type === "function_call" && typeof item.name === "string"
        ? [item.name]
        : [],
    ),
  );
}

/** As saidas das ferramentas que o modelo leu no ultimo corpo do job. */
export function saidasDoTurno(turno: TurnoDaConversa): Record<string, unknown>[] {
  const input = (turno.corpos.at(-1)?.input ?? []) as {
    type?: string;
    output?: string;
  }[];
  return input
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

/** Os textos dos passos da trilha gravada na decisao do turno. */
export function trilhaDoTurno(turno: TurnoDaConversa): string[] {
  const contexto = turno.decisao?.context_read as
    | { trilha?: { texto: string }[] }
    | undefined;
  return (contexto?.trilha ?? []).map((passo) => passo.texto);
}

export class ConversaLonga {
  readonly cenario: CenarioDaAg5;
  readonly executor = new BancoEmMemoria();
  readonly turnos: TurnoDaConversa[] = [];
  /** Tudo o que o paciente escreveu (nada disso pode ir para log). */
  readonly falas: string[] = [];
  /** O que a passagem respondeu. */
  readonly passagens: Record<string, unknown>[] = [];
  /** O que foi ao classificador falso (o texto que sai para a OpenAI). */
  private readonly aoClassificador: string[] = [];
  /** A autorizacao para receber mensagens. */
  consentimento = true;
  /** A liberacao da IA para este telefone (o interruptor da clinica). */
  liberada = true;
  /** A versao do preparo saiu de vigor (a leitura do envio devolve nulo). */
  preparoForaDeVigor = false;
  /** O proximo envio encontra o canal do numero ocupado (slot adiado). */
  canalOcupado = false;
  /** A transcricao e a leitura falsas, por mensagem. */
  private readonly transcricoes = new Map<string, ResultadoDaTranscricaoNoModelo>();
  private readonly leituras = new Map<string, ResultadoDoLeitor>();
  /** A conversa ja saiu da IA em algum turno. */
  private saiuDaIa = false;

  constructor(
    contexto: ContextoDoTeste,
    e: {
      catalogo: CatalogoDoAgente;
      config?: ConfigDoAgente;
      /** A clinica com duas unidades: a jornada da Dra. Ana por unidade. */
      duasUnidades?: boolean;
    },
  ) {
    const config = e.config ?? configPublicada();
    contexto.config = config;
    contexto.catalogo = e.catalogo;
    this.cenario = new CenarioDaAg5({
      catalogo: e.catalogo,
      config,
      marcas: e.duasUnidades === true ? { unidadesAtivas: 2 } : {},
    });
    if (e.duasUnidades === true) {
      for (const faixa of this.cenario.banco.linhas("professional_schedule")) {
        if (faixa.professional_id === PROF.ana) {
          faixa.unit_id =
            faixa.starts_at === "08:00:00" ? UNID.aldeota : UNID.centro;
        }
      }
    }
    this.montarOBancoDoExecutor();
    vi.setSystemTime(this.cenario.agora);
  }

  // -------------------------------------------------------------------------
  // O banco
  // -------------------------------------------------------------------------

  private montarOBancoDoExecutor(): void {
    const { executor } = this;
    const agenda = this.cenario.banco;
    // As linhas que os dois lados leem: o mesmo array nos dois bancos.
    for (const tabela of ["message", "contact", "ia_janela_da_conversa"]) {
      executor.tabelas.set(tabela, agenda.linhas(tabela));
    }
    for (const contato of agenda.linhas("contact")) {
      Object.assign(contato, {
        phone_key: TELEFONE,
        phone_e164: TELEFONE,
        owner_user_id: null,
      });
    }
    for (const janela of agenda.linhas("ia_janela_da_conversa")) {
      janela.phone_key = TELEFONE;
    }
    executor.linhas("clinic").push({
      id: CLINICA,
      timezone: "America/Fortaleza",
      e_de_teste: false,
    });
    executor.linhas("conversation").push({
      id: CONVERSA,
      clinic_id: CLINICA,
      status: "ia_atendendo",
      assignee_user_id: null,
      contact_id: CONTATO,
      whatsapp_account_id: NUMERO,
      awaiting_reply: true,
      numero: {
        id: NUMERO,
        provider: "fake",
        server_url: null,
        instance_id: "fake-a0000000",
        nome: "Recepção",
        connection_status: "conectado",
        removido_em: null,
      },
    });
    executor.linhas("whatsapp_account_secret").push({
      clinic_id: CLINICA,
      account_id: NUMERO,
      instance_token: "token",
    });
    executor.linhas("ai_agent_config").push({
      clinic_id: CLINICA,
      status: "publicada",
      version: 3,
      escalation_rules: { passagem_para: "fila" },
      skills: { ler_audio: true, ler_imagem_e_documento: true },
    });
    for (const procedimento of this.cenario.catalogo.procedimentos) {
      executor.linhas("procedure").push({
        id: procedimento.id,
        clinic_id: CLINICA,
        name: procedimento.nome,
        active: true,
      });
    }
    executor.linhas("ia_liberacao").push({
      clinic_id: CLINICA,
      teto_respostas_por_conversa_hora: 20,
    });
    executor.linhas("llm_preco").push({
      modelo: "gpt-6-luna",
      entrada_microdolar_por_milhao: 1_000_000,
      saida_microdolar_por_milhao: 4_000_000,
      cache_leitura_microdolar_por_milhao: 100_000,
      cache_escrita_microdolar_por_milhao: 0,
    });
    executor.linhas("llm_preco").push({
      modelo: "whisper-1",
      entrada_microdolar_por_milhao: 0,
      saida_microdolar_por_milhao: 0,
      cache_leitura_microdolar_por_milhao: 0,
      cache_escrita_microdolar_por_milhao: 0,
      audio_microdolar_por_minuto: PRECO_DO_WHISPER_POR_MINUTO,
    });
    executor.aoInserir = (tabela, linha) => this.gatilhoDoBanco(tabela, linha);
    this.ligarAsRpcs();
  }

  /**
   * O que o banco de verdade faz nas linhas: o instante e os padroes de
   * message, as lidas do turno (a mensagem nova da pessoa no contrato) e o
   * gatilho de message: a linha da IA so com a decisao aprovada do mesmo job
   * e o mesmo hash; a do sistema no job so a frase fixa ou o preparo da
   * decisao 'enviou_preparo'.
   */
  private gatilhoDoBanco(
    tabela: string,
    linha: Linha,
  ): { code: string; message: string } | null {
    if (tabela === "ai_turno") {
      this.cenario.lidasPorJob.set(
        String(linha.job_id),
        (linha.mensagens_lidas as string[] | null) ?? [],
      );
      return null;
    }
    if (tabela !== "message") {
      return null;
    }
    const ultima = this.cenario.noBanco.at(-1)?.em ?? Number.NEGATIVE_INFINITY;
    Object.assign(linha, {
      created_at: new Date(
        Math.max(this.cenario.agora + 1, ultima + 1),
      ).toISOString(),
      pelo_celular: false,
      is_internal_note: linha.is_internal_note ?? false,
      deleted_at: null,
      media_url: linha.media_url ?? null,
    });
    if (typeof linha.job_id !== "string") {
      return null;
    }
    const sha = sha256DoTexto(String(linha.body));
    const doJob = this.executor
      .linhas("ai_decision_log")
      .filter((d) => d.job_id === linha.job_id);
    if (linha.author === "ia") {
      return doJob.some(
        (d) =>
          d.aprovado === true &&
          d.compliance_blocked === false &&
          d.texto_sha256 === sha,
      )
        ? null
        : { code: "CZIA1", message: "ia_sem_aprovacao" };
    }
    return linha.body === FRASE_DE_ESCALONAMENTO ||
      doJob.some((d) => d.desfecho === "enviou_preparo" && d.texto_sha256 === sha)
      ? null
      : { code: "CZIA3", message: "frase_divergente" };
  }

  private ligarAsRpcs(): void {
    const { executor } = this;
    const verdadeiro = () => ({ data: true, error: null });
    executor.rpc("ia_pode_falar_com", () => ({
      data: this.liberada,
      error: null,
    }));
    executor.rpc("confirmar_posse_job", verdadeiro);
    executor.rpc("ia_marcar_respondida", verdadeiro);
    executor.rpc("consentimento_vigente", () => ({
      data: this.consentimento,
      error: null,
    }));
    executor.rpc("reservar_slot_envio_v2", () => {
      if (this.canalOcupado) {
        this.canalOcupado = false;
        return {
          data: {
            estado: "adiado",
            livre_em: new Date(this.cenario.agora + 20_000).toISOString(),
          },
          error: null,
        };
      }
      return { data: { estado: "ok", espera_ms: 0 }, error: null };
    });
    executor.rpc("reservar_gasto_da_ia", () => ({
      data: randomUUID(),
      error: null,
    }));
    executor.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
    executor.rpc("gravar_evento_da_ia", verdadeiro);
    // A guarda do envio: a resposta so com a conversa na IA; a frase so com
    // ela ja na fila, sem responsavel.
    executor.rpc("ia_pode_enviar_agora", (args) => {
      const conversa = this.conversa;
      const semResponsavel = (conversa.assignee_user_id ?? null) === null;
      const naIa = conversa.status === "ia_atendendo" && semResponsavel;
      const naFila = conversa.status === "aguardando_humano" && semResponsavel;
      return {
        data: (args.p_tipo === "frase" ? naFila : naIa) ? "ok" : "fora_da_ia",
        error: null,
      };
    });
    const passagem: OpcoesDaPassagemDaAg6 = {
      conversationId: CONVERSA,
      clinicId: CLINICA,
      respostas: this.passagens,
    };
    rpcDaPassagemDaAg6(executor, passagem);
    rpcDaAtribuicaoDaAg6(executor, passagem);
    rpcsDaAg6b(executor, { liberado: () => true });
    this.ligarOEstado();
    this.ligarOPreparo();
    this.ligarAFila();
    // Toda RPC de agenda do banco recusa a conversa que saiu da IA (os
    // contratos da AG3 e da AG4 nao tem a conversa, so o da AG5).
    const agenda = this.cenario.banco;
    for (const nome of [
      "reservar_horario_da_ia",
      "registrar_dados_da_marcacao",
      "agendar_pela_ia",
      "cancelar_consulta_pela_ia",
      "pedir_lista_de_espera_pela_ia",
      "entrar_na_lista_de_espera_pela_ia",
    ]) {
      const doContrato = agenda.manipuladores.get(nome)!;
      agenda.rpc(nome, async (args) => {
        if (
          this.conversa.status !== "ia_atendendo" ||
          (this.conversa.assignee_user_id ?? null) !== null
        ) {
          return { data: { ok: false, motivo: "ia_desligada" }, error: null };
        }
        const resposta = await doContrato(args);
        // O default do banco: o corte de "desde a marcacao" (os contratos nao
        // gravam o created_at da consulta).
        for (const consulta of agenda.linhas("appointment")) {
          consulta.created_at ??= new Date(this.cenario.agora).toISOString();
        }
        return resposta;
      });
    }
  }

  /**
   * ler_atendimento_da_ia e gravar_atendimento_da_ia: a versao e a
   * idempotencia do banco em memoria do executor; `dados` como o banco calcula
   * (a linha aberta da conversa e a reserva viva) e o carimbo do pedido. O
   * estado gravado e o que os contratos da agenda conferem.
   */
  private ligarOEstado(): void {
    const { executor, cenario } = this;
    const ler = executor.manipuladores.get("ler_atendimento_da_ia")!;
    const gravar = executor.manipuladores.get("gravar_atendimento_da_ia")!;
    executor.rpc("ler_atendimento_da_ia", async (args) => {
      const lido = await ler(args);
      const dado = lido.data as Linha;
      return dado.ok === true
        ? {
            data: {
              ...dado,
              janela_desde: this.cenario.banco.linhas(
                "ia_janela_da_conversa",
              )[0]?.desde,
              dados: this.dadosLidos(),
            },
            error: null,
          }
        : lido;
    });
    executor.rpc("gravar_atendimento_da_ia", async (args) => {
      const carimbado = comOCarimboDoBanco(
        cenario.atendimento.estado,
        args.p_estado as EstadoDoAtendimento,
        cenario.agora,
      );
      const r = await gravar({ ...args, p_estado: carimbado });
      if ((r.data as Linha | null)?.ok === true) {
        cenario.atendimento = {
          estado: carimbado,
          dados: this.dadosLidos(),
        };
      }
      return r;
    });
  }

  /** ler_preparo_para_envio: a mensagem que o banco monta da versao em vigor. */
  private ligarOPreparo(): void {
    this.executor.rpc("ler_preparo_para_envio", (args) => {
      const { catalogo } = this.cenario;
      const achado = [...(catalogo.preparosEmVigor ?? new Map()).entries()].find(
        ([, preparo]) => preparo.versaoId === args.p_versao_id,
      );
      if (this.preparoForaDeVigor || achado === undefined) {
        return { data: null, error: null };
      }
      const [procedimentoId, preparo] = achado;
      const nome = [
        ...catalogo.procedimentos,
        ...(catalogo.procedimentosSoComAEquipe ?? []),
      ].find((p) => p.id === procedimentoId)?.nome;
      const mensagem = mensagemDoPreparo({
        procedimento: nome ?? "",
        rt: RT_DE_TESTE,
        texto: TEXTO_DO_PREPARO_DE_TESTE,
      });
      return {
        data: {
          versao_id: preparo.versaoId,
          procedure_id: procedimentoId,
          versao: preparo.versao,
          mensagem,
          sha256: sha256DoTexto(mensagem),
        },
        error: null,
      };
    });
  }

  /**
   * enfileirar_resposta_da_ia: junta com o job pendente da conversa ou cria
   * um; com a conversa fora da IA, conversa_fora_da_ia.
   */
  private ligarAFila(): void {
    this.executor.rpc("enfileirar_resposta_da_ia", () => {
      if (this.conversa.status !== "ia_atendendo") {
        return { data: { codigo: "conversa_fora_da_ia" }, error: null };
      }
      const pendente = this.jobPendente;
      if (pendente !== undefined) {
        return {
          data: { codigo: "juntou", job_id: pendente.id },
          error: null,
        };
      }
      const job = this.novoJob("pendente");
      return { data: { codigo: "enfileirado", job_id: job.id }, error: null };
    });
  }

  private dadosLidos(): DadosInformados {
    const agenda = this.cenario.banco;
    const aberta = agenda
      .linhas("dados_informados_na_marcacao")
      .find(
        (d) =>
          d.conversation_id === CONVERSA && (d.appointment_id ?? null) === null,
      );
    const viva = agenda
      .linhas("slot_hold")
      .filter(
        (h) =>
          h.conversation_id === CONVERSA &&
          h.consumido_em === null &&
          Date.parse(String(h.expires_at)) > this.cenario.agora,
      )
      .at(-1);
    const vinculo = this.cenario.catalogo.vinculos.find(
      (v) => v.id === viva?.service_link_id,
    );
    const informados = {
      nome_completo: (aberta?.nome_completo ?? null) !== null,
      data_nascimento: (aberta?.data_nascimento ?? null) !== null,
      cpf: (aberta?.cpf ?? null) !== null,
      carteirinha: (aberta?.carteirinha ?? null) !== null,
    };
    return {
      ...informados,
      para_o_titular: (aberta?.para_o_titular as boolean | undefined) ?? null,
      faltam: dadosQueFaltam({
        exigidos: this.cenario.opcoes.exigidos,
        informados,
        vinculo:
          vinculo === undefined
            ? null
            : {
                procedimentoId: vinculo.procedimentoId,
                convenioId: vinculo.convenioId,
              },
        catalogo: this.cenario.catalogo,
      }),
    };
  }

  /** O cliente do executor: cada tabela e cada RPC no banco que a conhece. */
  private get admin(): SupabaseClient {
    const agenda = this.cenario.banco;
    const daAgenda = agenda.cliente();
    const doExecutor = this.executor.cliente();
    return {
      from: (tabela: string) =>
        TABELAS_DA_AGENDA.has(tabela)
          ? daAgenda.from(tabela)
          : doExecutor.from(tabela),
      rpc: (nome: string, args?: Record<string, unknown>) =>
        agenda.manipuladores.has(nome)
          ? daAgenda.rpc(nome, args)
          : doExecutor.rpc(nome, args),
    } as unknown as SupabaseClient;
  }

  // -------------------------------------------------------------------------
  // O que os testes leem
  // -------------------------------------------------------------------------

  get conversa(): Linha {
    return this.executor.linhas("conversation")[0]!;
  }

  get estado(): EstadoDoAtendimento {
    return this.cenario.atendimento.estado;
  }

  get dados(): DadosInformados {
    return this.dadosLidos();
  }

  /** As consultas do contato (o banco da agenda). */
  get consultas(): Linha[] {
    return this.cenario.banco
      .linhas("appointment")
      .filter((a) => a.contact_id === CONTATO);
  }

  /** As consultas de pe: nao canceladas, nao recusadas e no futuro. */
  get consultasVivas(): Linha[] {
    return this.consultas.filter(
      (a) =>
        !STATUS_DE_CONSULTA_ENCERRADA.has(String(a.status)) &&
        a.approval_status !== "recusado" &&
        Date.parse(String(a.starts_at)) > this.cenario.agora,
    );
  }

  /** As reservas nao consumidas e nao vencidas desta conversa. */
  get reservasVivas(): Linha[] {
    return this.cenario.banco
      .linhas("slot_hold")
      .filter(
        (h) =>
          h.conversation_id === CONVERSA &&
          h.consumido_em === null &&
          Date.parse(String(h.expires_at)) > this.cenario.agora,
      );
  }

  get decisoes(): Linha[] {
    return this.executor.linhas("ai_decision_log");
  }

  get rascunhosBloqueados(): Linha[] {
    return this.executor.linhas("ai_rascunho_bloqueado");
  }

  /** Tudo o que chegou ao provedor, em toda a conversa. */
  get recebidasPeloPaciente(): string[] {
    return fakeSentMessages().map((m) => m.body);
  }

  /** As notas internas da passagem. */
  get notasInternas(): string[] {
    return this.cenario.banco
      .linhas("message")
      .filter((m) => m.is_internal_note === true)
      .map((m) => String(m.body));
  }

  /** Os eventos do fio. */
  get eventos(): string[] {
    return this.cenario.eventos;
  }

  /** O job que a fila deixou esperando. */
  private get jobPendente(): Linha | undefined {
    return this.executor
      .linhas("job_queue")
      .find((j) => j.status === "pendente");
  }

  get temJobPendente(): boolean {
    return this.jobPendente !== undefined;
  }

  // -------------------------------------------------------------------------
  // O que acontece na conversa
  // -------------------------------------------------------------------------

  /** O tempo passa (entre as mensagens). */
  passa(ms: number): void {
    this.cenario.agora += ms;
    vi.setSystemTime(this.cenario.agora);
  }

  /** A pessoa escreve de novo, sem rodar job (a rajada, ou o meio do turno). */
  escreve(texto: string, citacao?: Citacao): string {
    this.falas.push(texto);
    return this.cenario.escreve(texto, undefined, citacao);
  }

  /** Uma mensagem da clinica fora do turno (campanha, lembrete, a equipe). */
  daClinica(texto: string, autoria: "sistema" | "usuario" = "sistema"): string {
    const id = this.cenario.daClinica(texto, autoria);
    const linha = this.cenario.banco.linhas("message").find((m) => m.id === id);
    if (linha !== undefined) {
      linha.pelo_celular = false;
    }
    return id;
  }

  /** Alguem da equipe assume a conversa (Assumir). */
  equipeAssume(): void {
    Object.assign(this.conversa, {
      status: "em_atendimento",
      assignee_user_id: "a1a1a1a1-0000-4000-8000-000000000001",
    });
  }

  /** A equipe aprova a consulta (a marcada pela IA, ou a remarcacao). */
  equipeAprova(consulta: Linha): void {
    consulta.approval_status = "aprovado";
    const antiga = this.consultas.find((a) => a.id === consulta.remarcacao_de);
    if (antiga !== undefined) {
      antiga.status = "cancelado_clinica";
    }
  }

  /** Uma fala do paciente: a mensagem e o job dela, dois minutos depois. */
  async fala(
    f: FalaDaConversa,
    intervaloMs: number = 2 * 60_000,
  ): Promise<TurnoDaConversa> {
    if (this.cenario.banco.linhas("message").length > 0) {
      this.passa(intervaloMs);
    }
    this.escreve(f.texto, f.citacao);
    return this.rodarJob(f);
  }

  /** O audio da pessoa: a transcricao falsa (o texto, ou nada: sem fala). */
  async audio(
    transcricao: string | null,
    f: Omit<FalaDaConversa, "texto" | "citacao"> = {},
  ): Promise<TurnoDaConversa> {
    const id = this.midiaNaConversa("audio");
    this.transcricoes.set(
      id,
      transcricao === null
        ? { tipo: "sem_fala", segundos: 15, uso: { modelo: "whisper-1", segundos: 15 } }
        : {
            tipo: "transcrita",
            texto: transcricao,
            segundos: 15,
            uso: { modelo: "whisper-1", segundos: 15 },
          },
    );
    if (transcricao !== null) {
      this.falas.push(transcricao);
    }
    return this.rodarJob(f);
  }

  /** A foto da pessoa: a leitura falsa do arquivo. */
  async foto(
    leitura: Extract<ResultadoDoLeitor, { tipo: "lido" }>["leitura"],
    f: Omit<FalaDaConversa, "texto" | "citacao"> = {},
  ): Promise<TurnoDaConversa> {
    const id = this.midiaNaConversa("imagem");
    this.leituras.set(id, {
      tipo: "lido",
      leitura,
      modelo: "gpt-6-luna",
      uso: {
        tokensEntrada: 1_900,
        tokensSaida: 20,
        tokensCacheLidos: 0,
        tokensCacheGravados: 0,
      },
    });
    return this.rodarJob(f);
  }

  /** A mensagem do paciente com midia, dois minutos depois da anterior. */
  private midiaNaConversa(contentType: "audio" | "imagem"): string {
    this.passa(2 * 60_000);
    const id = randomUUID();
    this.cenario.banco.inserir(
      "message",
      linhaDeMidia({
        id,
        contentType,
        criadaEm: new Date(this.cenario.agora).toISOString(),
      }),
    );
    return id;
  }

  /** Varias mensagens antes de o job rodar: um job so le todas. */
  async rajada(
    textos: readonly string[],
    f: Omit<FalaDaConversa, "texto">,
    intervaloMs: number = 2 * 60_000,
  ): Promise<TurnoDaConversa> {
    this.passa(intervaloMs);
    for (const texto of textos) {
      this.escreve(texto);
    }
    return this.rodarJob(f);
  }

  /** Um job sem mensagem nova (o segundo job da mesma rajada). */
  async continua(
    f: Omit<FalaDaConversa, "texto"> = {},
  ): Promise<TurnoDaConversa> {
    return this.rodarJob(f);
  }

  /** O mesmo job de novo, como a fila faz com o que nao foi concluido. */
  async repetirOJob(turno: TurnoDaConversa): Promise<TurnoDaConversa> {
    const linha = this.executor
      .linhas("job_queue")
      .find((j) => j.id === turno.job);
    if (linha === undefined) {
      throw new Error("job fora da fila");
    }
    return this.rodarJob({}, linha);
  }

  /** O job que a fila deixou esperando (a mensagem nova da pessoa). */
  async rodarOJobPendente(
    f: Omit<FalaDaConversa, "texto">,
  ): Promise<TurnoDaConversa> {
    const pendente = this.jobPendente;
    if (pendente === undefined) {
      throw new Error("nenhum job pendente");
    }
    this.passa(20_000);
    return this.rodarJob(f, pendente);
  }

  private novoJob(status: "pendente" | "executando"): Job & Linha {
    const job = {
      id: randomUUID(),
      clinic_id: CLINICA,
      kind: "responder_com_ia",
      payload: { conversation_id: CONVERSA },
      attempts: 1,
      max_attempts: 3,
      whatsapp_account_id: NUMERO,
      created_at: new Date(this.cenario.agora).toISOString(),
      updated_at: new Date(this.cenario.agora).toISOString(),
      status,
    };
    this.executor.linhas("job_queue").push(job);
    return job as Job & Linha;
  }

  private async rodarJob(
    f: Omit<FalaDaConversa, "texto">,
    jaNaFila?: Linha,
  ): Promise<TurnoDaConversa> {
    const { cenario } = this;
    const linha = jaNaFila ?? this.novoJob("executando");
    linha.status = "executando";
    const job = linha as unknown as Job;
    const estavaFora = this.conversa.status !== "ia_atendendo";
    const decisoesAntes = this.decisoes.length;
    const enviadasAntes = fakeSentMessages().length;
    if (!cenario.jobs.includes(job.id)) {
      cenario.jobs.push(job.id);
      cenario.jobCriadoEm.set(job.id, Date.parse(job.created_at ?? ""));
      cenario.estadoDoTurnoPorJob.set(job.id, "reservado");
    }

    const roteiro = [...(f.roteiro ?? [])];
    const corpos: Record<string, unknown>[] = [];
    let primeira = true;
    const create = vi.fn(async (corpo: unknown) => {
      const copia = structuredClone(corpo) as Record<string, unknown>;
      corpos.push(copia);
      cenario.corpos.push(copia);
      if (primeira) {
        primeira = false;
        f.durante?.();
      }
      return roteiro.shift();
    });
    let doLaco: ResultadoDoTurno | null = null;
    const classificador: ClassificadorDeEntrada = async (e) => {
      this.aoClassificador.push(...e.mensagens);
      return f.classificacao ?? classificadorLimpo(e);
    };
    const deps: DependenciasDoExecutorDaIa = {
      admin: this.admin,
      config: { ligado: true, clinicas: [CLINICA] },
      prazoFinalMs: cenario.agora + 55_000,
      agora: () => cenario.agora,
      clienteDoAgente: () =>
        ({ responses: { create } }) as unknown as ClienteDoAgente,
      modeloDoAgente: () => "gpt-6-luna",
      segredoDoIdentificador: () => "s".repeat(40),
      criarVerificador: () => f.verificador ?? cenario.verificacao.verificador,
      criarClassificador: () => classificador,
      executarTurno: async (entrada) => {
        doLaco = await executarTurnoDoAgente(entrada);
        return doLaco;
      },
      enviarResposta: enviarRespostaDaIa,
      enviarFrase: enviarFraseFixaDaIa,
      enviarPreparo: enviarPreparoAprovadoDaIa,
      midia: this.midiaDoExecutor(),
    };
    const resultado = await executarRespostaComIa(job, EXECUTOR, deps);
    linha.status = "concluido";

    const doTurno = this.executor
      .linhas("ai_turno")
      .find((t) => t.job_id === job.id);
    cenario.estadoDoTurnoPorJob.set(
      job.id,
      String(doTurno?.estado ?? "sem_envio"),
    );
    const turno: TurnoDaConversa = {
      indice: this.turnos.length + 1,
      job: job.id,
      resultado,
      doLaco,
      enviadas: fakeSentMessages()
        .slice(enviadasAntes)
        .map((m) => m.body),
      decisao: this.decisoes.filter((d) => d.job_id === job.id).at(-1),
      chamadasAoModelo: create.mock.calls.length,
      ferramentas:
        (doLaco as ResultadoDoTurno | null)?.ferramentasUsadas ?? [],
      estado: cenario.atendimento.estado,
      statusDaConversa: String(this.conversa.status),
      corpos,
    };
    this.turnos.push(turno);
    this.conferirOTurno(turno, {
      estavaFora,
      decisoesNovas: this.decisoes.length - decisoesAntes,
      sobrouNoRoteiro: roteiro.length,
      pedidas: ferramentasDoRoteiro(f.roteiro ?? []),
    });
    this.saiuDaIa ||= turno.statusDaConversa !== "ia_atendendo";
    return turno;
  }

  /** A midia de verdade (o plano e a porta) sobre as integracoes falsas. */
  private midiaDoExecutor(): NonNullable<DependenciasDoExecutorDaIa["midia"]> {
    const tetosDoLeitor = { imagem: 1_600, pagina: 1_800 };
    return {
      transcricaoCalibrada: true,
      tetosDoLeitor,
      modeloDaTranscricao: "whisper-1",
      modeloDoLeitor: "gpt-6-luna",
      criarPorta: (e) =>
        portaDaMidiaDoWhatsapp(this.admin, {
          ...e,
          lerArquivo: async (a) => ({
            tipo: "ok",
            bytes: this.transcricoes.has(a.messageId)
              ? mp3Sintetico(15)
              : jpegSintetico(),
          }),
          transcrever: async (t) =>
            this.transcricoes.get(t.messageId) ?? {
              tipo: "falhou",
              motivo: "desconhecida",
              uso: null,
            },
          lerComOModelo: async (l) =>
            this.leituras.get(l.messageId) ?? {
              tipo: "falha",
              motivo: "desconhecida",
              modelo: null,
              uso: null,
            },
          versaoDaTranscricao: "transcricao-0123456789ab",
          modeloDoLeitor: "gpt-6-luna",
          modeloDaTranscricao: "whisper-1",
          tetosDoLeitor,
        }),
    };
  }

  // -------------------------------------------------------------------------
  // Os invariantes de TODO turno
  // -------------------------------------------------------------------------

  private conferirOTurno(
    turno: TurnoDaConversa,
    e: {
      estavaFora: boolean;
      decisoesNovas: number;
      sobrouNoRoteiro: number;
      pedidas: readonly string[];
    },
  ): void {
    const rotulo = `turno ${turno.indice}`;
    // O roteiro do LLM falso foi todo usado: o turno nao parou antes da hora.
    expect(e.sobrouNoRoteiro, `${rotulo}: sobrou roteiro`).toBe(0);
    // Toda ferramenta que o modelo pediu rodou, na ordem, e nenhuma outra
    // (escalar_humano encerra sem rodar; a desconhecida e falha fechada).
    if (turno.decisao?.motivo_da_falha !== "ferramenta_invalida") {
      expect(turno.ferramentas, `${rotulo}: ferramentas`).toEqual(
        e.pedidas.filter((nome) => nome !== "escalar_humano"),
      );
    }
    // Cada job manda no maximo uma mensagem e grava no maximo uma decisao.
    expect(turno.enviadas.length, `${rotulo}: enviadas`).toBeLessThanOrEqual(1);
    expect(e.decisoesNovas, `${rotulo}: decisoes`).toBeLessThanOrEqual(1);
    // O estado gravado tem a forma que o banco aceita.
    expect(estadoDoAtendimentoValido(turno.estado), `${rotulo}: estado`).toBe(
      true,
    );

    // Depois da passagem: nada de modelo, nada enviado, nada decidido.
    if (e.estavaFora) {
      expect(turno.chamadasAoModelo, `${rotulo}: modelo depois da passagem`).toBe(
        0,
      );
      expect(turno.enviadas, `${rotulo}: envio depois da passagem`).toEqual([]);
      expect(e.decisoesNovas, `${rotulo}: decisao depois da passagem`).toBe(0);
      expect(turno.doLaco, `${rotulo}: laco depois da passagem`).toBeNull();
    }

    // O que saiu tem a decisao do mesmo job, com o mesmo texto, e o custo.
    const [enviada] = turno.enviadas;
    if (enviada !== undefined) {
      const decisao = turno.decisao;
      expect(decisao, `${rotulo}: envio sem decisao`).toBeDefined();
      expect(
        this.cenario.banco.linhas("message").find((m) => m.job_id === turno.job),
        `${rotulo}: o registro do envio`,
      ).toMatchObject({
        body: enviada,
        delivery_status: "enviada",
        billable: false,
        cost_cents: 0,
      });
      expect(enviada, `${rotulo}: travessao`).not.toMatch(/[–—]/);
      if (enviada === FRASE_DE_ESCALONAMENTO) {
        expect(["escalou", "bloqueou", "falhou"], rotulo).toContain(
          decisao?.desfecho,
        );
        expect(turno.statusDaConversa, rotulo).not.toBe("ia_atendendo");
      } else {
        expect(decisao?.texto_sha256, `${rotulo}: hash`).toBe(
          sha256DoTexto(enviada),
        );
        expect(["respondeu", "enviou_preparo"], rotulo).toContain(
          decisao?.desfecho,
        );
        expect(turno.statusDaConversa, rotulo).toBe("ia_atendendo");
      }
    }
    // A conversa que passou neste job avisa com a frase fixa, e so ela.
    // (Sem decisao, a passagem sem frase: a autorizacao revogada. Com a
    // liberacao que caiu no meio, a conversa ja estava com alguem: nada sai.)
    if (!e.estavaFora && turno.statusDaConversa !== "ia_atendendo") {
      const semFrase =
        turno.decisao === undefined ||
        turno.decisao.motivo_da_falha === "liberacao_suspensa";
      expect(turno.enviadas, `${rotulo}: a passagem`).toEqual(
        semFrase ? [] : [FRASE_DE_ESCALONAMENTO],
      );
    }
    // A conversa que saiu da IA nao volta sozinha.
    if (this.saiuDaIa) {
      expect(turno.statusDaConversa, rotulo).not.toBe("ia_atendendo");
    }

    this.conferirAsConsultas(rotulo);
    this.conferirOQueFoiAoModelo(rotulo, turno);
    this.conferirADecisao(rotulo, turno);
    // A nota da equipe e montada do estado e do Cadastro: nada do paciente.
    for (const nota of this.notasInternas) {
      expect(nota, `${rotulo}: o nome na nota`).not.toContain("Maria");
      for (const fala of this.falas) {
        if (fala.length >= 12) {
          expect(nota, `${rotulo}: fala na nota`).not.toContain(fala);
        }
      }
    }
  }

  /**
   * Nunca duas consultas de pe do mesmo procedimento marcadas pela IA (fora a
   * remarcacao pendente ligada a antiga), nem duas no mesmo horario do
   * profissional.
   */
  private conferirAsConsultas(rotulo: string): void {
    const vinculos = this.cenario.catalogo.vinculos;
    const porProcedimento = new Map<string, number>();
    const vivas = this.consultasVivas;
    for (const consulta of vivas) {
      if (
        consulta.created_by !== "ia" ||
        (consulta.remarcacao_de != null &&
          consulta.approval_status === "pendente")
      ) {
        continue;
      }
      const procedimento =
        vinculos.find((v) => v.id === consulta.service_link_id)?.procedimentoId ??
        String(consulta.service_link_id);
      porProcedimento.set(
        procedimento,
        (porProcedimento.get(procedimento) ?? 0) + 1,
      );
    }
    for (const [procedimento, total] of porProcedimento) {
      expect(total, `${rotulo}: duas consultas de ${procedimento}`).toBe(1);
    }
    for (const a of vivas) {
      for (const b of vivas) {
        if (a.id !== b.id && a.professional_id === b.professional_id) {
          const seSobrepoem =
            Date.parse(String(a.starts_at)) < Date.parse(String(b.ends_at)) &&
            Date.parse(String(b.starts_at)) < Date.parse(String(a.ends_at));
          expect(seSobrepoem, `${rotulo}: duas no mesmo horario`).toBe(false);
        }
      }
    }
  }

  /** Nada do nome do contato, do telefone nem do preparo vai a OpenAI. */
  private conferirOQueFoiAoModelo(
    rotulo: string,
    turno: TurnoDaConversa,
  ): void {
    for (const corpo of turno.corpos) {
      expect(corpo.store, `${rotulo}: store`).toBe(false);
      expect(corpo.safety_identifier, `${rotulo}: identificador`).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
    const tudo = JSON.stringify([
      turno.corpos,
      this.aoClassificador,
      this.cenario.verificacao.pedidos.map(({ rascunho, mensagensDoPaciente }) => [
        rascunho,
        mensagensDoPaciente,
      ]),
    ]);
    expect(tudo, `${rotulo}: o nome foi ao modelo`).not.toContain("Maria");
    expect(tudo, `${rotulo}: o telefone foi ao modelo`).not.toContain(
      TELEFONE.slice(1),
    );
    for (const frase of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
      expect(tudo, `${rotulo}: o preparo foi ao modelo`).not.toContain(frase);
    }
  }

  /** A decisao diz o que aconteceu, sem texto do paciente. */
  private conferirADecisao(rotulo: string, turno: TurnoDaConversa): void {
    const decisao = turno.decisao;
    if (decisao === undefined) {
      return;
    }
    expect(decisao.blocked_draft, `${rotulo}: rascunho na decisao`).toBeUndefined();
    expect(decisao.job_id, rotulo).toBe(turno.job);
    const contexto = JSON.stringify(decisao.context_read);
    for (const fala of this.falas) {
      if (fala.length >= 12) {
        expect(contexto, `${rotulo}: fala na trilha`).not.toContain(fala);
      }
    }
  }

  /** Nenhuma fala, nome ou telefone em log (quem chama passa o que capturou). */
  conferirOsLogs(escrito: readonly string[]): void {
    const tudo = escrito.join("");
    expect(tudo).not.toContain("Maria");
    expect(tudo).not.toContain(TELEFONE);
    for (const fala of this.falas) {
      if (fala.length >= 12) {
        expect(tudo, "fala em log").not.toContain(fala);
      }
    }
    for (const frase of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
      expect(tudo, "preparo em log").not.toContain(frase);
    }
  }
}

/** O relogio e o provedor falso de cada teste (no beforeEach). */
export function prepararOTeste(): void {
  resetFakeProvider();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
}
