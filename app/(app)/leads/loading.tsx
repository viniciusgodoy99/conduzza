import { ColunasCarregando } from "@/components/leads/colunas-carregando";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma da tela de Leads (cabecalho com as acoes, barra de
// filtros e o Kanban em colunas afundadas), nunca giratorio no meio da tela.
// Mesma casca do leads-client: raiz flex com gap de 14px e padding de 24px.
export default function CarregandoLeads() {
  return (
    <div className="flex flex-col gap-3.5 p-6" aria-hidden>
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Skeleton className="hidden h-10 w-44 rounded-lg lg:block" />
          <Skeleton className="h-10 w-40 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-32 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-[150px] rounded-lg" />
        <Skeleton className="h-10 w-[150px] rounded-lg" />
      </div>
      <ColunasCarregando colunas={6} />
    </div>
  );
}
