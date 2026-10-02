"use client";

import {
  BotMessageSquare,
  Coins,
  MessageCircleMore,
  MessageSquareReply,
  MessageSquareShare,
  MessageSquareText,
  MessagesSquare,
  Reply,
  ReplyAll,
  Sparkles,
  StickyNote,
} from "lucide-react";

import { DICA_DO_AGENTE } from "@/components/relatorios/agente-ia-resumo";
import { DICA_SEM_ACESSO_A_VALORES } from "@/components/relatorios/cartoes-de-valor";
import { Secao } from "@/components/relatorios/secao";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { EmptyState } from "@/components/shared/empty-state";
import { formatarDuracao } from "@/lib/domain/duracao";
import {
  AUTOR_ROTULO,
  METRICAS_DO_AGENTE,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AtendimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba Agente de IA (Fase 3, recebe IA e Custos): so o que e REAL hoje.
// - Atendimento humano: conversas, respondidas e a primeira resposta em
//   mediana e p90, nunca media (uma noite sem plantao destruiria a media).
// - Desempenho do agente (A2): "Ainda não medido" com dica, nunca zero. As
//   regras de calculo estao em lib/domain/exportacao-de-resultados.ts.
// - Mensagens e quem enviou. Custo por mensagem e conceito do canal oficial
//   (isOfficialChannel): com uazapi ou fake o cartao e a nota nem aparecem
//   (regra 3.3), e mesmo no oficial e valor em reais, so admin e gestor.

const DICA_DO_CUSTO =
  "O custo por mensagem do canal oficial chega com a tabela de preços da Meta, nunca por estimativa.";

export function AbaAgenteIa({
  atendimento,
  canalOficial,
  podeVerValores,
}: {
  atendimento: Periodizado<AtendimentoDoPeriodo>;
  canalOficial: boolean;
  podeVerValores: boolean;
}) {
  const atual = atendimento.atual;
  const anterior = atendimento.anterior;
  const resposta = atual.primeiraResposta;
  const porAutorSaida = Object.entries(atual.mensagens.porAutor)
    // So quem ENVIA: 'paciente' e quem recebe.
    .filter(([autor]) => autor !== "paciente")
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-4">
      <section
        aria-label="Atendimento da equipe no período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <CartaoDeMetrica
          rotulo="Conversas iniciadas"
          icone={MessagesSquare}
          valor={atual.conversasIniciadas.toLocaleString("pt-BR")}
          variacao={
            anterior
              ? {
                  atual: atual.conversasIniciadas,
                  anterior: anterior.conversasIniciadas,
                  comparadoCom: "período anterior",
                }
              : null
          }
        />
        <CartaoDeMetrica
          rotulo="Novas conversas respondidas"
          icone={MessageSquareReply}
          valor={resposta.respondidas.toLocaleString("pt-BR")}
          unidade={`de ${resposta.conversas.toLocaleString("pt-BR")}`}
          rodape="primeira mensagem no período, já respondida pela equipe"
        />
        {resposta.medianaSegundos === null ? (
          <CartaoDeMetrica
            rotulo="Primeira resposta (mediana)"
            icone={Reply}
            estado="vazio"
            rodape="nenhuma conversa nova respondida"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Primeira resposta (mediana)"
            icone={Reply}
            valor={formatarDuracao(resposta.medianaSegundos)}
            rodape="metade das conversas respondidas levou esse tempo ou menos"
          />
        )}
        {resposta.p90Segundos === null ? (
          <CartaoDeMetrica
            rotulo="Primeira resposta (90% em até)"
            icone={ReplyAll}
            estado="vazio"
            rodape="nenhuma conversa nova respondida"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Primeira resposta (90% em até)"
            icone={ReplyAll}
            valor={formatarDuracao(resposta.p90Segundos)}
            rodape="9 em cada 10 conversas respondidas levaram esse tempo ou menos"
          />
        )}
      </section>

      <Secao titulo="Desempenho da recepcionista de IA" icone={BotMessageSquare}>
        <p className="max-w-prose text-[13px] text-text-secondary">
          Estes números chegam com o agente de IA. Enquanto ele não atende, não
          existe número para mostrar, e número inventado não entra aqui.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {METRICAS_DO_AGENTE.map((rotulo) => (
            <CartaoDeMetrica
              key={rotulo}
              variante="afundado"
              tamanho="md"
              rotulo={rotulo}
              icone={Sparkles}
              tom="ai"
              estado="nao-medido"
              dica={DICA_DO_AGENTE}
            />
          ))}
        </div>
      </Secao>

      <Secao titulo="Mensagens no período" icone={MessageCircleMore}>
        <div
          className={
            canalOficial
              ? "grid grid-cols-2 gap-3 sm:grid-cols-4"
              : "grid grid-cols-2 gap-3 sm:grid-cols-3"
          }
        >
          <CartaoDeMetrica
            variante="afundado"
            tamanho="md"
            rotulo="Enviadas"
            icone={MessageSquareShare}
            valor={atual.mensagens.saida.toLocaleString("pt-BR")}
            variacao={
              anterior
                ? {
                    atual: atual.mensagens.saida,
                    anterior: anterior.mensagens.saida,
                    comparadoCom: "período anterior",
                  }
                : null
            }
          />
          <CartaoDeMetrica
            variante="afundado"
            tamanho="md"
            rotulo="Recebidas"
            icone={MessageSquareText}
            valor={atual.mensagens.entrada.toLocaleString("pt-BR")}
            variacao={
              anterior
                ? {
                    atual: atual.mensagens.entrada,
                    anterior: anterior.mensagens.entrada,
                    comparadoCom: "período anterior",
                  }
                : null
            }
          />
          <CartaoDeMetrica
            variante="afundado"
            tamanho="md"
            rotulo="Notas internas"
            icone={StickyNote}
            valor={atual.mensagens.notasInternas.toLocaleString("pt-BR")}
            rodape="não saem para o paciente nem contam como envio"
          />
          {canalOficial ? (
            podeVerValores ? (
              <CartaoDeMetrica
                variante="afundado"
                tamanho="md"
                rotulo="Custo do período"
                icone={Coins}
                estado="nao-medido"
                dica={DICA_DO_CUSTO}
              />
            ) : (
              <CartaoDeMetrica
                variante="afundado"
                tamanho="md"
                rotulo="Custo do período"
                icone={Coins}
                estado="sem-acesso"
                dica={DICA_SEM_ACESSO_A_VALORES}
              />
            )
          ) : null}
        </div>
      </Secao>

      <Secao titulo="Quem enviou" icone={MessageSquareShare}>
        {porAutorSaida.length === 0 ? (
          <EmptyState
            compact
            icon={MessageSquareShare}
            title="Nenhuma mensagem enviada no período"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {porAutorSaida.map(([autor, total]) => (
              <CartaoDeMetrica
                key={autor}
                variante="afundado"
                tamanho="md"
                rotulo={AUTOR_ROTULO[autor] ?? autor}
                valor={total.toLocaleString("pt-BR")}
              />
            ))}
          </div>
        )}
      </Secao>
    </div>
  );
}
