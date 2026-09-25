import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 10 no desenho do design system (docs/06
// secao 5.8): cabecalho, a linha de botoes, a fila num cartao (grupo e
// linhas) e a lateral com a reoferta e o desempenho, que abaixo de 1280px
// sobe para o topo. Nunca giratorio no meio da tela.
export default function CarregandoEspera() {
  return (
    <div className="flex flex-col gap-3.5 p-6">
      <span role="status" className="sr-only">
        Carregando a lista de espera
      </span>
      <div className="grid gap-2" aria-hidden>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex justify-end gap-2" aria-hidden>
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
      <div
        className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]"
        aria-hidden
      >
        <div className="order-2 overflow-hidden rounded-card border border-border bg-card shadow-sm xl:order-1">
          <div className="grid gap-2 border-b border-border px-4 py-3.5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="border-b border-border bg-surface-subtle px-3 py-2.5">
            <Skeleton className="h-4 w-56" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
            >
              <Skeleton className="size-10 rounded-md" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="size-6 rounded-full" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="order-1 grid items-start gap-3.5 md:grid-cols-2 xl:order-2 xl:grid-cols-1">
          <div className="grid gap-3 rounded-card border border-border bg-card p-4 shadow-sm">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
          <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
            <div className="grid gap-2 border-b border-border px-4 py-3.5">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="grid gap-3 px-4 py-3.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
