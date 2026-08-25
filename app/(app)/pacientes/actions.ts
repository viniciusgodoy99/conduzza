"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Action da ficha do paciente (Tela 9, tarefa 4.5). Uma so: editar o
// cadastro. Consentimento, pacote e etiqueta ja existem em
// app/(app)/leads/actions.ts e sao IMPORTADAS pela ficha, nao reescritas: a
// regra de revogacao definitiva e a de evidencia de reconsentimento moram num
// lugar so. Guard, Zod, cliente de SESSAO (a RLS manda) e audit_log seguem o
// molde de requireLeadsWriter.

export type PacientesActionResult = { ok: boolean; error?: string };

const idSchema = z.uuid();

async function requirePacientesWriter() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "leads_pacientes")) {
    return {
      error:
        permissionHint(context.active.role, "leads_pacientes") ??
        "Seu perfil não pode editar leads e pacientes",
    };
  }
  return { context, clinicId: context.active.clinicId };
}

// Campo anulavel: null LIMPA, texto troca. O formulario da ficha manda todos
// os campos a cada salvamento, entao nao existe caso de campo ausente.
const atualizarPacienteSchema = z.object({
  contact_id: idSchema,
  name: z.string().trim().min(2).max(120).nullable(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  email: z.email().max(160).nullable(),
  // So digitos: a mascara e da tela, o banco guarda o numero limpo.
  cpf: z
    .string()
    .regex(/^\d{11}$/)
    .nullable(),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  insurance_id: idSchema.nullable(),
  insurance_card: z.string().trim().min(1).max(60).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function atualizarPacienteAction(
  input: unknown,
): Promise<PacientesActionResult> {
  const guard = await requirePacientesWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = atualizarPacienteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do cadastro." };
  }
  const dados = parsed.data;

  const supabase = await createClient();
  // O contato precisa ser da clinica ativa. A RLS ja recorta, mas sem esta
  // conferencia um id de fora voltaria "não foi possível salvar" sem dizer
  // por que.
  const { data: dono } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.contact_id)
    .maybeSingle();
  if (!dono) {
    return { ok: false, error: "Paciente não encontrado nesta clínica." };
  }
  // Convenio de OUTRA clinica nao entra: a chave estrangeira aponta para
  // insurance sem olhar clinica, entao a checagem tem que ser explicita.
  if (dados.insurance_id !== null) {
    const { data: convenio } = await supabase
      .from("insurance")
      .select("id")
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.insurance_id)
      .maybeSingle();
    if (!convenio) {
      return { ok: false, error: "Convênio não encontrado nesta clínica." };
    }
  }

  const { data, error } = await supabase
    .from("contact")
    .update({
      name: dados.name,
      phone_e164: dados.phone_e164,
      email: dados.email,
      cpf: dados.cpf,
      birth_date: dados.birth_date,
      insurance_id: dados.insurance_id,
      insurance_card: dados.insurance_card,
      notes: dados.notes,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.contact_id)
    .select("id");
  if (error || !data || data.length === 0) {
    if (error?.code === "23505") {
      return { ok: false, error: "Já existe um contato com este telefone." };
    }
    return { ok: false, error: "Não foi possível salvar o cadastro." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "editou",
    entity: "contact",
    entity_id: dados.contact_id,
  });
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${dados.contact_id}`);
  revalidatePath("/leads");
  return { ok: true };
}
