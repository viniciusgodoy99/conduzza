"use client";

import { useDroppable } from "@dnd-kit/core";
import { Workflow } from "lucide-react";

import { LeadCard } from "@/components/leads/lead-card";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import type { LeadResumo } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Coluna do Kanban no desenho do design system Conduzza (docs/06 secao 5.4):
// trilho afundado sem borda, cabecalho com o ICONE da etapa na cor dela (e
// nao o quadrado colorido do kit: a forma e a camada que discrimina, C8),
// rotulo e contagem. Coluna vazia existe, com estado proprio. Sem o botao "+"
// do kit (C25): lead novo nasce pelo Novo lead do cabecalho.
//
// Etapa com regua de follow-up ligada mostra o icone de Automacoes com o
// rotulo "Régua" (achado 98): quem solta um lead ali sabe que ele passa a
// receber mensagens automaticas, se tiver autorizacao.

export function KanbanColuna({
  etapa,
  leads,
  membros,
  reguaNome,
  podeEditar,
  onAbrirLead,
}: {
  etapa: EtapaDaJornada;
  leads: LeadResumo[];
  membros: Record<string, string>;
  /** Nome da regua de follow-up ligada nesta etapa; null sem regua */
  reguaNome: string | null;
  podeEditar: boolean;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.chave });
  const definicao = definicaoDaEtapa(etapa);
  const tone = STATUS_TONE_VARS[definicao.tone];
  const Icone = definicao.icon;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${definicao.label}, ${leads.length} leads`}
      className={cn(
        "flex min-h-[320px] min-w-0 flex-col gap-[9px] rounded-card bg-surface-4 p-2.5 cz-transition",
        isOver && "bg-primary-soft ring-2 ring-primary-edge ring-inset",
      )}
    >
      <header className="flex h-7 min-w-0 items-center gap-[7px] px-1">
        {Icone ? (
          <Icone
            className="size-3.5 shrink-0"
            style={{ color: tone.text }}
            aria-hidden
          />
        ) : null}
        <span className="truncate text-[12.5px] font-bold text-text-strong">
          {definicao.label}
        </span>
        <span className="shrink-0 cz-num text-xs text-text-secondary">
          {leads.length}
        </span>
        {reguaNome ? (
          <span
            title={`Régua de follow-up ligada: ${reguaNome}`}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-text-secondary"
          >
            <Workflow className="size-3" aria-hidden />
            Régua
            <span className="sr-only">de follow-up ligada: {reguaNome}</span>
          </span>
        ) : null}
      </header>
      <div className="grid content-start gap-2">
        {leads.length === 0 ? (
          <p className="px-2 py-[18px] text-center text-xs text-text-secondary">
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
