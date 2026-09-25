import {
  CardsSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 11 (docs/06 secao 5.9): cabecalho com
// eyebrow, barra de periodo com o botao de exportar, a fila de abas em
// linha, a faixa de indicadores, o cartao das barras e o cartao da tabela
// de detalhe. Nunca giratorio no meio da tela.
export default function CarregandoRelatorios() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-2">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3.5 w-64 max-w-full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-[152px]" />
        <Skeleton className="h-10 w-[152px]" />
        <Skeleton className="ml-auto h-10 w-28" />
      </div>
      <div className="flex gap-4 border-b border-border pb-3">
        {Array.from({ length: 5 }).map((_, indice) => (
          <Skeleton key={indice} className="h-4 w-20" />
        ))}
      </div>
      <CardsSkeleton cards={4} className="gap-3" />
      <div className="grid overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex min-h-[52px] items-center border-b border-border px-4">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid gap-3 p-4">
          {Array.from({ length: 4 }).map((_, indice) => (
            <Skeleton key={indice} className="h-2 w-full" />
          ))}
        </div>
      </div>
      <div className="grid overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex min-h-[52px] items-center border-b border-border px-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <TableSkeleton rows={6} columns={5} variant="bare" />
      </div>
    </div>
  );
}
