import {
  CardsSkeleton,
  ListSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da ficha (voltar, cabecalho, tres cartoes e as duas
// colunas de blocos, com Atividades no topo da da direita), nunca giratorio
// no meio da tela.
function BlocoEsqueleto({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
      <div className="flex min-h-[52px] items-center border-b border-border px-4">
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function CarregandoFicha() {
  return (
    <div
      className="mx-auto flex w-full max-w-content flex-col gap-4 p-6"
      aria-hidden
    >
      <Skeleton className="h-10 w-40" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="grid gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      <CardsSkeleton
        cards={3}
        className="grid-cols-1 sm:grid-cols-3 lg:grid-cols-3"
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <BlocoEsqueleto>
          <ListSkeleton rows={4} />
        </BlocoEsqueleto>
        <div className="grid gap-4">
          {/* Atividades: linhas compactas com o concluir de 40px e, embaixo,
              "Nova atividade" e "Ver todas". */}
          <BlocoEsqueleto>
            <div className="grid gap-3">
              {[0, 1].map((linha) => (
                <div key={linha} className="flex items-center gap-2.5">
                  <Skeleton className="size-10 shrink-0 rounded-lg" />
                  <div className="grid flex-1 gap-2">
                    <Skeleton className="h-3.5 w-3/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Skeleton className="h-10 w-36 rounded-lg" />
                <Skeleton className="h-10 w-24 rounded-lg" />
              </div>
            </div>
          </BlocoEsqueleto>
          <BlocoEsqueleto>
            <div className="grid gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </BlocoEsqueleto>
          <BlocoEsqueleto>
            <Skeleton className="h-16 w-full rounded-xl" />
          </BlocoEsqueleto>
        </div>
      </div>
    </div>
  );
}
