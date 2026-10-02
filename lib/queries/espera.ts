import type { SupabaseClient } from "@supabase/supabase-js";

// Tipos e fetchers da Tela 10 (Lista de espera). Isomorficos, como Agenda e
// Confirmacoes: rodam no servidor (carga inicial) e no browser (TanStack +
// tempo real). A RLS recorta por clinica; a leitura humana da tela (nome e
// telefone de paciente) passa por auditarLeituraDePaciente na page.

export type EntradaDaEspera = {
  id: string;
  contact_id: string;
  procedure_id: string | null;
  professional_id: string | null;
  preferred_shifts: string[];
  preferred_weekdays: number[];
  priority: number;
  created_at: string;
  contact: { id: string; name: string | null; phone_e164: string } | null;
  procedure: { id: string; name: string } | null;
  professional: { id: string; name: string } | null;
};

export type DestinatarioDaOferta = {
  contactId: string;
  nome: string | null;
  situacao: "aguardando" | "recusou";
};

export type OfertaEmAndamento = {
  id: string;
  slot_starts_at: string;
  expires_at: string;
  professional_nome: string | null;
  destinatarios: DestinatarioDaOferta[];
};

/**
 * "Desempenho da lista" no MES CIVIL da clinica (RPC metricas_da_espera,
 * Fase 3). Vaga = a consulta cancelada que abriu o horario; ela entra no mes
 * da sua PRIMEIRA onda (safra). Uma vaga termina preenchida, esgotada (a
 * ultima onda venceu sem ninguem), cancelada (pela recepcao ou horario
 * ocupado) ou segue em andamento.
 */
export type MetricasDaEspera = {
  vagasOferecidas: number;
  vagasPreenchidas: number;
  vagasEmAndamento: number;
  vagasCanceladas: number;
  vagasEsgotadas: number;
  /** Primeiras ondas resolvidas pelo paciente (aceita ou vencida). */
  primeiraOndaBase: number;
  primeiraOndaAceita: number;
  /** Media da primeira onda ao aceite; null sem vaga preenchida. */
  tempoMedioMin: number | null;
  /**
   * Preco das vagas preenchidas (preco do vinculo; sem ele, o base do
   * procedimento; "Coberto" sem valor fora). null = SEM PERMISSAO: so
   * administrador e gestor recebem o numero do banco. Nunca vira zero.
   */
  receitaCents: number | null;
  /**
   * O que ficou fora da soma da receita, como no faturamento: vagas com
   * valor, de convenio sem valor ("Coberto") e sem preco cadastrado. null
   * junto com a receita (sem permissao).
   */
  vagasComValor: number | null;
  vagasCobertas: number | null;
  vagasSemPreco: number | null;
};

export type ConfigDaEspera = {
  waveSize: number;
  responseMinutes: number;
};

export const esperaKeys = {
  fila: (clinicId: string) => ["espera", clinicId, "fila"] as const,
  /** As reofertas abertas (todas, uma faixa por oferta). */
  oferta: (clinicId: string) => ["espera", clinicId, "oferta"] as const,
  metricas: (clinicId: string) => ["espera", clinicId, "metricas"] as const,
  consentimento: (clinicId: string, contactId: string) =>
    ["espera", clinicId, "consentimento", contactId] as const,
};

/**
 * Autorizacao do contato para receber mensagens no WhatsApp, para o modal de
 * adicionar (achado 57): a reoferta confere consentimento_vigente e pula
 * quem nao tem, entao a recepcao precisa saber ANTES. A linha mais recente
 * manda (a mesma regra da RPC), e o retorno separa "nunca registrou" de
 * "pediu para nao receber", que a RPC booleana nao separa.
 */
export type SituacaoDaAutorizacao =
  "autorizado" | "revogado" | "sem_autorizacao";

export async function fetchAutorizacaoDoContato(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<SituacaoDaAutorizacao> {
  const { data, error } = await supabase
    .from("contact_consent")
    .select("granted_at, revoked_at")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("granted_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  const maisRecente = (
    (data ?? []) as { granted_at: string; revoked_at: string | null }[]
  )[0];
  if (!maisRecente) {
    return "sem_autorizacao";
  }
  return maisRecente.revoked_at === null ? "autorizado" : "revogado";
}

function primeiro<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) {
    return valor[0] ?? null;
  }
  return valor ?? null;
}

export async function fetchFilaDeEspera(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<EntradaDaEspera[]> {
  const { data, error } = await supabase
    .from("waitlist")
    .select(
      "id, contact_id, procedure_id, professional_id, preferred_shifts, preferred_weekdays, priority, created_at, contact:contact_id (id, name, phone_e164), procedure:procedure_id (id, name), professional:professional_id (id, name)",
    )
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("priority")
    .order("created_at")
    .limit(500);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((linha) => ({
    ...(linha as object),
    contact: primeiro(linha.contact),
    procedure: primeiro(linha.procedure),
    professional: primeiro(linha.professional),
  })) as EntradaDaEspera[];
}

/** Teto de faixas na tela: mais que isso e sinal de outro problema. */
const TETO_DE_OFERTAS_NA_TELA = 20;

/**
 * TODAS as reofertas abertas, do horario mais proximo para o mais longe.
 * Duas vagas abertas ao mesmo tempo (a medica adoeceu e a tarde inteira foi
 * cancelada) precisam de duas faixas: a recepcao so cancela o que enxerga.
 */
export async function fetchOfertasEmAndamento(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<OfertaEmAndamento[]> {
  const { data, error } = await supabase
    .from("waitlist_offer")
    .select(
      "id, slot_starts_at, expires_at, offered_to, declined_by, professional:professional_id ( name )",
    )
    .eq("clinic_id", clinicId)
    .eq("status", "aberta")
    .order("slot_starts_at")
    .order("id")
    .limit(TETO_DE_OFERTAS_NA_TELA);
  if (error) {
    throw new Error(error.message);
  }
  const ofertas = (data ?? []) as Record<string, unknown>[];
  if (ofertas.length === 0) {
    return [];
  }
  const todosOsContatos = [
    ...new Set(
      ofertas.flatMap((oferta) => (oferta.offered_to as string[]) ?? []),
    ),
  ];
  const { data: contatos, error: erroContatos } = await supabase
    .from("contact")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .in("id", todosOsContatos);
  if (erroContatos) {
    throw new Error(erroContatos.message);
  }
  const nomePorContato = new Map(
    ((contatos ?? []) as { id: string; name: string | null }[]).map((linha) => [
      linha.id,
      linha.name,
    ]),
  );
  return ofertas.map((oferta) => {
    const offeredTo = (oferta.offered_to as string[]) ?? [];
    const declinedBy = new Set((oferta.declined_by as string[]) ?? []);
    const profissional = primeiro(
      oferta.professional as { name: string } | { name: string }[] | null,
    );
    return {
      id: oferta.id as string,
      slot_starts_at: oferta.slot_starts_at as string,
      expires_at: oferta.expires_at as string,
      professional_nome: profissional?.name ?? null,
      destinatarios: offeredTo.map((contactId) => ({
        contactId,
        nome: nomePorContato.get(contactId) ?? null,
        situacao: declinedBy.has(contactId) ? "recusou" : "aguardando",
      })),
    };
  });
}

function contagemDaEspera(valor: unknown, coluna: string): number {
  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (typeof numero !== "number" || !Number.isFinite(numero) || numero < 0) {
    // Formato inesperado vira erro na tela, nunca zero calado.
    throw new Error(`metricas_da_espera: coluna ${coluna} invalida`);
  }
  return numero;
}

function opcional(valor: unknown, coluna: string): number | null {
  return valor === null || valor === undefined
    ? null
    : contagemDaEspera(valor, coluna);
}

/**
 * Uma linha da RPC metricas_da_espera (security invoker; a receita sai null
 * do banco para quem nao e admin nem gestor). Substitui a leitura antiga em
 * duas idas, que engolia o erro da segunda, mandava ate 500 ids na URL e
 * zerava a receita do profissional pela RLS sem aviso. Erro ou linha
 * faltando LANCAM: a tela mostra o erro, nunca zero.
 */
export async function fetchMetricasDaEspera(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<MetricasDaEspera> {
  const { data, error } = await supabase.rpc("metricas_da_espera", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const linha = ((data ?? []) as Record<string, unknown>[])[0];
  if (!linha) {
    throw new Error("metricas_da_espera nao devolveu a linha da clinica");
  }
  return {
    vagasOferecidas: contagemDaEspera(
      linha.vagas_oferecidas,
      "vagas_oferecidas",
    ),
    vagasPreenchidas: contagemDaEspera(
      linha.vagas_preenchidas,
      "vagas_preenchidas",
    ),
    vagasEmAndamento: contagemDaEspera(
      linha.vagas_em_andamento,
      "vagas_em_andamento",
    ),
    vagasCanceladas: contagemDaEspera(
      linha.vagas_canceladas,
      "vagas_canceladas",
    ),
    vagasEsgotadas: contagemDaEspera(linha.vagas_esgotadas, "vagas_esgotadas"),
    primeiraOndaBase: contagemDaEspera(
      linha.primeira_onda_base,
      "primeira_onda_base",
    ),
    primeiraOndaAceita: contagemDaEspera(
      linha.primeira_onda_aceita,
      "primeira_onda_aceita",
    ),
    // O tipo gerado marca as duas como nao nulas; o banco devolve null.
    tempoMedioMin: opcional(linha.tempo_medio_min, "tempo_medio_min"),
    receitaCents: opcional(linha.receita_cents, "receita_cents"),
    vagasComValor: opcional(linha.vagas_com_valor, "vagas_com_valor"),
    vagasCobertas: opcional(linha.vagas_cobertas, "vagas_cobertas"),
    vagasSemPreco: opcional(linha.vagas_sem_preco, "vagas_sem_preco"),
  };
}

export async function fetchConfigDaEspera(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConfigDaEspera> {
  const { data, error } = await supabase
    .from("clinic")
    .select("waitlist_wave_size, waitlist_response_minutes")
    .eq("id", clinicId)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return {
    waveSize: data.waitlist_wave_size as number,
    responseMinutes: data.waitlist_response_minutes as number,
  };
}
