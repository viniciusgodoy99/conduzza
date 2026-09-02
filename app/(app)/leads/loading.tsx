import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Leads (cabecalho, barra de filtros e o
// Kanban em colunas), nunca giratorio no meio da tela.
export default function CarregandoLeads() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-36" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 5 }).map((_, coluna) => (
          <div
            key={coluna}
            className="grid w-[260px] shrink-0 content-start gap-3 rounded-lg border p-3"
          >
            <Skeleton className="h-4 w-2/5" />
            {Array.from({ length: 3 }).map((_, cartao) => (
              <div key={cartao} className="grid gap-2 rounded-lg border p-3">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
