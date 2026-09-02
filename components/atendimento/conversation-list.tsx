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
  onResolvedRequested,
  resolvedLoading = false,
}: {
  conversations: ConversationListItem[];
  viewerId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Resolvidas sao arquivo carregado sob demanda: avisa o container quando o
  // usuario abre ou fecha o filtro de resolvidas.
  onResolvedRequested?: (open: boolean) => void;
  resolvedLoading?: boolean;
}) {
  const [own, setOwn] = useState<OwnFilter>("todas");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const handleStatusFilter = (status: ConversationStatus) => {
    const proximo = statusFilter === status ? null : status;
    setStatusFilter(proximo);
    if (status === "resolvida") {
      onResolvedRequested?.(proximo === "resolvida");
    }
  };

  // "Aguardando você" conta quem ESPERA RESPOSTA, não quem tem o status. A
  // régua abre conversa em aguardando_humano só para enviar a confirmação, e
  // pelo status um disparo de 40 confirmações mostraria "Aguardando você 41"
  // numa manhã em que um paciente só escreveu. Os outros três chips continuam
  // contando por status puro, que é o que eles significam.
  const espera = (c: ConversationListItem) =>
    c.status === "aguardando_humano" ? c.awaiting_reply : true;

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
        conversations.filter((c) => c.status === status && espera(c)).length,
      ]),
    ) as Record<ConversationStatus, number>;
    return { mine, unassigned, all: conversations.length, byStatus };
  }, [conversations, viewerId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    // A mesma chave que o servidor usa no order by e que o cartão exibe como
    // horário. Três lugares, um critério: sem isso a lista chega ordenada de
    // um jeito e é reordenada de outro na tela.
    const recencia = (item: ConversationListItem) => {
      const quando = item.last_inbound_at ?? item.last_message_at;
      return quando ? new Date(quando).getTime() : 0;
    };
    return (
      conversations
        .filter((conversation) => {
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
          // O chip filtra o mesmo conjunto que ele conta: número e lista têm
          // de dizer a mesma coisa.
          if (
            statusFilter &&
            (conversation.status !== statusFilter || !espera(conversation))
          ) {
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
        })
        // ORDEM DE RECEBIMENTO, uma regra só: a fala mais recente do paciente
        // primeiro. Antes a chave primária era o booleano "esperando
        // resposta", o que empilhava a lista em dois blocos e fazia a coluna
        // de horários parecer embaralhada sem motivo visível.
        //
        // O sinal que aquele critério carregava não se perdeu: ele vive no
        // chip "Aguardando você", que é filtro, e é o lugar certo dele. Assim
        // um disparo de 40 confirmações continua não escondendo a conversa em
        // que o paciente escreveu, e quem quer ver só quem espera, filtra.
        .sort((a, b) => recencia(b) - recencia(a))
    );
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
              onClick={() => handleStatusFilter(status)}
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
              {definition.label}{" "}
              {status === "resolvida" && resolvedLoading
                ? "..."
                : counts.byStatus[status]}
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
