import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppointmentStatus } from "@/lib/design/status";
import { limitesDoDia } from "@/lib/domain/horarios";
import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";

// Tipos e fetchers da Tela 2 (Confirmacoes). Isomorficos como os da Agenda:
// recebem o SupabaseClient e rodam no servidor (carga inicial) e no browser
// (TanStack, quando a recepcao troca de dia ou de aba). A RLS recorta por
// clinica; a leitura humana passa por auditarLeituraDePaciente na page.
//
// Uma consulta por bloco de dado, sem filtro aninhado de embed: o recorte que
// importa (o dia civil NO FUSO DA CLINICA) vem de limitesDoDia.

export type ConsultaDaConfirmacao = {
  id: string;
  contact_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  confirmation_channel: string | null;
  send_confirmation: boolean;
  contact: {
    id: string;
    name: string | null;
    phone_e164: string;
    no_show_count: number;
  } | null;
  professional: { id: string; name: string } | null;
  service_link: {
    id: string;
    procedure: { id: string; name: string } | null;
    insurance: { id: string; name: string } | null;
  } | null;
  /** Autorizacao vigente para receber mensagem no WhatsApp. */
  consent_ativo: boolean;
  /** Conversa aberta do contato, para o atalho "Abrir conversa". */
  conversation_id: string | null;
};

/** Falta de hoje, com o toque de recuperacao que ja saiu (se saiu). */
export type FaltaDoDia = ConsultaDaConfirmacao & {
  /** Instante do ultimo toque pos falta enviado; null quando nenhum saiu. */
  toque_pos_falta_em: string | null;
};

export type PassoDaReguaDaTela = {
  id: string;
  offset_minutes: number;
  fixed_body: string | null;
};

export type ReguaDeConfirmacao = {
  id: string;
  name: string;
  active: boolean;
  send_window_start: string | null;
  send_window_end: string | null;
  send_weekdays: number[] | null;
  passos: PassoDaReguaDaTela[];
  /**
   * A clinica ainda nao disparou NENHUM toque de regua. E o gatilho do aviso
   * da linha de base: a taxa de falta de hoje so pode ser registrada antes de
   * a primeira mensagem sair.
   */
  primeira_ativacao: boolean;
};

// Os tres baldes do bento. Ficam aqui porque a contagem da tela, o badge do
// menu e a Server Action de cobranca precisam do MESMO recorte.
export const STATUS_PENDENTES: AppointmentStatus[] = [
  "agendado",
  "aguardando_confirmacao",
];
export const STATUS_CONFIRMADOS: AppointmentStatus[] = [
  "confirmado_paciente",
  "confirmado_recepcao",
];
export const STATUS_CANCELADOS: AppointmentStatus[] = [
  "cancelado_paciente",
  "cancelado_clinica",
];

export const confirmacoesKeys = {
  dia: (clinicId: string, diaISO: string) =>
    ["confirmacoes", clinicId, "dia", diaISO] as const,
  faltas: (clinicId: string, diaISO: string) =>
    ["confirmacoes", clinicId, "faltas", diaISO] as const,
  regua: (clinicId: string) => ["confirmacoes", clinicId, "regua"] as const,
};

const CONSULTA_SELECT =
  "id, contact_id, professional_id, starts_at, ends_at, status, confirmation_channel, send_confirmation, contact:contact_id (id, name, phone_e164, no_show_count), professional:professional_id (id, name), service_link:service_link_id (id, procedure:procedure_id (id, name), insurance:insurance_id (id, name))";

function primeiro<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) {
    return valor[0] ?? null;
  }
  return valor ?? null;
}

function normalizarConsulta(
  row: Record<string, unknown>,
  consentPorContato: Map<string, boolean>,
  conversaPorContato: Map<string, string>,
): ConsultaDaConfirmacao {
  const vinculoBruto = primeiro(
    row.service_link as Record<string, unknown> | Record<string, unknown>[],
  );
  const service_link = vinculoBruto
    ? ({
        ...vinculoBruto,
        procedure: primeiro(vinculoBruto.procedure),
        insurance: primeiro(vinculoBruto.insurance),
      } as ConsultaDaConfirmacao["service_link"])
    : null;
  return {
    ...(row as object),
    contact: primeiro(row.contact),
    professional: primeiro(row.professional),
    service_link,
    consent_ativo: consentPorContato.get(row.contact_id as string) ?? false,
    conversation_id: conversaPorContato.get(row.contact_id as string) ?? null,
  } as ConsultaDaConfirmacao;
}

/** Conversa nao resolvida de cada contato, para o atalho da lista. */
async function conversasDosContatos(
  supabase: SupabaseClient,
  clinicId: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (contactIds.length === 0) {
    return mapa;
  }
  const { data } = await supabase
    .from("conversation")
    .select("id, contact_id")
    .eq("clinic_id", clinicId)
    .in("contact_id", contactIds)
    .neq("status", "resolvida");
  for (const linha of (data ?? []) as { id: string; contact_id: string }[]) {
    if (!mapa.has(linha.contact_id)) {
      mapa.set(linha.contact_id, linha.id);
    }
  }
  return mapa;
}

/**
 * Autorizacao vigente de cada contato, numa consulta so. Mesma regra da RPC
 * consentimento_vigente: a linha mais recente do canal manda, e uma revogacao
 * recente derruba um consentimento antigo.
 */
async function consentimentoDosContatos(
  supabase: SupabaseClient,
  clinicId: string,
  contactIds: string[],
): Promise<Map<string, boolean>> {
  const mapa = new Map<string, boolean>();
  if (contactIds.length === 0) {
    return mapa;
  }
  const { data } = await supabase
    .from("contact_consent")
    .select("contact_id, channel, granted_at, revoked_at")
    .eq("clinic_id", clinicId)
    .in("contact_id", contactIds);

  const porContato = new Map<string, LinhaConsent[]>();
  for (const linha of (data ?? []) as (LinhaConsent & {
    contact_id: string;
  })[]) {
    const lista = porContato.get(linha.contact_id) ?? [];
    lista.push(linha);
    porContato.set(linha.contact_id, lista);
  }
  for (const contactId of contactIds) {
    mapa.set(
      contactId,
      consentimentoVigenteDeLinhas(porContato.get(contactId) ?? []),
    );
  }
  return mapa;
}

/**
 * As consultas que COMECAM no dia civil da clinica, em ordem de horario.
 * Diferente da Agenda de proposito: confirmacao olha o inicio da consulta,
 * nao a ocupacao do dia, entao consulta que atravessa a meia-noite conta uma
 * vez so, no dia em que ela comeca.
 */
export async function fetchConfirmacoesDia(
  supabase: SupabaseClient,
  clinicId: string,
  diaISO: string,
  timezone: string,
): Promise<ConsultaDaConfirmacao[]> {
  const { inicio, fim } = limitesDoDia(timezone, diaISO);
  const { data, error } = await supabase
    .from("appointment")
    .select(CONSULTA_SELECT)
    .eq("clinic_id", clinicId)
    .gte("starts_at", inicio.toISOString())
    .lt("starts_at", fim.toISOString())
    .order("starts_at");
  if (error) {
    throw new Error(error.message);
  }
  const linhas = (data ?? []) as Record<string, unknown>[];
  const contactIds = [
    ...new Set(linhas.map((linha) => linha.contact_id as string)),
  ];
  const [consent, conversas] = await Promise.all([
    consentimentoDosContatos(supabase, clinicId, contactIds),
    conversasDosContatos(supabase, clinicId, contactIds),
  ]);
  return linhas.map((linha) => normalizarConsulta(linha, consent, conversas));
}

/**
 * Quem faltou no dia, com o toque de recuperacao que ja saiu. A falta e
 * sempre acao explicita de alguem (regra 3.5), entao esta lista e o que a
 * recepcao acabou de registrar, nunca inferencia por passagem de tempo.
 */
export async function fetchFaltasDeHoje(
  supabase: SupabaseClient,
  clinicId: string,
  diaISO: string,
  timezone: string,
): Promise<FaltaDoDia[]> {
  const { inicio, fim } = limitesDoDia(timezone, diaISO);
  const { data, error } = await supabase
    .from("appointment")
    .select(CONSULTA_SELECT)
    .eq("clinic_id", clinicId)
    .eq("status", "faltou")
    .gte("starts_at", inicio.toISOString())
    .lt("starts_at", fim.toISOString())
    .order("starts_at");
  if (error) {
    throw new Error(error.message);
  }
  const linhas = (data ?? []) as Record<string, unknown>[];
  if (linhas.length === 0) {
    return [];
  }
  const ids = linhas.map((linha) => linha.id as string);
  const contactIds = [
    ...new Set(linhas.map((linha) => linha.contact_id as string)),
  ];
  const [consent, conversas, toques] = await Promise.all([
    consentimentoDosContatos(supabase, clinicId, contactIds),
    conversasDosContatos(supabase, clinicId, contactIds),
    supabase
      .from("cadence_run")
      .select(
        "appointment_id, sent_at, cadence_step:cadence_step_id ( cadence:cadence_id ( kind ) )",
      )
      .eq("clinic_id", clinicId)
      .in("appointment_id", ids)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false }),
  ]);

  const ultimoToque = new Map<string, string>();
  for (const linha of (toques.data ?? []) as {
    appointment_id: string | null;
    sent_at: string | null;
    cadence_step: unknown;
  }[]) {
    const passo = primeiro(
      linha.cadence_step as Record<string, unknown> | Record<string, unknown>[],
    );
    const regua = passo
      ? primeiro(passo.cadence as { kind?: string } | { kind?: string }[])
      : null;
    if (regua?.kind !== "pos_falta" || !linha.appointment_id || !linha.sent_at) {
      continue;
    }
    if (!ultimoToque.has(linha.appointment_id)) {
      ultimoToque.set(linha.appointment_id, linha.sent_at);
    }
  }

  return linhas.map((linha) => ({
    ...normalizarConsulta(linha, consent, conversas),
    toque_pos_falta_em: ultimoToque.get(linha.id as string) ?? null,
  }));
}

/**
 * A regua de confirmacao PADRAO da clinica (sem excecao por procedimento e
 * sem reforco por historico de falta), com os passos em ordem de disparo. As
 * excecoes sao a Tela 7 (tarefa 4.8); aqui a recepcao liga a regua principal.
 */
export async function fetchReguaDeConfirmacao(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ReguaDeConfirmacao | null> {
  const { data: regua, error } = await supabase
    .from("cadence")
    .select(
      "id, name, active, send_window_start, send_window_end, send_weekdays",
    )
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!regua) {
    return null;
  }

  const [passos, jaEnviou] = await Promise.all([
    supabase
      .from("cadence_step")
      .select("id, offset_minutes, fixed_body")
      .eq("clinic_id", clinicId)
      .eq("cadence_id", regua.id as string)
      .order("offset_minutes"),
    supabase
      .from("cadence_run")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .not("sent_at", "is", null),
  ]);

  return {
    id: regua.id as string,
    name: regua.name as string,
    active: regua.active as boolean,
    send_window_start: (regua.send_window_start as string | null) ?? null,
    send_window_end: (regua.send_window_end as string | null) ?? null,
    send_weekdays: (regua.send_weekdays as number[] | null) ?? null,
    passos: (passos.data ?? []) as PassoDaReguaDaTela[],
    primeira_ativacao: (jaEnviou.count ?? 0) === 0,
  };
}
