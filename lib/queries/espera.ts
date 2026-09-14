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

export type MetricasDaEspera = {
  /** Horarios preenchidos pela reoferta nos ultimos 30 dias. */
  recuperados30d: number;
  /** Soma do preco dos vinculos das consultas recuperadas (centavos). */
  receitaCents: number;
  /** Media entre a vaga abrir (primeira onda) e alguem ficar com ela. */
  tempoMedioMin: number | null;
};

export type ConfigDaEspera = {
  waveSize: number;
  responseMinutes: number;
};

export const esperaKeys = {
  fila: (clinicId: string) => ["espera", clinicId, "fila"] as const,
  oferta: (clinicId: string) => ["espera", clinicId, "oferta"] as const,
  metricas: (clinicId: string) => ["espera", clinicId, "metricas"] as const,
};

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

export async function fetchOfertaEmAndamento(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<OfertaEmAndamento | null> {
  const { data, error } = await supabase
    .from("waitlist_offer")
    .select(
      "id, slot_starts_at, expires_at, offered_to, declined_by, professional:professional_id ( name )",
    )
    .eq("clinic_id", clinicId)
    .eq("status", "aberta")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  const offeredTo = (data.offered_to as string[]) ?? [];
  const declinedBy = new Set((data.declined_by as string[]) ?? []);
  const { data: contatos } = await supabase
    .from("contact")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .in("id", offeredTo);
  const nomePorContato = new Map(
    ((contatos ?? []) as { id: string; name: string | null }[]).map(
      (linha) => [linha.id, linha.name],
    ),
  );
  const profissional = primeiro(
    data.professional as { name: string } | { name: string }[] | null,
  );
  return {
    id: data.id as string,
    slot_starts_at: data.slot_starts_at as string,
    expires_at: data.expires_at as string,
    professional_nome: profissional?.name ?? null,
    destinatarios: offeredTo.map((contactId) => ({
      contactId,
      nome: nomePorContato.get(contactId) ?? null,
      situacao: declinedBy.has(contactId) ? "recusou" : "aguardando",
    })),
  };
}

export async function fetchMetricasDaEspera(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<MetricasDaEspera> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("waitlist_offer")
    .select(
      "source_appointment_id, responded_at, appointment:appointment_id ( service_link:service_link_id ( price_cents ) )",
    )
    .eq("clinic_id", clinicId)
    .eq("status", "preenchida")
    .gte("responded_at", desde30d)
    .limit(500);
  if (error) {
    throw new Error(error.message);
  }
  const preenchidas = (data ?? []) as Record<string, unknown>[];
  if (preenchidas.length === 0) {
    return { recuperados30d: 0, receitaCents: 0, tempoMedioMin: null };
  }

  let receita = 0;
  for (const linha of preenchidas) {
    const appointment = primeiro(
      linha.appointment as Record<string, unknown> | Record<string, unknown>[],
    );
    const vinculo = appointment
      ? primeiro(
          appointment.service_link as
            | { price_cents: number | null }
            | { price_cents: number | null }[]
            | null,
        )
      : null;
    receita += vinculo?.price_cents ?? 0;
  }

  // Tempo ate preencher = respondido menos a PRIMEIRA onda do mesmo horario
  // (a vaga pode ter passado por varias ondas antes de alguem ficar).
  const origens = [
    ...new Set(
      preenchidas.map((linha) => linha.source_appointment_id as string),
    ),
  ];
  const { data: ondas } = await supabase
    .from("waitlist_offer")
    .select("source_appointment_id, created_at")
    .eq("clinic_id", clinicId)
    .in("source_appointment_id", origens);
  const primeiraOnda = new Map<string, number>();
  for (const linha of (ondas ?? []) as {
    source_appointment_id: string;
    created_at: string;
  }[]) {
    const atual = primeiraOnda.get(linha.source_appointment_id);
    const instante = new Date(linha.created_at).getTime();
    if (atual === undefined || instante < atual) {
      primeiraOnda.set(linha.source_appointment_id, instante);
    }
  }
  let somaMin = 0;
  let contadas = 0;
  for (const linha of preenchidas) {
    const inicio = primeiraOnda.get(linha.source_appointment_id as string);
    const fim = linha.responded_at
      ? new Date(linha.responded_at as string).getTime()
      : null;
    if (inicio !== undefined && fim !== null && fim >= inicio) {
      somaMin += (fim - inicio) / 60_000;
      contadas += 1;
    }
  }
  return {
    recuperados30d: preenchidas.length,
    receitaCents: receita,
    tempoMedioMin: contadas > 0 ? Math.round(somaMin / contadas) : null,
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
