"use client";

import { CartoesDaAgenda } from "@/components/relatorios/cartoes-da-agenda";
import { DetalheDaAgenda } from "@/components/relatorios/detalhe-da-agenda";
import type { DimensaoDaAgenda } from "@/lib/domain/exportacao-de-resultados";
import type { AgendaDoPeriodo, Periodizado } from "@/lib/queries/relatorios";

// Movimento da agenda no periodo: os 4 cartoes (agendadas, comparecimentos,
// faltas, cancelamentos) e o detalhe com dimensao trocavel (10.7). Desde a
// Fase 3 o conteudo vive na aba Comercial; este componente continua sendo a
// visao do papel profissional (Resultados e Inicio), com o recorte proprio
// rotulado.

export type { DimensaoDaAgenda };

export function AbaAgendamentos({
  agenda,
  dimensao,
  aoMudarDimensao,
  rotuloProprio,
}: {
  agenda: Periodizado<AgendaDoPeriodo>;
  dimensao: DimensaoDaAgenda;
  aoMudarDimensao: (dimensao: DimensaoDaAgenda) => void;
  /** Preenchido na visao do profissional ("Seus atendimentos"). */
  rotuloProprio?: string;
}) {
  return (
    <div className="grid gap-4">
      {rotuloProprio ? (
        <p className="text-xs font-medium text-text-secondary">
          {rotuloProprio}
        </p>
      ) : null}
      <CartoesDaAgenda agenda={agenda} />
      <DetalheDaAgenda
        agenda={agenda.atual}
        dimensao={dimensao}
        aoMudarDimensao={aoMudarDimensao}
      />
    </div>
  );
}
