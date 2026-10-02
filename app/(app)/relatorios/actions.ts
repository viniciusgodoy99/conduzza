"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

// Server Actions da tela de Resultados (Telas 5/11).
//
// O objetivo de conversao (Fase 3, A3) e a meta da clinica para a Taxa de
// conversao da Visao geral: so admin e gestor definem ou removem, todo
// membro ativo le. A RLS de objetivo_de_conversao e quem garante o papel e a
// autoria (definido_por = auth.uid()); o guard aqui devolve mensagem digna.
//
// A linha de base de no-show e a metade da tarefa 6.3 que vive no sistema:
// o numero e INFORMADO pela clinica (medicao pre-implantacao), so admin
// registra, e corrigir e inserir linha nova (a tabela e append-only, sem
// UPDATE nem DELETE por policy: a historia nao se reescreve). A RLS e quem
// garante o papel; o guard aqui so devolve mensagem digna.

export type RelatoriosActionResult = {
  ok: boolean;
  error?: string;
  aviso?: string;
};

const linhaDeBaseSchema = z
  .object({
    rate_percent: z.number().min(0).max(100),
    measured_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    measured_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
  })
  .refine((valor) => valor.measured_to >= valor.measured_from, {
    message: "O fim do período medido vem depois do início.",
  });

export async function registrarLinhaDeBaseAction(
  input: unknown,
): Promise<RelatoriosActionResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  if (context.active.role !== "admin") {
    return {
      ok: false,
      error: "Só quem administra a clínica registra a linha de base.",
    };
  }
  const parsed = linhaDeBaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o percentual e o período medido." };
  }

  const supabase = await createClient();
  const { data: linha, error } = await supabase
    .from("no_show_baseline")
    .insert({
      clinic_id: context.active.clinicId,
      rate_percent: parsed.data.rate_percent,
      measured_from: parsed.data.measured_from,
      measured_to: parsed.data.measured_to,
      note: parsed.data.note || null,
      registered_by: context.userId,
    })
    .select("id")
    .single();
  if (error || !linha) {
    return { ok: false, error: "Não foi possível registrar a linha de base." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: "registrou_linha_de_base_no_show",
    entity: "no_show_baseline",
    entity_id: linha.id,
  });

  // Aviso, nao bloqueio: registrar depois da primeira regua e permitido
  // porque o periodo MEDIDO fica documentado; mas quem le precisa saber que
  // a medicao ideal e a anterior ao primeiro toque.
  const { data: primeiroToque } = await supabase
    .from("cadence_run")
    .select("sent_at")
    .eq("clinic_id", context.active.clinicId)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  revalidatePath("/relatorios");
  return {
    ok: true,
    ...(primeiroToque?.sent_at
      ? {
          aviso:
            "A régua desta clínica já disparou mensagens. Confira se o período medido é anterior ao primeiro toque, senão a comparação perde valor.",
        }
      : {}),
  };
}

// Exportar registra a trilha ANTES de o dado sair da tela (regra 3.1, mesmo
// padrao da Agenda): sem gravar a auditoria, o download nao acontece.
export async function registrarExportacaoDeRelatorioAction(
  formato: unknown,
  aba: unknown,
): Promise<{ ok: boolean }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false };
  }
  const parsedFormato = z.enum(["csv", "impressao"]).safeParse(formato);
  // As 4 abas da Fase 3; "painel" e a exportacao do Inicio.
  const parsedAba = z
    .enum(["geral", "marketing", "comercial", "ia", "painel"])
    .safeParse(aba);
  if (!parsedFormato.success || !parsedAba.success) {
    return { ok: false };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: parsedFormato.data === "csv" ? "exportou" : "imprimiu",
    entity: `relatorios_${parsedAba.data}`,
    entity_id: null,
  });
  return { ok: !error };
}

// ---------------------------------------------------------------------------
// Objetivo de conversao (A3)
// ---------------------------------------------------------------------------

const PAPEIS_DO_OBJETIVO = ["admin", "gestor"] as const;

const MENSAGEM_SEM_PAPEL_DO_OBJETIVO =
  "Só administrador e gestor definem o objetivo de conversão.";

// De 0,1 a 100, com no maximo 1 casa decimal (numeric(4,1) no banco). A
// casa e conferida aqui para o banco nunca arredondar em silencio o que a
// pessoa digitou.
const objetivoSchema = z.object({
  percentual: z
    .number()
    .finite()
    .min(0.1)
    .max(100)
    .refine((valor) => Math.abs(valor * 10 - Math.round(valor * 10)) < 1e-6, {
      message: "Use no máximo uma casa decimal.",
    }),
});

export async function definirObjetivoDeConversaoAction(
  input: unknown,
): Promise<RelatoriosActionResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  if (
    !PAPEIS_DO_OBJETIVO.includes(
      context.active.role as (typeof PAPEIS_DO_OBJETIVO)[number],
    )
  ) {
    return { ok: false, error: MENSAGEM_SEM_PAPEL_DO_OBJETIVO };
  }
  const parsed = objetivoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Informe um percentual de 0,1 a 100, com até uma casa decimal.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("objetivo_de_conversao").upsert(
    {
      clinic_id: context.active.clinicId,
      percentual: parsed.data.percentual,
      definido_por: context.userId,
    },
    { onConflict: "clinic_id" },
  );
  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? MENSAGEM_SEM_PAPEL_DO_OBJETIVO
          : error.code === "23514"
            ? "Informe um percentual de 0,1 a 100, com até uma casa decimal."
            : "Não foi possível salvar o objetivo.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: "definiu_objetivo_de_conversao",
    entity: "objetivo_de_conversao",
    entity_id: context.active.clinicId,
  });

  revalidatePath("/relatorios");
  return { ok: true };
}

export async function removerObjetivoDeConversaoAction(): Promise<RelatoriosActionResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  if (
    !PAPEIS_DO_OBJETIVO.includes(
      context.active.role as (typeof PAPEIS_DO_OBJETIVO)[number],
    )
  ) {
    return { ok: false, error: MENSAGEM_SEM_PAPEL_DO_OBJETIVO };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("objetivo_de_conversao")
    .delete()
    .eq("clinic_id", context.active.clinicId);
  if (error) {
    return { ok: false, error: "Não foi possível remover o objetivo." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: "removeu_objetivo_de_conversao",
    entity: "objetivo_de_conversao",
    entity_id: context.active.clinicId,
  });

  revalidatePath("/relatorios");
  return { ok: true };
}
