import {
  CardsSkeleton,
  ListSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do painel do agente (cabecalho, cartoes de resumo e o
// painel de configuracao em duas colunas), nunca giratorio no meio da tela.
export default function CarregandoAgente() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <CardsSkeleton cards={3} className="lg:grid-cols-3" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4 rounded-lg border p-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border p-4">
          <Skeleton className="h-4 w-28" />
          <ListSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}
