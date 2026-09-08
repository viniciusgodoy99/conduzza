import type { SupabaseClient } from "@supabase/supabase-js";

import type { EtapaDaJornada } from "@/lib/domain/jornada";

// Leitura da jornada da clinica (funnel_stage_def). A RLS recorta por clinica;
// membro le, so admin/gestor escrevem (e a escrita passa pelas Server Actions
// da tela Jornada, nunca por aqui).

export const jornadaKeys = {
  daClinica: (clinicId: string) => ["jornada", clinicId] as const,
};

const JORNADA_SELECT =
  "id, chave, nome, posicao, tom, icone, papel, termos_chave, meta_event_name, conversao_ativa, is_sale, is_first_contact, value_source, value_cents";

export async function fetchJornada(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<EtapaDaJornada[]> {
  const { data, error } = await supabase
    .from("funnel_stage_def")
    .select(JORNADA_SELECT)
    .eq("clinic_id", clinicId)
    .order("posicao", { ascending: true })
    .order("chave", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as EtapaDaJornada[];
}
