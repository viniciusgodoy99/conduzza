import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL do Inicio com painel (Tela 5, docs/06 secao 5.2):
// cabecalho com eyebrow, a linha do periodo, 4 indicadores e as tres linhas
// do bento (heroi + atendimento, funil + origem, proximas acoes + mensagens).
// Nunca giratorio no meio da tela.

const LINHA_DO_BENTO =
  "grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]";

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
      <Skeleton className="h-3 w-72 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, indice) => (
          <Skeleton key={indice} className="h-[114px] rounded-card" />
        ))}
      </div>
      <div className={LINHA_DO_BENTO}>
        <Skeleton className="h-[184px] rounded-card" />
        <Skeleton className="h-[184px] rounded-card" />
      </div>
      <div className={LINHA_DO_BENTO}>
        <Skeleton className="h-[220px] rounded-card" />
        <Skeleton className="h-[220px] rounded-card" />
      </div>
      <div className={LINHA_DO_BENTO}>
        <Skeleton className="h-[176px] rounded-card" />
        <Skeleton className="h-[176px] rounded-card" />
      </div>
    </div>
  );
}
