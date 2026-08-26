"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  conversationKeys,
  type ConversationListItem,
} from "@/lib/queries/conversations";

// Tempo real do Inbox (tarefa 1.7): postgres_changes em conversation, message
// e whatsapp_account, filtrado por clinica. A RLS aplica POR ASSINANTE nos
// eventos de INSERT/UPDATE (por isso a policy fina do papel profissional vive
// no banco); nao deletamos conversa nem mensagem, entao a limitacao de DELETE
// sem filtro nao nos alcanca.
//
// ESCALA: antes, toda mensagem invalidava a lista INTEIRA de conversas em
// cada aba aberta. Uma clinica movimentada com varios atendentes recarregava
// a lista dezenas de vezes por minuto, o que era a maior conta de banda e a
// maior fonte de travamento. Agora o evento de conversa atualiza SO aquela
// linha na lista (setQueryData), e o evento de mensagem so mexe no fio da
// conversa afetada. A invalidacao completa fica para os casos raros em que a
// linha nova nao esta na lista (conversa nova ou reaberta), que precisam do
// join de contato que o payload do evento nao traz.

type ConversationRow = {
  id: string;
  status: string;
  assignee_user_id: string | null;
  unread_count: number;
  awaiting_reply?: boolean;
  last_message_at: string | null;
  tags: string[] | null;
};

export function useInboxChannel(
  supabase: SupabaseClient,
  clinicId: string,
): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const listKey = conversationKeys.list(clinicId);

    const aplicarConversa = (row: ConversationRow) => {
      const atual =
        queryClient.getQueryData<ConversationListItem[]>(listKey) ?? [];
      const existente = atual.find((c) => c.id === row.id);

      // Conversa que saiu de andamento: remove da lista ativa.
      if (row.status === "resolvida") {
        if (existente) {
          queryClient.setQueryData<ConversationListItem[]>(
            listKey,
            atual.filter((c) => c.id !== row.id),
          );
        }
        return;
      }

      // Linha desconhecida (conversa nova ou reaberta): precisa do join de
      // contato, que o evento nao traz. Invalida uma vez, evento raro.
      if (!existente) {
        void queryClient.invalidateQueries({ queryKey: listKey });
        return;
      }

      // Caso comum: mescla as colunas novas mantendo o contato ja carregado, e
      // reordena por last_message_at desc.
      const atualizada: ConversationListItem = {
        ...existente,
        status: row.status as ConversationListItem["status"],
        assignee_user_id: row.assignee_user_id,
        unread_count: row.unread_count,
        // ?? em vez de atribuicao direta: se o evento vier sem a coluna, o
        // valor que ja esta na tela vale mais do que apagar o sinal de
        // espera e sumir com a conversa do contador.
        awaiting_reply: row.awaiting_reply ?? existente.awaiting_reply,
        last_message_at: row.last_message_at,
        tags: row.tags ?? existente.tags,
      };
      const proxima = atual
        .map((c) => (c.id === row.id ? atualizada : c))
        .sort((a, b) =>
          (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
        );
      queryClient.setQueryData<ConversationListItem[]>(listKey, proxima);
    };

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
        (payload) => {
          const row = payload.new as ConversationRow | null;
          if (row?.id) {
            aplicarConversa(row);
          }
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
          // So o fio da conversa afetada, nunca a lista. A conversa em si vem
          // pelo evento de conversation acima (a ingestao atualiza a linha).
          const conversationId = (
            payload.new as { conversation_id?: string } | null
          )?.conversation_id;
          if (conversationId) {
            void queryClient.invalidateQueries({
              queryKey: conversationKeys.messages(conversationId),
            });
          }
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
