import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeituraDosDetalhes } from "@/lib/domain/anuncio-do-whatsapp";
import {
  ORIGEM_SEM_ATRIBUICAO,
  type AnuncioDoMapa,
  type MapaDeAtribuicaoLido,
  type TituloDoMapa,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { ModoDoFiltro } from "@/lib/domain/etiquetas-do-lead";
import {
  compararPorProximaAcao,
  consentimentoVigenteDeLinhas,
  idDeAnuncioValido,
  LEITURA_SEM_ANUNCIO,
  type AnuncioDaMeta,
  type FiltrosDeLeads,
  type LeituraDoAnuncio,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";
import { compararPrecedencia } from "@/lib/domain/reguas-de-followup";
import { lerDetalhesDoAnuncio } from "@/lib/queries/anuncio-do-whatsapp";
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
  /**
   * Lead ou paciente (contact.kind). A lista traz os dois (o funil existe em
   * todo contato); a gaveta e as acoes em massa usam para o "Marcar como
   * paciente" (pedido do dono em 20/10/2026). Toda leitura daqui traz
   * (LEAD_SELECT); opcional no tipo so para o lead montado a mao continuar
   * valendo, e ausente vale lead.
   */
  kind?: "lead" | "paciente";
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
  /**
   * Id da campanha, id do conjunto e o clique do anuncio da Meta, gravados
   * pela ingestao: com eles a lista separa campanha e anuncio como
   * Resultados conta (lib/domain/campanha-e-anuncio-do-lead.ts). Toda
   * leitura daqui traz (LEAD_SELECT); opcionais no tipo so para o lead
   * montado a mao continuar valendo (ausente vale nulo). Do clique so fica
   * o fato de existir, nunca o identificador.
   */
  source_campaign_id?: string | null;
  source_adset_id?: string | null;
  com_ctwa_clid?: boolean;
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
  /**
   * Enviada direto pelo WhatsApp da clinica, fora do sistema (o mesmo campo
   * de MessageItem): a gaveta diz "Pelo WhatsApp", e nao "Equipe" ou
   * "Sistema". Opcional so para quem monta a mensagem na mao.
   */
  pelo_celular?: boolean;
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
   * Detalhes do anuncio (titulo, descricao e link de anuncio_do_whatsapp,
   * pedido do dono em 20/10/2026), lidos agora pela sessao. Nunca derruba o
   * detalhe: falha e "erro" so no bloco "Detalhes do anúncio".
   */
  anuncio_whatsapp: LeituraDosDetalhes;
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
  /**
   * Mapa da clinica (meta_anuncio e anuncio_do_whatsapp) para separar
   * campanha e anuncio como Resultados (fetchMapaDeAtribuicao).
   */
  mapa: (clinicId: string) =>
    ["leads", clinicId, "mapa-de-atribuicao"] as const,
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
// A exportacao de leads tambem escreve o nome do anuncio na Meta (coluna
// Anuncio, quando o anuncio nao tem titulo guardado).
const ANUNCIO_COM_NOME_SELECT = `${ANUNCIO_SELECT}, ad_name`;

// Lote de ids por consulta: 100 ids de ate 32 digitos cabem com folga na URL
// do PostgREST.
const ANUNCIOS_POR_CONSULTA = 100;

function normalizarAnuncio(row: Record<string, unknown>): AnuncioDaMeta {
  const anuncio: AnuncioDaMeta = {
    ad_id: row.ad_id as string,
    campaign_id: row.campaign_id as string,
    campaign_name: (row.campaign_name as string | null) ?? null,
    adset_id: (row.adset_id as string | null) ?? null,
    adset_name: (row.adset_name as string | null) ?? null,
  };
  if ("ad_name" in row) {
    anuncio.ad_name = (row.ad_name as string | null) ?? null;
  }
  return anuncio;
}

/**
 * As linhas de meta_anuncio dos anuncios pedidos, da clinica pedida (o
 * filtro de clinica importa: o mesmo anuncio pode estar no mapa de duas
 * clinicas, e a RLS deixa ler todas as clinicas ativas da pessoa). Id fora
 * do formato do mapa nunca casa e nem vai na consulta. `comNome` traz
 * tambem o nome do anuncio (so a exportacao usa). LANCA em erro.
 */
export async function fetchAnunciosDaMeta(
  supabase: SupabaseClient,
  clinicId: string,
  adIds: readonly (string | null | undefined)[],
  opcoes: { comNome?: boolean } = {},
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
      .select(opcoes.comNome ? ANUNCIO_COM_NOME_SELECT : ANUNCIO_SELECT)
      .eq("clinic_id", clinicId)
      .in("ad_id", lote);
    if (error) {
      throw new Error(error.message);
    }
    // A coluna do nome vem por escolha: o select e variavel, e o
    // supabase-js so tipa a linha de select literal.
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
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
// A exportacao de leads le este MESMO select (o tipo do contato, kind, vem
// nele desde 20/10/2026: a lista tambem usa).
// source_campaign_id, source_adset_id e ctwa_clid (migration
// 20260908150000, aplicada) sao o que Resultados le para separar campanha e
// anuncio; o clique vira so com_ctwa_clid em normalizarLead.
export const LEAD_SELECT =
  "id, name, phone_e164, kind, funnel_stage, lost_reason, lost_reason_note, owner_user_id, tags, source_channel, source_campaign, source_origin, source_medium, source_method, source_ad_id, source_google_campaign_id, source_campaign_id, source_adset_id, ctwa_clid, first_contact_at, last_contact_at, insurance:insurance_id (id, name), contact_consent (channel, granted_at, revoked_at)";

/**
 * O tipo do contato como a tela usa: so "paciente" e paciente; qualquer
 * outro valor (inclusive ausente) e lead, o default do banco.
 */
export function tipoDoContato(valor: unknown): "lead" | "paciente" {
  return valor === "paciente" ? "paciente" : "lead";
}

/**
 * A consulta dos contatos da clinica, a base da lista (fetchLeads), do tempo
 * real (fetchLead) e da exportacao: um construtor so, para coluna e regra
 * novas valerem nas tres. `contar` pede a contagem exata junto (a
 * exportacao confere o teto na primeira pagina).
 */
export function consultaDosLeads(
  supabase: SupabaseClient,
  clinicId: string,
  opcoes: { colunas?: string; contar?: boolean } = {},
) {
  return supabase
    .from("contact")
    .select(
      opcoes.colunas ?? LEAD_SELECT,
      opcoes.contar ? { count: "exact" } : undefined,
    )
    .eq("clinic_id", clinicId);
}

/**
 * As linhas cruas de uma leitura de contatos. Com as colunas vindas de
 * variavel, o supabase-js nao monta o tipo da linha (sem tipos gerados no
 * cliente, todo leitor daqui ja trata a linha como registro solto).
 */
export function linhasDosLeads(data: unknown): Record<string, unknown>[] {
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}

/** O minimo do construtor do PostgREST que os filtros da barra usam. */
type ConsultaFiltravel<Q> = {
  eq(coluna: string, valor: string): Q;
  is(coluna: string, valor: null): Q;
  gte(coluna: string, valor: string): Q;
  lt(coluna: string, valor: string): Q;
};

/**
 * Os filtros da barra (os MESMOS de filtrarLeads, vindos da mesma
 * conversao, filtrosDeLeadsDosValores) aplicados no banco, para a
 * exportacao recortar a clinica inteira sem trazer tudo. Mesmo resultado de
 * filtrarLeads: igualdade exata em etapa, origem e responsavel (contato sem
 * canal ou sem responsavel nunca casa; "Sem atribuição" e o canal nulo), e
 * o periodo sobre first_contact_at, inclusivo nas duas pontas. O navegador
 * compara em milissegundos e o banco guarda microssegundos: o inicio vale
 * como "a partir do instante" e o fim vira "antes do milissegundo
 * seguinte", que e exatamente o que o new Date(...).getTime() da lista
 * aceita (ele corta, nao arredonda).
 *
 * Campanha e anuncio NAO vao para o banco: as chaves de Resultados (o id
 * aparado como no JavaScript, o mapa da clinica) so existem no codigo. A
 * exportacao os aplica no fim, com o proprio filtrarLeads.
 */
export function aplicarFiltrosDeLeads<Q extends ConsultaFiltravel<Q>>(
  consulta: Q,
  filtros: FiltrosDeLeads,
): Q {
  let filtrada = consulta;
  if (filtros.etapa) {
    filtrada = filtrada.eq("funnel_stage", filtros.etapa);
  }
  if (filtros.origem) {
    filtrada =
      filtros.origem === ORIGEM_SEM_ATRIBUICAO
        ? filtrada.is("source_channel", null)
        : filtrada.eq("source_channel", filtros.origem);
  }
  if (filtros.responsavel) {
    filtrada = filtrada.eq("owner_user_id", filtros.responsavel);
  }
  // Instante que nao e data nao filtra, como no filtrarLeads (NaN nunca
  // exclui ninguem la).
  const de = filtros.deISO ? new Date(filtros.deISO).getTime() : Number.NaN;
  const ate = filtros.ateISO ? new Date(filtros.ateISO).getTime() : Number.NaN;
  if (!Number.isNaN(de)) {
    filtrada = filtrada.gte("first_contact_at", new Date(de).toISOString());
  }
  if (!Number.isNaN(ate)) {
    filtrada = filtrada.lt("first_contact_at", new Date(ate + 1).toISOString());
  }
  return filtrada;
}

/** As linhas de contact_consent do embed (um-para-muitos vem como array). */
export function linhasDeConsentimentoDoLead(
  row: Record<string, unknown>,
): LinhaConsent[] {
  const consentBruto = row.contact_consent;
  return (Array.isArray(consentBruto) ? consentBruto : []) as LinhaConsent[];
}

// Sem tipos gerados, o supabase-js devolve embed como array: normaliza no
// padrao de normalizarConsulta (lib/queries/agenda.ts) e ja deriva
// consent_ativo pela regra da linha mais recente, descartando as linhas.
export function normalizarLead(row: Record<string, unknown>): LeadResumo {
  const insuranceBruto = Array.isArray(row.insurance)
    ? row.insurance[0]
    : row.insurance;
  const linhas = linhasDeConsentimentoDoLead(row);
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    phone_e164: row.phone_e164 as string,
    kind: tipoDoContato(row.kind),
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
    source_campaign_id: (row.source_campaign_id as string | null) ?? null,
    source_adset_id: (row.source_adset_id as string | null) ?? null,
    // "Nao nulo", como o SQL de Resultados (texto vazio conta).
    com_ctwa_clid: row.ctwa_clid !== null && row.ctwa_clid !== undefined,
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
  const { data, error } = await consultaDosLeads(supabase, clinicId)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .order("first_contact_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(LEADS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  const leads = linhasDosLeads(data).map(normalizarLead);
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

// ---------------------------------------------------------------------------
// Mapa da clinica para separar campanha e anuncio como Resultados (20/10/2026)
// ---------------------------------------------------------------------------

/** Linhas por pagina do mapa: o teto de linhas por resposta do PostgREST. */
const PAGINA_DO_MAPA = 1000;

const MAPA_DA_META_SELECT =
  "ad_id, campaign_id, campaign_name, ad_name, ultimo_dia_com_entrega, atualizado_em";
const MAPA_DOS_TITULOS_SELECT = "ad_id, titulo";

/**
 * Todas as linhas de uma tabela de anuncios DA CLINICA PEDIDA (a RLS deixa
 * ler todas as clinicas ativas da pessoa, e o mesmo anuncio pode estar em
 * duas), paginadas pelo ad_id, a chave da tabela dentro da clinica. A
 * contagem da primeira pagina diz quando acabou: o "Max rows" do projeto
 * pode cortar a pagina antes de 1.000, e parar na pagina curta deixaria o
 * mapa pela metade sem erro. LANCA em erro.
 */
async function lerTodasAsLinhasDaClinica(
  supabase: SupabaseClient,
  tabela: "meta_anuncio" | "anuncio_do_whatsapp",
  colunas: string,
  clinicId: string,
): Promise<Record<string, unknown>[]> {
  const linhas: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let contadas: number | null = null;
  for (let pagina = 0; ; pagina += 1) {
    let consulta = supabase
      .from(tabela)
      .select(colunas, pagina === 0 ? { count: "exact" } : undefined)
      .eq("clinic_id", clinicId);
    if (cursor !== null) {
      consulta = consulta.gt("ad_id", cursor);
    }
    const { data, error, count } = await consulta
      .order("ad_id", { ascending: true })
      .limit(PAGINA_DO_MAPA);
    if (error) {
      throw new Error(error.message);
    }
    if (pagina === 0 && typeof count === "number") {
      contadas = count;
    }
    // As colunas vem de variavel: o supabase-js so tipa select literal.
    const lote = (Array.isArray(data) ? data : []) as unknown as Record<
      string,
      unknown
    >[];
    linhas.push(...lote);
    const ultima = lote[lote.length - 1];
    // Sem contagem, so a pagina vazia prova o fim.
    if (!ultima || (contadas !== null && linhas.length >= contadas)) {
      break;
    }
    cursor = ultima.ad_id as string;
  }
  return linhas;
}

/**
 * O mapa da clinica que separa campanha e anuncio como Resultados conta
 * (lib/domain/campanha-e-anuncio-do-lead.ts): TODAS as linhas de
 * meta_anuncio (o casamento por id do anuncio e por id da campanha, e o
 * nome da campanha) e de anuncio_do_whatsapp (o titulo do anuncio, so para
 * o rotulo). Pela sessao: todo membro ativo le as duas (RLS). Isomorfica,
 * como fetchLeads. LANCA em erro: mapa pela metade separaria errado calado.
 */
export async function fetchMapaDeAtribuicao(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<MapaDeAtribuicaoLido> {
  const [daMeta, titulos] = await Promise.all([
    lerTodasAsLinhasDaClinica(
      supabase,
      "meta_anuncio",
      MAPA_DA_META_SELECT,
      clinicId,
    ),
    lerTodasAsLinhasDaClinica(
      supabase,
      "anuncio_do_whatsapp",
      MAPA_DOS_TITULOS_SELECT,
      clinicId,
    ),
  ]);
  return {
    anuncios: daMeta.map(
      (row): AnuncioDoMapa => ({
        ad_id: row.ad_id as string,
        campaign_id: row.campaign_id as string,
        campaign_name: (row.campaign_name as string | null) ?? null,
        ad_name: (row.ad_name as string | null) ?? null,
        ultimo_dia_com_entrega:
          (row.ultimo_dia_com_entrega as string | null) ?? null,
        atualizado_em: row.atualizado_em as string,
      }),
    ),
    titulos: titulos.map(
      (row): TituloDoMapa => ({
        ad_id: row.ad_id as string,
        titulo: (row.titulo as string | null) ?? null,
      }),
    ),
  };
}

/** Regua de follow-up LIGADA de uma etapa da jornada. */
export type ReguaDaEtapa = {
  /** Chave da etapa (cadence.trigger_stage) */
  etapa: string;
  /** Nome da regua, como aparece em Automacoes */
  nome: string;
  /**
   * Os nomes das etiquetas do filtro (onda 4, reguas por etiqueta). Vazio
   * ou ausente: a regua geral da etapa (a de antes da onda 4 tambem).
   */
  etiquetas?: string[];
  etiquetas_modo?: ModoDoFiltro;
};

type LinhaDaReguaDaEtapa = {
  id: string;
  trigger_stage: string | null;
  name: string;
  created_at: string | null;
  etiquetas?: unknown;
  etiquetas_modo?: unknown;
  prioridade?: unknown;
  cadence_step: { id: string }[] | null;
};

const COLUNAS_DA_REGUA_DA_ETAPA =
  "id, trigger_stage, name, created_at, cadence_step (id)";

/**
 * As reguas de follow-up ligadas e com pelo menos um passo, ou seja, as que
 * mandam mensagem sozinhas quando um lead entra na etapa delas (achado 98 da
 * revisao). Desde a onda 4 uma etapa pode ter varias (as com etiqueta e a
 * geral; para cada lead vale uma, regua_de_followup_do_contato): a lista
 * vem na ordem da precedencia de cada etapa, com o filtro de cada regua,
 * para a confirmacao de mover dizer quem recebe o que. Com o banco antes da
 * migration 20261024100000 (42703: a coluna nao existe), le sem o filtro e
 * todas sao a geral da etapa delas, como eram. A leitura de cadence e de
 * qualquer membro ativo (RLS).
 */
export async function fetchReguasDeFollowup(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ReguaDaEtapa[]> {
  const consulta = (colunas: string) =>
    supabase
      .from("cadence")
      .select(colunas)
      .eq("clinic_id", clinicId)
      .eq("kind", "followup")
      .eq("active", true);
  let resposta = await consulta(
    `${COLUNAS_DA_REGUA_DA_ETAPA}, etiquetas, etiquetas_modo, prioridade`,
  );
  if (resposta.error?.code === "42703") {
    resposta = await consulta(COLUNAS_DA_REGUA_DA_ETAPA);
  }
  if (resposta.error) {
    throw new Error(resposta.error.message);
  }
  return ((resposta.data ?? []) as unknown as LinhaDaReguaDaEtapa[])
    .filter(
      (regua) =>
        regua.trigger_stage !== null && (regua.cadence_step ?? []).length > 0,
    )
    .map((regua) => ({
      id: regua.id,
      active: true,
      etapa: regua.trigger_stage as string,
      nome: regua.name,
      etiquetas: Array.isArray(regua.etiquetas)
        ? regua.etiquetas.filter(
            (etiqueta): etiqueta is string => typeof etiqueta === "string",
          )
        : [],
      etiquetas_modo: (regua.etiquetas_modo === "todas"
        ? "todas"
        : "qualquer") as ModoDoFiltro,
      prioridade: typeof regua.prioridade === "number" ? regua.prioridade : 0,
      created_at: regua.created_at ?? "",
    }))
    .sort((a, b) => a.etapa.localeCompare(b.etapa) || compararPrecedencia(a, b))
    .map(({ etapa, nome, etiquetas, etiquetas_modo }) => ({
      etapa,
      nome,
      etiquetas,
      etiquetas_modo,
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
  const { data, error } = await consultaDosLeads(supabase, clinicId)
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const [lead] = await anexarAnunciosDaMeta(supabase, clinicId, [
    normalizarLead(data as unknown as Record<string, unknown>),
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

  const [conversa, campanha, atividades, anuncioMeta, anuncioWhatsapp] =
    await Promise.all([
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
      // Nem os detalhes do anuncio: lerDetalhesDoAnuncio tambem nunca lanca.
      lerDetalhesDoAnuncio(supabase, clinicId, sourceAdId),
    ]);
  if (conversa.error) {
    throw new Error(conversa.error.message);
  }

  const conversationId = (conversa.data?.id as string | undefined) ?? null;
  let mensagens: MensagemDoLead[] = [];
  if (conversationId) {
    const { data: msgs, error: erroMsgs } = await supabase
      .from("message")
      .select(
        "id, direction, author, content_type, body, created_at, pelo_celular",
      )
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
    anuncio_whatsapp: anuncioWhatsapp,
    atividades,
  };
}
