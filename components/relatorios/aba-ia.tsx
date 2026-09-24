"use client";

import { Bot } from "lucide-react";

import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { formatarDuracao } from "@/lib/domain/duracao";
import type {
  AtendimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba IA (Tela 11): so o que e REAL hoje. O agente ainda nao existe (Fase 3
// adiada), entao "% resolvido sem humano", escalonamentos e agendamentos
// pela IA seriam numeros inventados: aparecem visiveis e desabilitados com
// dica (regra 5), nunca como zero falso. O que da para medir e o
// atendimento HUMANO: mediana e p90 da primeira resposta, nunca media (uma
// noite sem plantao destruiria a media).

const METRICAS_DO_AGENTE = [
  "Conversas resolvidas sem humano",
  "Escalonamentos para a recepção",
  "Agendamentos feitos pela IA",
];

export function AbaIa({
  atendimento,
}: {
  atendimento: Periodizado<AtendimentoDoPeriodo>;
}) {
  const atual = atendimento.atual;
  const anterior = atendimento.anterior;

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Conversas iniciadas"
          valor={atual.conversasIniciadas.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.conversasIniciadas,
                  anterior: anterior.conversasIniciadas,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Novas conversas respondidas"
          valor={`${atual.primeiraResposta.respondidas} de ${atual.primeiraResposta.conversas}`}
          notaSemDelta="conversas cuja primeira mensagem chegou no período e que já receberam resposta de alguém da equipe"
        />
        <CartaoKpi
          rotulo="Primeira resposta (mediana)"
          valor={formatarDuracao(atual.primeiraResposta.medianaSegundos)}
          notaSemDelta="metade das conversas respondidas levou esse tempo ou menos"
        />
        <CartaoKpi
          rotulo="Primeira resposta (90% em até)"
          valor={formatarDuracao(atual.primeiraResposta.p90Segundos)}
          notaSemDelta="9 em cada 10 conversas respondidas levaram esse tempo ou menos"
        />
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-4 text-text-secondary" />
          <h2 className="text-[15px] font-semibold">
            Desempenho da recepcionista de IA
          </h2>
        </div>
        <p className="max-w-prose text-sm text-text-secondary">
          Estes números chegam com o agente de IA. Enquanto ele não atende, não
          existe número para mostrar, e número inventado não entra aqui.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {METRICAS_DO_AGENTE.map((rotulo) => (
            <DisabledWithHint
              key={rotulo}
              hint="Chega com o agente de IA. As travas de conformidade médica vêm antes de qualquer número."
            >
              <div className="grid content-start gap-1 rounded-lg border border-dashed p-4 opacity-60">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
                  {rotulo}
                </span>
                <span className="font-mono text-[28px] leading-none font-semibold text-text-tertiary">
                  --
                </span>
              </div>
            </DisabledWithHint>
          ))}
        </div>
      </section>
    </div>
  );
}
