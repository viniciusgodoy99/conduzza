"use client";

import { CalendarCheck2, TimerReset, Wallet } from "lucide-react";

import { formatarCentavos } from "@/lib/utils/moeda";
import type { MetricasDaEspera } from "@/lib/queries/espera";

// Painel superior da Tela 10 (o valor que a fila recupera), no cartao
// "Desempenho da lista" do design system (docs/06 secao 5.8): tres linhas de
// numero, sem barra (nenhuma das tres tem um maximo honesto para a barra).
// Os icones sao neutros: nenhuma linha e um status. "No mes" aqui e a janela
// honesta de 30 dias, e ela vale para as tres linhas (todas contam so as
// vagas preenchidas nesse periodo).

function tempoLegivel(minutos: number): string {
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

export function PainelMetricas({ metricas }: { metricas: MetricasDaEspera }) {
  const linhas = [
    {
      rotulo: "Horários recuperados",
      valor: String(metricas.recuperados30d),
      Icone: CalendarCheck2,
    },
    {
      rotulo: "Receita associada",
      valor: formatarCentavos(metricas.receitaCents),
      Icone: Wallet,
    },
    {
      rotulo: "Tempo médio até preencher",
      valor:
        metricas.tempoMedioMin === null
          ? null
          : tempoLegivel(metricas.tempoMedioMin),
      Icone: TimerReset,
    },
  ];
  return (
    <section
      aria-labelledby="titulo-do-desempenho"
      className="flex min-w-0 flex-col rounded-card border border-border bg-card shadow-sm"
    >
      <div className="grid gap-[3px] border-b border-border px-4 py-3.5">
        <h2
          id="titulo-do-desempenho"
          className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
        >
          Desempenho da lista
        </h2>
        <p className="text-[12.5px] text-text-secondary">Últimos 30 dias</p>
      </div>
      <dl className="grid px-4 py-1.5">
        {linhas.map((linha) => (
          <div
            key={linha.rotulo}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
          >
            <dt className="flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
              <linha.Icone className="size-4 shrink-0" aria-hidden />
              {linha.rotulo}
            </dt>
            <dd
              className={
                linha.valor === null
                  ? "shrink-0 text-[13px] text-text-secondary"
                  : "shrink-0 cz-num text-base font-semibold text-text-strong"
              }
            >
              {linha.valor ?? "Ainda sem dado"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
