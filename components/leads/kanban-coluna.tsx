"use client";

import { useDroppable } from "@dnd-kit/core";

import { LeadCard } from "@/components/leads/lead-card";
import {
  FUNNEL_STAGE,
  STATUS_TONE_VARS,
  type FunnelStage,
} from "@/lib/design/status";
import type { LeadResumo } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Coluna do Kanban: area de soltura por etapa, cabecalho com as 3 camadas da
// etapa (icone, rotulo, cor) e contagem em cinza. Coluna vazia existe, com
// estado proprio.

export function KanbanColuna({
  etapa,
  leads,
  membros,
  podeEditar,
  onAbrirLead,
}: {
  etapa: FunnelStage;
  leads: LeadResumo[];
  membros: Record<string, string>;
  podeEditar: boolean;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  const definicao = FUNNEL_STAGE[etapa];
  const tone = STATUS_TONE_VARS[definicao.tone];
  const Icone = definicao.icon;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${definicao.label}, ${leads.length} leads`}
      className={cn(
        "flex min-h-[320px] w-[260px] shrink-0 flex-col gap-2 rounded-lg border bg-surface-3 p-2 transition-colors",
        isOver && "border-ring bg-surface-4",
      )}
    >
      <header className="flex items-center gap-1.5 px-1 pt-1">
        {Icone ? (
          <Icone
            strokeWidth={1.5}
            className="size-4 shrink-0"
            style={{ color: tone.text }}
            aria-hidden
          />
        ) : null}
        <span className="text-[13px] font-semibold">{definicao.label}</span>
        <span className="text-[13px] text-text-tertiary">{leads.length}</span>
      </header>
      <div className="grid content-start gap-2">
        {leads.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-text-tertiary">
            Nenhum lead nesta etapa
          </p>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              nomeResponsavel={
                lead.owner_user_id
                  ? (membros[lead.owner_user_id] ?? null)
                  : null
              }
              podeEditar={podeEditar}
              onAbrir={onAbrirLead}
            />
          ))
        )}
      </div>
    </section>
  );
}
