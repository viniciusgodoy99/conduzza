import type { SupabaseClient } from "@supabase/supabase-js";

// Consultas da Tela 7 (Automacoes). A carga das reguas em si reusa
// fetchReguasDaClinica (lib/queries/confirmacoes.ts): mesma forma, mesmo
// cache, e o painel da Tela 2 e esta tela enxergam sempre o mesmo dado.
// Aqui ficam so os numeros da ESTIMATIVA de volume (spec 7.5).

export type VolumesDaEstimativa = {
  /** Consultas marcadas nos ultimos 30 dias com confirmacao ligada. */
  consultas30d: number;
  /** Faltas registradas nos ultimos 30 dias. */
  faltas30d: number;
  /** Preco por mensagem (centavos) da tabela message_pricing; null = sem preco. */
  precoCents: number | null;
};

export const automacoesKeys = {
  volumes: (clinicId: string) => ["automacoes", clinicId, "volumes"] as const,
};

export async function fetchVolumesDaEstimativa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<VolumesDaEstimativa> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [consultas, faltas, preco] = await Promise.all([
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("send_confirmation", true)
      .gte("starts_at", desde30d),
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "faltou")
      .gte("starts_at", desde30d),
    // Tabela global (sem clinic_id), legivel por autenticado; nasce VAZIA
    // porque o preco em BRL e a pendencia P1 e nao se inventa valor.
    supabase
      .from("message_pricing")
      .select("cents")
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    consultas30d: consultas.count ?? 0,
    faltas30d: faltas.count ?? 0,
    precoCents: (preco.data?.cents as number | undefined) ?? null,
  };
}
