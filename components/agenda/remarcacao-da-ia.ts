import {
  dataCurtaNaClinica,
  horaNaClinica,
} from "@/components/atendimento/fuso-da-clinica";
import type { AppointmentStatus } from "@/lib/design/status";
import {
  STATUS_DE_CANCELAMENTO,
  STATUS_QUE_VOLTAM_A_CONFIRMAR,
} from "@/lib/domain/appointment-status";
import type {
  AntigaDaRemarcacao,
  ConsultaDaAgenda,
} from "@/lib/queries/agenda";

// Remarcacao pedida pela IA na Agenda (AG4, decisao D-10 do dono; desenho da
// AG4, secao 5; D-28 e D-32 pela recomendacao, pendentes do dono): os textos
// do cartao do "Pendente de voce", dos dialogos "Aprovar a remarcação?" e
// "Recusar a remarcação?", do menu da consulta (a nova e a antiga) e dos
// retornos das acoes. Modulo PURO (sem "use client"): a tela e as Server
// Actions (app/(app)/agenda/actions.ts) dizem a mesma coisa, sempre no fuso
// da clinica (CLAUDE.md 3.6). Sem travessao; linguagem de recepcionista.
//
// A remarcacao e uma consulta NOVA, pendente e ligada a antiga
// (appointment.remarcacao_de). A antiga continua valendo ate a aprovacao:
// aprovar cancela a antiga pelo gatilho do banco (remarcacao_na_aprovacao) e
// o horario dela volta a lista de espera, se houver e se ainda for futuro;
// recusar cancela so a nova, e a conversa volta para a equipe avisar o
// paciente. Enquanto pendente, a antiga nao se move (D-32, gatilho
// remarcacao_pendente_trava_a_antiga).

/**
 * Onde a antiga esta: "viva" (numa das quatro situacoes antes do
 * atendimento: a aprovacao a cancela), "cancelada" (cancelada nesse meio:
 * a aprovacao nao mexe nela) ou "encerrada" (na recepcao, em atendimento,
 * compareceu ou faltou: o gatilho recusa a aprovacao, e a recusa nao diz
 * que ela "continua marcada", como o evento do banco).
 */
export type SituacaoDaAntiga = "viva" | "cancelada" | "encerrada";

export function situacaoDaAntiga(status: AppointmentStatus): SituacaoDaAntiga {
  if (STATUS_QUE_VOLTAM_A_CONFIRMAR.includes(status)) {
    return "viva";
  }
  return STATUS_DE_CANCELAMENTO.includes(status) ? "cancelada" : "encerrada";
}

/** "29/10 às 14:00", no fuso da clínica. */
export function quandoNaClinica(instante: string, fuso: string): string {
  return `${dataCurtaNaClinica(instante, fuso)} às ${horaNaClinica(instante, fuso)}`;
}

/** "29/10 · 14:00", o formato do cartão do "Pendente de você". */
export function quandoNoCartao(instante: string, fuso: string): string {
  return `${dataCurtaNaClinica(instante, fuso)} · ${horaNaClinica(instante, fuso)}`;
}

export const TEXTOS_DA_REMARCACAO = {
  chip: "Remarcação pela IA",
  grupoDoMenu: "Remarcação pela IA",
  aprovarNoMenu: "Aprovar remarcação",
  recusarNoMenu: "Recusar remarcação",
  aprovarTitulo: "Aprovar a remarcação?",
  recusarTitulo: "Recusar a remarcação?",
  voltar: "Voltar",
  aprovar: "Aprovar remarcação",
  aprovando: "Aprovando...",
  recusar: "Recusar remarcação",
  recusando: "Recusando...",
  jaTratada: "Esta remarcação já foi tratada.",
  jaCancelada: "(já cancelada)",
  /** A dica do "Remarcar" e do arrastar na antiga (a do gatilho, D-32). */
  dicaDaAntiga:
    "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.",
  naoAprovou: "Não foi possível aprovar. Tente de novo.",
  naoRecusou: "Não foi possível recusar. Tente de novo.",
  semConferir: "Não foi possível conferir esta remarcação. Tente de novo.",
  /**
   * A recusa valeu, mas a conversa nao voltou. Autocontidos (revisao da
   * AG4, achado 5): nos caminhos de defesa (o Recusar e o Cancelar de
   * antes) a tela mostra so este aviso, entao ele mesmo diz que a
   * remarcacao foi recusada, como os da consulta marcada pela IA.
   */
  conversaNaoDevolvida:
    "A remarcação foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
  conversaNaoEncontrada:
    "A remarcação foi recusada, mas a conversa do paciente não foi encontrada. Avise o paciente pelo Atendimento.",
  /**
   * A antiga nao carregou (a leitura dela falhou): o cartao do "Pendente
   * de você" e os dialogos dizem isso; o resto da Agenda abre normalmente.
   */
  antigaNaoCarregada: "Não foi possível carregar a consulta antiga.",
  antigaNaoCarregadaNoDialogo:
    "Não foi possível carregar a consulta antiga. Ela é conferida de novo quando você confirmar.",
  /** Confirmações: "Manter o horário" com a remarcação da IA pendente. */
  manterHorarioComRemarcacao:
    "Há uma remarcação pedida pela IA esperando aprovação na Agenda.",
} as const;

/** O pedaço da consulta nova que os textos usam. */
export type RemarcacaoNosTextos = Pick<ConsultaDaAgenda, "starts_at"> & {
  antiga?: Pick<AntigaDaRemarcacao, "starts_at" | "status"> | null;
  erroNaAntiga?: boolean;
};

/**
 * A antiga nao veio: a leitura dela falhou (erroNaAntiga) ou a consulta nao
 * e a da lista do "Pendente de você" (a do dia nao traz a antiga). Diferente
 * da antiga nula de verdade (a RLS nao deixou ler), que so omite o "De".
 */
export function antigaNaoCarregada(consulta: RemarcacaoNosTextos): boolean {
  return consulta.erroNaAntiga === true || consulta.antiga === undefined;
}

/**
 * As duas linhas de horário do cartão: "De 29/10 · 14:00" (com "(já
 * cancelada)" quando a antiga foi cancelada nesse meio) e "Para 03/11 ·
 * 10:00". Sem a antiga (a RLS não deixou ler), só o "Para". A antiga que
 * não carregou também fica sem o "De", e `naoCarregada` pede o aviso.
 */
export function linhasDoCartaoDaRemarcacao(
  consulta: RemarcacaoNosTextos,
  fuso: string,
): { de: string | null; para: string; naoCarregada: boolean } {
  const para = `Para ${quandoNoCartao(consulta.starts_at, fuso)}`;
  const naoCarregada = antigaNaoCarregada(consulta);
  if (!consulta.antiga) {
    return { de: null, para, naoCarregada };
  }
  const de = `De ${quandoNoCartao(consulta.antiga.starts_at, fuso)}`;
  return {
    de:
      situacaoDaAntiga(consulta.antiga.status) === "cancelada"
        ? `${de} ${TEXTOS_DA_REMARCACAO.jaCancelada}`
        : de,
    para,
    naoCarregada,
  };
}

/**
 * Revisao da AG4 (achado 8, da revisao do banco): a aprovacao cancela a
 * antiga como "Cancelado pelo paciente" mesmo no passado. Se a antiga ja
 * passou e continua numa das quatro situacoes antes do atendimento (sem
 * presenca nem falta marcada), o paciente pode ter ido ou faltado: o
 * "Aprovar a remarcação?" avisa, e o Aprovar continua (a decisao e da
 * recepcao). Nulo quando nao ha o que avisar.
 */
export function avisoDaAntigaQueJaPassou(
  consulta: RemarcacaoNosTextos,
  fuso: string,
  agoraMs: number,
): string | null {
  const antiga = consulta.antiga;
  if (
    !antiga ||
    situacaoDaAntiga(antiga.status) !== "viva" ||
    new Date(antiga.starts_at).getTime() > agoraMs
  ) {
    return null;
  }
  return `A consulta de ${quandoNaClinica(antiga.starts_at, fuso)} já passou. Confira se o paciente compareceu antes de aprovar.`;
}

/**
 * O texto do "Aprovar a remarcação?". A antiga é cancelada e o horário dela
 * volta a ser oferecido à lista de espera só se ainda for futuro (a
 * reoferta do banco não oferece horário que já passou); já cancelada, nada
 * muda nela. Com a antiga já atendida, o texto só diz o que a IA pediu: o
 * diálogo mostra o erro do gatilho e trava o Aprovar.
 */
export function textoDoAprovar(
  consulta: RemarcacaoNosTextos,
  fuso: string,
  agoraMs: number,
): string {
  const nova = quandoNaClinica(consulta.starts_at, fuso);
  const antiga = consulta.antiga;
  if (!antiga) {
    return `A consulta passa para ${nova}, e a consulta antiga é cancelada.`;
  }
  const quandoAntiga = quandoNaClinica(antiga.starts_at, fuso);
  const situacao = situacaoDaAntiga(antiga.status);
  if (situacao === "cancelada") {
    return `A consulta de ${quandoAntiga} já foi cancelada. Ao aprovar, fica marcada a de ${nova}.`;
  }
  if (situacao === "encerrada") {
    return `A IA pediu a remarcação da consulta de ${quandoAntiga} para ${nova}.`;
  }
  const diaAntiga = dataCurtaNaClinica(antiga.starts_at, fuso);
  const aindaFutura = new Date(antiga.starts_at).getTime() > agoraMs;
  return aindaFutura
    ? `A consulta passa de ${quandoAntiga} para ${nova}. A de ${diaAntiga} é cancelada e o horário volta a ser oferecido à lista de espera, se houver.`
    : `A consulta passa de ${quandoAntiga} para ${nova}. A de ${diaAntiga} é cancelada.`;
}

/** O texto do "Recusar a remarcação?". */
export function textoDoRecusar(
  consulta: RemarcacaoNosTextos,
  fuso: string,
): string {
  const nova = quandoNaClinica(consulta.starts_at, fuso);
  const antiga = consulta.antiga;
  const fim = "e a conversa volta para a equipe avisar o paciente.";
  if (!antiga) {
    return `A consulta de ${nova} é cancelada. A consulta antiga continua marcada, ${fim}`;
  }
  const quandoAntiga = quandoNaClinica(antiga.starts_at, fuso);
  const situacao = situacaoDaAntiga(antiga.status);
  if (situacao === "cancelada") {
    return `A consulta de ${nova} é cancelada. A de ${quandoAntiga} já foi cancelada, ${fim}`;
  }
  if (situacao === "encerrada") {
    return `A consulta de ${nova} é cancelada, ${fim}`;
  }
  return `A consulta de ${nova} é cancelada. A de ${quandoAntiga} continua marcada, ${fim}`;
}

/** A antiga como o servidor leu do banco, antes de aprovar ou recusar. */
export type AntigaLida = {
  starts_at: string;
  situacao: SituacaoDaAntiga;
} | null;

/** O pedido de sempre quando nenhuma mensagem automatica sai ao paciente. */
const AVISE_PELO_ATENDIMENTO = "Avise o paciente pelo Atendimento.";

/**
 * O sucesso de aprovar, com o horário da antiga lido do banco. Revisao da
 * AG4 (achado 4): sem o aviso pelo WhatsApp (a caixa desmarcada, ou o
 * caminho antigo do Aprovar, que nao manda aviso), pede para avisar pelo
 * Atendimento, como a aprovacao da consulta marcada pela IA. Com o aviso
 * pedido, nao: ou ele saiu, ou a atencao do que nao saiu ja diz o que fazer.
 */
export function sucessoDoAprovar(
  antiga: AntigaLida,
  fuso: string,
  comAvisoAoPaciente: boolean,
): string {
  const fim = comAvisoAoPaciente ? "" : ` ${AVISE_PELO_ATENDIMENTO}`;
  if (!antiga || antiga.situacao === "encerrada") {
    return `Remarcação aprovada.${fim}`;
  }
  const quando = quandoNaClinica(antiga.starts_at, fuso);
  return antiga.situacao === "cancelada"
    ? `Remarcação aprovada. A consulta de ${quando} já estava cancelada.${fim}`
    : `Remarcação aprovada. A consulta de ${quando} foi cancelada.${fim}`;
}

/**
 * O sucesso de recusar, com o horário da antiga lido do banco. Só diz
 * "continua marcada" quando ela continua (o mesmo cuidado do evento que o
 * banco grava no fio). Revisao da AG4 (achado 9, D-29): a antiga que
 * continua fica com o pedido de remarcação, e a confirmação automática dela
 * para até alguém usar "Manter o horário" em Confirmações; o sucesso diz.
 */
export function sucessoDoRecusar(antiga: AntigaLida, fuso: string): string {
  const fim = AVISE_PELO_ATENDIMENTO;
  if (!antiga || antiga.situacao === "encerrada") {
    return `Remarcação recusada. ${fim}`;
  }
  const quando = quandoNaClinica(antiga.starts_at, fuso);
  return antiga.situacao === "cancelada"
    ? `Remarcação recusada. A consulta de ${quando} já estava cancelada. ${fim}`
    : `Remarcação recusada. A consulta de ${quando} continua marcada, com o pedido de remarcação: a confirmação automática fica parada até Manter o horário, em Confirmações. ${fim}`;
}

/**
 * O 23514 remarcacao_consulta_antiga_encerrada do gatilho da aprovação: a
 * antiga já está na recepção, em atendimento, compareceu ou faltou, e a
 * aprovação não aconteceu.
 */
export function erroDaAntigaEncerrada(
  antigaInicio: string | null,
  fuso: string,
): string {
  const qual = antigaInicio
    ? `A consulta de ${quandoNaClinica(antigaInicio, fuso)}`
    : "A consulta antiga";
  return `${qual} já foi atendida ou teve a falta marcada. Recuse esta remarcação e fale com o paciente.`;
}

/** A linha do menu da antiga: "Remarcação pedida pela IA para 03/11 às 10:00". */
export function linhaDaAntigaNoMenu(novaInicio: string, fuso: string): string {
  return `Remarcação pedida pela IA para ${quandoNaClinica(novaInicio, fuso)}`;
}

export type AcaoDaRemarcacao = "aprovar" | "recusar";

/** Um toast, como o painel mostra (o mesmo formato de RetornoNaTela). */
export type AvisoDaRemarcacao = {
  tipo: "success" | "info" | "warning" | "error";
  texto: string;
};

/**
 * O que o dialogo faz depois da acao:
 * - deu certo: fecha e mostra o sucesso (o texto do servidor, com o horario
 *   da antiga lido do banco) e, se algo pedido junto nao aconteceu (o aviso
 *   ao paciente que nao saiu, a conversa que nao voltou), a atencao logo
 *   depois, nunca no lugar do sucesso;
 * - ja tratada por outra pessoa: fecha e informa;
 * - a antiga ja atendida (23514 do gatilho): fica aberto com o erro e
 *   trava o "Aprovar remarcação" (tentar de novo nao muda nada; o caminho e
 *   recusar);
 * - outro erro: fica aberto com o erro, para tentar de novo.
 */
export type DesfechoDaRemarcacao =
  | { fechar: true; avisos: AvisoDaRemarcacao[] }
  | { fechar: false; erro: string; travar: boolean };

export function desfechoDaRemarcacao(
  resultado: {
    ok: boolean;
    error?: string;
    code?: string;
    aviso?: string;
    mensagem?: string;
  },
  acao: AcaoDaRemarcacao,
): DesfechoDaRemarcacao {
  if (resultado.ok) {
    const sucesso =
      resultado.mensagem ??
      (acao === "aprovar"
        ? "Remarcação aprovada."
        : "Remarcação recusada. Avise o paciente pelo Atendimento.");
    return {
      fechar: true,
      avisos: [
        { tipo: "success", texto: sucesso },
        ...(resultado.aviso
          ? [{ tipo: "warning" as const, texto: resultado.aviso }]
          : []),
      ],
    };
  }
  if (resultado.code === "ja_tratado") {
    return {
      fechar: true,
      avisos: [
        {
          tipo: "info",
          texto: resultado.error ?? TEXTOS_DA_REMARCACAO.jaTratada,
        },
      ],
    };
  }
  if (resultado.code === "remarcacao_antiga_encerrada") {
    return {
      fechar: false,
      erro: resultado.error ?? erroDaAntigaEncerrada(null, "UTC"),
      travar: true,
    };
  }
  return {
    fechar: false,
    erro:
      resultado.error ??
      (acao === "aprovar"
        ? TEXTOS_DA_REMARCACAO.naoAprovou
        : TEXTOS_DA_REMARCACAO.naoRecusou),
    travar: false,
  };
}
