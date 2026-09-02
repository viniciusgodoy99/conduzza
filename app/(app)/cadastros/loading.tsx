import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Cadastros (cabecalho, fileira das oito abas
// e a tabela da aba ativa), nunca giratorio no meio da tela.
export default function CarregandoCadastros() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-28 rounded-md" />
          ))}
        </div>
        <div className="grid gap-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
          <TableSkeleton rows={6} columns={4} />
        </div>
      </div>
    </div>
  );
}
