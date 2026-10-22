"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useLayoutEffect, useState } from "react";

import {
  useArrastarParaOsLados,
  type LimitesDaRolagem,
  type Sentido,
} from "@/components/leads/arrastar-para-os-lados";
import {
  aplicarPerdaNaCache,
  moverEtapaNaHora,
} from "@/components/leads/etapa-do-lead";
import { KanbanColuna } from "@/components/leads/kanban-coluna";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import { nomesDasReguas, reguasPorEtapa } from "@/components/leads/mudar-etapa";
import { Button } from "@/components/ui/button";
import {
  agruparPorJornada,
  algumaEtapaComDescricao,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";
import { compararPorProximaAcao } from "@/lib/domain/leads-ui";
import type { LeadResumo, ReguaDaEtapa } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Kanban da Tela 4: as colunas SAO A JORNADA DA CLINICA (funnel_stage_def),
// na ordem que ela definiu, nao mais uma lista fixa de 6. Arrasto com
// PointerSensor de 8px (o clique continua abrindo o drawer). Soltar em etapa
// comum e otimista com rollback (moverEtapaNaHora, o mesmo da etapa na
// linha da lista e na gaveta); soltar na etapa de papel PERDIDO nao
// persiste nada: o modal de motivo decide, e cancelar devolve o cartao,
// porque nada foi gravado. A coluna cuja etapa tem regua de follow-up ligada
// diz isso no cabecalho: soltar ali faz o lead autorizado receber a regua.
//
// Quando alguma etapa tem descricao (02/10/2026), todas as colunas reservam
// a altura das 2 linhas dela: o grid e items-start, e sem a reserva os
// cartoes da coluna com descricao comecariam mais abaixo que os das outras.
//
// O id do DndContext vem do useId: sem ele o dnd-kit numera o
// aria-describedby dos cartoes por um contador global, que diverge entre o
// servidor e o navegador e gerava erro de hidratacao.
//
// PARA OS LADOS (20/10/2026, "nao consigo puxar para o lado"): com mais
// etapas do que cabem, o quadro rola arrastando o fundo com o mouse
// (arrastar-para-os-lados.ts), pelas setas da FaixaDeRolagem e pelo teclado
// (o quadro e uma regiao focavel). Cursor de mao so quando ha o que rolar.

/**
 * Faixa das setas, logo acima do quadro e presa no topo enquanto a pagina
 * rola (no shell so o <main> rola). O fundo e o da pagina, opaco, para os
 * cartoes passarem por baixo sem aparecer. So existe quando o quadro passa
 * da largura; o padding de cima afasta as setas da barra superior quando a
 * faixa gruda, e o de baixo mais o vao do quadro deixam o anel de foco dele
 * aparecer inteiro.
 */
export function FaixaDeRolagem({
  quadroId,
  limites,
  aoRolar,
}: {
  /** id do quadro que as setas rolam (aria-controls) */
  quadroId: string;
  limites: LimitesDaRolagem;
  aoRolar: (sentido: Sentido) => void;
}) {
  if (!limites.excede) {
    return null;
  }
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-background pt-2 pb-1">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Ver etapas anteriores"
          aria-controls={quadroId}
          disabled={limites.noComeco}
          onClick={() => aoRolar(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ver próximas etapas"
          aria-controls={quadroId}
          disabled={limites.noFim}
          onClick={() => aoRolar(1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <p className="text-xs text-text-secondary">
        Arraste o quadro para os lados ou use as setas.
      </p>
    </div>
  );
}

export function KanbanBoard({
  clinicId,
  jornada,
  leads,
  membros,
  reguas,
  podeEditar,
  onAbrirLead,
}: {
  clinicId: string;
  jornada: EtapaDaJornada[];
  leads: LeadResumo[];
  membros: Record<string, string>;
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: ReguaDaEtapa[] | null;
  podeEditar: boolean;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const dndId = useId();
  const quadroId = useId();
  const queryClient = useQueryClient();
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);
  const rolagem = useArrastarParaOsLados();
  const { medir } = rolagem;
  // Etapa nova ou removida muda a largura do conteudo sem mudar a caixa do
  // quadro, e o ResizeObserver so ve a caixa: mede de novo quando a jornada
  // ou os leads mudam.
  useLayoutEffect(() => {
    medir();
  }, [medir, jornada, leads]);

  const grupos = agruparPorJornada(leads, jornada);
  // Dentro de cada coluna, quem precisa de acao primeiro (mesma regra de
  // sempre; a ordenacao morava no agrupador antigo e continua obrigatoria).
  for (const grupo of grupos.values()) {
    grupo.sort(compararPorProximaAcao);
  }

  const aoSoltar = (event: DragEndEvent) => {
    const lead = event.active.data.current?.lead as LeadResumo | undefined;
    const destino = event.over?.id as string | undefined;
    if (!lead || !destino || destino === lead.funnel_stage) {
      return;
    }
    // O desvio para o modal de motivo e pelo PAPEL da etapa, nao pelo nome:
    // a clinica pode ter renomeado "Perdido" para qualquer coisa.
    const defDestino = jornada.find((etapa) => etapa.chave === destino);
    if (defDestino?.papel === "perdido") {
      setPerdaIds([lead.id]);
      return;
    }
    // Otimista: mescla na cache, persiste, e desfaz com aviso se falhar.
    void moverEtapaNaHora(queryClient, clinicId, lead.id, destino);
  };

  // Desde a onda 4 a etapa pode ter varias reguas ligadas (por etiqueta e
  // a geral): o cabecalho da coluna diz os nomes de todas.
  const reguaPorEtapa = new Map(
    [...reguasPorEtapa(reguas)].map(([etapa, daEtapa]) => [
      etapa,
      nomesDasReguas(daEtapa),
    ]),
  );
  const reservarDescricao = algumaEtapaComDescricao(jornada);

  return (
    <DndContext id={dndId} sensors={sensores} onDragEnd={aoSoltar}>
      <div className="flex flex-col gap-1">
        <FaixaDeRolagem
          quadroId={quadroId}
          limites={rolagem.limites}
          aoRolar={rolagem.rolar}
        />
        <div
          id={quadroId}
          ref={rolagem.ref}
          role="region"
          aria-label="Etapas da jornada"
          tabIndex={0}
          {...rolagem.eventosDoArrasto}
          className={cn(
            "grid cz-scroll auto-cols-[minmax(228px,1fr)] grid-flow-col items-start gap-3 overflow-x-auto pb-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
            rolagem.limites.excede && "cursor-grab",
            // Mao fechada em tudo, inclusive passando sobre um cartao, e sem
            // selecionar texto enquanto o quadro anda.
            rolagem.arrastando &&
              "cursor-grabbing select-none [&_*]:cursor-grabbing",
          )}
        >
          {jornada.map((etapa) => (
            <KanbanColuna
              key={etapa.chave}
              etapa={etapa}
              leads={grupos.get(etapa.chave) ?? []}
              membros={membros}
              reguaNome={reguaPorEtapa.get(etapa.chave) ?? null}
              reservarDescricao={reservarDescricao}
              podeEditar={podeEditar}
              onAbrirLead={onAbrirLead}
            />
          ))}
        </div>
      </div>

      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={(ids, motivo, nota) =>
          aplicarPerdaNaCache(queryClient, clinicId, ids, motivo, nota)
        }
      />
    </DndContext>
  );
}
