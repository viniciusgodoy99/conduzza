"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { conversationKeys } from "@/lib/queries/conversations";

// Tempo real do Inbox (tarefa 1.7): postgres_changes em conversation, message
// e whatsapp_account, filtrado por clinica. A RLS aplica POR ASSINANTE nos
// eventos de INSERT/UPDATE (por isso a policy fina do papel profissional vive
// no banco); nao deletamos conversa nem mensagem, entao a limitacao de DELETE
// sem filtro nao nos alcanca.

export function useInboxChannel(
  supabase: SupabaseClient,
  clinicId: string,
): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const channel = supabase
      .channel(`inbox:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: conversationKeys.list(clinicId),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const conversationId = (
            payload.new as { conversation_id?: string } | null
          )?.conversation_id;
          if (conversationId) {
            void queryClient.invalidateQueries({
              queryKey: conversationKeys.messages(conversationId),
            });
          }
          void queryClient.invalidateQueries({
            queryKey: conversationKeys.list(clinicId),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "whatsapp_account",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          // A faixa de desconectado e renderizada no servidor: recarrega o
          // layout para ela aparecer ou sumir na hora.
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, queryClient, router]);
}
