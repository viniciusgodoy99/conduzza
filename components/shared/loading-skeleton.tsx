import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Carregando com esqueleto na forma do conteudo real, nunca giratorio no meio
// da tela (estado 3 da secao 8 do brief).

export function ListSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Mesma casca e mesmo ritmo da DataTable: cabecalho de 40px sobre o fundo
// sutil e linhas de 44px. "bare" tira a casca, para quando a tabela ja esta
// dentro de um cartao (igual a variante da DataTable).
export function TableSkeleton({
  rows = 8,
  columns = 4,
  variant = "default",
  className,
}: {
  rows?: number;
  columns?: number;
  variant?: "default" | "bare";
  className?: string;
}) {
  const colunas = { gridTemplateColumns: `repeat(${columns}, 1fr)` };
  return (
    <div
      className={cn(
        "grid",
        variant === "default" &&
          "overflow-hidden rounded-card border border-border bg-card shadow-sm",
        className,
      )}
      aria-hidden
    >
      <div
        className="grid items-center gap-3 border-b border-border-strong bg-surface-subtle px-3.5 py-[13px]"
        style={colunas}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 w-3/5" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid h-11 items-center gap-3 border-b border-border px-3.5 last:border-b-0"
          style={colunas}
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-3.5 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

// Casca do StatCard (docs/06 secao 4.7): rotulo pequeno em cima e o numero
// grande embaixo.
export function CardsSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}
      aria-hidden
    >
      {Array.from({ length: cards }).map((_, index) => (
        <div
          key={index}
          className="grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm"
        >
          <Skeleton className="h-2.5 w-3/5" />
          <Skeleton className="h-[34px] w-2/5" />
        </div>
      ))}
    </div>
  );
}
