import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da Tela 9 (cabecalho, os quatro cartoes de metrica com
// rotulo, numero e rodape, e o cartao com a barra de filtros e a tabela),
// nunca giratorio no meio da tela.
export default function CarregandoPacientes() {
  return (
    <div className="flex flex-col gap-3.5 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm"
          >
            <Skeleton className="h-2.5 w-3/5" />
            <Skeleton className="h-[34px] w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        <TableSkeleton rows={8} columns={8} variant="bare" />
      </div>
    </div>
  );
}
