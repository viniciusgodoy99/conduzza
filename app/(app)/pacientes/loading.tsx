import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da Tela 9 (cabecalho, barra de filtros e a tabela de
// pacientes), nunca giratorio no meio da tela.
export default function CarregandoPacientes() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
        <TableSkeleton rows={8} columns={8} />
      </div>
    </div>
  );
}
