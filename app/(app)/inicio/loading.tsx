import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL do Inicio da Fase 3 (Tela 5): cabecalho com
// eyebrow, os 4 cartoes do dia e o bento em duas colunas (Proximas acoes e
// "Consultas por dia, ultimos 7 dias" a esquerda, "Funil de leads" a
// direita). Nunca giratorio no meio da tela.

export default function CarregandoInicio() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-4 md:p-6"
      aria-hidden
    >
      <div className="grid gap-2">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, indice) => (
          <Skeleton key={indice} className="h-[118px] rounded-card" />
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Skeleton className="h-[176px] rounded-card" />
          <Skeleton className="h-[296px] rounded-card" />
        </div>
        <Skeleton className="h-[300px] rounded-card" />
      </div>
    </div>
  );
}
