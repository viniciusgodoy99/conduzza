import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idsRespondidos, montarHistorico } from "@/lib/agente/historico";
import {
  CHAVE_DO_LEMBRETE,
  LEMBRETE_DA_OFERTA,
  lembreteDeixaSemResposta,
  MOTIVO_DO_LEMBRETE_DISPENSADO,
  ofertaDePeParaOContato,
  situacaoDoLembrete,
  textoDoLembreteDaOferta,
  type SituacaoDoLembrete,
} from "@/lib/domain/lembrete-da-oferta";
import {
  RESPOSTA_CONFIRMADA,
  RESPOSTA_OFERTA_PERDIDA,
  RESPOSTA_OFERTA_RECUSADA,
} from "@/lib/domain/textos-padrao";
import {
  idDoJobDoLembrete,
  interceptarRespostaDePaciente,
  type EntradaDaResposta,
} from "@/lib/integrations/whatsapp/interceptar-resposta";
import { esperar } from "@/lib/utils/esperar";

// AG5, a oferta da lista de espera na conversa com a IA (desenho, secoes
// 1.6 e 5; decisao D-39 pela recomendacao, pendente do dono), com o
// interceptador DE VERDADE sobre um banco em memoria que imita as consultas
// dele (eq, in, gte, contains, or, not is, o caminho ->> do payload, a chave
// primaria, o status padrao do job):
// - o T-E4 preenchido no fuso da clinica, sem "vaga" nem travessao, com o
//   "se for outro assunto, e so escrever de novo" (revisao da AG5, achado 4);
// - a oferta como a pergunta respondida (a mais recente ou a citada) e sem
//   intencao: o lembrete UMA vez por oferta e contato, pela fila, com o
//   numero que recebeu, sem offer_id, e a conversa NO contador ate ele sair
//   (revisao da AG5, o lembrete que morre sem sair);
// - so na conversa com a IA (fora dela, nada muda: nenhuma leitura) e com a
//   autorizacao para receber mensagens (achado 3);
// - outra pergunta mais recente (toque, fala da equipe ou da IA), a oferta
//   recusada, vencida, por outro numero ou ainda na fila: sem lembrete;
// - o lembrete na fila cobre a mensagem seguinte (achado 1b); o que saiu e a
//   pergunta da oferta feita de novo (achado 1a); e o caso que continua com
//   a IA (achado 1c);
// - o SIM depois do lembrete (sem citar ou citando o lembrete) continua do
//   interceptador;
// - a resposta a oferta sem nada a fazer sai do contador na conversa com a
//   IA, e o NAO QUERO do vencedor fica com quem atende (achado 5);
// - nao regressao dos botoes de hoje (Confirmar, Cancelar, Remarcar), dentro
//   e fora da conversa com a IA;
// - a rota: em todo tratou_com_eco na conversa com a IA, a mensagem e
//   marcada como tratada pelo sistema e sai das pendentes do historico (o
//   toque que hoje volta pendente para a IA tambem), com nova tentativa curta
//   e prazo (achado 6) e o fora_da_ia em info (achado 7); fora da IA, nada;
//   o log so com ids;
// - revisao da AG5, o lembrete que morre sem sair: (a) o SIM chega antes de
//   ele sair e o aceite o cancela; (b) a mensagem coberta e outro candidato,
//   a expiracao, o cancelamento, a guarda do executor, a autorizacao, o
//   numero ou a falha o matam: a conversa fica no contador e o predicado da
//   varredura de 3 minutos a passa para a equipe; o SIM e o NAO QUERO dessa
//   oferta nao a tiram do contador (a leitura que falha tambem nao); o
//   lembrete que sai pelo executor DE VERDADE (so o envio dublado) tira a
//   conversa do contador, so com a IA;
// - o BAIXO: o aceite recusado com a oferta aberta grava o lembrete ja
//   cancelado (dispensado), e a mensagem seguinte vai para a IA sem ele.

// ---------------------------------------------------------------------------
// Banco em memoria
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;
type Erro = { code?: string; message?: string };
type Resposta = { data: unknown; error: Erro | null };
type Filtro = (linha: Linha) => boolean;
type Manipulador = (
  args: Record<string, unknown>,
) => Resposta | Promise<Resposta>;

/** Os padroes de coluna que o banco preenche no insert (o que o teste le). */
const PADROES_DO_INSERT: Record<string, Linha> = {
  job_queue: { status: "pendente" },
};

/** O valor da coluna, com o caminho "payload->>chave" do PostgREST (texto). */
function valorDe(linha: Linha, coluna: string): unknown {
  if (!coluna.includes("->>")) {
    return linha[coluna];
  }
  const [base = "", chave = ""] = coluna.split("->>");
  const objeto = linha[base];
  if (!objeto || typeof objeto !== "object") {
    return null;
  }
  const valor = (objeto as Linha)[chave];
  return valor === undefined || valor === null ? null : String(valor);
}

function comparar(a: unknown, b: unknown): number {
  const x = typeof a === "string" ? Date.parse(a) : Number.NaN;
  const y = typeof b === "string" ? Date.parse(b) : Number.NaN;
  if (!Number.isNaN(x) && !Number.isNaN(y)) {
    return x - y;
  }
  const s = String(a ?? "");
  const t = String(b ?? "");
  return s < t ? -1 : s > t ? 1 : 0;
}

function iguais(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    const x = Date.parse(a);
    const y = Date.parse(b);
    if (!Number.isNaN(x) && !Number.isNaN(y) && /T/.test(a) && /T/.test(b)) {
      return x === y;
    }
  }
  return a === b;
}

class Banco {
  readonly tabelas = new Map<string, Linha[]>();
  readonly erros = new Map<string, Erro>();
  readonly operacoes: { tabela: string; operacao: string }[] = [];
  readonly chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  readonly manipuladores = new Map<string, Manipulador>();
  /** Erro de um insert, decidido na hora (a corrida com outra mensagem). */
  aoInserir: ((tabela: string, linha: Linha) => Erro | null) | null = null;
  /**
   * Erro de qualquer operacao, decidido na hora pela tabela, pela operacao e
   * pelos filtros de igualdade (so uma das leituras).
   */
  aoExecutar:
    | ((
        tabela: string,
        operacao: string,
        igualdades: readonly [string, unknown][],
      ) => Erro | null)
    | null = null;

  linhas(tabela: string): Linha[] {
    let linhas = this.tabelas.get(tabela);
    if (!linhas) {
      linhas = [];
      this.tabelas.set(tabela, linhas);
    }
    return linhas;
  }

  rpc(nome: string, manipulador: Manipulador): void {
    this.manipuladores.set(nome, manipulador);
  }

  chamadasDe(nome: string): Record<string, unknown>[] {
    return this.chamadas.filter((c) => c.nome === nome).map((c) => c.args);
  }

  escritas(): { tabela: string; operacao: string }[] {
    return this.operacoes.filter((o) => o.operacao !== "select");
  }

  cliente(): SupabaseClient {
    return {
      from: (tabela: string) => new Consulta(this, tabela),
      rpc: async (nome: string, args: Record<string, unknown> = {}) => {
        this.chamadas.push({ nome, args });
        const manipulador = this.manipuladores.get(nome);
        return manipulador ? manipulador(args) : { data: null, error: null };
      },
    } as unknown as SupabaseClient;
  }
}

class Consulta implements PromiseLike<Resposta> {
  private operacao: "select" | "insert" | "update" = "select";
  private valores: Linha | Linha[] | null = null;
  private readonly filtros: Filtro[] = [];
  /** Os filtros de igualdade, como dados (para aoExecutar). */
  private readonly igualdades: [string, unknown][] = [];
  private readonly ordem: { coluna: string; ascendente: boolean }[] = [];
  private limite: number | null = null;

  constructor(
    private readonly banco: Banco,
    private readonly tabela: string,
  ) {}

  select(): this {
    return this;
  }
  insert(valores: Linha | Linha[]): this {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  update(valores: Linha): this {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push((l) => iguais(valorDe(l, coluna), valor));
    this.igualdades.push([coluna, valor]);
    return this;
  }
  neq(coluna: string, valor: unknown): this {
    this.filtros.push((l) => !iguais(valorDe(l, coluna), valor));
    return this;
  }
  is(coluna: string, valor: unknown): this {
    this.filtros.push((l) => (valorDe(l, coluna) ?? null) === valor);
    return this;
  }
  not(coluna: string, operador: string, valor: unknown): this {
    if (operador === "is") {
      this.filtros.push((l) => (valorDe(l, coluna) ?? null) !== valor);
    }
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.filtros.push((l) =>
      valores.some((v) => iguais(valorDe(l, coluna), v)),
    );
    return this;
  }
  gte(coluna: string, valor: unknown): this {
    this.filtros.push((l) => comparar(valorDe(l, coluna), valor) >= 0);
    return this;
  }
  contains(coluna: string, valores: unknown[]): this {
    this.filtros.push((l) => {
      const lista = valorDe(l, coluna);
      return Array.isArray(lista) && valores.every((v) => lista.includes(v));
    });
    return this;
  }
  /** "coluna.op.valor,coluna.op.valor" (o valor pode ter ponto). */
  or(expressao: string): this {
    const partes = expressao.split(",").map((parte) => {
      const [coluna = "", operador = "", ...resto] = parte.split(".");
      const valor = resto.join(".");
      return (l: Linha) => {
        const atual = valorDe(l, coluna);
        if (operador === "eq") {
          return iguais(atual, valor);
        }
        if (operador === "gte") {
          return comparar(atual, valor) >= 0;
        }
        throw new Error(`or: operador ${operador} sem suporte`);
      };
    });
    this.filtros.push((l) => partes.some((parte) => parte(l)));
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.ordem.push({ coluna, ascendente: opcoes?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limite = n;
    return this;
  }
  async maybeSingle(): Promise<Resposta> {
    const r = this.executar();
    if (r.error) {
      return r;
    }
    return { data: (r.data as Linha[])[0] ?? null, error: null };
  }
  then<A = Resposta, B = never>(
    ok?: ((valor: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private executar(): Resposta {
    this.banco.operacoes.push({
      tabela: this.tabela,
      operacao: this.operacao,
    });
    const erro =
      this.banco.erros.get(`${this.tabela}:${this.operacao}`) ??
      this.banco.aoExecutar?.(this.tabela, this.operacao, this.igualdades) ??
      null;
    if (erro) {
      return { data: null, error: erro };
    }
    const linhas = this.banco.linhas(this.tabela);
    if (this.operacao === "insert") {
      const novas = Array.isArray(this.valores)
        ? this.valores
        : [this.valores ?? {}];
      for (const nova of novas) {
        const linha: Linha = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...PADROES_DO_INSERT[this.tabela],
          ...nova,
        };
        const recusa = this.banco.aoInserir?.(this.tabela, linha) ?? null;
        if (recusa) {
          return { data: null, error: recusa };
        }
        // A chave primaria, como o Postgres.
        if (linhas.some((existente) => existente.id === linha.id)) {
          return { data: null, error: { code: "23505" } };
        }
        linhas.push(linha);
      }
      return { data: null, error: null };
    }
    const alvo = linhas.filter((l) => this.filtros.every((f) => f(l)));
    if (this.operacao === "update") {
      for (const linha of alvo) {
        Object.assign(linha, this.valores);
      }
      return { data: null, error: null };
    }
    let resultado = [...alvo];
    for (const { coluna, ascendente } of [...this.ordem].reverse()) {
      resultado = resultado.sort(
        (a, b) => comparar(a[coluna], b[coluna]) * (ascendente ? 1 : -1),
      );
    }
    if (this.limite !== null) {
      resultado = resultado.slice(0, this.limite);
    }
    return { data: resultado.map((l) => ({ ...l })), error: null };
  }
}

// ---------------------------------------------------------------------------
// O cenario: uma conversa com a IA e a oferta da lista de espera de pe
// ---------------------------------------------------------------------------

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const OUTRO_NUMERO = "a0000000-0000-4000-8000-000000000002";
const CONTATO = "c0000000-0000-4000-8000-0000000000c1";
const OUTRO_CONTATO = "c0000000-0000-4000-8000-0000000000c2";
const CONVERSA = "c0000000-0000-4000-8000-0000000000a1";
const CONVERSA_DO_OUTRO_NUMERO = "c0000000-0000-4000-8000-0000000000a2";
const OFERTA = "f0000000-0000-4000-8000-0000000000f1";
const JOB_DA_OFERTA = "10000000-0000-4000-8000-0000000000b1";
const MENSAGEM_DA_OFERTA = "e0000000-0000-4000-8000-0000000000e1";
const CONSULTA = "d0000000-0000-4000-8000-0000000000d1";
const RUN = "b0000000-0000-4000-8000-0000000000b9";
const MENSAGEM_DO_TOQUE = "e0000000-0000-4000-8000-0000000000e9";
const MENSAGEM_NOVA = "e0000000-0000-4000-8000-0000000000ff";
const FUSO = "America/Fortaleza";
// 03/11/2026 09:00 em Fortaleza (UTC-3).
const HORARIO = "2026-11-03T12:00:00.000Z";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const atras = (ms: number) => new Date(Date.now() - ms).toISOString();
const adiante = (ms: number) => new Date(Date.now() + ms).toISOString();

let banco: Banco;
let venceEm: string;

function montar(
  opcoes: {
    status?: string;
    ofertaSaiuPor?: string | null;
    oferta?: Partial<Linha>;
  } = {},
): void {
  banco = new Banco();
  venceEm = adiante(45 * MINUTO);
  banco.linhas("clinic").push({ id: CLINICA, timezone: FUSO });
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    status: opcoes.status ?? "ia_atendendo",
    whatsapp_account_id: NUMERO,
    // A ingestao da mensagem que o teste interpreta acabou de acontecer.
    awaiting_reply: true,
    last_inbound_at: new Date().toISOString(),
    created_at: atras(2 * HORA),
  });
  const criadaEm = atras(10 * MINUTO);
  banco.linhas("waitlist_offer").push({
    id: OFERTA,
    clinic_id: CLINICA,
    offered_to: [CONTATO, OUTRO_CONTATO],
    declined_by: [],
    responded_by: null,
    status: "aberta",
    expires_at: venceEm,
    created_at: criadaEm,
    updated_at: criadaEm,
    slot_starts_at: HORARIO,
    ...opcoes.oferta,
  });
  // A mensagem da oferta, criada junto com a oferta (o mesmo created_at e o
  // offer_id no payload), e que SAIU para o contato (send.ts grava o job_id).
  banco.linhas("job_queue").push({
    id: JOB_DA_OFERTA,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    status: "concluido",
    payload: { contact_id: CONTATO, offer_id: OFERTA, body: "A oferta" },
    created_at: criadaEm,
  });
  if (opcoes.ofertaSaiuPor !== null) {
    banco.linhas("message").push({
      id: MENSAGEM_DA_OFERTA,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: "saida",
      author: "sistema",
      is_internal_note: false,
      job_id: JOB_DA_OFERTA,
      wa_message_id: "wa-oferta",
      delivery_status: "entregue",
      whatsapp_account_id: opcoes.ofertaSaiuPor ?? NUMERO,
      created_at: atras(9 * MINUTO),
    });
  }
  // A autorizacao para receber mensagens, vigente (achado 3).
  banco.rpc("consentimento_vigente", () => ({ data: true, error: null }));
}

/** Uma fala da clinica (gente ou IA) depois da oferta. */
function falaDaClinica(autor: "usuario" | "ia", ha: number): void {
  banco.linhas("message").push({
    id: randomUUID(),
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: "saida",
    author: autor,
    is_internal_note: false,
    job_id: null,
    delivery_status: "entregue",
    whatsapp_account_id: NUMERO,
    created_at: atras(ha),
  });
}

/** O toque de confirmacao (regua) de uma consulta futura, saido ha `ha`. */
function toqueDeConfirmacao(ha: number): string {
  const inicio = adiante(26 * HORA);
  banco.linhas("cadence_run").push({
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    message_id: MENSAGEM_DO_TOQUE,
    sent_at: atras(ha),
    scheduled_for: new Date(Date.parse(inicio) - 24 * HORA).toISOString(),
    skipped_reason: null,
    cadence_step: {
      offset_minutes: -24 * 60,
      cadence: { kind: "confirmacao" },
    },
    appointment: {
      id: CONSULTA,
      status: "agendado",
      starts_at: inicio,
      remarcacao_pedida_em: null,
    },
    mensagem: { whatsapp_account_id: NUMERO },
  });
  banco.linhas("message").push({
    id: MENSAGEM_DO_TOQUE,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: "saida",
    author: "sistema",
    is_internal_note: false,
    job_id: null,
    wa_message_id: "wa-toque",
    delivery_status: "entregue",
    whatsapp_account_id: NUMERO,
    created_at: atras(ha),
  });
  for (const [rpc, extra] of [
    ["confirmar_pelo_paciente", {}],
    ["cancelar_pelo_paciente", {}],
    ["pedir_remarcacao_pelo_paciente", {}],
  ] as const) {
    banco.rpc(rpc, () => ({
      data: { ok: true, starts_at: inicio, timezone: FUSO, ...extra },
      error: null,
    }));
  }
  return inicio;
}

const PAYLOAD_DO_LEMBRETE = {
  contact_id: CONTATO,
  body: "o lembrete",
  resposta_ao_paciente: true,
  [CHAVE_DO_LEMBRETE]: OFERTA,
};

/**
 * O lembrete que SAIU: o job (com a chave) e a mensagem do sistema, que pode
 * ter falhado ou saido por outro numero.
 */
function lembreteJaEnviado(
  ha: number,
  opcoes: { entrega?: string; numero?: string } = {},
): void {
  const id = idDoJobDoLembrete(OFERTA, CONTATO);
  const numero = opcoes.numero ?? NUMERO;
  banco.linhas("job_queue").push({
    id,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    status: opcoes.entrega === "falhou" ? "falhou" : "concluido",
    payload: PAYLOAD_DO_LEMBRETE,
    whatsapp_account_id: numero,
    created_at: atras(ha + MINUTO),
  });
  banco.linhas("message").push({
    id: randomUUID(),
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: "saida",
    author: "sistema",
    is_internal_note: false,
    job_id: id,
    wa_message_id: "wa-lembrete",
    delivery_status: opcoes.entrega ?? "entregue",
    whatsapp_account_id: numero,
    created_at: atras(ha),
  });
}

/**
 * O lembrete NA FILA: o job (pendente, por padrao, pelo numero que recebeu)
 * sem mensagem que saiu (nenhuma, ou a que falhou e espera nova tentativa).
 */
function lembreteNaFila(
  opcoes: { status?: string; numero?: string; mensagemQueFalhou?: boolean } = {},
): void {
  const id = idDoJobDoLembrete(OFERTA, CONTATO);
  const numero = opcoes.numero ?? NUMERO;
  banco.linhas("job_queue").push({
    id,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    status: opcoes.status ?? "pendente",
    payload: PAYLOAD_DO_LEMBRETE,
    whatsapp_account_id: numero,
    created_at: atras(2 * MINUTO),
  });
  if (opcoes.mensagemQueFalhou) {
    banco.linhas("message").push({
      id: randomUUID(),
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: "saida",
      author: "sistema",
      is_internal_note: false,
      job_id: id,
      delivery_status: "falhou",
      whatsapp_account_id: numero,
      created_at: atras(MINUTO),
    });
  }
}

/** O executor manda o lembrete que esta na fila (a linha do envio). */
function executorMandaOLembrete(): void {
  banco.linhas("message").push({
    id: randomUUID(),
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: "saida",
    author: "sistema",
    is_internal_note: false,
    job_id: idDoJobDoLembrete(OFERTA, CONTATO),
    wa_message_id: "wa-lembrete",
    delivery_status: "enviada",
    whatsapp_account_id: NUMERO,
    created_at: new Date().toISOString(),
  });
}

function entrada(
  body: string,
  extra: Partial<EntradaDaResposta> = {},
): EntradaDaResposta {
  return {
    clinicId: CLINICA,
    contactId: CONTATO,
    conversationId: CONVERSA,
    body,
    contentType: "texto",
    quotedWaMessageId: null,
    whatsappAccountId: NUMERO,
    conversaComAIa: true,
    ...extra,
  };
}

/** Os jobs de eco ao contato (enviar_mensagem_ativa) criados no teste. */
function ecos(): Linha[] {
  return banco
    .linhas("job_queue")
    .filter(
      (j) => j.id !== JOB_DA_OFERTA && j.kind === "enviar_mensagem_ativa",
    );
}

/** Os jobs de lembrete (com a chave do payload). */
function lembretes(): Linha[] {
  return ecos().filter(
    (j) => (j.payload as Linha | undefined)?.[CHAVE_DO_LEMBRETE] !== undefined,
  );
}

function awaitingReply(): unknown {
  return banco.linhas("conversation").find((c) => c.id === CONVERSA)
    ?.awaiting_reply;
}

/**
 * A ingestao da mensagem seguinte poe a conversa de volta no contador (e
 * carimba last_inbound_at, como ingest_inbound_message).
 */
function voltarAoContador(): void {
  for (const c of banco.linhas("conversation")) {
    if (c.id === CONVERSA) {
      c.awaiting_reply = true;
      c.last_inbound_at = new Date().toISOString();
    }
  }
}

const TRES_MINUTOS = 3 * MINUTO;

/**
 * A varredura de 3 minutos da IA (motor_manutencao, o bloco [resposta da
 * ia]), so o predicado de sem_resposta: a conversa com a IA, no contador e
 * sem mensagem nova ha mais de 3 minutos passa para a equipe. `daquiA` e o
 * tempo que passa ate a varredura rodar. (A varredura de verdade, contra o
 * banco, esta em tests/integration/lembrete-da-oferta.test.ts.)
 */
function varreduraPassaParaAEquipe(daquiA: number): boolean {
  const conversa = banco.linhas("conversation").find((c) => c.id === CONVERSA);
  return (
    conversa?.status === "ia_atendendo" &&
    conversa.awaiting_reply === true &&
    Date.parse(String(conversa.last_inbound_at)) <
      Date.now() + daquiA - TRES_MINUTOS
  );
}

/**
 * encerrar_envios_da_oferta e o trecho da expiracao, como o banco faz
 * (migration 20261029100000, item 11): os envios PENDENTES da oferta, a
 * mensagem dela e o lembrete, morrem cancelados. O que executa nao e tocado.
 */
function encerrarEnviosDaOferta(): void {
  for (const job of banco.linhas("job_queue")) {
    const payload = (job.payload ?? {}) as Linha;
    if (
      job.kind === "enviar_mensagem_ativa" &&
      job.status === "pendente" &&
      (payload.offer_id === OFERTA || payload[CHAVE_DO_LEMBRETE] === OFERTA)
    ) {
      job.status = "cancelado";
      job.last_error = "oferta_encerrada";
    }
  }
}

/** A oferta fecha (o banco carimba updated_at) e os envios dela morrem. */
function fecharAOferta(mudancas: Linha): void {
  for (const o of banco.linhas("waitlist_offer")) {
    if (o.id === OFERTA) {
      Object.assign(o, { updated_at: new Date().toISOString() }, mudancas);
    }
  }
  encerrarEnviosDaOferta();
}

/** O aceite que da certo e, como aceitar_oferta_de_espera, encerra os envios. */
function aceiteQueEncerra(): void {
  banco.rpc("aceitar_oferta_de_espera", () => {
    fecharAOferta({ status: "preenchida", responded_by: CONTATO });
    return {
      data: {
        ok: true,
        starts_at: HORARIO,
        profissional: "Dra. Ana Lima",
        timezone: FUSO,
      },
      error: null,
    };
  });
}

/**
 * O executor desiste do lembrete sem envia-lo (falhar_job definitivo): a
 * guarda da oferta, a autorizacao revogada, o numero removido ou a falha do
 * envio (com a linha que falhou).
 */
function executorDesisteDoLembrete(
  erro: string,
  opcoes: { mensagemQueFalhou?: boolean } = {},
): void {
  const id = idDoJobDoLembrete(OFERTA, CONTATO);
  for (const job of banco.linhas("job_queue")) {
    if (job.id === id) {
      job.status = "falhou";
      job.last_error = erro;
    }
  }
  if (opcoes.mensagemQueFalhou) {
    banco.linhas("message").push({
      id: randomUUID(),
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: "saida",
      author: "sistema",
      is_internal_note: false,
      job_id: id,
      delivery_status: "falhou",
      whatsapp_account_id: NUMERO,
      created_at: new Date().toISOString(),
    });
  }
}

/** O job do lembrete desta oferta para o contato, como esta no banco. */
function jobDoLembrete(): Linha | undefined {
  return banco
    .linhas("job_queue")
    .find((j) => j.id === idDoJobDoLembrete(OFERTA, CONTATO));
}

function mudarStatusDaConversa(status: string): void {
  for (const c of banco.linhas("conversation")) {
    if (c.id === CONVERSA) {
      c.status = status;
    }
  }
}

function nomesDasChamadas(): string[] {
  return banco.chamadas.map((c) => c.nome);
}

/** O aceite que da certo (aceitar_oferta_de_espera). */
function aceiteQueDaCerto(): void {
  banco.rpc("aceitar_oferta_de_espera", () => ({
    data: {
      ok: true,
      starts_at: HORARIO,
      profissional: "Dra. Ana Lima",
      timezone: FUSO,
    },
    error: null,
  }));
}

const interceptar = (e: EntradaDaResposta) =>
  interceptarRespostaDePaciente(banco.cliente(), e);

// ---------------------------------------------------------------------------

describe("o texto do lembrete (T-E4)", () => {
  it("preenchido no fuso da clínica: a data e a hora do horário e a hora do prazo", () => {
    expect(
      textoDoLembreteDaOferta({
        inicioDoHorario: HORARIO,
        venceEm: "2026-10-27T13:30:00.000Z",
        fuso: FUSO,
      }),
    ).toBe(
      "Sobre o horário de 03/11/2026 às 09:00: para ficar com ele, responda SIM até as 10:30. Se não quiser, responda NÃO QUERO, que você continua na lista de espera. Se for outro assunto, é só escrever de novo.",
    );
    // Outro fuso, outro relogio (CLAUDE.md 3.6).
    expect(
      textoDoLembreteDaOferta({
        inicioDoHorario: HORARIO,
        venceEm: "2026-10-27T13:30:00.000Z",
        fuso: "America/Manaus",
      }),
    ).toContain("03/11/2026 às 08:00");
  });

  it("pede exatamente o vocabulário que o interceptador entende, sem vaga, promessa nem travessão", () => {
    expect(LEMBRETE_DA_OFERTA).toContain("responda SIM");
    expect(LEMBRETE_DA_OFERTA).toContain("responda NÃO QUERO");
    expect(LEMBRETE_DA_OFERTA).not.toMatch(/[—–]/);
    expect(LEMBRETE_DA_OFERTA).not.toMatch(/\bvagas?\b|garant|é seu|é sua/i);
    expect(CHAVE_DO_LEMBRETE).toBe("lembrete_da_oferta");
  });

  it("diz que outro assunto é só escrever de novo (a mensagem que recebeu o lembrete nunca é respondida pela IA; achado 4)", () => {
    expect(
      LEMBRETE_DA_OFERTA.endsWith(" Se for outro assunto, é só escrever de novo."),
    ).toBe(true);
  });

  it("a oferta de pé: aberta, no prazo e sem a recusa da pessoa", () => {
    const agora = Date.parse("2026-10-27T12:00:00.000Z");
    const aberta = {
      status: "aberta",
      expires_at: "2026-10-27T12:30:00.000Z",
      declined_by: [OUTRO_CONTATO],
    };
    expect(ofertaDePeParaOContato(aberta, CONTATO, agora)).toBe(true);
    expect(ofertaDePeParaOContato(aberta, OUTRO_CONTATO, agora)).toBe(false);
    expect(
      ofertaDePeParaOContato({ ...aberta, status: "aceita" }, CONTATO, agora),
    ).toBe(false);
    expect(
      ofertaDePeParaOContato(
        { ...aberta, expires_at: "2026-10-27T12:00:00.000Z" },
        CONTATO,
        agora,
      ),
    ).toBe(false);
    expect(
      ofertaDePeParaOContato({ ...aberta, declined_by: null }, CONTATO, agora),
    ).toBe(true);
  });

  it("a situação do lembrete: pelo job e pelas mensagens dele", () => {
    expect(situacaoDoLembrete(null, [])).toBe("nenhum");
    expect(situacaoDoLembrete({ status: "pendente" }, [])).toBe("na_fila");
    // A que falhou e espera nova tentativa ainda nao saiu.
    expect(
      situacaoDoLembrete({ status: "executando" }, [
        { delivery_status: "falhou" },
      ]),
    ).toBe("na_fila");
    // 'enviando' ja pode ter chegado: conta como saida (como a da oferta).
    expect(
      situacaoDoLembrete({ status: "executando" }, [
        { delivery_status: "enviando" },
      ]),
    ).toBe("saiu");
    expect(
      situacaoDoLembrete({ status: "concluido" }, [
        { delivery_status: "lida" },
      ]),
    ).toBe("saiu");
    for (const status of ["falhou", "cancelado", "concluido", null]) {
      expect(situacaoDoLembrete({ status }, []), String(status)).toBe("morto");
      expect(
        situacaoDoLembrete({ status }, [{ delivery_status: "falhou" }]),
      ).toBe("morto");
    }
    // O cancelado pelo banco (a oferta fechou) continua morto.
    expect(
      situacaoDoLembrete(
        { status: "cancelado", last_error: "oferta_encerrada" },
        [],
      ),
    ).toBe("morto");
  });

  it("o lembrete dispensado (gravado já cancelado depois da recusa educada do aceite): nem na fila nem morto", () => {
    expect(MOTIVO_DO_LEMBRETE_DISPENSADO).toBe("lembrete_dispensado");
    expect(
      situacaoDoLembrete(
        { status: "cancelado", last_error: MOTIVO_DO_LEMBRETE_DISPENSADO },
        [],
      ),
    ).toBe("dispensado");
    // O job vivo e a mensagem que saiu vencem a marca (nunca acontece: o
    // dispensado nasce cancelado e nunca executa).
    expect(
      situacaoDoLembrete(
        { status: "pendente", last_error: MOTIVO_DO_LEMBRETE_DISPENSADO },
        [],
      ),
    ).toBe("na_fila");
    expect(
      situacaoDoLembrete(
        { status: "cancelado", last_error: MOTIVO_DO_LEMBRETE_DISPENSADO },
        [{ delivery_status: "enviada" }],
      ),
    ).toBe("saiu");
  });

  it("o lembrete que deixa mensagem sem resposta: o que existe e não saiu (na fila ou morto)", () => {
    const casos: [SituacaoDoLembrete, boolean][] = [
      ["nenhum", false],
      ["na_fila", true],
      ["saiu", false],
      ["morto", true],
      ["dispensado", false],
    ];
    for (const [situacao, deixa] of casos) {
      expect(lembreteDeixaSemResposta(situacao), situacao).toBe(deixa);
    }
  });

  it("o id do job do lembrete: o mesmo para a mesma oferta e contato, um UUID", () => {
    const id = idDoJobDoLembrete(OFERTA, CONTATO);
    expect(id).toBe(idDoJobDoLembrete(OFERTA, CONTATO));
    expect(id).not.toBe(idDoJobDoLembrete(OFERTA, OUTRO_CONTATO));
    expect(id).not.toBe(idDoJobDoLembrete(JOB_DA_OFERTA, CONTATO));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("o lembrete na conversa com a IA", () => {
  beforeEach(() => montar());

  it("a oferta é a pergunta e a mensagem não é SIM nem NÃO QUERO: o lembrete vai uma vez pela fila", async () => {
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "tratou_com_eco",
    );
    const [lembrete, ...outros] = ecos();
    expect(outros).toEqual([]);
    expect(lembrete).toMatchObject({
      id: idDoJobDoLembrete(OFERTA, CONTATO),
      clinic_id: CLINICA,
      kind: "enviar_mensagem_ativa",
      // O numero que recebeu (D4).
      whatsapp_account_id: NUMERO,
      payload: {
        contact_id: CONTATO,
        resposta_ao_paciente: true,
        [CHAVE_DO_LEMBRETE]: OFERTA,
        body: textoDoLembreteDaOferta({
          inicioDoHorario: HORARIO,
          venceEm,
          fuso: FUSO,
        }),
      },
    });
    // Nao e a mensagem da oferta: sem offer_id.
    expect(lembrete?.payload).not.toHaveProperty("offer_id");
    // A conversa FICA no contador do Atendimento ate o lembrete sair (quem a
    // tira e o executor; revisao da AG5, o lembrete que morre sem sair).
    expect(awaitingReply()).toBe(true);
    // Conferiu a autorizacao (achado 3); nem aceita nem recusa.
    expect(banco.chamadasDe("consentimento_vigente")).toEqual([
      { p_clinic_id: CLINICA, p_contact_id: CONTATO, p_channel: "whatsapp" },
    ]);
    expect(nomesDasChamadas()).toEqual(["consentimento_vigente"]);
  });

  it("uma vez por oferta e contato: depois que o lembrete saiu, a mensagem seguinte vai para a IA, com três leituras leves e nenhuma escrita", async () => {
    await interceptar(entrada("Que horas mesmo?"));
    executorMandaOLembrete();
    voltarAoContador();
    banco.operacoes.length = 0;
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "sem_intencao",
    );
    expect(ecos()).toHaveLength(1);
    expect(banco.escritas()).toEqual([]);
    expect(awaitingReply()).toBe(true);
    // A oferta, o lembrete pela chave e as mensagens dele: nenhum fato a mais.
    expect(banco.operacoes.map((o) => o.tabela)).toEqual([
      "waitlist_offer",
      "job_queue",
      "message",
    ]);
  });

  it("fora da conversa com a IA nada muda: sem_intencao sem tocar no banco", async () => {
    for (const fora of [
      { conversaComAIa: false },
      { conversaComAIa: undefined },
    ]) {
      expect(await interceptar(entrada("Que horas mesmo?", fora))).toBe(
        "sem_intencao",
      );
    }
    expect(banco.operacoes).toEqual([]);
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(true);
  });

  it("na conversa com a IA sem oferta: uma leitura só, nenhuma escrita, e a mensagem fica com a IA", async () => {
    banco.tabelas.set("waitlist_offer", []);
    expect(await interceptar(entrada("Bom dia"))).toBe("sem_intencao");
    expect(banco.operacoes).toEqual([
      { tabela: "waitlist_offer", operacao: "select" },
    ]);
  });

  it("a conversa saiu da IA no meio do caminho: sem lembrete", async () => {
    montar({ status: "em_atendimento" });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("alvo_nenhum");
    expect(ecos()).toEqual([]);
  });

  it.each([
    ["a equipe falou depois da oferta", () => falaDaClinica("usuario", MINUTO)],
    ["a IA falou depois da oferta", () => falaDaClinica("ia", MINUTO)],
    [
      "um toque de confirmação saiu depois da oferta",
      () => toqueDeConfirmacao(MINUTO),
    ],
  ])(
    "outra pergunta mais recente (%s): sem lembrete",
    async (_nome, depois) => {
      depois();
      expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
        "alvo_nenhum",
      );
      expect(ecos()).toEqual([]);
      expect(awaitingReply()).toBe(true);
    },
  );

  it("citando a oferta, mesmo com um toque mais recente: o lembrete", async () => {
    toqueDeConfirmacao(MINUTO);
    expect(
      await interceptar(
        entrada("Esse horário é de manhã?", { quotedWaMessageId: "wa-oferta" }),
      ),
    ).toBe("tratou_com_eco");
    expect(ecos()).toHaveLength(1);
  });

  it("citando outra mensagem: sem lembrete", async () => {
    toqueDeConfirmacao(30 * MINUTO);
    expect(
      await interceptar(
        entrada("E isso aqui?", { quotedWaMessageId: "wa-toque" }),
      ),
    ).toBe("alvo_nenhum");
    expect(ecos()).toEqual([]);
  });

  it.each([
    ["recusada por ela", { declined_by: [CONTATO] }],
    ["vencida", { expires_at: atras(MINUTO) }],
    ["encerrada", { status: "aceita", responded_by: OUTRO_CONTATO }],
  ])("a oferta %s: sem lembrete", async (_nome, oferta) => {
    montar({ oferta });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("sem_intencao");
    expect(ecos()).toEqual([]);
  });

  it("a mensagem da oferta ainda na fila (não saiu): sem lembrete", async () => {
    montar({ ofertaSaiuPor: null });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("alvo_nenhum");
    expect(ecos()).toEqual([]);
  });

  it("a oferta saiu por outro número da clínica: sem lembrete neste", async () => {
    montar({ ofertaSaiuPor: OUTRO_NUMERO });
    banco.linhas("conversation").push({
      id: CONVERSA_DO_OUTRO_NUMERO,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      status: "aguardando_humano",
      whatsapp_account_id: OUTRO_NUMERO,
      created_at: atras(3 * HORA),
    });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("alvo_nenhum");
    expect(ecos()).toEqual([]);
  });

  it("o vocabulário do menu (Remarcar) com a oferta como a pergunta: o lembrete", async () => {
    expect(await interceptar(entrada("Remarcar"))).toBe("tratou_com_eco");
    expect(ecos()).toHaveLength(1);
    expect(nomesDasChamadas()).toEqual(["consentimento_vigente"]);
  });

  it("Confirmar sem citar, com o toque ANTES da oferta: não confirma o toque velho, recebe o lembrete", async () => {
    // O toque saiu ha 30 minutos; a oferta, ha 9: a pergunta de pe e a
    // oferta (hoje o "Confirmar" ja nao confirmava; agora recebe o lembrete).
    toqueDeConfirmacao(30 * MINUTO);
    expect(await interceptar(entrada("Confirmar"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
    expect(ecos().map((j) => (j.payload as Linha)[CHAVE_DO_LEMBRETE])).toEqual([
      OFERTA,
    ]);
  });

  it("duas mensagens ao mesmo tempo: a chave do job barra o segundo lembrete, e o da outra mensagem, na fila, cobre esta", async () => {
    // A outra mensagem gravou o lembrete entre a conferencia e o insert.
    banco.aoInserir = (tabela, linha) => {
      if (
        tabela === "job_queue" &&
        linha.id === idDoJobDoLembrete(OFERTA, CONTATO)
      ) {
        banco.linhas("job_queue").push({ ...linha, status: "pendente" });
        return { code: "23505" };
      }
      return null;
    };
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "tratou_com_eco",
    );
    expect(lembretes()).toHaveLength(1);
    // No contador ate o lembrete sair.
    expect(awaitingReply()).toBe(true);
  });

  it("a corrida em que a releitura não acha o lembrete (ou falha): nada coberto, a mensagem fica com a IA", async () => {
    banco.aoInserir = (tabela) =>
      tabela === "job_queue" ? { code: "23505" } : null;
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("alvo_nenhum");
    expect(awaitingReply()).toBe(true);

    montar();
    banco.aoInserir = (tabela) => {
      if (tabela !== "job_queue") {
        return null;
      }
      banco.erros.set("job_queue:select", { code: "57014" });
      return { code: "23505" };
    };
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(awaitingReply()).toBe(true);
  });

  it("falha na fila, no fuso ou na autorização: nenhum lembrete pela metade, a mensagem fica com a IA", async () => {
    banco.erros.set("job_queue:insert", { code: "57014" });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(awaitingReply()).toBe(true);

    montar();
    banco.erros.set("clinic:select", { code: "57014" });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(ecos()).toEqual([]);

    montar();
    banco.erros.set("waitlist_offer:select", { code: "57014" });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(ecos()).toEqual([]);

    montar();
    banco.rpc("consentimento_vigente", () => ({
      data: null,
      error: { code: "57014" },
    }));
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(true);

    montar();
    banco.erros.set("message:select", { code: "57014" });
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe(
      "fatos_ilegiveis",
    );
    expect(ecos()).toEqual([]);
  });
});

describe("o lembrete na fila cobre a mensagem seguinte (revisão da AG5, achado 1)", () => {
  beforeEach(() => montar());

  it("a primeira pede o lembrete; a segunda, com ele ainda na fila, fica coberta: sem segundo lembrete, sem turno, e no contador até ele sair", async () => {
    expect(await interceptar(entrada("Oi, que horário é esse?"))).toBe(
      "tratou_com_eco",
    );
    voltarAoContador();
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "tratou_com_eco",
    );
    expect(lembretes()).toHaveLength(1);
    expect(ecos()).toHaveLength(1);
    expect(awaitingReply()).toBe(true);
    // Nem aceita nem recusa: so a autorizacao, uma vez por mensagem.
    expect(nomesDasChamadas()).toEqual([
      "consentimento_vigente",
      "consentimento_vigente",
    ]);
  });

  it("depois que o lembrete sai, o SIM é aceito (a mensagem coberta não deu turno à IA)", async () => {
    aceiteQueDaCerto();
    await interceptar(entrada("Oi, que horário é esse?"));
    await interceptar(entrada("E onde fica a clínica?"));
    executorMandaOLembrete();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
  });

  it("a mensagem do lembrete que falhou e espera nova tentativa: ainda na fila, cobre (e a conversa fica no contador)", async () => {
    lembreteNaFila({ mensagemQueFalhou: true });
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "tratou_com_eco",
    );
    expect(lembretes()).toHaveLength(1);
    expect(awaitingReply()).toBe(true);
  });

  it("o job em execução, sem mensagem ainda: cobre", async () => {
    lembreteNaFila({ status: "executando" });
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "tratou_com_eco",
    );
  });

  it("o vocabulário do menu com a oferta como a pergunta também fica coberto", async () => {
    lembreteNaFila();
    expect(await interceptar(entrada("Confirmar"))).toBe("tratou_com_eco");
    expect(lembretes()).toHaveLength(1);
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
  });

  it("a IA falou depois da oferta: a mensagem é resposta a ela, não fica coberta", async () => {
    lembreteNaFila();
    falaDaClinica("ia", MINUTO);
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "alvo_nenhum",
    );
    expect(awaitingReply()).toBe(true);
  });

  it("o lembrete na fila de outro número não chega a esta conversa: a mensagem fica com a IA", async () => {
    lembreteNaFila({ numero: OUTRO_NUMERO });
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "alvo_nenhum",
    );
    expect(awaitingReply()).toBe(true);
  });

  it("a conversa saiu da IA: nada coberto", async () => {
    lembreteNaFila();
    mudarStatusDaConversa("em_atendimento");
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "alvo_nenhum",
    );
    expect(awaitingReply()).toBe(true);
  });

  it.each(["falhou", "cancelado", "concluido"])(
    "o lembrete morto (%s, nada saiu): a mensagem vai para a IA, sem segundo lembrete",
    async (status) => {
      lembreteNaFila({ status, mensagemQueFalhou: true });
      expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
        "sem_intencao",
      );
      expect(lembretes()).toHaveLength(1);
      expect(awaitingReply()).toBe(true);
    },
  );
});

describe("o lembrete que saiu é a pergunta da oferta feita de novo (revisão da AG5, achado 1)", () => {
  beforeEach(() => {
    montar();
    aceiteQueDaCerto();
  });

  it("a IA falou entre a oferta e o lembrete: o SIM que o lembrete pediu é aceito", async () => {
    // A oferta saiu ha 9 minutos; a IA respondeu outra mensagem ha 6 (um
    // turno que ja estava em andamento); o lembrete saiu ha 3.
    falaDaClinica("ia", 6 * MINUTO);
    lembreteJaEnviado(3 * MINUTO);
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
  });

  it("um toque saiu entre a oferta e o lembrete: o SIM aceita a oferta e nunca confirma a consulta", async () => {
    toqueDeConfirmacao(6 * MINUTO);
    lembreteJaEnviado(3 * MINUTO);
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
  });

  it.each([
    ["falhou", { entrega: "falhou" }],
    ["saiu por outro número", { numero: OUTRO_NUMERO }],
  ])(
    "o lembrete que %s não conta: a fala da IA continua a pergunta mais recente",
    async (_nome, opcoes) => {
      falaDaClinica("ia", 6 * MINUTO);
      lembreteJaEnviado(3 * MINUTO, opcoes);
      expect(await interceptar(entrada("SIM"))).toBe("alvo_nenhum");
      expect(banco.chamadasDe("aceitar_oferta_de_espera")).toEqual([]);
    },
  );

  it("o caso que continua com a IA (achado 1c): o lembrete saiu, a IA respondeu outra pergunta depois dele, e o SIM sem citar fica com a IA; citando o lembrete, aceita", async () => {
    lembreteJaEnviado(3 * MINUTO);
    // "E onde fica a clinica?" foi para a IA (o lembrete ja tinha saido), e
    // a IA respondeu.
    falaDaClinica("ia", MINUTO);
    expect(await interceptar(entrada("SIM"))).toBe("alvo_nenhum");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toEqual([]);
    expect(awaitingReply()).toBe(true);
    // Citar o lembrete (ou a oferta) continua aceitando.
    expect(
      await interceptar(entrada("SIM", { quotedWaMessageId: "wa-lembrete" })),
    ).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
  });
});

describe("sem a autorização para receber mensagens, nenhum lembrete (revisão da AG5, achado 3)", () => {
  beforeEach(() => {
    montar();
    banco.rpc("consentimento_vigente", () => ({ data: false, error: null }));
  });

  it("revogada: a mensagem fica com a IA (que passa para a equipe), sem lembrete e no contador", async () => {
    expect(await interceptar(entrada("Que horas mesmo?"))).toBe("alvo_nenhum");
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(true);
  });

  it("revogada com o lembrete na fila: nada coberto (o executor o descartaria)", async () => {
    lembreteNaFila();
    expect(await interceptar(entrada("E onde fica a clínica?"))).toBe(
      "alvo_nenhum",
    );
    expect(awaitingReply()).toBe(true);
  });

  it("revogada não muda o SIM e o NÃO QUERO (a recusa e o aceite são do banco)", async () => {
    aceiteQueDaCerto();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(banco.chamadasDe("consentimento_vigente")).toEqual([]);
  });
});

describe("depois do lembrete, o SIM continua do interceptador", () => {
  beforeEach(() => {
    montar();
    lembreteJaEnviado(MINUTO);
    aceiteQueDaCerto();
    banco.rpc("recusar_oferta_de_espera", () => ({
      data: { ok: true },
      error: null,
    }));
  });

  it("SIM sem citar: o lembrete é do sistema e não fecha a oferta", async () => {
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_offer_id: OFERTA,
        p_contact_id: CONTATO,
        p_conversation_id: CONVERSA,
      },
    ]);
    const eco = ecos().at(-1);
    expect(String((eco?.payload as Linha).body)).toContain(
      "O horário é seu! Ficou marcado para 03/11/2026 às 09:00 com Dra. Ana Lima.",
    );
  });

  it("SIM citando o lembrete vale como resposta à oferta dele", async () => {
    expect(
      await interceptar(entrada("Sim", { quotedWaMessageId: "wa-lembrete" })),
    ).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
  });

  it("NÃO QUERO: a recusa de sempre", async () => {
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("recusar_oferta_de_espera")).toHaveLength(1);
    expect((ecos().at(-1)?.payload as Linha).body).toBe(
      RESPOSTA_OFERTA_RECUSADA,
    );
  });
});

describe("a resposta à oferta sem nada a fazer sai do contador na conversa com a IA (revisão da AG5, achado 5)", () => {
  const VENCEU = { status: "preenchida", responded_by: CONTATO };

  it.each([
    ["o vencedor agradece com ok", VENCEU, "ok"],
    ["o vencedor repete SIM", VENCEU, "SIM"],
    ["o vencedor manda joinha", VENCEU, "\u{1F44D}"],
    ["o vencedor diz vou", VENCEU, "vou"],
    [
      "NÃO QUERO depois de outro ganhar",
      { status: "preenchida", responded_by: OUTRO_CONTATO },
      "Não quero",
    ],
    ["NÃO QUERO depois do prazo", { expires_at: atras(MINUTO) }, "Não quero"],
    ["NÃO QUERO de novo, já recusada", { declined_by: [CONTATO] }, "Não quero"],
  ])(
    "%s: tratado, sem eco, e fora do contador só na conversa com a IA",
    async (_nome, oferta, body) => {
      montar({ oferta });
      expect(await interceptar(entrada(body))).toBe("tratou_com_eco");
      expect(ecos()).toEqual([]);
      expect(awaitingReply()).toBe(false);

      // Fora da conversa com a IA: a recepcao ve a mensagem, como antes.
      montar({ oferta, status: "aguardando_humano" });
      expect(
        await interceptar(entrada(body, { conversaComAIa: false })),
      ).toBe("tratou_com_eco");
      expect(awaitingReply()).toBe(true);

      // Alguem assumiu entre a ingestao e agora: a recepcao ve a mensagem.
      montar({ oferta, status: "em_atendimento" });
      expect(await interceptar(entrada(body))).toBe("tratou_com_eco");
      expect(awaitingReply()).toBe(true);
    },
  );

  it("o sim duplo (o outro SIM do mesmo contato ganhou no meio): tratado, sem eco, fora do contador", async () => {
    montar();
    banco.rpc("aceitar_oferta_de_espera", () => {
      for (const o of banco.linhas("waitlist_offer")) {
        o.status = "preenchida";
        o.responded_by = CONTATO;
      }
      return { data: { ok: false, erro: "ja_tratado" }, error: null };
    });
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(false);
  });

  it("o segundo a responder recebe a recusa educada e sai do contador, como antes", async () => {
    montar({ oferta: { status: "preenchida", responded_by: OUTRO_CONTATO } });
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect((ecos()[0]?.payload as Linha).body).toBe(RESPOSTA_OFERTA_PERDIDA);
    expect(awaitingReply()).toBe(false);
  });

  it("o VENCEDOR dizendo NÃO QUERO desiste da consulta que tem: fica com quem atende (a IA ou a equipe), no contador", async () => {
    for (const conversaComAIa of [true, false]) {
      montar({ oferta: VENCEU });
      expect(
        await interceptar(entrada("Não quero", { conversaComAIa })),
      ).toBe("reconheceu_sem_efeito");
      expect(ecos()).toEqual([]);
      expect(awaitingReply()).toBe(true);
      expect(nomesDasChamadas()).toEqual([]);
    }
  });

  it("a corrida do NÃO QUERO logo depois do próprio SIM (a recusa volta ja_tratado e ele ganhou): fica com quem atende, no contador", async () => {
    montar();
    banco.rpc("recusar_oferta_de_espera", () => {
      for (const o of banco.linhas("waitlist_offer")) {
        o.status = "preenchida";
        o.responded_by = CONTATO;
      }
      return { data: { ok: false, erro: "ja_tratado" }, error: null };
    });
    expect(await interceptar(entrada("Não quero"))).toBe(
      "reconheceu_sem_efeito",
    );
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(true);
  });

  it("a recusa que volta ja_tratado porque OUTRO ganhou: sem eco e fora do contador, como antes", async () => {
    montar();
    banco.rpc("recusar_oferta_de_espera", () => {
      for (const o of banco.linhas("waitlist_offer")) {
        o.status = "preenchida";
        o.responded_by = OUTRO_CONTATO;
      }
      return { data: { ok: false, erro: "ja_tratado" }, error: null };
    });
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect(ecos()).toEqual([]);
    expect(awaitingReply()).toBe(false);
  });
});

describe("os botões de hoje não mudam (Confirmar, Cancelar, Remarcar)", () => {
  it.each([
    ["Confirmar", "confirmar_pelo_paciente"],
    ["Cancelar", "cancelar_pelo_paciente"],
    ["Remarcar", "pedir_remarcacao_pelo_paciente"],
  ])(
    "%s no toque, com e sem a IA: a RPC de sempre e o eco, sem lembrete",
    async (botao, rpc) => {
      for (const conversaComAIa of [true, false]) {
        montar();
        banco.tabelas.set("waitlist_offer", []);
        toqueDeConfirmacao(5 * MINUTO);
        expect(
          await interceptar(
            entrada(botao, { conversaComAIa, quotedWaMessageId: "wa-toque" }),
          ),
          `${botao} com a IA: ${conversaComAIa}`,
        ).toBe("tratou_com_eco");
        expect(banco.chamadasDe(rpc)).toEqual([
          {
            p_clinic_id: CLINICA,
            p_appointment_id: CONSULTA,
            p_contact_id: CONTATO,
            p_conversation_id: CONVERSA,
          },
        ]);
        expect(ecos()).toHaveLength(1);
        expect(lembretes()).toEqual([]);
      }
    },
  );

  it("Confirmar com uma oferta de pé, mas o toque como a pergunta mais recente: confirma, sem lembrete", async () => {
    montar();
    toqueDeConfirmacao(MINUTO);
    expect(await interceptar(entrada("Confirmar"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toHaveLength(1);
    expect(ecos()).toHaveLength(1);
    // O eco da confirmacao, nunca o lembrete.
    expect(String((ecos()[0]?.payload as Linha).body)).toMatch(
      new RegExp(
        `^${RESPOSTA_CONFIRMADA.split("{{data}}")[0] ?? ""}\\d{2}/\\d{2} às \\d{2}:\\d{2}, obrigado!`,
      ),
    );
    expect(lembretes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// O lembrete que morre sem sair (revisao da AG5): a conversa fica no contador
// ---------------------------------------------------------------------------

const SEGUNDO = 1_000;

describe("o lembrete que morre sem sair deixa a conversa no contador, e a varredura a passa para a equipe (revisão da AG5)", () => {
  beforeEach(() => montar());

  it("(a) 'Qual o endereço?' pede o lembrete; o SIM chega antes de ele sair: aceita, o aceite cancela o lembrete, e a pergunta fica no contador para a varredura", async () => {
    aceiteQueEncerra();
    expect(await interceptar(entrada("Qual o endereço?"))).toBe(
      "tratou_com_eco",
    );
    expect(jobDoLembrete()).toMatchObject({ status: "pendente" });
    expect(awaitingReply()).toBe(true);

    voltarAoContador();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(String((ecos().at(-1)?.payload as Linha).body)).toContain(
      "O horário é seu! Ficou marcado para 03/11/2026 às 09:00",
    );
    // O aceite cancelou o lembrete (encerrar_envios_da_oferta): a pergunta do
    // endereco nunca vai ser respondida por ele.
    expect(jobDoLembrete()).toMatchObject({
      status: "cancelado",
      last_error: "oferta_encerrada",
    });
    // Fica no contador; a varredura de 3 minutos passa a conversa para a
    // equipe, que ve a pergunta.
    expect(awaitingReply()).toBe(true);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS - SEGUNDO)).toBe(false);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
  });

  it("(a) depois do aceite, o vencedor agradece ('ok') ou repete o SIM: o lembrete morreu sem sair, e a conversa continua no contador", async () => {
    aceiteQueEncerra();
    await interceptar(entrada("Qual o endereço?"));
    voltarAoContador();
    await interceptar(entrada("SIM"));
    for (const body of ["ok", "SIM"]) {
      voltarAoContador();
      expect(await interceptar(entrada(body)), body).toBe("tratou_com_eco");
      expect(awaitingReply(), body).toBe(true);
    }
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
  });

  it("(a) o SIM duplo (o outro SIM do mesmo contato ganhou no meio) com o lembrete na fila: continua no contador", async () => {
    await interceptar(entrada("Qual o endereço?"));
    banco.rpc("aceitar_oferta_de_espera", () => {
      fecharAOferta({ status: "preenchida", responded_by: CONTATO });
      return { data: { ok: false, erro: "ja_tratado" }, error: null };
    });
    voltarAoContador();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(awaitingReply()).toBe(true);
  });

  it.each([
    [
      "outro candidato ganha",
      () => fecharAOferta({ status: "preenchida", responded_by: OUTRO_CONTATO }),
      "cancelado",
    ],
    [
      "a oferta vence",
      () => fecharAOferta({ status: "expirada", expires_at: atras(SEGUNDO) }),
      "cancelado",
    ],
    [
      "a reoferta é cancelada",
      () => fecharAOferta({ status: "cancelada" }),
      "cancelado",
    ],
    [
      "a guarda do executor (a oferta fechou com ele executando)",
      () => executorDesisteDoLembrete("oferta_encerrada"),
      "falhou",
    ],
    [
      "a autorização revogada antes do envio",
      () => executorDesisteDoLembrete("sem_consentimento"),
      "falhou",
    ],
    [
      "o número removido",
      () => executorDesisteDoLembrete("numero_removido"),
      "falhou",
    ],
    [
      "a falha definitiva do envio",
      () =>
        executorDesisteDoLembrete("envio_incerto", { mensagemQueFalhou: true }),
      "falhou",
    ],
  ])(
    "(b) 'Qual o endereço?' e 'Aceita Unimed?' (coberta); %s antes de o lembrete sair: as duas ficam no contador, e a varredura passa a conversa para a equipe",
    async (_nome, morte, status) => {
      expect(await interceptar(entrada("Qual o endereço?"))).toBe(
        "tratou_com_eco",
      );
      voltarAoContador();
      expect(await interceptar(entrada("Aceita Unimed?"))).toBe(
        "tratou_com_eco",
      );
      expect(lembretes()).toHaveLength(1);
      expect(awaitingReply()).toBe(true);

      morte();
      expect(jobDoLembrete()).toMatchObject({ status });
      // Nada saiu e ninguem respondeu: no contador, e a varredura de 3
      // minutos tira a conversa da IA (sem_resposta) para a equipe.
      expect(ecos()).toHaveLength(1);
      expect(awaitingReply()).toBe(true);
      expect(varreduraPassaParaAEquipe(TRES_MINUTOS - SEGUNDO)).toBe(false);
      expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
    },
  );

  it("(b) a oferta fechou por outro candidato e a pessoa responde NÃO QUERO: nada a fazer, mas as perguntas sem resposta seguram o contador", async () => {
    await interceptar(entrada("Qual o endereço?"));
    fecharAOferta({ status: "preenchida", responded_by: OUTRO_CONTATO });
    voltarAoContador();
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect(nomesDasChamadas()).toEqual(["consentimento_vigente"]);
    expect(awaitingReply()).toBe(true);
  });

  it("(b) a oferta fechou por outro candidato e a pessoa responde SIM: a recusa educada, e as perguntas sem resposta seguram o contador", async () => {
    await interceptar(entrada("Qual o endereço?"));
    fecharAOferta({ status: "preenchida", responded_by: OUTRO_CONTATO });
    voltarAoContador();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect((ecos().at(-1)?.payload as Linha).body).toBe(
      RESPOSTA_OFERTA_PERDIDA,
    );
    expect(awaitingReply()).toBe(true);
  });

  it("a recusa (NÃO QUERO) com o lembrete na fila: a recusa de sempre, e a pergunta que pediu o lembrete segura o contador", async () => {
    banco.rpc("recusar_oferta_de_espera", () => ({
      data: { ok: true },
      error: null,
    }));
    await interceptar(entrada("Qual o endereço?"));
    voltarAoContador();
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect((ecos().at(-1)?.payload as Linha).body).toBe(
      RESPOSTA_OFERTA_RECUSADA,
    );
    expect(awaitingReply()).toBe(true);
  });

  it("o lembrete que SAIU não segura nada: o SIM aceito tira a conversa do contador, como antes", async () => {
    aceiteQueDaCerto();
    lembreteJaEnviado(MINUTO);
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(awaitingReply()).toBe(false);
  });

  it("sem lembrete nenhum: o SIM aceito e o NÃO QUERO tiram a conversa do contador, como antes", async () => {
    aceiteQueDaCerto();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(awaitingReply()).toBe(false);

    montar();
    banco.rpc("recusar_oferta_de_espera", () => ({
      data: { ok: true },
      error: null,
    }));
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect(awaitingReply()).toBe(false);
  });

  it("a leitura do lembrete falha: o SIM é aceito, e na dúvida a conversa fica no contador", async () => {
    aceiteQueDaCerto();
    let leiturasDoLembrete = 0;
    // So a leitura do job do lembrete (pelo id por nome), antes da RPC.
    banco.aoExecutar = (tabela, operacao, filtros) => {
      if (
        tabela === "job_queue" &&
        operacao === "select" &&
        filtros.some(
          ([coluna, valor]) =>
            coluna === "id" && valor === idDoJobDoLembrete(OFERTA, CONTATO),
        )
      ) {
        leiturasDoLembrete += 1;
        return { code: "57014" };
      }
      return null;
    };
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect(leiturasDoLembrete).toBe(1);
    expect(banco.chamadasDe("aceitar_oferta_de_espera")).toHaveLength(1);
    expect(awaitingReply()).toBe(true);
  });
});

describe("o aceite recusado com a oferta aberta dispensa o lembrete (revisão da AG5, BAIXO)", () => {
  beforeEach(() => montar());

  function aceiteRecusado(resposta: Linha): void {
    banco.rpc("aceitar_oferta_de_espera", () => ({
      data: { ok: false, ...resposta },
      error: null,
    }));
  }

  it.each([
    ["sem_vinculo (o catálogo mudou)", { erro: "sem_vinculo" }],
    [
      "sem_vinculo com ja_tem_consulta",
      { erro: "sem_vinculo", motivo: "ja_tem_consulta" },
    ],
    ["nao_cabe", { erro: "nao_cabe" }],
    [
      "horario_ocupado pelo recurso",
      { erro: "horario_ocupado", motivo: "recurso_ocupado" },
    ],
  ])(
    "%s: a recusa educada, o lembrete gravado já cancelado, e o 'Como assim?' seguinte vai para a IA sem o lembrete",
    async (_nome, resposta) => {
      aceiteRecusado(resposta);
      expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
      expect((ecos()[0]?.payload as Linha).body).toBe(RESPOSTA_OFERTA_PERDIDA);
      expect(jobDoLembrete()).toMatchObject({
        clinic_id: CLINICA,
        kind: "enviar_mensagem_ativa",
        status: "cancelado",
        last_error: MOTIVO_DO_LEMBRETE_DISPENSADO,
        whatsapp_account_id: NUMERO,
        payload: {
          contact_id: CONTATO,
          resposta_ao_paciente: true,
          [CHAVE_DO_LEMBRETE]: OFERTA,
        },
      });
      expect(jobDoLembrete()?.payload).not.toHaveProperty("body");
      // A recusa educada respondeu o SIM: fora do contador, como antes.
      expect(awaitingReply()).toBe(false);

      // A oferta continua aberta para ela, mas o lembrete nunca sai: a
      // mensagem seguinte e da IA (tres leituras, nenhuma escrita).
      voltarAoContador();
      banco.operacoes.length = 0;
      expect(await interceptar(entrada("Como assim?"))).toBe("sem_intencao");
      expect(banco.escritas()).toEqual([]);
      expect(lembretes()).toHaveLength(1);
      expect(awaitingReply()).toBe(true);
    },
  );

  it("a mensagem com o vocabulário do menu depois da recusa (o caminho dos fatos): também sem lembrete", async () => {
    aceiteRecusado({ erro: "sem_vinculo", motivo: "ja_tem_consulta" });
    await interceptar(entrada("SIM"));
    voltarAoContador();
    expect(await interceptar(entrada("Remarcar"))).toBe("alvo_nenhum");
    expect(lembretes()).toHaveLength(1);
    expect(jobDoLembrete()).toMatchObject({ status: "cancelado" });
  });

  it("depois do lembrete dispensado, o NÃO QUERO recusa e sai do contador como antes (o dispensado não segura nada)", async () => {
    aceiteRecusado({ erro: "sem_vinculo" });
    banco.rpc("recusar_oferta_de_espera", () => ({
      data: { ok: true },
      error: null,
    }));
    await interceptar(entrada("SIM"));
    voltarAoContador();
    expect(await interceptar(entrada("Não quero"))).toBe("tratou_com_eco");
    expect(banco.chamadasDe("recusar_oferta_de_espera")).toHaveLength(1);
    expect((ecos().at(-1)?.payload as Linha).body).toBe(
      RESPOSTA_OFERTA_RECUSADA,
    );
    expect(awaitingReply()).toBe(false);
  });

  it("com o lembrete já na fila, o aceite recusado o cancela (não sai depois da recusa educada) e a pergunta que ele cobria fica no contador", async () => {
    aceiteRecusado({ erro: "sem_vinculo", motivo: "ja_tem_consulta" });
    expect(await interceptar(entrada("Qual o endereço?"))).toBe(
      "tratou_com_eco",
    );
    voltarAoContador();
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect((ecos().at(-1)?.payload as Linha).body).toBe(
      RESPOSTA_OFERTA_PERDIDA,
    );
    // Continua morto (cobriu a pergunta), nao dispensado.
    expect(jobDoLembrete()).toMatchObject({
      status: "cancelado",
      last_error: "aceite_recusado",
    });
    expect(lembretes()).toHaveLength(1);
    expect(awaitingReply()).toBe(true);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
  });

  it("o lembrete executando não é tocado (o executor confere a oferta)", async () => {
    aceiteRecusado({ erro: "sem_vinculo" });
    lembreteNaFila({ status: "executando" });
    await interceptar(entrada("SIM"));
    expect(jobDoLembrete()).toMatchObject({ status: "executando" });
    expect(awaitingReply()).toBe(true);
  });

  it("a gravação do lembrete dispensado falha: o desfecho não muda", async () => {
    aceiteRecusado({ erro: "sem_vinculo" });
    banco.aoInserir = (tabela, linha) =>
      tabela === "job_queue" && linha.id === idDoJobDoLembrete(OFERTA, CONTATO)
        ? { code: "57014" }
        : null;
    expect(await interceptar(entrada("SIM"))).toBe("tratou_com_eco");
    expect((ecos()[0]?.payload as Linha).body).toBe(RESPOSTA_OFERTA_PERDIDA);
    expect(jobDoLembrete()).toBeUndefined();
    expect(awaitingReply()).toBe(false);
  });

  it("o aceite que dá certo e o vencedor: nada dispensado", async () => {
    aceiteQueDaCerto();
    await interceptar(entrada("SIM"));
    expect(jobDoLembrete()).toBeUndefined();

    montar();
    banco.rpc("aceitar_oferta_de_espera", () => {
      fecharAOferta({ status: "preenchida", responded_by: CONTATO });
      return { data: { ok: false, erro: "ja_tratado" }, error: null };
    });
    await interceptar(entrada("SIM"));
    expect(jobDoLembrete()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A rota do webhook
// ---------------------------------------------------------------------------

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  ingestao: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => (estado.banco as Banco).cliente(),
}));
vi.mock("@/lib/integrations/whatsapp/ingest", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/whatsapp/ingest")>()),
  ingerirMensagemRecebida: async () => ({
    data: estado.ingestao,
    error: null,
  }),
}));
vi.mock("@/lib/integrations/whatsapp/trava-celular", () => ({
  conferirConexaoDoWebhook: async () => ({ resultado: "confirmada" }),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: async () => null,
}));
// A espera entre as tentativas da marcacao (achado 6), sem relogio: o teste
// confere QUANTO a rota esperaria.
vi.mock("@/lib/utils/esperar", () => ({
  esperar: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/webhooks/whatsapp/route");

const SEGREDO = "segredo-do-numero";
const TELEFONE = "+5584999990001";
let logs: string[];

/**
 * O contrato do banco (frente A, contrato 9), simplificado: so na conversa
 * com a IA, um turno sintetico encerrado que leu a mensagem; ja lida, nada
 * novo.
 */
function marcarComoOBanco(args: Record<string, unknown>): Resposta {
  const conversa = banco
    .linhas("conversation")
    .find((c) => c.id === args.p_conversation_id);
  if (conversa?.status !== "ia_atendendo") {
    return { data: { ok: false, motivo: "fora_da_ia" }, error: null };
  }
  const jaLida = banco
    .linhas("ai_turno")
    .some((t) =>
      ((t.mensagens_lidas as string[] | undefined) ?? []).includes(
        args.p_message_id as string,
      ),
    );
  if (jaLida) {
    return { data: { ok: true, marcada: false }, error: null };
  }
  banco.linhas("ai_turno").push({
    job_id: randomUUID(),
    clinic_id: args.p_clinic_id,
    conversation_id: args.p_conversation_id,
    estado: "enviado",
    saida: "nenhuma",
    mensagens_lidas: [args.p_message_id],
  });
  return { data: { ok: true, marcada: true }, error: null };
}

function prepararRota(iaAtendendo = true): void {
  estado.banco = banco;
  banco.linhas("whatsapp_account").push({
    id: NUMERO,
    clinic_id: CLINICA,
    removido_em: null,
    provider: "fake",
    connection_status: "conectado",
  });
  banco.linhas("whatsapp_account_secret").push({
    account_id: NUMERO,
    clinic_id: CLINICA,
    webhook_secret: SEGREDO,
    instance_token: null,
  });
  // A mensagem que chega, ja gravada pela ingestao (dublada).
  banco.linhas("message").push({
    id: MENSAGEM_NOVA,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: "entrada",
    author: "paciente",
    content_type: "texto",
    body: "corpo do paciente",
    media_url: null,
    created_at: new Date().toISOString(),
  });
  estado.ingestao = {
    inserted: true,
    contact_id: CONTATO,
    contact_created: false,
    conversation_id: CONVERSA,
    message_id: MENSAGEM_NOVA,
    whatsapp_account_id: NUMERO,
    ia_atendendo: iaAtendendo,
  };
  banco.rpc("enfileirar_resposta_da_ia", () => ({
    data: { codigo: "enfileirado", job_id: randomUUID() },
    error: null,
  }));
  banco.rpc("marcar_mensagem_tratada_pelo_sistema", marcarComoOBanco);
}

function pedido(body: string, extra: Record<string, unknown> = {}) {
  return new NextRequest(
    `https://exemplo.test/api/webhooks/whatsapp?clinic=${CLINICA}&account=${NUMERO}&secret=${SEGREDO}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "message_received",
        phone: TELEFONE,
        name: "Paciente",
        waMessageId: `wa-${randomUUID()}`,
        contentType: "texto",
        body,
        ...extra,
      }),
    },
  );
}

/** As mensagens do paciente que ainda voltariam como pendentes para a IA. */
function pendentesParaAIa(): string[] {
  const turnos = banco.linhas("ai_turno") as {
    job_id: string;
    estado: string;
    mensagens_lidas: string[] | null;
  }[];
  const mensagens = banco
    .linhas("message")
    .filter((m) => m.conversation_id === CONVERSA)
    .map((m) => ({
      id: m.id as string,
      author: m.author as string,
      content_type: (m.content_type as string | undefined) ?? "texto",
      body: (m.body as string | null | undefined) ?? null,
      media_url: null,
      created_at: m.created_at as string,
    }));
  return montarHistorico(
    mensagens,
    idsRespondidos(turnos, "job-do-proximo-turno"),
    null,
  ).pendentes;
}

type LinhaDeLog = Record<string, unknown> & { nivel?: string; evento?: string };

/** As linhas de log capturadas, lidas como o coletor as le (JSON por linha). */
function linhasDeLog(evento?: string): LinhaDeLog[] {
  return logs
    .join("")
    .split("\n")
    .flatMap((linha) => {
      try {
        const lida = JSON.parse(linha) as LinhaDeLog;
        return lida && typeof lida === "object" ? [lida] : [];
      } catch {
        return [];
      }
    })
    .filter((l) => evento === undefined || l.evento === evento);
}

function capturarLogs(): void {
  logs = [];
  const capturar = (linha: string | Uint8Array): boolean => {
    logs.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
  vi.mocked(esperar).mockClear();
}

function semDadoDoPacienteNoLog(): void {
  const tudo = logs.join("");
  // Regra 3.1: o log so leva ids e codigos.
  for (const proibido of [
    TELEFONE,
    "Que horas",
    "Confirmar",
    "Remarcar",
    "Bom dia",
    "onde fica",
    "corpo do paciente",
  ]) {
    expect(tudo).not.toContain(proibido);
  }
}

describe("a rota: a mensagem tratada pelo sistema", () => {
  beforeEach(capturarLogs);

  afterEach(() => {
    vi.restoreAllMocks();
    semDadoDoPacienteNoLog();
  });

  it("o lembrete na conversa com a IA: sem turno, e a mensagem sai das pendentes", async () => {
    montar();
    prepararRota();
    expect(pendentesParaAIa()).toEqual([MENSAGEM_NOVA]);

    const resposta = await POST(pedido("Que horas mesmo?"));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(ecos()).toHaveLength(1);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_message_id: MENSAGEM_NOVA,
      },
    ]);
    expect(pendentesParaAIa()).toEqual([]);
    expect(logs.join("")).toContain("webhook_ia_tratada_pelo_sistema");
  });

  it("a mensagem coberta pelo lembrete na fila (achado 1b): sem turno, sem segundo lembrete, fora das pendentes, e no contador até o lembrete sair", async () => {
    montar();
    lembreteNaFila();
    prepararRota();
    await POST(pedido("E onde fica a clínica?"));
    expect(lembretes()).toHaveLength(1);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    expect(pendentesParaAIa()).toEqual([]);
    expect(awaitingReply()).toBe(true);
  });

  it("sem a autorização (achado 3): o turno da IA de sempre, sem lembrete e nada marcado", async () => {
    montar();
    banco.rpc("consentimento_vigente", () => ({ data: false, error: null }));
    prepararRota();
    await POST(pedido("Que horas mesmo?"));
    expect(ecos()).toEqual([]);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toHaveLength(1);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual(
      [],
    );
    expect(pendentesParaAIa()).toEqual([MENSAGEM_NOVA]);
  });

  it("o vencedor agradece (achado 5): marcada, sem turno e fora do contador; o NÃO QUERO dele vai para a IA", async () => {
    montar({ oferta: { status: "preenchida", responded_by: CONTATO } });
    prepararRota();
    await POST(pedido("ok"));
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    expect(awaitingReply()).toBe(false);

    montar({ oferta: { status: "preenchida", responded_by: CONTATO } });
    prepararRota();
    await POST(pedido("Não quero"));
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toHaveLength(1);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual(
      [],
    );
    expect(pendentesParaAIa()).toEqual([MENSAGEM_NOVA]);
  });

  it("o toque (Confirmar) na conversa com a IA: confirma, sem turno, e não volta pendente para a IA", async () => {
    montar();
    banco.tabelas.set("waitlist_offer", []);
    toqueDeConfirmacao(5 * MINUTO);
    prepararRota();

    await POST(pedido("Confirmar", { quotedWaMessageId: "wa-toque" }));
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toHaveLength(1);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    expect(pendentesParaAIa()).toEqual([]);
  });

  it("mensagem comum na conversa com a IA: o turno de sempre, nada marcado", async () => {
    montar();
    banco.tabelas.set("waitlist_offer", []);
    prepararRota();

    await POST(pedido("Bom dia"));
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_message_id: MENSAGEM_NOVA,
      },
    ]);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual(
      [],
    );
    expect(pendentesParaAIa()).toEqual([MENSAGEM_NOVA]);
  });

  it("fora da conversa com a IA: o Confirmar de sempre, sem marcar; a mensagem comum, sem lembrete", async () => {
    montar({ status: "aguardando_humano" });
    banco.tabelas.set("waitlist_offer", []);
    toqueDeConfirmacao(5 * MINUTO);
    prepararRota(false);
    await POST(pedido("Confirmar", { quotedWaMessageId: "wa-toque" }));
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toHaveLength(1);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual(
      [],
    );
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);

    // A oferta de pe, mas a conversa e da equipe: nada do lembrete.
    montar({ status: "aguardando_humano" });
    prepararRota(false);
    await POST(pedido("Que horas mesmo?"));
    expect(ecos()).toEqual([]);
    expect(nomesDasChamadas()).toEqual([]);
  });

  it("reentrega: nem interceptador nem marcação", async () => {
    montar();
    prepararRota();
    estado.ingestao = {
      ...(estado.ingestao as Linha),
      inserted: false,
    };
    await POST(pedido("Que horas mesmo?"));
    expect(ecos()).toEqual([]);
    expect(banco.chamadas).toEqual([]);
  });

  it("grupo, status ou canal na conversa da IA: sem lembrete, a conversa sai da IA como hoje", async () => {
    montar();
    prepararRota();
    await POST(pedido("Que horas mesmo?", { individual: false }));
    expect(ecos()).toEqual([]);
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_motivo: "nao_individual",
      },
    ]);
    expect(banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema")).toEqual(
      [],
    );
  });

  it.each([
    ["erro do banco", () => ({ data: null, error: { code: "57014" } })],
    [
      "a conversa saiu da IA",
      () => ({ data: { ok: false, motivo: "fora_da_ia" }, error: null }),
    ],
    [
      "exceção",
      () => {
        throw new Error("Que horas mesmo? +5584999990001");
      },
    ],
  ])(
    "a marcação falha (%s): o 200 continua, o log só com ids",
    async (_nome, falha) => {
      montar();
      prepararRota();
      banco.rpc("marcar_mensagem_tratada_pelo_sistema", falha as Manipulador);
      const resposta = await POST(pedido("Que horas mesmo?"));
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ ok: true });
      const tudo = logs.join("");
      expect(tudo).toContain("webhook_ia_tratada_nao_marcada");
      expect(tudo).toContain(`"message_id":"${MENSAGEM_NOVA}"`);
      expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    },
  );
});

describe("a rota: a marcação tenta de novo, com prazo (revisão da AG5, achados 6 e 7)", () => {
  beforeEach(() => {
    capturarLogs();
    montar();
    prepararRota();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    semDadoDoPacienteNoLog();
  });

  /** A marcacao que falha nas primeiras `n` chamadas e depois e o banco. */
  function falhaAntes(n: number, falha: Manipulador): void {
    let feitas = 0;
    banco.rpc("marcar_mensagem_tratada_pelo_sistema", (args) => {
      feitas += 1;
      return feitas <= n ? falha(args) : marcarComoOBanco(args);
    });
  }

  it.each([
    ["conexão (08006)", () => ({ data: null, error: { code: "08006" } })],
    ["prazo do banco (57014)", () => ({ data: null, error: { code: "57014" } })],
    [
      "conexão do PostgREST (PGRST000)",
      () => ({ data: null, error: { code: "PGRST000" } }),
    ],
    ["sem código (rede)", () => ({ data: null, error: { message: "fetch" } })],
    [
      "exceção",
      () => {
        throw new Error("rede");
      },
    ],
  ])(
    "falha transitória (%s) e depois certo: duas chamadas, a mensagem marcada, o log de sucesso",
    async (_nome, falha) => {
      falhaAntes(1, falha as Manipulador);
      const resposta = await POST(pedido("Que horas mesmo?"));
      expect(resposta.status).toBe(200);
      expect(
        banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
      ).toHaveLength(2);
      expect(vi.mocked(esperar).mock.calls).toEqual([[200]]);
      expect(pendentesParaAIa()).toEqual([]);
      expect(linhasDeLog("webhook_ia_tratada_pelo_sistema")).toEqual([
        expect.objectContaining({
          nivel: "info",
          status: "marcada",
          attempt: 2,
          message_id: MENSAGEM_NOVA,
        }),
      ]);
      expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([]);
    },
  );

  it("sempre falhando: três chamadas, esperas de 200 e 500 ms, e o aviso com o código e a tentativa", async () => {
    falhaAntes(99, () => ({ data: null, error: { code: "57014" } }));
    const resposta = await POST(pedido("Que horas mesmo?"));
    expect(resposta.status).toBe(200);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(3);
    expect(vi.mocked(esperar).mock.calls).toEqual([[200], [500]]);
    expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([
      expect.objectContaining({
        nivel: "warn",
        error_code: "57014",
        attempt: 3,
      }),
    ]);
    // A mensagem volta pendente para a IA (o que a nova tentativa evita).
    expect(pendentesParaAIa()).toEqual([MENSAGEM_NOVA]);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
  });

  it.each(["22004", "22023", "42883", "PGRST202", "23514"])(
    "erro que outra tentativa não muda (%s): uma chamada só, o aviso",
    async (codigo) => {
      falhaAntes(99, () => ({ data: null, error: { code: codigo } }));
      await POST(pedido("Que horas mesmo?"));
      expect(
        banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
      ).toHaveLength(1);
      expect(esperar).not.toHaveBeenCalled();
      expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([
        expect.objectContaining({
          nivel: "warn",
          error_code: codigo,
          attempt: 1,
        }),
      ]);
    },
  );

  it("resposta fora do contrato: uma chamada só, o aviso com o status", async () => {
    falhaAntes(99, () => ({ data: { ok: false }, error: null }));
    await POST(pedido("Que horas mesmo?"));
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([
      expect.objectContaining({ nivel: "warn", status: "desconhecido" }),
    ]);
  });

  it("a chamada presa: cada tentativa espera no máximo 1,5 s, e o 200 sai em até 3 s", async () => {
    let chegou: () => void = () => undefined;
    const primeiraChamada = new Promise<void>((resolve) => {
      chegou = resolve;
    });
    banco.rpc("marcar_mensagem_tratada_pelo_sistema", () => {
      chegou();
      return new Promise<Resposta>(() => undefined);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let saiu = false;
    const promessa = POST(pedido("Que horas mesmo?")).then((r) => {
      saiu = true;
      return r;
    });
    // Em tempo real, ate a rota chegar a marcacao, com o relogio falso
    // parado: o prazo da primeira tentativa comeca no instante 0.
    await primeiraChamada;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(saiu).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(saiu).toBe(true);
    const resposta = await promessa;
    expect(resposta.status).toBe(200);
    // A terceira nao cabe no prazo: duas chamadas, o aviso do prazo.
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(2);
    expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([
      expect.objectContaining({
        nivel: "warn",
        error_code: "prazo",
        attempt: 2,
      }),
    ]);
  });

  it("o Remarcar na conversa com a IA tira a conversa da IA: o fora_da_ia é info, nunca aviso, e não tenta de novo (achado 7)", async () => {
    banco.tabelas.set("waitlist_offer", []);
    const inicio = toqueDeConfirmacao(5 * MINUTO);
    banco.rpc("pedir_remarcacao_pelo_paciente", () => {
      // A RPC deixa a conversa esperando a recepcao.
      mudarStatusDaConversa("aguardando_humano");
      return {
        data: { ok: true, starts_at: inicio, timezone: FUSO },
        error: null,
      };
    });
    const resposta = await POST(
      pedido("Remarcar", { quotedWaMessageId: "wa-toque" }),
    );
    expect(resposta.status).toBe(200);
    expect(banco.chamadasDe("pedir_remarcacao_pelo_paciente")).toHaveLength(1);
    expect(
      banco.chamadasDe("marcar_mensagem_tratada_pelo_sistema"),
    ).toHaveLength(1);
    expect(esperar).not.toHaveBeenCalled();
    expect(linhasDeLog("webhook_ia_tratada_nao_marcada")).toEqual([
      expect.objectContaining({
        nivel: "info",
        status: "fora_da_ia",
        message_id: MENSAGEM_NOVA,
      }),
    ]);
    expect(linhasDeLog().filter((l) => l.nivel === "warn")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// O executor: o lembrete que SAI tira a conversa do contador (revisao da AG5)
// ---------------------------------------------------------------------------

// O executor de verdade (executarJobComPosse) sobre o mesmo banco em memoria:
// a guarda da oferta, a autorizacao, o numero e a conversa vem do banco; so
// o envio e dublado, gravando a linha da mensagem como send.ts (com o job_id).
vi.mock("@/lib/integrations/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

const { executarJobComPosse } = await import("@/lib/jobs/worker");
const { sendWhatsAppText } = await import("@/lib/integrations/whatsapp/send");

const EXECUTOR = "executor-de-teste";

/**
 * O motor reivindica e executa o lembrete que esta na fila: a posse, o
 * numero (numero_do_job), a conversa (garantir_conversa_aberta), concluir e
 * falhar como o banco. O envio dublado grava a mensagem do lembrete.
 */
async function motorExecutaOLembrete(): Promise<string> {
  const linha = jobDoLembrete();
  if (!linha) {
    throw new Error("nenhum lembrete na fila");
  }
  linha.status = "executando";
  linha.locked_by = EXECUTOR;
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("numero_do_job", () => ({
    data: { estado: "ok", whatsapp_account_id: NUMERO },
    error: null,
  }));
  banco.rpc("garantir_conversa_aberta", () => ({
    data: CONVERSA,
    error: null,
  }));
  banco.rpc("concluir_job", () => {
    linha.status = "concluido";
    return { data: null, error: null };
  });
  banco.rpc("falhar_job", (args) => {
    linha.status = args.p_definitivo === true ? "falhou" : "pendente";
    linha.last_error = args.p_erro;
    return { data: null, error: null };
  });
  vi.mocked(sendWhatsAppText).mockImplementation(async (_admin, envio) => {
    banco.linhas("message").push({
      id: randomUUID(),
      clinic_id: envio.clinicId,
      conversation_id: envio.conversationId,
      direction: "saida",
      author: "sistema",
      is_internal_note: false,
      job_id: envio.jobId ?? null,
      wa_message_id: "wa-lembrete",
      delivery_status: "enviada",
      whatsapp_account_id: NUMERO,
      created_at: new Date().toISOString(),
    });
    return { ok: true, messageId: "m-lembrete" };
  });
  return executarJobComPosse(banco.cliente(), EXECUTOR, {
    id: String(linha.id),
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    payload: linha.payload as Record<string, unknown>,
    attempts: 1,
    max_attempts: 5,
    whatsapp_account_id: String(linha.whatsapp_account_id),
    created_at: String(linha.created_at),
  });
}

describe("o executor: o lembrete que sai tira a conversa do contador (revisão da AG5)", () => {
  beforeEach(() => {
    capturarLogs();
    montar();
  });

  afterEach(() => {
    vi.mocked(sendWhatsAppText).mockReset();
    vi.restoreAllMocks();
    semDadoDoPacienteNoLog();
    // O texto do lembrete tambem nunca vai para o log.
    expect(logs.join("")).not.toContain("Sobre o horário");
  });

  it("a pergunta pede o lembrete (no contador); o motor o manda: o contador cai, e a varredura não tira a conversa da IA", async () => {
    expect(await interceptar(entrada("Qual o endereço?"))).toBe(
      "tratou_com_eco",
    );
    expect(awaitingReply()).toBe(true);
    expect(await motorExecutaOLembrete()).toBe("concluido");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(jobDoLembrete()).toMatchObject({ status: "concluido" });
    expect(awaitingReply()).toBe(false);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(false);
  });

  it("duas perguntas (a segunda coberta) e o lembrete sai: as duas respondidas por ele, o contador cai; a mensagem seguinte é da IA", async () => {
    await interceptar(entrada("Qual o endereço?"));
    voltarAoContador();
    await interceptar(entrada("Aceita Unimed?"));
    expect(await motorExecutaOLembrete()).toBe("concluido");
    expect(awaitingReply()).toBe(false);

    // Depois que ele saiu, a mensagem seguinte vai para a IA (no contador
    // ate a IA responder), sem segundo lembrete.
    voltarAoContador();
    expect(await interceptar(entrada("E o preço?"))).toBe("sem_intencao");
    expect(lembretes()).toHaveLength(1);
    expect(awaitingReply()).toBe(true);
  });

  it("alguém assumiu a conversa antes de o lembrete sair: ele sai, e a conversa continua no contador da equipe", async () => {
    await interceptar(entrada("Qual o endereço?"));
    mudarStatusDaConversa("em_atendimento");
    expect(await motorExecutaOLembrete()).toBe("concluido");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(awaitingReply()).toBe(true);
  });

  it("o efeito aceito: o lembrete que demora mais de 3 minutos deixa a varredura passar a conversa para a equipe antes de ele sair", async () => {
    await interceptar(entrada("Qual o endereço?"));
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS - SEGUNDO)).toBe(false);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
    // A varredura tirou a conversa da IA; o lembrete sai depois, e o
    // contador continua com a equipe.
    mudarStatusDaConversa("aguardando_humano");
    expect(await motorExecutaOLembrete()).toBe("concluido");
    expect(awaitingReply()).toBe(true);
  });

  it("a guarda do executor (outro candidato ganhou com o lembrete executando): nada sai, e a conversa fica no contador para a varredura", async () => {
    await interceptar(entrada("Qual o endereço?"));
    // Executando nao e cancelado pelo banco: so a guarda o pega.
    for (const o of banco.linhas("waitlist_offer")) {
      Object.assign(o, {
        status: "preenchida",
        responded_by: OUTRO_CONTATO,
        updated_at: new Date().toISOString(),
      });
    }
    expect(await motorExecutaOLembrete()).toBe("falhou");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(jobDoLembrete()).toMatchObject({
      status: "falhou",
      last_error: "oferta_encerrada",
    });
    expect(awaitingReply()).toBe(true);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
  });

  it("a autorização revogada antes do envio: nada sai, e a conversa fica no contador para a varredura", async () => {
    await interceptar(entrada("Qual o endereço?"));
    banco.rpc("consentimento_vigente", () => ({ data: false, error: null }));
    expect(await motorExecutaOLembrete()).toBe("falhou");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(jobDoLembrete()).toMatchObject({
      status: "falhou",
      last_error: "sem_consentimento",
    });
    expect(awaitingReply()).toBe(true);
    expect(varreduraPassaParaAEquipe(TRES_MINUTOS + SEGUNDO)).toBe(true);
  });
});
