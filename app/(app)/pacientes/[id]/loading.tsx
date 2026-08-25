import {
  CardsSkeleton,
  ListSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da ficha (cabecalho, tres cartoes e as duas colunas),
// nunca giratorio no meio da tela.
export default function CarregandoFicha() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="grid gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
      <CardsSkeleton cards={3} className="lg:grid-cols-3" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-3 rounded-lg border p-4">
          <Skeleton className="h-4 w-24" />
          <ListSkeleton rows={4} />
        </div>
        <div className="grid gap-4">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
