import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do Inbox (lista de conversas a esquerda, painel da
// conversa no centro e contexto a direita), nunca giratorio no meio da tela.
export default function CarregandoAtendimento() {
  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden"
      aria-hidden
    >
      <aside className="hidden w-[322px] shrink-0 border-r border-border lg:block">
        <div className="grid gap-4 p-4">
          <Skeleton className="h-9 w-full rounded-md" />
          <ListSkeleton rows={8} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="grid flex-1 content-end gap-3 p-4">
          <Skeleton className="h-12 w-3/5 rounded-lg" />
          <Skeleton className="h-9 w-2/5 justify-self-end rounded-lg" />
          <Skeleton className="h-16 w-1/2 rounded-lg" />
          <Skeleton className="h-12 w-2/5 justify-self-end rounded-lg" />
          <Skeleton className="h-9 w-1/3 rounded-lg" />
        </div>
        <div className="border-t border-border p-4">
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </section>

      <aside className="hidden w-[320px] shrink-0 border-l border-border xl:block">
        <div className="grid gap-4 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </aside>
    </div>
  );
}
