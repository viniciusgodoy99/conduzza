import {
  CardsSkeleton,
  ListSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de confirmacoes (docs/06 secao 5.7): cabecalho
// com a data, abas segmentadas com a acao no canto, navegacao de dia, cinco
// cartoes de contagem e o cartao da lista com o filtro, o cabecalho de
// colunas e os grupos por profissional. Nunca giratorio no meio da tela.
export default function CarregandoConfirmacoes() {
  return (
    <div className="flex flex-col gap-3.5 p-6" aria-hidden>
      <div className="grid gap-1.5">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-72 max-w-full rounded-lg" />
        <Skeleton className="ml-auto h-10 w-48 rounded-lg" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="size-10 rounded-md" />
        <Skeleton className="h-10 w-[168px] rounded-lg" />
        <Skeleton className="size-10 rounded-md" />
      </div>

      <CardsSkeleton cards={5} className="sm:grid-cols-2 lg:grid-cols-5" />

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="border-b border-border px-3.5 py-3">
          <Skeleton className="h-10 w-[420px] max-w-full rounded-lg" />
        </div>
        <div className="hidden h-9 items-center gap-3 border-b border-border-strong bg-surface-subtle px-3.5 xl:flex">
          {["w-14", "w-36", "w-28", "w-24", "w-36", "w-44"].map(
            (largura, indice) => (
              <Skeleton key={indice} className={`h-2.5 ${largura}`} />
            ),
          )}
        </div>
        {[4, 2].map((linhas, grupo) => (
          <section key={grupo}>
            <div className="border-b border-border bg-surface-subtle px-3.5 py-2">
              <Skeleton className="h-3.5 w-40" />
            </div>
            <ListSkeleton rows={linhas} className="px-3.5 py-3" />
          </section>
        ))}
      </div>
    </div>
  );
}
