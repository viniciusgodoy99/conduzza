import {
  ListSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Configuracoes (cabecalho com eyebrow, as seis
// abas sublinhadas e os cartoes da aba de equipe: usuarios, convite, codigo
// e a tabela de papeis), nunca giratorio no meio da tela.

const ABAS = ["w-40", "w-16", "w-20", "w-40", "w-40", "w-32"];

function CabecalhoDeCartao({ largura }: { largura: string }) {
  return (
    <div className="grid gap-1.5 border-b border-border px-4 py-3.5">
      <Skeleton className={`h-4 ${largura}`} />
      <Skeleton className="h-3 w-72 max-w-full" />
    </div>
  );
}

export default function CarregandoConfiguracoes() {
  return (
    <div
      className="mx-auto grid w-full max-w-content content-start gap-4 p-6"
      aria-hidden
    >
      <div className="grid gap-1.5">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="flex gap-4 overflow-hidden border-b border-border pt-2.5 pb-3">
        {ABAS.map((largura, indice) => (
          <Skeleton key={indice} className={`h-4 shrink-0 ${largura}`} />
        ))}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <CabecalhoDeCartao largura="w-48" />
        <ListSkeleton rows={4} className="p-4" />
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <CabecalhoDeCartao largura="w-40" />
        <div className="grid items-end gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <CabecalhoDeCartao largura="w-36" />
        <div className="flex flex-wrap items-center gap-2 p-4">
          <Skeleton className="h-11 w-56" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <CabecalhoDeCartao largura="w-56" />
        <TableSkeleton rows={5} columns={6} variant="bare" />
      </div>
    </div>
  );
}
