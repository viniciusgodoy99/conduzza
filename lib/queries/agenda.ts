import type { SupabaseClient } from "@supabase/supabase-js";

import { limitesDoDia, somarDias } from "@/lib/domain/horarios";
import type { AppointmentStatus } from "@/lib/design/status";

// Tipos e fetchers da Agenda (Tela 3). Decisao central: UMA query por dia da
// clinica, filtros aplicados no cliente (troca de filtro instantanea, sem
// refetch) e uma chave so para o tempo real mesclar.

export type ConsultaDaAgenda = {
  id: string;
  unit_id: string | null;
  contact_id: string;
  professional_id: string;
  service_link_id: string;
  resource_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  confirmation_channel: string | null;
  is_overbooking: boolean;
  created_by: "usuario" | "ia" | "paciente" | "sistema";
  approval_status: "pendente" | "aprovado" | "recusado" | null;
  send_confirmation: boolean;
  notes: string | null;
  contact: { id: string; name: string | null; phone_e164: string } | null;
  service_link: {
    id: string;
    duration_min: number;
    procedure: { id: string; name: string } | null;
    insurance: { id: string; name: string } | null;
  } | null;
};

export type BloqueioDaAgenda = {
  id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  blocks_overbooking: boolean;
};

export type HoldDaAgenda = {
  id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  expires_at: string;
  created_by: string;
};

export type AgendaDia = {
  consultas: ConsultaDaAgenda[];
  bloqueios: BloqueioDaAgenda[];
  holds: HoldDaAgenda[];
};

export type LinhaDeHistorico = {
  id: string;
  appointment_id: string;
  status: AppointmentStatus;
  changed_by: "usuario" | "ia" | "paciente" | "sistema";
  changed_by_user_id: string | null;
  changed_at: string;
};

export const agendaKeys = {
  dia: (clinicId: string, diaISO: string) =>
    ["agenda", clinicId, "dia", diaISO] as const,
  pendencias: (clinicId: string) => ["agenda", clinicId, "pendencias"] as const,
  historico: (appointmentId: string) =>
    ["agenda", "historico", appointmentId] as const,
  historicoDia: (clinicId: string, diaISO: string) =>
    ["agenda", clinicId, "historico-dia", diaISO] as const,
};

const CONSULTA_SELECT =
  "id, unit_id, contact_id, professional_id, service_link_id, resource_id, starts_at, ends_at, status, confirmation_channel, is_overbooking, created_by, approval_status, send_confirmation, notes, contact:contact_id (id, name, phone_e164), service_link:service_link_id (id, duration_min, procedure:procedure_id (id, name), insurance:insurance_id (id, name))";

function normalizarConsulta(row: Record<string, unknown>): ConsultaDaAgenda {
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  const vinculoBruto = Array.isArray(row.service_link)
    ? row.service_link[0]
    : row.service_link;
  let service_link = vinculoBruto as ConsultaDaAgenda["service_link"];
  if (vinculoBruto) {
    const v = vinculoBruto as Record<string, unknown>;
    service_link = {
      ...(vinculoBruto as object),
      procedure: Array.isArray(v.procedure) ? v.procedure[0] : v.procedure,
      insurance: Array.isArray(v.insurance) ? v.insurance[0] : v.insurance,
    } as ConsultaDaAgenda["service_link"];
  }
  return { ...row, contact, service_link } as ConsultaDaAgenda;
}

/** Busca uma consulta so, com os joins (usada pelo tempo real em INSERT). */
export async function fetchConsulta(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<ConsultaDaAgenda | null> {
  const { data, error } = await supabase
    .from("appointment")
    .select(CONSULTA_SELECT)
    .eq("id", appointmentId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return normalizarConsulta(data as Record<string, unknown>);
}

/**
 * O dia da clinica: consultas (com contato e vinculo), bloqueios e holds
 * ativos que TOCAM o dia civil no fuso da clinica. Consulta que atravessa a
 * meia-noite conta nos dois dias (starts_at < fim e ends_at > inicio).
 */
export async function fetchAgendaDia(
  supabase: SupabaseClient,
  clinicId: string,
  diaISO: string,
  timezone: string,
): Promise<AgendaDia> {
  const { inicio, fim } = limitesDoDia(timezone, diaISO);
  const [consultas, bloqueios, holds] = await Promise.all([
    supabase
      .from("appointment")
      .select(CONSULTA_SELECT)
      .eq("clinic_id", clinicId)
      .lt("starts_at", fim.toISOString())
      .gt("ends_at", inicio.toISOString())
      .order("starts_at"),
    supabase
      .from("professional_block")
      .select(
        "id, professional_id, starts_at, ends_at, reason, blocks_overbooking",
      )
      .eq("clinic_id", clinicId)
      .lt("starts_at", fim.toISOString())
      .gt("ends_at", inicio.toISOString()),
    supabase
      .from("slot_hold")
      .select("id, professional_id, starts_at, ends_at, expires_at, created_by")
      .eq("clinic_id", clinicId)
      .lt("starts_at", fim.toISOString())
      .gt("ends_at", inicio.toISOString())
      .gt("expires_at", new Date().toISOString()),
  ]);
  for (const resultado of [consultas, bloqueios, holds]) {
    if (resultado.error) {
      throw new Error(resultado.error.message);
    }
  }
  return {
    consultas: ((consultas.data ?? []) as Record<string, unknown>[]).map(
      normalizarConsulta,
    ),
    bloqueios: (bloqueios.data ?? []) as BloqueioDaAgenda[],
    holds: (holds.data ?? []) as HoldDaAgenda[],
  };
}

/** Os 7 dias da semana (a visao Semana busca por dia, reusando o cache). */
export function diasDaSemana(diaISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => somarDias(diaISO, i));
}

/** Encaixes da IA aguardando aprovacao (painel "Pendente de voce"). */
export async function fetchPendencias(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConsultaDaAgenda[]> {
  const { data, error } = await supabase
    .from("appointment")
    .select(CONSULTA_SELECT)
    .eq("clinic_id", clinicId)
    .eq("approval_status", "pendente")
    .order("starts_at");
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizarConsulta);
}

export async function fetchHistorico(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<LinhaDeHistorico[]> {
  const { data, error } = await supabase
    .from("appointment_status_history")
    .select(
      "id, appointment_id, status, changed_by, changed_by_user_id, changed_at",
    )
    .eq("appointment_id", appointmentId)
    .order("changed_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as LinhaDeHistorico[];
}

/** Historico agregado do dia (menu 3 pontos: "Ver historico de alteracoes"). */
export async function fetchHistoricoDia(
  supabase: SupabaseClient,
  clinicId: string,
  diaISO: string,
  timezone: string,
): Promise<(LinhaDeHistorico & { consulta: ConsultaDaAgenda | null })[]> {
  const { inicio, fim } = limitesDoDia(timezone, diaISO);
  const { data: consultas, error } = await supabase
    .from("appointment")
    .select("id")
    .eq("clinic_id", clinicId)
    .lt("starts_at", fim.toISOString())
    .gt("ends_at", inicio.toISOString());
  if (error) {
    throw new Error(error.message);
  }
  const ids = (consultas ?? []).map((c) => c.id as string);
  if (ids.length === 0) {
    return [];
  }
  const { data: historico, error: erroHist } = await supabase
    .from("appointment_status_history")
    .select(
      "id, appointment_id, status, changed_by, changed_by_user_id, changed_at",
    )
    .in("appointment_id", ids)
    .order("changed_at", { ascending: false });
  if (erroHist) {
    throw new Error(erroHist.message);
  }
  return ((historico ?? []) as LinhaDeHistorico[]).map((linha) => ({
    ...linha,
    consulta: null,
  }));
}
