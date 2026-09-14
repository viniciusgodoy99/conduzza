"use server";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import { canEdit } from "@/lib/domain/permissions";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import { carregarInstancia } from "@/lib/integrations/whatsapp/send";
import { createAdminClient } from "@/lib/supabase/admin";
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

// ---------------------------------------------------------------------------
// Excecoes e passos (fase 2 da 4.8). Tudo pela SESSAO: a policy "gestao
// escreve reguas/passos" decide, e o planner ja resolve a regua mais
// especifica sozinho (procedimento vence historico, que vence a padrao).

const OFFSET_MAXIMO_MIN = 43_200; // 30 dias: alem disso e erro de digitacao

const excecaoSchema = z.discriminatedUnion("base", [
  z.object({ base: z.literal("procedimento"), procedure_id: z.uuid() }),
  z.object({
    base: z.literal("reforcada"),
    no_show_threshold: z.number().int().min(1).max(10),
  }),
]);

export async function criarReguaDeExcecaoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = excecaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  // A excecao NASCE como copia da regua padrao da propria clinica (janela e
  // passos): conteudo da clinica, nada inventado. Nasce DESLIGADA.
  const { data: padrao } = await supabase
    .from("cadence")
    .select("id, send_window_start, send_window_end, send_weekdays")
    .eq("clinic_id", guard.clinicId)
    .eq("kind", "confirmacao")
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (!padrao) {
    return {
      ok: false,
      error: "A clínica ainda não tem a régua de confirmação principal.",
    };
  }

  let nome = "Confirmação reforçada";
  if (parsed.data.base === "procedimento") {
    const { data: procedimento } = await supabase
      .from("procedure")
      .select("name")
      .eq("clinic_id", guard.clinicId)
      .eq("id", parsed.data.procedure_id)
      .maybeSingle();
    if (!procedimento) {
      return { ok: false, error: "Procedimento não encontrado." };
    }
    nome = `Confirmação: ${procedimento.name as string}`;
  }

  const { data: nova, error } = await supabase
    .from("cadence")
    .insert({
      clinic_id: guard.clinicId,
      kind: "confirmacao",
      name: nome,
      procedure_id:
        parsed.data.base === "procedimento" ? parsed.data.procedure_id : null,
      for_no_show_history: parsed.data.base === "reforcada",
      no_show_threshold:
        parsed.data.base === "reforcada" ? parsed.data.no_show_threshold : 2,
      send_window_start: padrao.send_window_start,
      send_window_end: padrao.send_window_end,
      send_weekdays: padrao.send_weekdays,
      active: false,
    })
    .select("id")
    .single();
  if (error || !nova) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? parsed.data.base === "procedimento"
            ? "Já existe uma régua para este procedimento."
            : "Já existe uma régua reforçada nesta clínica."
          : "Não foi possível criar a régua.",
    };
  }

  // Copia os passos da padrao. Se uma copia falhar, a regua fica com menos
  // passos e DESLIGADA: quem edita ve e completa, nada envia sozinho.
  const { data: passos } = await supabase
    .from("cadence_step")
    .select("offset_minutes, fixed_body")
    .eq("clinic_id", guard.clinicId)
    .eq("cadence_id", padrao.id as string)
    .order("offset_minutes");
  if (passos && passos.length > 0) {
    await supabase.from("cadence_step").insert(
      passos.map((passo) => ({
        clinic_id: guard.clinicId,
        cadence_id: nova.id as string,
        offset_minutes: passo.offset_minutes as number,
        fixed_body: passo.fixed_body as string | null,
      })),
    );
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_regua_de_excecao",
    entity: "cadence",
    entity_id: nova.id as string,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function excluirReguaAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: regua } = await supabase
    .from("cadence")
    .select("id, kind, procedure_id, for_no_show_history")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id)
    .maybeSingle();
  if (!regua) {
    return { ok: false, error: "Régua não encontrada." };
  }
  const ehPadrao =
    regua.procedure_id === null && regua.for_no_show_history === false;
  if (regua.kind === "confirmacao" && ehPadrao) {
    return {
      ok: false,
      error:
        "A régua principal de confirmação não pode ser excluída. Desligue o interruptor para pausar.",
    };
  }
  if (regua.kind === "pos_falta") {
    return {
      ok: false,
      error:
        "A régua de recuperação não pode ser excluída. Desligue o interruptor para pausar.",
    };
  }

  // O cascade apaga os passos; runs pendentes morrem no executor como
  // condicao_parada (regua inexistente), comportamento ja provado.
  const { error } = await supabase
    .from("cadence")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id);
  if (error) {
    return { ok: false, error: "Não foi possível excluir a régua." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "excluiu_regua",
    entity: "cadence",
    entity_id: parsed.data.cadence_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// Sinal do offset por tipo de regua: confirmacao conta ANTES da consulta
// (negativo); pos_falta conta DEPOIS da falta (zero ou positivo). O tipo vem
// do banco, nunca do cliente.
async function validarOffsetParaRegua(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  cadenceId: string,
  offsetMinutes: number,
): Promise<string | null> {
  const { data: regua } = await supabase
    .from("cadence")
    .select("kind")
    .eq("clinic_id", clinicId)
    .eq("id", cadenceId)
    .maybeSingle();
  if (!regua) {
    return "Régua não encontrada.";
  }
  if (Math.abs(offsetMinutes) > OFFSET_MAXIMO_MIN) {
    return "O momento da mensagem precisa estar a até 30 dias do evento.";
  }
  if (regua.kind === "confirmacao" && offsetMinutes >= 0) {
    return "Na confirmação, a mensagem sai antes da consulta.";
  }
  if (regua.kind !== "confirmacao" && offsetMinutes < 0) {
    return "Nesta régua, a mensagem sai depois do evento.";
  }
  return null;
}

const passoNovoSchema = z.object({
  cadence_id: z.uuid(),
  offset_minutes: z.number().int(),
  fixed_body: z.string().trim().min(1).max(2000),
});

export async function criarPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = passoNovoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escreva a mensagem e escolha o momento." };
  }

  const supabase = await createClient();
  const recusa = await validarOffsetParaRegua(
    supabase,
    guard.clinicId,
    parsed.data.cadence_id,
    parsed.data.offset_minutes,
  );
  if (recusa) {
    return { ok: false, error: recusa };
  }

  const { data: novo, error } = await supabase
    .from("cadence_step")
    .insert({
      clinic_id: guard.clinicId,
      cadence_id: parsed.data.cadence_id,
      offset_minutes: parsed.data.offset_minutes,
      fixed_body: parsed.data.fixed_body,
    })
    .select("id")
    .single();
  if (error || !novo) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "Já existe uma mensagem neste momento."
          : "Não foi possível criar a mensagem.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_passo_da_regua",
    entity: "cadence_step",
    entity_id: novo.id as string,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function salvarEsperaDoPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ cadence_step_id: z.uuid(), offset_minutes: z.number().int() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select("cadence_id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .maybeSingle();
  if (!passo) {
    return { ok: false, error: "Mensagem não encontrada." };
  }
  const recusa = await validarOffsetParaRegua(
    supabase,
    guard.clinicId,
    passo.cadence_id as string,
    parsed.data.offset_minutes,
  );
  if (recusa) {
    return { ok: false, error: recusa };
  }

  const { error } = await supabase
    .from("cadence_step")
    .update({ offset_minutes: parsed.data.offset_minutes })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Já existe uma mensagem neste momento."
          : "Não foi possível mudar o momento.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "mudou_momento_do_passo",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function excluirPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_step_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: removidos, error } = await supabase
    .from("cadence_step")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .select("id");
  if (error || !removidos || removidos.length === 0) {
    return { ok: false, error: "Não foi possível excluir a mensagem." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "excluiu_passo_da_regua",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Follow-up de leads (fase 3 da 4.8): regua por etapa da jornada.

export async function criarReguaDeFollowupAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ trigger_stage: z.string().regex(/^[a-z0-9_]{1,40}$/) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha a etapa da jornada." };
  }

  const supabase = await createClient();
  const { data: etapa } = await supabase
    .from("funnel_stage_def")
    .select("nome, papel")
    .eq("clinic_id", guard.clinicId)
    .eq("chave", parsed.data.trigger_stage)
    .maybeSingle();
  if (!etapa) {
    return { ok: false, error: "Esta etapa não existe na jornada." };
  }
  // Follow-up de quem foi PERDIDO e outra conversa (reativacao, fora do
  // escopo): mandar mensagem de acompanhamento para quem pediu para parar de
  // ser acompanhado seria spam.
  if (etapa.papel === "perdido") {
    return {
      ok: false,
      error: "A etapa de perda não recebe follow-up automático.",
    };
  }

  // Nasce DESLIGADA, sem janela e sem mensagens: o texto por etapa e decisao
  // da clinica, nada se inventa. Regua sem passos nao materializa nada.
  const { data: nova, error } = await supabase
    .from("cadence")
    .insert({
      clinic_id: guard.clinicId,
      kind: "followup",
      name: `Follow-up de ${etapa.nome as string}`,
      trigger_stage: parsed.data.trigger_stage,
      active: false,
    })
    .select("id")
    .single();
  if (error || !nova) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "Esta etapa já tem régua de follow-up."
          : "Não foi possível criar a régua.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_regua_de_followup",
    entity: "cadence",
    entity_id: nova.id as string,
  });
  revalidatePath("/automacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teste de envio (spec 7.7, fase 4 da 4.8): a mensagem renderizada com dados
// FICTICIOS sai para o PROPRIO numero da clinica, nunca para terceiro.
//
// Por que nao passa por job_queue nem cria message/conversa: ha um humano
// esperando na tela (a fila adicionaria ate 20s sem ganho de idempotencia,
// nao existe run) e contato/conversa da propria clinica poluiria Leads e
// Inbox. Consentimento nao se aplica: o destinatario e a clinica e o corpo
// so tem amostra ficticia, nenhum dado de paciente (regra 3.3 intacta).

export type TesteDeEnvioResult = AutomacoesActionResult & { aviso?: string };

export async function testarEnvioAction(
  input: unknown,
): Promise<TesteDeEnvioResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_step_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select("fixed_body, cadence:cadence_id ( kind )")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .maybeSingle();
  const kind = (
    (Array.isArray(passo?.cadence) ? passo?.cadence[0] : passo?.cadence) as {
      kind?: string;
    } | null
  )?.kind;
  if (!passo || !kind) {
    return { ok: false, error: "Mensagem não encontrada." };
  }
  if (!passo.fixed_body || !(passo.fixed_body as string).trim()) {
    return { ok: false, error: "Escreva e salve o texto antes de testar." };
  }

  const { data: clinica } = await supabase
    .from("clinic")
    .select("name, timezone")
    .eq("id", guard.clinicId)
    .single();

  // O numero da instancia e o status vem por admin client (a secret do
  // provedor nao tem policy), SO depois do guard de papel acima.
  const adminDb = createAdminClient();
  const { data: conta } = await adminDb
    .from("whatsapp_account")
    .select("connection_status, display_phone")
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();
  if (conta?.connection_status !== "conectado" || !conta.display_phone) {
    return {
      ok: false,
      error:
        "O WhatsApp da clínica precisa estar conectado para receber o teste. Confira em Configurações.",
    };
  }

  const amanha = new TZDate(
    Date.now() + 24 * 60 * 60_000,
    (clinica?.timezone as string) ?? "America/Fortaleza",
  );
  const corpo = `Teste da régua: ${renderizarModelo(passo.fixed_body as string, {
    nome: "Maria",
    clinica: (clinica?.name as string) ?? "sua clínica",
    data: format(amanha, "dd/MM/yyyy", { locale: ptBR }),
    hora: "14:00",
    profissional: "Dra. Exemplo",
    procedimento: "Consulta",
    preparo: "",
  }).trim()}`;

  const { provider, ref } = await carregarInstancia(adminDb, guard.clinicId);
  const resultado =
    kind === "confirmacao"
      ? await provider.sendMenu(
          ref,
          conta.display_phone as string,
          corpo,
          MENU_CONFIRMACAO,
        )
      : await provider.sendText(ref, conta.display_phone as string, corpo);
  if (!resultado.ok) {
    return {
      ok: false,
      error:
        "O envio de teste não saiu. Confira a conexão do WhatsApp e tente de novo.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "testou_regua",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  return {
    ok: true,
    aviso:
      provider.name === "fake"
        ? "Canal de teste: nenhuma mensagem real saiu."
        : undefined,
  };
}
