// [AG6 urgência e passagem] início Os avisos na tela da AG6a (desenho da AG6,
// secoes 1.1, 1.3 e 6; contrato da frente de banco, secoes 3 e 5), que o
// vigia do menu (use-contadores-do-menu.ts) mostra em qualquer tela:
// - "Conversa urgente de {nome}." com "Abrir": nasce do INSERT, ou do UPDATE
//   com a marca aberta, em conversa_urgente, para quem ve a conversa (a RLS
//   do tempo real recorta por clinica e papel). Uma vez por marca (a
//   conversa e o instante da passagem).
// - "A IA passou para você a conversa de {nome}." com "Abrir": nasce do
//   evento de CONVERSATION que o menu ja recebe, filtrado pela clinica,
//   quando a conversa ENTRA em atendimento com quem olha depois da montagem
//   do menu (vigiaDaAtribuicao, semeado com as que ja estavam com a pessoa;
//   uma pergunta por entrada); o servidor confere que o ultimo evento do fio
//   e o da atribuicao A QUEM PEDE ("A conversa ficou com {nome},
//   responsável pelo lead.", com o nome do perfil dela) e e recente. Revisao
//   da AG6a: antes, o menu assinava message (content_type evento) SEM filtro
//   de clinica, em todas as telas, e o tempo real conferia a RLS por aba
//   para cada evento de qualquer clinica, com corpos de evento de agenda
//   chegando a todas.
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
 * confere, pelo relogio dele contra o instante gravado pelo banco: o do
 * computador da recepcao pode estar errado). A urgencia nao tem janela: o
 * servidor confere se a marca ainda esta aberta, e uma urgente que chegou
 * com a aba suspensa continua urgente.
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
 * 5)? O texto e do banco (atribuir_conversa_passada_pela_ia); nenhuma acao
 * da equipe grava esse texto ("assumiu", "transferiu" sao outros).
 */
export function ehEventoDeAtribuicao(corpo: unknown): corpo is string {
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

/** A linha de conversation como o tempo real entrega (a linha inteira). */
export type LinhaDaConversaNoEvento = {
  id?: unknown;
  clinic_id?: unknown;
  status?: unknown;
  assignee_user_id?: unknown;
};

/**
 * Quantas conversas o vigia lembra antes de esquecer todas (a proxima
 * entrada de cada uma vira uma pergunta a mais ao servidor, nunca um aviso
 * a mais: quem decide e ele). Tambem o teto da semente
 * (conversasEmAtendimentoCom).
 */
export const CONVERSAS_LEMBRADAS = 2_000;

/**
 * O vigia da atribuicao (vigiaDaAtribuicao): chamado com a linha de cada
 * evento de conversation, devolve o id quando e hora de perguntar ao
 * servidor, ou nulo. `semear` o arma (ver abaixo).
 */
export type VigiaDaAtribuicao = {
  (linha: LinhaDaConversaNoEvento | null | undefined): string | null;
  /**
   * As conversas que JA estavam em atendimento com a pessoa na montagem
   * (conversasEmAtendimentoCom, pela sessao). Arma o vigia; essas nunca
   * perguntam. Devolve as entradas que esperavam a semente e que ela nao
   * conhece (entraram depois da leitura): essas perguntam agora. A leitura
   * que falhou semeia vazio. So a primeira chamada vale.
   */
  semear: (ids: readonly string[]) => string[];
};

/**
 * O vigia da atribuicao: diz QUANDO perguntar ao servidor se a conversa
 * veio da IA para quem olha. So a conversa da clinica ativa que ENTRA em
 * atendimento com esta pessoa (antes estava de outro jeito, ou o vigia
 * ainda nao a conhecia): uma pergunta por entrada, nunca uma por evento (a
 * conversa em atendimento recebe um evento a cada mensagem). Se ela sai e
 * volta (devolvida para a IA e passada de novo), e outra entrada. Quem
 * decide se o aviso sai e o servidor (lerAvisoDaConversaAction): o mesmo
 * evento chega quando a propria pessoa assume a conversa ou quando um
 * colega passa a conversa para ela.
 *
 * SEMEADO NA MONTAGEM (revisao curta da AG6a): sem saber o que ja estava
 * com a pessoa, o primeiro evento de cada conversa em atendimento com ela
 * (uma mensagem nova, por exemplo) parecia uma entrada. Depois de F5, numa
 * segunda aba, em outro aparelho ou na troca de clinica, o aviso de uma
 * atribuicao de menos de 5 minutos saia de novo, e cada conversa dela fazia
 * uma pergunta na fila de Server Actions do Next (a frente do proximo
 * "Enviar"). Agora o vigia nasce DESARMADO: ate a semente chegar, nenhum
 * evento pergunta, e as entradas vistas ficam na espera; `semear` marca as
 * conversas que ja estavam com a pessoa (sem pergunta para elas) e devolve
 * as da espera que a semente nao conhece. O evento que chegou antes da
 * semente vale mais que ela para a mesma conversa (a semente so preenche o
 * que o vigia ainda nao conhece). O aviso, entao, so sai para a conversa
 * que ENTRA em atendimento com a pessoa depois da montagem.
 */
export function vigiaDaAtribuicao({
  clinicId,
  viewerId,
  limite = CONVERSAS_LEMBRADAS,
}: {
  clinicId: string;
  viewerId: string;
  limite?: number;
}): VigiaDaAtribuicao {
  const comigo = new Map<string, boolean>();
  // As entradas vistas antes da semente (a decisao espera por ela).
  const naEspera = new Set<string>();
  let armado = false;

  const lembrar = (id: string, minha: boolean) => {
    if (!comigo.has(id) && comigo.size >= limite) {
      comigo.clear();
    }
    comigo.set(id, minha);
  };

  const vigia = (linha: LinhaDaConversaNoEvento | null | undefined) => {
    if (
      !linha ||
      linha.clinic_id !== clinicId ||
      typeof linha.id !== "string"
    ) {
      return null;
    }
    const minha =
      linha.status === "em_atendimento" &&
      typeof linha.assignee_user_id === "string" &&
      linha.assignee_user_id === viewerId;
    const entrou = minha && comigo.get(linha.id) !== true;
    lembrar(linha.id, minha);
    if (!armado) {
      if (entrou) {
        naEspera.add(linha.id);
      } else if (!minha) {
        naEspera.delete(linha.id);
      }
      return null;
    }
    return entrou ? linha.id : null;
  };

  const semear = (ids: readonly string[]): string[] => {
    if (armado) {
      return [];
    }
    armado = true;
    const jaComigo = new Set(ids);
    for (const id of jaComigo) {
      if (!comigo.has(id)) {
        lembrar(id, true);
      }
    }
    const perguntar = [...naEspera].filter((id) => !jaComigo.has(id));
    naEspera.clear();
    return perguntar;
  };

  return Object.assign(vigia, { semear });
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
