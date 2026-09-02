"use client";

import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sparkles } from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { StatusChip } from "@/components/shared/status-chip";
import { CONVERSATION_STATUS } from "@/lib/design/status";
import type { ConversationListItem } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Cartao de conversa da lista (handoff): ponto de nao lida 7px, avatar 38,
// nome 13.5, previa truncada, hora mono 11px, chip de estado e responsavel.

function timeLabel(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return isToday(date)
    ? format(date, "HH:mm", { locale: ptBR })
    : format(date, "dd/MM", { locale: ptBR });
}

export function ConversationCard({
  conversation,
  preview,
  selected,
  isMine,
  onSelect,
}: {
  conversation: ConversationListItem;
  preview: string;
  selected: boolean;
  isMine: boolean;
  onSelect: () => void;
}) {
  const definition = CONVERSATION_STATUS[conversation.status];
  const unread = conversation.unread_count > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        selected ? "bg-surface-4" : "hover:bg-surface-3",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary"
        />
      ) : null}
      <span className="relative">
        {unread ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -left-0.5 size-[7px] rounded-full bg-alert"
          />
        ) : null}
        <ContactAvatar
          name={conversation.contact.name}
          phone={conversation.contact.phone_e164}
        />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span
          className={cn(
            "truncate text-[13.5px]",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {conversation.contact.name ?? conversation.contact.phone_e164}
        </span>
        <span className="truncate text-[12.5px] text-text-tertiary">
          {preview}
        </span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className="font-mono text-[11px] text-text-tertiary tabular-nums">
          {/* A hora exibida e a MESMA que ordena a lista. Mostrar a atividade
              e ordenar pelo recebimento faria a coluna parecer embaralhada. */}
          {timeLabel(
            conversation.last_inbound_at ?? conversation.last_message_at,
          )}
        </span>
        <span className="flex items-center gap-1">
          <StatusChip
            definition={definition}
            label={
              conversation.status === "em_atendimento"
                ? isMine
                  ? "Você"
                  : "Em atendimento"
                : undefined
            }
            avatarInitials={isMine ? "EU" : "AT"}
            className="h-[22px] px-2 text-[11px]"
          />
          {conversation.status === "ia_atendendo" ? (
            <span
              aria-hidden
              className="flex size-[22px] items-center justify-center rounded-full [color:var(--ai-text)] [background:var(--ai-bg)]"
            >
              <Sparkles strokeWidth={1.5} className="size-3" />
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
