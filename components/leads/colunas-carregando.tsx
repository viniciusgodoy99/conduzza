import { Skeleton } from "@/components/ui/skeleton";

// Colunas do Kanban carregando, no desenho das colunas reais (afundadas, com
// cartoes claros). Usada pelo loading.tsx da rota e pelo leads-client, com
// uma coluna por etapa da jornada.
//
// comDescricao acompanha a reserva do Kanban (02/10/2026): quando alguma
// etapa tem descricao, as colunas reais tem as 2 linhas dela abaixo do
// cabecalho, e o esqueleto reserva o mesmo espaco para os cartoes nao
// pularem quando a lista chega. Quem sabe a jornada passa
// algumaEtapaComDescricao(jornada).
export function ColunasCarregando({
  colunas,
  comDescricao = false,
}: {
  colunas: number;
  comDescricao?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="grid auto-cols-[minmax(228px,1fr)] grid-flow-col items-start gap-3 overflow-x-hidden pb-2"
    >
      {Array.from({ length: Math.max(colunas, 1) }).map((_, coluna) => (
        <div
          key={coluna}
          className="flex min-h-[320px] flex-col gap-[9px] rounded-card bg-surface-4 p-2.5"
        >
          <div className="grid gap-1">
            <div className="flex h-7 items-center gap-2 px-1">
              <Skeleton className="size-3.5 rounded-sm bg-card" />
              <Skeleton className="h-3 w-2/5 bg-card" />
            </div>
            {comDescricao ? (
              <div className="grid h-8 content-center gap-1.5 px-1">
                <Skeleton className="h-2.5 w-11/12 bg-card" />
                <Skeleton className="h-2.5 w-3/5 bg-card" />
              </div>
            ) : null}
          </div>
          {Array.from({ length: 3 }).map((_, cartao) => (
            <div
              key={cartao}
              className="grid gap-2 rounded-xl border border-border bg-card p-[11px] shadow-xs"
            >
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-5 w-2/5 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
