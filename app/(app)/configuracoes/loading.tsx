import {
  ListSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Configuracoes (cabecalho, as duas abas e os
// cartoes da aba de equipe: lista de membros, convite e a tabela de papeis),
// nunca giratorio no meio da tela.
export default function CarregandoConfiguracoes() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-3 rounded-lg border p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <ListSkeleton rows={4} className="mt-3" />
        <div className="mt-3 grid gap-3 border-t pt-6">
          <Skeleton className="h-4 w-36" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 rounded-lg border p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <TableSkeleton rows={5} columns={4} className="mt-3" />
      </div>
    </div>
  );
}
