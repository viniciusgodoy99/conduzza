"use client";

import { useDraggable } from "@dnd-kit/core";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ChipDeOrigem } from "@/components/leads/chip-de-origem";
import { rotuloDoCanal, tempoRelativo } from "@/components/leads/rotulos";
import { StatusChip } from "@/components/shared/status-chip";
import { CONTACT_RECENCY } from "@/lib/design/status";
import { recencyDe } from "@/lib/domain/leads-ui";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { LeadResumo } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Cartao do Kanban no desenho do KanbanCard do design system Conduzza, com o
// conteudo do brief: ate 5 elementos (nome, telefone, origem, tempo desde o
// ultimo contato e o responsavel), cada um condicional (sem valor, o
// elemento some; nunca rotulo orfao). Do kit NAO entram ticket em R$, tempo
// parado nem "urgente": nao ha dado para eles (C25). Arrastavel com 8px de
// ativacao, entao o clique continua abrindo o drawer. O telefone aparece
// formatado, como uma pessoa discaria.

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
  const telefone = formatarTelefone(lead.phone_e164);
  const temRecencia = recencia !== null && lead.last_contact_at !== null;

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...atributosDeArrasto}
      onClick={() => onAbrir(lead)}
      className={cn(
        "grid w-full gap-2 rounded-xl border border-border bg-card p-[11px] text-left shadow-xs transition-[box-shadow,translate] duration-(--dur-fast) outline-none hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid motion-reduce:hover:translate-y-0",
        podeEditar && "cursor-grab",
        isDragging && "cursor-grabbing shadow-pop",
      )}
      style={
        transform
          ? {
              // O arrasto anda por transform; o translate de 1px do hover e
              // outra propriedade e so soma, sem brigar com ele.
              transform: `translate(${transform.x}px, ${transform.y}px)`,
              zIndex: 30,
            }
          : undefined
      }
      aria-label={`Abrir ${lead.name ?? telefone}`}
    >
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[13px] leading-tight font-semibold text-text-strong">
          {lead.name ?? <span className="cz-num">{telefone}</span>}
        </span>
        {lead.name ? (
          <span className="truncate cz-num text-xs text-text-secondary">
            {telefone}
          </span>
        ) : null}
      </span>
      {origem || temRecencia || nomeResponsavel ? (
        <span className="flex flex-wrap items-center gap-1">
          {origem ? <ChipDeOrigem rotulo={origem} /> : null}
          {recencia && lead.last_contact_at ? (
            <StatusChip
              size="sm"
              definition={CONTACT_RECENCY[recencia]}
              label={tempoRelativo(lead.last_contact_at)}
            />
          ) : null}
          {nomeResponsavel ? (
            <span title={nomeResponsavel} className="ml-auto shrink-0">
              <ContactAvatar name={nomeResponsavel} phone="" size={24} />
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
