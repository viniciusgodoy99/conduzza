import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 7 (docs/06 secao 5.10): cabecalho, os
// quatro cartoes seletores de 88px, o cartao de ativacao com a faixa do
// interruptor e a janela, e o cartao das mensagens com a linha do tempo e o
// editor em duas colunas. Nunca giratorio no meio da tela.
export default function CarregandoAutomacoes() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-1.5">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((cartao) => (
          <div
            key={cartao}
            className="flex min-h-[88px] gap-3 rounded-card border border-border bg-card p-3.5 shadow-sm"
          >
            <Skeleton className="size-[34px] shrink-0 rounded-md" />
            <div className="grid flex-1 content-start gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 rounded-card border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between rounded-xl bg-surface-4 px-3.5 py-3">
          <Skeleton className="h-6 w-32 rounded-full bg-surface-5" />
          <Skeleton className="h-[22px] w-10 rounded-full bg-surface-5" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-[360px]">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((dia) => (
            <Skeleton key={dia} className="h-10 w-11 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 rounded-card border border-border bg-card p-4 shadow-sm">
        <Skeleton className="h-4 w-44" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-16" />
          {[0, 1, 2].map((ponto) => (
            <Skeleton key={ponto} className="h-10 w-32 rounded-full" />
          ))}
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <Skeleton className="h-[168px] rounded-lg" />
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3].map((chip) => (
                <Skeleton key={chip} className="h-[30px] w-24" />
              ))}
            </div>
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
          <Skeleton className="h-52 rounded-card" />
        </div>
      </div>
    </div>
  );
}
