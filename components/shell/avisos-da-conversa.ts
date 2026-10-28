// [AG6 urgência e passagem] início Os avisos na tela da AG6a (desenho da AG6,
// secoes 1.1, 1.3 e 6; contrato da frente de banco, secoes 3 e 5), que o
// vigia do menu (use-contadores-do-menu.ts) mostra em qualquer tela:
// - "Conversa urgente de {nome}." com "Abrir": nasce do INSERT, ou do UPDATE
//   com a marca aberta, em conversa_urgente, para quem ve a conversa (a RLS
//   do tempo real recorta por clinica e papel). Uma vez por marca (a
//   conversa e o instante da passagem).
// - "A IA passou para você a conversa de {nome}." com "Abrir": nasce do
//   evento da atribuicao no fio ("A conversa ficou com {nome}, responsável
//   pelo lead."), e so para quem ficou com a conversa (o servidor confere).
//
// O nome do contato e dado de paciente: nunca vem do evento, e sim de uma
// Server Action que le pela sessao (RLS) e grava a leitura na trilha antes
// de devolver (app/(app)/atendimento/avisos-actions.ts). Nada daqui vai para
// log. Modulo PURO (as regras sao testadas sem navegador; o hook so liga).
//
// O "Abrir" leva ao Atendimento com a conversa aberta. Com o Atendimento ja
// na tela, a URL nao basta (o link de /atendimento?conversa= so vale na
// montagem da tela): o aviso pede por um evento da janela, que a tela do
// Atendimento escuta.

export const TEXTOS_DOS_AVISOS = {
  urgente: (contato: string) => `Conversa urgente de ${contato}.`,
  /** A leitura do nome falhou: o aviso sai assim mesmo, sem o nome. */
  urgenteSemNome: "Chegou uma conversa urgente.",
  atribuida: (contato: string) =>
    `A IA passou para você a conversa de ${contato}.`,
  abrir: "Abrir",
} as const;

/**
 * O evento da atribuicao mais velho que isto nao vira aviso (o servidor
 * confere, pelo relogio do banco: o do computador da recepcao pode estar
 * errado). A urgencia nao tem janela: o servidor confere se a marca ainda
 * esta aberta, e uma urgente que chegou com a aba suspensa continua
 * urgente.
 */
export const JANELA_DO_AVISO_MS = 5 * 60_000;

/** O evento da atribuicao sem o nome (perfil vazio ou ausente). */
const ATRIBUICAO_SEM_NOME = "A conversa ficou com o responsável pelo lead.";
/**
 * O evento da atribuicao com o nome (ate 80 caracteres, uma linha; o "u"
 * conta por caractere, como o corte do banco e o de textoDaAtribuicaoDaIa).
 */
const ATRIBUICAO_COM_NOME =
  /^A conversa ficou com [^\n]{1,80}, responsável pelo lead\.$/u;

/**
 * O corpo e o evento da atribuicao ao responsavel do lead (contrato, secao
 * 5)? O texto e do banco (passar_conversa_da_ia_para_equipe); nenhuma acao
 * da equipe grava esse texto ("assumiu", "transferiu" sao outros).
 */
export function ehEventoDeAtribuicao(corpo: unknown): boolean {
  return (
    typeof corpo === "string" &&
    (corpo === ATRIBUICAO_SEM_NOME || ATRIBUICAO_COM_NOME.test(corpo))
  );
}

/** A linha de conversa_urgente como o tempo real entrega (a linha inteira). */
export type LinhaDaMarcaNoEvento = {
  conversation_id?: unknown;
  clinic_id?: unknown;
  desde?: unknown;
  encerrada_em?: unknown;
};

export type AvisoDeUrgencia = {
  conversationId: string;
  /** Uma vez por marca: a conversa e o instante da passagem. */
  chave: string;
};

/**
 * A linha do evento pede o aviso de urgencia? So a marca ABERTA, da clinica
 * ativa. A marca encerrada (alguem pegou) nao avisa; se ela ainda esta
 * aberta na hora do aviso, o servidor confere (lerAvisoDaConversaAction).
 * Sem janela de tempo aqui: o relogio do navegador nao decide se um aviso
 * de urgencia sai.
 */
export function avisoDeUrgenciaDaLinha(
  linha: LinhaDaMarcaNoEvento | null | undefined,
  clinicId: string,
): AvisoDeUrgencia | null {
  if (!linha || linha.clinic_id !== clinicId) {
    return null;
  }
  const { conversation_id: conversationId, desde, encerrada_em } = linha;
  if (typeof conversationId !== "string" || typeof desde !== "string") {
    return null;
  }
  if (encerrada_em !== null && encerrada_em !== undefined) {
    return null;
  }
  if (!Number.isFinite(Date.parse(desde))) {
    return null;
  }
  return { conversationId, chave: `${conversationId}:${desde}` };
}

/** A linha de message como o tempo real entrega (a linha inteira). */
export type LinhaDoEventoNoFio = {
  id?: unknown;
  conversation_id?: unknown;
  clinic_id?: unknown;
  author?: unknown;
  content_type?: unknown;
  body?: unknown;
  created_at?: unknown;
};

export type AvisoDeAtribuicao = { conversationId: string; messageId: string };

/**
 * A mensagem nova e o evento da atribuicao, da clinica ativa? Quem ficou com
 * a conversa e se o evento e recente o servidor confere
 * (lerAvisoDaConversaAction, pelo relogio do banco): a recepcao tambem
 * recebe o evento da conversa passada para outra pessoa.
 */
export function avisoDeAtribuicaoDaLinha(
  linha: LinhaDoEventoNoFio | null | undefined,
  clinicId: string,
): AvisoDeAtribuicao | null {
  if (
    !linha ||
    linha.clinic_id !== clinicId ||
    linha.author !== "sistema" ||
    linha.content_type !== "evento" ||
    !ehEventoDeAtribuicao(linha.body)
  ) {
    return null;
  }
  const { id: messageId, conversation_id: conversationId } = linha;
  if (typeof messageId !== "string" || typeof conversationId !== "string") {
    return null;
  }
  return { conversationId, messageId };
}

/** O evento da janela que pede ao Atendimento aberto para abrir a conversa. */
export const EVENTO_ABRIR_CONVERSA = "cz:abrir-conversa";

/** O link do Atendimento com a conversa aberta (vale na montagem da tela). */
export function linkDaConversa(conversationId: string): string {
  return `/atendimento?conversa=${encodeURIComponent(conversationId)}`;
}

/**
 * Para onde o "Abrir" vai: com o Atendimento ja na tela, um pedido pela
 * janela (a tela escuta e abre); em qualquer outra tela, a rota com o link.
 */
export function destinoDoAbrir(
  pathname: string,
  conversationId: string,
): { tipo: "evento" } | { tipo: "rota"; href: string } {
  return pathname === "/atendimento" || pathname.startsWith("/atendimento/")
    ? { tipo: "evento" }
    : { tipo: "rota", href: linkDaConversa(conversationId) };
}

/** Pede ao Atendimento aberto que abra a conversa. */
export function pedirParaAbrirConversa(conversationId: string): void {
  window.dispatchEvent(
    new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: { conversationId } }),
  );
}

/** O id da conversa de um pedido de abrir, ou nulo fora do formato. */
export function conversaDoPedido(evento: Event): string | null {
  const detalhe = (evento as CustomEvent<{ conversationId?: unknown }>).detail;
  return typeof detalhe?.conversationId === "string"
    ? detalhe.conversationId
    : null;
}

/** O Atendimento escuta os pedidos de abrir; devolve a funcao de saida. */
export function ouvirPedidosDeAbrirConversa(
  abrir: (conversationId: string) => void,
): () => void {
  const ouvir = (evento: Event) => {
    const id = conversaDoPedido(evento);
    if (id) {
      abrir(id);
    }
  };
  window.addEventListener(EVENTO_ABRIR_CONVERSA, ouvir);
  return () => window.removeEventListener(EVENTO_ABRIR_CONVERSA, ouvir);
}
// [AG6 urgência e passagem] fim
