"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import {
  automacaoDeFluxoSchema,
  camposParaGravar,
  DICA_SEM_PERMISSAO,
  MENSAGENS_DO_VETO,
  mensagemDaRecusaDaAutomacao,
  previaDaAutomacaoEntradaSchema,
  vetoDoDestino,
  type EtapaParaAutomacao,
  type ExecucaoDeAutomacao,
  type PreviaDaAutomacao,
  type UsoDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { PapelDeEtapa } from "@/lib/domain/jornada";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  fetchHistoricoDeAutomacoes,
  fetchPreviaDaAutomacao,
  fetchUsoDasAutomacoes,
} from "@/lib/queries/automacoes-de-fluxo";
import { createClient } from "@/lib/supabase/server";

// Automacoes de fluxo (automacao_fluxo, migration 20261002130000): criar,
// editar, ligar, desligar e excluir a regra, e as leituras que a aba faz sob
// demanda (previa, uso e historico). Mesma forma das actions da jornada e
// das mensagens padrao: guard de papel, Zod, cliente de SESSAO (a RLS decide
// de novo: admin e gestor escrevem), audit_log sem texto e revalidate.
//
// NAO vao daqui: created_by, updated_by, created_at nem vigente_desde (o
// gatilho validar_automacao_de_fluxo carimba com a sessao e ignora o que
// vier). O motivo da perda nasce do papel do destino lido do banco. A
// exclusao e real e leva o historico junto (cascade); as atividades criadas
// pela regra ficam (FK ON DELETE SET NULL).

export type AutomacaoDeFluxoResultado =
  { ok: true; id: string } | { ok: false; error: string };

export type PreviaDaAutomacaoResultado =
  { ok: true; previa: PreviaDaAutomacao } | { ok: false; error: string };

export type UsoDasAutomacoesResultado =
  | { ok: true; uso: Record<string, UsoDaAutomacao> }
  | { ok: false; error: string };

export type HistoricoDasAutomacoesResultado =
  { ok: true; execucoes: ExecucaoDeAutomacao[] } | { ok: false; error: string };

// O historico mostra o nome do contato (dado de paciente, regra 3.1): a
// leitura entra na trilha com a entidade propria desta aba, para nao se
// confundir com a lista de Leads na janela de 5 minutos do dedupe (e o
// historico pode mostrar quem ja virou paciente, que a lista de Leads nunca
// mostra).
const ENTIDADE_DA_LEITURA = "automacoes_de_fluxo" as const;

const idSchema = z.uuid();

type Guarda = { userId: string; clinicId: string };

async function requireGestorOuAdmin(): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error: permissionHint(role, "configuracoes") ?? DICA_SEM_PERMISSAO,
    };
  }
  return { userId: context.userId, clinicId: context.active.clinicId };
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guard: Guarda,
  action: string,
  entityId: string,
): Promise<void> {
  // Sem nome nem texto da regra: so quem, o que e qual linha.
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.userId,
    action,
    entity: "automacao_fluxo",
    entity_id: entityId,
  });
}

function revalidar() {
  revalidatePath("/configuracoes");
}

function primeiraMensagem(erro: z.ZodError, padrao: string): string {
  const custom = erro.issues.find((issue) => issue.code === "custom");
  return custom?.message ?? erro.issues[0]?.message ?? padrao;
}

export async function salvarAutomacaoDeFluxoAction(
  entrada: unknown,
): Promise<AutomacaoDeFluxoResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = automacaoDeFluxoSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false,
      error: primeiraMensagem(parsed.error, "Confira os campos da automação."),
    };
  }
  const dados = parsed.data;
  const supabase = await createClient();

  // A jornada DECIDE o motivo da perda e os vetos: leitura que falha para.
  const { data: etapas, error: erroDaJornada } = await supabase
    .from("funnel_stage_def")
    .select("chave, nome, papel")
    .eq("clinic_id", guard.clinicId);
  if (erroDaJornada || !etapas) {
    return {
      ok: false,
      error: "Não foi possível ler a jornada. Tente de novo.",
    };
  }
  const jornada: EtapaParaAutomacao[] = etapas.map((etapa) => ({
    chave: etapa.chave,
    nome: etapa.nome,
    papel: (etapa.papel ?? null) as PapelDeEtapa | null,
  }));
  if (!jornada.some((etapa) => etapa.chave === dados.etapa)) {
    return {
      ok: false,
      error:
        "A etapa escolhida não existe mais na jornada. Recarregue a página e escolha outra.",
    };
  }

  const campos = camposParaGravar(dados, jornada);
  if (campos.acao === "mover_etapa") {
    const veto = vetoDoDestino({
      etapa: campos.etapa,
      etapaDestino: campos.etapa_destino,
      motivoPerda: campos.motivo_perda,
      jornada,
    });
    if (veto) {
      return { ok: false, error: MENSAGENS_DO_VETO[veto] };
    }
  }

  if (dados.id) {
    const { data: linhas, error } = await supabase
      .from("automacao_fluxo")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.id)
      .select("id");
    if (error) {
      return {
        ok: false,
        error: mensagemDaRecusaDaAutomacao(
          error,
          "Não foi possível salvar a automação.",
        ),
      };
    }
    if (!linhas || linhas.length === 0) {
      return {
        ok: false,
        error:
          "Esta automação não existe mais. Recarregue a página para ver a lista atual.",
      };
    }
    await auditar(supabase, guard, "editou_automacao_de_fluxo", linhas[0]!.id);
    revalidar();
    return { ok: true, id: linhas[0]!.id };
  }

  const { data: criada, error } = await supabase
    .from("automacao_fluxo")
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error || !criada) {
    return {
      ok: false,
      error: mensagemDaRecusaDaAutomacao(
        error,
        "Não foi possível criar a automação.",
      ),
    };
  }
  await auditar(supabase, guard, "criou_automacao_de_fluxo", criada.id);
  revalidar();
  return { ok: true, id: criada.id };
}

/**
 * Liga ou desliga. Ligar zera vigente_desde no banco (nao e retroativa) e
 * passa pelo detector de ciclo: a recusa volta traduzida.
 */
export async function alternarAutomacaoDeFluxoAction(
  id: unknown,
  ativa: unknown,
): Promise<AutomacaoDeFluxoResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(id);
  const parsedAtiva = z.boolean().safeParse(ativa);
  if (!parsedId.success || !parsedAtiva.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: linhas, error } = await supabase
    .from("automacao_fluxo")
    .update({ ativa: parsedAtiva.data })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDaRecusaDaAutomacao(
        error,
        parsedAtiva.data
          ? "Não foi possível ligar a automação."
          : "Não foi possível desligar a automação.",
      ),
    };
  }
  if (!linhas || linhas.length === 0) {
    return {
      ok: false,
      error:
        "Esta automação não existe mais. Recarregue a página para ver a lista atual.",
    };
  }
  await auditar(
    supabase,
    guard,
    parsedAtiva.data
      ? "ligou_automacao_de_fluxo"
      : "desligou_automacao_de_fluxo",
    linhas[0]!.id,
  );
  revalidar();
  return { ok: true, id: linhas[0]!.id };
}

export async function excluirAutomacaoDeFluxoAction(
  id: unknown,
): Promise<AutomacaoDeFluxoResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: removidas, error } = await supabase
    .from("automacao_fluxo")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDaRecusaDaAutomacao(
        error,
        "Não foi possível excluir a automação.",
      ),
    };
  }
  if (!removidas || removidas.length === 0) {
    return {
      ok: false,
      error:
        "Esta automação não existe mais. Recarregue a página para ver a lista atual.",
    };
  }
  await auditar(
    supabase,
    guard,
    "excluiu_automacao_de_fluxo",
    removidas[0]!.id,
  );
  revalidar();
  return { ok: true, id: removidas[0]!.id };
}

/** Contagens para a previa: sem dado de paciente, sem trilha de leitura. */
export async function previaDaAutomacaoDeFluxoAction(
  entrada: unknown,
): Promise<PreviaDaAutomacaoResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = previaDaAutomacaoEntradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "O tempo vai de 1 hora a 90 dias." };
  }
  const supabase = await createClient();
  try {
    const previa = await fetchPreviaDaAutomacao(supabase, guard.clinicId, {
      gatilho: parsed.data.gatilho,
      etapa: parsed.data.etapa,
      esperaMinutos: parsed.data.espera_minutos,
    });
    return { ok: true, previa };
  } catch (erro) {
    return {
      ok: false,
      error: mensagemDaRecusaDaAutomacao(
        erro as { code?: string; message?: string },
        "Não foi possível contar os leads da etapa.",
      ),
    };
  }
}

/** Quantas vezes cada regra rodou: contagem, sem dado de paciente. */
export async function usoDasAutomacoesDeFluxoAction(
  ids: unknown,
): Promise<UsoDasAutomacoesResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.array(idSchema).max(200).safeParse(ids);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createClient();
  try {
    const uso = await fetchUsoDasAutomacoes(
      supabase,
      guard.clinicId,
      parsed.data,
    );
    return { ok: true, uso };
  } catch {
    return {
      ok: false,
      error: "Não foi possível contar as execuções.",
    };
  }
}

/**
 * As ultimas execucoes (de todas as regras ou de uma). Traz o nome do lead:
 * a trilha de leitura e a consulta terminam juntas, antes de o dado sair do
 * servidor.
 */
export async function historicoDeAutomacoesDeFluxoAction(
  automacaoId: unknown,
): Promise<HistoricoDasAutomacoesResultado> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.nullable().safeParse(automacaoId ?? null);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createClient();
  try {
    const [execucoes] = await Promise.all([
      fetchHistoricoDeAutomacoes(supabase, guard.clinicId, parsed.data),
      auditarLeituraDePaciente(supabase, {
        clinicId: guard.clinicId,
        userId: guard.userId,
        entity: ENTIDADE_DA_LEITURA,
      }),
    ]);
    return { ok: true, execucoes };
  } catch {
    return {
      ok: false,
      error: "Não foi possível carregar o histórico.",
    };
  }
}
