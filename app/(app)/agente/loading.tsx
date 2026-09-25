import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da tela de hoje: cabecalho e um cartao com o vazio
// (achado 111: o esqueleto de painel prometia um painel que nao existe).
// Nunca giratorio no meio da tela.
export default function CarregandoAgente() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="grid justify-items-center gap-3 rounded-card border border-border bg-card px-6 py-14 shadow-sm">
        <Skeleton className="size-[52px] rounded-card" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-3.5 w-56 max-w-full" />
        <Skeleton className="mt-1 h-10 w-40" />
      </div>
    </div>
  );
}
