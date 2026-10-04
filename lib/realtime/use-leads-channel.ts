"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { compararPorProximaAcao } from "@/lib/domain/leads-ui";
import { fetchLead, leadsKeys, type LeadResumo } from "@/lib/queries/leads";

// Tempo real da Tela 4: canal por clinica em contact, filtrado por
// clinic_id, mesma licao de escala da Agenda e do Inbox: mesclar a LINHA
// afetada com setQueryData, invalidar a chave inteira so no caso raro de
// falha ao buscar a linha nova.
//
// SEM assinatura de DELETE: o filtro de coluna nao vale para DELETE no
// Supabase e vazaria evento entre clinicas. Contato nao some da lista por
// tempo real; remocao fisica e caso raro e a proxima carga resolve.
//
// Anuncio da Meta (origem real do anuncio, 04/10/2026): a campanha e o
// conjunto vem de meta_anuncio, que o payload do contact nao traz. Quando o
// source_ad_id muda (primeiro clique de um contato que ja existia), a linha
// e buscada de novo inteira, com a leitura do anuncio; nas outras mudancas a
// leitura ja feita e preservada.

export type ContactRow = {
  id: string;
  name: string | null;
  phone_e164: string;
  funnel_stage: LeadResumo["funnel_stage"];
  lost_reason: string | null;
  lost_reason_note: string | null;
  owner_user_id: string | null;
  tags: string[] | null;
  source_channel: string | null;
  source_campaign: string | null;
  // Opcionais: coluna fora do payload (privilegio de coluna) vira null.
  source_origin?: string | null;
  source_medium?: string | null;
  source_method?: string | null;
  source_ad_id?: string | null;
  source_google_campaign_id?: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
};

/**
 * Caso comum do tempo real (mesmo anuncio da Meta): as colunas mutaveis da
 * linha nova sobre o lead da lista, preservando o convenio, o consentimento
 * e a leitura do anuncio (o payload do contact nao os traz). Pura, para o
 * teste.
 */
export function mesclarLinhaNoLead(
  existente: LeadResumo,
  row: ContactRow,
): LeadResumo {
  return {
    ...existente,
    name: row.name,
    phone_e164: row.phone_e164,
    funnel_stage: row.funnel_stage,
    lost_reason: row.lost_reason,
    lost_reason_note: row.lost_reason_note,
    owner_user_id: row.owner_user_id,
    tags: row.tags ?? [],
    source_channel: row.source_channel,
    source_campaign: row.source_campaign,
    source_origin: row.source_origin ?? null,
    source_medium: row.source_medium ?? null,
    source_method: row.source_method ?? null,
    // Clique no site: casar_clique_do_site grava a origem por UPDATE num
    // contato que ja existe, com source_ad_id nulo igual ao de antes (cai
    // aqui). Sem esta linha a lista aberta ficaria em "Campanha do Google
    // não informada" ate recarregar.
    source_google_campaign_id: row.source_google_campaign_id ?? null,
    last_contact_at: row.last_contact_at,
  };
}

export function useLeadsChannel(
  supabase: SupabaseClient,
  clinicId: string,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const chave = leadsKeys.lista(clinicId);

    const reordenar = (lista: LeadResumo[]): LeadResumo[] =>
      [...lista].sort(compararPorProximaAcao);

    const substituir = (completo: LeadResumo) => {
      queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
        atual
          ? reordenar([
              ...atual.filter((lead) => lead.id !== completo.id),
              completo,
            ])
          : atual,
      );
    };

    const mesclar = async (row: ContactRow) => {
      const dados = queryClient.getQueryData<LeadResumo[]>(chave);
      if (!dados) {
        return;
      }
      const existente = dados.find((lead) => lead.id === row.id);
      const adIdNovo = row.source_ad_id ?? null;
      if (existente && existente.source_ad_id === adIdNovo) {
        // Caso comum: mescla as colunas mutaveis preservando o convenio e o
        // consentimento embutidos (o payload do contact nao os traz).
        substituir(mesclarLinhaNoLead(existente, row));
        // Drawer aberto acompanha a mudanca.
        void queryClient.invalidateQueries({
          queryKey: leadsKeys.detalhe(row.id),
        });
        return;
      }
      // Linha nova (o payload nao traz os embeds) ou anuncio novo (a
      // campanha precisa ser lida de novo): busca SO ela.
      const completo = await fetchLead(supabase, clinicId, row.id);
      if (completo) {
        substituir(completo);
      } else {
        void queryClient.invalidateQueries({ queryKey: chave });
      }
      if (existente) {
        void queryClient.invalidateQueries({
          queryKey: leadsKeys.detalhe(row.id),
        });
      }
    };

    const aoReceber = (payload: { new: unknown }) => {
      const row = payload.new as ContactRow | null;
      if (row?.id) {
        void mesclar(row);
      }
    };

    const channel = supabase
      .channel(`leads:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "contact",
          filter: `clinic_id=eq.${clinicId}`,
        },
        aoReceber,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contact",
          filter: `clinic_id=eq.${clinicId}`,
        },
        aoReceber,
      )
      .subscribe((status) => {
        // Catch-up: contato criado entre a busca do servidor e o canal ficar
        // de pe (ou durante uma queda) nao gerou evento para esta aba.
        if (status === "SUBSCRIBED") {
          void queryClient.invalidateQueries({
            queryKey: leadsKeys.lista(clinicId),
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, queryClient]);
}
