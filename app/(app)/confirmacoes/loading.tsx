import {
  CardsSkeleton,
  ListSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de confirmacoes (cabecalho, abas com acao no
// canto, filtros de dia, cinco cartoes de contagem e a lista agrupada por
// profissional), nunca giratorio no meio da tela.
export default function CarregandoConfirmacoes() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="ml-auto h-10 w-36" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="size-10" />
        <Skeleton className="h-10 w-[168px]" />
        <Skeleton className="size-10" />
        <Skeleton className="h-10 w-24" />
      </div>

      <CardsSkeleton cards={5} className="sm:grid-cols-2 lg:grid-cols-5" />

      <div className="grid gap-4">
        <section className="overflow-hidden rounded-lg border">
          <div className="border-b bg-surface-3 px-3 py-2">
            <Skeleton className="h-4 w-40" />
          </div>
          <ListSkeleton rows={4} className="p-4" />
        </section>
        <section className="overflow-hidden rounded-lg border">
          <div className="border-b bg-surface-3 px-3 py-2">
            <Skeleton className="h-4 w-32" />
          </div>
          <ListSkeleton rows={2} className="p-4" />
        </section>
      </div>
    </div>
  );
}
