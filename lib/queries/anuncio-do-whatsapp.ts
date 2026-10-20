import type { SupabaseClient } from "@supabase/supabase-js";

import {
  idDoAnuncioDoWhatsapp,
  LEITURA_SEM_DETALHES,
  type DetalhesDoAnuncio,
  type LeituraDosDetalhes,
} from "@/lib/domain/anuncio-do-whatsapp";

// Leitura dos detalhes do anuncio de clique para WhatsApp (titulo, descricao
// e link guardados pela ingestao em anuncio_do_whatsapp, migration
// 20261020100000). Isomorfica como leads.ts: o painel do Atendimento le pelo
// navegador; a ficha e a gaveta de Leads, no servidor. Sempre pela sessao: a
// RLS so deixa o membro ATIVO ler a propria clinica. Nao e dado de paciente
// (e o texto do anuncio da clinica), entao a leitura nao grava trilha; a
// ligacao do contato com o anuncio ja veio na leitura do contato.

/** Chave do TanStack Query dos detalhes de UM anuncio (painel do Atendimento). */
export const detalhesDoAnuncioKeys = {
  doAnuncio: (clinicId: string, adId: string) =>
    ["anuncio-do-whatsapp", clinicId, adId] as const,
};

const DETALHES_SELECT = "ad_id, titulo, descricao, link";

// Lote de ids por consulta, o mesmo de fetchAnunciosDaMeta.
const ANUNCIOS_POR_CONSULTA = 100;

function normalizarDetalhes(row: Record<string, unknown>): DetalhesDoAnuncio {
  return {
    ad_id: row.ad_id as string,
    titulo: (row.titulo as string | null) ?? null,
    descricao: (row.descricao as string | null) ?? null,
    link: (row.link as string | null) ?? null,
  };
}

/**
 * Os detalhes guardados dos anuncios pedidos, da clinica pedida (o mesmo
 * anuncio pode estar em duas clinicas da mesma pessoa). Id fora do formato
 * nunca vai na consulta. LANCA em erro.
 */
export async function fetchDetalhesDosAnuncios(
  supabase: SupabaseClient,
  clinicId: string,
  adIds: readonly (string | null | undefined)[],
): Promise<Map<string, DetalhesDoAnuncio>> {
  const validos = [
    ...new Set(
      adIds
        .map((adId) => idDoAnuncioDoWhatsapp(adId))
        .filter((adId): adId is string => adId !== null),
    ),
  ];
  const mapa = new Map<string, DetalhesDoAnuncio>();
  for (let i = 0; i < validos.length; i += ANUNCIOS_POR_CONSULTA) {
    const lote = validos.slice(i, i + ANUNCIOS_POR_CONSULTA);
    const { data, error } = await supabase
      .from("anuncio_do_whatsapp")
      .select(DETALHES_SELECT)
      .eq("clinic_id", clinicId)
      .in("ad_id", lote);
    if (error) {
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const detalhes = normalizarDetalhes(row);
      mapa.set(detalhes.ad_id, detalhes);
    }
  }
  return mapa;
}

/**
 * A leitura dos detalhes do anuncio de UM contato, que nunca lanca: sem id
 * valido e "lida" sem detalhes (nem consulta); falha da consulta e "erro"
 * (o bloco "Detalhes do anúncio" mostra so ali, nunca derruba a tela).
 */
export async function lerDetalhesDoAnuncio(
  supabase: SupabaseClient,
  clinicId: string,
  adId: string | null | undefined,
): Promise<LeituraDosDetalhes> {
  const valido = idDoAnuncioDoWhatsapp(adId);
  if (!valido) {
    return LEITURA_SEM_DETALHES;
  }
  try {
    const mapa = await fetchDetalhesDosAnuncios(supabase, clinicId, [valido]);
    return { estado: "lida", detalhes: mapa.get(valido) ?? null };
  } catch {
    return { estado: "erro" };
  }
}
