"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Acoes de equipe: liberar quem pediu entrada por codigo, recusar, mudar o
// papel de quem ja esta na clinica, tirar e devolver acesso, e gerir o codigo
// de acesso. Tudo com a sessao do usuario (RLS aplica) e com checagem
// explicita de papel: administrador e gestor gerenciam a equipe (decisao do
// dono em 25/08/2026), com o gestor barrado em tudo que envolve administrador.

export type TeamActionResult = { ok: boolean; error?: string };

const papelSchema = z.enum([
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
]);

const alvoSchema = z.object({ user_id: z.uuid() });
const mudarPapelSchema = z.object({ user_id: z.uuid(), papel: papelSchema });

async function requireGestorOuAdmin() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error:
        permissionHint(role, "configuracoes") ??
        "Somente administradores e gestores gerenciam a equipe.",
    };
  }
  return { context, clinicId: context.active.clinicId, role };
}

// Os gatilhos de clinic_member (migration 20260825160000) recusam em portugues
// e ja explicam o motivo. Repassar a mensagem do banco ajuda muito mais que um
// "algo deu errado" generico. Erro de policy nao vaza detalhe: vira permissao.
const RECUSAS_DO_BANCO = [
  "Somente um administrador",
  "A clínica precisa de pelo menos um administrador ativo.",
  "Você não pode alterar o próprio papel",
];

function mensagemDeErro(
  error: { code?: string; message?: string } | null,
  fallback: string,
): string {
  if (!error) {
    return fallback;
  }
  if (error.code === "42501") {
    return "Seu perfil não altera o acesso da equipe.";
  }
  const mensagem = error.message ?? "";
  if (RECUSAS_DO_BANCO.some((trecho) => mensagem.includes(trecho))) {
    return mensagem;
  }
  return fallback;
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action: string,
  entityId: string,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity: "clinic_member",
    entity_id: entityId,
  });
}

type Alvo = { role: Role; status: "ativo" | "pendente" | "inativo" };

async function carregarAlvo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
): Promise<Alvo | null> {
  const { data } = await supabase
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Alvo | null) ?? null;
}

// Guarda de aplicacao rodada ANTES do banco. Os gatilhos recusam do mesmo
// jeito, mas aqui a recusa sai antes da escrita e com o nome da acao certa.
function barrarMexidaEmAdmin(
  quemChama: Role,
  papelDoAlvo: Role,
): string | null {
  if (quemChama === "admin") {
    return null;
  }
  if (papelDoAlvo === "admin") {
    return "Somente um administrador altera o acesso de outro administrador.";
  }
  return null;
}

export async function aprovarMembroAction(
  userId: string,
  papel: string,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  const parsedPapel = papelSchema.safeParse(papel);
  if (!parsedUser.success || !parsedPapel.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  if (guard.role !== "admin" && parsedPapel.data === "admin") {
    return {
      ok: false,
      error: "Somente um administrador cria outro administrador.",
    };
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
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível liberar o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pedido já foi tratado." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "liberou_acesso",
    parsedUser.data,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function recusarMembroAction(
  userId: string,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  if (!parsedUser.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinic_member")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", parsedUser.data)
    .eq("status", "pendente")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível recusar o pedido."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pedido já foi tratado." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "recusou_acesso",
    parsedUser.data,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function mudarPapelAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mudarPapelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const { user_id: alvoId, papel } = parsed.data;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não altera o próprio papel." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }
  if (guard.role !== "admin" && papel === "admin") {
    return {
      ok: false,
      error: "Somente um administrador cria outro administrador.",
    };
  }
  if (alvo.role === papel) {
    return { ok: true };
  }

  // Update condicional pelo papel lido: se alguem mudou antes numa outra aba,
  // nenhuma linha volta e a tela avisa em vez de sobrescrever calada.
  const { data, error } = await supabase
    .from("clinic_member")
    .update({ role: papel })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("role", alvo.role)
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível mudar o papel."),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "O papel mudou em outro lugar. Recarregue a página.",
    };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "mudou_papel",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function desativarMembroAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const alvoId = parsed.data.user_id;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não tira o próprio acesso." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }

  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "inativo" })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("status", "ativo")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível tirar o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Esta pessoa já está sem acesso." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "desativou_acesso",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function reativarMembroAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const alvoId = parsed.data.user_id;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não altera o próprio acesso." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }

  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "ativo" })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("status", "inativo")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível devolver o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Esta pessoa já tem acesso." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "reativou_acesso",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function gerarNovoCodigoAction(): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const supabase = await createClient();
  // Codigo e segredo de acesso: gerador criptografico (randomBytes), nunca
  // Math.random, que e previsivel. 10 caracteres de alfabeto sem ambiguidade.
  // O unique do banco confere; o valor antigo para de funcionar na hora, que
  // e o objetivo da rotacao. A tabela clinic_access_code e legivel e
  // atualizavel so por quem gerencia a clinica (policy propria).
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const novo = Array.from(
    bytes,
    (byte) => alfabeto[byte % alfabeto.length],
  ).join("");
  const { error } = await supabase
    .from("clinic_access_code")
    .update({ code: novo })
    .eq("clinic_id", guard.clinicId);
  if (error) {
    return { ok: false, error: "Não foi possível gerar um código novo." };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function alternarCodigoAction(
  ativo: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.boolean().safeParse(ativo);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic")
    .update({ allow_code_signup: parsed.data })
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
