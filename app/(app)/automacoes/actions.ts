"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 7 (Automacoes). Mesmo guard da regua na Tela 2:
// configuracao de automacao e assunto de administrador e gestor (policy
// "gestao escreve passos" no banco; a checagem aqui existe porque esconder
// botao nao protege nada, regra 3.4).
//
// Cliente de SESSAO sempre: a RLS decide, e a prova automatizada dela ja
// existe em tests/rls/reguas.test.ts (gestor edita texto do passo, recepcao
// recebe 42501).

export type AutomacoesActionResult = { ok: boolean; error?: string };

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

const textoSchema = z.object({
  cadence_step_id: z.uuid(),
  // 2000 caracteres cobre com folga qualquer texto de recepcao; o corpo cru
  // vai para o WhatsApp, entao tamanho desgovernado seria mensagem quebrada.
  fixed_body: z.string().trim().min(1).max(2000),
});

export async function salvarTextoDoPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = textoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Escreva a mensagem antes de salvar (até 2000 caracteres).",
    };
  }

  const supabase = await createClient();
  const { data: linhas, error } = await supabase
    .from("cadence_step")
    .update({ fixed_body: parsed.data.fixed_body })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .select("id");
  if (error || !linhas || linhas.length === 0) {
    return { ok: false, error: "Não foi possível salvar o texto." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "salvou_texto_do_passo",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}
