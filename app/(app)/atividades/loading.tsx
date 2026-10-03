import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela Atividades (cabecalho com o botao, barra de
// filtros e a lista agrupada em cartoes), nunca giratorio no meio da tela.
// Mesma casca do atividades-client.
function LinhaEsqueleto() {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="grid flex-1 gap-2 pt-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <Skeleton className="hidden h-6 w-32 rounded-full md:block" />
      <Skeleton className="size-10 shrink-0 rounded-md" />
    </div>
  );
}

export default function CarregandoAtividades() {
  return (
    <div
      className="mx-auto flex w-full max-w-content flex-col gap-4 p-4 md:p-6"
      aria-hidden
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="ml-auto h-10 w-40 rounded-lg" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-10 w-[200px] rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg sm:w-[280px]" />
      </div>
      {[3, 2].map((linhas, grupo) => (
        <div key={grupo} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
            {Array.from({ length: linhas }).map((_, indice) => (
              <LinhaEsqueleto key={indice} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
