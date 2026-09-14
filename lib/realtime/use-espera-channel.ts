"use client";

import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";

import { esperaKeys } from "@/lib/queries/espera";

// Tempo real da Tela 10: INSERT e UPDATE de waitlist e waitlist_offer com
// filtro por clinica. SEM assinatura de DELETE, de proposito: nada aqui e
// deletado (sair da fila e active=false) e evento DELETE nao aceita filtro
// de coluna no Supabase, vazaria evento entre clinicas (a licao documentada
// do use-agenda-channel). A fila e pequena: invalidar a chave inteira basta.

export function useEsperaChannel(
  supabase: SupabaseClient,
  queryClient: QueryClient,
  clinicId: string,
): void {
  useEffect(() => {
    const invalidar = () => {
      void queryClient.invalidateQueries({ queryKey: esperaKeys.fila(clinicId) });
      void queryClient.invalidateQueries({
        queryKey: esperaKeys.oferta(clinicId),
      });
      void queryClient.invalidateQueries({
        queryKey: esperaKeys.metricas(clinicId),
      });
    };
    const canal = supabase
      .channel(`espera:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "waitlist",
          filter: `clinic_id=eq.${clinicId}`,
        },
        invalidar,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "waitlist",
          filter: `clinic_id=eq.${clinicId}`,
        },
        invalidar,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "waitlist_offer",
          filter: `clinic_id=eq.${clinicId}`,
        },
        invalidar,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "waitlist_offer",
          filter: `clinic_id=eq.${clinicId}`,
        },
        invalidar,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          invalidar();
        }
      });
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [supabase, queryClient, clinicId]);
}
