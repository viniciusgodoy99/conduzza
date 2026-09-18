import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

// Cartao de indicador do Painel e dos Relatorios, modelado no Cartao dos
// cartoes-do-dia (o padrao bento): rotulo em caixa alta, numero mono grande
// tabular, e a linha de variacao contra o periodo anterior com as 3 camadas
// (seta = forma, texto = rotulo, cor = success/alert).
//
// Regra de honestidade: o delta so aparece quando ele e COMPARAVEL. Taxa de
// coorte (lead -> comparecimento) nao ganha seta: a coorte anterior teve
// mais tempo para maturar e o delta seria estruturalmente enviesado. Nesses
// casos o chamador passa notaSemDelta, que vira a linha de baixo.

export function variacaoPercentual(
  atual: number,
  anterior: number,
): number | null {
  if (anterior <= 0) {
    // Sem base de comparacao: "de 0 para 4" nao e "+infinito por cento".
    return null;
  }
  return ((atual - anterior) / anterior) * 100;
}

export function CartaoKpi({
  rotulo,
  valor,
  anterior,
  notaSemDelta,
  heroi = false,
  children,
}: {
  rotulo: string;
  /** Ja formatado (contagem, percentual ou moeda). */
  valor: string;
  /**
   * Par bruto para a variacao. null = sem comparacao (primeiro periodo, ou
   * comparacao desligada); a linha diz isso em texto, nunca inventa 0%.
   */
  anterior?: { atual: number; anterior: number } | null;
  /** Substitui a linha de delta quando o delta seria desonesto. */
  notaSemDelta?: string;
  heroi?: boolean;
  children?: React.ReactNode;
}) {
  const variacao =
    anterior != null
      ? variacaoPercentual(anterior.atual, anterior.anterior)
      : null;

  return (
    <div
      className={cn(
        "grid content-start gap-2 rounded-lg border bg-card p-4",
        heroi && "sm:col-span-2",
      )}
    >
      <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
        {rotulo}
      </span>
      <span
        className={cn(
          "font-mono leading-none font-semibold tabular-nums",
          heroi ? "text-[40px]" : "text-[34px]",
        )}
      >
        {valor}
      </span>
      {notaSemDelta ? (
        <span className="text-[12.5px] text-text-tertiary">{notaSemDelta}</span>
      ) : variacao !== null ? (
        <span
          className="flex items-center gap-1 text-[12.5px] font-medium"
          style={{
            color:
              variacao > 0
                ? "var(--success-text)"
                : variacao < 0
                  ? "var(--alert-text)"
                  : "var(--neutral-text)",
          }}
        >
          {variacao > 0 ? (
            <ArrowUpRight strokeWidth={1.5} className="size-3.5" aria-hidden />
          ) : variacao < 0 ? (
            <ArrowDownRight
              strokeWidth={1.5}
              className="size-3.5"
              aria-hidden
            />
          ) : (
            <Minus strokeWidth={1.5} className="size-3.5" aria-hidden />
          )}
          {variacao > 0 ? "subiu" : variacao < 0 ? "caiu" : "estável"}{" "}
          {Math.abs(variacao).toLocaleString("pt-BR", {
            maximumFractionDigits: 0,
          })}
          % vs. período anterior
        </span>
      ) : anterior != null ? (
        <span className="text-[12.5px] text-text-tertiary">
          sem base de comparação no período anterior
        </span>
      ) : null}
      {children}
    </div>
  );
}
