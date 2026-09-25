import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto na forma do Atendimento (docs/06 secao 5.3): lista de 336px com
// busca, posse e chips; fio com cabecalho, bolhas e compositor; contexto pela
// MESMA container query da tela. Nunca giratorio no meio da tela. No
// celular, como a tela, mostra so a lista.
export default function CarregandoAtendimento() {
  return (
    <div
      className="@container/inbox flex h-full min-h-0 overflow-hidden"
      aria-hidden
    >
      <aside className="flex w-full shrink-0 flex-col border-r border-border bg-card lg:w-inbox-list">
        <div className="grid gap-[9px] border-b border-border p-3">
          <Skeleton className="h-10 w-full rounded-full" />
          <Skeleton className="h-[34px] w-full rounded-lg" />
          <div className="flex flex-wrap gap-1.5 py-1.5">
            <Skeleton className="h-7 w-32 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </div>
        <div className="grid">
          {Array.from({ length: 8 }).map((_, indice) => (
            <div
              key={indice}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 border-b border-border px-3.5 py-[11px]"
            >
              <Skeleton className="size-9 rounded-full" />
              <div className="grid gap-[7px]">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3 w-9" />
                </div>
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col bg-background lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-2 p-4">
          <Skeleton className="h-12 w-3/5 rounded-bubble rounded-bl-[6px]" />
          <Skeleton className="h-9 w-2/5 self-end rounded-bubble rounded-br-[6px]" />
          <Skeleton className="h-16 w-1/2 rounded-bubble rounded-bl-[6px]" />
          <Skeleton className="h-12 w-2/5 self-end rounded-bubble rounded-br-[6px]" />
          <Skeleton className="h-9 w-1/3 rounded-bubble rounded-bl-[6px]" />
        </div>
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <Skeleton className="h-[60px] w-full rounded-card" />
        </div>
      </section>

      <aside className="hidden w-context-panel shrink-0 border-l border-border bg-card @min-[1100px]/inbox:block">
        <div className="grid justify-items-center gap-2.5 p-4">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <div className="grid gap-2.5 p-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-6 w-3/5 rounded-sm" />
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </aside>
    </div>
  );
}
