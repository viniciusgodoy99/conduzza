import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de automacoes (cabecalho com acao e lista de
// reguas com interruptor a direita), nunca giratorio no meio da tela.
export default function CarregandoAutomacoes() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 rounded-lg border p-4"
          >
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-32" />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
