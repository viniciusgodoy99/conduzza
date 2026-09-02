"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import {
  sendWhatsAppMedia,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Acoes do Inbox. Verificacao de visibilidade e posse SEMPRE com a sessao do
// usuario (RLS aplica); o service role entra apenas no envio (send.ts precisa
// do segredo da instancia) e depois de a sessao ter validado a conversa.
//
// A matriz de papeis (brief secao 5) e conferida aqui, alem da RLS: os papeis
// 'leitura' e 'profissional' tem acesso de leitura ao Atendimento, e sem esta
// checagem um usuario 'leitura' assumiria conversa e dispararia mensagem real
// para o paciente pela Server Action, mesmo com o botao escondido na tela.

const idSchema = z.uuid();
const bodySchema = z.string().trim().min(1).max(4096);

export type InboxActionResult = { ok: boolean; error?: string };

type ConversationRow = {
  id: string;
  contact_id: string;
  status: "ia_atendendo" | "aguardando_humano" | "em_atendimento" | "resolvida";
  assignee_user_id: string | null;
};

async function loadVisibleConversation(
  conversationId: string,
  { exigeEdicao = false }: { exigeEdicao?: boolean } = {},
) {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (exigeEdicao && !canEdit(context.active.role, "atendimento")) {
    return {
      error:
        "Seu perfil pode acompanhar o atendimento, mas não responder." as const,
    };
  }
  const parsed = idSchema.safeParse(conversationId);
  if (!parsed.success) {
    return { error: "Conversa inválida." as const };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation")
    .select("id, contact_id, status, assignee_user_id")
    .eq("id", parsed.data)
    .eq("clinic_id", context.active.clinicId)
    .maybeSingle();
  if (!data) {
    return { error: "Conversa não encontrada." as const };
  }
  return {
    context,
    supabase,
    conversation: data as ConversationRow,
  };
}

async function addSystemEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  conversationId: string,
  body: string,
): Promise<void> {
  await supabase.from("message").insert({
    clinic_id: clinicId,
    conversation_id: conversationId,
    direction: "saida",
    author: "sistema",
    content_type: "evento",
    body,
  });
}

export async function markConversationReadAction(
  conversationId: string,
): Promise<void> {
  const loaded = await loadVisibleConversation(conversationId);
  if ("error" in loaded) {
    return;
  }
  await loaded.supabase
    .from("conversation")
    .update({ unread_count: 0 })
    .eq("id", loaded.conversation.id)
    .gt("unread_count", 0);
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
): Promise<InboxActionResult> {
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return { ok: false, error: "Escreva a mensagem antes de enviar." };
  }
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, conversation } = loaded;
  if (
    conversation.status !== "em_atendimento" ||
    conversation.assignee_user_id !== context.userId
  ) {
    return {
      ok: false,
      error: "Assuma a conversa antes de responder.",
    };
  }

  const result = await sendWhatsAppText(createAdminClient(), {
    clinicId: context.active!.clinicId,
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    body: parsedBody.data,
    authorUserId: context.userId,
  });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return { ok: true };
}

// Tipos que a clinica pode mandar ao paciente, e o teto de cada um.
//
// O teto NAO e preferencia: o corpo da Server Action e limitado pela
// plataforma, e um arquivo acima disso e recusado ANTES de chegar aqui, sem
// mensagem de erro util. Barrar no cliente e aqui deixa o motivo explicito.
const TETO_BYTES = 3_800_000;

const MIMES_ACEITOS: Record<string, "image" | "audio" | "document" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
  "video/mp4": "video",
  "application/pdf": "document",
};

/**
 * Envia um arquivo ao paciente.
 *
 * O arquivo sobe pela Server Action e nao direto do navegador para o balde:
 * assim a sessao, a clinica, o papel e a posse da conversa sao conferidos
 * ANTES de qualquer byte tocar o armazenamento, e o navegador nunca precisa de
 * permissao de escrita no acervo de midia de paciente.
 *
 * A ordem tambem importa: o arquivo e guardado ANTES de sair para o WhatsApp.
 * Se guardasse depois, um envio bem-sucedido cuja gravacao falhasse deixaria a
 * conversa com uma mensagem que o paciente recebeu e a clinica nao consegue
 * ver.
 */
export async function enviarArquivoAction(
  conversationId: string,
  formulario: FormData,
): Promise<InboxActionResult> {
  const arquivo = formulario.get("arquivo");
  const legenda = String(formulario.get("legenda") ?? "").trim();
  const comoNotaDeVoz = formulario.get("nota_de_voz") === "1";

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, error: "Escolha um arquivo para enviar." };
  }
  if (arquivo.size > TETO_BYTES) {
    const mb = (arquivo.size / 1_000_000).toFixed(1);
    return {
      ok: false,
      error: `O arquivo tem ${mb} MB e o limite é de 3,8 MB. Reduza o tamanho e tente de novo.`,
    };
  }
  const tipoBase = MIMES_ACEITOS[arquivo.type];
  if (!tipoBase) {
    return {
      ok: false,
      error: "Este tipo de arquivo não pode ser enviado pelo WhatsApp.",
    };
  }
  if (legenda.length > 1024) {
    return { ok: false, error: "A legenda ficou longa demais." };
  }

  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, conversation } = loaded;
  if (
    conversation.status !== "em_atendimento" ||
    conversation.assignee_user_id !== context.userId
  ) {
    return { ok: false, error: "Assuma a conversa antes de responder." };
  }

  const clinicId = context.active!.clinicId;
  const admin = createAdminClient();
  // O id da futura linha de message nasce aqui porque ele E o caminho do
  // arquivo no balde: a policy de leitura casa o segundo segmento do caminho
  // com message.id, e sem isso a foto enviada pela clinica seria a unica que
  // ninguem conseguiria abrir depois.
  const messageId = crypto.randomUUID();
  const caminho = `${clinicId}/${messageId}`;

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const { error: erroUpload } = await admin.storage
    .from("midia-conversas")
    .upload(caminho, bytes, {
      contentType: arquivo.type,
      upsert: true,
      cacheControl: "0",
    });
  if (erroUpload) {
    return {
      ok: false,
      error: "Não foi possível guardar o arquivo. Tente de novo.",
    };
  }

  const result = await sendWhatsAppMedia(admin, {
    clinicId,
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    body: legenda,
    authorUserId: context.userId,
    messageId,
    midia: {
      // Nota de voz vai como 'ptt' para chegar como audio tocavel no celular
      // do paciente, e nao como arquivo anexado.
      tipo: comoNotaDeVoz && tipoBase === "audio" ? "ptt" : tipoBase,
      base64: bytes.toString("base64"),
      mimetype: arquivo.type,
      nomeDoArquivo: tipoBase === "document" ? arquivo.name : null,
      caminhoNoStorage: caminho,
    },
  });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return { ok: true };
}

export async function addInternalNoteAction(
  conversationId: string,
  body: string,
): Promise<InboxActionResult> {
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return { ok: false, error: "Escreva a nota antes de salvar." };
  }
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, supabase, conversation } = loaded;
  const { error } = await supabase.from("message").insert({
    clinic_id: context.active!.clinicId,
    conversation_id: conversation.id,
    direction: "saida",
    author: "usuario",
    author_user_id: context.userId,
    content_type: "texto",
    body: parsedBody.data,
    is_internal_note: true,
  });
  if (error) {
    return { ok: false, error: "Não foi possível salvar a nota." };
  }
  return { ok: true };
}

export async function assumirConversaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, supabase, conversation } = loaded;
  if (conversation.assignee_user_id === context.userId) {
    return { ok: true };
  }

  // Update condicional contra o estado que a tela viu: se outra pessoa
  // assumiu no meio do caminho, zero linhas voltam e a interface avisa em vez
  // de roubar a posse por engano.
  const base = supabase
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: context.userId })
    .eq("id", conversation.id)
    .eq("status", conversation.status);
  const guarded =
    conversation.assignee_user_id === null
      ? base.is("assignee_user_id", null)
      : base.eq("assignee_user_id", conversation.assignee_user_id);
  const { data: updated } = await guarded.select("id");
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: "Outra pessoa assumiu esta conversa primeiro. Atualize a lista.",
    };
  }

  await addSystemEvent(
    supabase,
    context.active!.clinicId,
    conversation.id,
    `${context.userName} assumiu a conversa`,
  );
  await supabase.from("audit_log").insert({
    clinic_id: context.active!.clinicId,
    user_id: context.userId,
    action: "assumiu_conversa",
    entity: "conversation",
    entity_id: conversation.id,
  });
  return { ok: true };
}

export async function devolverParaIaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, supabase, conversation } = loaded;

  // UNICO caminho do sistema que devolve uma conversa para a IA: devolucao
  // explicita de quem esta com a posse. A IA nunca volta sozinha.
  const { data: updated } = await supabase
    .from("conversation")
    .update({ status: "ia_atendendo", assignee_user_id: null })
    .eq("id", conversation.id)
    .eq("assignee_user_id", context.userId)
    .select("id");
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Só quem está com a conversa pode devolver." };
  }
  await addSystemEvent(
    supabase,
    context.active!.clinicId,
    conversation.id,
    `${context.userName} devolveu a conversa para a IA`,
  );
  return { ok: true };
}

export async function resolverConversaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, supabase, conversation } = loaded;
  const { data: updated } = await supabase
    .from("conversation")
    // Resolver encerra a espera junto: alguem decidiu que nao ha nada
    // pendente. Se o paciente voltar a escrever, o ingest religa.
    .update({ status: "resolvida", awaiting_reply: false })
    .eq("id", conversation.id)
    .neq("status", "resolvida")
    .select("id");
  if (!updated || updated.length === 0) {
    return { ok: false, error: "A conversa já estava resolvida." };
  }
  await addSystemEvent(
    supabase,
    context.active!.clinicId,
    conversation.id,
    "Conversa resolvida",
  );
  return { ok: true };
}

export async function reabrirConversaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return { ok: false, error: loaded.error };
  }
  const { context, supabase, conversation } = loaded;
  const { data: updated } = await supabase
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: context.userId })
    .eq("id", conversation.id)
    .eq("status", "resolvida")
    .select("id");
  if (!updated || updated.length === 0) {
    return { ok: false, error: "A conversa já foi reaberta." };
  }
  await addSystemEvent(
    supabase,
    context.active!.clinicId,
    conversation.id,
    `${context.userName} reabriu a conversa`,
  );
  return { ok: true };
}
