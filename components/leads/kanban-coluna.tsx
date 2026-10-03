"use client";

import { useDroppable } from "@dnd-kit/core";
import { Workflow } from "lucide-react";
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
// acha a coluna por ele). Quando ALGUMA etapa tem descricao, todas reservam
// a mesma altura (reservarDescricao), para os cartoes comecarem alinhados.
// Nunca no cartao do lead (regra dos 5 elementos).

/** Altura das 2 linhas da descricao (11.5px x 1.35 x 2, arredondado). */
const ALTURA_DA_DESCRICAO = "h-8";

export function KanbanColuna({
  etapa,
  leads,
  membros,
  reguaNome,
  reservarDescricao = false,
  podeEditar,
  onAbrirLead,
}: {
  etapa: EtapaDaJornada;
  leads: LeadResumo[];
  membros: Record<string, string>;
  /** Nome da regua de follow-up ligada nesta etapa; null sem regua */
  reguaNome: string | null;
  /**
   * Alguma etapa da jornada tem descricao: esta coluna reserva a altura das
   * 2 linhas mesmo sem descricao propria, para alinhar os cartoes.
   */
  reservarDescricao?: boolean;
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
        {/* Foco pelo teclado abre a mesma dica do hover: o corte em 2
            linhas nao pode esconder texto de quem nao usa mouse. */}
        {descricao ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                id={descricaoId}
                tabIndex={0}
                className={cn(
                  ALTURA_DA_DESCRICAO,
                  "line-clamp-2 cursor-default rounded-sm px-1 text-[11.5px] leading-[1.35] break-words text-text-secondary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid",
                )}
              >
                {descricao}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {descricao}
            </TooltipContent>
          </Tooltip>
        ) : reservarDescricao ? (
          <div aria-hidden className={ALTURA_DA_DESCRICAO} />
        ) : null}
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
