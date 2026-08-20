"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

// Acoes de equipe: aprovar quem pediu entrada por codigo, recusar, e gerir o
// proprio codigo de acesso da clinica. Tudo com a sessao do usuario (RLS
// aplica) e com checagem explicita de papel administrador.

export type TeamActionResult = { ok: boolean; error?: string };

const papelSchema = z.enum([
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
]);

async function requireAdmin() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (context.active.role !== "admin") {
    return { error: "Somente administradores gerenciam a equipe." as const };
  }
  return { context, clinicId: context.active.clinicId };
}

export async function aprovarMembroAction(
  userId: string,
  papel: string,
): Promise<TeamActionResult> {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  const parsedPapel = papelSchema.safeParse(papel);
  if (!parsedUser.success || !parsedPapel.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "ativo", role: parsedPapel.data })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", parsedUser.data)
    .eq("status", "pendente")
    .select("user_id");
  if (error) {
    return { ok: false, error: "Não foi possível liberar o acesso." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pedido já foi tratado." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "liberou_acesso",
    entity: "clinic_member",
    entity_id: parsedUser.data,
  });
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function recusarMembroAction(
  userId: string,
): Promise<TeamActionResult> {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  if (!parsedUser.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic_member")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", parsedUser.data)
    .eq("status", "pendente");
  if (error) {
    return { ok: false, error: "Não foi possível recusar o pedido." };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function gerarNovoCodigoAction(): Promise<TeamActionResult> {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const supabase = await createClient();
  // Codigo novo gerado no cliente e conferido pelo unique do banco: o valor
  // antigo para de funcionar na hora, que e o objetivo da rotacao.
  const novo = Array.from({ length: 8 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
  ).join("");
  const { error } = await supabase
    .from("clinic")
    .update({ access_code: novo })
    .eq("id", guard.clinicId);
  if (error) {
    return { ok: false, error: "Não foi possível gerar um código novo." };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function alternarCodigoAction(
  ativo: boolean,
): Promise<TeamActionResult> {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic")
    .update({ allow_code_signup: ativo })
    .eq("id", guard.clinicId);
  if (error) {
    return {
      ok: false,
      error: "Não foi possível alterar a entrada por código.",
    };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}
