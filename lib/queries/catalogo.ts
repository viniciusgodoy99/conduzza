import type { SupabaseClient } from "@supabase/supabase-js";

import { precoAvulsoDoPacote, type PrecoAvulso } from "@/lib/domain/pacotes";

// Tipos e fetchers do catalogo clinico (Fase 2). Isomorficos: recebem o
// SupabaseClient e rodam no servidor (carga inicial) e no browser (TanStack).
// Reusados pela Tela 8 (Cadastros), pela barra de filtros e pelo modal da
// Agenda. A RLS do banco garante isolamento e papel.

export type Profissional = {
  id: string;
  name: string;
  photo_url: string | null;
  council_type: string | null;
  council_number: string | null;
  specialties: string[];
  calendar_color: string | null;
  active: boolean;
};

export type Jornada = {
  id: string;
  professional_id: string;
  unit_id: string | null;
  weekday: number;
  starts_at: string;
  ends_at: string;
};

export type Recurso = {
  id: string;
  unit_id: string | null;
  name: string;
  kind: "sala" | "cabine" | "equipamento";
  active: boolean;
};

export type Procedimento = {
  id: string;
  name: string;
  description: string | null;
  default_duration_min: number;
  base_price_cents: number | null;
  requires_evaluation: boolean;
  prep_instructions: string | null;
  resource_id: string | null;
  bookable_by_ai: boolean;
  active: boolean;
};

export type Convenio = {
  id: string;
  name: string;
  plan_name: string | null;
  requires_card: boolean;
  notes: string | null;
  active: boolean;
};

export type Vinculo = {
  id: string;
  professional_id: string;
  procedure_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
  bookable_by_ai: boolean;
  active: boolean;
};

/** Um procedimento do pacote (package_item). */
export type ItemDoPacote = {
  id: string;
  procedure_id: string;
  sessions: number;
};

// Pacote com varios procedimentos (migration 20260929120000). Os itens vem
// ordenados pelo nome do procedimento. package.procedure_id e
// package.sessions sao legado e nao sao lidos.
export type Pacote = {
  id: string;
  name: string;
  /** O valor que a clinica define; nao e distribuido entre os itens. */
  price_cents: number;
  /** Validade do PACOTE (conta da venda), null = nao vence. */
  validity_days: number | null;
  active: boolean;
  itens: ItemDoPacote[];
  /**
   * Soma de sessoes x preco base de cada procedimento, calculada aqui a
   * partir de procedure.base_price_cents (nunca gravada). Com item sem
   * preco base, itensSemPreco > 0 e a soma e parcial.
   */
  preco_avulso: PrecoAvulso;
};

// Uso de cada pacote (aba Pacotes): quantas vendas ja existem (o delete real
// so vale sem venda, e os itens ficam congelados depois da primeira) e
// quantos pacientes ainda tem saldo usavel, no dia civil da clinica.
export type UsoDoPacote = {
  vendas: number;
  pacientesComSaldo: number;
};

export type Unidade = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
};

export type Catalogo = {
  profissionais: Profissional[];
  jornadas: Jornada[];
  recursos: Recurso[];
  procedimentos: Procedimento[];
  convenios: Convenio[];
  /**
   * So os vinculos ATIVOS (desde 02/10/2026). Todo leitor ja filtrava
   * `active` (Agenda, modal da consulta, remarcacao e o modal do
   * Procedimento); o campo `active` fica no tipo, sempre true.
   */
  vinculos: Vinculo[];
  pacotes: Pacote[];
  unidades: Unidade[];
};

// Convenio pelo medico (decisao do dono em 02/10/2026; migration
// 20261002140000_convenio_pelo_medico.sql). Lidos SO por Cadastros e pela
// sincronia: a Agenda, a IA, o preco e as conversoes continuam lendo so
// service_link.

/** professional_insurance: o profissional atende o convenio */
export type Atendimento = { professional_id: string; insurance_id: string };

/** procedure_insurance: o convenio cobre o procedimento */
export type Cobertura = { procedure_id: string; insurance_id: string };

/**
 * Os pares das duas tabelas, COMPLETOS. Fica fora do Catalogo de proposito:
 * o Catalogo e usado pela Agenda, Pacientes e Confirmacoes, que nao precisam
 * disto e nao podem cair por isto.
 */
export type MatrizDeConvenios = {
  atendimentos: Atendimento[];
  coberturas: Cobertura[];
};

export const catalogoKeys = {
  tudo: (clinicId: string) => ["catalogo", clinicId] as const,
  // Mesmo prefixo: invalidar tudo(clinicId) invalida o uso dos pacotes junto.
  usoDosPacotes: (clinicId: string) =>
    ["catalogo", clinicId, "uso-dos-pacotes"] as const,
  // Mesmo prefixo de proposito: o aoMudar de Cadastros (invalidate de
  // tudo(clinicId)) recarrega a matriz junto com o catalogo.
  matriz: (clinicId: string) =>
    ["catalogo", clinicId, "matriz-de-convenios"] as const,
};

// O PostgREST corta toda leitura em max_rows linhas SEM erro
// (supabase/config.toml, max_rows = 1000). Para as tabelas que podem passar
// disso e cujo corte silencioso faz mal (vinculos e os pares de convenio:
// um corte vira aba "parada" para sempre na trava otimista das RPCs e faz o
// proximo Salvar desativar o que nao veio), a leitura pagina por id.
const PAGINA = 1000;

type PaginaLida = {
  data: unknown[] | null;
  error: { message: string } | null;
};

/**
 * Le todas as paginas ate vir uma com menos de PAGINA linhas. Erro em
 * qualquer pagina LANCA: a lista cortada nunca e entregue (quem chama
 * derruba a tela inteira, que e melhor do que salvar em cima de dado
 * incompleto). A consulta tem de vir ordenada por uma chave unica (id).
 */
async function lerTodasAsPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<PaginaLida>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) {
      throw new Error(error.message);
    }
    const lidas = (data ?? []) as T[];
    linhas.push(...lidas);
    if (lidas.length < PAGINA) {
      return linhas;
    }
  }
}

// Vinculos ATIVOS da clinica, paginados. Inativo nao entra: ninguem le (a
// Agenda so oferece ativo, o modal do Procedimento so mostra ativo, a
// remarcacao so troca para ativo) e ele so engordava a leitura.
function lerVinculosAtivos(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Vinculo[]> {
  return lerTodasAsPaginas<Vinculo>((de, ate) =>
    supabase
      .from("service_link")
      .select(
        "id, professional_id, procedure_id, insurance_id, price_cents, covered_by_insurance, duration_min, bookable_by_ai, active",
      )
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("id")
      .range(de, ate),
  );
}

/**
 * Os pares de convenio da clinica (quem atende e o que cobre), completos.
 * Filtra pela clinica ativa: a RLS deixa quem e membro de duas clinicas ler
 * as duas. Erro LANCA (nunca uma matriz vazia ou cortada: a tela abriria os
 * modais sem os convenios gravados e o proximo Salvar os apagaria).
 */
export async function fetchMatrizDeConvenios(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<MatrizDeConvenios> {
  const [atendimentos, coberturas] = await Promise.all([
    lerTodasAsPaginas<Atendimento>((de, ate) =>
      supabase
        .from("professional_insurance")
        .select("professional_id, insurance_id")
        .eq("clinic_id", clinicId)
        .order("id")
        .range(de, ate),
    ),
    lerTodasAsPaginas<Cobertura>((de, ate) =>
      supabase
        .from("procedure_insurance")
        .select("procedure_id, insurance_id")
        .eq("clinic_id", clinicId)
        .order("id")
        .range(de, ate),
    ),
  ]);
  return {
    atendimentos: atendimentos.map((par) => ({
      professional_id: par.professional_id,
      insurance_id: par.insurance_id,
    })),
    coberturas: coberturas.map((par) => ({
      procedure_id: par.procedure_id,
      insurance_id: par.insurance_id,
    })),
  };
}

// O catalogo inteiro numa carga so: sao tabelas pequenas (dezenas de linhas
// por clinica) e as abas, os filtros da Agenda e o modal precisam de tudo
// junto. Uma requisicao por tabela, em paralelo (os vinculos, paginados).
// Bloqueio nao e catalogo: desde 29/09/2026 ele e acao da Agenda, que o
// busca por dia (fetchAgendaDia em lib/queries/agenda.ts).
export async function fetchCatalogo(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Catalogo> {
  const [
    profissionais,
    jornadas,
    recursos,
    procedimentos,
    convenios,
    vinculos,
    pacotes,
    unidades,
  ] = await Promise.all([
    supabase
      .from("professional")
      .select(
        "id, name, photo_url, council_type, council_number, specialties, calendar_color, active",
      )
      .eq("clinic_id", clinicId)
      .order("name"),
    supabase
      .from("professional_schedule")
      .select("id, professional_id, unit_id, weekday, starts_at, ends_at")
      .eq("clinic_id", clinicId)
      .order("weekday")
      .order("starts_at"),
    supabase
      .from("resource")
      .select("id, unit_id, name, kind, active")
      .eq("clinic_id", clinicId)
      .order("name"),
    supabase
      .from("procedure")
      .select(
        "id, name, description, default_duration_min, base_price_cents, requires_evaluation, prep_instructions, resource_id, bookable_by_ai, active",
      )
      .eq("clinic_id", clinicId)
      .order("name"),
    supabase
      .from("insurance")
      .select("id, name, plan_name, requires_card, notes, active")
      .eq("clinic_id", clinicId)
      .order("name"),
    // Erro aqui LANCA (dentro de lerTodasAsPaginas) e derruba o Promise.all.
    lerVinculosAtivos(supabase, clinicId),
    supabase
      .from("package")
      .select(
        "id, name, price_cents, validity_days, active, itens:package_item (id, procedure_id, sessions)",
      )
      .eq("clinic_id", clinicId)
      .order("name"),
    supabase
      .from("unit")
      .select("id, name, address, phone, active")
      .eq("clinic_id", clinicId)
      .order("name"),
  ]);

  for (const resultado of [
    profissionais,
    jornadas,
    recursos,
    procedimentos,
    convenios,
    pacotes,
    unidades,
  ]) {
    if (resultado.error) {
      throw new Error(resultado.error.message);
    }
  }

  const listaDeProcedimentos = (procedimentos.data ?? []) as Procedimento[];
  return {
    profissionais: (profissionais.data ?? []) as Profissional[],
    jornadas: (jornadas.data ?? []) as Jornada[],
    recursos: (recursos.data ?? []) as Recurso[],
    procedimentos: listaDeProcedimentos,
    convenios: (convenios.data ?? []) as Convenio[],
    vinculos,
    pacotes: ((pacotes.data ?? []) as Record<string, unknown>[]).map((linha) =>
      normalizarPacote(linha, listaDeProcedimentos),
    ),
    unidades: (unidades.data ?? []) as Unidade[],
  };
}

function normalizarPacote(
  linha: Record<string, unknown>,
  procedimentos: readonly Procedimento[],
): Pacote {
  const nomePorId = new Map(procedimentos.map((p) => [p.id, p.name]));
  const itens = ((linha.itens as ItemDoPacote[] | null) ?? [])
    .map((item) => ({
      id: item.id,
      procedure_id: item.procedure_id,
      sessions: item.sessions,
    }))
    .sort((a, b) =>
      (nomePorId.get(a.procedure_id) ?? "").localeCompare(
        nomePorId.get(b.procedure_id) ?? "",
        "pt-BR",
      ),
    );
  return {
    id: linha.id as string,
    name: linha.name as string,
    price_cents: linha.price_cents as number,
    validity_days: (linha.validity_days as number | null) ?? null,
    active: linha.active as boolean,
    itens,
    preco_avulso: precoAvulsoDoPacote(itens, procedimentos),
  };
}

// Contagem no banco (RPC uso_dos_pacotes, SECURITY INVOKER: a RLS de
// package_balance vale). So numeros: nenhum dado de paciente sai daqui.
export async function fetchUsoDosPacotes(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, UsoDoPacote>> {
  const { data, error } = await supabase.rpc("uso_dos_pacotes", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const uso: Record<string, UsoDoPacote> = {};
  for (const linha of (data ?? []) as {
    package_id: string;
    vendas: number;
    pacientes_com_saldo: number;
  }[]) {
    uso[linha.package_id] = {
      vendas: linha.vendas,
      pacientesComSaldo: linha.pacientes_com_saldo,
    };
  }
  return uso;
}

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export const RESOURCE_KIND_LABELS: Record<Recurso["kind"], string> = {
  sala: "Sala",
  cabine: "Cabine",
  equipamento: "Equipamento",
};
