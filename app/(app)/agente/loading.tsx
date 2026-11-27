import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto NEUTRO: o loading nao sabe a clinica, e so duas clinicas (a
// fase controlada) tem o painel; nas outras a tela e o vazio. Por isso so o
// cabecalho e um cartao com linhas genericas, sem prometer abas nem
// simulador (achado 111: o esqueleto nao pode prometer um painel que nao
// existe). Nunca giratorio no meio da tela.
export default function CarregandoAgente() {
  return (
    <div
      className="grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-3 rounded-card border border-border bg-card p-6">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </div>
  );
}
