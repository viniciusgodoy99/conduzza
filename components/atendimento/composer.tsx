"use client";

import type { ConversationListItem } from "@/lib/queries/conversations";

// Compositor da conversa. Implementacao completa na tarefa 1.6 (estados de
// posse, nota interna e envio); por ora, um marcador honesto do estado.
export function Composer({
  conversation,
}: {
  conversation: ConversationListItem;
  viewerId: string;
}) {
  return (
    <div className="px-4 py-3 text-[12.5px] text-text-tertiary">
      Compositor em construção (conversa {conversation.status.replace("_", " ")}
      ).
    </div>
  );
}
