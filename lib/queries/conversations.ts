import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConversationStatus } from "@/lib/design/status";

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
};

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
  tags: string[];
  contact: ContactSummary;
};

/** O pouco que a previa da citacao precisa mostrar dentro da bolha. */
export type QuotedMessage = {
  id: string;
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type: string;
  body: string | null;
  is_internal_note: boolean;
  deleted_at: string | null;
};

export type MessageItem = {
  id: string;
  direction: "entrada" | "saida";
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type:
    "texto" | "imagem" | "audio" | "documento" | "template" | "evento";
  body: string | null;
  media_url: string | null;
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
   * A citada, embutida na mesma consulta.
   *
   * Vem nula em dois casos diferentes que a tela distingue: a citada nunca foi
   * linha nossa (reply_to_wa_message_id preenchido, este nulo) ou ela foi
   * apagada depois (o ON DELETE SET NULL zera o vinculo).
   */
  reply_to: QuotedMessage | null;
};

export type ComplianceDecision = {
  id: string;
  message_id: string | null;
  compliance_rule: string | null;
  escalation_reason: string | null;
  blocked_draft: string | null;
  created_at: string;
};

export type ConsentInfo = {
  source: string;
  granted_at: string;
} | null;

const CONVERSATION_SELECT =
  "id, status, assignee_user_id, unread_count, awaiting_reply, last_message_at, last_inbound_at, tags, contact:contact_id (id, name, phone_e164, kind, funnel_stage, source_channel, source_campaign, first_contact_at)";

export const conversationKeys = {
  list: (clinicId: string) => ["conversations", clinicId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  decisions: (conversationId: string) => ["decisions", conversationId] as const,
  consent: (contactId: string) => ["consent", contactId] as const,
};

function normalizeConversation(
  row: Record<string, unknown>,
): ConversationListItem {
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return { ...row, contact } as ConversationListItem;
}

// Teto da lista ativa. O Inbox mostra conversas em andamento; resolvida e
// arquivo, carregado sob demanda (fetchResolvedConversations). Sem esse teto,
// uma clinica movimentada traria milhares de linhas em toda carga da tela.
export const CONVERSATIONS_ATIVAS_LIMIT = 300;

// Lista ativa: tudo que NAO esta resolvida. Ordenada e limitada, batendo com
// o indice conversation(clinic_id, status, last_message_at desc).
//
// A ordem do SERVIDOR continua sendo por recencia: e ela que decide QUAIS 300
// conversas chegam ao browser, e trocar o criterio faria uma clinica com
// centenas de leads antigos por ler empurrar para fora do lote as conversas
// que a equipe esta trabalhando hoje. Quem espera resposta vem primeiro DENTRO
// do lote, no cliente.
export async function fetchConversations(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .neq("status", "resolvida")
    // Ordem de RECEBIMENTO, nao de atividade: last_message_at sobe tambem
    // quando a clinica responde (send.ts:457-466), o que jogava a conversa
    // respondida para o topo e embaralhava a coluna de horarios.
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(CONVERSATIONS_ATIVAS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

// Conversas resolvidas, sob demanda (quando o usuario abre o filtro).
export async function fetchResolvedConversations(
  supabase: SupabaseClient,
  clinicId: string,
  limit = 100,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("status", "resolvida")
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

const MESSAGE_SELECT =
  "id, direction, author, author_user_id, content_type, body, media_url, transcript, is_internal_note, delivery_status, error_code, created_at, deleted_at, deleted_by, deleted_source, deleted_escopo, reply_to_message_id, reply_to_wa_message_id, " +
  // Auto-juncao: a citada e outra linha da MESMA tabela. O apelido aponta para
  // a COLUNA, nao para o nome da chave estrangeira: numa relacao de uma tabela
  // com ela mesma, o nome da chave nao diz qual ponta seguir, e o PostgREST
  // devolve a lista das mensagens que citam esta, que e o contrario do que a
  // bolha precisa. Conferido contra o banco em 02/09/2026.
  "reply_to:reply_to_message_id(id, author, author_user_id, content_type, body, is_internal_note, deleted_at)";

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
export async function fetchMessagesPage(
  supabase: SupabaseClient,
  conversationId: string,
  cursor?: string,
): Promise<MessagePage> {
  let query = supabase
    .from("message")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
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

export async function fetchComplianceDecisions(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ComplianceDecision[]> {
  const { data, error } = await supabase
    .from("ai_decision_log")
    .select(
      "id, message_id, compliance_rule, escalation_reason, blocked_draft, created_at",
    )
    .eq("conversation_id", conversationId)
    .eq("compliance_blocked", true);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ComplianceDecision[];
}

export async function fetchConsent(
  supabase: SupabaseClient,
  contactId: string,
): Promise<ConsentInfo> {
  const { data, error } = await supabase
    .from("contact_consent")
    .select("source, granted_at")
    .eq("contact_id", contactId)
    .eq("active", true)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ConsentInfo) ?? null;
}
