"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  mensagemPadraoSchema,
  novaOrdem,
} from "@/lib/domain/respostas-rapidas";
import { createClient } from "@/lib/supabase/server";

// Mensagens padrao (resposta_rapida, migration 20261002120000_crm_leva_a):
// criar, editar (inclusive ativar e desativar), reordenar e excluir. Mesma
// forma das actions de etiquetas e da jornada: guard de papel, Zod,
// cliente de SESSAO (a RLS decide de novo: admin e gestor escrevem),
// audit_log sem o texto e revalidate.
//
// created_by e updated_by NAO vao daqui: o gatilho proteger_resposta_rapida
// carimba com a sessao. A exclusao e real (nada aponta para a tabela).

export type MensagemPadraoResultado = { ok: boolean; error?: string };

const DICA_SEM_PERMISSAO =
  "Somente administradores e gestores cadastram mensagens padrão.";

const idSchema = z.uuid();

async function exigirGestao() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error: permissionHint(role, "configuracoes") ?? DICA_SEM_PERMISSAO,
    };
  }
  return { userId: context.userId, clinicId: context.active.clinicId };
}

/**
 * Traduz a recusa do banco pelo CODIGO e pela constraint (que o PostgREST
 * devolve na mensagem do 23505), nunca repassando o texto cru.
 */
function traduzirRecusa(
  error: { code?: string; message?: string } | null,
  padrao: string,
): string {
  if (!error) {
    return padrao;
  }
  const mensagem = error.message ?? "";
  if (error.code === "23505") {
    if (mensagem.includes("resposta_rapida_atalho_unico")) {
      return "Já existe uma mensagem padrão com esse atalho. Escolha outro.";
    }
    if (mensagem.includes("resposta_rapida_titulo_unico")) {
      return "Já existe uma mensagem padrão com esse título. Escolha outro.";
    }
    return "Já existe uma mensagem padrão igual a esta.";
  }
  if (error.code === "42501") {
    return DICA_SEM_PERMISSAO;
  }
  if (error.code === "23514") {
    return "Confira o atalho, o título e o texto da mensagem.";
  }
  return padrao;
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guard: { userId: string; clinicId: string },
  action: string,
  entityId: string,
): Promise<void> {
  // Sem o texto: so quem, o que e qual linha.
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.userId,
    action,
    entity: "resposta_rapida",
    entity_id: entityId,
  });
}

function revalidar() {
  revalidatePath("/configuracoes");
  revalidatePath("/atendimento");
}

export async function salvarMensagemPadraoAction(
  entrada: unknown,
): Promise<MensagemPadraoResultado> {
  const guard = await exigirGestao();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mensagemPadraoSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Confira o atalho, o título e o texto da mensagem.",
    };
  }
  const dados = parsed.data;
  const supabase = await createClient();

  if (dados.id) {
    const { data: linhas, error } = await supabase
      .from("resposta_rapida")
      .update({
        atalho: dados.atalho,
        titulo: dados.titulo,
        corpo: dados.corpo,
        ativo: dados.ativo,
      })
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.id)
      .select("id");
    if (error || !linhas || linhas.length === 0) {
      return {
        ok: false,
        error: traduzirRecusa(error, "Não foi possível salvar a mensagem."),
      };
    }
    await auditar(supabase, guard, "editou_mensagem_padrao", linhas[0]!.id);
    revalidar();
    return { ok: true };
  }

  // Criar: entra no fim da lista. A leitura DECIDE a posicao: se falhar,
  // para (seguir com lista vazia empataria a nova com a primeira).
  const { data: existentes, error: erroLeitura } = await supabase
    .from("resposta_rapida")
    .select("posicao")
    .eq("clinic_id", guard.clinicId);
  if (erroLeitura) {
    return {
      ok: false,
      error: "Não foi possível ler as mensagens padrão. Tente de novo.",
    };
  }
  const maiorPosicao = Math.max(
    0,
    ...(existentes ?? []).map((linha) => linha.posicao),
  );
  const { data: criada, error } = await supabase
    .from("resposta_rapida")
    .insert({
      clinic_id: guard.clinicId,
      atalho: dados.atalho,
      titulo: dados.titulo,
      corpo: dados.corpo,
      ativo: dados.ativo,
      posicao: maiorPosicao + 10,
    })
    .select("id")
    .single();
  if (error || !criada) {
    return {
      ok: false,
      error: traduzirRecusa(error, "Não foi possível criar a mensagem."),
    };
  }
  await auditar(supabase, guard, "criou_mensagem_padrao", criada.id);
  revalidar();
  return { ok: true };
}

export async function reordenarMensagemPadraoAction(
  id: unknown,
  direcao: unknown,
): Promise<MensagemPadraoResultado> {
  const guard = await exigirGestao();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(id);
  const parsedDirecao = z.enum(["subir", "descer"]).safeParse(direcao);
  if (!parsedId.success || !parsedDirecao.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: lista, error: erroLeitura } = await supabase
    .from("resposta_rapida")
    .select("id, posicao, titulo")
    .eq("clinic_id", guard.clinicId);
  if (erroLeitura || !lista) {
    return {
      ok: false,
      error: "Não foi possível ler as mensagens padrão. Tente de novo.",
    };
  }
  const mudancas = novaOrdem(lista, parsedId.data, parsedDirecao.data);
  if (mudancas === null) {
    return { ok: false, error: "A mensagem já está na ponta da lista." };
  }

  // Escritas soltas, uma por linha que muda (sem RPC: a ordem aqui so
  // decide a exibicao, e um empate que sobrar de uma falha no meio cai no
  // desempate por titulo e some na proxima reordenacao, que renumera tudo).
  const resultados = await Promise.all(
    mudancas.map((mudanca) =>
      supabase
        .from("resposta_rapida")
        .update({ posicao: mudanca.posicao })
        .eq("clinic_id", guard.clinicId)
        .eq("id", mudanca.id)
        .select("id"),
    ),
  );
  const falhou = resultados.find(
    (resultado) => resultado.error || (resultado.data ?? []).length === 0,
  );
  if (falhou) {
    revalidar();
    return {
      ok: false,
      error: traduzirRecusa(
        falhou.error,
        "Não foi possível reordenar. Tente de novo.",
      ),
    };
  }

  await auditar(supabase, guard, "reordenou_mensagem_padrao", parsedId.data);
  revalidar();
  return { ok: true };
}

export async function excluirMensagemPadraoAction(
  id: unknown,
): Promise<MensagemPadraoResultado> {
  const guard = await exigirGestao();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: removidas, error } = await supabase
    .from("resposta_rapida")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .select("id");
  if (error || !removidas || removidas.length === 0) {
    return {
      ok: false,
      error: traduzirRecusa(error, "Não foi possível excluir a mensagem."),
    };
  }

  await auditar(supabase, guard, "excluiu_mensagem_padrao", removidas[0]!.id);
  revalidar();
  return { ok: true };
}
