"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ConversationCard } from "@/components/atendimento/conversation-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import {
  CONVERSATION_STATUS,
  STATUS_TONE_VARS,
  type ConversationStatus,
} from "@/lib/design/status";
import type { ConversationListItem } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Lista de conversas (handoff): segmentador de posse no topo, chips de status
// com contadores, busca, cartoes. Busca client-side no V1 (TODO: busca no
// servidor quando houver paginacao).

type OwnFilter = "minhas" | "sem_atendente" | "todas";

const STATUS_ORDER: ConversationStatus[] = [
  "ia_atendendo",
  "aguardando_humano",
  "em_atendimento",
  "resolvida",
];

export function ConversationList({
  conversations,
  viewerId,
  selectedId,
  onSelect,
}: {
  conversations: ConversationListItem[];
  viewerId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [own, setOwn] = useState<OwnFilter>("todas");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const mine = conversations.filter(
      (c) => c.assignee_user_id === viewerId,
    ).length;
    const unassigned = conversations.filter(
      (c) => c.assignee_user_id === null && c.status !== "resolvida",
    ).length;
    const byStatus = Object.fromEntries(
      STATUS_ORDER.map((status) => [
        status,
        conversations.filter((c) => c.status === status).length,
      ]),
    ) as Record<ConversationStatus, number>;
    return { mine, unassigned, all: conversations.length, byStatus };
  }, [conversations, viewerId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (own === "minhas" && conversation.assignee_user_id !== viewerId) {
        return false;
      }
      if (
        own === "sem_atendente" &&
        (conversation.assignee_user_id !== null ||
          conversation.status === "resolvida")
      ) {
        return false;
      }
      if (statusFilter && conversation.status !== statusFilter) {
        return false;
      }
      if (term) {
        const haystack =
          `${conversation.contact.name ?? ""} ${conversation.contact.phone_e164}`.toLowerCase();
        if (!haystack.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [conversations, own, statusFilter, search, viewerId]);

  const hasActiveFilter =
    own !== "todas" || statusFilter !== null || search !== "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="grid grid-cols-3 rounded-lg bg-surface-3 p-0.5 text-[12.5px] font-medium">
        {(
          [
            ["minhas", `Minhas ${counts.mine}`],
            ["sem_atendente", `Sem atendente ${counts.unassigned}`],
            ["todas", `Todas ${counts.all}`],
          ] as [OwnFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOwn(value)}
            className={cn(
              "h-[30px] rounded-md transition-colors",
              own === value
                ? "bg-surface-5 text-foreground"
                : "text-text-secondary hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((status) => {
          const definition = CONVERSATION_STATUS[status];
          const tone = STATUS_TONE_VARS[definition.tone];
          const active = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(active ? null : status)}
              aria-pressed={active}
              className={cn(
                "h-7 rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors",
                active ? "border-transparent" : "border-border-strong bg-card",
              )}
              style={
                active
                  ? { color: tone.text, backgroundColor: tone.bg }
                  : { color: tone.text }
              }
            >
              {definition.label} {counts.byStatus[status]}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search
          strokeWidth={1.5}
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-tertiary"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="pl-8"
          aria-label="Buscar conversa"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title={
              hasActiveFilter
                ? "Nenhuma conversa com esses filtros"
                : "Nenhuma conversa ainda"
            }
            description={
              hasActiveFilter
                ? "Ajuste os filtros ou limpe tudo."
                : "Quando um paciente escrever no WhatsApp, a conversa aparece aqui."
            }
            onClearFilters={
              hasActiveFilter
                ? () => {
                    setOwn("todas");
                    setStatusFilter(null);
                    setSearch("");
                  }
                : undefined
            }
            className="border-0"
          />
        ) : (
          <div className="grid gap-1">
            {filtered.map((conversation) => (
              <ConversationCard
                key={conversation.id}
                conversation={conversation}
                preview={previewOf(conversation)}
                selected={conversation.id === selectedId}
                isMine={conversation.assignee_user_id === viewerId}
                onSelect={() => onSelect(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function previewOf(conversation: ConversationListItem): string {
  const stage: Record<string, string> = {
    novo: "Novo contato",
    em_contato: "Em contato",
    aguardando_resposta: "Aguardando resposta",
    agendou: "Agendou",
    compareceu: "Paciente da casa",
    perdido: "Perdido",
  };
  return `${conversation.contact.kind === "paciente" ? "Paciente" : "Lead"} · ${stage[conversation.contact.funnel_stage] ?? conversation.contact.funnel_stage}`;
}
