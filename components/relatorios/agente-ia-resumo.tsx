import { ArrowRight, BotMessageSquare, Reply, Bot } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { Button } from "@/components/ui/button";
import { formatarDuracao } from "@/lib/domain/duracao";
import {
  lerMetricaDoAgente,
  type MetricaDoAgente,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AtendimentoDoPeriodo,
  DesempenhoDoAgente,
} from "@/lib/queries/relatorios";

// Agente de IA na Visao geral: com atividade da IA no periodo, os numeros
// reais dela; sem atividade, "Ainda não medido" com a dica, nunca zero. Ao lado,
// o atendimento HUMANO: a mediana da primeira resposta da equipe. As regras de
// calculo do agente estao em lib/domain/exportacao-de-resultados.ts
// (METRICAS_DO_AGENTE).

export const DICA_DO_AGENTE =
  "Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.";

const RESUMO_DO_AGENTE = [
  "Resolvidas sem humano",
  "Transferidas para a equipe",
  "Primeira resposta da IA",
] as const;

/** O cartao de uma metrica do agente, o mesmo na Visao geral e na aba da IA. */
export function CartaoDoAgente({
  rotulo,
  agente,
  anterior = null,
}: {
  rotulo: MetricaDoAgente;
  agente: DesempenhoDoAgente | null;
  anterior?: DesempenhoDoAgente | null;
}) {
  const leitura = lerMetricaDoAgente(rotulo, agente, anterior);
  const casca = {
    variante: "afundado",
    tamanho: "md",
    rotulo,
    icone: Bot,
    tom: "ai",
  } as const;
  if (leitura.estado === "nao-medido") {
    return (
      <CartaoDeMetrica
        {...casca}
        estado="nao-medido"
        dica={DICA_DO_AGENTE}
      />
    );
  }
  if (leitura.estado === "vazio") {
    return (
      <CartaoDeMetrica {...casca} estado="vazio" rodape={leitura.rodape} />
    );
  }
  return (
    <CartaoDeMetrica
      {...casca}
      valor={leitura.valor}
      rodape={leitura.rodape}
      variacao={leitura.variacao}
    />
  );
}

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
          <CartaoDoAgente
            key={rotulo}
            rotulo={rotulo}
            agente={atendimento.agente}
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
