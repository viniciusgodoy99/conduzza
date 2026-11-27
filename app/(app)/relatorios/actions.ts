"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  gerarCsvDoGoogle,
  lerConversoesParaOGoogle,
  linhasDoArquivoDoGoogle,
  nomeDoArquivoDoGoogle,
  TEXTOS_DAS_CONVERSOES_DO_GOOGLE,
} from "@/lib/domain/conversoes-google";
import { janelaDoPeriodo } from "@/lib/queries/relatorios";
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
      error: "Só quem administra a clínica informa a taxa de faltas de antes.",
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
    return { ok: false, error: "Não foi possível salvar a taxa de faltas de antes." };
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

// ---------------------------------------------------------------------------
// Conversoes para o Google Ads (etapa 6A do plano de 16/11/2026)
// ---------------------------------------------------------------------------

const PAPEIS_DAS_CONVERSOES_DO_GOOGLE = ["admin", "gestor"] as const;

const periodoDoGoogleSchema = z
  .object({
    diaDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    diaAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((periodo) => periodo.diaDe <= periodo.diaAte);

export type ResultadoDasConversoesDoGoogle =
  | {
      ok: true;
      /** nulo: nenhuma conversao no periodo (nada sai, nada na trilha) */
      arquivo: { nome: string; csv: string } | null;
      exportadas: number;
      /** conversoes so com gbraid ou wbraid: o arquivo do Google nao aceita */
      semGclid: number;
    }
  | { ok: false; error: string };

/**
 * Monta o arquivo de conversoes para a agencia subir no Google Ads
 * (importacao de conversoes por clique). So administrador e gestor: a guarda
 * daqui e a funcao do banco (conversoes_para_o_google, migration
 * 20261116170000) conferem as duas. O periodo vem em dias civis da clinica,
 * como o resto de Resultados. A trilha vai ANTES de o dado sair (regra 3.1):
 * sem gravar a auditoria, o arquivo nao volta. Sem conversao no periodo, nada
 * e gravado e nada sai.
 */
export async function exportarConversoesParaOGoogleAction(
  entrada: unknown,
): Promise<ResultadoDasConversoesDoGoogle> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  const { clinicId, role, timezone } = context.active;
  if (
    !(PAPEIS_DAS_CONVERSOES_DO_GOOGLE as readonly string[]).includes(role)
  ) {
    return { ok: false, error: TEXTOS_DAS_CONVERSOES_DO_GOOGLE.semPermissao };
  }
  const parsed = periodoDoGoogleSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Período inválido." };
  }
  const fuso = timezone ?? "America/Fortaleza";
  const janela = janelaDoPeriodo(fuso, parsed.data.diaDe, parsed.data.diaAte);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("conversoes_para_o_google", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
  });
  const lido = error ? null : lerConversoesParaOGoogle(data);
  if (!lido) {
    return { ok: false, error: TEXTOS_DAS_CONVERSOES_DO_GOOGLE.falhou };
  }
  const linhas = linhasDoArquivoDoGoogle(lido.linhas, fuso);
  const exportadas = linhas.length - 1;
  if (exportadas === 0) {
    return { ok: true, arquivo: null, exportadas: 0, semGclid: lido.semGclid };
  }

  const { error: erroDaTrilha } = await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: context.userId,
    action: "exportou",
    entity: "conversoes_google",
    entity_id: null,
  });
  if (erroDaTrilha) {
    return { ok: false, error: TEXTOS_DAS_CONVERSOES_DO_GOOGLE.falhou };
  }
  return {
    ok: true,
    arquivo: {
      nome: nomeDoArquivoDoGoogle(parsed.data.diaDe, parsed.data.diaAte),
      csv: gerarCsvDoGoogle(linhas),
    },
    exportadas,
    semGclid: lido.semGclid,
  };
}
