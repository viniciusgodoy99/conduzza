import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConversationStatus } from "@/lib/design/status";
// [AG6b mídia] início
// So TIPOS (somem no build): o Atendimento nao carrega a configuracao do
// agente no navegador.
import type {
  LeituraDaMidiaNaTela,
  MidiaLida,
  TipoDaMidiaLida,
} from "@/lib/domain/agente/config";
// [AG6b mídia] fim
import { corDoNumero, type CorDoNumero } from "@/lib/domain/cor-do-numero";
import { recencia } from "@/lib/domain/filtros-da-conversa";
import { log } from "@/lib/log";

// Tipos e fetchers do Inbox. Sem tipos gerados do banco (pendencia
// registrada), as formas sao declaradas aqui e os selects fazem cast; a RLS
// do banco e quem garante o isolamento das leituras do browser.

export type ContactSummary = {
  id: string;
  name: string | null;
  phone_e164: string;
  kind: "lead" | "paciente";
  funnel_stage: string;
  source_channel: string | null;
  source_campaign: string | null;
  first_contact_at: string | null;
  /**
   * Origem real do anuncio (04/10/2026). Opcionais so para os testes que
   * montam o contato na mao; o select traz sempre. A clinica do contato e a
   * chave da leitura de meta_anuncio pelo painel (o mesmo anuncio pode estar
   * no mapa de duas clinicas da mesma pessoa).
   */
  clinic_id?: string;
  source_origin?: string | null;
  source_medium?: string | null;
  source_method?: string | null;
  source_ad_id?: string | null;
  /** Campanha do Google do clique no site (migration 20261005100000). */
  source_google_campaign_id?: string | null;
};

/** Tipo da ultima mensagem visivel ao paciente (coluna last_preview_kind). */
export type TipoDaPrevia =
  "texto" | "template" | "imagem" | "video" | "audio" | "documento" | "apagada";

export type ConversationListItem = {
  id: string;
  status: ConversationStatus;
  assignee_user_id: string | null;
  unread_count: number;
  awaiting_reply: boolean;
  /** ultima atividade, inclui envio da clinica; alimenta Leads e Pacientes */
  last_message_at: string | null;
  /** quando o PACIENTE falou por ultimo; e a chave de ordenacao do Inbox */
  last_inbound_at: string | null;
  /**
   * Trecho (ate 120 caracteres) da ultima mensagem que o paciente ve, mantido
   * por gatilho no banco (migration 20260925100000). Nota interna e evento
   * nunca entram; apagada vem nula com o tipo 'apagada'. E DADO DE PACIENTE:
   * so para a tela, nunca para log.
   */
  last_preview: string | null;
  last_preview_kind: TipoDaPrevia | null;
  /**
   * Quem escreveu a mensagem da previa (migration 20260925120000), mantido
   * pelo mesmo gatilho. O cartao marca a saida ("Voce:", "Clinica:", "IA:")
   * para a resposta da clinica nao ser lida como fala do paciente.
   */
  last_preview_author: AutorDaPrevia | null;
  /** A pessoa da equipe, quando o autor e 'usuario' ("Voce:" ou "Clinica:"). */
  last_preview_author_user_id: string | null;
  tags: string[];
  /**
   * O numero da clinica desta conversa (whatsapp_account.id): uma conversa
   * por numero, e ela responde por ele (docs/07, decisao 1). Nulo so em
   * clinica sem numero ativo. Opcional so para os testes que montam a
   * conversa na mao; o select traz sempre.
   */
  whatsapp_account_id?: string | null;
  contact: ContactSummary;
  // [AG6 urgência] início
  /**
   * A marca de urgencia ABERTA da conversa (conversa_urgente, AG6a, D-53):
   * a IA passou a conversa porque a pessoa descreveu algo que pode ser uma
   * emergencia. Nula sem marca ou com a marca encerrada (alguem assumiu,
   * transferiu ou resolveu). So o instante, nenhum dado de paciente. Vem
   * embutida no select da lista e o tempo real a mantem viva
   * (lib/realtime/use-inbox-channel.ts). Opcional so para os testes que
   * montam a conversa na mao; o select traz sempre.
   */
  urgente?: MarcaDeUrgencia | null;
  // [AG6 urgência] fim
};

// [AG6 urgência] início
/** A marca aberta: desde quando a conversa e urgente (a ultima passagem). */
export type MarcaDeUrgencia = { desde: string };

/**
 * A marca de urgencia ABERTA de uma linha de conversa_urgente, venha do
 * embutido da lista (objeto ou lista de um item, conforme o PostgREST prova
 * a relacao um para um) ou do evento do tempo real (a linha inteira). Marca
 * encerrada, sem o instante ou fora do formato: nula. Nunca lanca.
 */
export function marcaDeUrgenciaDaLinha(valor: unknown): MarcaDeUrgencia | null {
  const linha: unknown = Array.isArray(valor) ? valor[0] : valor;
  if (typeof linha !== "object" || linha === null) {
    return null;
  }
  const { desde, encerrada_em } = linha as {
    desde?: unknown;
    encerrada_em?: unknown;
  };
  if (typeof desde !== "string" || Number.isNaN(Date.parse(desde))) {
    return null;
  }
  // Ausente conta como aberta: esconder uma urgencia de verdade custa mais do
  // que mostrar uma ja encerrada (que o status, abaixo, ainda filtra).
  return encerrada_em === null || encerrada_em === undefined ? { desde } : null;
}

/**
 * A conversa esta marcada como urgente AGORA: a marca aberta e o status
 * "Aguardando você". O gatilho do banco (urgencia_sai_quando_alguem_pega)
 * fecha a marca na mesma transacao em que a conversa sai de "Aguardando
 * você" (assumir, transferir, resolver): olhar o status tambem tira o chip
 * no mesmo evento da conversa, sem esperar o evento da marca, e nunca deixa
 * uma marca velha (evento perdido) marcar a conversa que alguem ja pegou.
 */
export function urgenteAberta(
  conversa: Pick<ConversationListItem, "status"> & {
    urgente?: MarcaDeUrgencia | null;
  },
): boolean {
  return conversa.status === "aguardando_humano" && Boolean(conversa.urgente);
}

function instanteDaMarca(conversa: { urgente?: MarcaDeUrgencia | null }) {
  const ms = conversa.urgente ? Date.parse(conversa.urgente.desde) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A ordem da lista do Atendimento (D-53, a excecao a "ordem da ultima
 * mensagem"): as urgentes abertas primeiro, entre elas pela chegada (a mais
 * antiga em cima: espera ha mais tempo); depois, a ordem de sempre, a
 * mensagem mais recente primeiro (recencia).
 */
export function ordemDoAtendimento(
  a: ConversationListItem,
  b: ConversationListItem,
): number {
  const urgenteA = urgenteAberta(a);
  const urgenteB = urgenteAberta(b);
  if (urgenteA !== urgenteB) {
    return urgenteA ? -1 : 1;
  }
  if (urgenteA) {
    const chegada = instanteDaMarca(a) - instanteDaMarca(b);
    if (chegada !== 0) {
      return chegada;
    }
  }
  return recencia(b) - recencia(a);
}

/**
 * Aplica uma linha de conversa_urgente (evento do tempo real) a uma lista de
 * conversas: so a conversa dela muda, e a lista volta na ordem do
 * Atendimento. Devolve a MESMA lista quando nada mudou (a conversa nao esta
 * nela, ou a marca e a mesma), para o cache nao redesenhar a toa.
 */
export function aplicarMarcaNaLista(
  lista: ConversationListItem[],
  linha: { conversation_id?: unknown; desde?: unknown; encerrada_em?: unknown },
): ConversationListItem[] {
  const id = linha.conversation_id;
  if (typeof id !== "string") {
    return lista;
  }
  const atual = lista.find((conversa) => conversa.id === id);
  if (!atual) {
    return lista;
  }
  const marca = marcaDeUrgenciaDaLinha(linha);
  if ((atual.urgente?.desde ?? null) === (marca?.desde ?? null)) {
    return lista;
  }
  return lista
    .map((conversa) =>
      conversa.id === id ? { ...conversa, urgente: marca } : conversa,
    )
    .sort(ordemDoAtendimento);
}

/**
 * As marcas abertas lidas ao assinar o canal da marca
 * (lib/realtime/use-inbox-channel.ts), de uma vez: a MESMA lista quando
 * nenhuma muda nada. So acrescenta ou atualiza, e so na conversa que a
 * lista ainda tem em "Aguardando você": a leitura pode ser mais velha que o
 * evento da conversa (alguem assumiu enquanto ela viajava), e a marca velha
 * nao pode grudar na conversa que ja saiu da fila. A marca que nao veio
 * nao e apagada (quem fecha a marca e o evento dela, e a conversa que sai
 * de "Aguardando você" ja perde a marca pelo proprio status). O evento de
 * uma marca usa aplicarMarcaNaLista direto: ele pode chegar antes do
 * evento da conversa, e a marca vale assim mesmo.
 */
export function aplicarMarcasNaLista(
  lista: ConversationListItem[],
  linhas: readonly Parameters<typeof aplicarMarcaNaLista>[1][],
): ConversationListItem[] {
  return linhas.reduce((atual, linha) => {
    const conversa = atual.find((c) => c.id === linha.conversation_id);
    return conversa?.status === "aguardando_humano"
      ? aplicarMarcaNaLista(atual, linha)
      : atual;
  }, lista);
}
// [AG6 urgência] fim

/** Os mesmos valores de message.author. */
export type AutorDaPrevia = "paciente" | "usuario" | "ia" | "sistema";

/** O pouco que a previa da citacao precisa mostrar dentro da bolha. */
export type QuotedMessage = {
  id: string;
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type: string;
  body: string | null;
  is_internal_note: boolean;
  deleted_at: string | null;
  /** enviada direto pelo WhatsApp da clinica (ver MessageItem.pelo_celular) */
  pelo_celular?: boolean;
  // [AG7 preparo] início
  /** o job da fila que enviou (ver MessageItem.job_id) */
  job_id?: string | null;
  // [AG7 preparo] fim
};

export type MessageItem = {
  id: string;
  /**
   * A conversa da mensagem. O fio carrega tambem as conversas ANTERIORES do
   * mesmo contato (historico), e e por este campo que ele desenha a divisa
   * "Conversa resolvida em" e recusa citar mensagem de outra conversa.
   * Opcional so para os testes que montam mensagem na mao; o select traz
   * sempre.
   */
  conversation_id?: string;
  direction: "entrada" | "saida";
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type:
    "texto" | "imagem" | "audio" | "documento" | "template" | "evento";
  body: string | null;
  /**
   * storage://, URL do provedor (ainda baixando), seed:// (demonstracao) ou
   * indisponivel://<motivo> (o download desistiu de vez). Ver
   * lib/domain/midia-recebida.ts.
   */
  media_url: string | null;
  /** nome original do arquivo, como veio do WhatsApp; body e a LEGENDA */
  media_filename?: string | null;
  /** tipo real do arquivo; escolhe foto ou video e a extensao do download */
  media_mimetype?: string | null;
  transcript: string | null;
  is_internal_note: boolean;
  delivery_status: string | null;
  error_code: string | null;
  created_at: string;
  /** quando apagada, o corpo acima ja vem nulo: o conteudo foi para o cofre */
  deleted_at: string | null;
  deleted_by: string | null;
  /** quem apagou: a clinica ou o proprio paciente, do aparelho dele */
  deleted_source: "clinica" | "paciente" | null;
  /** todos: revogada no WhatsApp do paciente. local: some so daqui. */
  deleted_escopo: "todos" | "local" | null;
  reply_to_message_id: string | null;
  reply_to_wa_message_id: string | null;
  /**
   * Enviada direto pelo WhatsApp do numero conectado (celular, WhatsApp Web,
   * outro aparelho), fora do sistema. O webhook grava como saida, sem pessoa
   * (author 'usuario' quando foi gente da clinica, 'sistema' quando foi a
   * resposta automatica do app WhatsApp Business), e o banco so aceita a
   * marca nessa forma (check message_pelo_celular_coerente): a sessao nao
   * consegue forjar. A bolha assina "Pelo WhatsApp" no lugar do nome.
   * Opcional so para os testes que montam mensagem na mao; o select traz
   * sempre.
   */
  pelo_celular?: boolean;
  // [AG7 preparo] início
  /**
   * O job da fila que enviou a mensagem (nulo: nenhum). A orientacao de
   * preparo sai sempre pelo job da IA: o corpo no formato do preparo SEM job
   * nao e o preparo e nao ganha a linha "Texto aprovado pelo responsavel
   * tecnico" (ehMensagemDoPreparo; revisao das telas, TELA-13). Opcional so
   * para os testes que montam mensagem na mao; o select traz sempre.
   */
  job_id?: string | null;
  // [AG7 preparo] fim
  /**
   * A citada, embutida na mesma consulta.
   *
   * Vem nula em dois casos diferentes que a tela distingue: a citada nunca foi
   * linha nossa (reply_to_wa_message_id preenchido, este nulo) ou ela foi
   * apagada depois (o ON DELETE SET NULL zera o vinculo).
   */
  reply_to: QuotedMessage | null;
  // A mensagem agendada de onde esta mensagem saiu (bolha "Mensagem
  // agendada") NAO vem no fio: e a consulta separada fetchAgendadasDoFio
  // (lib/queries/agendadas-do-fio.ts), que falha sozinha sem derrubar o fio.
};

/**
 * Um bloqueio da conformidade no fio. Sem o rascunho: desde o E3 a sessao
 * nao le ai_decision_log.blocked_draft (grant por coluna) e o texto barrado
 * mora em ai_rascunho_bloqueado, que so o super admin le, pela acao
 * lerRascunhoBloqueadoAction, ao abrir o dialogo.
 */
export type ComplianceDecision = {
  id: string;
  message_id: string | null;
  compliance_rule: string | null;
  escalation_reason: string | null;
  created_at: string;
};

/**
 * A linha de autorizacao de WhatsApp que VIGORA, revogada ou nao. Null quando
 * o contato nunca teve autorizacao registrada. O painel precisa separar os
 * tres casos: autorizado, "pediu para nao receber" e "nunca autorizou".
 */
export type ConsentInfo = {
  source: string;
  granted_at: string;
  revoked_at: string | null;
} | null;

/** O estado de autorizacao que a tela mostra (CONSENT_STATUS). */
export function estadoDoConsentimento(
  consent: ConsentInfo,
): "autorizado" | "revogado" | "sem_autorizacao" {
  if (!consent) {
    return "sem_autorizacao";
  }
  return consent.revoked_at ? "revogado" : "autorizado";
}

// A conversa como a lista precisa, SEM a marca de urgencia: e o select de
// antes da AG6a, e o da volta quando o embutido da marca falha (abaixo).
const CONVERSATION_SELECT_SEM_MARCA =
  "id, status, assignee_user_id, unread_count, awaiting_reply, last_message_at, last_inbound_at, last_preview, last_preview_kind, last_preview_author, last_preview_author_user_id, tags, whatsapp_account_id, contact:contact_id (id, clinic_id, name, phone_e164, kind, funnel_stage, source_channel, source_campaign, source_origin, source_medium, source_method, source_ad_id, source_google_campaign_id, first_contact_at)";

// [AG6 urgência] início No fim do select, a marca de urgencia embutida
// (urgencia:conversa_urgente, uma linha por conversa pela FK
// conversa_urgente_conversation_id_fkey, RLS igual a de conversation): so o
// instante e se esta encerrada. "as const" mantem o tipo literal que o
// supabase-js le.
//
// CODIGO NO AR ANTES DA MIGRATION 20261029120000 (revisao da AG6a): sem a
// tabela, o embutido da PGRST200 (a relacao fora do cache de esquema) ou
// 42P01 (o cache ainda acha a tabela que saiu, como no rollback), e a lista
// de TODAS as clinicas caia no error.tsx. Com esses dois codigos, a busca
// e refeita sem o embutido e cada conversa vem com `urgente: null`: o
// Atendimento abre sem a marca, e o servidor registra a volta no log so
// com o codigo (revisao curta). Qualquer outro erro continua sendo erro.
// [AG6 urgência] fim
const CONVERSATION_SELECT =
  `${CONVERSATION_SELECT_SEM_MARCA}, urgencia:conversa_urgente (desde, encerrada_em)` as const;

// [AG6 urgência] início
/** Os codigos do embutido da marca sem a tabela (ver CONVERSATION_SELECT). */
const MARCA_FORA_DO_BANCO: ReadonlySet<string> = new Set(["PGRST200", "42P01"]);

/** O erro e o do embutido da marca sem a tabela (a migration nao rodou)? */
export function marcaForaDoBanco(
  error: { code?: string | null } | null | undefined,
): boolean {
  return MARCA_FORA_DO_BANCO.has(error?.code ?? "");
}

type RespostaDaBusca = {
  data: unknown;
  error: { code?: string | null; message: string } | null;
};

/** O evento do log quando a lista volta sem o embutido da marca. */
export const EVENTO_DA_LISTA_SEM_A_MARCA = "atendimento_lista_sem_a_marca";

/**
 * A volta sem o embutido deixa rastro no servidor (revisao curta da AG6a:
 * antes, ela era silenciosa, e o Atendimento sem a marca de urgencia
 * passava despercebido). So o codigo do erro, nada de dado (nem a clinica:
 * o erro e do banco inteiro). No navegador, nada: este modulo roda nos dois
 * lados, o log estruturado e do servidor (process.stdout) e a carga da tela
 * passa sempre pelo servidor primeiro (a pagina do Atendimento).
 */
function registrarAVoltaSemAMarca(codigo: string | null): void {
  if (typeof window !== "undefined") {
    return;
  }
  log.warn(EVENTO_DA_LISTA_SEM_A_MARCA, { error_code: codigo });
}

/**
 * Faz a busca com a marca embutida e, se o embutido nao existe no banco
 * (marcaForaDoBanco), refaz sem ele, com o rastro no servidor. `buscar`
 * recebe o select de cada vez.
 */
async function comAMarcaSePuder(
  buscar: (
    colunas: typeof CONVERSATION_SELECT | typeof CONVERSATION_SELECT_SEM_MARCA,
  ) => PromiseLike<RespostaDaBusca>,
): Promise<RespostaDaBusca> {
  const resposta = await buscar(CONVERSATION_SELECT);
  if (!marcaForaDoBanco(resposta.error)) {
    return resposta;
  }
  registrarAVoltaSemAMarca(resposta.error?.code ?? null);
  return buscar(CONVERSATION_SELECT_SEM_MARCA);
}
// [AG6 urgência] fim

export const conversationKeys = {
  list: (clinicId: string) => ["conversations", clinicId] as const,
  /**
   * Total de resolvidas (um numero). FORA da chave-mae da lista de proposito:
   * as gravacoes por chave-mae (setQueriesData de lida e etiqueta) tratam
   * tudo ali como lista de conversas. Quem invalida a lista invalida este
   * tambem (tempo real e acoes da conversa).
   */
  totalResolvidas: (clinicId: string) =>
    ["conversations-resolvidas-total", clinicId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  // [AG6b mídia] início
  /**
   * As leituras da midia pelo assistente (fetchLeiturasDaMidia), DEBAIXO da
   * chave das mensagens da conversa de proposito: elas ficam fora do tempo
   * real (a linha tem texto do paciente), e todo evento de message que rele
   * o fio (invalidar e por prefixo) rele as leituras junto.
   */
  leiturasDaMidia: (conversationId: string) =>
    ["messages", conversationId, "leituras-da-midia"] as const,
  // [AG6b mídia] fim
  decisions: (conversationId: string) => ["decisions", conversationId] as const,
  consent: (contactId: string) => ["consent", contactId] as const,
};

function normalizeConversation(
  row: Record<string, unknown>,
): ConversationListItem {
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  // [AG6 urgência] início O embutido cru (urgencia) vira a marca aberta
  // (urgente); sem o embutido (a busca de volta), nulo.
  const { urgencia, ...resto } = row;
  return {
    ...resto,
    contact,
    urgente: marcaDeUrgenciaDaLinha(urgencia),
  } as ConversationListItem;
  // [AG6 urgência] fim
}

// Teto da lista ativa. O Inbox mostra conversas em andamento; resolvida e
// arquivo, carregado sob demanda (fetchResolvedConversations). Sem esse teto,
// uma clinica movimentada traria milhares de linhas em toda carga da tela.
export const CONVERSATIONS_ATIVAS_LIMIT = 300;

// Lista ativa: tudo que NAO esta resolvida. As 300 com a mensagem mais
// recente (indice conversation(clinic_id, status, last_message_at desc))
// UNIDAS as que esperam resposta (awaiting_reply, ate 300, pela ultima fala
// do paciente), sem repetir, na ordem da lista (recencia). O lote pode
// passar de 300: quem espera resposta nunca fica de fora por causa de um
// disparo grande.
export async function fetchConversations(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConversationListItem[]> {
  // [AG6 urgência] As duas buscas com a marca embutida, cada uma com a volta
  // sem ela (comAMarcaSePuder).
  const [recentes, esperando] = await Promise.all([
    comAMarcaSePuder((colunas) =>
      supabase
        .from("conversation")
        .select(colunas)
        .eq("clinic_id", clinicId)
        .neq("status", "resolvida")
        // A mensagem mais recente, enviada OU recebida, primeiro, como no
        // WhatsApp (pedido do dono em 06/10/2026; antes era a ordem de
        // recebimento). A mesma chave de recencia
        // (lib/domain/filtros-da-conversa) e o indice conversation(clinic_id,
        // status, last_message_at desc).
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(CONVERSATIONS_ATIVAS_LIMIT),
    ),
    // Quem ESPERA resposta entra sempre, mesmo fora das 300 mais recentes.
    // last_message_at anda com todo envio (regua, confirmacao, agendada):
    // numa manha de 300 toques, a conversa em que o paciente escreveu ontem
    // e ninguem respondeu sairia do lote, do "Aguardando voce" e do "Ha mais
    // de 24h" sem aviso (achado 25 da revisao).
    comAMarcaSePuder((colunas) =>
      supabase
        .from("conversation")
        .select(colunas)
        .eq("clinic_id", clinicId)
        .neq("status", "resolvida")
        .eq("awaiting_reply", true)
        .order("last_inbound_at", { ascending: false, nullsFirst: false })
        .limit(CONVERSATIONS_ATIVAS_LIMIT),
    ),
  ]);
  if (recentes.error) {
    throw new Error(recentes.error.message);
  }
  if (esperando.error) {
    throw new Error(esperando.error.message);
  }
  // As duas listas juntas, sem repetir, na ordem da lista (recencia).
  const porId = new Map<string, ConversationListItem>();
  for (const linha of [
    ...((recentes.data ?? []) as Record<string, unknown>[]),
    ...((esperando.data ?? []) as Record<string, unknown>[]),
  ]) {
    const conversa = normalizeConversation(linha);
    if (!porId.has(conversa.id)) {
      porId.set(conversa.id, conversa);
    }
  }
  // [AG6 urgência] início A ordem do Atendimento: as urgentes abertas primeiro
  // (D-53), depois a recencia. A passagem por urgencia deixa a conversa
  // esperando resposta e com a mensagem mais recente: ela entra no lote
  // pelas duas buscas.
  return [...porId.values()].sort(ordemDoAtendimento);
  // [AG6 urgência] fim
}

// Teto do arquivo de resolvidas carregado de uma vez. A lista precisa dele
// para nao mostrar o teto como se fosse o total, e para avisar que a busca
// nas resolvidas para nele (achado L3 da revisao da leva 2).
export const RESOLVIDAS_LIMIT = 100;

// Conversas resolvidas, sob demanda (quando o usuario abre o filtro).
export async function fetchResolvedConversations(
  supabase: SupabaseClient,
  clinicId: string,
  limit = RESOLVIDAS_LIMIT,
): Promise<ConversationListItem[]> {
  const { data, error } = await comAMarcaSePuder((colunas) =>
    supabase
      .from("conversation")
      .select(colunas)
      .eq("clinic_id", clinicId)
      .eq("status", "resolvida")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit),
  );
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

// Uma conversa pelo id, para o link /atendimento?conversa=<id> (Confirmacoes,
// ficha do paciente, drawer do lead). Vem com a SESSAO de quem abre: a RLS
// decide se ela existe para esta pessoa (outra clinica, ou o profissional
// fora da propria conversa, volta nulo). Serve tambem para a conversa que
// ficou fora das 300 ativas carregadas e para a resolvida.
export async function fetchConversationById(
  supabase: SupabaseClient,
  clinicId: string,
  conversationId: string,
): Promise<ConversationListItem | null> {
  const { data, error } = await comAMarcaSePuder((colunas) =>
    supabase
      .from("conversation")
      .select(colunas)
      .eq("clinic_id", clinicId)
      .eq("id", conversationId)
      .maybeSingle(),
  );
  if (error) {
    throw new Error(error.message);
  }
  return data ? normalizeConversation(data as Record<string, unknown>) : null;
}

// [AG6 urgência] início
/** Teto das marcas abertas lidas de uma vez (a mesma ordem da lista ativa). */
export const MARCAS_ABERTAS_LIMIT = CONVERSATIONS_ATIVAS_LIMIT;

/**
 * As marcas de urgencia ABERTAS da clinica (so ids e instantes, nenhum dado
 * de paciente), pela sessao: a RLS de conversa_urgente recorta como a de
 * conversation. O tempo real do Atendimento le ao assinar o canal da marca
 * (lib/realtime/use-inbox-channel.ts), para a marca que nasceu antes de o
 * canal ficar de pe nao se perder. Lanca no erro (sem a tabela, antes da
 * migration, tambem): quem chama ignora.
 */
export async function fetchMarcasAbertas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<
  { conversation_id: string; desde: string; encerrada_em: string | null }[]
> {
  const { data, error } = await supabase
    .from("conversa_urgente")
    .select("conversation_id, desde, encerrada_em")
    .eq("clinic_id", clinicId)
    .is("encerrada_em", null)
    .limit(MARCAS_ABERTAS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as {
    conversation_id: string;
    desde: string;
    encerrada_em: string | null;
  }[];
}
// [AG6 urgência] fim

/**
 * Um numero de WhatsApp ATIVO da clinica, como o Inbox e Configuracoes vao
 * mostrar (selo, cabecalho, filtro e cartoes da Fase 4, docs/07).
 */
export type NumeroDaClinica = {
  id: string;
  /** nome livre dado pela equipe ("Recepção", "Unidade Centro") */
  nome: string;
  /** o telefone pareado, quando ja conectou alguma vez */
  display_phone: string | null;
  connection_status: string;
  principal: boolean;
  /** ultima vez que conectou; nulo = nunca foi pareado */
  connected_at: string | null;
  /** cor escolhida em Configuracoes (paleta fixa, lib/domain/cor-do-numero) */
  cor: CorDoNumero;
};

// Os numeros ATIVOS da clinica (removido_em nulo), o principal primeiro e os
// outros na ordem de cadastro. Pela sessao: todo membro ativo le
// whatsapp_account (RLS), e o segredo da instancia nunca passa por aqui.
// Numero removido fica de fora: o historico das conversas dele continua, mas
// ele nao e mais opcao de nada.
export async function fetchNumerosDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<NumeroDaClinica[]> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select(
      "id, nome, display_phone, connection_status, principal, connected_at, cor",
    )
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (
    (data ?? []) as (Omit<NumeroDaClinica, "cor"> & { cor: string })[]
  ).map((numero) => ({ ...numero, cor: corDoNumero(numero.cor) }));
}

/** Um numero que saiu da clinica: so o nome, para o historico dizer de onde era. */
export type NumeroRemovido = { id: string; nome: string };

/** O que o Inbox sabe dos numeros da clinica (lib/domain/numeros-do-inbox.ts). */
export type NumerosDoInbox = {
  /** Os ativos: o principal primeiro, os outros na ordem de cadastro. */
  ativos: NumeroDaClinica[];
  /** Os removidos, so para nomear as conversas antigas deles. */
  removidos: NumeroRemovido[];
};

export const numerosKeys = {
  doInbox: (clinicId: string) => ["whatsapp-numeros-inbox", clinicId] as const,
  /** So os ativos (fetchNumerosDaClinica): por onde iniciar uma conversa. */
  ativos: (clinicId: string) => ["whatsapp-numeros-ativos", clinicId] as const,
};

// Teto dos removidos lidos: eles so servem para nomear conversa antiga, e uma
// clinica nao remove numero toda semana.
const REMOVIDOS_LIMIT = 50;

// Os numeros REMOVIDOS da clinica, so id e nome: a conversa de um numero que
// saiu continua no historico e diz de qual numero era. Pela sessao (a RLS de
// whatsapp_account nao olha removido_em).
export async function fetchNumerosRemovidos(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<NumeroRemovido[]> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select("id, nome")
    .eq("clinic_id", clinicId)
    .not("removido_em", "is", null)
    .order("removido_em", { ascending: false })
    .limit(REMOVIDOS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as NumeroRemovido[];
}

// Os ativos e os removidos numa ida so, para a consulta do Inbox no browser
// (a pagina busca os dois no servidor para a primeira pintura).
export async function fetchNumerosDoInbox(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<NumerosDoInbox> {
  const [ativos, removidos] = await Promise.all([
    fetchNumerosDaClinica(supabase, clinicId),
    fetchNumerosRemovidos(supabase, clinicId),
  ]);
  return { ativos, removidos };
}

// So se EXISTE alguma resolvida (head, sem trazer linha): decide entre
// "Nenhuma conversa ainda" e "Nenhuma conversa em andamento" com atalho para
// o arquivo, quando nao ha conversa ativa.
export async function existeConversaResolvida(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<boolean> {
  return (await contarConversasResolvidas(supabase, clinicId)) > 0;
}

// Total de resolvidas que ESTA pessoa ve (head, sem trazer linha): e o numero
// do chip "Resolvida" quando o arquivo passa do teto carregado. Pela sessao,
// entao a RLS recorta (o profissional conta so as dele).
export async function contarConversasResolvidas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("conversation")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("status", "resolvida");
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

// [AG7 preparo] O job_id vai no fio e na citada (TELA-13): sem job, o corpo no
// formato da orientacao de preparo nao e o preparo (ehMensagemDoPreparo).
const MESSAGE_SELECT =
  "id, conversation_id, direction, author, author_user_id, content_type, body, media_url, media_filename, media_mimetype, transcript, is_internal_note, delivery_status, error_code, created_at, deleted_at, deleted_by, deleted_source, deleted_escopo, reply_to_message_id, reply_to_wa_message_id, pelo_celular, job_id, " +
  // Auto-juncao: a citada e outra linha da MESMA tabela. O apelido aponta para
  // a COLUNA, nao para o nome da chave estrangeira: numa relacao de uma tabela
  // com ela mesma, o nome da chave nao diz qual ponta seguir, e o PostgREST
  // devolve a lista das mensagens que citam esta, que e o contrario do que a
  // bolha precisa. Conferido contra o banco em 02/09/2026.
  "reply_to:reply_to_message_id(id, author, author_user_id, content_type, body, is_internal_note, deleted_at, pelo_celular, job_id)";
// SEM embed de mensagem_agendada, de proposito (achado 16 da revisao): uma
// tabela que falte ou um embed recusado pelo PostgREST derrubaria o fio de
// todas as conversas. A autoria da agendada vem de fetchAgendadasDoFio.

export const MESSAGES_PAGE_SIZE = 50;

export type MessagePage = {
  items: MessageItem[];
  /** created_at da mensagem mais antiga desta pagina; null quando acabou */
  nextCursor: string | null;
};

// Pagina de mensagens, do MAIS NOVO para tras. Sem cursor, traz as ultimas 50
// (o que corrige o bug silencioso: antes trazia as 200 MAIS ANTIGAS e a
// conversa parava de mostrar mensagem nova depois disso). O historico e
// carregado sob demanda com o cursor. Ordena desc no banco (usa o indice
// message(conversation_id, created_at desc)) e inverte para exibir asc.
//
// HISTORICO DO CONTATO (achado 10 da revisao). Resolver uma conversa e o
// paciente voltar a escrever abre uma conversa NOVA (o indice unico so vale
// para as nao resolvidas), e o fio comecava vazio: a atendente nao via o que
// tinha sido combinado antes. Com o contactId, a pagina junta a conversa
// aberta e as RESOLVIDAS do mesmo contato, na mesma ordem de tempo; a tela
// desenha a divisa entre elas. A conversa aberta de outro ciclo nunca entra
// (so as resolvidas e a propria). Tudo pela sessao: o profissional so ve as
// conversas atribuidas a ele, e a RLS de message repete o recorte.
//
// POR NUMERO (docs/07, decisao 1 do dono: uma conversa por numero). O
// historico junta so as conversas anteriores do contato NO MESMO NUMERO da
// conversa aberta: o que o paciente falou com a Unidade Centro nao aparece
// no fio da Recepcao, porque a resposta daquele fio sai pela Recepcao e cada
// numero e um WhatsApp diferente para o paciente. `numeroId` undefined e o
// fio de antes (sem filtro de numero), para quem monta a conversa sem a
// coluna; null e a conversa sem numero (clinica que ainda nao tem nenhum),
// que junta so as outras sem numero.
async function conversasDoHistorico(
  supabase: SupabaseClient,
  conversationId: string,
  contactId: string,
  numeroId: string | null | undefined,
): Promise<string[]> {
  let busca = supabase
    .from("conversation")
    .select("id")
    .eq("contact_id", contactId)
    .or(`status.eq.resolvida,id.eq.${conversationId}`);
  if (numeroId !== undefined) {
    busca =
      numeroId === null
        ? busca.is("whatsapp_account_id", null)
        : busca.eq("whatsapp_account_id", numeroId);
  }
  const { data, error } = await busca
    // Teto de ciclos: o fio pagina por tempo, e um contato de anos nao pode
    // virar um filtro sem fim. A propria conversa entra sempre (abaixo).
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(error.message);
  }
  const ids = ((data ?? []) as { id: string }[]).map((linha) => linha.id);
  return ids.includes(conversationId) ? ids : [...ids, conversationId];
}

export async function fetchMessagesPage(
  supabase: SupabaseClient,
  conversationId: string,
  cursor?: string,
  contactId?: string,
  /** O numero da conversa: o historico fica nele (ver conversasDoHistorico). */
  numeroId?: string | null,
): Promise<MessagePage> {
  const conversas = contactId
    ? await conversasDoHistorico(supabase, conversationId, contactId, numeroId)
    : [conversationId];
  let query = supabase
    .from("message")
    .select(MESSAGE_SELECT)
    .in("conversation_id", conversas)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (cursor) {
    query = query.lt("created_at", cursor);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(
    (linha) => ({
      ...linha,
      // O PostgREST devolve a juncao como lista quando nao consegue provar que
      // e um para um; a tela quer um objeto ou nada.
      reply_to: Array.isArray(linha.reply_to)
        ? ((linha.reply_to[0] as QuotedMessage) ?? null)
        : ((linha.reply_to as QuotedMessage | null) ?? null),
    }),
  ) as MessageItem[];
  const nextCursor =
    rows.length === MESSAGES_PAGE_SIZE
      ? (rows[rows.length - 1]?.created_at ?? null)
      : null;
  return { items: rows.reverse(), nextCursor };
}

// [AG6b mídia] início
// LEITURAS DA MIDIA PELO ASSISTENTE (AG6b; desenho da AG6b, secoes 3.4 e 6;
// D-99 pela recomendacao, pendente do dono). Na conversa que a IA atende, com
// a habilidade valendo, o assistente transcreve o audio do paciente
// ("Entender áudio") e le a foto ou o PDF ("Ler imagem e documento"); o
// servidor grava o resultado em ia_leitura_da_midia (migration
// 20261030100000), uma linha por mensagem, nunca alterada. A equipe ve
// embaixo da bolha "Transcrição do assistente:" no audio e "Lido pelo
// assistente:" na foto e no documento
// (components/atendimento/media/leitura-do-assistente.tsx).
//
// Consulta PROPRIA, fora do select do fio, de proposito (a licao do achado
// 16 e da AG6a): sem a tabela (codigo no ar antes da migration, ou o
// rollback) o PostgREST responde PGRST205 ou 42P01, e a conversa abre sem as
// leituras, como antes; qualquer outro erro lanca, e a tela diz "Leitura do
// assistente indisponível agora." na linha da midia, so na clinica da fase
// do agente (leiturasDoFio: nas outras, nada muda, nem no erro). O fio nunca
// cai por ela.
//
// E DADO DE SAUDE (a transcricao e o que a pessoa falou): pela SESSAO, com a
// RLS da mensagem (membro ativo da clinica; o profissional so na conversa
// dele; a mensagem apagada leva a leitura), dentro do fio que o Atendimento
// ja audita. Fora do tempo real: a chave mora debaixo da chave das
// mensagens da conversa (conversationKeys.leiturasDaMidia), entao o MESMO
// evento de message que rele o fio rele as leituras. Nada daqui vai para
// log, nem no texto do erro.

/**
 * Uma leitura como a tela mostra: o tipo e do contrato da AG6b (B2 para B3,
 * em lib/domain/agente/config.ts). O texto do resumo e montado e gravado
 * pelo servidor, so com nomes do Cadastro e textos fixos; a tela so mostra.
 */
export type { LeituraDaMidiaNaTela };

/**
 * ESPELHO de MIDIAS_LIDAS e TIPOS_DE_MIDIA_LIDA (lib/domain/agente/config.ts,
 * os CHECKs de ia_leitura_da_midia): copia de proposito, para o Atendimento
 * nao levar a configuracao inteira do agente ao navegador (daqui so os
 * tipos, que somem no build). tests/unit/atendimento/leitura-da-midia.test.tsx
 * confere as duas listas contra a configuracao.
 */
export const MIDIAS_LIDAS_NA_TELA = [
  "audio",
  "imagem",
  "documento",
] as const satisfies readonly MidiaLida[];

export const TIPOS_LIDOS_NA_TELA = [
  "transcricao",
  "sem_fala",
  "pedido_de_exame_ou_procedimento",
  "guia_ou_autorizacao",
  "carteirinha",
  "documento_de_identidade",
  "resultado_ou_laudo",
  "receita",
  "foto_do_corpo",
  "figurinha",
  "outro",
  "ilegivel",
] as const satisfies readonly TipoDaMidiaLida[];

const MIDIAS_LIDAS_PELO_ASSISTENTE: ReadonlySet<string> = new Set(
  MIDIAS_LIDAS_NA_TELA,
);
const TIPOS_DA_LEITURA: ReadonlySet<string> = new Set(TIPOS_LIDOS_NA_TELA);

/** As leituras do fio aberto, como o fio recebe. */
export type LeiturasDoFio = {
  /**
   * desligada: nao ha o que ler (sem midia de paciente na pagina) ou o erro
   * nao se mostra; carregando: a primeira leitura; erro: a consulta falhou
   * (a linha "indisponível agora"); pronta: o mapa vale.
   */
  estado: "desligada" | "carregando" | "erro" | "pronta";
  /** Por message_id. */
  porMensagem: Readonly<Record<string, LeituraDaMidiaNaTela>>;
};

/** O fio sem leituras (consulta desligada). */
export const SEM_LEITURAS_DO_FIO: LeiturasDoFio = {
  estado: "desligada",
  porMensagem: {},
};

/**
 * A mensagem pode ter leitura do assistente: e do paciente (entrada), nao e
 * nota, nao foi apagada, e e audio, imagem ou documento. A mensagem que a
 * clinica mandou nunca e lida (desenho da AG6b, 1.1), e o video e o resto
 * que chega como 'texto' tambem nao.
 */
export function podeTerLeituraDaMidia(
  mensagem: Pick<
    MessageItem,
    "direction" | "content_type" | "deleted_at" | "is_internal_note"
  >,
): boolean {
  return (
    mensagem.direction === "entrada" &&
    !mensagem.is_internal_note &&
    mensagem.deleted_at === null &&
    MIDIAS_LIDAS_PELO_ASSISTENTE.has(mensagem.content_type)
  );
}

const UUID_DA_MENSAGEM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Os ids das mensagens da pagina que podem ter leitura, na ordem do fio. So
 * ids validos: a bolha otimista (id provisorio) nao derruba a consulta.
 */
export function idsDasMidiasDoPaciente(
  mensagens: readonly Pick<
    MessageItem,
    "id" | "direction" | "content_type" | "deleted_at" | "is_internal_note"
  >[],
): string[] {
  return mensagens
    .filter(
      (mensagem) =>
        podeTerLeituraDaMidia(mensagem) && UUID_DA_MENSAGEM.test(mensagem.id),
    )
    .map((mensagem) => mensagem.id);
}

/** Ids por consulta: o filtro in.(...) vai na URL. */
const LOTE_DAS_LEITURAS = 100;

/**
 * A tabela ainda nao existe (ou ja saiu): o PostgREST responde PGRST205
 * (fora do cache de esquema) e o Postgres, 42P01. Sem tabela, nenhuma
 * leitura (o mesmo criterio de lib/queries/implementadores.ts).
 */
const LEITURAS_FORA_DO_BANCO: ReadonlySet<string> = new Set([
  "PGRST205",
  "42P01",
]);

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

/**
 * Uma linha do banco como a tela usa; fora do formato (midia ou tipo que o
 * CHECK nao deixaria), nula: a bolha fica sem linha.
 */
function leituraDaLinha(
  linha: Record<string, unknown>,
): LeituraDaMidiaNaTela | null {
  const { message_id: messageId, midia, tipo } = linha;
  if (
    typeof messageId !== "string" ||
    typeof midia !== "string" ||
    !MIDIAS_LIDAS_PELO_ASSISTENTE.has(midia) ||
    typeof tipo !== "string" ||
    !TIPOS_DA_LEITURA.has(tipo)
  ) {
    return null;
  }
  return {
    messageId,
    midia: midia as MidiaLida,
    tipo: tipo as TipoDaMidiaLida,
    transcricao: textoOuNulo(linha.transcricao),
    resumo: textoOuNulo(linha.resumo),
  };
}

/**
 * As leituras das mensagens, por message_id. Sem a tabela, mapa vazio (a
 * conversa abre como antes). Outro erro LANCA, sem nada do erro do banco no
 * texto: a tela mostra a linha "indisponível agora", e o fio continua.
 */
export async function fetchLeiturasDaMidia(
  supabase: SupabaseClient,
  clinicId: string,
  messageIds: readonly string[],
): Promise<Record<string, LeituraDaMidiaNaTela>> {
  const ids = [
    ...new Set(messageIds.filter((id) => UUID_DA_MENSAGEM.test(id))),
  ];
  if (ids.length === 0) {
    return {};
  }
  const lotes: string[][] = [];
  for (let inicio = 0; inicio < ids.length; inicio += LOTE_DAS_LEITURAS) {
    lotes.push(ids.slice(inicio, inicio + LOTE_DAS_LEITURAS));
  }
  const respostas = await Promise.all(
    lotes.map((lote) =>
      supabase
        .from("ia_leitura_da_midia")
        .select("message_id, midia, tipo, transcricao, resumo")
        .eq("clinic_id", clinicId)
        .in("message_id", lote),
    ),
  );
  const porMensagem: Record<string, LeituraDaMidiaNaTela> = {};
  for (const { data, error } of respostas) {
    if (error) {
      if (LEITURAS_FORA_DO_BANCO.has(error.code ?? "")) {
        return {};
      }
      throw new Error("leituras da midia ilegiveis");
    }
    for (const linha of (data ?? []) as Record<string, unknown>[]) {
      const leitura = leituraDaLinha(linha);
      if (leitura) {
        porMensagem[leitura.messageId] = leitura;
      }
    }
  }
  return porMensagem;
}

/**
 * A consulta das leituras roda? So na clinica da fase do agente (iaNaFase,
 * a lista do banco decidida no servidor: fora dela nao ha leitura do
 * assistente), com a conversa aberta e alguma midia do paciente na pagina.
 * Revisao das telas da AG6b (item 6): ela e relida a cada evento de message
 * da conversa aberta, e rodava em toda clinica, uma requisicao a mais por
 * evento mesmo sem IA.
 */
export function consultaDasLeiturasLigada(entrada: {
  iaNaFase: boolean;
  conversaAberta: boolean;
  ids: readonly string[];
}): boolean {
  return entrada.iaNaFase && entrada.conversaAberta && entrada.ids.length > 0;
}

/**
 * O estado das leituras para o fio, a partir da consulta. Com o mapa na
 * mao (inclusive o da leitura anterior, enquanto a nova roda), vale o mapa:
 * leitura que ja apareceu nao some por uma releitura que falhou. Sem mapa e
 * com erro, "erro" so quando `mostrarErro` (a clinica da fase do agente;
 * nas outras nada muda, nem no erro).
 */
export function leiturasDoFio(consulta: {
  /** A consulta roda (ha midia de paciente na pagina). */
  ligada: boolean;
  mostrarErro: boolean;
  data: Readonly<Record<string, LeituraDaMidiaNaTela>> | undefined;
  isError: boolean;
}): LeiturasDoFio {
  if (!consulta.ligada) {
    return SEM_LEITURAS_DO_FIO;
  }
  if (consulta.data) {
    return { estado: "pronta", porMensagem: consulta.data };
  }
  if (consulta.isError) {
    return consulta.mostrarErro
      ? { estado: "erro", porMensagem: {} }
      : SEM_LEITURAS_DO_FIO;
  }
  return { estado: "carregando", porMensagem: {} };
}

/** A leitura da mensagem, ou null (sem leitura, ou o fio sem o mapa). */
export function leituraDaMensagem(
  leituras: LeiturasDoFio,
  messageId: string,
): LeituraDaMidiaNaTela | null {
  // hasOwn: um id como "constructor" nao pode achar nada no prototipo.
  return Object.hasOwn(leituras.porMensagem, messageId)
    ? (leituras.porMensagem[messageId] ?? null)
    : null;
}
// [AG6b mídia] fim

export async function fetchComplianceDecisions(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ComplianceDecision[]> {
  // blocked_draft fica de fora: com o grant por coluna do E3, pedir a coluna
  // daria 42501 e a lista inteira falharia.
  const { data, error } = await supabase
    .from("ai_decision_log")
    .select("id, message_id, compliance_rule, escalation_reason, created_at")
    .eq("conversation_id", conversationId)
    .eq("compliance_blocked", true);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ComplianceDecision[];
}

// A linha MAIS RECENTE do canal, revogada ou nao: a mesma regra da RPC
// consentimento_vigente (e de lib/domain/leads-ui.ts). Filtrar por ativa
// escondia a revogacao, e o painel dizia "a clinica so pode responder quando
// o contato escrever primeiro" para quem PEDIU para nao receber mensagens.
export async function fetchConsent(
  supabase: SupabaseClient,
  contactId: string,
): Promise<ConsentInfo> {
  const { data, error } = await supabase
    .from("contact_consent")
    .select("source, granted_at, revoked_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("granted_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ConsentInfo) ?? null;
}
