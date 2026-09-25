import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Cadastros (cabecalho, fileira das oito abas
// sublinhadas, o botao da aba e a tabela), nunca giratorio no meio da tela.
export default function CarregandoCadastros() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-1 overflow-hidden border-b border-border">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex h-10 shrink-0 items-center px-3">
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-3">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-44 rounded-lg" />
        </div>
        <TableSkeleton rows={6} columns={5} />
      </div>
    </div>
  );
}
