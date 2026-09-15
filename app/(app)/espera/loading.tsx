import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma REAL da Tela 10 (cabecalho, a linha de botoes, os tres
// cartoes de metrica e a fila agrupada), nunca giratorio no meio da tela.
export default function CarregandoEspera() {
  return (
    <div className="grid gap-6 p-6" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex justify-end gap-2">
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-56" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
