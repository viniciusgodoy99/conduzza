"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { horaParaMinutos } from "@/lib/domain/horarios";
import { canEdit } from "@/lib/domain/permissions";
import { planejarCobrancaManual } from "@/lib/jobs/cobranca-manual";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 2 (Confirmacoes).
//
// Dois guards diferentes, de proposito:
// - a REGUA e configuracao de automacao: administrador e gestor (mesmo
//   recorte da policy "gestao escreve reguas");
// - COBRAR AGORA e operacao do dia: quem edita Confirmacoes, o que inclui a
//   recepcao (matriz do brief, secao 5).
//
// O service role entra SO nas duas escritas que a sessao nao pode fazer
// (cadence_run e job_queue nao tem policy de escrita: quem grava e o worker),
// e sempre depois de a sessao ter lido e validado a consulta pela RLS.

const idSchema = z.uuid();
const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export type ConfirmacoesActionResult = {
  ok: boolean;
  error?: string;
};

export type CobrancaResult = ConfirmacoesActionResult & {
  enfileirados?: number;
  pulados_sem_autorizacao?: number;
};

// Violacao de check do Postgres. Aqui so chega em um caso: ligar a regua sem
// janela preenchida (check active_exige_janela).
const CHECK_VIOLATION = "23514";

async function requireAutomacoes() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "automacoes")) {
    return {
      error:
        "Somente administradores e gestores alteram as automações." as const,
    };
  }
  return {
    context,
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
  };
}

async function requireConfirmacoes() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "confirmacoes_espera")) {
    return { error: "Seu perfil não pode alterar confirmações." as const };
  }
  return {
    context,
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
  };
}

// ---------------------------------------------------------------------------
// Janela de envio: a clinica informa, o codigo nao inventa
// ---------------------------------------------------------------------------

const janelaSchema = z.object({
  cadence_id: idSchema,
  send_window_start: horaSchema,
  send_window_end: horaSchema,
  // 0 = domingo, mesma convencao de professional_schedule.weekday.
  send_weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export async function salvarJanelaDaReguaAction(
  input: unknown,
): Promise<ConfirmacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = janelaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Informe a hora de início, a hora de fim e ao menos um dia.",
    };
  }
  const { cadence_id, send_window_start, send_window_end } = parsed.data;
  // Espelha o check janela_coerente: a janela nao atravessa a meia-noite.
  if (horaParaMinutos(send_window_end) <= horaParaMinutos(send_window_start)) {
    return {
      ok: false,
      error: "A hora de fim precisa ser depois da de início.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence")
    .update({
      send_window_start,
      send_window_end,
      send_weekdays: [...new Set(parsed.data.send_weekdays)].sort(),
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", cadence_id)
    .select("id");
  if (error) {
    return { ok: false, error: "Não foi possível salvar o horário de envio." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Régua não encontrada." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "salvou_janela_da_regua",
    entity: "cadence",
    entity_id: cadence_id,
  });
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ligar e desligar a regua
// ---------------------------------------------------------------------------

const alternarSchema = z.object({
  cadence_id: idSchema,
  ativar: z.boolean(),
});

export async function alternarReguaAction(
  input: unknown,
): Promise<ConfirmacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alternarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Régua inválida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence")
    .update({ active: parsed.data.ativar })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id)
    .select("id");
  if (error) {
    if (error.code === CHECK_VIOLATION) {
      return {
        ok: false,
        error:
          "Preencha e salve o horário de envio e os dias antes de ligar a régua.",
      };
    }
    return { ok: false, error: "Não foi possível mudar a régua." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Régua não encontrada." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: parsed.data.ativar ? "ativou_regua" : "desativou_regua",
    entity: "cadence",
    entity_id: parsed.data.cadence_id,
  });
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cobrar agora
// ---------------------------------------------------------------------------

const cobrarSchema = z.object({
  appointment_ids: z.array(idSchema).min(1).max(200),
});

/**
 * Toque de confirmacao pedido POR UMA PESSOA, agora. Nao envia daqui: cria a
 * cadence_run e o job, e o worker faz o resto (consentimento reconferido,
 * espacamento anti-ban, custo gravado, idempotencia por job_id). E a mesma
 * maquina da regua automatica, com a marca 'manual' no payload.
 */
export async function cobrarAgoraAction(
  input: unknown,
): Promise<CobrancaResult> {
  const guard = await requireConfirmacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = cobrarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha ao menos uma consulta." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // A logica vive em lib/jobs/cobranca-manual.ts: e o mesmo codigo que o teste
  // de integracao exercita. Aqui ficam so os guards da sessao, a trilha e o
  // revalidate, que nao existem fora de uma requisicao.
  const resultado = await planejarCobrancaManual(supabase, admin, {
    clinicId: guard.clinicId,
    // O fuso da clinica decide se o texto diz "hoje" ou "amanha": o do
    // servidor nao tem nada a ver com o calendario do paciente (regra 3.6).
    timezone: guard.timezone,
    appointmentIds: parsed.data.appointment_ids,
  });
  if (!resultado.ok) {
    return { ok: false, error: resultado.error };
  }

  if (resultado.cobrados.length > 0) {
    await supabase.from("audit_log").insert(
      resultado.cobrados.map((appointmentId) => ({
        clinic_id: guard.clinicId,
        user_id: guard.context.userId,
        action: "cobrou_confirmacao",
        entity: "appointment",
        entity_id: appointmentId,
      })),
    );
  }
  revalidatePath("/confirmacoes");
  return {
    ok: true,
    enfileirados: resultado.enfileirados,
    pulados_sem_autorizacao: resultado.pulados_sem_autorizacao,
  };
}
