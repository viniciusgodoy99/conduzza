import type { SupabaseClient } from "@supabase/supabase-js";

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

export type Bloqueio = {
  id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  blocks_overbooking: boolean;
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

export type Pacote = {
  id: string;
  procedure_id: string;
  sessions: number;
  price_cents: number;
  validity_days: number | null;
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
  bloqueios: Bloqueio[];
  recursos: Recurso[];
  procedimentos: Procedimento[];
  convenios: Convenio[];
  vinculos: Vinculo[];
  pacotes: Pacote[];
  unidades: Unidade[];
};

export const catalogoKeys = {
  tudo: (clinicId: string) => ["catalogo", clinicId] as const,
};

// O catalogo inteiro numa carga so: sao tabelas pequenas (dezenas de linhas
// por clinica) e as abas, os filtros da Agenda e o modal precisam de tudo
// junto. Uma requisicao por tabela, em paralelo.
export async function fetchCatalogo(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Catalogo> {
  const [
    profissionais,
    jornadas,
    bloqueios,
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
      .from("professional_block")
      .select(
        "id, professional_id, starts_at, ends_at, reason, blocks_overbooking",
      )
      .eq("clinic_id", clinicId)
      .gte("ends_at", new Date().toISOString())
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
      .select("id, procedure_id, sessions, price_cents, validity_days")
      .eq("clinic_id", clinicId),
    supabase
      .from("unit")
      .select("id, name, address, phone, active")
      .eq("clinic_id", clinicId)
      .order("name"),
  ]);

  for (const resultado of [
    profissionais,
    jornadas,
    bloqueios,
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

  return {
    profissionais: (profissionais.data ?? []) as Profissional[],
    jornadas: (jornadas.data ?? []) as Jornada[],
    bloqueios: (bloqueios.data ?? []) as Bloqueio[],
    recursos: (recursos.data ?? []) as Recurso[],
    procedimentos: (procedimentos.data ?? []) as Procedimento[],
    convenios: (convenios.data ?? []) as Convenio[],
    vinculos: (vinculos.data ?? []) as Vinculo[],
    pacotes: (pacotes.data ?? []) as Pacote[],
    unidades: (unidades.data ?? []) as Unidade[],
  };
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
