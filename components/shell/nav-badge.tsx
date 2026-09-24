import { cn } from "@/lib/utils";

// Contador de um item do menu lateral (Conduzza Design System, docs/06
// secao 5.1). Sem numero inventado: so aparece com contagem real maior que
// zero. Neutro por padrao e lime no item ativo; a variante de alerta
// ("vencido") espera o dono definir o que e item vencido (conflito C20).
//
// Duas pilulas, uma por estado do menu, trocadas pelo CSS (variante
// rail-aberto): ao lado do rotulo com o menu aberto, no canto do icone com
// ele recolhido. As duas sao aria-hidden; o leitor de tela ouve o numero e
// o que ele conta pelo texto sr-only, que entra no nome do link.
export function NavBadge({
  count,
  ativo,
  descricao,
}: {
  count: number | null | undefined;
  /** O item do menu esta aberto (a pilula fica lime). */
  ativo: boolean;
  /** O que o numero conta, ja no singular ou plural certo. */
  descricao: string;
}) {
  if (!count || count <= 0) {
    return null;
  }
  const texto = count > 99 ? "99+" : String(count);
  const cor = ativo
    ? "bg-sidebar-primary text-sidebar-primary-foreground"
    : "bg-(--sidebar-badge) text-(--sidebar-badge-text)";
  return (
    <>
      <span className="sr-only">
        , {count} {descricao}
      </span>
      <span
        aria-hidden
        className={cn(
          "ml-auto hidden items-center rounded-full px-1.5 py-px cz-num text-[11px] leading-4 font-bold rail-aberto:inline-flex",
          cor,
        )}
      >
        {texto}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 cz-num text-[10px] leading-4 font-bold ring-2 ring-sidebar rail-aberto:hidden",
          cor,
        )}
      >
        {texto}
      </span>
    </>
  );
}
