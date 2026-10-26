import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { descreverTendencia } from "@/components/painel-geral/painel-geral";
import type { TendenciaNoPainel } from "@/lib/queries/painel-geral";
import { cn } from "@/lib/utils";

// A tendencia dos ultimos 30 dias contra os 30 anteriores, no Painel geral
// (segunda leva, 26/10/2026; escolha (3) do dono), na linha da lista e nos
// cartoes do detalhe. A direcao e a do banco (a faixa do estavel e dele);
// aqui, o desenho da variacao do cartao de metrica: a seta e o texto
// visiveis, a frase inteira para o leitor de tela e a cor pela polaridade
// (mais leads e mais conversas e bom), nunca so a cor. Periodo anterior
// zerado: "Sem base", sem seta. Sem estado nem evento.

const COR_DO_SENTIDO = {
  boa: "text-success-text",
  ruim: "text-alert-text",
  neutra: "text-neutral-text",
} as const;

export function TendenciaNaLinha({
  tendencia,
}: {
  tendencia: TendenciaNoPainel;
}) {
  const descrita = descreverTendencia(tendencia);
  if (descrita.direcao === "sem_base") {
    return (
      <span data-direcao="sem_base" className="text-[12px] text-text-secondary">
        <span aria-hidden>{descrita.visivel}</span>
        <span className="sr-only">{descrita.falado}</span>
      </span>
    );
  }
  const Icone =
    descrita.direcao === "subindo"
      ? TrendingUp
      : descrita.direcao === "caindo"
        ? TrendingDown
        : Minus;
  const cor =
    descrita.boa === null
      ? COR_DO_SENTIDO.neutra
      : descrita.boa
        ? COR_DO_SENTIDO.boa
        : COR_DO_SENTIDO.ruim;
  return (
    <span
      data-direcao={descrita.direcao}
      className={cn(
        "inline-flex items-center gap-0.5 cz-num text-[12px] font-semibold",
        cor,
      )}
    >
      <span aria-hidden className="inline-flex items-center gap-0.5">
        <Icone className="size-3 shrink-0" />
        {descrita.visivel}
      </span>
      <span className="sr-only">{descrita.falado}</span>
    </span>
  );
}
