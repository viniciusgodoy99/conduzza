import type { SupabaseClient } from "@supabase/supabase-js";

import {
  compararPorPrazo,
  contagemDeAtividadesSchema,
  type ContagemDeAtividades,
  type OrigemDaAtividade,
  type StatusDaAtividade,
} from "@/lib/domain/atividades";
import { limitesDoDia, somarDias, diaCivil } from "@/lib/domain/horarios";
import {
  fetchClinicAuthorNames,
  fetchResponsaveisAtivos,
} from "@/lib/queries/profiles";

// Leituras das atividades (contact_activity). O texto da atividade e dado de
// paciente e pode ser dado de saude (regra 3.1): estas funcoes rodam SO no
// servidor, atras de quem grava a trilha de leitura (a pagina /atividades, a
// abrirDetalheDoContatoAction do drawer, a ficha e as Server Actions de
// app/(app)/atividades/actions.ts). Erro de leitura LANCA, nunca vira lista
// vazia: "nenhuma atividade" e "nao deu para ler" sao estados diferentes na
// tela. Nada daqui vai para log.

export type ContatoDaAtividade = {
  id: string;
  nome: string | null;
  telefone: string;
};

export type AtividadeResumo = {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  titulo: string;
  detalhes: string | null;
  /** Dia civil da clinica (aaaa-mm-dd) */
  due_on: string;
  /** Instante com hora (ISO) ou null quando e so do dia */
  due_at: string | null;
  assignee_user_id: string | null;
  status: StatusDaAtividade;
  origem: OrigemDaAtividade;
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  canceled_at: string | null;
  created_at: string;
  /** null quando o contato nao veio no embed (nao deve acontecer: FK) */
  contato: ContatoDaAtividade | null;
};

/** A lista da tela Atividades: as pendentes e as concluidas recentes. */
export type ListaDeAtividades = {
  atividades: AtividadeResumo[];
  /** O teto de pendentes cortou a lista (a tela avisa) */
  cortada: boolean;
};

/** As atividades de UM contato (drawer, conversa e ficha). */
export type AtividadesDoContato = {
  /** Todas as pendentes (ate o teto), por prazo */
  pendentes: AtividadeResumo[];
  /** As ultimas concluidas, da mais recente para a mais antiga */
  concluidas: AtividadeResumo[];
};

/** Quem pode ser responsavel e os nomes para exibir. */
export type EquipeDaAtividade = {
  /** Quem esta usando (padrao do responsavel e o recorte "Minhas") */
  eu: string;
  /** Nomes de todos os membros, inclusive os que sairam (exibicao) */
  nomes: Record<string, string>;
  /** Ids dos membros ATIVOS: os unicos que podem virar responsavel */
  ativos: string[];
};

export const atividadesKeys = {
  /** Prefixo de tudo de atividades (invalidar depois de uma acao) */
  todas: ["atividades"] as const,
  lista: (clinicId: string) => ["atividades", clinicId, "lista"] as const,
  doContato: (contactId: string) =>
    ["atividades", "contato", contactId] as const,
  equipe: ["atividades", "equipe"] as const,
};

/** Teto de pendentes da tela (como LEADS_LIMIT): a tela avisa quando corta. */
export const ATIVIDADES_PENDENTES_LIMITE = 1000;
/** Teto das concluidas recentes da tela. */
export const ATIVIDADES_CONCLUIDAS_LIMITE = 300;
/** Janela do filtro Concluidas, em dias civis da clinica (hoje incluso). */
export const DIAS_DE_CONCLUIDAS = 30;
/** Teto de pendentes de um contato so (drawer, conversa e ficha). */
const PENDENTES_DO_CONTATO_LIMITE = 50;
/** Quantas concluidas a ficha mostra. */
export const CONCLUIDAS_DO_CONTATO = 5;

const ATIVIDADE_SELECT =
  "id, contact_id, conversation_id, titulo, detalhes, due_on, due_at, assignee_user_id, status, origem, created_by, completed_at, completed_by, canceled_at, created_at, contact:contact_id (id, name, phone_e164)";

const STATUS: readonly StatusDaAtividade[] = [
  "pendente",
  "concluida",
  "cancelada",
];

// O cliente nao e tipado com o Database gerado (lib/supabase/client.ts): a
// linha e normalizada aqui, como em leads.ts. O embed muitos-para-um vem como
// objeto, mas a normalizacao aceita array por garantia.
export function normalizarAtividade(
  row: Record<string, unknown>,
): AtividadeResumo {
  const contatoBruto = Array.isArray(row.contact)
    ? row.contact[0]
    : row.contact;
  const contato = (contatoBruto ?? null) as {
    id: string;
    name: string | null;
    phone_e164: string;
  } | null;
  const status = row.status as StatusDaAtividade;
  if (!STATUS.includes(status)) {
    throw new Error("Situação de atividade desconhecida.");
  }
  return {
    id: row.id as string,
    contact_id: row.contact_id as string,
    conversation_id: (row.conversation_id as string | null) ?? null,
    titulo: row.titulo as string,
    detalhes: (row.detalhes as string | null) ?? null,
    due_on: row.due_on as string,
    due_at: (row.due_at as string | null) ?? null,
    assignee_user_id: (row.assignee_user_id as string | null) ?? null,
    status,
    origem: row.origem === "automacao" ? "automacao" : "manual",
    created_by: (row.created_by as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    completed_by: (row.completed_by as string | null) ?? null,
    canceled_at: (row.canceled_at as string | null) ?? null,
    created_at: row.created_at as string,
    contato: contato
      ? {
          id: contato.id,
          nome: contato.name ?? null,
          telefone: contato.phone_e164,
        }
      : null,
  };
}

/**
 * A lista da tela Atividades: TODAS as pendentes da clinica (ate o teto) e
 * as concluidas dos ultimos 30 dias civis da clinica. Os filtros (Minhas,
 * situacao, responsavel, busca, contato) rodam no cliente sobre esta lista,
 * como em Leads. agora = o instante da requisicao.
 */
export async function fetchAtividadesDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  agora: Date,
): Promise<ListaDeAtividades> {
  // Concluidas desde a meia-noite (na clinica) de 29 dias atras: 30 dias
  // civis contando hoje (regra 3.6, nunca "agora menos 30 x 24h").
  const desde = limitesDoDia(
    timezone,
    somarDias(diaCivil(timezone, agora), -(DIAS_DE_CONCLUIDAS - 1)),
  ).inicio.toISOString();

  const [pendentes, concluidas] = await Promise.all([
    supabase
      .from("contact_activity")
      .select(ATIVIDADE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("status", "pendente")
      .order("due_on", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      // Um a mais que o teto: sobrou, a lista foi cortada.
      .limit(ATIVIDADES_PENDENTES_LIMITE + 1),
    supabase
      .from("contact_activity")
      .select(ATIVIDADE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("status", "concluida")
      .gte("completed_at", desde)
      .order("completed_at", { ascending: false })
      .limit(ATIVIDADES_CONCLUIDAS_LIMITE),
  ]);
  if (pendentes.error) {
    throw new Error(pendentes.error.message);
  }
  if (concluidas.error) {
    throw new Error(concluidas.error.message);
  }
  const linhasPendentes = (pendentes.data ?? []) as Record<string, unknown>[];
  const cortada = linhasPendentes.length > ATIVIDADES_PENDENTES_LIMITE;
  return {
    atividades: [
      ...linhasPendentes
        .slice(0, ATIVIDADES_PENDENTES_LIMITE)
        .map(normalizarAtividade),
      ...((concluidas.data ?? []) as Record<string, unknown>[]).map(
        normalizarAtividade,
      ),
    ],
    cortada,
  };
}

/** As pendentes de um contato, por prazo, e as ultimas concluidas. */
export async function fetchAtividadesDoContato(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<AtividadesDoContato> {
  const [pendentes, concluidas] = await Promise.all([
    supabase
      .from("contact_activity")
      .select(ATIVIDADE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .eq("status", "pendente")
      .order("due_on", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(PENDENTES_DO_CONTATO_LIMITE),
    supabase
      .from("contact_activity")
      .select(ATIVIDADE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .eq("status", "concluida")
      .order("completed_at", { ascending: false })
      .limit(CONCLUIDAS_DO_CONTATO),
  ]);
  if (pendentes.error) {
    throw new Error(pendentes.error.message);
  }
  if (concluidas.error) {
    throw new Error(concluidas.error.message);
  }
  return {
    pendentes: ((pendentes.data ?? []) as Record<string, unknown>[])
      .map(normalizarAtividade)
      .sort(compararPorPrazo),
    concluidas: ((concluidas.data ?? []) as Record<string, unknown>[]).map(
      normalizarAtividade,
    ),
  };
}

/** Os membros para o "Responsável" e os nomes para exibir. */
export async function fetchEquipeDaAtividade(
  supabase: SupabaseClient,
  clinicId: string,
  userId: string,
): Promise<EquipeDaAtividade> {
  const [nomes, ativos] = await Promise.all([
    fetchClinicAuthorNames(supabase, clinicId),
    fetchResponsaveisAtivos(supabase, clinicId),
  ]);
  return { eu: userId, nomes, ativos };
}

/**
 * Traduz o JSON de contagem_de_atividades. Resposta fora do formato LANCA:
 * numero que nao veio nao e "0".
 */
export function lerContagemDeAtividades(data: unknown): ContagemDeAtividades {
  const resultado = contagemDeAtividadesSchema.safeParse(data);
  if (!resultado.success) {
    throw new Error("Resposta inesperada de contagem_de_atividades.");
  }
  return resultado.data;
}

/**
 * Pendentes atrasadas e para hoje da clinica e as do responsavel = sessao,
 * com o "hoje" no fuso da clinica calculado no banco. So contagens: nenhum
 * texto de atividade sai daqui.
 */
export async function fetchContagemDeAtividades(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ContagemDeAtividades> {
  const { data, error } = await supabase.rpc("contagem_de_atividades", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return lerContagemDeAtividades(data);
}
