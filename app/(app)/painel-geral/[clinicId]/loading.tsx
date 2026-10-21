import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do detalhe da clinica no Painel geral (voltar,
// cabecalho, os seis cartoes de metrica e as duas colunas de cartoes),
// nunca giratorio no meio da tela.
function CartaoEsqueleto({ linhas }: { linhas: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
      <div className="flex min-h-[64px] items-center gap-3 border-b border-border px-4">
        <Skeleton className="size-10 rounded-md" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
      <div className="grid gap-3 p-4">
        {Array.from({ length: linhas }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function CarregandoClinicaNoPainel() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-4 md:p-6"
      aria-busy="true"
    >
      <span className="sr-only">Carregando a clínica</span>
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-10 w-52 rounded-lg" />
        <div className="grid gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="grid content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm"
            >
              <Skeleton className="h-2.5 w-3/5" />
              <Skeleton className="h-[34px] w-2/5" />
            </div>
          ))}
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="grid gap-4">
            <CartaoEsqueleto linhas={1} />
            <CartaoEsqueleto linhas={2} />
            <CartaoEsqueleto linhas={2} />
            <CartaoEsqueleto linhas={3} />
          </div>
          <div className="grid gap-4">
            <CartaoEsqueleto linhas={2} />
            <CartaoEsqueleto linhas={3} />
            <CartaoEsqueleto linhas={2} />
          </div>
        </div>
      </div>
    </div>
  );
}
