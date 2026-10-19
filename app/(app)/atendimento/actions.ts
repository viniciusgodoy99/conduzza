"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import { envioCertamenteNaoSaiu } from "@/lib/integrations/whatsapp/falhas-do-envio";
import {
  carregarInstancia,
  sendWhatsAppMedia,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { log } from "@/lib/log";
import { agenteAtendeAgora, horarioDoBanco } from "@/lib/domain/agente/config";
import { etapaAposAssumir } from "@/lib/domain/jornada";
import {
  CLINICAS_DA_FASE_CONTROLADA,
  iaLiberadaNoAmbiente,
  lerConfigDaIa,
} from "@/lib/ia/liberacao";
import { motorParadoDaSituacao } from "@/lib/queries/ia-liberacao";
import {
  consentimentoVigente,
  respostasDaIaDesde,
  tetoDeRespostasPorHora,
} from "@/lib/agente/whatsapp";
import { tentarMoverPorTermo } from "@/lib/integrations/whatsapp/termo-chave";
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

export type InboxActionResult = {
  ok: boolean;
  error?: string;
  /**
   * Id da linha criada, quando houve uma.
   *
   * A tela usa para casar a bolha otimista com a mensagem real de forma EXATA,
   * em vez de por conteúdo. O casamento por conteúdo continua existindo para a
   * janela em que a linha chega pelo tempo real antes de esta resposta voltar,
   * mas ele é aproximado: este id o encerra sem dúvida.
   */
  messageId?: string;
  /**
   * A conversa aberta que ja existe para o mesmo contato, quando reabrir
   * esbarra nela. A tela leva a atendente ate essa conversa.
   */
  conversaAbertaId?: string;
  /**
   * A conversa deixou de existir PARA ESTA PESSOA (a RLS nao a mostra mais).
   * O caso real e o profissional de quem a conversa foi passada para outra
   * pessoa: o tempo real nao avisa ele, porque o evento da linha nova ja nao
   * passa pela RLS dele (achado L4). A tela tira a conversa da lista, fecha
   * o fio e explica, em vez de mostrar uma falha de envio sem motivo.
   */
  conversaIndisponivel?: boolean;
  /**
   * So na falha que veio do CANAL (send.ts), e sempre junto com naoSaiu: o
   * codigo curto da falha (o code do envio, ou o reason quando ele nao tem
   * code). Nunca dado de paciente.
   */
  codigo?: string;
  /**
   * So na falha que veio do CANAL: true quando send.ts garante que nada
   * chegou ao paciente (envioCertamenteNaoSaiu), false quando a mensagem
   * PODE ter chegado (envio_incerto, resposta do provedor, 'ja_enviado'). A
   * recusa ANTES do canal (validacao, sessao, posse, citacao) nao traz este
   * campo nem o codigo: nada foi enviado.
   */
  naoSaiu?: boolean;
};

// O TypeScript normaliza a uniao de retornos de loadVisibleConversation com
// as chaves opcionais, entao aqui as duas vem opcionais.
type CargaRecusada = { error?: string; indisponivel?: boolean };

/** A recusa de loadVisibleConversation no formato das acoes. */
function recusaDaCarga(carga: CargaRecusada): InboxActionResult {
  return carga.indisponivel
    ? { ok: false, error: carga.error, conversaIndisponivel: true }
    : { ok: false, error: carga.error };
}

type ConversationRow = {
  id: string;
  contact_id: string;
  status: "ia_atendendo" | "aguardando_humano" | "em_atendimento" | "resolvida";
  assignee_user_id: string | null;
  /**
   * O numero da clinica desta conversa (docs/07, decisao 1: uma conversa por
   * numero). Nulo so em clinica sem numero ativo. O envio (send.ts) le o
   * numero da propria conversa; aqui ele serve a reabrir e a citacao.
   */
  whatsapp_account_id: string | null;
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
    .select("id, contact_id, status, assignee_user_id, whatsapp_account_id")
    .eq("id", parsed.data)
    .eq("clinic_id", context.active.clinicId)
    .maybeSingle();
  if (!data) {
    return {
      error: "Esta conversa não está mais disponível para você." as const,
      indisponivel: true as const,
    };
  }
  return {
    context,
    supabase,
    conversation: data as ConversationRow,
  };
}

type CitacaoResolvida =
  | {
      ok: true;
      replyTo: { messageId: string; waMessageId: string | null } | null;
    }
  | { ok: false; error: string };

/**
 * Confere que a mensagem citada pode mesmo ser citada aqui.
 *
 * Duas regras, e as duas importam por motivos concretos:
 *
 * 1. MESMA CONVERSA. Sem isso, bastaria mandar o id de uma mensagem de outro
 *    paciente para que a previa da citacao renderizasse o texto dele dentro
 *    desta conversa. A RLS impede pegar mensagem de OUTRA CLINICA, mas dentro
 *    da mesma clinica ela nao separa conversa de conversa, e conversa de
 *    paciente e dado de saude.
 *
 * 2. MESMO PLANO. Nota interna nao cita mensagem do paciente e vice-versa. Uma
 *    resposta ao paciente citando uma nota interna mostraria a previa da nota
 *    para a equipe e nada para o paciente, que receberia a mensagem solta: a
 *    atendente acharia que ele esta vendo um contexto que nunca chegou la.
 *
 * E uma terceira, que a primeira ja implica hoje e continua valendo se um dia
 * a citacao entre conversas do mesmo contato for aberta: MESMO NUMERO (docs/07,
 * D2). O wa_message_id da citada so existe no chat do numero que a enviou ou
 * recebeu; citado por outro numero da clinica, o WhatsApp do paciente
 * receberia uma citacao para uma mensagem que aquele chat nunca teve.
 */
async function resolverCitacao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversation: Pick<ConversationRow, "id" | "whatsapp_account_id">,
  replyToMessageId: string | null | undefined,
  comoNota: boolean,
): Promise<CitacaoResolvida> {
  if (!replyToMessageId) {
    return { ok: true, replyTo: null };
  }
  if (!idSchema.safeParse(replyToMessageId).success) {
    return { ok: false, error: "Mensagem citada inválida." };
  }
  const { data } = await supabase
    .from("message")
    .select(
      "id, wa_message_id, conversation_id, whatsapp_account_id, is_internal_note, deleted_at",
    )
    .eq("id", replyToMessageId)
    .maybeSingle();
  if (!data || data.conversation_id !== conversation.id) {
    return { ok: false, error: "A mensagem citada não é desta conversa." };
  }
  if (
    ((data.whatsapp_account_id as string | null) ?? null) !==
    (conversation.whatsapp_account_id ?? null)
  ) {
    return {
      ok: false,
      error: "A mensagem citada é de outro número da clínica.",
    };
  }
  if (data.deleted_at) {
    return {
      ok: false,
      error: "Esta mensagem foi apagada e não pode ser citada.",
    };
  }
  if (Boolean(data.is_internal_note) !== comoNota) {
    return {
      ok: false,
      error: comoNota
        ? "Uma nota interna só cita outra nota interna."
        : "Nota interna não pode ser citada numa resposta ao paciente.",
    };
  }
  return {
    ok: true,
    replyTo: {
      messageId: data.id as string,
      waMessageId: (data.wa_message_id as string | null) ?? null,
    },
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
  replyToMessageId?: string | null,
): Promise<InboxActionResult> {
  return enviarComoAtendente(conversationId, body, { replyToMessageId });
}

/**
 * A resposta DIGITADA pela atendente, pelo trilho 1:1: confere de novo, com
 * a sessao, que a conversa esta em atendimento com quem envia, envia em nome
 * dela e anda o termo-chave da clinica, como qualquer resposta.
 *
 * E o nucleo do sendMessageAction, e tambem o do "Enviar agora" da mensagem
 * agendada (agendadas-actions.ts): o texto que saiu da agendada e uma
 * resposta da atendente, com a mesma regra e o mesmo efeito. Exportada, ela
 * e tambem uma Server Action, entao valida tudo como se viesse do cliente
 * (Zod na entrada, papel, posse da conversa).
 */
export async function enviarComoAtendente(
  conversationId: string,
  body: string,
  opcoes: { replyToMessageId?: string | null } = {},
): Promise<InboxActionResult> {
  // Opcional ate no formato: chamada direta do cliente pode mandar nulo.
  const replyToMessageId = opcoes?.replyToMessageId ?? null;
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return { ok: false, error: "Escreva a mensagem antes de enviar." };
  }
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  if (
    conversation.status !== "em_atendimento" ||
    conversation.assignee_user_id !== context.userId
  ) {
    return {
      ok: false,
      error: "Assuma a conversa antes de responder.",
    };
  }

  // Resolvida com a SESSAO, antes de o service role entrar: e a RLS que prova
  // que a citada e visivel para quem esta citando.
  const citacao = await resolverCitacao(
    supabase,
    conversation,
    replyToMessageId,
    false,
  );
  if (!citacao.ok) {
    return { ok: false, error: citacao.error };
  }

  const result = await sendWhatsAppText(createAdminClient(), {
    clinicId: context.active!.clinicId,
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    body: parsedBody.data,
    authorUserId: context.userId,
    replyTo: citacao.replyTo,
  });
  if (!result.ok) {
    // O codigo e se e CERTO que nada saiu: o "Enviar agora" da mensagem
    // agendada so devolve o texto ao campo quando nada chegou ao paciente
    // (achado 1 da revisao: envio incerto nao e "nao saiu").
    const falhaDoCanal = {
      codigo: result.code ?? result.reason,
      naoSaiu: envioCertamenteNaoSaiu(result),
    };
    // "O envio foi remarcado" é verdade para o worker, que reagenda o job, e
    // MENTIRA aqui: no caminho da atendente ninguém reagenda nada e a mensagem
    // nem chegou a nascer.
    if (result.reason === "slot_adiado") {
      return {
        ok: false,
        error:
          "O número da clínica está enviando outras mensagens agora. Tente de novo em instantes.",
        ...falhaDoCanal,
      };
    }
    return { ok: false, error: result.message, ...falhaDoCanal };
  }
  moverPorTermoDaClinica({
    clinicId: context.active!.clinicId,
    contactId: conversation.contact_id,
    corpo: parsedBody.data,
    userId: context.userId,
  });
  return { ok: true, messageId: result.messageId };
}

// TERMO-CHAVE escrito pela CLINICA (pedido do dono em 02/10/2026): o texto
// que a atendente acabou de enviar pelo sistema (mensagem ou legenda de
// arquivo) anda o lead quando a etapa aceita termo da clinica. As mensagens
// da IA e da regua de follow-up ficam de fora por ora (estender e decisao do
// dono). A decisao e o update guardado pela etapa atual vivem em
// lib/integrations/whatsapp/termo-chave.ts, os mesmos da mensagem do
// paciente. So depois do envio bem-sucedido, e DEPOIS da resposta
// (after): mover etapa e bonus e nunca atrasa nem derruba o envio. Cliente
// admin pelo mesmo motivo do Assumir (o profissional responde, mas nao
// escreve em contact); a trilha leva quem enviou. Fora de uma requisicao
// (teste, script) o after nao existe e a tarefa roda solta.
function moverPorTermoDaClinica(params: {
  clinicId: string;
  contactId: string;
  corpo: string;
  userId: string;
}): void {
  const tarefa = async (): Promise<void> => {
    try {
      await tentarMoverPorTermo(createAdminClient(), {
        clinicId: params.clinicId,
        contactId: params.contactId,
        corpo: params.corpo,
        quemEscreveu: "clinica",
        userId: params.userId,
      });
    } catch {
      log.warn("termo_chave_falhou", {
        clinic_id: params.clinicId,
        contact_id: params.contactId,
        kind: "clinica",
      });
    }
  };
  try {
    after(tarefa);
  } catch {
    void tarefa();
  }
}

// Tipos que a clinica pode mandar ao paciente, e o teto de cada um.
//
// O teto NAO e preferencia: o corpo da Server Action e limitado pela
// plataforma, e um arquivo acima disso e recusado ANTES de chegar aqui, sem
// mensagem de erro util. Barrar no cliente e aqui deixa o motivo explicito.
const TETO_BYTES = 3_800_000;

const MIMES_ACEITOS: Record<string, "image" | "audio" | "document" | "video"> =
  {
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
  const citadaId = String(formulario.get("citando") ?? "") || null;

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
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  if (
    conversation.status !== "em_atendimento" ||
    conversation.assignee_user_id !== context.userId
  ) {
    return { ok: false, error: "Assuma a conversa antes de responder." };
  }

  const citacao = await resolverCitacao(
    supabase,
    conversation,
    citadaId,
    false,
  );
  if (!citacao.ok) {
    return { ok: false, error: citacao.error };
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
    replyTo: citacao.replyTo,
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
    // O arquivo subiu ANTES do envio (de proposito: se subisse depois, um
    // envio bem-sucedido cuja gravacao falhasse deixaria o paciente com uma
    // mensagem que a clinica nao ve). Quando o envio nao acontece, o objeto
    // precisa sair: arquivo de paciente parado no acervo sem nenhuma linha de
    // mensagem apontando para ele e dado guardado sem motivo e sem trilha.
    await admin.storage.from("midia-conversas").remove([caminho]);
    return { ok: false, error: result.message };
  }
  // A legenda e texto que a recepcao escreveu: anda o lead pelo termo da
  // clinica como o texto de sendMessageAction (mesma regra, depois do envio
  // bem-sucedido e da resposta). Sem legenda, nao ha o que testar.
  if (legenda) {
    moverPorTermoDaClinica({
      clinicId,
      contactId: conversation.contact_id,
      corpo: legenda,
      userId: context.userId,
    });
  }
  return { ok: true };
}

export async function addInternalNoteAction(
  conversationId: string,
  body: string,
  replyToMessageId?: string | null,
): Promise<InboxActionResult> {
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return { ok: false, error: "Escreva a nota antes de salvar." };
  }
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  const citacao = await resolverCitacao(
    supabase,
    conversation,
    replyToMessageId,
    true,
  );
  if (!citacao.ok) {
    return { ok: false, error: citacao.error };
  }
  const { data: nova, error } = await supabase
    .from("message")
    .insert({
      clinic_id: context.active!.clinicId,
      conversation_id: conversation.id,
      direction: "saida",
      author: "usuario",
      author_user_id: context.userId,
      content_type: "texto",
      body: parsedBody.data,
      is_internal_note: true,
      reply_to_message_id: citacao.replyTo?.messageId ?? null,
    })
    .select("id")
    .single();
  if (error || !nova) {
    return { ok: false, error: "Não foi possível salvar a nota." };
  }
  return { ok: true, messageId: nova.id as string };
}

// Por que cada recusa aconteceu, na lingua de quem atende. Os codigos vem de
// pode_apagar_mensagem, no banco: a regra mora la, e nao aqui, porque esta
// Server Action nao pode ser o unico guardiao de conteudo de paciente.
const MOTIVO_DE_NAO_APAGAR: Record<string, string> = {
  sem_sessao: "Sessão expirada. Entre de novo.",
  escopo_invalido: "Não entendemos o tipo de exclusão pedido.",
  nao_encontrada: "Esta mensagem não existe mais.",
  sem_permissao: "Seu perfil pode acompanhar o atendimento, mas não apagar.",
  nao_e_sua:
    "Só quem escreveu a mensagem pode apagar. Um administrador ou gestor também pode.",
  ja_apagada: "Esta mensagem já foi apagada.",
  nota_e_local:
    "Nota interna nunca saiu da clínica, então ela só pode ser apagada aqui.",
  do_paciente:
    "O WhatsApp não deixa apagar a mensagem do paciente no aparelho dele. Você pode apagar só aqui.",
  nunca_saiu:
    "Esta mensagem não chegou a sair, então não há o que apagar no WhatsApp do paciente.",
  prazo_vencido:
    "O WhatsApp só deixa apagar para todos até 60 horas depois do envio. Você ainda pode apagar só aqui.",
};

type Veredito = {
  ok: boolean;
  motivo?: string;
  /**
   * O que cabe fazer com esta mensagem, decidido pelo banco:
   *   apagar   a linha está viva: arquiva no cofre e limpa.
   *   escalar  já apagada como 'local': promove o escopo para 'todos'.
   *   adotar   já apagada pelo eco do provedor: só falta gravar quem foi.
   */
  acao?: "apagar" | "escalar" | "adotar";
  clinic_id?: string;
  wa_message_id?: string | null;
  media_url?: string | null;
  nota_interna?: boolean;
};

type NumeroDaMensagem =
  { ok: true; accountId: string } | { ok: false; error: string };

/**
 * O numero pelo qual a mensagem saiu (message.whatsapp_account_id: a copia do
 * numero da conversa, imutavel). Revogar no WhatsApp so funciona pela MESMA
 * instancia que enviou: o wa_message_id nao existe no chat de outro numero
 * (docs/07, Fase 2).
 *
 * Lido com o admin client DEPOIS de pode_apagar_mensagem ter autorizado, e
 * filtrado pela clinica do veredito: traz so ids e a data de remocao, nenhum
 * conteudo. Pela sessao, o profissional autor de uma mensagem numa conversa
 * que ja passou para outra pessoa nao enxergaria a linha, e o veredito ja o
 * autorizou a apagar.
 */
async function numeroDaMensagem(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
  messageId: string,
): Promise<NumeroDaMensagem> {
  const falhaGenerica: NumeroDaMensagem = {
    ok: false,
    error: "Não foi possível apagar agora. Tente de novo.",
  };
  const { data: mensagem, error } = await admin
    .from("message")
    .select("whatsapp_account_id")
    .eq("clinic_id", clinicId)
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    return falhaGenerica;
  }
  const accountId =
    (mensagem as { whatsapp_account_id: string | null } | null)
      ?.whatsapp_account_id ?? null;
  if (!accountId) {
    return {
      ok: false,
      error:
        "Não encontramos o número de WhatsApp por onde esta mensagem saiu. Você ainda pode apagar só aqui.",
    };
  }
  const { data: numero, error: erroDoNumero } = await admin
    .from("whatsapp_account")
    .select("removido_em")
    .eq("clinic_id", clinicId)
    .eq("id", accountId)
    .maybeSingle();
  if (erroDoNumero) {
    return falhaGenerica;
  }
  // Numero removido teve a instancia excluida no servidor do WhatsApp: nao
  // ha mais por onde revogar.
  if (!numero || (numero as { removido_em: string | null }).removido_em) {
    return {
      ok: false,
      error:
        "Esta mensagem saiu por um número que foi removido da clínica. Você ainda pode apagar só aqui.",
    };
  }
  return { ok: true, accountId };
}

/**
 * Apaga uma mensagem, em um de dois escopos.
 *
 * 'todos' revoga tambem no WhatsApp do paciente; 'local' tira so da conversa
 * da clinica. Quem pode, e ate quando, e decidido pelo banco
 * (pode_apagar_mensagem), nao aqui: esta funcao orquestra a ORDEM, que e o que
 * ela tem de proprio.
 *
 * A ORDEM e o ponto delicado. Conferir, revogar no WhatsApp, e SO ENTAO
 * gravar. Se gravassemos antes de falar com o provedor, uma recusa dele
 * deixaria a conversa marcada como apagada aqui e a mensagem viva no celular
 * do paciente: a clinica acreditaria ter apagado algo que continua la. O
 * inverso (revogar e falhar ao gravar) erra para o lado seguro, porque
 * mostramos a mais, nunca a menos.
 */
export async function apagarMensagemAction(
  messageId: string,
  escopo: "todos" | "local",
): Promise<InboxActionResult> {
  if (!idSchema.safeParse(messageId).success) {
    return { ok: false, error: "Mensagem inválida." };
  }
  if (escopo !== "todos" && escopo !== "local") {
    return { ok: false, error: "Não entendemos o tipo de exclusão pedido." };
  }
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pode_apagar_mensagem", {
    p_message_id: messageId,
    p_escopo: escopo,
  });
  if (error) {
    return {
      ok: false,
      error: "Não foi possível apagar agora. Tente de novo.",
    };
  }
  const veredito = (data ?? {}) as Veredito;
  if (!veredito.ok) {
    return {
      ok: false,
      error:
        MOTIVO_DE_NAO_APAGAR[veredito.motivo ?? ""] ??
        "Esta mensagem não pode ser apagada.",
    };
  }

  const admin = createAdminClient();

  // Nota interna nunca saiu do prédio: não há o que revogar no WhatsApp. E
  // 'adotar' significa que o provedor JÁ revogou (o eco chegou antes da nossa
  // gravação): mandar apagar de novo seria pedir ao WhatsApp que apagasse o que
  // ele acabou de apagar.
  const precisaRevogar =
    escopo === "todos" &&
    !veredito.nota_interna &&
    Boolean(veredito.wa_message_id) &&
    veredito.acao !== "adotar";
  let numeroDoEnvio: string | null = null;
  if (precisaRevogar) {
    const numero = await numeroDaMensagem(
      admin,
      veredito.clinic_id!,
      messageId,
    );
    if (!numero.ok) {
      return { ok: false, error: numero.error };
    }
    numeroDoEnvio = numero.accountId;
    const { provider, ref } = await carregarInstancia(
      admin,
      veredito.clinic_id!,
      numero.accountId,
    );
    const revogado = await provider
      .deleteMessage(ref, veredito.wa_message_id!)
      .catch(() => ({
        ok: false as const,
        errorCode: "provider_indisponivel",
        message:
          "Não conseguimos falar com o servidor do WhatsApp. A mensagem não foi apagada.",
      }));
    if (!revogado.ok) {
      return { ok: false, error: revogado.message };
    }
  }

  // Reconfere tudo por dentro: entre a conferencia acima e agora, o papel de
  // quem pediu pode ter mudado ou o prazo pode ter vencido.
  const { data: gravado, error: erroGravar } = await supabase.rpc(
    "apagar_mensagem",
    { p_message_id: messageId, p_escopo: escopo },
  );
  if (erroGravar || !(gravado as Veredito | null)?.ok) {
    if (precisaRevogar) {
      // Ja sumiu do celular do paciente e a nossa linha ficou. Erra para o
      // lado de mostrar demais, e nao de esconder sem registro, mas alguem
      // precisa saber. Nenhum conteudo de mensagem no log.
      log.error("apagou_no_whatsapp_mas_nao_gravou", {
        clinic_id: veredito.clinic_id ?? null,
        message_id: messageId,
        whatsapp_account_id: numeroDoEnvio,
      });
    }
    return {
      ok: false,
      error: "Não foi possível apagar agora. Tente de novo.",
    };
  }

  // O arquivo sai do acervo junto. A policy de leitura ja o bloqueia (ela
  // exige deleted_at nulo), entao manter os bytes seria guardar foto de
  // paciente que ninguem consegue abrir nem auditar.
  const prefixo = "storage://midia-conversas/";
  if (veredito.media_url?.startsWith(prefixo)) {
    const { error: erroArquivo } = await admin.storage
      .from("midia-conversas")
      .remove([veredito.media_url.slice(prefixo.length)]);
    if (erroArquivo) {
      log.error("apagou_mensagem_mas_arquivo_ficou", {
        clinic_id: veredito.clinic_id ?? null,
        message_id: messageId,
      });
    }
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
    return recusaDaCarga(loaded);
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
  await moverLeadAoAssumir(
    context.active!.clinicId,
    conversation.contact_id,
    context.userId,
  );
  return { ok: true };
}

// Assumir a conversa de um lead NOVO o move para "Em contato" (decisao do
// dono em 19/09/2026). A regra e a funcao pura etapaAposAssumir (testada em
// unidade); aqui vive so o encanamento: cliente ADMIN porque o papel
// profissional pode assumir mas a policy de contact nao o deixa escrever
// (automacao do sistema, auditada em nome de quem assumiu), CAS por
// funnel_stage contra corrida, e falha NUNCA quebra o assumir. Os gatilhos
// existentes fazem o resto (ancora de follow-up, conversao do funil).
async function moverLeadAoAssumir(
  clinicId: string,
  contactId: string,
  userId: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: contato } = await admin
      .from("contact")
      .select("kind, funnel_stage")
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .maybeSingle();
    if (!contato) {
      return;
    }
    const { data: etapas } = await admin
      .from("funnel_stage_def")
      .select("chave, papel")
      .eq("clinic_id", clinicId);
    const jornada = (etapas ?? []) as { chave: string; papel: string | null }[];
    const destino = etapaAposAssumir({
      kind: contato.kind as "lead" | "paciente",
      etapaAtual:
        (jornada.find((e) => e.chave === contato.funnel_stage) as
          | {
              chave: string;
              papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
            }
          | undefined) ?? null,
      jornada: jornada as {
        chave: string;
        papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
      }[],
    });
    if (!destino) {
      return;
    }
    const { data: movido } = await admin
      .from("contact")
      .update({ funnel_stage: destino })
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .eq("funnel_stage", contato.funnel_stage)
      .select("id");
    if (movido && movido.length > 0) {
      await admin.from("audit_log").insert({
        clinic_id: clinicId,
        user_id: userId,
        action: "assumir_moveu_etapa",
        entity: "contact",
        entity_id: contactId,
      });
      revalidatePath("/leads");
    }
  } catch {
    // Melhor esforco declarado: o assumir ja valeu, e mover etapa e bonus.
    log.warn("assumir_moveu_etapa_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
    });
  }
}

// Etiquetas da conversa (21/09/2026). A RPC e security invoker: quem pode
// etiquetar e exatamente quem a policy de UPDATE de conversation deixa
// escrever (recepcao sim, leitura nao, profissional so na conversa dele).
// Devolve o array final para o cliente gravar no cache sem refetch.

const etiquetarConversaSchema = z.object({
  conversation_id: z.uuid(),
  adicionar: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(8),
  remover: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(8),
});

export async function etiquetarConversaAction(
  entrada: unknown,
): Promise<InboxActionResult & { tags?: string[] }> {
  const parsed = etiquetarConversaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const loaded = await loadVisibleConversation(parsed.data.conversation_id, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;

  const { data, error } = await supabase.rpc("etiquetar_conversa", {
    p_clinic_id: context.active!.clinicId,
    p_conversation_id: conversation.id,
    p_adicionar: parsed.data.adicionar,
    p_remover: parsed.data.remover,
  });
  if (error) {
    // Lista branca: erro de banco nunca sobe cru para a tela.
    return {
      ok: false,
      error: error.message.includes("não existe nesta clínica")
        ? "Essa etiqueta foi excluída por outra pessoa. Atualize a página."
        : "Não foi possível etiquetar a conversa.",
    };
  }
  if (data === null) {
    // Zero linhas: a RLS recusou (papel sem escrita, ou conversa de outro
    // atendente para o papel profissional).
    return { ok: false, error: "Você não pode etiquetar esta conversa." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: context.active!.clinicId,
    user_id: context.userId,
    action: "etiquetou_conversa",
    entity: "conversation",
    entity_id: conversation.id,
  });
  // Sem revalidatePath: a lista e cache de cliente mantido por realtime, e
  // revalidar seria uma ida ao servidor por clique de caixa de selecao.
  return { ok: true, tags: data as string[] };
}

/**
 * O que a tela mostra no Devolver: os motivos de ia_devolver_disponivel e,
 * depois do "pode" do banco, os que so o servidor sabe (revisao do E3,
 * contrato 10.1): assistente_parado (ambiente, motor da IA parado ou modo de
 * horario que nao funciona no WhatsApp), fora_do_horario (a versao publicada
 * nao atende agora), numero_desconectado, sem_autorizacao (o contato revogou
 * a autorizacao para receber mensagens: o executor passa a conversa sem
 * resposta, S5) e teto_de_respostas (a conversa ja teve o teto de respostas
 * da IA na ultima hora: o executor escala de novo sem o modelo).
 */
export type MotivoDoDevolver =
  | "fora_da_fase"
  | "sem_permissao"
  | "nao_e_sua"
  | "pergunta_pendente"
  | "assistente_desligado"
  | "nao_liberada"
  | "contato_de_paciente"
  | "nao_disponivel"
  | "assistente_parado"
  | "fora_do_horario"
  | "numero_desconectado"
  | "sem_autorizacao"
  | "teto_de_respostas";

export type ElegibilidadeDoDevolver =
  | { ok: true; pode: true }
  | { ok: true; pode: false; motivo: MotivoDoDevolver }
  | { ok: false; error: string };

const MOTIVOS_DO_DEVOLVER: readonly MotivoDoDevolver[] = [
  "fora_da_fase",
  "sem_permissao",
  "nao_e_sua",
  "pergunta_pendente",
  "assistente_desligado",
  "nao_liberada",
  "contato_de_paciente",
  "nao_disponivel",
];

const TEXTOS_DO_DEVOLVER = {
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  conversaInvalida: "Conversa inválida.",
  naoConferiu: "Não foi possível conferir agora. Tente de novo.",
  semPermissao: "Você não pode devolver esta conversa para a IA.",
  naoPodeAgora: "Esta conversa não pode voltar para a IA agora.",
  mudou: "A conversa mudou enquanto você devolvia. Atualize e tente de novo.",
  naoEncontrada: "Conversa não encontrada. Atualize a lista.",
  naoDevolveu: "Não foi possível devolver a conversa para a IA. Tente de novo.",
} as const;

/** A IA so existe nas clinicas da fase controlada (lib/ia/liberacao.ts). */
function clinicaDaFase(clinicId: string): boolean {
  return CLINICAS_DA_FASE_CONTROLADA.includes(clinicId.trim().toLowerCase());
}

/** O assistente responderia esta conversa agora? */
type ConferenciaDoAssistente =
  | { tipo: "de_pe" }
  | {
      tipo: "parado";
      motivo: Extract<
        MotivoDoDevolver,
        | "assistente_parado"
        | "assistente_desligado"
        | "fora_do_horario"
        | "numero_desconectado"
        | "sem_autorizacao"
        | "teto_de_respostas"
      >;
    }
  | { tipo: "nao_conferiu" };

/**
 * situacao_da_ia_na_clinica(clinica).motor_parado pela service role
 * (contrato 10.3, B8): a sessao comum nao ve os detalhes da IA em
 * saude_do_motor, e a recepcao (quem mais devolve) nao le
 * situacao_da_ia_na_clinica. Sem dado de paciente; a sessao ja conferiu a
 * clinica e a conversa antes. null: nao conferiu.
 */
async function motorDaIaParadoPeloServidor(
  clinicId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await createAdminClient().rpc(
      "situacao_da_ia_na_clinica",
      { p_clinic_id: clinicId },
    );
    return error ? null : motorParadoDaSituacao(data);
  } catch {
    return null;
  }
}

/** A janela do teto de respostas por conversa (a mesma do executor). */
const UMA_HORA_MS = 60 * 60 * 1000;

/**
 * O contato da conversa ainda autoriza receber mensagens, e a conversa nao
 * chegou ao teto de respostas da IA na ultima hora? As MESMAS leituras do
 * executor (lib/agente/whatsapp.ts, passos 5b e 8 de responder-com-ia.ts),
 * pela service role: consentimento_vigente pela sessao do super admin que
 * nao e membro da clinica devolveria falso, e a recepcao nao le
 * ia_liberacao. Sem dado de paciente: so booleano e contagem, com a clinica
 * explicita (a sessao ja conferiu a clinica e a conversa). null: nao
 * conferiu. Conferencia N1 e N2 da revisao do E3.
 */
async function contatoETetoPeloServidor(entrada: {
  clinicId: string;
  conversationId: string;
  contactId: string;
}): Promise<"de_pe" | "sem_autorizacao" | "teto_de_respostas" | null> {
  try {
    const admin = createAdminClient();
    if (
      !(await consentimentoVigente(admin, {
        clinicId: entrada.clinicId,
        contactId: entrada.contactId,
      }))
    ) {
      return "sem_autorizacao";
    }
    const teto = await tetoDeRespostasPorHora(admin, entrada.clinicId);
    if (teto !== null) {
      const respostas = await respostasDaIaDesde(admin, {
        clinicId: entrada.clinicId,
        conversationId: entrada.conversationId,
        desdeIso: new Date(Date.now() - UMA_HORA_MS).toISOString(),
      });
      if (respostas >= teto) {
        return "teto_de_respostas";
      }
    }
    return "de_pe";
  } catch {
    return null;
  }
}

/**
 * Depois do "pode" do banco (clinica, papel, responsavel, liberacao, teto,
 * versao publicada, numero e telefone liberados e, so com tudo isso, a
 * pergunta pendente),
 * o que o executor ainda exige e o banco nao ve (revisao do E3, T1): o
 * ambiente (producao, chave e segredo do identificador), o motor da IA, o
 * modo e o horario da versao PUBLICADA agora, no fuso da clinica, o numero
 * da conversa conectado, a autorizacao do contato para receber mensagens e
 * o teto de respostas da IA na conversa na ultima hora. Sem isso o botao
 * prometia uma resposta que nao vinha. Leitura que falha: nao conferiu (o
 * botao nao habilita). A conversa, a versao publicada e o numero vem pela
 * SESSAO (RLS); o motor, a autorizacao e o teto vem pela service role.
 */
async function conferirAssistenteDePe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entrada: { clinicId: string; conversationId: string; fuso: string },
): Promise<ConferenciaDoAssistente> {
  if (!iaLiberadaNoAmbiente(lerConfigDaIa(), entrada.clinicId)) {
    return { tipo: "parado", motivo: "assistente_parado" };
  }
  const [conversa, publicada, motorParado] = await Promise.all([
    supabase
      .from("conversation")
      .select("whatsapp_account_id, contact_id")
      .eq("id", entrada.conversationId)
      .eq("clinic_id", entrada.clinicId)
      .maybeSingle(),
    supabase
      .from("ai_agent_config")
      .select("operating_mode, fallback_minutes, operating_hours")
      .eq("clinic_id", entrada.clinicId)
      .eq("status", "publicada")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    motorDaIaParadoPeloServidor(entrada.clinicId),
  ]);
  if (
    conversa.error ||
    publicada.error ||
    !conversa.data ||
    motorParado === null
  ) {
    return { tipo: "nao_conferiu" };
  }
  if (motorParado) {
    return { tipo: "parado", motivo: "assistente_parado" };
  }
  const linha = publicada.data as {
    operating_mode: string;
    fallback_minutes: number | null;
    operating_hours: unknown;
  } | null;
  if (linha === null) {
    // O banco acabou de dizer que ha versao publicada: mesma resposta dele.
    return { tipo: "parado", motivo: "assistente_desligado" };
  }
  const horario = horarioDoBanco(linha);
  if (horario.modo === "fallback") {
    return { tipo: "parado", motivo: "assistente_parado" };
  }
  if (!agenteAtendeAgora(horario, Date.now(), entrada.fuso).atende) {
    return { tipo: "parado", motivo: "fora_do_horario" };
  }
  const numeroId = (conversa.data as { whatsapp_account_id: string | null })
    .whatsapp_account_id;
  if (numeroId === null) {
    return { tipo: "parado", motivo: "numero_desconectado" };
  }
  const numero = await supabase
    .from("whatsapp_account")
    .select("connection_status, removido_em")
    .eq("id", numeroId)
    .eq("clinic_id", entrada.clinicId)
    .maybeSingle();
  if (numero.error) {
    return { tipo: "nao_conferiu" };
  }
  const dadosDoNumero = numero.data as {
    connection_status: string | null;
    removido_em: string | null;
  } | null;
  if (
    dadosDoNumero === null ||
    dadosDoNumero.removido_em !== null ||
    dadosDoNumero.connection_status !== "conectado"
  ) {
    return { tipo: "parado", motivo: "numero_desconectado" };
  }
  const contactId = (conversa.data as { contact_id: string | null }).contact_id;
  if (contactId === null) {
    return { tipo: "nao_conferiu" };
  }
  const contatoETeto = await contatoETetoPeloServidor({
    clinicId: entrada.clinicId,
    conversationId: entrada.conversationId,
    contactId,
  });
  if (contatoETeto === null) {
    return { tipo: "nao_conferiu" };
  }
  if (contatoETeto !== "de_pe") {
    return { tipo: "parado", motivo: contatoETeto };
  }
  return { tipo: "de_pe" };
}

/**
 * Quem nao e administrador, gestor nem super admin nao recebe o motivo do
 * assistente parado ou desligado (como o banco faz com assistente_desligado):
 * recebe o generico. Horario, numero desconectado, autorizacao do contato e
 * teto de respostas da conversa servem a todos (nao expoem lista nenhuma).
 */
function motivoParaOPapel(
  motivo: Extract<
    MotivoDoDevolver,
    | "assistente_parado"
    | "assistente_desligado"
    | "fora_do_horario"
    | "numero_desconectado"
    | "sem_autorizacao"
    | "teto_de_respostas"
  >,
  papel: string,
  superAdmin: boolean,
): MotivoDoDevolver {
  const veOMotivo = superAdmin || papel === "admin" || papel === "gestor";
  if (
    !veOMotivo &&
    (motivo === "assistente_parado" || motivo === "assistente_desligado")
  ) {
    return "nao_disponivel";
  }
  return motivo;
}

/**
 * Se o botao Devolver para a IA fica habilitado, e por que nao. Le
 * ia_devolver_disponivel com a SESSAO: o banco confere a clinica, o papel, o
 * responsavel, a liberacao e, so depois dela, a pergunta pendente (revisao
 * de producao de 19/10/2026, migration 20261019120000: conversa de paciente
 * nunca diz "Responda o paciente antes de devolver para a IA."), e para
 * quem nao e administrador nem gestor troca o motivo da liberacao pelo
 * generico (nao_disponivel), sem expor a lista de telefones. Fora das duas
 * clinicas da fase, fora_da_fase sem ir ao banco.
 */
export async function elegibilidadeDoDevolverAction(
  conversationId: string,
): Promise<ElegibilidadeDoDevolver> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: TEXTOS_DO_DEVOLVER.sessaoExpirada };
  }
  const parsed = idSchema.safeParse(conversationId);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DO_DEVOLVER.conversaInvalida };
  }
  if (!clinicaDaFase(context.active.clinicId)) {
    return { ok: true, pode: false, motivo: "fora_da_fase" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ia_devolver_disponivel", {
    p_conversation_id: parsed.data,
  });
  if (error) {
    log.warn("devolver_para_ia_nao_conferido", {
      clinic_id: context.active.clinicId,
      conversation_id: parsed.data,
      error_code: error.code ?? null,
    });
    return { ok: false, error: TEXTOS_DO_DEVOLVER.naoConferiu };
  }
  const resposta = data as { pode?: unknown; motivo?: unknown } | null;
  if (resposta?.pode === true) {
    const conferencia = await conferirAssistenteDePe(supabase, {
      clinicId: context.active.clinicId,
      conversationId: parsed.data,
      fuso: context.active.timezone,
    });
    if (conferencia.tipo === "nao_conferiu") {
      log.warn("devolver_para_ia_nao_conferido", {
        clinic_id: context.active.clinicId,
        conversation_id: parsed.data,
        error_code: "assistente_nao_conferido",
      });
      return { ok: false, error: TEXTOS_DO_DEVOLVER.naoConferiu };
    }
    if (conferencia.tipo === "parado") {
      return {
        ok: true,
        pode: false,
        motivo: motivoParaOPapel(
          conferencia.motivo,
          context.active.role,
          context.isProductAdmin,
        ),
      };
    }
    return { ok: true, pode: true };
  }
  const motivo = MOTIVOS_DO_DEVOLVER.find((m) => m === resposta?.motivo);
  if (resposta?.pode === false && motivo !== undefined) {
    return { ok: true, pode: false, motivo };
  }
  return { ok: false, error: TEXTOS_DO_DEVOLVER.naoConferiu };
}

/** O erro de devolver_para_ia em texto de recepcionista (contrato 4.4). */
function textoDoErroDoDevolver(erro: {
  code?: string;
  message?: string;
}): string {
  const chave = (erro.message ?? "").trim();
  if (erro.code === "42501") {
    return chave === "nao_liberada" || chave === "contato_de_paciente"
      ? TEXTOS_DO_DEVOLVER.naoPodeAgora
      : TEXTOS_DO_DEVOLVER.semPermissao;
  }
  if (erro.code === "CZ409") {
    return TEXTOS_DO_DEVOLVER.mudou;
  }
  if (erro.code === "P0002") {
    return TEXTOS_DO_DEVOLVER.naoEncontrada;
  }
  return TEXTOS_DO_DEVOLVER.naoDevolveu;
}

/**
 * Devolver para a IA (E3). A conversa precisa ser de quem chama, sem
 * pergunta pendente, de telefone da equipe liberado e sem sinal de
 * paciente: tudo conferido pelo banco, numa transacao, em devolver_para_ia
 * (a unica porta pela qual a sessao poe conversa em ia_atendendo). A
 * janela da conversa recomeca agora: a IA nao le o que veio antes.
 *
 * Sem revalidatePath: a lista e o fio sao cache de cliente com tempo real.
 */
export async function devolverParaIaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  // O que o banco nao ve (ambiente, motor, horario agora, numero): a mesma
  // conferencia do botao, antes de gravar qualquer coisa.
  const conferencia = await conferirAssistenteDePe(supabase, {
    clinicId: context.active!.clinicId,
    conversationId: conversation.id,
    fuso: context.active!.timezone,
  });
  if (conferencia.tipo !== "de_pe") {
    log.warn("devolver_para_ia_recusado", {
      clinic_id: context.active!.clinicId,
      conversation_id: conversation.id,
      error_code:
        conferencia.tipo === "parado"
          ? conferencia.motivo
          : "assistente_nao_conferido",
    });
    return {
      ok: false,
      error:
        conferencia.tipo === "parado"
          ? TEXTOS_DO_DEVOLVER.naoPodeAgora
          : TEXTOS_DO_DEVOLVER.naoConferiu,
    };
  }
  const { error } = await supabase.rpc("devolver_para_ia", {
    p_conversation_id: conversation.id,
  });
  if (error) {
    log.warn("devolver_para_ia_recusado", {
      clinic_id: context.active!.clinicId,
      conversation_id: conversation.id,
      error_code: error.code ?? null,
    });
    return { ok: false, error: textoDoErroDoDevolver(error) };
  }
  return { ok: true };
}

export type LeituraDoRascunho =
  { ok: true; texto: string | null } | { ok: false; error: string };

const TEXTOS_DO_RASCUNHO = {
  soEquipeConduzza: "Só a equipe Conduzza vê o rascunho bloqueado.",
  naoExiste: "Este registro não existe mais.",
  naoCarregou: "Não foi possível carregar o rascunho. Tente de novo.",
} as const;

/**
 * O texto que a conformidade barrou (dado de saude em potencial). Ate o
 * dono decidir (D25), so o super admin le; o banco confere de novo
 * (ler_rascunho_bloqueado) e grava a leitura no audit_log. Nunca vai a log.
 */
export async function lerRascunhoBloqueadoAction(
  decisionId: string,
): Promise<LeituraDoRascunho> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: TEXTOS_DO_DEVOLVER.sessaoExpirada };
  }
  if (!context.isProductAdmin) {
    return { ok: false, error: TEXTOS_DO_RASCUNHO.soEquipeConduzza };
  }
  const parsed = idSchema.safeParse(decisionId);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DO_RASCUNHO.naoExiste };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ler_rascunho_bloqueado", {
    p_decision_id: parsed.data,
  });
  if (error) {
    log.warn("rascunho_bloqueado_nao_lido", {
      clinic_id: context.active.clinicId,
      error_code: error.code ?? null,
    });
    if (error.code === "42501") {
      return { ok: false, error: TEXTOS_DO_RASCUNHO.soEquipeConduzza };
    }
    if (error.code === "P0002") {
      return { ok: false, error: TEXTOS_DO_RASCUNHO.naoExiste };
    }
    return { ok: false, error: TEXTOS_DO_RASCUNHO.naoCarregou };
  }
  const texto = (data as { texto?: unknown } | null)?.texto;
  if (texto === null || texto === undefined) {
    return { ok: true, texto: null };
  }
  if (typeof texto !== "string") {
    return { ok: false, error: TEXTOS_DO_RASCUNHO.naoCarregou };
  }
  return { ok: true, texto };
}

// Quem passa conversa para outra pessoa: a matriz da recepcao para cima. O
// profissional so ve as conversas dele e nao distribui atendimento.
const PAPEIS_QUE_TRANSFEREM = ["admin", "gestor", "recepcao"] as const;
// Quem pode RECEBER: quem escreve dado de paciente (o mesmo recorte de
// user_can_write). Passar para 'leitura' deixaria a conversa com alguem que
// nao consegue responder.
const PAPEIS_QUE_RECEBEM = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
] as const;

const transferirSchema = z.object({
  conversation_id: z.uuid(),
  para_user_id: z.uuid(),
});

/**
 * Passa a conversa para um membro ativo da clinica (achados 2 e 16).
 *
 * E o caminho pelo qual a conversa chega ao profissional, que pela RLS so
 * enxerga as conversas atribuidas a ele. A policy de UPDATE de conversation
 * ja permite a quem nao e profissional gravar outro responsavel; a checagem
 * de papel e de destino mora aqui. Update condicional ao responsavel e ao
 * status que a tela viu, no mesmo padrao do assumir: se alguem mexeu no
 * meio do caminho, nada muda e a tela avisa.
 */
export async function transferirConversaAction(
  entrada: unknown,
): Promise<InboxActionResult> {
  const parsed = transferirSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const loaded = await loadVisibleConversation(parsed.data.conversation_id, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  const clinicId = context.active!.clinicId;
  const destino = parsed.data.para_user_id;

  if (
    !(PAPEIS_QUE_TRANSFEREM as readonly string[]).includes(context.active!.role)
  ) {
    return {
      ok: false,
      error:
        "Só administrador, gestor e recepção passam a conversa para outra pessoa.",
    };
  }
  if (conversation.status === "resolvida") {
    return {
      ok: false,
      error: "Conversa resolvida não é passada adiante. Reabra antes.",
    };
  }
  if (destino === context.userId) {
    return { ok: false, error: "Para ficar com a conversa, use Assumir." };
  }
  if (destino === conversation.assignee_user_id) {
    return { ok: false, error: "A conversa já está com essa pessoa." };
  }

  // O destino e conferido com a SESSAO (a policy de clinic_member deixa o
  // membro ativo ver o time): membro ativo desta clinica, com papel que
  // responde paciente.
  const { data: membro } = await supabase
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .eq("user_id", destino)
    .eq("status", "ativo")
    .in("role", [...PAPEIS_QUE_RECEBEM])
    .maybeSingle();
  if (!membro) {
    return {
      ok: false,
      error:
        "Essa pessoa não está ativa na clínica ou não atende conversas. Atualize a página e escolha de novo.",
    };
  }
  const { data: perfil } = await supabase
    .from("profile")
    .select("name")
    .eq("user_id", destino)
    .maybeSingle();
  const nomeDoDestino =
    (perfil as { name: string | null } | null)?.name?.trim() || "um colega";

  const base = supabase
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: destino })
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
      error:
        "A conversa mudou enquanto você escolhia. Confira quem está com ela e tente de novo.",
    };
  }

  await addSystemEvent(
    supabase,
    clinicId,
    conversation.id,
    `${context.userName} passou a conversa para ${nomeDoDestino}`,
  );
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: context.userId,
    action: "transferiu_conversa",
    entity: "conversation",
    entity_id: conversation.id,
  });
  return { ok: true };
}

export async function resolverConversaAction(
  conversationId: string,
): Promise<InboxActionResult> {
  const loaded = await loadVisibleConversation(conversationId, {
    exigeEdicao: true,
  });
  if ("error" in loaded) {
    return recusaDaCarga(loaded);
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
    return recusaDaCarga(loaded);
  }
  const { context, supabase, conversation } = loaded;
  const { data: updated, error: erroAoReabrir } = await supabase
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: context.userId })
    .eq("id", conversation.id)
    .eq("status", "resolvida")
    .select("id");
  if (erroAoReabrir?.code === "23505") {
    // O indice unico de conversa aberta por contato recusou: o paciente
    // voltou a escrever depois de resolvida e ja tem OUTRA conversa aberta.
    // Antes a tela dizia "A conversa já foi reaberta", que era falso. Agora
    // devolve qual e a conversa aberta, e a tela leva a atendente ate ela.
    //
    // POR NUMERO (docs/07, achado 7): uma conversa por numero, entao o
    // mesmo paciente pode ter uma aberta em cada numero da clinica. A que
    // barrou esta e a do MESMO numero; sem o filtro (e sem o limit), o
    // .maybeSingle() quebrava com duas abertas e a atendente ficava sem
    // destino. Conversa sem numero (clinica sem numero ativo) procura entre
    // as sem numero.
    const busca = supabase
      .from("conversation")
      .select("id")
      .eq("clinic_id", context.active!.clinicId)
      .eq("contact_id", conversation.contact_id)
      .neq("status", "resolvida");
    const { data: aberta } = await (
      conversation.whatsapp_account_id
        ? busca.eq("whatsapp_account_id", conversation.whatsapp_account_id)
        : busca.is("whatsapp_account_id", null)
    )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return {
      ok: false,
      error: "Este paciente já tem uma conversa aberta.",
      conversaAbertaId: (aberta as { id: string } | null)?.id,
    };
  }
  if (erroAoReabrir) {
    return { ok: false, error: "Não foi possível reabrir. Tente de novo." };
  }
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
