"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import {
  adiarAtividadeSchema,
  criarAtividadeSchema,
  editarAtividadeSchema,
  hojeNaClinica,
  mensagemDoErroDeAtividade,
  prazoAdiado,
  prazoParaGravar,
  problemaNoPrazoNovo,
} from "@/lib/domain/atividades";
import { canEdit, permissionHint, type Role } from "@/lib/domain/permissions";
import {
  fetchAtividadesDaClinica,
  fetchAtividadesDoContato,
  fetchEquipeDaAtividade,
  type AtividadesDoContato,
  type EquipeDaAtividade,
  type ListaDeAtividades,
} from "@/lib/queries/atividades";
import { createClient } from "@/lib/supabase/server";

// Server Actions das atividades do lead ou paciente (contact_activity,
// escopo acrescentado em 02/10/2026). Escrita segue a matriz de Leads e
// Pacientes (docs/02): admin, gestor e recepcao criam, editam, concluem,
// reabrem, adiam e cancelam; profissional e leitura so veem. A policy do
// banco diz o mesmo, e o gatilho validar_atividade carimba autoria,
// conclusao e cancelamento com a sessao: daqui so sai o status.
//
// Toda entrada passa por Zod; cliente de SESSAO (a RLS aplica); toda mutacao
// vai para audit_log com a entidade contact_activity e o id, NUNCA com o
// texto (dado de paciente, regra 3.1). As leituras daqui gravam a trilha de
// leitura antes de o dado sair do servidor.

export type AtividadeActionResult =
  { ok: true; id: string; jaEstava?: boolean } | { ok: false; error: string };

const idSchema = z.uuid();

const SESSAO_EXPIRADA = "Sessão expirada. Entre de novo.";

type Membro = {
  clinicId: string;
  timezone: string;
  userId: string;
  role: Role;
};
type Recusa = { error: string };

async function exigirMembro(): Promise<Membro | Recusa> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: SESSAO_EXPIRADA };
  }
  return {
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
    userId: context.userId,
    role: context.active.role,
  };
}

// Mesmo guard de requireLeadsWriter: a recepcao escreve, a leitura nao. A
// checagem existe aqui E na policy, porque esconder botao nao protege nada.
async function exigirQuemEscreve(): Promise<Membro | Recusa> {
  const membro = await exigirMembro();
  if ("error" in membro) {
    return membro;
  }
  if (!canEdit(membro.role, "leads_pacientes")) {
    return {
      error:
        permissionHint(membro.role, "leads_pacientes") ??
        "Seu perfil não pode alterar atividades",
    };
  }
  return membro;
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action:
    | "criou_atividade"
    | "editou_atividade"
    | "concluiu_atividade"
    | "reabriu_atividade"
    | "cancelou_atividade",
  entityId: string,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity: "contact_activity",
    entity_id: entityId,
  });
}

// ---------------------------------------------------------------------------
// Leituras (com trilha)
// ---------------------------------------------------------------------------

export type ListaDeAtividadesResult =
  { ok: true; lista: ListaDeAtividades } | { ok: false; error: string };

/** A lista da tela Atividades (recarga do cliente depois de uma acao). */
export async function listarAtividadesAction(): Promise<ListaDeAtividadesResult> {
  const membro = await exigirMembro();
  if ("error" in membro) {
    return { ok: false, error: membro.error };
  }
  const supabase = await createClient();
  try {
    // A trilha e a leitura juntas: as duas terminam antes de o texto sair.
    const [lista] = await Promise.all([
      fetchAtividadesDaClinica(
        supabase,
        membro.clinicId,
        membro.timezone,
        new Date(),
      ),
      auditarLeituraDePaciente(supabase, {
        clinicId: membro.clinicId,
        userId: membro.userId,
        entity: "atividades",
      }),
    ]);
    return { ok: true, lista };
  } catch {
    return { ok: false, error: "Não foi possível carregar as atividades." };
  }
}

export type AtividadesDoContatoResult =
  | { ok: true; atividades: AtividadesDoContato; equipe: EquipeDaAtividade }
  | { ok: false; error: string };

/**
 * As atividades de UM contato, para o painel da conversa. A trilha leva o id
 * do contato: diz de quem foram as atividades lidas, nao so que a tela abriu.
 */
export async function atividadesDoContatoAction(
  contactId: unknown,
): Promise<AtividadesDoContatoResult> {
  const membro = await exigirMembro();
  if ("error" in membro) {
    return { ok: false, error: membro.error };
  }
  const parsed = idSchema.safeParse(contactId);
  if (!parsed.success) {
    return { ok: false, error: "Contato inválido." };
  }
  const supabase = await createClient();
  try {
    const [atividades, equipe] = await Promise.all([
      fetchAtividadesDoContato(supabase, membro.clinicId, parsed.data),
      fetchEquipeDaAtividade(supabase, membro.clinicId, membro.userId),
      auditarLeituraDePaciente(supabase, {
        clinicId: membro.clinicId,
        userId: membro.userId,
        entity: "atividades",
        entityId: parsed.data,
      }),
    ]);
    return { ok: true, atividades, equipe };
  } catch {
    return { ok: false, error: "Não foi possível carregar as atividades." };
  }
}

export type EquipeDaAtividadeResult =
  { ok: true; equipe: EquipeDaAtividade } | { ok: false; error: string };

/** Quem pode ser responsavel (o dialogo busca so quando abre). */
export async function equipeDaAtividadeAction(): Promise<EquipeDaAtividadeResult> {
  const membro = await exigirMembro();
  if ("error" in membro) {
    return { ok: false, error: membro.error };
  }
  try {
    const supabase = await createClient();
    const equipe = await fetchEquipeDaAtividade(
      supabase,
      membro.clinicId,
      membro.userId,
    );
    return { ok: true, equipe };
  } catch {
    return { ok: false, error: "Não foi possível carregar a equipe." };
  }
}

export type ConversaDoContatoResult =
  { ok: true; conversationId: string | null } | { ok: false; error: string };

/**
 * A conversa mais recente do contato, MESMO resolvida (o caso "retornar em
 * dezembro": a conversa ja fechou e a recepcao usa "Reabrir e responder").
 * Para o profissional a RLS so mostra as atribuidas a ele. So o id sai daqui.
 */
export async function conversaDoContatoAction(
  contactId: unknown,
): Promise<ConversaDoContatoResult> {
  const membro = await exigirMembro();
  if ("error" in membro) {
    return { ok: false, error: membro.error };
  }
  const parsed = idSchema.safeParse(contactId);
  if (!parsed.success) {
    return { ok: false, error: "Contato inválido." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation")
    .select("id")
    .eq("clinic_id", membro.clinicId)
    .eq("contact_id", parsed.data)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, error: "Não foi possível abrir a conversa." };
  }
  return {
    ok: true,
    conversationId: (data?.id as string | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mutacoes
// ---------------------------------------------------------------------------

function primeiroErro(error: z.ZodError, padrao: string): string {
  return error.issues[0]?.message ?? padrao;
}

export async function criarAtividadeAction(
  input: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = criarAtividadeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: primeiroErro(parsed.error, "Confira os campos informados."),
    };
  }
  const dados = parsed.data;
  const problema = problemaNoPrazoNovo(
    dados.dia,
    dados.hora,
    new Date(),
    guard.timezone,
  );
  if (problema) {
    return { ok: false, error: problema };
  }

  const supabase = await createClient();
  // created_by, status, origem e carimbos: o banco preenche com a sessao.
  const { data, error } = await supabase
    .from("contact_activity")
    .insert({
      clinic_id: guard.clinicId,
      contact_id: dados.contact_id,
      conversation_id: dados.conversation_id ?? null,
      titulo: dados.titulo,
      detalhes: dados.detalhes,
      ...prazoParaGravar(guard.timezone, dados.dia, dados.hora),
      assignee_user_id: dados.assignee_user_id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível criar a atividade.",
      ),
    };
  }
  const id = data.id as string;
  await auditar(supabase, guard.clinicId, guard.userId, "criou_atividade", id);
  return { ok: true, id };
}

export async function editarAtividadeAction(
  input: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = editarAtividadeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: primeiroErro(parsed.error, "Confira os campos informados."),
    };
  }
  const dados = parsed.data;
  const supabase = await createClient();
  // Sem hora, due_at vai null JUNTO com o dia (tirar a hora); com hora, o
  // banco recalcula o dia a partir dela no fuso da clinica.
  const { data, error } = await supabase
    .from("contact_activity")
    .update({
      titulo: dados.titulo,
      detalhes: dados.detalhes,
      ...prazoParaGravar(guard.timezone, dados.dia, dados.hora),
      assignee_user_id: dados.assignee_user_id,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.id)
    .eq("status", "pendente")
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível salvar a atividade.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Só dá para editar atividade pendente. Ela pode ter sido concluída ou cancelada agora; recarregue a lista.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.userId,
    "editou_atividade",
    dados.id,
  );
  return { ok: true, id: dados.id };
}

/** A situacao atual, para dizer por que um UPDATE guardado nao pegou. */
async function statusAtual(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contact_activity")
    .select("status")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

const NAO_ENCONTRADA = "Atividade não encontrada nesta clínica.";

/**
 * Concluir e IDEMPOTENTE: o UPDATE so pega pendente. Duas atendentes
 * concluindo ao mesmo tempo, a segunda recebe ok sem gravar de novo (o
 * carimbo e a trilha ficam com quem concluiu primeiro).
 */
export async function concluirAtividadeAction(
  id: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: NAO_ENCONTRADA };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_activity")
    .update({ status: "concluida" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("status", "pendente")
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível concluir a atividade.",
      ),
    };
  }
  if (!data || data.length === 0) {
    const atual = await statusAtual(supabase, guard.clinicId, parsed.data);
    if (atual === "concluida") {
      return { ok: true, id: parsed.data, jaEstava: true };
    }
    if (atual === "cancelada") {
      return {
        ok: false,
        error: "Esta atividade foi cancelada. Reabra antes de concluir.",
      };
    }
    return { ok: false, error: NAO_ENCONTRADA };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.userId,
    "concluiu_atividade",
    parsed.data,
  );
  return { ok: true, id: parsed.data };
}

/** Reabrir (o "Desfazer" de concluir e de cancelar). Idempotente. */
export async function reabrirAtividadeAction(
  id: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: NAO_ENCONTRADA };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_activity")
    .update({ status: "pendente" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .in("status", ["concluida", "cancelada"])
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível reabrir a atividade.",
      ),
    };
  }
  if (!data || data.length === 0) {
    const atual = await statusAtual(supabase, guard.clinicId, parsed.data);
    if (atual === "pendente") {
      return { ok: true, id: parsed.data, jaEstava: true };
    }
    return { ok: false, error: NAO_ENCONTRADA };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.userId,
    "reabriu_atividade",
    parsed.data,
  );
  return { ok: true, id: parsed.data };
}

/** Cancelar no lugar de apagar (nao existe DELETE). Idempotente. */
export async function cancelarAtividadeAction(
  id: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: NAO_ENCONTRADA };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_activity")
    .update({ status: "cancelada" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("status", "pendente")
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível cancelar a atividade.",
      ),
    };
  }
  if (!data || data.length === 0) {
    const atual = await statusAtual(supabase, guard.clinicId, parsed.data);
    if (atual === "cancelada") {
      return { ok: true, id: parsed.data, jaEstava: true };
    }
    if (atual === "concluida") {
      return {
        ok: false,
        error: "Esta atividade já foi concluída. Reabra antes de cancelar.",
      };
    }
    return { ok: false, error: NAO_ENCONTRADA };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.userId,
    "cancelou_atividade",
    parsed.data,
  );
  return { ok: true, id: parsed.data };
}

/**
 * Adiar para amanha, 7 ou 30 dias a partir de HOJE na clinica, mantendo a
 * hora local quando a atividade tem hora. E uma edicao do prazo: a trilha
 * registra editou_atividade.
 */
export async function adiarAtividadeAction(
  input: unknown,
): Promise<AtividadeActionResult> {
  const guard = await exigirQuemEscreve();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = adiarAtividadeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha para quando adiar." };
  }
  const supabase = await createClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("contact_activity")
    .select("due_at, status")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (erroLeitura) {
    return { ok: false, error: "Não foi possível adiar a atividade." };
  }
  if (!atual) {
    return { ok: false, error: NAO_ENCONTRADA };
  }
  if (atual.status !== "pendente") {
    return {
      ok: false,
      error: "Só dá para adiar atividade pendente. Recarregue a lista.",
    };
  }
  const hoje = hojeNaClinica(guard.timezone, new Date());
  const novoPrazo = prazoAdiado(
    { due_at: (atual.due_at as string | null) ?? null },
    parsed.data.dias,
    hoje,
    guard.timezone,
  );
  const { data, error } = await supabase
    .from("contact_activity")
    .update(novoPrazo)
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.id)
    .eq("status", "pendente")
    .select("id");
  if (error) {
    return {
      ok: false,
      error: mensagemDoErroDeAtividade(
        error,
        "Não foi possível adiar a atividade.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Só dá para adiar atividade pendente. Recarregue a lista.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.userId,
    "editou_atividade",
    parsed.data.id,
  );
  return { ok: true, id: parsed.data.id };
}
