"use client";

import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Info } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import { BolhaEmVoo } from "@/components/atendimento/bolha-em-voo";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import {
  ComplianceBlockCard,
  MessageBubble,
} from "@/components/atendimento/message-bubble";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { CONVERSATION_STATUS } from "@/lib/design/status";
import type { EnvioEmVoo } from "@/lib/domain/envios-em-voo";
import type {
  ComplianceDecision,
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";

// Fio da conversa (handoff): cabecalho de 64px com avatar, nome e estado;
// mensagens com separador de dia; cartoes de evento e de bloqueio de
// conformidade no meio do fio. O compositor entra como slot (tarefa 1.6).

type ThreadItem =
  | { type: "message"; message: MessageItem }
  | { type: "decision"; decision: ComplianceDecision };

function mergeItems(
  messages: MessageItem[],
  decisions: ComplianceDecision[],
): ThreadItem[] {
  const items: ThreadItem[] = [
    ...messages.map((message) => ({ type: "message" as const, message })),
    ...decisions.map((decision) => ({ type: "decision" as const, decision })),
  ];
  return items.sort((a, b) => {
    const ta =
      a.type === "message" ? a.message.created_at : a.decision.created_at;
    const tb =
      b.type === "message" ? b.message.created_at : b.decision.created_at;
    return ta.localeCompare(tb);
  });
}

export function Thread({
  conversation,
  messages,
  decisions,
  isLoading,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  authorNames,
  onBack,
  onToggleContext,
  footer,
  viewerId,
  podeEditar,
  ehChefia,
  onResponder,
  onApagar,
  emVoo,
  aoTentarDeNovo,
  aoDescartarEnvio,
}: {
  conversation: ConversationListItem;
  messages: MessageItem[];
  decisions: ComplianceDecision[];
  isLoading: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  authorNames: Record<string, string>;
  onBack: () => void;
  onToggleContext: () => void;
  footer: React.ReactNode;
  viewerId: string;
  podeEditar: boolean;
  ehChefia: boolean;
  onResponder: (message: MessageItem) => void;
  onApagar: (message: MessageItem) => void;
  /** mensagens já mandadas que ainda não viraram linha no banco */
  emVoo: EnvioEmVoo[];
  aoTentarDeNovo: (chave: string) => void;
  aoDescartarEnvio: (chave: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // So rola para o fim quando chega mensagem NOVA (a mais recente muda), nao
  // ao carregar historico antigo, que deve manter a posicao de leitura.
  const ultimaId = messages[messages.length - 1]?.id;
  const emVooCount = emVoo.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    // Rola para o fim SÓ quando a pessoa já está lendo o fim.
    //
    // Antes rolava sempre, e quem tinha subido para conferir o que foi
    // combinado semana passada era arrancado de lá por qualquer mensagem que
    // chegasse. Com a bolha otimista isso passaria a acontecer também a cada
    // envio, inclusive de colega em outra aba.
    const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanciaDoFim < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ultimaId, emVooCount]);

  // Trocar de conversa SEMPRE abre no fim: é uma conversa nova na tela, não
  // existe posição de leitura a preservar.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation.id]);

  // Rola ate a mensagem citada e a destaca por um instante. Sem o realce, a
  // pessoa chega la e nao sabe qual das bolhas era a procurada.
  const irParaCitada = (id: string) => {
    const alvo = document.getElementById(`mensagem-${id}`);
    if (!alvo) {
      return;
    }
    alvo.scrollIntoView({ behavior: "smooth", block: "center" });
    alvo.classList.add("ring-2", "ring-ring/60", "rounded-2xl");
    window.setTimeout(() => {
      alvo.classList.remove("ring-2", "ring-ring/60", "rounded-2xl");
    }, 1400);
  };

  // Quais mensagens existem no documento agora. O fio pagina de 50 em 50, e
  // citar algo de semanas atrás é comum: sem este conjunto o bloco de citação
  // virava um botão que não faz nada.
  const carregadas = new Set(messages.map((m) => m.id));

  const items = mergeItems(messages, decisions);
  const definition = CONVERSATION_STATUS[conversation.status];
  const assigneeName = conversation.assignee_user_id
    ? (authorNames[conversation.assignee_user_id] ?? "Atendente")
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 lg:hidden"
          onClick={onBack}
          aria-label="Voltar para a lista"
        >
          <ArrowLeft strokeWidth={1.5} className="size-4" />
        </Button>
        <ContactAvatar
          name={conversation.contact.name}
          phone={conversation.contact.phone_e164}
          size={32}
        />
        <div className="grid min-w-0">
          <span className="truncate text-sm font-semibold">
            {conversation.contact.name ?? conversation.contact.phone_e164}
          </span>
          <span className="truncate font-mono text-[11px] text-text-tertiary tabular-nums">
            {conversation.contact.phone_e164}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusChip
            definition={definition}
            label={
              conversation.status === "em_atendimento" && assigneeName
                ? assigneeName
                : undefined
            }
            avatarInitials={assigneeName
              ?.split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0] ?? "")
              .join("")
              .toUpperCase()}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-9 xl:hidden"
            onClick={onToggleContext}
            aria-label="Abrir contexto do contato"
          >
            <Info strokeWidth={1.5} className="size-4" />
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4"
      >
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : (
          <div className="mx-auto grid max-w-3xl gap-2.5">
            {hasOlder ? (
              <div className="flex justify-center pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadOlder}
                  disabled={loadingOlder}
                  className="text-[12.5px] text-text-secondary"
                >
                  {loadingOlder
                    ? "Carregando..."
                    : "Carregar mensagens anteriores"}
                </Button>
              </div>
            ) : null}
            {items.map((item, index) => {
              const previous = items[index - 1];
              const currentDate =
                item.type === "message"
                  ? item.message.created_at
                  : item.decision.created_at;
              const previousDate = previous
                ? previous.type === "message"
                  ? previous.message.created_at
                  : previous.decision.created_at
                : null;
              const showDay =
                !previousDate ||
                !isSameDay(new Date(currentDate), new Date(previousDate));
              return (
                <Fragment
                  key={
                    item.type === "message" ? item.message.id : item.decision.id
                  }
                >
                  {showDay ? (
                    <div className="flex justify-center py-1">
                      <span className="text-[11px] font-medium tracking-wide text-text-tertiary uppercase">
                        {format(new Date(currentDate), "EEEE, d 'de' MMMM", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  ) : null}
                  {item.type === "message" ? (
                    <MessageBubble
                      message={item.message}
                      authorName={
                        item.message.author === "ia"
                          ? "Assistente"
                          : item.message.author_user_id
                            ? (authorNames[item.message.author_user_id] ?? null)
                            : null
                      }
                      authorNames={authorNames}
                      contato={
                        conversation.contact.name ??
                        conversation.contact.phone_e164
                      }
                      viewerId={viewerId}
                      podeEditar={podeEditar}
                      podeResponder={
                        podeEditar &&
                        conversation.status === "em_atendimento" &&
                        conversation.assignee_user_id === viewerId
                      }
                      ehChefia={ehChefia}
                      onResponder={onResponder}
                      onApagar={onApagar}
                      onIrParaCitada={irParaCitada}
                      citadaEstaNaTela={
                        item.message.reply_to !== null &&
                        carregadas.has(item.message.reply_to.id)
                      }
                    />
                  ) : (
                    <ComplianceBlockCard decision={item.decision} />
                  )}
                </Fragment>
              );
            })}
            {emVoo.map((envio) => (
              <BolhaEmVoo
                key={envio.chave}
                envio={envio}
                aoTentarDeNovo={() => aoTentarDeNovo(envio.chave)}
                aoDescartar={() => aoDescartarEnvio(envio.chave)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-surface-1">
        {footer}
      </div>
    </div>
  );
}
