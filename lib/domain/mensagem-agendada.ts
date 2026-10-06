import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { ConversationStatus } from "@/lib/design/status";
import { ehDiaValido } from "@/lib/domain/atividades";
import type { CorDoNumero } from "@/lib/domain/cor-do-numero";
import {
  diaCivil,
  diasEntre,
  instanteLocal,
  somarDias,
  somarMeses,
} from "@/lib/domain/horarios";

// Mensagem agendada na conversa (tabela mensagem_agendada, migration
// 20261006140000_mensagem_agendada). Modulo PURO, zero I/O: as listas
// fechadas do banco (situacao e motivo), o estado que o item da lista mostra,
// as acoes de cada item com a dica de quando estao desabilitadas, os textos
// de quando sai e do motivo, a validacao da data e da hora no fuso da clinica
// e a regra da madrugada do executor.
//
// Regra 3.6: tudo que e "hoje", "amanha", teto de 1 ano e faixa de silencio
// e contado no fuso da clinica, recebido por parametro junto com o "agora"
// (epoch em ms). Nada aqui le o relogio.
//
// Decisoes do dono de 06/10/2026 (desenho-final):
// - A1: quem escreve e ve a agendada edita; quem assina e quem editou por
//   ultimo, senao quem criou (assinanteDaAgendada).
// - A2: atrasada nao sai entre 21:00 e 08:00 (decidirJanelaDaAgendada; o
//   limite real de cada uma em prazoEfetivoDaAgendada).
// - A3: a que nao sai vira uma atividade para o assinante conferir.

// ---------------------------------------------------------------------------
// Listas fechadas do banco
// ---------------------------------------------------------------------------

/** As situacoes do CHECK situacao_da_agendada, na ordem do desenho. */
export const SITUACOES_DA_AGENDADA = [
  "agendada",
  "enviando",
  "enviada",
  "nao_enviada",
  "nao_confirmada",
  "cancelada",
] as const;

export type SituacaoDaAgendada = (typeof SITUACOES_DA_AGENDADA)[number];

/**
 * Os motivos do CHECK motivo_da_agendada. O banco grava ja traduzido do
 * codigo de erro do envio (funcao motivo_da_agendada no SQL); a tela so
 * traduz daqui para texto (textoDoMotivo). Um teste cruza esta lista com a
 * da migration.
 */
export const MOTIVOS_DA_AGENDADA = [
  "sem_autorizacao",
  "numero_removido",
  "numero_desconectado",
  "atrasou",
  // Atrasou e o envio cairia na faixa de silencio, com o 08:00 seguinte
  // depois do prazo (A2). 'atrasou' fica so para mais de 12 horas.
  "madrugada",
  "canal_ocupado",
  "falha_no_envio",
  "envio_incerto",
  "enviada_agora",
] as const;

export type MotivoDaAgendada = (typeof MOTIVOS_DA_AGENDADA)[number];

export function ehSituacaoDaAgendada(
  valor: unknown,
): valor is SituacaoDaAgendada {
  return (
    typeof valor === "string" &&
    (SITUACOES_DA_AGENDADA as readonly string[]).includes(valor)
  );
}

export function ehMotivoDaAgendada(valor: unknown): valor is MotivoDaAgendada {
  return (
    typeof valor === "string" &&
    (MOTIVOS_DA_AGENDADA as readonly string[]).includes(valor)
  );
}

/**
 * Teto do texto, contado em unidades UTF-16 (texto.length): a MESMA regua do
 * envio 1:1 (bodySchema do sendMessageAction) e do compositor, para o "Enviar
 * agora" nunca recusar o que o agendamento aceitou. O CHECK texto_da_agendada
 * do banco conta pontos de codigo (char_length) e e mais frouxo: um emoji e 2
 * aqui e 1 la.
 */
export const TEXTO_MAXIMO_DA_AGENDADA = 4096;
/** Igual ao v_teto do gatilho proteger_mensagem_agendada (A5). */
export const TETO_DE_AGENDADAS_POR_CONTATO = 10;
/** Teto de 1 ano a frente, contado no dia civil da clinica (somarMeses). */
export const HORIZONTE_EM_MESES = 12;

// ---------------------------------------------------------------------------
// Regra da madrugada e prazo (A2)
// ---------------------------------------------------------------------------

/** A faixa de silencio comeca as 21:00 (inclusive), no fuso da clinica. */
export const SILENCIO_INICIO_HORA = 21;
/** E termina as 08:00 (exclusive): as 08:00 em ponto ja pode sair. */
export const SILENCIO_FIM_HORA = 8;
/** Ate 15 minutos depois da hora marcada a mensagem nao conta como atrasada. */
export const TOLERANCIA_DE_ATRASO_MS = 15 * 60_000;
/**
 * Prazo da agendada: 12 horas depois da hora marcada (o mesmo "desconectado:
 * espera ate 12 h" do backlog). Depois dele, ela desiste com 'atrasou'. A
 * planejadora usa o mesmo numero em SQL (interval '12 hours').
 */
export const PRAZO_DA_AGENDADA_MS = 12 * 60 * 60_000;
/**
 * Folga do relogio no prazo: o executor so desiste por prazo quando passou
 * de enviarEm + 12 h + 5 min. Sem ela, a agendada das 20:00 que esperou a
 * madrugada ate as 08:00 (o proprio prazo) acordava segundos depois dele,
 * na vez do motor, e morria como 'atrasou' (achado 6 da revisao).
 */
export const FOLGA_DA_JANELA_MS = 5 * 60_000;
/** A enviada fica 24 horas na lista, com "Ver na conversa". */
export const PERMANENCIA_DA_ENVIADA_MS = 24 * 60 * 60_000;

function instante(valor: string | null | undefined): number {
  if (typeof valor !== "string") {
    return Number.NaN;
  }
  return new Date(valor).getTime();
}

/**
 * O prazo cru da agendada (epoch em ms): enviarEm + 12 h. Ancora FIXA na
 * hora marcada, nunca no relogio. Data ilegivel nao tem o que esperar:
 * -Infinity (o executor desiste). Com a regra da madrugada, o limite real
 * pode ser antes: prazoEfetivoDaAgendada.
 */
export function prazoDaEsperaDaAgendada(enviarEm: string): number {
  const marcada = instante(enviarEm);
  return Number.isFinite(marcada)
    ? marcada + PRAZO_DA_AGENDADA_MS
    : Number.NEGATIVE_INFINITY;
}

/** Por que o executor desiste: passou do prazo, ou cairia de madrugada. */
export type MotivoDaDesistencia = Extract<
  MotivoDaAgendada,
  "atrasou" | "madrugada"
>;

export type JanelaDaAgendada =
  | { acao: "enviar" }
  | { acao: "esperar"; ate: string }
  | { acao: "desistir"; motivo: MotivoDaDesistencia };

/**
 * O que o executor faz com a agendada agora (A2, decisao do dono):
 * - passou de enviarEm + 12 h + FOLGA_DA_JANELA_MS: desistir ('atrasou');
 * - no horario (ate 15 minutos depois da hora marcada): enviar, mesmo dentro
 *   da faixa, porque a hora foi escolhida pela pessoa (22:00 sai as 22:00);
 * - atrasada e a hora local esta em [21:00, 08:00): esperar o proximo 08:00
 *   local quando ele e ATE o prazo (inclusive: a das 20:00 espera o 08:00,
 *   que e o proprio prazo); senao desistir com 'madrugada' ('atrasou' se o
 *   prazo ja passou, dentro da folga);
 * - atrasada fora da faixa: enviar.
 */
export function decidirJanelaDaAgendada(params: {
  enviarEm: string;
  agora: number;
  fuso: string;
}): JanelaDaAgendada {
  const marcada = instante(params.enviarEm);
  if (!Number.isFinite(marcada)) {
    return { acao: "desistir", motivo: "atrasou" };
  }
  const prazo = marcada + PRAZO_DA_AGENDADA_MS;
  if (params.agora > prazo + FOLGA_DA_JANELA_MS) {
    return { acao: "desistir", motivo: "atrasou" };
  }
  if (params.agora <= marcada + TOLERANCIA_DE_ATRASO_MS) {
    return { acao: "enviar" };
  }
  const agoraLocal = new TZDate(params.agora, params.fuso);
  const hora = agoraLocal.getHours();
  const naFaixa = hora >= SILENCIO_INICIO_HORA || hora < SILENCIO_FIM_HORA;
  if (!naFaixa) {
    return { acao: "enviar" };
  }
  const hoje = diaCivil(params.fuso, new Date(params.agora));
  const diaDoFim = hora >= SILENCIO_INICIO_HORA ? somarDias(hoje, 1) : hoje;
  const ate = instanteLocal(
    params.fuso,
    diaDoFim,
    horaCheia(SILENCIO_FIM_HORA),
  );
  if (ate.getTime() > prazo) {
    return {
      acao: "desistir",
      motivo: params.agora > prazo ? "atrasou" : "madrugada",
    };
  }
  return { acao: "esperar", ate: ate.toISOString() };
}

/**
 * Ate quando a agendada AINDA PODE SAIR (epoch em ms), com a regra da
 * madrugada: o instante ate o qual o numero precisa reconectar (e o canal
 * abrir) para ela sair. E o menor entre o prazo (enviarEm + 12 h) e o
 * comeco (21:00) de uma faixa de silencio que cai dentro do atraso e so
 * termina (08:00) depois do prazo: dali em diante nada sai.
 *
 * Exemplos em Fortaleza: marcada para 14:00, o prazo e 02:00, mas das 21:00
 * as 08:00 a atrasada espera e o 08:00 passa do prazo: o limite e 21:00.
 * Marcada para 20:00, o 08:00 seguinte e o proprio prazo e ela espera: o
 * limite e o prazo. E a mesma conta de decidirJanelaDaAgendada, sem a folga
 * do relogio. Data ilegivel: -Infinity (nao ha o que esperar).
 */
export function prazoEfetivoDaAgendada(enviarEm: string, fuso: string): number {
  const marcada = instante(enviarEm);
  if (!Number.isFinite(marcada)) {
    return Number.NEGATIVE_INFINITY;
  }
  const prazo = marcada + PRAZO_DA_AGENDADA_MS;
  const atrasoComeca = marcada + TOLERANCIA_DE_ATRASO_MS;
  const dia = diaCivil(fuso, new Date(atrasoComeca));
  // O atraso dura menos de 12 horas e a faixa 11: ele cruza no maximo a
  // faixa que vem da vespera e a que comeca no dia; a do dia seguinte fecha
  // a conta com folga.
  for (const noite of [somarDias(dia, -1), dia, somarDias(dia, 1)]) {
    const comeca = instanteLocal(
      fuso,
      noite,
      horaCheia(SILENCIO_INICIO_HORA),
    ).getTime();
    const termina = instanteLocal(
      fuso,
      somarDias(noite, 1),
      horaCheia(SILENCIO_FIM_HORA),
    ).getTime();
    if (termina <= atrasoComeca || comeca > prazo) {
      continue;
    }
    if (termina > prazo) {
      return Math.max(comeca, atrasoComeca);
    }
  }
  return prazo;
}

function horaCheia(hora: number): string {
  return `${String(hora).padStart(2, "0")}:00`;
}

// ---------------------------------------------------------------------------
// Tipos da lista (contrato com lib/queries/mensagens-agendadas.ts)
// ---------------------------------------------------------------------------

export type AgendadaDaLista = {
  id: string;
  contactId: string;
  whatsappAccountId: string;
  conversationId: string | null;
  /** Nulo depois de enviada, cancelada ou dispensada */
  texto: string | null;
  /** Instante marcado (ISO, UTC) */
  enviarEm: string;
  situacao: SituacaoDaAgendada;
  motivo: MotivoDaAgendada | null;
  criadaPor: string;
  editadaPor: string | null;
  enviadaEm: string | null;
  messageId: string | null;
  dispensadaEm: string | null;
  criadaEm: string;
  editadaEm: string | null;
};

export type ConexaoDoNumeroDaAgendada = {
  nome: string;
  conectado: boolean;
  removido: boolean;
  cor: CorDoNumero | null;
};

export type ContextoDaListaDeAgendadas = {
  /** Por whatsapp_account_id: created_at da ultima entrada do contato */
  ultimaEntradaPorNumero: Record<string, string | null>;
  /** Por whatsapp_account_id: nome, conexao e cor de cada numero */
  conexaoPorNumero: Record<string, ConexaoDoNumeroDaAgendada>;
  /** user_id de quem e membro ativo com escrita (Somente leitura nao conta) */
  membrosComEscrita: string[];
};

/** Quem assina (A1): quem editou por ultimo, senao quem criou. */
export function assinanteDaAgendada(
  a: Pick<AgendadaDaLista, "criadaPor" | "editadaPor">,
): string {
  return a.editadaPor ?? a.criadaPor;
}

export const agendadasKeys = {
  doContato: (clinicId: string, contactId: string) =>
    ["agendadas", clinicId, contactId] as const,
  /**
   * A autoria das mensagens do fio que sairam de uma agendada (bolha
   * "Mensagem agendada"): fetchAgendadasDoFio, em
   * lib/queries/agendadas-do-fio.ts. Consulta SEPARADA do fio de proposito:
   * se ela falhar, so a marca da bolha some, e o fio continua.
   */
  doFio: (conversationId: string) =>
    ["agendadas-do-fio", conversationId] as const,
};

/**
 * A agendada de onde uma mensagem do fio saiu: so quem criou e quem editou
 * por ultimo (autoriaDaBolha). Nunca o texto: depois de sair, ele vive em
 * message.
 */
export type AgendadaDoFio = { criadaPor: string; editadaPor: string | null };

/** Por message_id: a mensagem que saiu de uma agendada. */
export type AgendadasDoFio = Record<string, AgendadaDoFio>;

// ---------------------------------------------------------------------------
// Estado do item
// ---------------------------------------------------------------------------

/**
 * O que o chip do item mostra (MENSAGEM_AGENDADA_STATUS em lib/design/status).
 * silencio_noturno usa o MESMO chip de na_fila; muda so a linha.
 */
export type EstadoDoItemDaAgendada =
  | "agendada"
  | "na_fila"
  | "esperando_numero"
  | "silencio_noturno"
  | "enviada"
  | "nao_enviada"
  | "nao_confirmada";

/** Os estados de antes do envio (a mensagem ainda pode sair). */
const ANTES_DO_ENVIO: readonly EstadoDoItemDaAgendada[] = [
  "agendada",
  "na_fila",
  "esperando_numero",
  "silencio_noturno",
];

export function estaAntesDoEnvio(estado: EstadoDoItemDaAgendada): boolean {
  return ANTES_DO_ENVIO.includes(estado);
}

/**
 * O estado do item, ou null quando ele nao aparece (cancelada, dispensada, ou
 * enviada ha mais de 24 horas).
 *
 * - 'enviando' e a 'agendada' cuja hora ja passou (esperando a planejadora ou
 *   a anterior do mesmo contato e numero) estao "na fila": com o numero
 *   desconectado, "esperando o numero"; atrasada na madrugada, "silencio
 *   noturno" (A2), com o mesmo chip da fila.
 * - Numero removido nao reconecta: fica na fila ate o banco fechar como nao
 *   enviada.
 */
export function estadoDoItem(
  a: AgendadaDaLista,
  ctx: ContextoDaListaDeAgendadas,
  agora: number,
  fuso: string,
): EstadoDoItemDaAgendada | null {
  if (a.dispensadaEm !== null) {
    return null;
  }
  switch (a.situacao) {
    case "cancelada":
      return null;
    case "enviada": {
      const saiu = instante(a.enviadaEm ?? a.enviarEm);
      return Number.isFinite(saiu) && agora - saiu > PERMANENCIA_DA_ENVIADA_MS
        ? null
        : "enviada";
    }
    case "nao_enviada":
      return "nao_enviada";
    case "nao_confirmada":
      return "nao_confirmada";
    case "agendada":
      if (instante(a.enviarEm) > agora) {
        return "agendada";
      }
      return estadoNaFila(a, ctx, agora, fuso);
    case "enviando":
      return estadoNaFila(a, ctx, agora, fuso);
  }
}

function estadoNaFila(
  a: AgendadaDaLista,
  ctx: ContextoDaListaDeAgendadas,
  agora: number,
  fuso: string,
): EstadoDoItemDaAgendada {
  if (numeroDesconectado(a, ctx)) {
    return "esperando_numero";
  }
  const janela = decidirJanelaDaAgendada({ enviarEm: a.enviarEm, agora, fuso });
  return janela.acao === "esperar" ? "silencio_noturno" : "na_fila";
}

function numeroDesconectado(
  a: AgendadaDaLista,
  ctx: ContextoDaListaDeAgendadas,
): boolean {
  const conexao = ctx.conexaoPorNumero[a.whatsappAccountId];
  return conexao !== undefined && !conexao.removido && !conexao.conectado;
}

/**
 * Itens que ficam sempre a vista, mesmo com a lista resumida: os que nao
 * sairam, o que espera o numero e o que ainda vai sair com o aviso
 * "{Contato} escreveu depois" (decisao 2 do dono: a agendada nao cancela
 * sozinha, mas o item avisa, e o aviso nao pode ficar atras do "Ver todas").
 */
export function ficaSempreAVista(
  estado: EstadoDoItemDaAgendada,
  agendada: AgendadaDaLista,
  ctx: ContextoDaListaDeAgendadas,
): boolean {
  return (
    estado === "nao_enviada" ||
    estado === "nao_confirmada" ||
    estado === "esperando_numero" ||
    (estaAntesDoEnvio(estado) && pacienteEscreveuDepois(agendada, ctx))
  );
}

/**
 * O paciente escreveu no mesmo numero depois que a agendada foi criada (ou
 * editada por ultimo): a equipe decide se ela ainda faz sentido.
 */
export function pacienteEscreveuDepois(
  a: AgendadaDaLista,
  ctx: ContextoDaListaDeAgendadas,
): boolean {
  const ultima = instante(ctx.ultimaEntradaPorNumero[a.whatsappAccountId]);
  const marco = instante(a.editadaEm ?? a.criadaEm);
  return Number.isFinite(ultima) && Number.isFinite(marco) && ultima > marco;
}

// ---------------------------------------------------------------------------
// Acoes do item
// ---------------------------------------------------------------------------

export type Acao = {
  visivel: boolean;
  habilitada: boolean;
  dica: string | null;
};

export type AcoesDoItem = {
  editar: Acao;
  excluir: Acao;
  enviarAgora: Acao;
  agendarDeNovo: Acao;
  dispensar: Acao;
};

/** As dicas das acoes desabilitadas e do botao do compositor (textos exatos). */
export const DICAS_DA_AGENDADA = {
  /** Igual ao SO_ACOMPANHA de components/atendimento/acoes-da-conversa.tsx */
  soAcompanha: "Seu perfil acompanha o atendimento, sem responder.",
  editarNaFila:
    "Esta mensagem já está na fila para sair e não dá mais para mudar. Você ainda pode excluir.",
  enviarAgoraResolvida:
    "Para enviar agora, use Reabrir e responder, no topo da conversa.",
  enviarAgoraAssuma: "Para enviar agora, assuma a conversa.",
  enviarAgoraComIa:
    "A IA está atendendo. Para enviar agora, assuma a conversa.",
  enviarAgoraComColega: (nome: string) =>
    `${nome} está atendendo. Para enviar agora, use Assumir do colega, no topo da conversa.`,
  enviarAgoraOutroNumero: (nome: string | null) =>
    `Esta mensagem sai ${nome ? `pelo número ${nome}` : "por outro número"}. Para enviar agora, abra a conversa desse número.`,
  /** O numero DA AGENDADA caiu: ela espera a reconexao (ate o prazo). */
  enviarAgoraNumeroDesconectado: (nome: string | null) =>
    `O número${nome ? ` ${nome}` : ""} está desconectado. A mensagem continua agendada e espera a reconexão.`,
  agendarDeNovo: "Para agendar de novo, assuma a conversa.",
  /** O numero da conversa ABERTA foi removido: agendar por ela nunca vale. */
  agendarDeNovoNumeroRemovido: (nome: string | null) =>
    `O número${nome ? ` ${nome}` : ""} foi removido. Para agendar de novo, use a conversa de outro número.`,
  agendarComErroNaLista:
    "Confira as mensagens agendadas antes de agendar outra.",
} as const;

export type ContextoDasAcoesDaAgendada = {
  viewerId: string;
  /** user_can_write na clinica (Somente leitura e false) */
  podeEscrever: boolean;
  /** A conversa ABERTA na tela esta em atendimento com quem ve */
  conversaComigo: boolean;
  /** Status da conversa aberta na tela */
  statusDaConversa: ConversationStatus | null;
  /** Quem atende a conversa aberta, para a dica de colega */
  nomeDoResponsavel: string | null;
  /** O estado do item (estadoDoItem) */
  estado: EstadoDoItemDaAgendada;
  /**
   * whatsapp_account_id da conversa aberta. Quando vem e e de outro numero, o
   * Enviar agora fica desabilitado: ele sai pela conversa do numero DA
   * agendada (tirar_agendada_para_enviar_agora), nao pela aberta.
   */
  numeroDaConversa?: string | null;
  /** Nome do numero da agendada, para a dica de outro numero */
  nomeDoNumeroDaAgendada?: string | null;
  /**
   * A conexao de cada numero (o conexaoPorNumero do contexto da lista). Com
   * ela: o Enviar agora trava quando o numero DA AGENDADA esta desconectado
   * (o envio 1:1 recusaria depois de retirar, e a agendada, que esperaria a
   * reconexao, ja nao existiria), e o Agendar de novo trava quando o numero
   * da conversa ABERTA (numeroDaConversa) foi removido. Numero que nao esta
   * no mapa conta como desconhecido: nada trava por ele.
   */
  conexaoPorNumero: Record<string, ConexaoDoNumeroDaAgendada>;
};

const OCULTA: Acao = { visivel: false, habilitada: false, dica: null };

function acao(habilitada: boolean, dica: string | null): Acao {
  return { visivel: true, habilitada, dica: habilitada ? null : dica };
}

/**
 * As acoes de cada item (A1: quem escreve e ve a agendada edita e exclui;
 * Enviar agora exige a conversa em atendimento com quem ve e o numero da
 * agendada conectado; Agendar de novo exige a conversa e o numero dela nao
 * removido). Acao sem permissao fica visivel e desabilitada, com a dica.
 */
export function acoesDoItem(
  a: AgendadaDaLista,
  c: ContextoDasAcoesDaAgendada,
): AcoesDoItem {
  const so = DICAS_DA_AGENDADA.soAcompanha;
  const antes = estaAntesDoEnvio(c.estado);

  const editar =
    c.estado === "agendada"
      ? acao(c.podeEscrever, so)
      : antes
        ? acao(false, c.podeEscrever ? DICAS_DA_AGENDADA.editarNaFila : so)
        : OCULTA;

  const excluir = antes ? acao(c.podeEscrever, so) : OCULTA;

  const enviarAgora =
    c.estado === "agendada" ? acaoDeEnviarAgora(a, c) : OCULTA;

  const agendarDeNovo =
    c.estado === "nao_enviada" ? acaoDeAgendarDeNovo(c) : OCULTA;

  const dispensar =
    c.estado === "nao_enviada" || c.estado === "nao_confirmada"
      ? acao(c.podeEscrever, so)
      : OCULTA;

  return { editar, excluir, enviarAgora, agendarDeNovo, dispensar };
}

function acaoDeEnviarAgora(
  a: AgendadaDaLista,
  c: ContextoDasAcoesDaAgendada,
): Acao {
  if (!c.podeEscrever) {
    return acao(false, DICAS_DA_AGENDADA.soAcompanha);
  }
  // Sem o numero da conversa aberta (nao veio, ou veio nulo), vale o
  // contrato basico: conversaComigo e o status decidem.
  const outroNumero =
    typeof c.numeroDaConversa === "string" &&
    c.numeroDaConversa !== a.whatsappAccountId;
  if (outroNumero) {
    const nome = c.nomeDoNumeroDaAgendada?.trim() || null;
    return acao(false, DICAS_DA_AGENDADA.enviarAgoraOutroNumero(nome));
  }
  // O numero da agendada caiu: tirar_agendada_para_enviar_agora retiraria e
  // o envio 1:1 recusaria. Parada, ela espera a reconexao sozinha.
  const conexao = c.conexaoPorNumero[a.whatsappAccountId];
  if (conexao && !conexao.removido && !conexao.conectado) {
    return acao(
      false,
      DICAS_DA_AGENDADA.enviarAgoraNumeroDesconectado(
        conexao.nome.trim() || null,
      ),
    );
  }
  if (c.conversaComigo) {
    return acao(true, null);
  }
  switch (c.statusDaConversa) {
    case "resolvida":
      return acao(false, DICAS_DA_AGENDADA.enviarAgoraResolvida);
    case "ia_atendendo":
      return acao(false, DICAS_DA_AGENDADA.enviarAgoraComIa);
    case "em_atendimento":
      return acao(
        false,
        DICAS_DA_AGENDADA.enviarAgoraComColega(
          c.nomeDoResponsavel?.trim() || "Outra pessoa",
        ),
      );
    default:
      return acao(false, DICAS_DA_AGENDADA.enviarAgoraAssuma);
  }
}

/**
 * "Agendar de novo" agenda pela conversa ABERTA. Numero dela removido: o
 * gatilho recusaria mesmo com a conversa assumida, entao a dica manda para a
 * conversa de outro numero (e nao para "assuma a conversa", que nao leva a
 * lugar nenhum).
 */
function acaoDeAgendarDeNovo(c: ContextoDasAcoesDaAgendada): Acao {
  if (!c.podeEscrever) {
    return acao(false, DICAS_DA_AGENDADA.soAcompanha);
  }
  const numeroDaConversa =
    typeof c.numeroDaConversa === "string"
      ? c.conexaoPorNumero[c.numeroDaConversa]
      : undefined;
  if (numeroDaConversa?.removido) {
    return acao(
      false,
      DICAS_DA_AGENDADA.agendarDeNovoNumeroRemovido(
        numeroDaConversa.nome.trim() || null,
      ),
    );
  }
  return acao(c.conversaComigo, DICAS_DA_AGENDADA.agendarDeNovo);
}

/** O rotulo do dispensar: na nao confirmada ele e "Entendi, esconder". */
export function rotuloDoDispensar(estado: EstadoDoItemDaAgendada): string {
  return estado === "nao_confirmada" ? "Entendi, esconder" : "Dispensar";
}

// ---------------------------------------------------------------------------
// Datas em texto (fuso da clinica)
// ---------------------------------------------------------------------------

function anoDe(dia: string): string {
  return dia.slice(0, 4);
}

function dataCurta(dia: string, hoje: string): string {
  const [ano, mes, d] = dia.split("-");
  return ano === anoDe(hoje) ? `${d}/${mes}` : `${d}/${mes}/${ano}`;
}

function dataCompleta(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

function horaLocal(ms: number, fuso: string): string {
  return format(new TZDate(ms, fuso), "HH:mm");
}

/**
 * "hoje às 11:00", "amanhã às 09:00", "ontem às 23:00", "08/10 às 11:00" ou
 * "06/01/2027 às 09:00" (com o ano quando nao e o ano corrente da clinica).
 * Com `comEm`, a data leva "em" ("em 08/10 às 11:00"), para frases como
 * "Enviada em 08/10 às 09:02".
 */
export function quandoEmTexto(
  instanteIso: string,
  agora: number,
  fuso: string,
  opcoes: { comEm?: boolean } = {},
): string {
  const ms = instante(instanteIso);
  const hoje = diaCivil(fuso, new Date(agora));
  const dia = diaCivil(fuso, new Date(ms));
  const hora = horaLocal(ms, fuso);
  const dias = diasEntre(hoje, dia);
  if (dias === 0) {
    return `hoje às ${hora}`;
  }
  if (dias === 1) {
    return `amanhã às ${hora}`;
  }
  if (dias === -1) {
    return `ontem às ${hora}`;
  }
  return `${opcoes.comEm ? "em " : ""}${dataCurta(dia, hoje)} às ${hora}`;
}

/**
 * A linha de quando do item: "Sai hoje às 15:30", "Sai amanhã às 09:00",
 * "Sai em 08/10 às 11:00" ou "Sai em 06/01/2027 às 09:00" (ano quando nao e
 * o corrente da clinica). Dia que ja passou sai com a data, nunca "ontem".
 */
export function textoDeQuandoSai(
  enviarEm: string,
  agora: number,
  fuso: string,
): string {
  const ms = instante(enviarEm);
  const hoje = diaCivil(fuso, new Date(agora));
  const dia = diaCivil(fuso, new Date(ms));
  const hora = horaLocal(ms, fuso);
  const dias = diasEntre(hoje, dia);
  if (dias === 0) {
    return `Sai hoje às ${hora}`;
  }
  if (dias === 1) {
    return `Sai amanhã às ${hora}`;
  }
  return `Sai em ${dataCurta(dia, hoje)} às ${hora}`;
}

function diaDaSemana(local: TZDate): string {
  return format(local, "EEEE", { locale: ptBR }).replace("-feira", "");
}

/**
 * O mesmo quando, para o leitor de tela: "Sai na quarta, 6 de janeiro de
 * 2027, às 09:00" (o ano so quando nao e o corrente da clinica; "no" no
 * sabado e no domingo).
 */
export function textoAcessivelDeQuando(
  enviarEm: string,
  agora: number,
  fuso: string,
): string {
  const ms = instante(enviarEm);
  const local = new TZDate(ms, fuso);
  const hoje = diaCivil(fuso, new Date(agora));
  const dia = diaCivil(fuso, new Date(ms));
  const artigo = local.getDay() === 0 || local.getDay() === 6 ? "no" : "na";
  const diaEMes = format(local, "d 'de' MMMM", { locale: ptBR });
  const ano = anoDe(dia) === anoDe(hoje) ? "" : ` de ${anoDe(dia)}`;
  return `Sai ${artigo} ${diaDaSemana(local)}, ${diaEMes}${ano}, às ${horaLocal(ms, fuso)}`;
}

/**
 * A previa do dialogo: "Sai quarta, 06/01/2027, às 09:00, horário da clínica
 * (pode levar alguns minutos)." Sempre com o ano: e a confirmacao do que foi
 * digitado.
 */
export function textoDaPreviaDoAgendamento(
  enviarEm: string,
  fuso: string,
): string {
  const ms = instante(enviarEm);
  const local = new TZDate(ms, fuso);
  const dia = diaCivil(fuso, new Date(ms));
  return `Sai ${diaDaSemana(local)}, ${dataCompleta(dia)}, às ${horaLocal(ms, fuso)}, horário da clínica (pode levar alguns minutos).`;
}

/** O aviso de sucesso: "Mensagem agendada para 06/01/2027 às 09:00." */
export function textoDoSucessoDoAgendamento(
  enviarEm: string,
  fuso: string,
): string {
  const ms = instante(enviarEm);
  const dia = diaCivil(fuso, new Date(ms));
  return `Mensagem agendada para ${dataCompleta(dia)} às ${horaLocal(ms, fuso)}.`;
}

// ---------------------------------------------------------------------------
// Validacao da data, da hora e do texto
// ---------------------------------------------------------------------------

/** Os erros do dialogo e das Server Actions (textos exatos do desenho). */
export const ERROS_DA_AGENDADA = {
  semTexto: "Escreva a mensagem.",
  textoLongo: (tamanho: number) =>
    `A mensagem tem ${tamanho} caracteres e o limite é ${TEXTO_MAXIMO_DA_AGENDADA}. Encurte antes de agendar.`,
  semData: "Escolha a data.",
  semHora: "Escolha a hora.",
  horaPassada: "Essa hora já passou. Escolha outra.",
  depoisDoTeto: (dataMaxima: string) =>
    `Escolha uma data até ${dataMaxima}. Mais de 1 ano à frente não dá para agendar.`,
  semAutorizacao:
    "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar.",
  duplicada: "Já existe uma mensagem igual agendada para essa hora.",
  naoAgendou: "Não foi possível agendar. O texto continua aqui.",
  edicaoPerdeuACorrida:
    "Esta mensagem já começou a sair e a mudança não foi salva. Confira a conversa.",
  exclusaoPerdeuACorrida:
    "Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa.",
  jaNaFila: "Esta mensagem já está na fila para sair.",
  naoDisponivel: "Esta mensagem não está mais disponível.",
  /** Enviar agora: e CERTO que nada saiu; o texto volta para o campo. */
  enviarAgoraFalhou:
    "A mensagem não saiu e não está mais agendada. O texto voltou para o campo.",
  /**
   * Enviar agora: a mensagem PODE ter chegado (envio incerto, resposta do
   * provedor fora da lista das que garantem que nada saiu, excecao). O texto
   * NAO volta para o campo: reenviar poderia mandar duas vezes.
   */
  enviarAgoraIncerto:
    "Não deu para confirmar se a mensagem chegou ao paciente. Confira a conversa antes de mandar de novo.",
  /** Enviar agora de um texto acima do teto: recusa ANTES de retirar. */
  textoLongoParaEnviar: (tamanho: number) =>
    `A mensagem tem ${tamanho} caracteres e o limite é ${TEXTO_MAXIMO_DA_AGENDADA}. Encurte antes de enviar.`,
} as const;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** O dia mais distante que pode ser escolhido: hoje + 12 meses, dia civil. */
export function dataMaximaDaAgendada(hoje: string): string {
  return somarMeses(hoje, HORIZONTE_EM_MESES);
}

/** min e max do campo Data (aaaa-mm-dd no fuso da clinica). */
export function limitesDaData(hoje: string): { min: string; max: string } {
  return { min: hoje, max: dataMaximaDaAgendada(hoje) };
}

/**
 * Data (aaaa-mm-dd) e hora (HH:mm) digitadas, no fuso da clinica, para o
 * instante a gravar. Recusa formato invalido, hora que ja passou e dia depois
 * do teto (hoje + 12 meses pelo dia civil da clinica, o dia do teto inteiro
 * vale). E o mesmo criterio do gatilho proteger_mensagem_agendada.
 */
export function validarQuando(params: {
  data: string;
  hora: string;
  agora: number;
  fuso: string;
}): { ok: true; enviarEm: string } | { ok: false; erro: string } {
  const data = params.data.trim();
  const hora = params.hora.trim();
  if (!data || !ehDiaValido(data)) {
    return { ok: false, erro: ERROS_DA_AGENDADA.semData };
  }
  if (!hora || !HORA.test(hora)) {
    return { ok: false, erro: ERROS_DA_AGENDADA.semHora };
  }
  const enviarEm = instanteLocal(params.fuso, data, hora);
  if (!Number.isFinite(enviarEm.getTime())) {
    return { ok: false, erro: ERROS_DA_AGENDADA.semData };
  }
  if (enviarEm.getTime() <= params.agora) {
    return { ok: false, erro: ERROS_DA_AGENDADA.horaPassada };
  }
  const hoje = diaCivil(params.fuso, new Date(params.agora));
  const teto = dataMaximaDaAgendada(hoje);
  if (diaCivil(params.fuso, enviarEm) > teto) {
    return {
      ok: false,
      erro: ERROS_DA_AGENDADA.depoisDoTeto(dataCompleta(teto)),
    };
  }
  return { ok: true, enviarEm: enviarEm.toISOString() };
}

/**
 * Caracteres em unidades UTF-16 (texto.length): a regua do envio 1:1 e do
 * compositor (TEXTO_MAXIMO_DA_AGENDADA). Um emoji conta 2. Contar pontos de
 * codigo, como o Postgres, deixava agendar um texto que o "Enviar agora"
 * recusava depois de retirar a agendada.
 */
export function tamanhoDoTexto(texto: string): number {
  return texto.length;
}

/** null quando o texto serve; senao, a frase do erro. */
export function problemaNoTexto(texto: string): string | null {
  const aparado = texto.trim();
  if (!aparado) {
    return ERROS_DA_AGENDADA.semTexto;
  }
  const tamanho = tamanhoDoTexto(aparado);
  if (tamanho > TEXTO_MAXIMO_DA_AGENDADA) {
    return ERROS_DA_AGENDADA.textoLongo(tamanho);
  }
  return null;
}

/** Os atalhos de "Quando": so mudam a data; meses no dia civil da clinica. */
export function atalhosDeData(
  hoje: string,
): { rotulo: string; data: string }[] {
  return [
    { rotulo: "Amanhã", data: somarDias(hoje, 1) },
    { rotulo: "Em 7 dias", data: somarDias(hoje, 7) },
    { rotulo: "Em 30 dias", data: somarDias(hoje, 30) },
    { rotulo: "Em 3 meses", data: somarMeses(hoje, 3) },
    { rotulo: "Em 6 meses", data: somarMeses(hoje, 6) },
  ];
}

// ---------------------------------------------------------------------------
// Textos do item
// ---------------------------------------------------------------------------

/**
 * O motivo da nao enviada em linguagem de recepcao ("Não enviada:
 * {motivo}."). O codigo nunca aparece: motivo desconhecido vira "erro do
 * sistema no envio".
 */
export function textoDoMotivo(
  motivo: string | null,
  nomes: { contato: string | null; numero: string | null },
): string {
  const contato = nomes.contato?.trim() || "o contato";
  const numero = nomes.numero?.trim()
    ? `o número ${nomes.numero.trim()}`
    : "o número";
  switch (motivo) {
    case "sem_autorizacao":
      return `${contato} não autoriza receber mensagens`;
    case "numero_removido":
      return `${numero} foi removido da clínica`;
    case "numero_desconectado":
      return `${numero} ficou desconectado por mais de 12 horas`;
    case "atrasou":
      return "o envio atrasou mais de 12 horas";
    case "madrugada":
      return "o envio atrasou e cairia de madrugada";
    case "canal_ocupado":
      return "o número ficou ocupado com outros envios por tempo demais";
    default:
      return "erro do sistema no envio";
  }
}

const NOME_DESCONHECIDO = "Pessoa da equipe";

function nomeDaPessoa(
  userId: string,
  nomes: Record<string, string>,
  viewerId: string,
): string {
  if (userId === viewerId) {
    return "você";
  }
  return nomes[userId]?.trim() || NOME_DESCONHECIDO;
}

/**
 * "Agendada por Ana" ou "Agendada por Ana, editada por Bruno" ("você" para
 * quem ve). Com a lista de membros com escrita, o assinante que saiu da
 * equipe (ou virou Somente leitura) ganha "(sem acesso)": a mensagem sai em
 * nome dele e a conversa fica Sem atendente.
 */
export function assinaturaDoItem(
  a: Pick<AgendadaDaLista, "criadaPor" | "editadaPor">,
  nomes: Record<string, string>,
  viewerId: string,
  membrosComEscrita?: readonly string[],
): string {
  const assinante = assinanteDaAgendada(a);
  const nome = (userId: string) => {
    const base = nomeDaPessoa(userId, nomes, viewerId);
    const semAcesso =
      userId === assinante &&
      userId !== viewerId &&
      membrosComEscrita !== undefined &&
      !membrosComEscrita.includes(userId);
    return semAcesso ? `${base} (sem acesso)` : base;
  };
  if (a.editadaPor === null || a.editadaPor === a.criadaPor) {
    return `Agendada por ${nome(a.criadaPor)}`;
  }
  return `Agendada por ${nome(a.criadaPor)}, editada por ${nome(a.editadaPor)}`;
}

/**
 * A autoria da bolha da mensagem que saiu de uma agendada (A1). O nome da
 * linha e o de quem assina (author_user_id da mensagem).
 */
export function autoriaDaBolha(
  a: { criadaPor: string; editadaPor: string | null },
  nomes: Record<string, string>,
): { linha: string; acessivel: string } {
  const criou = nomes[a.criadaPor]?.trim() || NOME_DESCONHECIDO;
  if (a.editadaPor === null || a.editadaPor === a.criadaPor) {
    return {
      linha: `${criou} · Mensagem agendada`,
      acessivel: `Mensagem agendada por ${criou}, enviada sozinha na hora marcada.`,
    };
  }
  const editou = nomes[a.editadaPor]?.trim() || NOME_DESCONHECIDO;
  return {
    linha: `${editou} · Mensagem agendada (criada por ${criou})`,
    acessivel: `Mensagem agendada por ${criou}, editada por ${editou}, enviada sozinha na hora marcada.`,
  };
}

/** Descricao do dialogo de edicao (A1). */
export function descricaoDaEdicao(
  a: Pick<AgendadaDaLista, "criadaPor" | "editadaPor">,
  viewerId: string,
): string {
  return assinanteDaAgendada(a) === viewerId
    ? "Mude o texto, a data ou a hora. A mensagem continua marcada."
    : "Mude o texto, a data ou a hora. A mensagem continua marcada e passa a sair em seu nome.";
}

/** Descricao do dialogo de agendar, com o numero quando a clinica tem mais de um. */
export function descricaoDoAgendamento(nomeDoNumero: string | null): string {
  return nomeDoNumero?.trim()
    ? `Sai sozinha na data e hora escolhidas, em seu nome, pelo número ${nomeDoNumero.trim()}.`
    : "Sai sozinha na data e hora escolhidas, em seu nome, pelo WhatsApp da clínica.";
}

/**
 * "hoje às 21:00", "amanhã às 02:00"...: ate quando o numero precisa
 * reconectar para a agendada ainda sair (prazoEfetivoDaAgendada, com a
 * regra da madrugada).
 */
function textoDoPrazoEfetivo(
  enviarEm: string,
  agora: number,
  fuso: string,
): string {
  const limite = prazoEfetivoDaAgendada(enviarEm, fuso);
  return Number.isFinite(limite)
    ? quandoEmTexto(new Date(limite).toISOString(), agora, fuso)
    : quandoEmTexto(enviarEm, agora, fuso);
}

/**
 * A linha do item conforme o estado (null em Agendada: a linha de quando
 * basta).
 */
export function linhaDoEstadoDoItem(
  a: AgendadaDaLista,
  estado: EstadoDoItemDaAgendada,
  params: {
    ctx: ContextoDaListaDeAgendadas;
    agora: number;
    fuso: string;
    contato: string | null;
  },
): string | null {
  const { ctx, agora, fuso } = params;
  const numero = ctx.conexaoPorNumero[a.whatsappAccountId]?.nome ?? null;
  switch (estado) {
    case "agendada":
      return null;
    case "na_fila":
      return `Marcada para ${quandoEmTexto(a.enviarEm, agora, fuso)}. Pode levar alguns minutos.`;
    case "silencio_noturno":
      return `Atrasou e vai sair às ${horaCheia(SILENCIO_FIM_HORA)}, para não chegar de madrugada.`;
    case "esperando_numero": {
      const nome = numero?.trim() ? `o número ${numero.trim()}` : "o número";
      return `Marcada para ${quandoEmTexto(a.enviarEm, agora, fuso)}. Se ${nome} não reconectar até ${textoDoPrazoEfetivo(a.enviarEm, agora, fuso)}, a mensagem não sai.`;
    }
    case "enviada":
      return `Enviada ${quandoEmTexto(a.enviadaEm ?? a.enviarEm, agora, fuso, { comEm: true })}`;
    case "nao_enviada":
      return `Não enviada: ${textoDoMotivo(a.motivo, { contato: params.contato, numero })}.`;
    case "nao_confirmada":
      return "A mensagem pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.";
  }
}

/**
 * A linha da atividade criada quando a agendada nao saiu (A3), so em Nao
 * enviada. A responsavel e o assinante quando ele ainda e membro ativo com
 * escrita; senao a atividade fica sem responsavel.
 */
export function linhaDaAtividade(
  a: Pick<AgendadaDaLista, "criadaPor" | "editadaPor">,
  estado: EstadoDoItemDaAgendada,
  params: {
    nomes: Record<string, string>;
    viewerId: string;
    membrosComEscrita: readonly string[];
  },
): string | null {
  if (estado !== "nao_enviada") {
    return null;
  }
  const assinante = assinanteDaAgendada(a);
  if (!params.membrosComEscrita.includes(assinante)) {
    return "Uma atividade foi criada para a equipe conferir.";
  }
  return `Uma atividade foi criada para ${nomeDaPessoa(assinante, params.nomes, params.viewerId)} conferir.`;
}

export type AvisoDoItem = {
  chave: "escreveu_depois" | "numero_desconectado";
  texto: string;
};

/**
 * Os avisos do item (CircleAlert, warning): o paciente escreveu depois de
 * agendada, e o numero desconectado antes da hora (com o limite real da
 * reconexao, prazoEfetivoDaAgendada, no fuso da clinica).
 */
export function avisosDoItem(
  a: AgendadaDaLista,
  estado: EstadoDoItemDaAgendada,
  params: {
    ctx: ContextoDaListaDeAgendadas;
    contato: string | null;
    agora: number;
    fuso: string;
  },
): AvisoDoItem[] {
  const avisos: AvisoDoItem[] = [];
  if (estaAntesDoEnvio(estado) && pacienteEscreveuDepois(a, params.ctx)) {
    const contato = params.contato?.trim() || "O contato";
    avisos.push({
      chave: "escreveu_depois",
      texto: `${contato} escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido.`,
    });
  }
  if (estado === "agendada" && numeroDesconectado(a, params.ctx)) {
    const nome = params.ctx.conexaoPorNumero[a.whatsappAccountId]?.nome.trim();
    avisos.push({
      chave: "numero_desconectado",
      texto: `O número${nome ? ` ${nome}` : ""} está desconectado. Se não reconectar até ${textoDoPrazoEfetivo(a.enviarEm, params.agora, params.fuso)}, a mensagem não sai.`,
    });
  }
  return avisos;
}

/**
 * O resumo da lista com 2 ou mais itens: "{n} mensagens agendadas. A
 * próxima sai amanhã às 09:00." A proxima e a mais cedo entre as que ainda
 * vao sair.
 */
export function resumoDaLista(
  itens: readonly { enviarEm: string; estado: EstadoDoItemDaAgendada }[],
  agora: number,
  fuso: string,
): string {
  const quantidade = `${itens.length} ${itens.length === 1 ? "mensagem agendada" : "mensagens agendadas"}.`;
  let proxima: string | null = null;
  for (const item of itens) {
    if (!estaAntesDoEnvio(item.estado)) {
      continue;
    }
    if (proxima === null || instante(item.enviarEm) < instante(proxima)) {
      proxima = item.enviarEm;
    }
  }
  if (proxima === null) {
    return quantidade;
  }
  return `${quantidade} A próxima sai ${quandoEmTexto(proxima, agora, fuso, { comEm: true })}.`;
}
