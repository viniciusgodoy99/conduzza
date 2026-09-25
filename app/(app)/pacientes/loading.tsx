import {
  CardsSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da Tela 9 (cabecalho, os quatro indicadores e o cartao
// com a barra de filtros e a tabela), nunca giratorio no meio da tela.
export default function CarregandoPacientes() {
  return (
    <div className="flex flex-col gap-3.5 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <CardsSkeleton cards={4} className="gap-3" />
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        <TableSkeleton rows={8} columns={8} variant="bare" />
      </div>
    </div>
  );
}
