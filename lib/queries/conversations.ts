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
  last_message_at: string | null;
  tags: string[];
  contact: ContactSummary;
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
  "id, status, assignee_user_id, unread_count, last_message_at, tags, contact:contact_id (id, name, phone_e164, kind, funnel_stage, source_channel, source_campaign, first_contact_at)";

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

export async function fetchConversations(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

export async function fetchMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<MessageItem[]> {
  const { data, error } = await supabase
    .from("message")
    .select(
      "id, direction, author, author_user_id, content_type, body, media_url, transcript, is_internal_note, delivery_status, error_code, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as MessageItem[];
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
