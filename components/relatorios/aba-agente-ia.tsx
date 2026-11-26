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
  StickyNote,
} from "lucide-react";
import type { ReactNode } from "react";

import { CartaoDoAgente } from "@/components/relatorios/agente-ia-resumo";
import { DICA_SEM_ACESSO_A_VALORES } from "@/components/relatorios/cartoes-de-valor";
import { PassagensDaIa } from "@/components/relatorios/passagens-da-ia";
import { Secao } from "@/components/relatorios/secao";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { EmptyState } from "@/components/shared/empty-state";
import { formatarDuracao } from "@/lib/domain/duracao";
import {
  AUTOR_ROTULO,
  METRICAS_DO_AGENTE,
  type RotulosDosMotivos,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AtendimentoDoPeriodo,
  PassagensDaIaDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba Agente de IA (Fase 3, recebe IA e Custos): so o que e REAL hoje.
// - Atendimento humano: conversas, respondidas e a primeira resposta em
//   mediana e p90, nunca media (uma noite sem plantao destruiria a media).
// - Desempenho do agente: numero real com atividade da IA no periodo; sem
//   atividade, "Ainda não medido" com dica, nunca zero. As regras de calculo
//   estao em lib/domain/exportacao-de-resultados.ts.
// - Por que foi para a equipe (23/11/2026): as passagens por motivo, de
//   passagens_da_ia_do_periodo, com carregando, erro e vazio proprios.
// - Mensagens e quem enviou. Custo por mensagem e conceito do canal oficial
//   (isOfficialChannel): com uazapi ou fake o cartao e a nota nem aparecem
//   (regra 3.3), e mesmo no oficial e valor em reais, so admin e gestor.

const DICA_DO_CUSTO = "Aparece com a tabela de preços da Meta.";

export function AbaAgenteIa({
  atendimento,
  canalOficial,
  podeVerValores,
  passagens,
  rotulosDosMotivos = {},
  passagensComErro = false,
  tentarPassagensDeNovo,
}: {
  atendimento: Periodizado<AtendimentoDoPeriodo>;
  canalOficial: boolean;
  podeVerValores: boolean;
  /** passagens_da_ia_do_periodo; undefined = carregando */
  passagens?: PassagensDaIaDoPeriodo;
  /** Os rotulos dos motivos (ROTULO_DO_MOTIVO_DE_ESCALONAMENTO), do servidor. */
  rotulosDosMotivos?: RotulosDosMotivos;
  passagensComErro?: boolean;
  tentarPassagensDeNovo?: ReactNode;
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
          rodape="respondidas pela equipe"
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
          />
        )}
      </section>

      <Secao
        titulo="Desempenho da recepcionista de IA"
        icone={BotMessageSquare}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {METRICAS_DO_AGENTE.map((rotulo) => (
            <CartaoDoAgente
              key={rotulo}
              rotulo={rotulo}
              agente={atual.agente}
              anterior={anterior?.agente ?? null}
            />
          ))}
        </div>
      </Secao>

      <PassagensDaIa
        passagens={passagens}
        rotulos={rotulosDosMotivos}
        erro={passagensComErro}
        tentarDeNovo={tentarPassagensDeNovo}
      />

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
