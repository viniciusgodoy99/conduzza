import type { SupabaseClient } from "@supabase/supabase-js";

import type { NumeroDoLink, ResumoDoLink } from "@/lib/domain/link-rastreado";
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

/**
 * O resumo dos links rastreados da clinica, por id da origem
 * (resumo_dos_links_rastreados, migration 20261116120000: membro ativo le; so
 * agregados, nunca o clique nem o contato). Nulo quando a leitura falha: a
 * aba mostra os links sem a contagem.
 */
export async function fetchResumoDosLinks(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, ResumoDoLink> | null> {
  const { data, error } = await supabase.rpc("resumo_dos_links_rastreados", {
    p_clinic_id: clinicId,
  });
  if (error || !Array.isArray(data)) {
    return null;
  }
  const resumo: Record<string, ResumoDoLink> = {};
  for (const linha of data as {
    campaign_link_id: string;
    cliques: number | string;
    leads: number | string;
  }[]) {
    resumo[linha.campaign_link_id] = {
      cliques: Number(linha.cliques) || 0,
      leads: Number(linha.leads) || 0,
    };
  }
  return resumo;
}

/**
 * Os numeros escolhidos para o link de cada origem da clinica
 * (campaign_link_numero, migration 20261116130000: membro ativo le), por id
 * da origem. Origem sem linha usa o numero principal. Nulo quando a leitura
 * falha: a aba diz que nao carregou.
 */
export async function fetchNumerosDosLinks(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, NumeroDoLink[]> | null> {
  const { data, error } = await supabase
    .from("campaign_link_numero")
    .select("campaign_link_id, whatsapp_account_id, peso")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });
  if (error) {
    return null;
  }
  const porOrigem: Record<string, NumeroDoLink[]> = {};
  for (const linha of (data ?? []) as {
    campaign_link_id: string;
    whatsapp_account_id: string;
    peso: number;
  }[]) {
    (porOrigem[linha.campaign_link_id] ??= []).push({
      id: linha.whatsapp_account_id,
      peso: linha.peso,
    });
  }
  return porOrigem;
}
