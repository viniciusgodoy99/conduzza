"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Hand,
  Lock,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useState, useTransition } from "react";

import {
  addInternalNoteAction,
  assumirConversaAction,
  devolverParaIaAction,
  reabrirConversaAction,
  resolverConversaAction,
  sendMessageAction,
} from "@/app/(app)/atendimento/actions";
import { Button } from "@/components/ui/button";
import { conversationKeys } from "@/lib/queries/conversations";
import type { ConversationListItem } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Compositor (tarefa 1.6), estados do handoff:
// 1. IA atendendo: campo travado, callout com Assumir.
// 2. Aguardando humano: assumir explicitamente antes de responder.
// 3. Em atendimento (meu): abas Responder / Nota interna (fundo ambar).
// 4. Resolvida: reabrir para responder.
// A janela de 24h e conceito do canal oficial (isOfficialChannel) e nao
// renderiza com uazapi/fake; o dominio windowState ja esta pronto e testado.

type Mode = "responder" | "nota";

export function Composer({
  conversation,
  viewerId,
}: {
  conversation: ConversationListItem;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("responder");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversation.id),
    });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const run = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error ?? "Algo deu errado. Tente de novo.");
        return;
      }
      setText("");
      refresh();
    });
  };

  const isMine =
    conversation.status === "em_atendimento" &&
    conversation.assignee_user_id === viewerId;

  if (conversation.status === "resolvida") {
    return (
      <Callout
        icon={<CheckCircle2 strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--success-bg)] [color:var(--success-text)]"
        text="Conversa resolvida."
        error={error}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => reabrirConversaAction(conversation.id))}
        >
          <RotateCcw strokeWidth={1.5} className="size-4" />
          Reabrir e responder
        </Button>
      </Callout>
    );
  }

  if (conversation.status === "ia_atendendo") {
    return (
      <Callout
        icon={<Sparkles strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--ai-bg)] [color:var(--ai-text)]"
        text="A IA está atendendo esta conversa."
        error={error}
      >
        <TakeoverButton
          pending={pending}
          onClick={() => run(() => assumirConversaAction(conversation.id))}
        />
      </Callout>
    );
  }

  if (conversation.status === "aguardando_humano") {
    return (
      <Callout
        icon={<Hand strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--warning-bg)] [color:var(--warning-text)]"
        text="Ninguém está atendendo. Assuma para responder."
        error={error}
      >
        <TakeoverButton
          pending={pending}
          onClick={() => run(() => assumirConversaAction(conversation.id))}
        />
      </Callout>
    );
  }

  if (!isMine) {
    return (
      <Callout
        icon={<Hand strokeWidth={1.5} className="size-4" />}
        toneClass="bg-surface-3 text-text-secondary"
        text="Outra pessoa está com esta conversa."
        error={error}
      >
        <TakeoverButton
          pending={pending}
          label="Assumir do colega"
          onClick={() => run(() => assumirConversaAction(conversation.id))}
        />
      </Callout>
    );
  }

  const isNote = mode === "nota";

  return (
    <div
      className={cn(
        "grid gap-2 px-4 py-3",
        isNote && "[background:var(--warning-bg)]",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-surface-3 p-0.5 text-[12px] font-medium">
          <button
            type="button"
            onClick={() => setMode("responder")}
            className={cn(
              "h-7 rounded-md px-3",
              !isNote ? "bg-surface-5" : "text-text-secondary",
            )}
          >
            Responder
          </button>
          <button
            type="button"
            onClick={() => setMode("nota")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-3",
              isNote
                ? "bg-surface-5 [color:var(--warning-text)]"
                : "text-text-secondary",
            )}
          >
            <Lock strokeWidth={1.5} className="size-3" />
            Nota interna
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => devolverParaIaAction(conversation.id))}
          >
            <Undo2 strokeWidth={1.5} className="size-4" />
            Devolver para a IA
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => resolverConversaAction(conversation.id))}
          >
            <CheckCircle2 strokeWidth={1.5} className="size-4" />
            Resolver
          </Button>
        </div>
      </div>

      {isNote ? (
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium [color:var(--warning-text)]">
          <Lock strokeWidth={1.5} className="size-3" />
          Nota interna: o paciente não vê.
        </p>
      ) : null}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() =>
            isNote
              ? addInternalNoteAction(conversation.id, text)
              : sendMessageAction(conversation.id, text),
          );
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          placeholder={
            isNote ? "Escreva a nota para o time" : "Escreva a resposta"
          }
          aria-label={isNote ? "Nota interna" : "Resposta ao paciente"}
          className={cn(
            "min-h-[76px] flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            isNote && "[border-color:var(--warning)]",
          )}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              run(() =>
                isNote
                  ? addInternalNoteAction(conversation.id, text)
                  : sendMessageAction(conversation.id, text),
              );
            }
          }}
        />
        <Button type="submit" disabled={pending || text.trim().length === 0}>
          <Send strokeWidth={1.5} className="size-4" />
          {pending ? "Enviando..." : isNote ? "Salvar nota" : "Enviar"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-[12px] [color:var(--alert-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TakeoverButton({
  pending,
  onClick,
  label = "Assumir conversa",
}: {
  pending: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button size="sm" disabled={pending} onClick={onClick}>
      {pending ? "Assumindo..." : label}
    </Button>
  );
}

function Callout({
  icon,
  toneClass,
  text,
  error,
  children,
}: {
  icon: React.ReactNode;
  toneClass: string;
  text: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-3">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium",
          toneClass,
        )}
      >
        {icon}
        <span className="flex-1">{text}</span>
        {children}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] [color:var(--alert-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
