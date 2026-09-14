"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 10 (Lista de espera). Guard pela matriz do brief:
// Confirmacoes e Lista de espera sao operacao do dia, quem edita inclui a
// recepcao (chave confirmacoes_espera). A configuracao da reoferta e a
// excecao: mora na tabela clinic, cuja policy de UPDATE e so de
// administrador, e a action espelha isso.
//
// Cliente de SESSAO sempre: a RLS decide (e a prova esta em
// tests/rls/lista-espera.test.ts).

export type EsperaActionResult = { ok: boolean; error?: string };

async function requireEspera() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "confirmacoes_espera")) {
    return { error: "Seu perfil não altera a lista de espera." as const };
  }
  return { context, clinicId: context.active.clinicId };
}

const TURNOS = ["manha", "tarde", "noite"] as const;

const adicionarSchema = z.object({
  contact_id: z.uuid(),
  procedure_id: z.uuid().nullable(),
  professional_id: z.uuid().nullable(),
  preferred_shifts: z.array(z.enum(TURNOS)).max(3),
  preferred_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
});

export async function adicionarNaEsperaAction(
  input: unknown,
): Promise<EsperaActionResult> {
  const guard = await requireEspera();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = adicionarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha o paciente e confira o pedido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("waitlist").insert({
    clinic_id: guard.clinicId,
    ...parsed.data,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Este paciente já está na lista para esse pedido."
          : "Não foi possível adicionar à lista.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "adicionou_lista_espera",
    entity: "contact",
    entity_id: parsed.data.contact_id,
  });
  revalidatePath("/espera");
  return { ok: true };
}

export async function removerDaEsperaAction(
  input: unknown,
): Promise<EsperaActionResult> {
  const guard = await requireEspera();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: linhas, error } = await supabase
    .from("waitlist")
    .update({ active: false })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.id)
    .eq("active", true)
    .select("contact_id");
  if (error || !linhas || linhas.length === 0) {
    return { ok: false, error: "Esta entrada já saiu da lista." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "removeu_lista_espera",
    entity: "contact",
    entity_id: linhas[0]!.contact_id as string,
  });
  revalidatePath("/espera");
  return { ok: true };
}

export async function moverPrioridadeAction(
  input: unknown,
): Promise<EsperaActionResult> {
  const guard = await requireEspera();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ id: z.uuid(), nova_posicao: z.number().int().min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mover_na_lista_de_espera", {
    p_clinic_id: guard.clinicId,
    p_id: parsed.data.id,
    p_nova_posicao: parsed.data.nova_posicao,
  });
  if (error) {
    return { ok: false, error: "Não foi possível reordenar. Tente de novo." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "reordenou_lista_espera",
    entity: "waitlist",
    entity_id: parsed.data.id,
  });
  revalidatePath("/espera");
  return { ok: true };
}

export async function cancelarReofertaAction(
  input: unknown,
): Promise<EsperaActionResult> {
  const guard = await requireEspera();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ offer_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  // Condicionado a 'aberta': corrida com o vencedor perde educadamente (a
  // RPC do aceite exige aberta, entao quem respondeu depois do cancelamento
  // recebe a recusa educada).
  const { data: linhas, error } = await supabase
    .from("waitlist_offer")
    .update({ status: "cancelada" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.offer_id)
    .eq("status", "aberta")
    .select("id");
  if (error || !linhas || linhas.length === 0) {
    return { ok: false, error: "Esta reoferta já foi encerrada." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "cancelou_reoferta",
    entity: "waitlist_offer",
    entity_id: parsed.data.offer_id,
  });
  revalidatePath("/espera");
  return { ok: true };
}

const configSchema = z.object({
  wave_size: z.number().int().min(1).max(20),
  response_minutes: z.number().int().min(5).max(240),
});

export async function salvarConfigReofertaAction(
  input: unknown,
): Promise<EsperaActionResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  // A policy de UPDATE de clinic e so de administrador; a checagem aqui
  // espelha o banco para a recusa falar portugues.
  if (context.active.role !== "admin") {
    return {
      ok: false,
      error: "Somente administradores alteram a configuração da reoferta.",
    };
  }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Onda de 1 a 20 pessoas e janela de 5 a 240 minutos.",
    };
  }

  const supabase = await createClient();
  const { data: linhas, error } = await supabase
    .from("clinic")
    .update({
      waitlist_wave_size: parsed.data.wave_size,
      waitlist_response_minutes: parsed.data.response_minutes,
    })
    .eq("id", context.active.clinicId)
    .select("id");
  if (error || !linhas || linhas.length === 0) {
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: "configurou_reoferta",
    entity: "clinic",
    entity_id: context.active.clinicId,
  });
  revalidatePath("/espera");
  return { ok: true };
}
