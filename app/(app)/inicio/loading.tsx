import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do Inicio (cabecalho e os tres passos de preparacao),
// nunca giratorio no meio da tela.
export default function CarregandoInicio() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="grid min-w-0 flex-1 gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
        ))}
      </div>
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}
