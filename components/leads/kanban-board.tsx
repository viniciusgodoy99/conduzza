"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { mudarEtapaAction } from "@/app/(app)/leads/actions";
import { KanbanColuna } from "@/components/leads/kanban-coluna";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import { agruparPorJornada, type EtapaDaJornada } from "@/lib/domain/jornada";
import { compararPorProximaAcao } from "@/lib/domain/leads-ui";
import {
  leadsKeys,
  type LeadResumo,
  type ReguaDaEtapa,
} from "@/lib/queries/leads";

// Kanban da Tela 4: as colunas SAO A JORNADA DA CLINICA (funnel_stage_def),
// na ordem que ela definiu, nao mais uma lista fixa de 6. Arrasto com
// PointerSensor de 8px (o clique continua abrindo o drawer). Soltar em etapa
// comum e otimista com rollback; soltar na etapa de papel PERDIDO nao
// persiste nada: o modal de motivo decide, e cancelar devolve o cartao,
// porque nada foi gravado. A coluna cuja etapa tem regua de follow-up ligada
// diz isso no cabecalho: soltar ali faz o lead autorizado receber a regua.
//
// O id do DndContext vem do useId: sem ele o dnd-kit numera o
// aria-describedby dos cartoes por um contador global, que diverge entre o
// servidor e o navegador e gerava erro de hidratacao.

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
  const queryClient = useQueryClient();
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);

  const grupos = agruparPorJornada(leads, jornada);
  // Dentro de cada coluna, quem precisa de acao primeiro (mesma regra de
  // sempre; a ordenacao morava no agrupador antigo e continua obrigatoria).
  for (const grupo of grupos.values()) {
    grupo.sort(compararPorProximaAcao);
  }
  const chave = leadsKeys.lista(clinicId);

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
    const anterior = queryClient.getQueryData<LeadResumo[]>(chave);
    queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
      atual
        ? atual.map((l) =>
            l.id === lead.id
              ? {
                  ...l,
                  funnel_stage: destino,
                  lost_reason: null,
                  lost_reason_note: null,
                }
              : l,
          )
        : atual,
    );
    void mudarEtapaAction({ contact_ids: [lead.id], etapa: destino }).then(
      (resultado) => {
        if (!resultado.ok) {
          queryClient.setQueryData(chave, anterior);
          toast.error(resultado.error ?? "Não foi possível mudar a etapa.");
        }
      },
    );
  };

  const reguaPorEtapa = new Map(
    (reguas ?? []).map((regua) => [regua.etapa, regua.nome]),
  );

  return (
    <DndContext id={dndId} sensors={sensores} onDragEnd={aoSoltar}>
      <div className="grid cz-scroll auto-cols-[minmax(228px,1fr)] grid-flow-col items-start gap-3 overflow-x-auto pb-2">
        {jornada.map((etapa) => (
          <KanbanColuna
            key={etapa.chave}
            etapa={etapa}
            leads={grupos.get(etapa.chave) ?? []}
            membros={membros}
            reguaNome={reguaPorEtapa.get(etapa.chave) ?? null}
            podeEditar={podeEditar}
            onAbrirLead={onAbrirLead}
          />
        ))}
      </div>

      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={(ids, motivo, nota) => {
          queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
            atual
              ? atual.map((l) =>
                  ids.includes(l.id)
                    ? {
                        ...l,
                        funnel_stage: "perdido",
                        lost_reason: motivo,
                        lost_reason_note: nota,
                      }
                    : l,
                )
              : atual,
          );
        }}
      />
    </DndContext>
  );
}
