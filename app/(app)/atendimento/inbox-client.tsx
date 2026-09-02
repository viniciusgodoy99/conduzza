"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  fetchMessagesPage,
  fetchResolvedConversations,
  type ConversationListItem,
  type MessageItem,
} from "@/lib/queries/conversations";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
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
  const [showResolved, setShowResolved] = useState(false);

  useInboxChannel(supabase, clinicId);

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(conversationKeys.list(clinicId), initialConversations);

  const conversationsQuery = useQuery({
    queryKey: conversationKeys.list(clinicId),
    queryFn: () => fetchConversations(supabase, clinicId),
    initialData: initialConversations,
    // O canal Realtime mantem a lista viva; o refetch por foco so duplicava
    // a carga a cada volta do WhatsApp Web.
    refetchOnWindowFocus: false,
  });
  const activeConversations = useMemo(
    () => conversationsQuery.data ?? [],
    [conversationsQuery.data],
  );

  // Resolvidas sao arquivo: so buscadas quando o usuario abre o filtro, e nao
  // entram na lista mantida pelo tempo real.
  const resolvedQuery = useQuery({
    queryKey: [...conversationKeys.list(clinicId), "resolved"] as const,
    queryFn: () => fetchResolvedConversations(supabase, clinicId),
    enabled: showResolved,
  });
  const conversations = useMemo(() => {
    if (!showResolved) {
      return activeConversations;
    }
    return [...activeConversations, ...(resolvedQuery.data ?? [])];
  }, [activeConversations, resolvedQuery.data, showResolved]);

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;

  const messagesQuery = useInfiniteQuery({
    queryKey: conversationKeys.messages(selected?.id ?? "none"),
    queryFn: ({ pageParam }) =>
      fetchMessagesPage(supabase, selected!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: selected !== null,
    // Mensagem nova chega pelo canal (que invalida o fio); o refetch por foco
    // refazia todas as paginas carregadas sem necessidade.
    refetchOnWindowFocus: false,
  });

  // Paginas vem do mais novo para o mais antigo; para exibir em ordem
  // cronologica, inverte a ordem das paginas e achata, deduplicando por id
  // (a borda entre paginas pode repetir uma mensagem em caso raro de empate
  // de timestamp).
  const messages = useMemo<MessageItem[]>(() => {
    const paginas = messagesQuery.data?.pages ?? [];
    const vistos = new Set<string>();
    const resultado: MessageItem[] = [];
    for (const pagina of [...paginas].reverse()) {
      for (const mensagem of pagina.items) {
        if (!vistos.has(mensagem.id)) {
          vistos.add(mensagem.id);
          resultado.push(mensagem);
        }
      }
    }
    return resultado;
  }, [messagesQuery.data]);
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

  if (activeConversations.length === 0) {
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
            action={{
              label: "Conectar WhatsApp",
              href: "/configuracoes?aba=whatsapp",
            }}
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
          onResolvedRequested={setShowResolved}
          resolvedLoading={resolvedQuery.isFetching}
        />
      </aside>

      <section
        className={cn("min-w-0 flex-1", selected ? "block" : "hidden lg:block")}
      >
        {selected ? (
          <Thread
            conversation={selected}
            messages={messages}
            decisions={decisionsQuery.data ?? []}
            isLoading={messagesQuery.isPending}
            hasOlder={messagesQuery.hasNextPage}
            loadingOlder={messagesQuery.isFetchingNextPage}
            onLoadOlder={() => void messagesQuery.fetchNextPage()}
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
