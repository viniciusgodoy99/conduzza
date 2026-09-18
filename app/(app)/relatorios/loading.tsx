import { CardsSkeleton, TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 11: cabecalho, barra de periodo com o
// botao de exportar, a fila de abas, a faixa de indicadores, um bloco de
// barras e a tabela de detalhe. Nunca giratorio no meio da tela.
export default function CarregandoRelatorios() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-[150px]" />
        <Skeleton className="h-10 w-[150px]" />
        <Skeleton className="ml-auto h-10 w-28" />
      </div>
      <Skeleton className="h-9 w-96 max-w-full" />
      <CardsSkeleton cards={4} />
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-40" />
        <TableSkeleton rows={6} columns={5} />
      </div>
    </div>
  );
}
