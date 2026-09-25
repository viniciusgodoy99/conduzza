import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConversationStatus } from "@/lib/design/status";

// Tipos e fetchers do Inbox. Sem tipos gerados do banco (pendencia
// registrada), as formas sao declaradas aqui e os selects fazem cast; a RLS
// do banco e quem garante o isolamento das leituras do browser.

export type ContactSummary = {
  id: string;
  name: string | null;
  phone_e164: string;
  kind: "lead" | "paciente";
  funnel_stage: string;
  source_channel: string | null;
  source_campaign: string | null;
  first_contact_at: string | null;
};

/** Tipo da ultima mensagem visivel ao paciente (coluna last_preview_kind). */
export type TipoDaPrevia =
  "texto" | "template" | "imagem" | "video" | "audio" | "documento" | "apagada";

export type ConversationListItem = {
  id: string;
  status: ConversationStatus;
  assignee_user_id: string | null;
  unread_count: number;
  awaiting_reply: boolean;
  /** ultima atividade, inclui envio da clinica; alimenta Leads e Pacientes */
  last_message_at: string | null;
  /** quando o PACIENTE falou por ultimo; e a chave de ordenacao do Inbox */
  last_inbound_at: string | null;
  /**
   * Trecho (ate 120 caracteres) da ultima mensagem que o paciente ve, mantido
   * por gatilho no banco (migration 20260925100000). Nota interna e evento
   * nunca entram; apagada vem nula com o tipo 'apagada'. E DADO DE PACIENTE:
   * so para a tela, nunca para log.
   */
  last_preview: string | null;
  last_preview_kind: TipoDaPrevia | null;
  /**
   * Quem escreveu a mensagem da previa (migration 20260925120000), mantido
   * pelo mesmo gatilho. O cartao marca a saida ("Voce:", "Clinica:", "IA:")
   * para a resposta da clinica nao ser lida como fala do paciente.
   */
  last_preview_author: AutorDaPrevia | null;
  /** A pessoa da equipe, quando o autor e 'usuario' ("Voce:" ou "Clinica:"). */
  last_preview_author_user_id: string | null;
  tags: string[];
  /**
   * O numero da clinica desta conversa (whatsapp_account.id): uma conversa
   * por numero, e ela responde por ele (docs/07, decisao 1). Nulo so em
   * clinica sem numero ativo. Opcional so para os testes que montam a
   * conversa na mao; o select traz sempre.
   */
  whatsapp_account_id?: string | null;
  contact: ContactSummary;
};

/** Os mesmos valores de message.author. */
export type AutorDaPrevia = "paciente" | "usuario" | "ia" | "sistema";

/** O pouco que a previa da citacao precisa mostrar dentro da bolha. */
export type QuotedMessage = {
  id: string;
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type: string;
  body: string | null;
  is_internal_note: boolean;
  deleted_at: string | null;
};

export type MessageItem = {
  id: string;
  /**
   * A conversa da mensagem. O fio carrega tambem as conversas ANTERIORES do
   * mesmo contato (historico), e e por este campo que ele desenha a divisa
   * "Conversa resolvida em" e recusa citar mensagem de outra conversa.
   * Opcional so para os testes que montam mensagem na mao; o select traz
   * sempre.
   */
  conversation_id?: string;
  direction: "entrada" | "saida";
  author: "paciente" | "ia" | "usuario" | "sistema";
  author_user_id: string | null;
  content_type:
    "texto" | "imagem" | "audio" | "documento" | "template" | "evento";
  body: string | null;
  /**
   * storage://, URL do provedor (ainda baixando), seed:// (demonstracao) ou
   * indisponivel://<motivo> (o download desistiu de vez). Ver
   * lib/domain/midia-recebida.ts.
   */
  media_url: string | null;
  /** nome original do arquivo, como veio do WhatsApp; body e a LEGENDA */
  media_filename?: string | null;
  /** tipo real do arquivo; escolhe foto ou video e a extensao do download */
  media_mimetype?: string | null;
  transcript: string | null;
  is_internal_note: boolean;
  delivery_status: string | null;
  error_code: string | null;
  created_at: string;
  /** quando apagada, o corpo acima ja vem nulo: o conteudo foi para o cofre */
  deleted_at: string | null;
  deleted_by: string | null;
  /** quem apagou: a clinica ou o proprio paciente, do aparelho dele */
  deleted_source: "clinica" | "paciente" | null;
  /** todos: revogada no WhatsApp do paciente. local: some so daqui. */
  deleted_escopo: "todos" | "local" | null;
  reply_to_message_id: string | null;
  reply_to_wa_message_id: string | null;
  /**
   * A citada, embutida na mesma consulta.
   *
   * Vem nula em dois casos diferentes que a tela distingue: a citada nunca foi
   * linha nossa (reply_to_wa_message_id preenchido, este nulo) ou ela foi
   * apagada depois (o ON DELETE SET NULL zera o vinculo).
   */
  reply_to: QuotedMessage | null;
};

export type ComplianceDecision = {
  id: string;
  message_id: string | null;
  compliance_rule: string | null;
  escalation_reason: string | null;
  blocked_draft: string | null;
  created_at: string;
};

/**
 * A linha de autorizacao de WhatsApp que VIGORA, revogada ou nao. Null quando
 * o contato nunca teve autorizacao registrada. O painel precisa separar os
 * tres casos: autorizado, "pediu para nao receber" e "nunca autorizou".
 */
export type ConsentInfo = {
  source: string;
  granted_at: string;
  revoked_at: string | null;
} | null;

/** O estado de autorizacao que a tela mostra (CONSENT_STATUS). */
export function estadoDoConsentimento(
  consent: ConsentInfo,
): "autorizado" | "revogado" | "sem_autorizacao" {
  if (!consent) {
    return "sem_autorizacao";
  }
  return consent.revoked_at ? "revogado" : "autorizado";
}

const CONVERSATION_SELECT =
  "id, status, assignee_user_id, unread_count, awaiting_reply, last_message_at, last_inbound_at, last_preview, last_preview_kind, last_preview_author, last_preview_author_user_id, tags, whatsapp_account_id, contact:contact_id (id, name, phone_e164, kind, funnel_stage, source_channel, source_campaign, first_contact_at)";

export const conversationKeys = {
  list: (clinicId: string) => ["conversations", clinicId] as const,
  /**
   * Total de resolvidas (um numero). FORA da chave-mae da lista de proposito:
   * as gravacoes por chave-mae (setQueriesData de lida e etiqueta) tratam
   * tudo ali como lista de conversas. Quem invalida a lista invalida este
   * tambem (tempo real e acoes da conversa).
   */
  totalResolvidas: (clinicId: string) =>
    ["conversations-resolvidas-total", clinicId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  decisions: (conversationId: string) => ["decisions", conversationId] as const,
  consent: (contactId: string) => ["consent", contactId] as const,
};

function normalizeConversation(
  row: Record<string, unknown>,
): ConversationListItem {
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return { ...row, contact } as ConversationListItem;
}

// Teto da lista ativa. O Inbox mostra conversas em andamento; resolvida e
// arquivo, carregado sob demanda (fetchResolvedConversations). Sem esse teto,
// uma clinica movimentada traria milhares de linhas em toda carga da tela.
export const CONVERSATIONS_ATIVAS_LIMIT = 300;

// Lista ativa: tudo que NAO esta resolvida. Ordenada e limitada, batendo com
// o indice conversation(clinic_id, status, last_message_at desc).
//
// A ordem do SERVIDOR continua sendo por recencia: e ela que decide QUAIS 300
// conversas chegam ao browser, e trocar o criterio faria uma clinica com
// centenas de leads antigos por ler empurrar para fora do lote as conversas
// que a equipe esta trabalhando hoje. Quem espera resposta vem primeiro DENTRO
// do lote, no cliente.
export async function fetchConversations(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .neq("status", "resolvida")
    // Ordem de RECEBIMENTO, nao de atividade: last_message_at sobe tambem
    // quando a clinica responde (send.ts:457-466), o que jogava a conversa
    // respondida para o topo e embaralhava a coluna de horarios.
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(CONVERSATIONS_ATIVAS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

// Teto do arquivo de resolvidas carregado de uma vez. A lista precisa dele
// para nao mostrar o teto como se fosse o total, e para avisar que a busca
// nas resolvidas para nele (achado L3 da revisao da leva 2).
export const RESOLVIDAS_LIMIT = 100;

// Conversas resolvidas, sob demanda (quando o usuario abre o filtro).
export async function fetchResolvedConversations(
  supabase: SupabaseClient,
  clinicId: string,
  limit = RESOLVIDAS_LIMIT,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("status", "resolvida")
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeConversation);
}

// Uma conversa pelo id, para o link /atendimento?conversa=<id> (Confirmacoes,
// ficha do paciente, drawer do lead). Vem com a SESSAO de quem abre: a RLS
// decide se ela existe para esta pessoa (outra clinica, ou o profissional
// fora da propria conversa, volta nulo). Serve tambem para a conversa que
// ficou fora das 300 ativas carregadas e para a resolvida.
export async function fetchConversationById(
  supabase: SupabaseClient,
  clinicId: string,
  conversationId: string,
): Promise<ConversationListItem | null> {
  const { data, error } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? normalizeConversation(data as Record<string, unknown>) : null;
}

/**
 * Um numero de WhatsApp ATIVO da clinica, como o Inbox e Configuracoes vao
 * mostrar (selo, cabecalho, filtro e cartoes da Fase 4, docs/07).
 */
export type NumeroDaClinica = {
  id: string;
  /** nome livre dado pela equipe ("Recepção", "Unidade Centro") */
  nome: string;
  /** o telefone pareado, quando ja conectou alguma vez */
  display_phone: string | null;
  connection_status: string;
  principal: boolean;
  /** ultima vez que conectou; nulo = nunca foi pareado */
  connected_at: string | null;
};

// Os numeros ATIVOS da clinica (removido_em nulo), o principal primeiro e os
// outros na ordem de cadastro. Pela sessao: todo membro ativo le
// whatsapp_account (RLS), e o segredo da instancia nunca passa por aqui.
// Numero removido fica de fora: o historico das conversas dele continua, mas
// ele nao e mais opcao de nada.
export async function fetchNumerosDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<NumeroDaClinica[]> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select(
      "id, nome, display_phone, connection_status, principal, connected_at",
    )
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as NumeroDaClinica[];
}

// So se EXISTE alguma resolvida (head, sem trazer linha): decide entre
// "Nenhuma conversa ainda" e "Nenhuma conversa em andamento" com atalho para
// o arquivo, quando nao ha conversa ativa.
export async function existeConversaResolvida(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<boolean> {
  return (await contarConversasResolvidas(supabase, clinicId)) > 0;
}

// Total de resolvidas que ESTA pessoa ve (head, sem trazer linha): e o numero
// do chip "Resolvida" quando o arquivo passa do teto carregado. Pela sessao,
// entao a RLS recorta (o profissional conta so as dele).
export async function contarConversasResolvidas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("conversation")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("status", "resolvida");
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

const MESSAGE_SELECT =
  "id, conversation_id, direction, author, author_user_id, content_type, body, media_url, media_filename, media_mimetype, transcript, is_internal_note, delivery_status, error_code, created_at, deleted_at, deleted_by, deleted_source, deleted_escopo, reply_to_message_id, reply_to_wa_message_id, " +
  // Auto-juncao: a citada e outra linha da MESMA tabela. O apelido aponta para
  // a COLUNA, nao para o nome da chave estrangeira: numa relacao de uma tabela
  // com ela mesma, o nome da chave nao diz qual ponta seguir, e o PostgREST
  // devolve a lista das mensagens que citam esta, que e o contrario do que a
  // bolha precisa. Conferido contra o banco em 02/09/2026.
  "reply_to:reply_to_message_id(id, author, author_user_id, content_type, body, is_internal_note, deleted_at)";

export const MESSAGES_PAGE_SIZE = 50;

export type MessagePage = {
  items: MessageItem[];
  /** created_at da mensagem mais antiga desta pagina; null quando acabou */
  nextCursor: string | null;
};

// Pagina de mensagens, do MAIS NOVO para tras. Sem cursor, traz as ultimas 50
// (o que corrige o bug silencioso: antes trazia as 200 MAIS ANTIGAS e a
// conversa parava de mostrar mensagem nova depois disso). O historico e
// carregado sob demanda com o cursor. Ordena desc no banco (usa o indice
// message(conversation_id, created_at desc)) e inverte para exibir asc.
//
// HISTORICO DO CONTATO (achado 10 da revisao). Resolver uma conversa e o
// paciente voltar a escrever abre uma conversa NOVA (o indice unico so vale
// para as nao resolvidas), e o fio comecava vazio: a atendente nao via o que
// tinha sido combinado antes. Com o contactId, a pagina junta a conversa
// aberta e as RESOLVIDAS do mesmo contato, na mesma ordem de tempo; a tela
// desenha a divisa entre elas. A conversa aberta de outro ciclo nunca entra
// (so as resolvidas e a propria). Tudo pela sessao: o profissional so ve as
// conversas atribuidas a ele, e a RLS de message repete o recorte.
async function conversasDoHistorico(
  supabase: SupabaseClient,
  conversationId: string,
  contactId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("conversation")
    .select("id")
    .eq("contact_id", contactId)
    .or(`status.eq.resolvida,id.eq.${conversationId}`)
    // Teto de ciclos: o fio pagina por tempo, e um contato de anos nao pode
    // virar um filtro sem fim. A propria conversa entra sempre (abaixo).
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(error.message);
  }
  const ids = ((data ?? []) as { id: string }[]).map((linha) => linha.id);
  return ids.includes(conversationId) ? ids : [...ids, conversationId];
}

export async function fetchMessagesPage(
  supabase: SupabaseClient,
  conversationId: string,
  cursor?: string,
  contactId?: string,
): Promise<MessagePage> {
  const conversas = contactId
    ? await conversasDoHistorico(supabase, conversationId, contactId)
    : [conversationId];
  let query = supabase
    .from("message")
    .select(MESSAGE_SELECT)
    .in("conversation_id", conversas)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (cursor) {
    query = query.lt("created_at", cursor);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(
    (linha) => ({
      ...linha,
      // O PostgREST devolve a juncao como lista quando nao consegue provar que
      // e um para um; a tela quer um objeto ou nada.
      reply_to: Array.isArray(linha.reply_to)
        ? ((linha.reply_to[0] as QuotedMessage) ?? null)
        : ((linha.reply_to as QuotedMessage | null) ?? null),
    }),
  ) as MessageItem[];
  const nextCursor =
    rows.length === MESSAGES_PAGE_SIZE
      ? (rows[rows.length - 1]?.created_at ?? null)
      : null;
  return { items: rows.reverse(), nextCursor };
}

export async function fetchComplianceDecisions(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ComplianceDecision[]> {
  const { data, error } = await supabase
    .from("ai_decision_log")
    .select(
      "id, message_id, compliance_rule, escalation_reason, blocked_draft, created_at",
    )
    .eq("conversation_id", conversationId)
    .eq("compliance_blocked", true);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ComplianceDecision[];
}

// A linha MAIS RECENTE do canal, revogada ou nao: a mesma regra da RPC
// consentimento_vigente (e de lib/domain/leads-ui.ts). Filtrar por ativa
// escondia a revogacao, e o painel dizia "a clinica so pode responder quando
// o contato escrever primeiro" para quem PEDIU para nao receber mensagens.
export async function fetchConsent(
  supabase: SupabaseClient,
  contactId: string,
): Promise<ConsentInfo> {
  const { data, error } = await supabase
    .from("contact_consent")
    .select("source, granted_at, revoked_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("granted_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ConsentInfo) ?? null;
}
