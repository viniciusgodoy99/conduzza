import type { EnviarAgendadaAgoraResult } from "@/app/(app)/atendimento/agendadas-actions";
import type { SituacaoDaAgendada } from "@/lib/domain/mensagem-agendada";

// O que a tela faz com a resposta do "Enviar agora" de uma agendada (secao
// 4.4 do desenho, com os achados 1, 24 e 38 da revisao). Puro: a lista e o
// InboxClient so executam o plano.
//
// Tres certezas diferentes, e cada uma pede uma coisa:
// - SAIU: a bolha aparece no fio, o item sai da lista.
// - CERTO QUE NADA SAIU (a agendada ja foi retirada): o texto volta para o
//   campo, nunca se perde.
// - PODE TER SAIDO (envio incerto, resposta do provedor, excecao): o texto
//   NAO volta. Devolver levava a mandar duas vezes. A tela manda conferir a
//   conversa e recarrega o fio e a lista.
// Sem resposta nenhuma (a rede caiu), a lista rele antes de decidir: se a
// agendada continua marcada, nada mudou; se ela saiu da lista, o texto volta
// com o aviso de que o envio nao foi confirmado.
//
// Nenhum texto de paciente sai daqui para log: so para o campo ou para a
// area de transferencia, por gesto da pessoa.

/** Falha de rede com a agendada fora da lista (achado 24). */
export const AVISO_DE_ENVIO_SEM_CONFIRMACAO =
  "Não foi possível confirmar o envio. Confira a conversa antes de mandar de novo.";

/** Falha de rede com a agendada ainda marcada: nada mudou. */
export const AVISO_DE_CONTINUA_AGENDADA =
  "Não foi possível falar com o servidor. A mensagem continua agendada.";

/** Falha de rede com a agendada em outro estado (na fila, enviada...). */
export const AVISO_DE_CONFERIR_A_LISTA =
  "Não foi possível falar com o servidor. Confira a lista e a conversa antes de tentar de novo.";

export type CertezaDaDevolucao = "nao_saiu" | "incerto";

/** O texto que volta para o campo, e com qual certeza. */
export type DevolucaoDoTexto = {
  texto: string;
  /** A frase do aviso (toast) */
  aviso: string;
  certeza: CertezaDaDevolucao;
};

export type DesfechoDoEnviarAgora =
  | { tipo: "saiu"; conversationId: string }
  /** A agendada foi retirada e e certo que nada saiu: o texto volta */
  | { tipo: "devolver"; devolucao: DevolucaoDoTexto }
  /** A agendada foi retirada e a mensagem pode ter chegado: sem o texto */
  | { tipo: "incerto"; aviso: string }
  /** Nada mudou (ou nao da para afirmar o que mudou): o aviso no dialogo */
  | { tipo: "recusado"; aviso: string };

/** A resposta da Server Action, em plano de tela. */
export function desfechoDoEnviarAgora(
  resultado: EnviarAgendadaAgoraResult,
): DesfechoDoEnviarAgora {
  if (resultado.ok) {
    return { tipo: "saiu", conversationId: resultado.conversationId };
  }
  // `incerto` vence o texto: mesmo que os dois viessem juntos, oferecer o
  // texto para mandar de novo e o que nao pode acontecer.
  if (resultado.incerto === true) {
    return { tipo: "incerto", aviso: resultado.error };
  }
  if (typeof resultado.texto === "string" && resultado.texto.trim() !== "") {
    return {
      tipo: "devolver",
      devolucao: {
        texto: resultado.texto,
        aviso: resultado.error,
        certeza: "nao_saiu",
      },
    };
  }
  return { tipo: "recusado", aviso: resultado.error };
}

export type DesfechoDaFalhaDeRede =
  | { tipo: "devolver"; devolucao: DevolucaoDoTexto }
  | { tipo: "incerto"; aviso: string }
  | { tipo: "recusado"; aviso: string };

/**
 * A Server Action nao respondeu (rede, tempo esgotado). `releitura` e o que a
 * lista leu DEPOIS da falha: null quando a releitura tambem falhou; com
 * `situacao` null quando a agendada nao esta mais na lista (foi retirada para
 * o envio, ou cancelada). `texto` e o do item, que a lista ja tinha.
 */
export function desfechoDaFalhaDeRede(params: {
  releitura: { situacao: SituacaoDaAgendada | null } | null;
  texto: string | null;
}): DesfechoDaFalhaDeRede {
  const situacao = params.releitura?.situacao ?? null;
  if (params.releitura !== null && situacao === "agendada") {
    // O pedido nao chegou a retirar: ela sai sozinha na hora marcada.
    return { tipo: "recusado", aviso: AVISO_DE_CONTINUA_AGENDADA };
  }
  if (params.releitura !== null && situacao !== null) {
    // Seguiu o proprio caminho (na fila, enviada, nao enviada): o item conta.
    return { tipo: "recusado", aviso: AVISO_DE_CONFERIR_A_LISTA };
  }
  // Fora da lista, ou sem como saber: o texto nao pode se perder, e o aviso
  // manda conferir a conversa antes de mandar de novo.
  const texto = params.texto?.trim() ? params.texto : null;
  if (!texto) {
    return { tipo: "incerto", aviso: AVISO_DE_ENVIO_SEM_CONFIRMACAO };
  }
  return {
    tipo: "devolver",
    devolucao: {
      texto,
      aviso: AVISO_DE_ENVIO_SEM_CONFIRMACAO,
      certeza: "incerto",
    },
  };
}

export type PlanoDaDevolucao =
  | {
      /** O texto vai para o campo da resposta ao paciente */
      tipo: "no_campo";
      texto: string;
      /** O campo estava numa nota interna vazia: volta para a resposta */
      voltarParaResposta: boolean;
      aviso: string;
      certeza: CertezaDaDevolucao;
    }
  | {
      /** O campo nao pode receber: o aviso oferece copiar a mensagem */
      tipo: "copiar";
      titulo: string;
      descricao: string;
      texto: string;
      certeza: CertezaDaDevolucao;
    };

/**
 * Para onde vai o texto devolvido. Campo vazio da mesma conversa recebe o
 * texto (na resposta ao paciente); resposta em andamento ganha o texto no
 * fim. Nota interna com rascunho NAO troca de plano (o texto iria para o
 * lugar errado), e outra conversa aberta nao recebe texto de outro paciente:
 * nos dois casos o aviso diz PARA QUEM era a mensagem e oferece copiar
 * (achado 38: sem o nome, o texto podia ser colado na conversa errada).
 */
export function planoDaDevolucao(params: {
  devolucao: DevolucaoDoTexto;
  /** Nome do contato da agendada, ou o telefone formatado */
  contato: string | null;
  /** A tela ainda esta na conversa de onde o Enviar agora saiu */
  mesmaConversa: boolean;
  rascunho: { texto: string; modo: "responder" | "nota" };
}): PlanoDaDevolucao {
  const { devolucao, mesmaConversa, rascunho } = params;
  if (mesmaConversa && rascunho.texto.trim() === "") {
    return {
      tipo: "no_campo",
      texto: devolucao.texto,
      voltarParaResposta: rascunho.modo === "nota",
      aviso: devolucao.aviso,
      certeza: devolucao.certeza,
    };
  }
  if (mesmaConversa && rascunho.modo === "responder") {
    return {
      tipo: "no_campo",
      texto: `${rascunho.texto}\n\n${devolucao.texto}`,
      voltarParaResposta: false,
      aviso: devolucao.aviso,
      certeza: devolucao.certeza,
    };
  }
  const quem = params.contato?.trim() || "o contato";
  const titulo =
    devolucao.certeza === "nao_saiu"
      ? `A mensagem para ${quem} não saiu e não está mais agendada.`
      : `Não foi possível confirmar o envio da mensagem para ${quem}.`;
  const descricao = mesmaConversa
    ? devolucao.certeza === "nao_saiu"
      ? "Há outro texto no campo. Copie a mensagem e cole na resposta ao paciente."
      : "Confira a conversa antes de mandar de novo. Se a mensagem não estiver lá, copie e cole na resposta ao paciente."
    : devolucao.certeza === "nao_saiu"
      ? `Copie a mensagem e cole na resposta para ${quem}.`
      : `Confira a conversa de ${quem} antes de mandar de novo. Se a mensagem não estiver lá, copie e cole na resposta para ${quem}.`;
  return {
    tipo: "copiar",
    titulo,
    descricao,
    texto: devolucao.texto,
    certeza: devolucao.certeza,
  };
}
