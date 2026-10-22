"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import {
  automacaoDeFluxoSchema,
  colunasDeAntes,
  DICA_SEM_PERMISSAO,
  FUNCAO_AUSENTE,
  MENSAGENS_DO_VETO,
  mensagemDaRecusaAoSalvar,
  mensagemDaRecusaDaAutomacao,
  motivoDaPerdaPara,
  podeAcessarAutomacoesDeFluxo,
  previaDaAutomacaoEntradaSchema,
  RECUSAS_AO_SALVAR,
  regraParaGravar,
  vetoDoDestino,
  type EntradaDaAutomacao,
  type EtapaParaAutomacao,
  type ExecucaoDeAutomacao,
  type PreviaDaAutomacao,
  type UsoDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { PapelDeEtapa } from "@/lib/domain/jornada";
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
// Desde 20/10/2026 (decisao do dono, onda 4) a aba mora na tela Automacoes
// (?aba=fluxo), e nao mais em Configuracoes. A guarda nao depende da rota:
// TODAS as actions daqui, as de leitura inclusive, conferem no servidor que o
// papel na clinica ativa e administrador ou gestor
// (podeAcessarAutomacoesDeFluxo), antes de qualquer leitura ou escrita. A
// recepcao, que ve o resto de Automacoes, nao ve esta aba e e recusada aqui
// do mesmo jeito que profissional e leitura.
//
// Desde a onda 4 (itens 14 e 15) a regra e composta: o "Se" (condicoes de
// etiqueta) e o "Faz" (de 1 a 5 acoes) moram em tabelas filhas, e salvar e
// UMA chamada a RPC salvar_automacao_de_fluxo (migration 20261024110000),
// que grava a regra e as filhas na mesma transacao, com a mesma guarda de
// papel do banco (42501 sem dica para quem nao e admin ou gestor da clinica)
// e o detector de ciclo lendo as acoes novas. Ligar, desligar e excluir
// continuam na linha de automacao_fluxo.
//
// NAO vao daqui: created_by, updated_by, created_at nem vigente_desde (o
// gatilho validar_automacao_de_fluxo carimba com a sessao e ignora o que
// vier). O motivo da perda nasce do papel do destino lido do banco. A
// exclusao e real e leva o historico junto (cascade); as atividades criadas
// pela regra ficam (FK ON DELETE SET NULL).
//
// Banco sem a migration 20261024110000 (revisao de 21/10/2026; o contrato,
// secao 8, publica este codigo antes dela, junto com o do follow-up): sem a
// RPC, a regra de UMA acao e sem condicao grava pelas colunas de antes, como
// o codigo de antes gravava; a de varias acoes ou com condicao e recusada
// com a frase que diz o que fazer. Ligar, desligar, excluir, o uso e o
// historico nao dependem da B.

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
  if (!podeAcessarAutomacoesDeFluxo(context.active.role)) {
    return { error: DICA_SEM_PERMISSAO };
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

// A lista da aba volta pela pagina de Automacoes (a action a revalida, e a
// tela recebe as regras novas sem recarregar).
function revalidar() {
  revalidatePath("/automacoes");
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

  // O mover (no maximo um, o Zod ja conferiu) passa pelos vetos do destino
  // antes do banco, com o motivo da perda tirado do papel do destino lido
  // agora: a mensagem de gente chega sem ida ao banco. O banco confere de
  // novo (validar_acao_de_automacao).
  for (const acao of dados.acoes) {
    if (acao.acao !== "mover_etapa") {
      continue;
    }
    const veto = vetoDoDestino({
      etapa: dados.etapa,
      etapaDestino: acao.etapa_destino,
      motivoPerda: motivoDaPerdaPara(acao.etapa_destino, jornada),
      jornada,
    });
    if (veto) {
      return { ok: false, error: MENSAGENS_DO_VETO[veto] };
    }
  }

  const padrao = dados.id
    ? "Não foi possível salvar a automação."
    : "Não foi possível criar a automação.";
  const { data: id, error } = await supabase.rpc("salvar_automacao_de_fluxo", {
    p_clinic_id: guard.clinicId,
    p_id: dados.id,
    p_regra: regraParaGravar(dados),
  });
  if (error && FUNCAO_AUSENTE.has(error.code ?? "")) {
    return salvarPelasColunasDeAntes(supabase, guard, dados, jornada, padrao);
  }
  if (error) {
    return { ok: false, error: mensagemDaRecusaAoSalvar(error, padrao) };
  }
  if (typeof id !== "string" || !idSchema.safeParse(id).success) {
    return { ok: false, error: padrao };
  }
  await auditar(
    supabase,
    guard,
    dados.id ? "editou_automacao_de_fluxo" : "criou_automacao_de_fluxo",
    id,
  );
  revalidar();
  return { ok: true, id };
}

/**
 * A gravacao de antes da onda 4, para o banco sem a migration 20261024110000
 * (a RPC ausente): as colunas de acao de automacao_fluxo, pela sessao (a RLS
 * e o gatilho validar_automacao_de_fluxo decidem, como antes). So a regra de
 * uma acao e sem condicao (colunasDeAntes); a outra e recusada.
 */
async function salvarPelasColunasDeAntes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guard: Guarda,
  dados: EntradaDaAutomacao,
  jornada: readonly EtapaParaAutomacao[],
  padrao: string,
): Promise<AutomacaoDeFluxoResultado> {
  const campos = colunasDeAntes(dados, jornada);
  if (!campos) {
    return { ok: false, error: RECUSAS_AO_SALVAR.semRpc };
  }
  if (dados.id) {
    const { data: linhas, error } = await supabase
      .from("automacao_fluxo")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.id)
      .select("id");
    if (error) {
      return { ok: false, error: mensagemDaRecusaDaAutomacao(error, padrao) };
    }
    if (!linhas || linhas.length === 0) {
      return { ok: false, error: RECUSAS_AO_SALVAR.naoExiste };
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
    return { ok: false, error: mensagemDaRecusaDaAutomacao(error, padrao) };
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
