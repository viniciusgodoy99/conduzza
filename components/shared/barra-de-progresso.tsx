import { cn } from "@/lib/utils";

// Barra fina de proporcao (docs/06 secao 4.6), no desenho do ProgressBar do
// design system Conduzza. Substitui as 4 barras feitas a mao (Resultados,
// Inicio e as duas de Pacientes), que migram no lote de cada tela.
//
// Regras que o DS nao traz e o produto exige:
// - so dois tons, "destaque" (--chart-bar, 3:1 sobre o trilho) e "neutro"
//   (--chart-bar-muted). Tom de status pintando etapa ou meta e proibido
//   (conflito C12): a barra mede, nao julga;
// - o trilho carrega role="img" e aria-label, senao a barra e invisivel para
//   leitor de tela; o numero continua escrito na legenda, a barra nunca e a
//   unica forma de ler o valor;
// - piso de 3% de largura SO para valor maior que zero: barra desenhada para
//   zero mente numa tela de decisao.

export function BarraDeProgresso({
  valor,
  maximo,
  rotulo,
  legenda,
  tamanho = "md",
  tom = "destaque",
  ariaLabel,
  className,
}: {
  valor: number;
  maximo: number;
  /** Texto a esquerda, acima da barra */
  rotulo?: React.ReactNode;
  /** Numero escrito a direita, acima da barra (ex.: "12 de 40") */
  legenda?: React.ReactNode;
  /** md = 7px (padrao); sm = 4px, para dentro de linha de tabela ou cartao */
  tamanho?: "sm" | "md";
  tom?: "destaque" | "neutro";
  ariaLabel: string;
  className?: string;
}) {
  const largura =
    maximo > 0 && valor > 0
      ? Math.min(100, Math.max(3, (valor / maximo) * 100))
      : 0;

  const trilho = (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        "block overflow-hidden rounded-full bg-surface-4",
        tamanho === "sm" ? "h-1" : "h-[7px]",
      )}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-(--dur-slow) ease-out motion-reduce:transition-none"
        style={{
          width: `${largura}%`,
          background:
            tom === "destaque" ? "var(--chart-bar)" : "var(--chart-bar-muted)",
        }}
      />
    </span>
  );

  if (rotulo == null && legenda == null) {
    return <span className={cn("block w-full", className)}>{trilho}</span>;
  }

  return (
    <span className={cn("flex w-full flex-col gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-2">
        {rotulo != null ? (
          <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">
            {rotulo}
          </span>
        ) : (
          <span />
        )}
        {legenda != null ? (
          <span className="shrink-0 cz-num text-xs text-text-secondary">
            {legenda}
          </span>
        ) : null}
      </span>
      {trilho}
    </span>
  );
}
