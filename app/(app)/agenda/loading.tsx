import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da Tela 3, na moldura do design system (docs/06 secao
// 5.6): barra de filtros solta sobre o canvas, a grade num cartao (calha de
// horarios e colunas por profissional) e o painel de pendencias em outro
// cartao. Nunca giratorio no meio da tela.
export default function CarregandoAgenda() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3.5 overflow-hidden px-4 pt-4 pb-6 md:px-6"
      aria-hidden
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="size-10 rounded-md" />
        </div>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-32 rounded-lg" />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-10 w-36 rounded-lg" />
          <Skeleton className="h-10 w-44 rounded-lg" />
          <Skeleton className="size-10 rounded-md" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <div className="w-[62px] shrink-0 border-r border-border bg-card">
            <div className="h-[62px] border-b border-border-strong bg-surface-subtle" />
            <div className="grid gap-[84px] px-2.5 pt-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="ml-auto h-3 w-9" />
              ))}
            </div>
          </div>
          {Array.from({ length: 3 }).map((_, coluna) => (
            <div
              key={coluna}
              className="min-w-[180px] flex-1 border-r border-border last:border-r-0"
            >
              <div className="flex h-[62px] items-center gap-2.5 border-b border-border-strong bg-surface-subtle px-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <div className="grid gap-2 p-2">
                {Array.from({ length: 4 }).map((_, linha) => (
                  <Skeleton key={linha} className="h-20 rounded-md" />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm xl:flex">
          <div className="flex h-12 items-center border-b border-border px-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid gap-3 p-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl border border-border p-3"
              >
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
