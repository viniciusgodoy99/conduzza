"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { createAdminClient } from "@/lib/supabase/admin";

// Criacao de clinica pelo dono do produto (super administrador). E a porta de
// entrada da operacao: sem isto, quem administra o produto entra no sistema e
// nao consegue fazer nada. A tela completa de administracao e a Tela 14
// (tarefa 5.5); aqui fica o essencial.
//
// O caminho de cadastro publico (/cadastro) usa o gatilho handle_new_user, que
// so roda na criacao do usuario. Como o dono ja existe, a criacao aqui e
// explicita, com service role, replicando exatamente o que o gatilho faz.

export type CriarClinicaState = { error?: string };

const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome da clínica"),
});

function slugificar(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "clinica";
}

export async function criarClinicaAction(
  _prev: CriarClinicaState,
  formData: FormData,
): Promise<CriarClinicaState> {
  const parsed = schema.safeParse({ nome: formData.get("nome") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const context = await getSessionContext();
  if (!context) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  if (!context.isProductAdmin) {
    return { error: "Somente o dono do produto cria clínicas por aqui." };
  }

  const admin = createAdminClient();
  let slug = slugificar(parsed.data.nome);
  const { data: existente } = await admin
    .from("clinic")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existente) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
  }

  const { data: clinica, error: erroClinica } = await admin
    .from("clinic")
    .insert({ name: parsed.data.nome, slug })
    .select("id")
    .single();
  if (erroClinica || !clinica) {
    return { error: "Não foi possível criar a clínica. Tente de novo." };
  }

  const { error: erroBranding } = await admin
    .from("clinic_branding")
    .insert({ clinic_id: clinica.id });
  if (erroBranding) {
    // Sem marca a clinica fica meio criada: desfaz para nao deixar lixo.
    await admin.from("clinic").delete().eq("id", clinica.id);
    return { error: "Não foi possível criar a clínica. Tente de novo." };
  }

  const { error: erroMembro } = await admin.from("clinic_member").insert({
    clinic_id: clinica.id,
    user_id: context.userId,
    role: "admin",
    status: "ativo",
  });
  if (erroMembro) {
    await admin.from("clinic").delete().eq("id", clinica.id);
    return { error: "Não foi possível criar a clínica. Tente de novo." };
  }

  await admin.from("audit_log").insert({
    clinic_id: clinica.id,
    user_id: context.userId,
    action: "criou",
    entity: "clinic",
    entity_id: clinica.id,
  });

  revalidatePath("/", "layout");
  return {};
}
