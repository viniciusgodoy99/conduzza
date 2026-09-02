"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AudioLines,
  FileText,
  Image as ImageIcon,
  Lock,
  ShieldAlert,
  Sparkles,
  Video,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ComplianceDecision,
  MessageItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Bolhas da conversa (handoff): paciente a esquerda (raio 4/14/14/14), IA e
// humano a direita (14/4/14/14), largura maxima 74%. A bolha da IA carrega
// rotulo textual e selo, nunca so cor. Nota interna em ambar com cadeado.

function hour(value: string): string {
  return format(new Date(value), "HH:mm", { locale: ptBR });
}

export function SystemEventCard({ message }: { message: MessageItem }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-surface-3 px-3 py-1 text-[11.5px] text-text-secondary">
        {message.body} · {hour(message.created_at)}
      </span>
    </div>
  );
}

export function ComplianceBlockCard({
  decision,
}: {
  decision: ComplianceDecision;
}) {
  const RULE_LABEL: Record<string, string> = {
    triagem: "triagem de sintoma",
    promessa_resultado: "promessa de resultado",
    medicamento: "indicação de medicamento",
    oferta_casada: "oferta casada",
  };
  return (
    <div className="flex justify-center">
      <div className="grid max-w-md gap-2 rounded-lg border [border-color:var(--alert)] px-4 py-3 [background:var(--alert-bg)]">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold [color:var(--alert-text)]">
          <ShieldAlert strokeWidth={1.5} className="size-4 shrink-0" />
          Resposta da IA bloqueada pela conformidade
        </p>
        <p className="text-[12.5px] text-text-secondary">
          Motivo:{" "}
          {RULE_LABEL[decision.compliance_rule ?? ""] ??
            "regra de conformidade"}
          . A conversa foi passada para a recepção.
        </p>
        {decision.blocked_draft ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-fit [color:var(--alert-text)]"
              >
                Ver o que a IA ia responder
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rascunho bloqueado</DialogTitle>
                <DialogDescription>
                  Registrado para auditoria. Este texto nunca foi enviado ao
                  paciente.
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg bg-surface-3 p-3 text-sm">
                {decision.blocked_draft}
              </p>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

function AudioBody({ message }: { message: MessageItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
        <AudioLines strokeWidth={1.5} className="size-4" />
        Áudio{" "}
        {message.media_url?.startsWith("seed://")
          ? "(indisponível na demonstração)"
          : ""}
      </span>
      {message.transcript ? (
        <div className="grid gap-1">
          <p
            className={cn(
              "text-[13px] leading-relaxed",
              !expanded && "line-clamp-2",
            )}
          >
            <span className="text-text-tertiary">Transcrição: </span>
            {message.transcript}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="w-fit text-[11.5px] text-text-secondary underline-offset-2 hover:underline"
          >
            {expanded ? "ver menos" : "ver mais"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A mensagem carrega arquivo?
 *
 * Precisa olhar `media_url` e nao so `content_type`, por um motivo concreto:
 * o parser de entrada mapeia VIDEO para 'texto' (lib/integrations/whatsapp/
 * inbound.ts:138-146 nao tem caso para video, e o enum do banco tambem nao o
 * preve). Sem esta checagem, todo video recebido continuaria como bolha vazia,
 * que e exatamente o defeito que este componente esta corrigindo.
 */
function ehMidia(message: MessageItem): boolean {
  if (message.content_type === "imagem" || message.content_type === "documento") {
    return true;
  }
  return message.content_type === "texto" && Boolean(message.media_url);
}

/**
 * Bolha de arquivo recebido, ANTES de existir o visualizador.
 *
 * Ate agora imagem e documento caiam no caminho de texto e renderizavam
 * `body`, que e NULO para midia: a clinica via uma bolha vazia com um horario,
 * sem nenhuma pista de que o paciente tinha mandado uma foto de exame. O
 * arquivo estava guardado o tempo todo.
 *
 * Tres camadas como manda a secao 5 do CLAUDE.md: icone com forma distinta,
 * rotulo em texto e cor. Nunca so cor.
 */
function MidiaBody({ message }: { message: MessageItem }) {
  const demonstracao = message.media_url?.startsWith("seed://") ?? false;
  const { Icone, rotulo } =
    message.content_type === "imagem"
      ? { Icone: ImageIcon, rotulo: "Foto recebida" }
      : message.content_type === "documento"
        ? { Icone: FileText, rotulo: "Documento recebido" }
        : { Icone: Video, rotulo: "Vídeo recebido" };

  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary">
        <Icone strokeWidth={1.5} className="size-4 shrink-0" />
        {rotulo}
      </span>
      {message.body ? (
        <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
          {message.body}
        </p>
      ) : null}
      <span className="text-[11.5px] text-text-tertiary">
        {demonstracao
          ? "Indisponível na demonstração"
          : "Abra no WhatsApp por enquanto"}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  authorName,
}: {
  message: MessageItem;
  authorName: string | null;
}) {
  if (message.content_type === "evento") {
    return <SystemEventCard message={message} />;
  }

  const fromPatient = message.direction === "entrada";
  const fromIa = message.author === "ia";
  const note = message.is_internal_note;

  return (
    <div className={cn("flex", fromPatient ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "grid max-w-[74%] gap-1 border px-3 py-2",
          fromPatient
            ? "border-border-strong rounded-[4px_14px_14px_14px] bg-card"
            : "rounded-[14px_4px_14px_14px]",
          !fromPatient &&
            !note &&
            (fromIa
              ? "[border-color:var(--ai)] [background:var(--ai-bg)]"
              : "border-transparent bg-surface-4"),
          note &&
            "[border-color:var(--warning)] [background:var(--warning-bg)]",
        )}
      >
        {fromIa ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold [color:var(--ai-text)]">
            <Sparkles strokeWidth={1.5} className="size-3" />
            {authorName ?? "Assistente"}
            <span className="rounded-full px-1.5 py-px text-[9px] tracking-wide [color:var(--ai-bg)] uppercase [background:var(--ai)]">
              IA
            </span>
          </span>
        ) : null}
        {!fromPatient && !fromIa && authorName ? (
          <span
            className={cn(
              "flex items-center gap-1 text-[11px] font-semibold",
              note ? "[color:var(--warning-text)]" : "text-text-secondary",
            )}
          >
            {note ? <Lock strokeWidth={1.5} className="size-3" /> : null}
            {authorName}
            {note ? " · Nota interna, o paciente não vê" : null}
          </span>
        ) : null}

        {message.content_type === "audio" ? (
          <AudioBody message={message} />
        ) : ehMidia(message) ? (
          <MidiaBody message={message} />
        ) : (
          <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
            {message.body}
          </p>
        )}

        <span
          className={cn(
            "justify-self-end font-mono text-[10.5px] tabular-nums",
            "text-text-tertiary",
          )}
        >
          {hour(message.created_at)}
          {message.delivery_status === "falhou" ? (
            <span className="[color:var(--alert-text)]"> · falhou</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
