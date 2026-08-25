import type { SupabaseClient } from "@supabase/supabase-js";

import type { FunnelStage } from "@/lib/design/status";
import {
  compararPorProximaAcao,
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";

// Tipos e fetchers da Tela 4 (Leads). Isomorficos como catalogo.ts: recebem o
// SupabaseClient e rodam no servidor (carga inicial) e no browser (TanStack).
// Decisao central, igual a da Agenda: UMA query da clinica, filtros aplicados
// no cliente e uma chave so para o tempo real mesclar. Sem filtro de kind:
// o funil existe em todo contato (paciente que agendou continua no Kanban em
// "agendou" e "compareceu"). A RLS garante isolamento e papel; a leitura
// humana da tela passa por auditarLeituraDePaciente na page.

export type LeadResumo = {
  id: string;
  name: string | null;
  phone_e164: string;
  funnel_stage: FunnelStage;
  lost_reason: string | null;
  lost_reason_note: string | null;
  owner_user_id: string | null;
  tags: string[];
  source_channel: string | null;
  source_campaign: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  insurance: { id: string; name: string } | null;
  consent_ativo: boolean;
};

export type MensagemDoLead = {
  id: string;
  direction: "entrada" | "saida";
  author: "paciente" | "ia" | "usuario" | "sistema";
  content_type: string;
  body: string | null;
  created_at: string;
};

export type LeadDetalhe = {
  lead: LeadResumo & {
    cpf: string | null;
    email: string | null;
    birth_date: string | null;
    insurance_card: string | null;
    kind: "lead" | "paciente";
    source_origin: string | null;
    source_medium: string | null;
    source_captured_at: string | null;
    source_method: string | null;
    no_show_count: number;
    created_at: string;
  };
  /** Conversa nao resolvida mais recente; null sem conversa aberta. */
  conversation_id: string | null;
  /** Ultimas 3 mensagens da conversa aberta, em ordem cronologica. */
  mensagens: MensagemDoLead[];
  /** Nome amigavel da campanha em campaign_link; null sem campanha casada. */
  campanha_nome: string | null;
};

export const leadsKeys = {
  lista: (clinicId: string) => ["leads", clinicId, "lista"] as const,
  detalhe: (contactId: string) => ["leads", "detalhe", contactId] as const,
  /** Nomes dos membros (fetchClinicAuthorNames) para avatar de responsavel. */
  autores: (clinicId: string) => ["leads", clinicId, "autores"] as const,
};

const LEAD_SELECT =
  "id, name, phone_e164, funnel_stage, lost_reason, lost_reason_note, owner_user_id, tags, source_channel, source_campaign, first_contact_at, last_contact_at, insurance:insurance_id (id, name), contact_consent (channel, granted_at, revoked_at)";

// Sem tipos gerados, o supabase-js devolve embed como array: normaliza no
// padrao de normalizarConsulta (lib/queries/agenda.ts) e ja deriva
// consent_ativo pela regra da linha mais recente, descartando as linhas.
function normalizarLead(row: Record<string, unknown>): LeadResumo {
  const insuranceBruto = Array.isArray(row.insurance)
    ? row.insurance[0]
    : row.insurance;
  // Embed um-para-muitos vem sempre como array do PostgREST.
  const consentBruto = row.contact_consent;
  const linhas = (
    Array.isArray(consentBruto) ? consentBruto : []
  ) as LinhaConsent[];
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    phone_e164: row.phone_e164 as string,
    funnel_stage: row.funnel_stage as FunnelStage,
    lost_reason: (row.lost_reason as string | null) ?? null,
    lost_reason_note: (row.lost_reason_note as string | null) ?? null,
    owner_user_id: (row.owner_user_id as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    source_channel: (row.source_channel as string | null) ?? null,
    source_campaign: (row.source_campaign as string | null) ?? null,
    first_contact_at: row.first_contact_at as string,
    last_contact_at: (row.last_contact_at as string | null) ?? null,
    insurance: (insuranceBruto ?? null) as LeadResumo["insurance"],
    consent_ativo: consentimentoVigenteDeLinhas(linhas),
  };
}

/**
 * Todos os contatos da clinica com os embeds, ja ordenados por proxima acao
 * (nunca contatado primeiro, depois o contato mais antigo).
 */
export async function fetchLeads(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<LeadResumo[]> {
  const { data, error } = await supabase
    .from("contact")
    .select(LEAD_SELECT)
    .eq("clinic_id", clinicId);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map(normalizarLead)
    .sort(compararPorProximaAcao);
}

/** Busca um contato so, com os embeds (usada pelo tempo real em INSERT). */
export async function fetchLead(
  supabase: SupabaseClient,
  contactId: string,
): Promise<LeadResumo | null> {
  const { data, error } = await supabase
    .from("contact")
    .select(LEAD_SELECT)
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return normalizarLead(data as Record<string, unknown>);
}

const DETALHE_SELECT =
  "id, clinic_id, name, phone_e164, cpf, email, birth_date, insurance_card, kind, funnel_stage, lost_reason, lost_reason_note, owner_user_id, tags, source_channel, source_origin, source_medium, source_campaign, source_captured_at, source_method, first_contact_at, last_contact_at, no_show_count, created_at, insurance:insurance_id (id, name), contact_consent (channel, granted_at, revoked_at)";

/**
 * Ficha do drawer da Tela 4: contato completo, ultimas 3 mensagens da
 * conversa NAO resolvida (o texto aparece mesmo, a tela e autorizada e a
 * leitura vai para audit_log) e o nome amigavel da campanha de origem.
 */
export async function fetchLeadDetalhe(
  supabase: SupabaseClient,
  contactId: string,
): Promise<LeadDetalhe | null> {
  const { data, error } = await supabase
    .from("contact")
    .select(DETALHE_SELECT)
    .eq("id", contactId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  const row = data as Record<string, unknown>;
  const resumo = normalizarLead(row);
  const clinicId = row.clinic_id as string;
  const sourceCampaign = resumo.source_campaign;

  const [conversa, campanha] = await Promise.all([
    supabase
      .from("conversation")
      .select("id")
      .eq("contact_id", contactId)
      .neq("status", "resolvida")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sourceCampaign
      ? supabase
          .from("campaign_link")
          .select("name")
          .eq("clinic_id", clinicId)
          .eq("campaign", sourceCampaign)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (conversa.error) {
    throw new Error(conversa.error.message);
  }

  const conversationId = (conversa.data?.id as string | undefined) ?? null;
  let mensagens: MensagemDoLead[] = [];
  if (conversationId) {
    const { data: msgs, error: erroMsgs } = await supabase
      .from("message")
      .select("id, direction, author, content_type, body, created_at")
      .eq("conversation_id", conversationId)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(3);
    if (erroMsgs) {
      throw new Error(erroMsgs.message);
    }
    mensagens = ((msgs ?? []) as MensagemDoLead[]).reverse();
  }

  return {
    lead: {
      ...resumo,
      cpf: (row.cpf as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      birth_date: (row.birth_date as string | null) ?? null,
      insurance_card: (row.insurance_card as string | null) ?? null,
      kind: row.kind as "lead" | "paciente",
      source_origin: (row.source_origin as string | null) ?? null,
      source_medium: (row.source_medium as string | null) ?? null,
      source_captured_at: (row.source_captured_at as string | null) ?? null,
      source_method: (row.source_method as string | null) ?? null,
      no_show_count: (row.no_show_count as number | null) ?? 0,
      created_at: row.created_at as string,
    },
    conversation_id: conversationId,
    mensagens,
    campanha_nome: (campanha.data as { name: string } | null)?.name ?? null,
  };
}
