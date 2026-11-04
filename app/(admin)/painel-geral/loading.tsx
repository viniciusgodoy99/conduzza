import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do Painel geral (cabecalho, os seis cartoes do topo,
// a faixa da saude, o cartao do interruptor geral e o cartao com a barra de
// busca, os quatro filtros e o Exportar e a tabela de onze colunas), nunca
// giratorio no meio da tela.
export default function CarregandoPainelGeral() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-4 md:p-6"
      aria-busy="true"
    >
      <span className="sr-only">Carregando o painel geral</span>
      <div className="grid gap-2" aria-hidden>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={
              i === 0 || i === 5
                ? "col-span-2 grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm lg:col-span-1"
                : "grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm"
            }
          >
            <Skeleton className="h-2.5 w-3/5" />
            <Skeleton className="h-[34px] w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card p-3 shadow-sm"
        aria-hidden
      >
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
      <div
        className="grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm"
        aria-hidden
      >
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="h-10 w-56" />
      </div>
      <div
        className="overflow-hidden rounded-card border border-border bg-card shadow-sm"
        aria-hidden
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Skeleton className="h-10 w-full rounded-lg sm:w-[280px]" />
          <Skeleton className="h-10 w-72 rounded-lg" />
          <Skeleton className="h-10 w-52 rounded-lg" />
          <Skeleton className="h-10 w-56 rounded-lg" />
          <Skeleton className="h-10 w-60 rounded-lg" />
          <Skeleton className="ml-auto h-10 w-28 rounded-lg" />
        </div>
        <TableSkeleton rows={6} columns={11} variant="bare" />
      </div>
    </div>
  );
}
