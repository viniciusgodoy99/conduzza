"use client";

import { useDraggable } from "@dnd-kit/core";

import { initialsOf } from "@/components/atendimento/contact-avatar";
import { rotuloDoCanal, tempoRelativo } from "@/components/leads/rotulos";
import { StatusChip } from "@/components/shared/status-chip";
import { CONTACT_RECENCY, STATUS_TONE_VARS } from "@/lib/design/status";
import { recencyDe } from "@/lib/domain/leads-ui";
import type { LeadResumo } from "@/lib/queries/leads";

// Cartao do Kanban: ate 5 elementos, cada um condicional (sem valor, o
// elemento some; nunca rotulo orfao). Arrastavel com 8px de ativacao, entao
// o clique continua abrindo o drawer.

export function LeadCard({
  lead,
  nomeResponsavel,
  podeEditar,
  onAbrir,
}: {
  lead: LeadResumo;
  nomeResponsavel: string | null;
  podeEditar: boolean;
  onAbrir: (lead: LeadResumo) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: lead.id,
      data: { lead },
      disabled: !podeEditar,
    });
  // O dnd-kit marca aria-disabled quando o arrasto esta desligado (papel sem
  // edicao), mas o cartao continua clicavel para abrir o drawer: sem esta
  // limpeza, leitores de tela e testes tratariam o cartao como inerte (mesmo
  // truque de appointment-block).
  const { "aria-disabled": _ariaDisabledDoDnd, ...atributosDeArrasto } =
    attributes;
  void _ariaDisabledDoDnd;

  const recencia = recencyDe(lead.last_contact_at, new Date());
  const origem = rotuloDoCanal(lead.source_channel);
  const neutro = STATUS_TONE_VARS.neutral;
  const infoTone = STATUS_TONE_VARS.info;

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...atributosDeArrasto}
      onClick={() => onAbrir(lead)}
      className="relative grid w-full gap-1.5 rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2"
      style={{
        ...(transform
          ? {
              transform: `translate(${transform.x}px, ${transform.y}px)`,
              zIndex: 30,
              opacity: 0.85,
            }
          : {}),
        ...(isDragging ? { cursor: "grabbing" } : {}),
      }}
      aria-label={`Abrir ${lead.name ?? lead.phone_e164}`}
    >
      <span className="truncate text-sm leading-tight font-semibold">
        {lead.name ?? lead.phone_e164}
      </span>
      {lead.name ? (
        <span className="truncate font-mono text-xs text-text-secondary">
          {lead.phone_e164}
        </span>
      ) : null}
      {origem || (recencia && lead.last_contact_at) ? (
        <span className="flex flex-wrap items-center gap-1 pr-6">
          {origem ? (
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap"
              style={{ color: neutro.text, backgroundColor: neutro.bg }}
            >
              {origem}
            </span>
          ) : null}
          {recencia && lead.last_contact_at ? (
            <StatusChip
              definition={CONTACT_RECENCY[recencia]}
              label={tempoRelativo(lead.last_contact_at)}
            />
          ) : null}
        </span>
      ) : null}
      {nomeResponsavel ? (
        <span
          title={nomeResponsavel}
          className="absolute right-2 bottom-2 flex size-5 items-center justify-center rounded-full text-[9px] font-semibold"
          style={{ color: infoTone.text, backgroundColor: infoTone.bg }}
        >
          {initialsOf(nomeResponsavel, "")}
        </span>
      ) : null}
    </button>
  );
}
