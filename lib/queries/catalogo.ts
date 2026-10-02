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
  vinculos: Vinculo[];
  pacotes: Pacote[];
  unidades: Unidade[];
};

export const catalogoKeys = {
  tudo: (clinicId: string) => ["catalogo", clinicId] as const,
  // Mesmo prefixo: invalidar tudo(clinicId) invalida o uso dos pacotes junto.
  usoDosPacotes: (clinicId: string) =>
    ["catalogo", clinicId, "uso-dos-pacotes"] as const,
};

// O catalogo inteiro numa carga so: sao tabelas pequenas (dezenas de linhas
// por clinica) e as abas, os filtros da Agenda e o modal precisam de tudo
// junto. Uma requisicao por tabela, em paralelo. Bloqueio nao e catalogo:
// desde 29/09/2026 ele e acao da Agenda, que o busca por dia
// (fetchAgendaDia em lib/queries/agenda.ts).
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
    supabase
      .from("service_link")
      .select(
        "id, professional_id, procedure_id, insurance_id, price_cents, covered_by_insurance, duration_min, bookable_by_ai, active",
      )
      .eq("clinic_id", clinicId),
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
    vinculos,
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
    vinculos: (vinculos.data ?? []) as Vinculo[],
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
