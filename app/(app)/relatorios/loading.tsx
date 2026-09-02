import {
  CardsSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de relatorios (cabecalho, cartoes de metricas,
// area de grafico e tabela), nunca giratorio no meio da tela.
export default function CarregandoRelatorios() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <CardsSkeleton cards={4} />
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-40" />
        <TableSkeleton rows={6} columns={4} />
      </div>
    </div>
  );
}
