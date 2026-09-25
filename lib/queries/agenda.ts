import type { SupabaseClient } from "@supabase/supabase-js";

import { limitesDoDia, somarDias } from "@/lib/domain/horarios";
import type { AppointmentStatus } from "@/lib/design/status";
import { fetchProfileNames } from "@/lib/queries/profiles";

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

/**
 * Uma linha da trilha da consulta. `kind` distingue a mudanca de situacao da
 * remarcacao (gravada pelo gatilho registrar_remarcacao com o horario e o
 * profissional de antes e de depois; `status` e a situacao depois de mover).
 */
export type LinhaDeHistorico = {
  id: string;
  appointment_id: string;
  status: AppointmentStatus;
  changed_by: "usuario" | "ia" | "paciente" | "sistema";
  changed_by_user_id: string | null;
  changed_at: string;
  kind: "status" | "remarcacao";
  previous_starts_at: string | null;
  previous_professional_id: string | null;
  new_starts_at: string | null;
  new_professional_id: string | null;
  /**
   * Linha de EVENTO que nao muda a situacao (status repete o atual): hoje so
   * 'remarcacao_pedida', o paciente pediu outro horario pelo WhatsApp.
   */
  event?: string | null;
  /** Nome do perfil de quem mudou (so para changed_by 'usuario'). */
  autor_nome: string | null;
};

/** O minimo da consulta para a linha do historico do dia dizer de quem e. */
export type ResumoDaConsultaNoHistorico = {
  id: string;
  starts_at: string;
  professional_id: string;
  paciente: string | null;
};

export type LinhaDoHistoricoDoDia = LinhaDeHistorico & {
  consulta: ResumoDaConsultaNoHistorico | null;
};

/** Lista de espera ativa e janela de resposta (dialogo de cancelamento). */
export type ListaDeEsperaDaClinica = {
  ativos: number;
  janelaMinutos: number;
};

export const agendaKeys = {
  dia: (clinicId: string, diaISO: string) =>
    ["agenda", clinicId, "dia", diaISO] as const,
  pendencias: (clinicId: string) => ["agenda", clinicId, "pendencias"] as const,
  historico: (appointmentId: string) =>
    ["agenda", "historico", appointmentId] as const,
  historicoDia: (clinicId: string, diaISO: string) =>
    ["agenda", clinicId, "historico-dia", diaISO] as const,
  listaDeEspera: (clinicId: string) =>
    ["agenda", clinicId, "lista-de-espera"] as const,
  consentimento: (clinicId: string, contactId: string) =>
    ["agenda", clinicId, "consentimento", contactId] as const,
};

/**
 * Situacao da autorizacao para receber mensagens de um contato (modal de
 * agendamento, achados 50, 57 e 88): a linha mais recente do WhatsApp manda,
 * a mesma regra da RPC consentimento_vigente. Distingue "nunca registrou" de
 * "pediu para nao receber", que a RPC (so booleano) nao distingue.
 */
export type SituacaoDoConsentimento =
  "autorizado" | "revogado" | "sem_autorizacao";

export async function fetchConsentimentoDoContato(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<SituacaoDoConsentimento> {
  const { data, error } = await supabase
    .from("contact_consent")
    .select("granted_at, revoked_at")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("granted_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  const maisRecente = (
    (data ?? []) as { granted_at: string; revoked_at: string | null }[]
  )[0];
  if (!maisRecente) {
    return "sem_autorizacao";
  }
  return maisRecente.revoked_at === null ? "autorizado" : "revogado";
}

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

const HISTORICO_SELECT =
  "id, appointment_id, status, changed_by, changed_by_user_id, changed_at, kind, previous_starts_at, previous_professional_id, new_starts_at, new_professional_id, event";

type LinhaDeHistoricoDoBanco = Omit<LinhaDeHistorico, "autor_nome">;

/**
 * Poe o nome de quem mudou em cada linha (achado 84: "pela equipe" nao diz
 * quem). profile e legivel entre colegas de clinica pela RLS. Nome e detalhe:
 * se a leitura falhar, a linha cai no rotulo generico em vez de sumir.
 */
async function comNomesDosAutores(
  supabase: SupabaseClient,
  linhas: LinhaDeHistoricoDoBanco[],
): Promise<LinhaDeHistorico[]> {
  const ids = [
    ...new Set(
      linhas
        .map((linha) => linha.changed_by_user_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  let nomes: Record<string, string> = {};
  try {
    nomes = await fetchProfileNames(supabase, ids);
  } catch {
    nomes = {};
  }
  return linhas.map((linha) => ({
    ...linha,
    autor_nome: linha.changed_by_user_id
      ? (nomes[linha.changed_by_user_id] ?? null)
      : null,
  }));
}

export async function fetchHistorico(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<LinhaDeHistorico[]> {
  const { data, error } = await supabase
    .from("appointment_status_history")
    .select(HISTORICO_SELECT)
    .eq("appointment_id", appointmentId)
    .order("changed_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return comNomesDosAutores(
    supabase,
    (data ?? []) as LinhaDeHistoricoDoBanco[],
  );
}

type ConsultaResumidaDoBanco = {
  id: string;
  starts_at: string;
  professional_id: string;
  contact:
    | { name: string | null; phone_e164: string }
    | { name: string | null; phone_e164: string }[]
    | null;
};

function resumirConsulta(
  row: ConsultaResumidaDoBanco,
): ResumoDaConsultaNoHistorico {
  const contato = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return {
    id: row.id,
    starts_at: row.starts_at,
    professional_id: row.professional_id,
    paciente: contato?.name ?? contato?.phone_e164 ?? null,
  };
}

const RESUMO_SELECT =
  "id, starts_at, professional_id, contact:contact_id (name, phone_e164)";

/**
 * Historico agregado do dia (menu 3 pontos: "Ver historico de alteracoes").
 * Cada linha diz de qual paciente e qual consulta (achado 84). Entram as
 * consultas que tocam o dia E as que foram remarcadas PARA FORA dele: sem
 * isso, a consulta que saiu de hoje sumia da trilha de hoje.
 */
export async function fetchHistoricoDia(
  supabase: SupabaseClient,
  clinicId: string,
  diaISO: string,
  timezone: string,
): Promise<LinhaDoHistoricoDoDia[]> {
  const { inicio, fim } = limitesDoDia(timezone, diaISO);
  const [doDia, sairamDoDia] = await Promise.all([
    supabase
      .from("appointment")
      .select(RESUMO_SELECT)
      .eq("clinic_id", clinicId)
      .lt("starts_at", fim.toISOString())
      .gt("ends_at", inicio.toISOString()),
    supabase
      .from("appointment_status_history")
      .select("appointment_id")
      .eq("clinic_id", clinicId)
      .eq("kind", "remarcacao")
      .gte("previous_starts_at", inicio.toISOString())
      .lt("previous_starts_at", fim.toISOString()),
  ]);
  if (doDia.error) {
    throw new Error(doDia.error.message);
  }
  if (sairamDoDia.error) {
    throw new Error(sairamDoDia.error.message);
  }

  const resumos = new Map<string, ResumoDaConsultaNoHistorico>();
  const linhasDoDia = (doDia.data ??
    []) as unknown as ConsultaResumidaDoBanco[];
  for (const row of linhasDoDia) {
    resumos.set(row.id, resumirConsulta(row));
  }
  const foraDoDia = [
    ...new Set(
      ((sairamDoDia.data ?? []) as { appointment_id: string }[])
        .map((linha) => linha.appointment_id)
        .filter((id) => !resumos.has(id)),
    ),
  ];
  if (foraDoDia.length > 0) {
    const { data: extras, error: erroExtras } = await supabase
      .from("appointment")
      .select(RESUMO_SELECT)
      .eq("clinic_id", clinicId)
      .in("id", foraDoDia);
    if (erroExtras) {
      throw new Error(erroExtras.message);
    }
    for (const row of (extras ?? []) as unknown as ConsultaResumidaDoBanco[]) {
      resumos.set(row.id, resumirConsulta(row));
    }
  }

  const ids = [...resumos.keys()];
  if (ids.length === 0) {
    return [];
  }
  const { data: historico, error: erroHist } = await supabase
    .from("appointment_status_history")
    .select(HISTORICO_SELECT)
    .in("appointment_id", ids)
    .order("changed_at", { ascending: false });
  if (erroHist) {
    throw new Error(erroHist.message);
  }
  const linhas = await comNomesDosAutores(
    supabase,
    (historico ?? []) as LinhaDeHistoricoDoBanco[],
  );
  return linhas.map((linha) => ({
    ...linha,
    consulta: resumos.get(linha.appointment_id) ?? null,
  }));
}

/**
 * Ha alguem ativo na lista de espera, e qual a janela de resposta da oferta?
 * So CONTA (head: true): o dialogo de cancelamento nao precisa ver quem esta
 * na fila, so avisar que o horario pode ser oferecido.
 */
export async function fetchListaDeEsperaDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ListaDeEsperaDaClinica> {
  const [fila, clinica] = await Promise.all([
    supabase
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("active", true),
    supabase
      .from("clinic")
      .select("waitlist_response_minutes")
      .eq("id", clinicId)
      .maybeSingle(),
  ]);
  if (fila.error) {
    throw new Error(fila.error.message);
  }
  if (clinica.error) {
    throw new Error(clinica.error.message);
  }
  return {
    ativos: fila.count ?? 0,
    janelaMinutos:
      (clinica.data?.waitlist_response_minutes as number | undefined) ?? 30,
  };
}
