"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MessagesSquare, Plug } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Composer, type Mode } from "@/components/atendimento/composer";
import { ContextPanel } from "@/components/atendimento/context-panel";
import { ConversationList } from "@/components/atendimento/conversation-list";
import { DialogoApagar } from "@/components/atendimento/dialogo-apagar";
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
import { canEdit, type Role } from "@/lib/domain/permissions";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { useInboxChannel } from "@/lib/realtime/use-inbox-channel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { apagarMensagemAction, markConversationReadAction } from "./actions";

// Tela 1, Atendimento (layout do handoff): lista 322px, fio flexivel,
// contexto 320px (colapsa em overlay abaixo de 1280px; abaixo de 1024px a
// tela alterna entre lista e fio). Leituras do cliente passam pela RLS.

export function InboxClient({
  clinicId,
  viewerId,
  viewerRole,
  authorNames,
  initialConversations,
  hasWhatsappAccount,
}: {
  clinicId: string;
  viewerId: string;
  viewerRole: Role;
  authorNames: Record<string, string>;
  initialConversations: ConversationListItem[];
  hasWhatsappAccount: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  // Mensagem que está sendo respondida, e mensagem que está sendo apagada.
  // Moram AQUI, e não no compositor ou na bolha, porque a ação nasce numa
  // bolha e é consumida pelo compositor: são dois filhos irmãos.
  const [citando, setCitando] = useState<MessageItem | null>(null);
  // Para quem o texto do compositor vai. Mora AQUI, junto da citação, porque
  // os dois precisam concordar sempre: escolher uma citação escolhe o plano,
  // no mesmo gesto. Ver a explicação longa na prop `modo` do Composer.
  const [modo, setModo] = useState<Mode>("responder");
  const [apagando, setApagando] = useState<MessageItem | null>(null);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const [apagandoPendente, startApagar] = useTransition();

  const podeEditar = canEdit(viewerRole, "atendimento");
  const ehChefia = viewerRole === "admin" || viewerRole === "gestor";

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
    // Pela MESMA razão que o compositor é recriado com key: a citação carrega
    // um trecho da mensagem de um paciente, e ela não pode aparecer na tela de
    // outro. A Server Action recusaria o envio, mas a prévia já teria sido
    // mostrada na conversa errada.
    setCitando(null);
    setModo("responder");
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

  // A citação guardada é um RETRATO do momento do clique. Se a mensagem citada
  // for apagada por outra pessoa (ou pelo paciente) enquanto ela está pendurada
  // no compositor, o retrato continuaria exibindo o texto que acabou de sair da
  // conversa. Reconciliar com a página carregada faz a prévia virar "Mensagem
  // apagada" junto com a bolha, e o envio é recusado pelo servidor com motivo.
  const citandoVivo = citando
    ? (messages.find((m) => m.id === citando.id) ?? citando)
    : null;

  const confirmarApagar = (escopo: "todos" | "local") => {
    const alvo = apagando;
    if (!alvo) {
      return;
    }
    setErroAoApagar(null);
    startApagar(async () => {
      const resultado = await apagarMensagemAction(alvo.id, escopo);
      if (!resultado.ok) {
        setErroAoApagar(resultado.error ?? "Não foi possível apagar.");
        return;
      }
      setApagando(null);
      // Citar uma mensagem recém-apagada seria enviar uma resposta a algo que
      // já não existe: a Server Action recusa, e a prévia ficaria mentindo.
      setCitando((atual) => (atual?.id === alvo.id ? null : atual));
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.messages(alvo.id),
      });
      if (selected) {
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.messages(selected.id),
        });
      }
    });
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
    <div
      className="flex h-full min-h-0"
      // Soltar um arquivo em QUALQUER outro ponto da tela faz o navegador
      // abrir o arquivo e trocar de pagina, tirando a atendente do sistema no
      // meio do atendimento. O compositor trata o que cai nele; aqui a gente
      // so impede o comportamento padrao no resto.
      onDragOver={(evento) => evento.preventDefault()}
      onDrop={(evento) => evento.preventDefault()}
    >
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
            viewerId={viewerId}
            podeEditar={podeEditar}
            ehChefia={ehChefia}
            onResponder={(mensagem) => {
              // O plano vai junto: responder a uma nota interna é escrever
              // outra nota, responder ao paciente é falar com ele. Um gesto,
              // os dois estados.
              setCitando(mensagem);
              setModo(mensagem.is_internal_note ? "nota" : "responder");
            }}
            onApagar={(mensagem) => {
              setErroAoApagar(null);
              setApagando(mensagem);
            }}
            footer={
              // key OBRIGATORIA: sem ela o React so troca a prop e o
              // compositor mantem o estado. Com anexo, isso significa a
              // foto de um paciente ficar carregada ao abrir a conversa de
              // outro, e o proximo clique em Enviar manda o arquivo errado
              // para o WhatsApp errado.
              <Composer
                key={selected.id}
                conversation={selected}
                viewerId={viewerId}
                citando={citandoVivo}
                aoCancelarCitacao={() => setCitando(null)}
                authorNames={authorNames}
                modo={modo}
                aoTrocarModo={setModo}
              />
            }
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

      <DialogoApagar
        message={apagando}
        aberto={apagando !== null}
        aoFechar={() => {
          setApagando(null);
          setErroAoApagar(null);
        }}
        aoApagar={confirmarApagar}
        pendente={apagandoPendente}
        erro={erroAoApagar}
      />

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
