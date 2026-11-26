import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

import { ABAS_DE_CADASTROS } from "./abas";

// Esqueleto na forma da tela de Cadastros (cabecalho, fileira das abas
// sublinhadas, o botao da aba e a tabela), nunca giratorio no meio da tela.
// A quantidade de abas vem da mesma lista da tela.
export default function CarregandoCadastros() {
  return (
    <div
      className="mx-auto grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-6"
      aria-hidden
    >
      <Skeleton className="h-7 w-40" />
      <div className="flex gap-1 overflow-hidden border-b border-border">
        {ABAS_DE_CADASTROS.map(([chave]) => (
          <div key={chave} className="flex h-10 shrink-0 items-center px-3">
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
