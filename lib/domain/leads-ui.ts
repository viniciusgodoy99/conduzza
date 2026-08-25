import type { ContactRecency, FunnelStage } from "@/lib/design/status";

// Regras PURAS da Tela 4 (Leads): recencia de contato, consentimento vigente,
// ordenacao por "quem espera ha mais tempo" e agrupamento do Kanban. Zero
// I/O: quem busca dados e lib/queries/leads.ts; aqui vive so a decisao,
// testavel direto.

const HORA_MS = 60 * 60 * 1000;

/** Limiar do badge verde: contato ha ate 4 horas esta em dia. */
export const RECENCIA_EM_DIA_MS = 4 * HORA_MS;

/** Limiar do badge ambar: de 4 a 24 horas esta esfriando; acima, frio. */
export const RECENCIA_ESFRIANDO_MS = 24 * HORA_MS;

/**
 * Recencia do ultimo contato para o badge do cartao de lead. Fronteiras
 * inclusivas: exatamente 4h ainda esta em dia, exatamente 24h ainda esta
 * esfriando. Sem contato nenhum devolve null e o badge nem aparece (o cartao
 * ja comunica isso pela posicao: nunca contatado vem primeiro).
 */
export function recencyDe(
  lastContactAt: string | null,
  agora: Date,
): ContactRecency | null {
  if (lastContactAt === null) {
    return null;
  }
  const decorrido = agora.getTime() - new Date(lastContactAt).getTime();
  if (decorrido <= RECENCIA_EM_DIA_MS) {
    return "em_dia";
  }
  if (decorrido <= RECENCIA_ESFRIANDO_MS) {
    return "esfriando";
  }
  return "frio";
}

export type LinhaConsent = {
  channel: string;
  granted_at: string;
  revoked_at: string | null;
};

/**
 * Consentimento vigente de WhatsApp a partir das linhas de contact_consent:
 * filtra o canal, ordena por granted_at desc e olha SO a linha mais recente,
 * a mesma regra da RPC consentimento_vigente. Filtrar por "ativa" ANTES de
 * ordenar seria o bug do fetchConsent antigo: uma linha antiga ativa
 * mascararia a revogacao mais recente, e disparo sem autorizacao e
 * exatamente o que a regra 3.3 proibe.
 */
export function consentimentoVigenteDeLinhas(
  linhas: readonly LinhaConsent[],
): boolean {
  const doCanal = linhas
    .filter((linha) => linha.channel === "whatsapp")
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  const maisRecente = doCanal[0];
  if (!maisRecente) {
    return false;
  }
  return maisRecente.revoked_at === null;
}

/**
 * Ordem de "proxima acao": o lead mais esquecido primeiro. Nunca contatado
 * (null) vem antes de todos; depois, last_contact_at ascendente (contato
 * mais antigo primeiro).
 */
export function compararPorProximaAcao(
  a: { last_contact_at: string | null },
  b: { last_contact_at: string | null },
): number {
  if (a.last_contact_at === null && b.last_contact_at === null) {
    return 0;
  }
  if (a.last_contact_at === null) {
    return -1;
  }
  if (b.last_contact_at === null) {
    return 1;
  }
  return a.last_contact_at.localeCompare(b.last_contact_at);
}

// Motivos de perda do check do banco, com o rotulo de interface. "Outro"
// exige nota (regra da action e do check contact_perdido_exige_motivo).
export const LOST_REASONS: readonly { codigo: string; rotulo: string }[] = [
  { codigo: "preco", rotulo: "Preço" },
  { codigo: "distancia", rotulo: "Distância" },
  { codigo: "horario", rotulo: "Horário" },
  { codigo: "nao_respondeu", rotulo: "Não respondeu" },
  { codigo: "agendou_em_outro_lugar", rotulo: "Agendou em outro lugar" },
  { codigo: "outro", rotulo: "Outro" },
];

/** O minimo que um lead precisa ter para os filtros e o Kanban puros. */
export type LeadFiltravel = {
  funnel_stage: FunnelStage;
  source_channel: string | null;
  owner_user_id: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
};

export type FiltrosDeLeads = {
  etapa?: string;
  origem?: string;
  responsavel?: string;
  /** Inicio do periodo (instante ISO), inclusivo, sobre first_contact_at. */
  deISO?: string;
  /** Fim do periodo (instante ISO), inclusivo, sobre first_contact_at. */
  ateISO?: string;
};

/**
 * Filtros da barra da Tela 4, aplicados no cliente (mesma decisao da Agenda:
 * troca de filtro instantanea, sem refetch). O periodo e sobre
 * first_contact_at; quem converte o dia civil da clinica em instantes e o
 * chamador, respeitando a regra 3.6 de fuso.
 */
export function filtrarLeads<T extends LeadFiltravel>(
  leads: readonly T[],
  filtros: FiltrosDeLeads,
): T[] {
  const de = filtros.deISO ? new Date(filtros.deISO).getTime() : null;
  const ate = filtros.ateISO ? new Date(filtros.ateISO).getTime() : null;
  return leads.filter((lead) => {
    if (filtros.etapa && lead.funnel_stage !== filtros.etapa) {
      return false;
    }
    if (filtros.origem && lead.source_channel !== filtros.origem) {
      return false;
    }
    if (filtros.responsavel && lead.owner_user_id !== filtros.responsavel) {
      return false;
    }
    const primeiroContato = new Date(lead.first_contact_at).getTime();
    if (de !== null && primeiroContato < de) {
      return false;
    }
    if (ate !== null && primeiroContato > ate) {
      return false;
    }
    return true;
  });
}

const ETAPAS: readonly FunnelStage[] = [
  "novo",
  "em_contato",
  "aguardando_resposta",
  "agendou",
  "compareceu",
  "perdido",
];

/**
 * Colunas do Kanban: toda etapa presente (coluna vazia existe, estado de
 * vazio e obrigatorio) e cada grupo ja ordenado por proxima acao.
 */
export function agruparPorEtapa<T extends LeadFiltravel>(
  leads: readonly T[],
): Record<FunnelStage, T[]> {
  const grupos: Record<FunnelStage, T[]> = {
    novo: [],
    em_contato: [],
    aguardando_resposta: [],
    agendou: [],
    compareceu: [],
    perdido: [],
  };
  for (const lead of leads) {
    grupos[lead.funnel_stage].push(lead);
  }
  for (const etapa of ETAPAS) {
    grupos[etapa].sort(compararPorProximaAcao);
  }
  return grupos;
}
