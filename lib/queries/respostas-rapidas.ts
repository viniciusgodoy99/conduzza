import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RESPOSTA_RAPIDA_SELECT,
  type RespostaRapida,
} from "@/lib/domain/respostas-rapidas";

// Leitura das mensagens padrao da clinica (resposta_rapida). A RLS recorta
// por clinica: membro ATIVO le (pendente nao), so admin e gestor escrevem, e
// a escrita passa pelas Server Actions da aba de Configuracoes, nunca por
// aqui. E texto da clinica, sem dado de paciente: nao entra na trilha de
// leitura.

export const respostasKeys = {
  /** Todas, ativas e desativadas: a aba de Configuracoes. */
  daClinica: (clinicId: string) => ["respostas-rapidas", clinicId] as const,
  /** So as ativas, na ordem: a lista do "/" no compositor. */
  ativas: (clinicId: string) =>
    ["respostas-rapidas", clinicId, "ativas"] as const,
};

export async function fetchRespostasRapidas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<RespostaRapida[]> {
  const { data, error } = await supabase
    .from("resposta_rapida")
    .select(RESPOSTA_RAPIDA_SELECT)
    .eq("clinic_id", clinicId)
    .order("posicao", { ascending: true })
    .order("titulo", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as RespostaRapida[];
}

export async function fetchRespostasAtivas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<RespostaRapida[]> {
  const { data, error } = await supabase
    .from("resposta_rapida")
    .select(RESPOSTA_RAPIDA_SELECT)
    .eq("clinic_id", clinicId)
    .eq("ativo", true)
    .order("posicao", { ascending: true })
    .order("titulo", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as RespostaRapida[];
}
