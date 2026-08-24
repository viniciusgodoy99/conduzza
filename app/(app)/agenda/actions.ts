"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import type { AppointmentStatus } from "@/lib/design/status";
import { exigeCanal, podeTransicionar } from "@/lib/domain/appointment-status";
import { canEdit } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Agenda (Tela 3). Guard: canEdit(role, "agenda"); o papel
// 'profissional' so age na propria agenda (a RLS confere de novo, na policy).
// Regras duras: conflito de horario e a exclusion constraint (23P01, nunca
// checagem de codigo); 'faltou' so por acao explicita; toda mudanca de
// status grava a linha do historico com autoria e canal.

export type AgendaActionResult = {
  ok: boolean;
  error?: string;
  code?: "conflito" | "ja_tratado";
  id?: string;
};

const idSchema = z.uuid();
const instanteSchema = z.iso.datetime({ offset: true });

const EXCLUSION_VIOLATION = "23P01";

async function requireAgendaEditor() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "agenda")) {
    return { error: "Seu perfil não pode alterar a agenda." as const };
  }
  return { context, clinicId: context.active.clinicId };
}

async function registrarHistorico(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  appointmentId: string,
  status: AppointmentStatus,
  userId: string,
): Promise<void> {
  await supabase.from("appointment_status_history").insert({
    clinic_id: clinicId,
    appointment_id: appointmentId,
    status,
    changed_by: "usuario",
    changed_by_user_id: userId,
  });
}

// ---------------------------------------------------------------------------
// Paciente rapido (o "criar ali mesmo" do modal)
// ---------------------------------------------------------------------------

const pacienteRapidoSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{10,15}$/, "Telefone com DDD, só números"),
});

export async function criarPacienteRapidoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = pacienteRapidoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Informe nome e telefone com DDD." };
  }
  const telefone = parsed.data.phone.startsWith("+")
    ? parsed.data.phone
    : `+55${parsed.data.phone}`;

  const supabase = await createClient();
  const { data: existente } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("phone_e164", telefone)
    .maybeSingle();
  if (existente) {
    return { ok: true, id: existente.id };
  }
  const { data, error } = await supabase
    .from("contact")
    .insert({
      clinic_id: guard.clinicId,
      name: parsed.data.name,
      phone_e164: telefone,
      kind: "paciente",
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível criar o cadastro." };
  }
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Criar agendamento (modal, tarefa 2.6)
// ---------------------------------------------------------------------------

const criarSchema = z.object({
  contact_id: idSchema,
  professional_id: idSchema,
  service_link_id: idSchema,
  unit_id: idSchema.nullable(),
  resource_id: idSchema.nullable(),
  starts_at: instanteSchema,
  ends_at: instanteSchema,
  is_overbooking: z.boolean(),
  send_confirmation: z.boolean(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function criarAgendamentoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do agendamento." };
  }
  if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) {
    return { ok: false, error: "O fim precisa ser depois do início." };
  }

  const supabase = await createClient();

  // Encaixe sob bloqueio que impede encaixe: recusar antes do insert (o
  // bloqueio nao e constraint; e regra de negocio do blocks_overbooking).
  if (parsed.data.is_overbooking) {
    const { data: bloqueios } = await supabase
      .from("professional_block")
      .select("id")
      .eq("clinic_id", guard.clinicId)
      .eq("professional_id", parsed.data.professional_id)
      .eq("blocks_overbooking", true)
      .lt("starts_at", parsed.data.ends_at)
      .gt("ends_at", parsed.data.starts_at)
      .limit(1);
    if (bloqueios && bloqueios.length > 0) {
      return {
        ok: false,
        error: "Este período está bloqueado sem permissão de encaixe.",
      };
    }
  }

  const { data, error } = await supabase
    .from("appointment")
    .insert({
      clinic_id: guard.clinicId,
      ...parsed.data,
      status: "agendado",
      created_by: "usuario",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        code: "conflito",
        error:
          "Este horário acabou de ser ocupado. Escolha outro ou marque como encaixe.",
      };
    }
    return { ok: false, error: "Não foi possível marcar a consulta." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou",
    entity: "appointment",
    entity_id: data.id,
  });
  revalidatePath("/agenda");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Remarcar (arrastar e soltar ou menu)
// ---------------------------------------------------------------------------

const remarcarSchema = z.object({
  id: idSchema,
  starts_at_esperado: instanteSchema,
  novo_starts_at: instanteSchema,
  novo_ends_at: instanteSchema,
  novo_professional_id: idSchema,
  avisar_paciente: z.boolean(),
});

export async function remarcarAgendamentoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = remarcarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o novo horário." };
  }

  const supabase = await createClient();
  // Update condicional no horario que a tela viu: se alguem mexeu antes,
  // zero linhas voltam e a tela avisa em vez de sobrescrever.
  const { data, error } = await supabase
    .from("appointment")
    .update({
      starts_at: parsed.data.novo_starts_at,
      ends_at: parsed.data.novo_ends_at,
      professional_id: parsed.data.novo_professional_id,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.id)
    .eq("starts_at", parsed.data.starts_at_esperado)
    .select("id");
  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        code: "conflito",
        error: "O horário de destino está ocupado.",
      };
    }
    return { ok: false, error: "Não foi possível remarcar." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Alguém já mexeu neste agendamento. Atualize a agenda.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "remarcou",
    entity: "appointment",
    entity_id: parsed.data.id,
  });
  // O aviso ao paciente e intencao registrada; o envio real e a regua (4.7).
  if (parsed.data.avisar_paciente) {
    await supabase.from("audit_log").insert({
      clinic_id: guard.clinicId,
      user_id: guard.context.userId,
      action: "pediu_aviso_de_remarcacao",
      entity: "appointment",
      entity_id: parsed.data.id,
    });
  }
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ciclo de status (tarefa 2.7)
// ---------------------------------------------------------------------------

const statusSchema = z.enum([
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
  "na_recepcao",
  "em_atendimento",
  "compareceu",
  "cancelado_paciente",
  "cancelado_clinica",
  "faltou",
]);

const mudarStatusSchema = z.object({
  id: idSchema,
  status_atual: statusSchema,
  novo_status: statusSchema,
  canal: z.enum(["whatsapp", "telefone", "presencial"]).nullable(),
});

export async function mudarStatusAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mudarStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Mudança de situação inválida." };
  }
  const { id, status_atual, novo_status, canal } = parsed.data;

  if (!podeTransicionar(status_atual, novo_status)) {
    return {
      ok: false,
      error: "Essa mudança de situação não é permitida daqui.",
    };
  }
  if (exigeCanal(novo_status) && !canal) {
    return { ok: false, error: "Informe como a confirmação chegou." };
  }

  const supabase = await createClient();
  // Condicional no status que a tela viu: corrida perde educadamente.
  const { data, error } = await supabase
    .from("appointment")
    .update({
      status: novo_status,
      ...(novo_status === "confirmado_recepcao"
        ? {
            confirmed_by_user_id: guard.context.userId,
            confirmation_channel: canal,
          }
        : {}),
      ...(novo_status === "faltou" ? {} : {}),
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .eq("status", status_atual)
    .select("id, contact_id");
  if (error) {
    return { ok: false, error: "Não foi possível mudar a situação." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "A situação desta consulta já mudou. Atualize a agenda.",
    };
  }

  await registrarHistorico(
    supabase,
    guard.clinicId,
    id,
    novo_status,
    guard.context.userId,
  );

  // Falta e SEMPRE explicita, e alimenta o contador do paciente (etiqueta de
  // risco e regua reforcada na Fase 4).
  if (novo_status === "faltou") {
    const contactId = data[0]?.contact_id as string | undefined;
    if (contactId) {
      const { data: contato } = await supabase
        .from("contact")
        .select("no_show_count")
        .eq("id", contactId)
        .single();
      await supabase
        .from("contact")
        .update({ no_show_count: (contato?.no_show_count ?? 0) + 1 })
        .eq("clinic_id", guard.clinicId)
        .eq("id", contactId);
    }
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "mudou_status",
    entity: "appointment",
    entity_id: id,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Encaixe da IA: aprovar e recusar (painel "Pendente de voce")
// ---------------------------------------------------------------------------

export async function aprovarEncaixeAction(
  id: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Encaixe inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment")
    .update({ approval_status: "aprovado" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("approval_status", "pendente")
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Este encaixe já foi tratado.",
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "aprovou_encaixe",
    entity: "appointment",
    entity_id: parsed.data,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

export async function recusarEncaixeAction(
  id: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Encaixe inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment")
    .update({ approval_status: "recusado", status: "cancelado_clinica" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("approval_status", "pendente")
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Este encaixe já foi tratado.",
    };
  }
  await registrarHistorico(
    supabase,
    guard.clinicId,
    parsed.data,
    "cancelado_clinica",
    guard.context.userId,
  );
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "recusou_encaixe",
    entity: "appointment",
    entity_id: parsed.data,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Exportacao e impressao: trilha antes do dado sair da tela (LGPD)
// ---------------------------------------------------------------------------

export async function registrarExportacaoAction(
  diaISO: unknown,
  formato: unknown,
): Promise<void> {
  const context = await getSessionContext();
  if (!context?.active) {
    return;
  }
  const parsedDia = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(diaISO);
  const parsedFormato = z.enum(["impressao", "csv"]).safeParse(formato);
  if (!parsedDia.success || !parsedFormato.success) {
    return;
  }
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: parsedFormato.data === "csv" ? "exportou" : "imprimiu",
    entity: "agenda_dia",
    entity_id: null,
  });
}
