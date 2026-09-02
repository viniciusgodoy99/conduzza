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

/**
 * O que aconteceu com o toque automatico desta consulta. E o que faltava para
 * a recepcao parar de trabalhar as cegas: sem isto, "toque enviado", "toque na
 * fila", "toque pulado por falta de autorizacao" e "motor parado, nada foi
 * planejado" apareciam todos como a mesma linha pendente.
 */
export type EstadoDoToque =
  | { situacao: "enviado"; em: string }
  | { situacao: "na_fila"; para: string }
  | { situacao: "pulado"; motivo: string }
  | { situacao: "nenhum" };

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
  /** O que a regua fez (ou nao fez) por esta consulta ate agora. */
  toque: EstadoDoToque;
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
  /**
   * Quantos toques DESTA regua sairam nas ultimas 24 horas e quantos foram
   * pulados. Sem isto, "Regua ligada" era a unica informacao da tela, e uma
   * regua ligada com o motor parado ficava identica a uma regua trabalhando.
   */
  enviados_24h: number;
  pulados_24h: number;
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
  toquePorConsulta?: Map<string, EstadoDoToque>,
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
    toque: toquePorConsulta?.get(row.id as string) ?? { situacao: "nenhum" },
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
 * O ultimo toque de cada consulta, com o que aconteceu com ele. Uma consulta
 * so por lote: a lista do dia tem dezenas de linhas e uma consulta por linha
 * seria N+1.
 *
 * A run mais recente manda. "Mais recente" e por scheduled_for: enviada,
 * pulada e na fila convivem quando a regua tem tres toques, e o que a recepcao
 * precisa ver e o ultimo estado, nao o primeiro.
 */
async function toquesDasConsultas(
  supabase: SupabaseClient,
  clinicId: string,
  appointmentIds: string[],
  kind: "confirmacao" | "pos_falta",
): Promise<Map<string, EstadoDoToque>> {
  const mapa = new Map<string, EstadoDoToque>();
  if (appointmentIds.length === 0) {
    return mapa;
  }
  const { data } = await supabase
    .from("cadence_run")
    .select(
      "appointment_id, scheduled_for, sent_at, skipped_reason, cadence_step:cadence_step_id ( cadence:cadence_id ( kind ) )",
    )
    .eq("clinic_id", clinicId)
    .in("appointment_id", appointmentIds)
    .order("scheduled_for", { ascending: false });

  for (const linha of (data ?? []) as {
    appointment_id: string | null;
    scheduled_for: string | null;
    sent_at: string | null;
    skipped_reason: string | null;
    cadence_step: unknown;
  }[]) {
    if (!linha.appointment_id || mapa.has(linha.appointment_id)) {
      continue;
    }
    const passo = primeiro(
      linha.cadence_step as Record<string, unknown> | Record<string, unknown>[],
    );
    const regua = passo
      ? primeiro(passo.cadence as { kind?: string } | { kind?: string }[])
      : null;
    if (regua?.kind !== kind) {
      continue;
    }
    if (linha.sent_at) {
      mapa.set(linha.appointment_id, {
        situacao: "enviado",
        em: linha.sent_at,
      });
    } else if (linha.skipped_reason) {
      mapa.set(linha.appointment_id, {
        situacao: "pulado",
        motivo: linha.skipped_reason,
      });
    } else if (linha.scheduled_for) {
      mapa.set(linha.appointment_id, {
        situacao: "na_fila",
        para: linha.scheduled_for,
      });
    }
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
  const [consent, conversas, toques] = await Promise.all([
    consentimentoDosContatos(supabase, clinicId, contactIds),
    conversasDosContatos(supabase, clinicId, contactIds),
    toquesDasConsultas(
      supabase,
      clinicId,
      linhas.map((linha) => linha.id as string),
      "confirmacao",
    ),
  ]);
  return linhas.map((linha) =>
    normalizarConsulta(linha, consent, conversas, toques),
  );
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
    toquesDasConsultas(supabase, clinicId, ids, "pos_falta"),
  ]);

  return linhas.map((linha) => {
    const toque = toques.get(linha.id as string) ?? {
      situacao: "nenhum" as const,
    };
    return {
      ...normalizarConsulta(linha, consent, conversas, toques),
      toque_pos_falta_em: toque.situacao === "enviado" ? toque.em : null,
    };
  });
}

/**
 * A regua PADRAO da clinica para um tipo (sem excecao por procedimento e sem
 * reforco por historico de falta), com os passos em ordem de disparo. As
 * excecoes sao a Tela 7 (tarefa 4.8); aqui a recepcao liga a regua principal.
 */
export async function fetchReguaPadrao(
  supabase: SupabaseClient,
  clinicId: string,
  kind: "confirmacao" | "pos_falta",
): Promise<ReguaDeConfirmacao | null> {
  const { data: regua, error } = await supabase
    .from("cadence")
    .select(
      "id, name, active, send_window_start, send_window_end, send_weekdays",
    )
    .eq("clinic_id", clinicId)
    .eq("kind", kind)
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!regua) {
    return null;
  }

  const desde24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [passos, jaEnviou, enviados, pulados] = await Promise.all([
    supabase
      .from("cadence_step")
      .select("id, offset_minutes, fixed_body")
      .eq("clinic_id", clinicId)
      .eq("cadence_id", regua.id as string)
      .order("offset_minutes"),
    // So responde um booleano (primeira ativacao): basta existir UMA linha.
    // O count exact varria todas as cadence_run da clinica, que so crescem.
    supabase
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", clinicId)
      .not("sent_at", "is", null)
      .limit(1),
    supabase
      .from("cadence_run")
      .select("id, cadence_step!inner(cadence_id)", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("cadence_step.cadence_id", regua.id as string)
      .gte("sent_at", desde24h),
    supabase
      .from("cadence_run")
      .select("id, cadence_step!inner(cadence_id)", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("cadence_step.cadence_id", regua.id as string)
      .not("skipped_reason", "is", null)
      .gte("scheduled_for", desde24h),
  ]);

  return {
    id: regua.id as string,
    name: regua.name as string,
    active: regua.active as boolean,
    send_window_start: (regua.send_window_start as string | null) ?? null,
    send_window_end: (regua.send_window_end as string | null) ?? null,
    send_weekdays: (regua.send_weekdays as number[] | null) ?? null,
    passos: (passos.data ?? []) as PassoDaReguaDaTela[],
    primeira_ativacao: (jaEnviou.data ?? []).length === 0,
    enviados_24h: enviados.count ?? 0,
    pulados_24h: pulados.count ?? 0,
  };
}

/** As duas reguas que o painel da Tela 2 liga: confirmacao e pos falta. */
export type ReguasDaClinica = {
  confirmacao: ReguaDeConfirmacao | null;
  pos_falta: ReguaDeConfirmacao | null;
};

export async function fetchReguasDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ReguasDaClinica> {
  const [confirmacao, posFalta] = await Promise.all([
    fetchReguaPadrao(supabase, clinicId, "confirmacao"),
    fetchReguaPadrao(supabase, clinicId, "pos_falta"),
  ]);
  return { confirmacao, pos_falta: posFalta };
}
