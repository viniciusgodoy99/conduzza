import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 7 (cabecalho, as quatro pilulas de aba, o
// cartao de ativacao com interruptor, a linha do tempo de pontos e o editor
// em duas colunas), nunca giratorio no meio da tela.
export default function CarregandoAutomacoes() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((dia) => (
            <Skeleton key={dia} className="h-10 w-11" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 rounded-lg border p-4">
        <Skeleton className="h-4 w-44" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          {[0, 1, 2].map((ponto) => (
            <Skeleton key={ponto} className="h-10 w-32 rounded-full" />
          ))}
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <Skeleton className="h-36" />
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((chip) => (
                <Skeleton key={chip} className="h-8 w-20 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          <Skeleton className="h-52" />
        </div>
      </div>
    </div>
  );
}
