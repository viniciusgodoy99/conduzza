"use client";

import { MessageCircleMore } from "lucide-react";

import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  AtendimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba Custos (Tela 11): no canal conectado por QR nao existe custo por
// mensagem, e o preco da Meta em BRL e a pendencia P1 (message_pricing
// nasce vazia; nao se inventa valor). Entao esta aba mostra o que e real,
// o VOLUME, e diz com todas as letras por que nao ha reais aqui. Quando o
// canal oficial existir, o custo entra por dado, nao por chute.

export const AUTOR_ROTULO: Record<string, string> = {
  paciente: "Pacientes",
  usuario: "Equipe",
  sistema: "Mensagens automáticas",
  ia: "Recepcionista de IA",
};

export function AbaCustos({
  atendimento,
}: {
  atendimento: Periodizado<AtendimentoDoPeriodo>;
}) {
  const atual = atendimento.atual;
  const anterior = atendimento.anterior;
  const enviadas = atual.mensagens.saida;
  const enviadasAnterior = anterior?.mensagens.saida ?? null;

  const porAutorSaida = Object.entries(atual.mensagens.porAutor)
    .filter(([autor]) => autor !== "paciente")
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-4">
      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <CartaoKpi
          rotulo="Mensagens enviadas"
          valor={enviadas.toLocaleString("pt-BR")}
          anterior={
            enviadasAnterior !== null
              ? { atual: enviadas, anterior: enviadasAnterior }
              : null
          }
        />
        <CartaoKpi
          rotulo="Mensagens recebidas"
          valor={atual.mensagens.entrada.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.mensagens.entrada,
                  anterior: anterior.mensagens.entrada,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Notas internas"
          valor={atual.mensagens.notasInternas.toLocaleString("pt-BR")}
          notaSemDelta="não saem para o paciente nem contam como envio"
        />
        <CartaoKpi
          rotulo="Custo do período"
          valor="R$ 0,00"
          notaSemDelta="no WhatsApp conectado por QR não há custo por mensagem"
        />
      </section>

      <Secao titulo="Quem enviou" icone={MessageCircleMore}>
        {porAutorSaida.length === 0 ? (
          <EmptyState
            compact
            icon={MessageCircleMore}
            title="Nenhuma mensagem enviada no período"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {porAutorSaida.map(([autor, total]) => (
              <div
                key={autor}
                className="grid content-start gap-2 rounded-xl bg-surface-4 p-3.5"
              >
                <span className="cz-eyebrow text-text-secondary">
                  {AUTOR_ROTULO[autor] ?? autor}
                </span>
                <span className="cz-num text-[24px] leading-none font-semibold text-text-strong">
                  {total.toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="max-w-prose border-t border-border pt-3 text-xs text-text-secondary">
          Quando o canal oficial do WhatsApp estiver ativo, o custo por mensagem
          em reais aparece aqui, calculado pela tabela de preços da Meta, nunca
          por estimativa.
        </p>
      </Secao>
    </div>
  );
}
