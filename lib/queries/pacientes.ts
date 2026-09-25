import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppointmentStatus } from "@/lib/design/status";

// Tipos e fetchers da Tela 9 (Pacientes e ficha). Isomorficos como leads.ts:
// recebem o SupabaseClient e rodam no servidor (carga inicial) e no browser
// (TanStack). A lista vem de UMA chamada da RPC pacientes_resumo, que agrega
// consultas e pacotes no banco; os filtros da barra sao aplicados no cliente
// (lib/domain/pacientes-ui.ts). A RPC e security INVOKER: a RLS de contact,
// appointment e package_balance manda, inclusive o recorte de clinica. A
// leitura humana da tela passa por auditarLeituraDePaciente na page.

/** Espelho exato das 15 colunas devolvidas por pacientes_resumo (v4). */
export type PacienteResumo = {
  contact_id: string;
  name: string | null;
  phone_e164: string;
  insurance_id: string | null;
  insurance_name: string | null;
  no_show_count: number;
  tags: string[];
  ultima_consulta: string | null;
  proxima_consulta: string | null;
  total_compareceu: number;
  total_faltou: number;
  saldo_sessoes: number;
  saldo_total: number;
  profissionais_ids: string[];
  /**
   * Consulta nao cancelada mais antiga (passada ou futura), para o indicador
   * "Novos no mes". Migration 20260925102000.
   */
  primeira_consulta: string | null;
};

export const pacientesKeys = {
  lista: (clinicId: string) => ["pacientes", clinicId, "lista"] as const,
  ficha: (contactId: string) => ["pacientes", "ficha", contactId] as const,
};

// Sem nome vai para o fim: contato importado sem cadastro nao pode ocupar o
// topo da lista so porque null ordena antes.
function compararPorNome(a: PacienteResumo, b: PacienteResumo): number {
  if (a.name === null && b.name === null) {
    return 0;
  }
  if (a.name === null) {
    return 1;
  }
  if (b.name === null) {
    return -1;
  }
  return a.name.localeCompare(b.name, "pt-BR");
}

function normalizarPaciente(row: Record<string, unknown>): PacienteResumo {
  return {
    contact_id: row.contact_id as string,
    name: (row.name as string | null) ?? null,
    phone_e164: row.phone_e164 as string,
    insurance_id: (row.insurance_id as string | null) ?? null,
    insurance_name: (row.insurance_name as string | null) ?? null,
    no_show_count: (row.no_show_count as number | null) ?? 0,
    tags: (row.tags as string[] | null) ?? [],
    ultima_consulta: (row.ultima_consulta as string | null) ?? null,
    proxima_consulta: (row.proxima_consulta as string | null) ?? null,
    total_compareceu: (row.total_compareceu as number | null) ?? 0,
    total_faltou: (row.total_faltou as number | null) ?? 0,
    saldo_sessoes: (row.saldo_sessoes as number | null) ?? 0,
    saldo_total: (row.saldo_total as number | null) ?? 0,
    profissionais_ids: (row.profissionais_ids as string[] | null) ?? [],
    primeira_consulta: (row.primeira_consulta as string | null) ?? null,
  };
}

// Teto de seguranca, mesmo padrao do Inbox (CONVERSATIONS_ATIVAS_LIMIT): sem
// limite, o payload de /pacientes cresce com a clinica inteira. A RPC ja
// ordena por nome (nulls last), entao o corte e deterministico; acima do
// teto a tela passa a precisar de busca no servidor.
export const PACIENTES_LIMIT = 1000;

/** Lista da Tela 9, ja em ordem alfabetica de pt-BR. */
export async function fetchPacientes(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<PacienteResumo[]> {
  const { data, error } = await supabase
    .rpc("pacientes_resumo", {
      p_clinic_id: clinicId,
    })
    .limit(PACIENTES_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map(normalizarPaciente)
    .sort(compararPorNome);
}

export type ConsultaDoPaciente = {
  id: string;
  starts_at: string;
  status: AppointmentStatus;
  professional_id: string;
  professional_name: string | null;
  procedure_name: string | null;
  insurance_name: string | null;
  /** Preco ATUAL do vinculo; a exibicao passa por exibirPrecoVinculo. */
  price_cents: number | null;
  covered_by_insurance: boolean;
  /** Saldo de pacote que esta consulta descontou (null quando nao descontou). */
  package_balance_id: string | null;
};

export type SaldoDePacote = {
  id: string;
  package_id: string;
  procedure_name: string | null;
  sessions_total: number;
  sessions_used: number;
  expires_at: string | null;
};

/**
 * Linha de consentimento que VIGORA hoje, revogada ou nao: a ficha precisa
 * separar "nunca autorizou" (null) de "autorizou e depois cancelou" (linha
 * com revoked_at), e a data da revogacao so existe na linha.
 */
export type ConsentimentoVigente = {
  source: string;
  granted_at: string;
  revoked_at: string | null;
} | null;

export type ContatoDaFicha = {
  id: string;
  clinic_id: string;
  name: string | null;
  phone_e164: string;
  cpf: string | null;
  email: string | null;
  birth_date: string | null;
  insurance_card: string | null;
  notes: string | null;
  kind: "lead" | "paciente";
  tags: string[];
  no_show_count: number;
  source_channel: string | null;
  source_origin: string | null;
  source_medium: string | null;
  source_campaign: string | null;
  source_captured_at: string | null;
  source_method: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  created_at: string;
  insurance: { id: string; name: string } | null;
};

export type FichaDoPaciente = {
  contato: ContatoDaFicha;
  /** Linha do tempo, da consulta mais recente para a mais antiga. */
  consultas: ConsultaDoPaciente[];
  pacotes: SaldoDePacote[];
  consentimento: ConsentimentoVigente;
  /**
   * Conversa do "Abrir conversa": a aberta, se houver; senao a mais recente,
   * mesmo resolvida (o Atendimento abre resolvida pelo link). null so quando
   * o paciente nao tem conversa nenhuma que esta sessao possa ler.
   */
  conversationId: string | null;
};

type LinhaDeConsentimento = {
  channel: string;
  source: string;
  granted_at: string;
  revoked_at: string | null;
};

// Mesma regra de consentimentoVigenteDeLinhas (lib/domain/leads-ui.ts): filtra
// o canal, ordena por granted_at desc e olha SO a linha mais recente. Filtrar
// por "ativa" antes de ordenar mascararia uma revogacao recente com uma
// autorizacao antiga, que e o disparo sem autorizacao proibido pela regra 3.3.
function consentimentoVigenteDaFicha(
  linhas: readonly LinhaDeConsentimento[],
): ConsentimentoVigente {
  const maisRecente = linhas
    .filter((linha) => linha.channel === "whatsapp")
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at))[0];
  if (!maisRecente) {
    return null;
  }
  return {
    source: maisRecente.source,
    granted_at: maisRecente.granted_at,
    revoked_at: maisRecente.revoked_at,
  };
}

const CONTATO_SELECT =
  "id, clinic_id, name, phone_e164, cpf, email, birth_date, insurance_card, notes, kind, tags, no_show_count, source_channel, source_origin, source_medium, source_campaign, source_captured_at, source_method, first_contact_at, last_contact_at, created_at, insurance:insurance_id (id, name)";

// Molde do CONSULTA_SELECT da Agenda, mais o nome do profissional e o preco do
// vinculo, que a linha do tempo mostra.
const CONSULTA_DO_PACIENTE_SELECT =
  "id, starts_at, status, professional_id, package_balance_id, professional:professional_id (id, name), service_link:service_link_id (id, price_cents, covered_by_insurance, procedure:procedure_id (id, name), insurance:insurance_id (id, name))";

const PACOTE_SELECT =
  "id, package_id, sessions_total, sessions_used, expires_at, package:package_id (id, procedure:procedure_id (id, name))";

// Sem tipos gerados, o supabase-js devolve embed como array: desembrulha no
// padrao de normalizarConsulta (lib/queries/agenda.ts).
function desembrulhar(valor: unknown): Record<string, unknown> | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return (bruto as Record<string, unknown> | null) ?? null;
}

function normalizarConsultaDoPaciente(
  row: Record<string, unknown>,
): ConsultaDoPaciente {
  const profissional = desembrulhar(row.professional);
  const vinculo = desembrulhar(row.service_link);
  const procedimento = vinculo ? desembrulhar(vinculo.procedure) : null;
  const convenio = vinculo ? desembrulhar(vinculo.insurance) : null;
  return {
    id: row.id as string,
    starts_at: row.starts_at as string,
    status: row.status as AppointmentStatus,
    professional_id: row.professional_id as string,
    professional_name: (profissional?.name as string | null) ?? null,
    procedure_name: (procedimento?.name as string | null) ?? null,
    insurance_name: (convenio?.name as string | null) ?? null,
    price_cents: (vinculo?.price_cents as number | null) ?? null,
    covered_by_insurance: (vinculo?.covered_by_insurance as boolean) ?? false,
    package_balance_id: (row.package_balance_id as string | null) ?? null,
  };
}

function normalizarPacote(row: Record<string, unknown>): SaldoDePacote {
  const pacote = desembrulhar(row.package);
  const procedimento = pacote ? desembrulhar(pacote.procedure) : null;
  return {
    id: row.id as string,
    package_id: row.package_id as string,
    procedure_name: (procedimento?.name as string | null) ?? null,
    sessions_total: row.sessions_total as number,
    sessions_used: row.sessions_used as number,
    expires_at: (row.expires_at as string | null) ?? null,
  };
}

/**
 * Ficha completa da Tela 9: cadastro, linha do tempo de consultas, saldos de
 * pacote, autorizacao para receber mensagens e a conversa do atalho (aberta
 * ou, sem ela, a mais recente). null quando
 * o contato nao existe ou a RLS nao deixa ler.
 */
export async function fetchFichaPaciente(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<FichaDoPaciente | null> {
  const [
    contato,
    consultas,
    pacotes,
    consentimentos,
    conversaAberta,
    conversaRecente,
  ] = await Promise.all([
    supabase
      .from("contact")
      .select(CONTATO_SELECT)
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .maybeSingle(),
    supabase
      .from("appointment")
      .select(CONSULTA_DO_PACIENTE_SELECT)
      .eq("contact_id", contactId)
      .order("starts_at", { ascending: false }),
    supabase
      .from("package_balance")
      .select(PACOTE_SELECT)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("contact_consent")
      .select("channel, source, granted_at, revoked_at")
      .eq("contact_id", contactId)
      .order("granted_at", { ascending: false }),
    // "Abrir conversa" (achado 70): a aberta vence, porque e onde a conversa
    // continua; sem ela, a mais recente em qualquer situacao, inclusive
    // resolvida, que o Atendimento abre pelo link. Duas consultas porque
    // last_message_at pode ser nulo numa conversa aberta recem criada, e a
    // ordenacao sozinha poria uma resolvida antiga na frente dela. A RLS
    // decide o que esta sessao le (o profissional so ve as atribuidas a ele).
    //
    // VARIOS NUMEROS (docs/07): o paciente pode ter uma conversa aberta em
    // cada numero da clinica. O atalho leva a mais recente em QUALQUER numero
    // (o limit(1) nunca quebra com duas); empate de atividade vai para a mais
    // nova, e o Atendimento mostra de qual numero ela e.
    supabase
      .from("conversation")
      .select("id")
      .eq("contact_id", contactId)
      .neq("status", "resolvida")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation")
      .select("id")
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const resultado of [
    contato,
    consultas,
    pacotes,
    consentimentos,
    conversaAberta,
    conversaRecente,
  ]) {
    if (resultado.error) {
      throw new Error(resultado.error.message);
    }
  }
  if (!contato.data) {
    return null;
  }

  const row = contato.data as Record<string, unknown>;
  return {
    contato: {
      ...(row as unknown as ContatoDaFicha),
      tags: (row.tags as string[] | null) ?? [],
      no_show_count: (row.no_show_count as number | null) ?? 0,
      insurance: desembrulhar(row.insurance) as ContatoDaFicha["insurance"],
    },
    consultas: ((consultas.data ?? []) as Record<string, unknown>[]).map(
      normalizarConsultaDoPaciente,
    ),
    pacotes: ((pacotes.data ?? []) as Record<string, unknown>[]).map(
      normalizarPacote,
    ),
    consentimento: consentimentoVigenteDaFicha(
      (consentimentos.data ?? []) as LinhaDeConsentimento[],
    ),
    conversationId:
      (conversaAberta.data?.id as string | undefined) ??
      (conversaRecente.data?.id as string | undefined) ??
      null,
  };
}
