import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da fila de espera (cabecalho da pagina e a lista de
// pacientes aguardando horario), nunca giratorio no meio da tela.
export default function CarregandoEspera() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="grid gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-32" />
        <ListSkeleton rows={6} />
      </div>
    </div>
  );
}
