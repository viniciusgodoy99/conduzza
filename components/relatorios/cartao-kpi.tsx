import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

// Cartao de indicador do Painel e dos Relatorios na receita StatCard do
// design system Conduzza (docs/06 secao 4.7): rotulo em eyebrow, numero mono
// grande tabular (cz-num), e a linha de variacao contra o periodo anterior
// com as 3 camadas (seta = forma, texto = rotulo, cor = success/alert).
//
// Heroi (D16, so o Inicio usa): o unico preenchimento lime da tela, texto em
// primary-foreground cheio (sem opacidade) e a variacao numa pilula clara
// com a cor semantica, para as 3 camadas continuarem legiveis sobre o lime.
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
  polaridade = "maior-melhor",
  notaSemDelta,
  heroi = false,
  className,
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
  /**
   * O que "subir" significa para a clinica. Falta e cancelamento sobem para
   * PIOR: sem isto, alta de faltas sairia verde na tela que renova contrato.
   */
  polaridade?: "maior-melhor" | "menor-melhor";
  /** Substitui a linha de delta quando o delta seria desonesto. */
  notaSemDelta?: React.ReactNode;
  heroi?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const variacao =
    anterior != null
      ? variacaoPercentual(anterior.atual, anterior.anterior)
      : null;

  // Valor sem digito ("sem dados", sem denominador) nao e numero: vai como
  // texto de campo vazio, nao em mono de 34px.
  const semNumero = !/\d/.test(valor);

  // Cor da variacao pela polaridade, sempre com seta e texto junto.
  const corDaVariacao =
    variacao === null || variacao === 0
      ? "text-neutral-text"
      : variacao > 0 === (polaridade === "maior-melhor")
        ? "text-success-text"
        : "text-alert-text";

  return (
    <div
      className={cn(
        "grid min-w-0 content-start rounded-card border",
        heroi
          ? "gap-3 border-transparent bg-primary p-5 text-primary-foreground shadow-none"
          : "gap-2.5 border-border bg-card p-4 shadow-sm",
        className,
      )}
    >
      <span
        className={cn(
          "cz-eyebrow",
          heroi ? "text-primary-foreground" : "text-text-secondary",
        )}
      >
        {rotulo}
      </span>
      {semNumero ? (
        // Campo vazio (docs/06 4.7): "Sem dados" escrito, na altura do
        // numero para a grade de cartoes nao pular, nunca travessao.
        <span
          className={cn(
            "flex min-h-[34px] items-end text-base leading-tight font-semibold",
            heroi ? "text-primary-foreground" : "text-text-secondary",
          )}
        >
          {valor.charAt(0).toUpperCase() + valor.slice(1)}
        </span>
      ) : (
        <span
          className={cn(
            "cz-num leading-none font-semibold",
            heroi
              ? "text-[40px] text-primary-foreground"
              : "text-[34px] text-text-strong",
          )}
        >
          {valor}
        </span>
      )}
      {notaSemDelta ? (
        <span
          className={cn(
            "text-xs",
            heroi ? "text-primary-foreground" : "text-text-secondary",
          )}
        >
          {notaSemDelta}
        </span>
      ) : variacao !== null ? (
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-semibold",
            corDaVariacao,
            heroi && "h-6 w-fit rounded-full bg-card px-2",
          )}
        >
          {variacao > 0 ? (
            <ArrowUpRight className="size-[13px] shrink-0" aria-hidden />
          ) : variacao < 0 ? (
            <ArrowDownRight className="size-[13px] shrink-0" aria-hidden />
          ) : (
            <Minus className="size-[13px] shrink-0" aria-hidden />
          )}
          <span>
            {variacao > 0 ? "subiu" : variacao < 0 ? "caiu" : "estável"}{" "}
            <span className="cz-num">
              {Math.abs(variacao).toLocaleString("pt-BR", {
                maximumFractionDigits: 0,
              })}
              %
            </span>{" "}
            vs. período anterior
          </span>
        </span>
      ) : anterior != null ? (
        <span
          className={cn(
            "text-xs",
            heroi ? "text-primary-foreground" : "text-text-secondary",
          )}
        >
          sem base de comparação no período anterior
        </span>
      ) : null}
      {children}
    </div>
  );
}
