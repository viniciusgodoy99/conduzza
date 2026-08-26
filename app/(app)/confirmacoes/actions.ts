"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { passoMaisProximoDoEvento } from "@/lib/domain/cadence";
import { horaParaMinutos } from "@/lib/domain/horarios";
import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";
import { canEdit } from "@/lib/domain/permissions";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";
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
  return { context, clinicId: context.active.clinicId };
}

async function requireConfirmacoes() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "confirmacoes_espera")) {
    return { error: "Seu perfil não pode alterar confirmações." as const };
  }
  return { context, clinicId: context.active.clinicId };
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
    return { ok: false, error: "A hora de fim precisa ser depois da de início." };
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

type ConsultaCobravel = {
  id: string;
  contact_id: string;
  starts_at: string;
};

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
  const agora = new Date();

  // Leitura pela SESSAO: a RLS confere a clinica e o papel. O service role so
  // aparece depois, para escrever no que so o worker escreve.
  const { data: consultas } = await supabase
    .from("appointment")
    .select("id, contact_id, starts_at")
    .eq("clinic_id", guard.clinicId)
    .in("id", parsed.data.appointment_ids)
    .in("status", STATUS_PENDENTES)
    .eq("send_confirmation", true)
    .gt("starts_at", agora.toISOString());
  const cobraveis = (consultas ?? []) as ConsultaCobravel[];
  if (cobraveis.length === 0) {
    return {
      ok: false,
      error: "Nenhuma dessas consultas está esperando confirmação.",
    };
  }

  // A regua PADRAO da clinica: e dela que sai o texto do toque. Excecao por
  // procedimento e regua reforcada sao a Tela 7 (tarefa 4.8).
  const { data: regua } = await supabase
    .from("cadence")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("kind", "confirmacao")
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (!regua) {
    return { ok: false, error: "A régua de confirmação não está configurada." };
  }
  const { data: passos } = await supabase
    .from("cadence_step")
    .select("id, offset_minutes")
    .eq("clinic_id", guard.clinicId)
    .eq("cadence_id", regua.id as string);
  const passosDaRegua = ((passos ?? []) as {
    id: string;
    offset_minutes: number;
  }[]).map((passo) => ({
    id: passo.id,
    offsetMinutes: passo.offset_minutes,
  }));
  if (passosDaRegua.length === 0) {
    return { ok: false, error: "A régua de confirmação não tem mensagens." };
  }

  // Autorizacao vigente numa consulta so (mesma regra da RPC
  // consentimento_vigente). Quem revogou nao entra na fila: regra 3.3.
  const contactIds = [...new Set(cobraveis.map((c) => c.contact_id))];
  const { data: consentimentos } = await supabase
    .from("contact_consent")
    .select("contact_id, channel, granted_at, revoked_at")
    .eq("clinic_id", guard.clinicId)
    .in("contact_id", contactIds);
  const porContato = new Map<string, LinhaConsent[]>();
  for (const linha of (consentimentos ?? []) as (LinhaConsent & {
    contact_id: string;
  })[]) {
    const lista = porContato.get(linha.contact_id) ?? [];
    lista.push(linha);
    porContato.set(linha.contact_id, lista);
  }

  // Truncado ao minuto de proposito: dois cliques seguidos caem na MESMA
  // chave (cadence_step_id, contact_id, scheduled_for) e o segundo nao cria
  // run nenhuma. E a trava do banco fazendo o trabalho, nao um controle de
  // tela. Contato com duas consultas no mesmo passo colapsa na mesma chave, e
  // por isso 'enfileirados' conta as runs CRIADAS, nunca as pedidas.
  const minutoAtual = new Date(
    Math.floor(agora.getTime() / 60_000) * 60_000,
  ).toISOString();

  const linhas: Record<string, unknown>[] = [];
  const cobrados: string[] = [];
  let puladosSemAutorizacao = 0;
  for (const consulta of cobraveis) {
    if (!consentimentoVigenteDeLinhas(porContato.get(consulta.contact_id) ?? [])) {
      puladosSemAutorizacao += 1;
      continue;
    }
    const minutosAte =
      (new Date(consulta.starts_at).getTime() - agora.getTime()) / 60_000;
    const passo = passoMaisProximoDoEvento(passosDaRegua, minutosAte);
    if (!passo) {
      continue;
    }
    linhas.push({
      clinic_id: guard.clinicId,
      cadence_step_id: passo.id,
      contact_id: consulta.contact_id,
      appointment_id: consulta.id,
      scheduled_for: minutoAtual,
    });
    cobrados.push(consulta.id);
  }

  if (linhas.length === 0) {
    return {
      ok: true,
      enfileirados: 0,
      pulados_sem_autorizacao: puladosSemAutorizacao,
    };
  }

  const admin = createAdminClient();
  const { data: criadas, error: erroRun } = await admin
    .from("cadence_run")
    .upsert(linhas, {
      onConflict: "cadence_step_id,contact_id,scheduled_for",
      ignoreDuplicates: true,
    })
    .select("id");
  if (erroRun) {
    return { ok: false, error: "Não foi possível enfileirar as cobranças." };
  }
  const novas = (criadas ?? []) as { id: string }[];
  if (novas.length > 0) {
    const { error: erroJob } = await admin.from("job_queue").insert(
      novas.map((run) => ({
        clinic_id: guard.clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: run.id, manual: true },
      })),
    );
    if (erroJob) {
      return { ok: false, error: "Não foi possível enfileirar as cobranças." };
    }
  }

  await supabase.from("audit_log").insert(
    cobrados.map((appointmentId) => ({
      clinic_id: guard.clinicId,
      user_id: guard.context.userId,
      action: "cobrou_confirmacao",
      entity: "appointment",
      entity_id: appointmentId,
    })),
  );
  revalidatePath("/confirmacoes");
  return {
    ok: true,
    enfileirados: novas.length,
    pulados_sem_autorizacao: puladosSemAutorizacao,
  };
}
