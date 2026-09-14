"use client";

import { CalendarCheck2, Clock3, Wallet } from "lucide-react";

import { formatarCentavos } from "@/lib/utils/moeda";
import type { MetricasDaEspera } from "@/lib/queries/espera";

// Painel superior da Tela 10: o valor que a fila recupera, em 3 camadas por
// cartao. "No mes" aqui e a janela honesta de 30 dias.

export function PainelMetricas({ metricas }: { metricas: MetricasDaEspera }) {
  const tempo =
    metricas.tempoMedioMin === null
      ? "ainda sem dado"
      : metricas.tempoMedioMin < 60
        ? `${metricas.tempoMedioMin} min`
        : `${Math.round(metricas.tempoMedioMin / 60)} h`;
  const cartoes = [
    {
      rotulo: "Horários recuperados (30 dias)",
      valor: String(metricas.recuperados30d),
      Icone: CalendarCheck2,
      cor: "var(--success-text)",
    },
    {
      rotulo: "Receita associada",
      valor: formatarCentavos(metricas.receitaCents),
      Icone: Wallet,
      cor: "var(--info-text)",
    },
    {
      rotulo: "Tempo médio até preencher",
      valor: tempo,
      Icone: Clock3,
      cor: "var(--neutral-text)",
    },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {cartoes.map((cartao) => (
        <div key={cartao.rotulo} className="grid gap-1 rounded-lg border bg-card p-4">
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <cartao.Icone
              strokeWidth={1.5}
              className="size-4"
              style={{ color: cartao.cor }}
              aria-hidden
            />
            {cartao.rotulo}
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {cartao.valor}
          </span>
        </div>
      ))}
    </section>
  );
}
