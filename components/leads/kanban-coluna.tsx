"use client";

import { useDroppable } from "@dnd-kit/core";
import { Info, Workflow } from "lucide-react";
import { useId } from "react";

import { LeadCard } from "@/components/leads/lead-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
//
// DESCRICAO DA ETAPA (02/10/2026): logo abaixo do cabecalho, em ate 2
// linhas. O corte e so visual (line-clamp): o texto inteiro continua no DOM,
// entra no aria-describedby da section e aparece na dica por hover e por
// foco. O aria-label da section continua comecando por "{nome}," (o e2e
// acha a coluna por ele). A descricao mora num icone com dica ao lado do
// nome (28/11/2026, pedido do dono: as duas linhas dela, reservadas em todas
// as colunas, deixavam um vao acima dos cartoes). Nunca no cartao do lead
// (regra dos 5 elementos).

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
  const descricaoId = useId();
  const definicao = definicaoDaEtapa(etapa);
  const tone = STATUS_TONE_VARS[definicao.tone];
  const Icone = definicao.icon;
  const descricao = etapa.descricao?.trim() || null;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${definicao.label}, ${leads.length} leads`}
      aria-describedby={descricao ? descricaoId : undefined}
      className={cn(
        "flex min-h-[320px] min-w-0 flex-col gap-[9px] rounded-card bg-surface-4 p-2.5 cz-transition",
        isOver && "bg-primary-soft ring-2 ring-primary-edge ring-inset",
      )}
    >
      <div className="grid min-w-0 gap-1">
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
          {/* Foco pelo teclado abre a mesma dica do hover. O texto fica na
              pagina (sr-only) para o aria-describedby da coluna. */}
          {descricao ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Sobre a etapa ${definicao.label}`}
                  className="hit-40 grid size-5 shrink-0 place-items-center rounded-sm text-text-secondary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <Info className="size-3.5" aria-hidden />
                  <span id={descricaoId} className="sr-only">
                    {descricao}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                {descricao}
              </TooltipContent>
            </Tooltip>
          ) : null}
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
      </div>
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
