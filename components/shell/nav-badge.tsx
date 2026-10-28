// [AG6 urgência] início
import { BellRing } from "lucide-react";
// [AG6 urgência] fim

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
//
// [AG6 urgência] início (D-53, pela recomendacao): a primeira variante de alerta e
// a da conversa urgente, no item do Atendimento. Em 3 camadas, como o
// "vencido" da 5.1 (danger-050 com danger-700 e um icone de 11px): a cor
// (os tokens --sidebar-badge-alerta, iguais nos dois temas, como a
// sidebar), a forma (o BellRing, dono do "Urgente") e o texto ("N
// urgentes", no nome do link). O alerta vence o lime do item ativo: a
// urgencia continua visivel com o Atendimento aberto. Sem a contagem das
// urgentes (null), o tom de sempre. [AG6 urgência] fim

/** O alerta do contador: quantas urgentes e o que o numero quer dizer. */
export type AlertaDoContador = { quantas: number; descricao: string };

export function NavBadge({
  count,
  ativo,
  descricao,
  alerta = null,
}: {
  count: number | null | undefined;
  /** O item do menu esta aberto (a pilula fica lime). */
  ativo: boolean;
  /** O que o numero conta, ja no singular ou plural certo. */
  descricao: string;
  // [AG6 urgência] início
  /** Com urgentes abertas (> 0): a pilula em alerta, com o sino. */
  alerta?: AlertaDoContador | null;
  // [AG6 urgência] fim
}) {
  const emAlerta = alerta !== null && alerta.quantas > 0;
  const total = count && count > 0 ? count : 0;
  if (total === 0 && !emAlerta) {
    return null;
  }
  // [AG6 urgência] início Sem conversa aguardando contada, a pilula diz as
  // urgentes (nunca um zero com o sino).
  const numero = total > 0 ? total : (alerta?.quantas ?? 0);
  const texto = numero > 99 ? "99+" : String(numero);
  const cor = emAlerta
    ? "bg-(--sidebar-badge-alerta) text-(--sidebar-badge-alerta-text)"
    : ativo
      ? "bg-sidebar-primary text-sidebar-primary-foreground"
      : "bg-(--sidebar-badge) text-(--sidebar-badge-text)";
  const sino = emAlerta ? (
    <BellRing aria-hidden className="size-[11px] shrink-0" />
  ) : null;
  // [AG6 urgência] fim
  return (
    <>
      <span className="sr-only">
        {total > 0 ? `, ${total} ${descricao}` : null}
        {/* [AG6 urgência] início */}
        {emAlerta && alerta ? `, ${alerta.quantas} ${alerta.descricao}` : null}
        {/* [AG6 urgência] fim */}
      </span>
      <span
        aria-hidden
        className={cn(
          "ml-auto hidden items-center gap-0.5 rounded-full px-1.5 py-px cz-num text-[11px] leading-4 font-bold rail-aberto:inline-flex",
          cor,
        )}
      >
        {sino}
        {texto}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center gap-px rounded-full px-1 cz-num text-[10px] leading-4 font-bold ring-2 ring-sidebar rail-aberto:hidden",
          cor,
        )}
      >
        {sino}
        {texto}
      </span>
    </>
  );
}
