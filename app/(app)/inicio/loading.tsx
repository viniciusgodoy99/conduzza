import { CardsSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL do Inicio com painel (Tela 5): cabecalho, faixa de
// 4 indicadores, linha do heroi, funil + origem, mensagens + proximas acoes.
// Nunca giratorio no meio da tela.
export default function CarregandoInicio() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <CardsSkeleton cards={4} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-36 rounded-lg sm:col-span-2" />
        <Skeleton className="h-36 rounded-lg sm:col-span-2" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
    </div>
  );
}
