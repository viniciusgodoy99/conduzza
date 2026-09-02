import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da Tela 3 (barra de data e filtros, calha de horarios,
// colunas por profissional e painel de pendencias), nunca giratorio no meio
// da tela.
export default function CarregandoAgenda() {
  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden"
      aria-hidden
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-4 py-2.5">
        <div className="flex items-center gap-1">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-10 w-36 rounded-md" />
          <Skeleton className="size-10 rounded-md" />
        </div>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-32 rounded-md" />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-44 rounded-md" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="w-[62px] shrink-0 border-r border-border bg-surface-1">
            <div className="h-[62px] border-b border-border" />
            <div className="grid gap-10 px-2 pt-6">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="ml-auto h-3 w-8" />
              ))}
            </div>
          </div>
          {Array.from({ length: 3 }).map((_, coluna) => (
            <div
              key={coluna}
              className="min-w-[180px] flex-1 border-r border-border last:border-r-0"
            >
              <div className="flex h-[62px] items-center gap-2 border-b border-border bg-surface-1 px-2.5">
                <Skeleton className="size-8 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <div className="grid gap-2 p-2">
                {Array.from({ length: 5 }).map((_, linha) => (
                  <Skeleton key={linha} className="h-16 rounded-[6px]" />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden w-[264px] shrink-0 border-l border-border bg-card xl:block">
          <div className="grid gap-4 p-4">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-border p-3"
              >
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
