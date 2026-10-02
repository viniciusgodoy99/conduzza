import {
  CardsSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 11 (Fase 3): cabecalho com eyebrow, barra
// de periodo com o botao de exportar, as 4 abas segmentadas, a faixa de 5
// cartoes da Visao geral, o cartao do grafico ao lado da origem e o cartao da
// tabela de campanhas. Nunca giratorio no meio da tela.
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
      <div className="flex h-10 w-fit max-w-full gap-0.5 rounded-lg bg-surface-4 p-[3px]">
        {Array.from({ length: 4 }).map((_, indice) => (
          <Skeleton key={indice} className="h-[34px] w-24 rounded-[7px]" />
        ))}
      </div>
      <CardsSkeleton
        cards={5}
        className="grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5"
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <div className="flex min-h-[52px] items-center border-b border-border px-4">
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="p-4">
            <Skeleton className="h-[200px] w-full" />
          </div>
        </div>
        <div className="grid overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <div className="flex min-h-[52px] items-center border-b border-border px-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid content-start gap-3 p-4">
            {Array.from({ length: 4 }).map((_, indice) => (
              <Skeleton key={indice} className="h-2 w-full" />
            ))}
          </div>
        </div>
      </div>
      <div className="grid overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex min-h-[52px] items-center border-b border-border px-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <TableSkeleton rows={4} columns={4} variant="bare" />
      </div>
    </div>
  );
}
