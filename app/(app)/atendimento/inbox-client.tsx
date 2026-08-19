"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Plug } from "lucide-react";
import { useMemo, useState } from "react";

import { Composer } from "@/components/atendimento/composer";
import { ContextPanel } from "@/components/atendimento/context-panel";
import { ConversationList } from "@/components/atendimento/conversation-list";
import { Thread } from "@/components/atendimento/thread";
import { EmptyState } from "@/components/shared/empty-state";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  conversationKeys,
  fetchComplianceDecisions,
  fetchConsent,
  fetchConversations,
  fetchMessages,
  type ConversationListItem,
} from "@/lib/queries/conversations";
import { useInboxChannel } from "@/lib/realtime/use-inbox-channel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { markConversationReadAction } from "./actions";

// Tela 1, Atendimento (layout do handoff): lista 322px, fio flexivel,
// contexto 320px (colapsa em overlay abaixo de 1280px; abaixo de 1024px a
// tela alterna entre lista e fio). Leituras do cliente passam pela RLS.

export function InboxClient({
  clinicId,
  viewerId,
  authorNames,
  initialConversations,
  hasWhatsappAccount,
}: {
  clinicId: string;
  viewerId: string;
  authorNames: Record<string, string>;
  initialConversations: ConversationListItem[];
  hasWhatsappAccount: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  useInboxChannel(supabase, clinicId);

  const conversationsQuery = useQuery({
    queryKey: conversationKeys.list(clinicId),
    queryFn: () => fetchConversations(supabase, clinicId),
    initialData: initialConversations,
  });
  const conversations = conversationsQuery.data ?? [];
  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;

  const messagesQuery = useQuery({
    queryKey: conversationKeys.messages(selected?.id ?? "none"),
    queryFn: () => fetchMessages(supabase, selected!.id),
    enabled: selected !== null,
  });
  const decisionsQuery = useQuery({
    queryKey: conversationKeys.decisions(selected?.id ?? "none"),
    queryFn: () => fetchComplianceDecisions(supabase, selected!.id),
    enabled: selected !== null,
  });
  const consentQuery = useQuery({
    queryKey: conversationKeys.consent(selected?.contact.id ?? "none"),
    queryFn: () => fetchConsent(supabase, selected!.contact.id),
    enabled: selected !== null,
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    queryClient.setQueryData<ConversationListItem[]>(
      conversationKeys.list(clinicId),
      (current) =>
        current?.map((conversation) =>
          conversation.id === id
            ? { ...conversation, unread_count: 0 }
            : conversation,
        ),
    );
    void markConversationReadAction(id);
  };

  if (conversations.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        {hasWhatsappAccount ? (
          <EmptyState
            icon={MessagesSquare}
            title="Nenhuma conversa ainda"
            description="Quando um paciente escrever no WhatsApp da clínica, a conversa aparece aqui na hora."
          />
        ) : (
          <EmptyState
            icon={Plug}
            title="Conecte o WhatsApp da clínica"
            description="O Atendimento começa quando o número da clínica estiver conectado."
            action={{ label: "Conectar WhatsApp", href: "/whatsapp" }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={cn(
          "w-full shrink-0 border-r border-border lg:w-[322px]",
          selected ? "hidden lg:block" : "block",
        )}
      >
        <ConversationList
          conversations={conversations}
          viewerId={viewerId}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </aside>

      <section
        className={cn("min-w-0 flex-1", selected ? "block" : "hidden lg:block")}
      >
        {selected ? (
          <Thread
            conversation={selected}
            messages={messagesQuery.data ?? []}
            decisions={decisionsQuery.data ?? []}
            isLoading={messagesQuery.isPending}
            authorNames={authorNames}
            onBack={() => setSelectedId(null)}
            onToggleContext={() => setContextOpen(true)}
            footer={<Composer conversation={selected} viewerId={viewerId} />}
          />
        ) : (
          <div className="grid h-full place-items-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="Escolha uma conversa"
              description="Selecione um atendimento na lista para ver as mensagens."
              className="border-0"
            />
          </div>
        )}
      </section>

      <aside className="hidden w-[320px] shrink-0 border-l border-border xl:block">
        {selected ? (
          <ContextPanel
            contact={selected.contact}
            consent={consentQuery.data ?? null}
          />
        ) : (
          <div className="p-4 text-[12.5px] text-text-tertiary">
            Os dados do contato aparecem aqui.
          </div>
        )}
      </aside>

      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent side="right" className="w-[360px] p-0">
          <SheetTitle className="sr-only">Contexto do contato</SheetTitle>
          {selected ? (
            <ContextPanel
              contact={selected.contact}
              consent={consentQuery.data ?? null}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
