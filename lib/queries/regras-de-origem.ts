import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REGRA_DE_ORIGEM_SELECT,
  regraDaLinha,
  type LinhaDaRegraDeOrigem,
  type RegraDeOrigem,
} from "@/lib/domain/regras-de-origem";

// Leitura das origens dos leads da clinica (campaign_link, onda 5, item 17)
// pela SESSAO: a RLS recorta por clinica (membro ativo le; administrador e
// gestor escrevem, pelas Server Actions de
// app/(app)/configuracoes/regras-de-origem-actions.ts). Todas, ativas e
// desativadas, na ordem de criacao, que e a ordem de desempate da ingestao.
// E configuracao da clinica, sem dado de paciente: nao entra na trilha de
// leitura.
//
// Os numeros do link para a bio NAO sao lidos aqui: a pagina de
// Configuracoes ja le os numeros ativos da clinica (whatsapp_account sem
// removidos, o principal primeiro) para a aba WhatsApp, e a aba de origens
// usa a mesma leitura (numerosParaOLink).

export async function fetchRegrasDeOrigem(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<RegraDeOrigem[]> {
  const { data, error } = await supabase
    .from("campaign_link")
    .select(REGRA_DE_ORIGEM_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as LinhaDaRegraDeOrigem[]).map(regraDaLinha);
}
