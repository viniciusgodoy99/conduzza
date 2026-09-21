import type { SupabaseClient } from "@supabase/supabase-js";

import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";

// Leitura do catalogo de etiquetas de conversa. A RLS recorta por clinica;
// membro le, so admin/gestor escrevem (e a escrita passa pelas Server
// Actions da aba de Configuracoes, nunca por aqui).

export const etiquetasKeys = {
  daClinica: (clinicId: string) => ["etiquetas-de-conversa", clinicId] as const,
  contagem: (clinicId: string) =>
    ["etiquetas-de-conversa", clinicId, "contagem"] as const,
};

export async function fetchEtiquetasDeConversa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<EtiquetaDeConversa[]> {
  const { data, error } = await supabase
    .from("conversation_tag_def")
    .select("id, chave, nome, tom")
    .eq("clinic_id", clinicId)
    .order("nome", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as EtiquetaDeConversa[];
}

/** Quantas conversas usam cada etiqueta: alimenta a tela de gestao e o
 *  numero do dialogo de exclusao. */
export async function fetchContagemDeEtiquetas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc(
    "contagem_de_etiquetas_de_conversa",
    { p_clinic_id: clinicId },
  );
  if (error) {
    throw new Error(error.message);
  }
  const contagem: Record<string, number> = {};
  for (const linha of (data ?? []) as { chave: string; total: number }[]) {
    contagem[linha.chave] = Number(linha.total);
  }
  return contagem;
}
