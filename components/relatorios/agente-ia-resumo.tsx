import { ArrowRight, BotMessageSquare, Reply, Sparkles } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { Button } from "@/components/ui/button";
import { formatarDuracao } from "@/lib/domain/duracao";
import type { AtendimentoDoPeriodo } from "@/lib/queries/relatorios";

// Agente de IA na Visao geral (A2): o agente ainda nao atende, entao os
// numeros dele sao "Ainda não medido" com a dica, nunca zero. O unico numero
// real do bloco e o atendimento HUMANO: a mediana da primeira resposta da
// equipe. As regras de calculo do agente estao documentadas em
// lib/domain/exportacao-de-resultados.ts (METRICAS_DO_AGENTE).

export const DICA_DO_AGENTE =
  "Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.";

const RESUMO_DO_AGENTE = [
  "Resolvidas sem humano",
  "Transferidas para a equipe",
  "Primeira resposta da IA",
] as const;

export function AgenteIaResumo({
  atendimento,
  aoVerDetalhes,
  className,
}: {
  atendimento: AtendimentoDoPeriodo;
  aoVerDetalhes: () => void;
  className?: string;
}) {
  const mediana = atendimento.primeiraResposta.medianaSegundos;
  return (
    <Secao titulo="Agente de IA" icone={BotMessageSquare} className={className}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {RESUMO_DO_AGENTE.map((rotulo) => (
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
        {mediana === null ? (
          <CartaoDeMetrica
            variante="afundado"
            tamanho="md"
            rotulo="Primeira resposta da equipe"
            icone={Reply}
            estado="vazio"
            rodape="nenhuma conversa nova respondida"
          />
        ) : (
          <CartaoDeMetrica
            variante="afundado"
            tamanho="md"
            rotulo="Primeira resposta da equipe"
            icone={Reply}
            valor={formatarDuracao(mediana)}
            rodape="mediana do período"
          />
        )}
      </div>
      <Button variant="ghost" className="w-fit" onClick={aoVerDetalhes}>
        Ver detalhes em Agente de IA
        <ArrowRight aria-hidden />
      </Button>
    </Secao>
  );
}
