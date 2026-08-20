"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ACTIVE_CLINIC_COOKIE,
  getSessionContext,
} from "@/lib/auth/active-clinic";
import { can } from "@/lib/domain/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions de autenticacao. Toda mutacao valida a entrada com Zod
// (regra do CLAUDE.md); mensagens de erro sao genericas de proposito.

export type ActionState = { error?: string; success?: string };

async function siteOrigin(): Promise<string> {
  const headerStore = await headers();
  return (
    headerStore.get("origin") ??
    `http://${headerStore.get("host") ?? "localhost:3000"}`
  );
}

const credentialsSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(6, "Informe a senha"),
});

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "E-mail ou senha incorretos" };
  }

  const context = await getSessionContext();
  if (!context || context.memberships.length === 0) {
    if (context?.isProductAdmin) {
      redirect("/inicio");
    }
    await supabase.auth.signOut();
    return {
      error:
        "Seu usuário ainda não pertence a nenhuma clínica. Fale com o administrador.",
    };
  }
  if (context.memberships.length > 1 && !context.active) {
    redirect("/selecionar-clinica");
  }
  redirect("/inicio");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_CLINIC_COOKIE);
  redirect("/login");
}

const pickClinicSchema = z.object({ clinicId: z.uuid() });

export async function pickClinicAction(formData: FormData): Promise<void> {
  const parsed = pickClinicSchema.safeParse({
    clinicId: formData.get("clinicId"),
  });
  if (!parsed.success) {
    redirect("/selecionar-clinica");
  }
  const context = await getSessionContext();
  const membership = context?.memberships.find(
    (m) => m.clinicId === parsed.data.clinicId,
  );
  if (!context || !membership) {
    redirect("/selecionar-clinica");
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLINIC_COOKIE, membership.clinicId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/inicio");
}

const emailSchema = z.object({ email: z.email("Informe um e-mail válido") });

export async function recoverPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const supabase = await createClient();
  const origin = await siteOrigin();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/confirm?next=/redefinir-senha`,
  });
  // Mesma resposta existindo ou nao a conta: nao vazar quem tem cadastro.
  return {
    success:
      "Se este e-mail tiver cadastro, você vai receber um link para redefinir a senha.",
  };
}

const passwordSchema = z.object({
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres"),
});

export async function updatePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return {
      error: "Não foi possível salvar a senha. Abra o link do e-mail de novo.",
    };
  }
  redirect("/inicio");
}

const inviteSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  role: z.enum(["admin", "gestor", "recepcao", "profissional", "leitura"]),
});

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  if (can(context.active.role, "configuracoes") !== "tudo") {
    return { error: "Somente administradores convidam usuários" };
  }

  const admin = createAdminClient();
  const origin = await siteOrigin();
  const invited = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${origin}/confirm?next=/convite`,
  });
  if (invited.error || !invited.data.user) {
    return {
      error:
        "Não foi possível convidar. Confira o e-mail ou veja se a pessoa já tem acesso.",
    };
  }

  // O vinculo e criado com a sessao do proprio admin: a policy de
  // clinic_member autoriza, e o uso de service role fica restrito ao GoTrue.
  const supabase = await createClient();
  // Convite por e-mail e nominal: o administrador escolheu a pessoa e o papel,
  // entao o vinculo ja nasce ativo (diferente da entrada por codigo).
  const { error: memberError } = await supabase.from("clinic_member").insert({
    clinic_id: context.active.clinicId,
    user_id: invited.data.user.id,
    role: parsed.data.role,
    status: "ativo",
  });
  if (memberError) {
    return { error: "Convite enviado, mas o vínculo falhou. Tente de novo." };
  }

  revalidatePath("/configuracoes");
  return { success: `Convite enviado para ${parsed.data.email}` };
}
