import type { SupabaseClient } from "@supabase/supabase-js";

import {
  compararPorProximaAcao,
  consentimentoVigenteDeLinhas,
  idDeAnuncioValido,
  LEITURA_SEM_ANUNCIO,
  type AnuncioDaMeta,
  type LeituraDoAnuncio,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";
import {
  fetchAtividadesDoContato,
  type AtividadesDoContato,
} from "@/lib/queries/atividades";

// Tipos e fetchers da Tela 4 (Leads). Os da LISTA sao isomorficos como
// catalogo.ts: recebem o SupabaseClient e rodam no servidor (carga inicial) e
// no browser (TanStack). Decisao central, igual a da Agenda: UMA query da
// clinica, filtros aplicados no cliente e uma chave so para o tempo real
// mesclar. Sem filtro de kind: o funil existe em todo contato (paciente que
// agendou continua no Kanban em "agendou" e "compareceu"). A RLS garante
// isolamento e papel; a leitura humana da tela passa por
// auditarLeituraDePaciente na page.
//
// fetchLeadDetalhe e a excecao: le conversa e atividades de paciente e por
// isso roda SO no servidor, atras da abrirDetalheDoContatoAction, que grava
// quem leu a ficha de quem antes de devolver o dado.

export type LeadResumo = {
  id: string;
  name: string | null;
  phone_e164: string;
  funnel_stage: string;
  lost_reason: string | null;
  lost_reason_note: string | null;
  owner_user_id: string | null;
  tags: string[];
  source_channel: string | null;
  source_campaign: string | null;
  /** Origem livre ("Meta" no lead de anuncio). */
  source_origin: string | null;
  /** Plataforma do anuncio ("Facebook", "Instagram") ou meio do link. */
  source_medium: string | null;
  /** Metodo de captura (METODO_LABELS em lib/domain/leads-ui.ts). */
  source_method: string | null;
  /** Id do anuncio da Meta gravado pela ingestao; chave de meta_anuncio. */
  source_ad_id: string | null;
  /**
   * Id da campanha do Google Ads do clique rastreado pelo site (metodo
   * clique_site, migration 20261005100000): "Campanha do Google {id}".
   * Obrigatorio de proposito: consulta que esquecer a coluna nao compila.
   */
  source_google_campaign_id: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  insurance: { id: string; name: string } | null;
  consent_ativo: boolean;
  /**
   * Campanha e conjunto da Meta pelo source_ad_id (meta_anuncio, lida pela
   * sessao com a RLS de membro ativo). Erro na leitura nao derruba a lista:
   * so a coluna Campanha diz que nao carregou.
   */
  anuncio_meta: LeituraDoAnuncio;
};

export type MensagemDoLead = {
  id: string;
  direction: "entrada" | "saida";
  author: "paciente" | "ia" | "usuario" | "sistema";
  content_type: string;
  body: string | null;
  created_at: string;
};

export type LeadDetalhe = {
  /** Conversa nao resolvida mais recente; null sem conversa aberta. */
  conversation_id: string | null;
  /** Ultimas 3 mensagens da conversa aberta, em ordem cronologica. */
  mensagens: MensagemDoLead[];
  /** Nome amigavel da campanha em campaign_link; null sem campanha casada. */
  campanha_nome: string | null;
  /**
   * Campanha e conjunto da Meta lidos AGORA (a lista pode estar velha: o
   * resolvedor de anuncios grava meta_anuncio sem tempo real).
   */
  anuncio_meta: LeituraDoAnuncio;
  /**
   * Atividades do contato (pendentes e ultimas concluidas), lidas na MESMA
   * action que grava a trilha da ficha. null quando a leitura delas falhou:
   * a secao mostra o erro sem derrubar o resto do drawer.
   */
  atividades: AtividadesDoContato | null;
};

export const leadsKeys = {
  lista: (clinicId: string) => ["leads", clinicId, "lista"] as const,
  /** Quantos contatos a clinica tem no total (para o aviso de corte). */
  total: (clinicId: string) => ["leads", clinicId, "total"] as const,
  /** Etapas com regua de follow-up ligada (aviso do Mudar etapa). */
  reguas: (clinicId: string) => ["leads", clinicId, "reguas"] as const,
  detalhe: (contactId: string) => ["leads", "detalhe", contactId] as const,
  /** Prefixo de todos os detalhes (as atividades vem dentro deles). */
  detalhes: ["leads", "detalhe"] as const,
  /** Nomes dos membros (fetchClinicAuthorNames) para avatar de responsavel. */
  autores: (clinicId: string) => ["leads", clinicId, "autores"] as const,
};

/** Chave do anuncio da Meta de UM contato (painel do Atendimento). */
export const anuncioDaMetaKeys = {
  doAnuncio: (clinicId: string, adId: string) =>
    ["anuncio-meta", clinicId, adId] as const,
};

// So o que as telas mostram. Ate a migration 20261004100000 ser aplicada,
// adset_name nao existe e a leitura falha: quem chama trata como erro da
// linha Campanha, nunca da tela inteira.
const ANUNCIO_SELECT =
  "ad_id, campaign_id, campaign_name, adset_id, adset_name";

// Lote de ids por consulta: 100 ids de ate 32 digitos cabem com folga na URL
// do PostgREST.
const ANUNCIOS_POR_CONSULTA = 100;

function normalizarAnuncio(row: Record<string, unknown>): AnuncioDaMeta {
  return {
    ad_id: row.ad_id as string,
    campaign_id: row.campaign_id as string,
    campaign_name: (row.campaign_name as string | null) ?? null,
    adset_id: (row.adset_id as string | null) ?? null,
    adset_name: (row.adset_name as string | null) ?? null,
  };
}

/**
 * As linhas de meta_anuncio dos anuncios pedidos, da clinica pedida (o
 * filtro de clinica importa: o mesmo anuncio pode estar no mapa de duas
 * clinicas, e a RLS deixa ler todas as clinicas ativas da pessoa). Id fora
 * do formato do mapa nunca casa e nem vai na consulta. LANCA em erro.
 */
export async function fetchAnunciosDaMeta(
  supabase: SupabaseClient,
  clinicId: string,
  adIds: readonly (string | null | undefined)[],
): Promise<Map<string, AnuncioDaMeta>> {
  const validos = [
    ...new Set(
      adIds
        .map((adId) => idDeAnuncioValido(adId))
        .filter((adId): adId is string => adId !== null),
    ),
  ];
  const mapa = new Map<string, AnuncioDaMeta>();
  for (let i = 0; i < validos.length; i += ANUNCIOS_POR_CONSULTA) {
    const lote = validos.slice(i, i + ANUNCIOS_POR_CONSULTA);
    const { data, error } = await supabase
      .from("meta_anuncio")
      .select(ANUNCIO_SELECT)
      .eq("clinic_id", clinicId)
      .in("ad_id", lote);
    if (error) {
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const anuncio = normalizarAnuncio(row);
      mapa.set(anuncio.ad_id, anuncio);
    }
  }
  return mapa;
}

/**
 * A leitura do anuncio de UM contato, que nunca lanca: sem id valido e
 * "lida" sem anuncio; falha da consulta e "erro" (a tela mostra so na linha
 * Campanha).
 */
export async function lerAnuncioDaMeta(
  supabase: SupabaseClient,
  clinicId: string,
  adId: string | null | undefined,
): Promise<LeituraDoAnuncio> {
  const valido = idDeAnuncioValido(adId);
  if (!valido) {
    return LEITURA_SEM_ANUNCIO;
  }
  try {
    const mapa = await fetchAnunciosDaMeta(supabase, clinicId, [valido]);
    return { estado: "lida", anuncio: mapa.get(valido) ?? null };
  } catch {
    return { estado: "erro" };
  }
}

/**
 * Preenche anuncio_meta dos leads com UMA leitura de meta_anuncio por lote
 * de ids. Falha da leitura vira "erro" so nos leads que tem anuncio.
 */
async function anexarAnunciosDaMeta(
  supabase: SupabaseClient,
  clinicId: string,
  leads: LeadResumo[],
): Promise<LeadResumo[]> {
  const comAnuncio = leads.filter(
    (lead) => idDeAnuncioValido(lead.source_ad_id) !== null,
  );
  if (comAnuncio.length === 0) {
    return leads;
  }
  let mapa: Map<string, AnuncioDaMeta> | null = null;
  try {
    mapa = await fetchAnunciosDaMeta(
      supabase,
      clinicId,
      comAnuncio.map((lead) => lead.source_ad_id),
    );
  } catch {
    mapa = null;
  }
  return leads.map((lead) => {
    const adId = idDeAnuncioValido(lead.source_ad_id);
    if (!adId) {
      return lead;
    }
    const leitura: LeituraDoAnuncio = mapa
      ? { estado: "lida", anuncio: mapa.get(adId) ?? null }
      : { estado: "erro" };
    return { ...lead, anuncio_meta: leitura };
  });
}

// source_google_campaign_id so existe depois da migration 20261005100000:
// ela e aplicada ANTES de publicar este codigo, senao a lista inteira falha.
const LEAD_SELECT =
  "id, name, phone_e164, funnel_stage, lost_reason, lost_reason_note, owner_user_id, tags, source_channel, source_campaign, source_origin, source_medium, source_method, source_ad_id, source_google_campaign_id, first_contact_at, last_contact_at, insurance:insurance_id (id, name), contact_consent (channel, granted_at, revoked_at)";

// Sem tipos gerados, o supabase-js devolve embed como array: normaliza no
// padrao de normalizarConsulta (lib/queries/agenda.ts) e ja deriva
// consent_ativo pela regra da linha mais recente, descartando as linhas.
function normalizarLead(row: Record<string, unknown>): LeadResumo {
  const insuranceBruto = Array.isArray(row.insurance)
    ? row.insurance[0]
    : row.insurance;
  // Embed um-para-muitos vem sempre como array do PostgREST.
  const consentBruto = row.contact_consent;
  const linhas = (
    Array.isArray(consentBruto) ? consentBruto : []
  ) as LinhaConsent[];
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    phone_e164: row.phone_e164 as string,
    funnel_stage: row.funnel_stage as string,
    lost_reason: (row.lost_reason as string | null) ?? null,
    lost_reason_note: (row.lost_reason_note as string | null) ?? null,
    owner_user_id: (row.owner_user_id as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    source_channel: (row.source_channel as string | null) ?? null,
    source_campaign: (row.source_campaign as string | null) ?? null,
    source_origin: (row.source_origin as string | null) ?? null,
    source_medium: (row.source_medium as string | null) ?? null,
    source_method: (row.source_method as string | null) ?? null,
    source_ad_id: (row.source_ad_id as string | null) ?? null,
    source_google_campaign_id:
      (row.source_google_campaign_id as string | null) ?? null,
    first_contact_at: row.first_contact_at as string,
    last_contact_at: (row.last_contact_at as string | null) ?? null,
    insurance: (insuranceBruto ?? null) as LeadResumo["insurance"],
    consent_ativo: consentimentoVigenteDeLinhas(linhas),
    // anexarAnunciosDaMeta troca nos leads que tem anuncio.
    anuncio_meta: LEITURA_SEM_ANUNCIO,
  };
}

// Teto de seguranca, mesmo padrao do Inbox (CONVERSATIONS_ATIVAS_LIMIT): sem
// limite, uma clinica grande serializava TODOS os contatos com embeds no
// payload de cada navegacao para /leads.
//
// O corte fica com os MAIS RECENTES (achado 93 da revisao): last_contact_at e
// a ultima mensagem RECEBIDA do paciente, entao quem escreveu hoje e o lead
// mais quente e nao pode ser o primeiro a sumir. Contato que nunca escreveu
// (importado, criado a mao, cadastro rapido da Agenda) vem depois, pelo
// primeiro contato mais recente; o id desempata para o corte ser estavel. A
// ordem de EXIBICAO continua sendo a de proxima acao, aplicada depois do
// corte. A tela conta o total (fetchTotalDeLeads) e avisa quando corta.
export const LEADS_LIMIT = 1000;

/**
 * Os contatos da clinica com os embeds (os LEADS_LIMIT mais recentes), ja
 * ordenados por proxima acao (nunca contatado primeiro, depois o contato mais
 * antigo).
 */
export async function fetchLeads(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<LeadResumo[]> {
  const { data, error } = await supabase
    .from("contact")
    .select(LEAD_SELECT)
    .eq("clinic_id", clinicId)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .order("first_contact_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(LEADS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  const leads = ((data ?? []) as Record<string, unknown>[]).map(normalizarLead);
  return (await anexarAnunciosDaMeta(supabase, clinicId, leads)).sort(
    compararPorProximaAcao,
  );
}

/**
 * Quantos contatos a clinica tem, sem trazer linha nenhuma (count head). A
 * tela compara com o que carregou para dizer quando o teto cortou a lista.
 */
export async function fetchTotalDeLeads(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("contact")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

/** Regua de follow-up LIGADA de uma etapa da jornada. */
export type ReguaDaEtapa = {
  /** Chave da etapa (cadence.trigger_stage) */
  etapa: string;
  /** Nome da regua, como aparece em Automacoes */
  nome: string;
};

/**
 * As etapas que tem regua de follow-up ligada e com pelo menos um passo, ou
 * seja, as que mandam mensagem sozinhas quando um lead entra nelas (achado 98
 * da revisao). O indice cadence_followup_unico_por_etapa garante uma regua
 * por etapa. A leitura de cadence e de qualquer membro ativo (RLS).
 */
export async function fetchReguasDeFollowup(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ReguaDaEtapa[]> {
  const { data, error } = await supabase
    .from("cadence")
    .select("trigger_stage, name, cadence_step (id)")
    .eq("clinic_id", clinicId)
    .eq("kind", "followup")
    .eq("active", true);
  if (error) {
    throw new Error(error.message);
  }
  return (
    (data ?? []) as {
      trigger_stage: string | null;
      name: string;
      cadence_step: { id: string }[] | null;
    }[]
  )
    .filter(
      (regua) =>
        regua.trigger_stage !== null && (regua.cadence_step ?? []).length > 0,
    )
    .map((regua) => ({
      etapa: regua.trigger_stage as string,
      nome: regua.name,
    }));
}

/**
 * Busca um contato so, com os embeds e o anuncio da Meta (usada pelo tempo
 * real em INSERT e quando o anuncio do contato muda).
 */
export async function fetchLead(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<LeadResumo | null> {
  const { data, error } = await supabase
    .from("contact")
    .select(LEAD_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const [lead] = await anexarAnunciosDaMeta(supabase, clinicId, [
    normalizarLead(data as Record<string, unknown>),
  ]);
  return lead ?? null;
}

// So o que a tela desenha: o drawer ja recebe o resumo do lead por prop e o
// resto do cadastro (cpf, e-mail, nascimento, carteirinha) nao aparece em
// lugar nenhum. Dado sensivel que ninguem renderiza nao viaja para o
// navegador.
const DETALHE_SELECT = "id, source_campaign, source_ad_id";

/**
 * Detalhe do drawer da Tela 4: ultimas 3 mensagens da conversa NAO resolvida
 * (o texto aparece mesmo, a tela e autorizada) e o nome amigavel da campanha
 * de origem. Roda SO no servidor, chamada pela abrirDetalheDoContatoAction,
 * que grava a trilha de leitura antes de o dado sair.
 */
export async function fetchLeadDetalhe(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<LeadDetalhe | null> {
  const { data, error } = await supabase
    .from("contact")
    .select(DETALHE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  const row = data as Record<string, unknown>;
  const sourceCampaign = (row.source_campaign as string | null) ?? null;
  const sourceAdId = (row.source_ad_id as string | null) ?? null;

  const [conversa, campanha, atividades, anuncioMeta] = await Promise.all([
    // VARIOS NUMEROS (docs/07): o lead pode ter uma conversa aberta em cada
    // numero da clinica. O drawer mostra e liga a mais recente em QUALQUER
    // numero (o limit(1) nunca quebra com duas); empate de atividade vai para
    // a mais nova.
    supabase
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .neq("status", "resolvida")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sourceCampaign
      ? supabase
          .from("campaign_link")
          .select("name")
          .eq("clinic_id", clinicId)
          .eq("campaign", sourceCampaign)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Falha so das atividades nao derruba a conversa do drawer.
    fetchAtividadesDoContato(supabase, clinicId, contactId).catch(() => null),
    // Nem a do anuncio: lerAnuncioDaMeta nunca lanca.
    lerAnuncioDaMeta(supabase, clinicId, sourceAdId),
  ]);
  if (conversa.error) {
    throw new Error(conversa.error.message);
  }

  const conversationId = (conversa.data?.id as string | undefined) ?? null;
  let mensagens: MensagemDoLead[] = [];
  if (conversationId) {
    const { data: msgs, error: erroMsgs } = await supabase
      .from("message")
      .select("id, direction, author, content_type, body, created_at")
      .eq("conversation_id", conversationId)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(3);
    if (erroMsgs) {
      throw new Error(erroMsgs.message);
    }
    mensagens = ((msgs ?? []) as MensagemDoLead[]).reverse();
  }

  return {
    conversation_id: conversationId,
    mensagens,
    campanha_nome: (campanha.data as { name: string } | null)?.name ?? null,
    anuncio_meta: anuncioMeta,
    atividades,
  };
}
