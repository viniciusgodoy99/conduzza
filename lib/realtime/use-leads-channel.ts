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

type ContactRow = {
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
  first_contact_at: string;
  last_contact_at: string | null;
};

export function useLeadsChannel(
  supabase: SupabaseClient,
  clinicId: string,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const chave = leadsKeys.lista(clinicId);

    const reordenar = (lista: LeadResumo[]): LeadResumo[] =>
      [...lista].sort(compararPorProximaAcao);

    const mesclar = async (row: ContactRow) => {
      const dados = queryClient.getQueryData<LeadResumo[]>(chave);
      if (!dados) {
        return;
      }
      const existente = dados.find((lead) => lead.id === row.id);
      if (existente) {
        // Caso comum: mescla as colunas mutaveis preservando o convenio e o
        // consentimento embutidos (o payload do contact nao os traz).
        const atualizado: LeadResumo = {
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
          last_contact_at: row.last_contact_at,
        };
        queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
          atual
            ? reordenar([
                ...atual.filter((lead) => lead.id !== row.id),
                atualizado,
              ])
            : atual,
        );
        // Drawer aberto acompanha a mudanca.
        void queryClient.invalidateQueries({
          queryKey: leadsKeys.detalhe(row.id),
        });
        return;
      }
      // Linha nova: o payload nao traz os embeds; busca SO ela.
      const completo = await fetchLead(supabase, row.id);
      if (completo) {
        queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
          atual
            ? reordenar([
                ...atual.filter((lead) => lead.id !== row.id),
                completo,
              ])
            : atual,
        );
      } else {
        void queryClient.invalidateQueries({ queryKey: chave });
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
