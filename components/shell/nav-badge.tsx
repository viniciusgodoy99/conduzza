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
// urgentes (null), o tom de sempre.
//
// O NUMERO DO SINO E O DAS URGENTES (revisao da AG6a): o sino ao lado do
// numero de conversas aguardando ("sino 7") parecia 7 urgentes. A pilula
// de alerta leva o sino e o numero de urgentes; com o menu aberto, o
// numero de aguardando fica numa pilula propria, ao lado, no tom de
// sempre; recolhido, o canto do icone tem lugar para uma pilula so, e o
// alerta vence (o leitor de tela ouve os dois numeros no nome do link).
// [AG6 urgência] fim

/** O alerta do contador: quantas urgentes e o que o numero quer dizer. */
export type AlertaDoContador = { quantas: number; descricao: string };

/** O numero da pilula (acima de 99, "99+"). */
function textoDoNumero(numero: number): string {
  return numero > 99 ? "99+" : String(numero);
}

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
  // [AG6 urgência] início
  const corDoNumero = ativo
    ? "bg-sidebar-primary text-sidebar-primary-foreground"
    : "bg-(--sidebar-badge) text-(--sidebar-badge-text)";
  const corDoAlerta =
    "bg-(--sidebar-badge-alerta) text-(--sidebar-badge-alerta-text)";
  const urgentes = emAlerta && alerta ? alerta.quantas : 0;
  const sino = emAlerta ? (
    <BellRing aria-hidden className="size-[11px] shrink-0" />
  ) : null;
  // [AG6 urgência] fim
  return (
    <>
      <span className="sr-only">
        {/* [AG6 urgência] início As urgentes primeiro: e o que mais importa. */}
        {emAlerta && alerta ? `, ${alerta.quantas} ${alerta.descricao}` : null}
        {/* [AG6 urgência] fim */}
        {total > 0 ? `, ${total} ${descricao}` : null}
      </span>
      {/* Menu aberto: o alerta (o sino com o numero de urgentes) e, ao lado,
          o numero de aguardando no tom de sempre. */}
      <span
        aria-hidden
        className="ml-auto hidden shrink-0 items-center gap-1 rail-aberto:inline-flex"
      >
        {/* [AG6 urgência] início */}
        {emAlerta ? (
          <span
            data-pilula="alerta"
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px cz-num text-[11px] leading-4 font-bold",
              corDoAlerta,
            )}
          >
            {sino}
            {textoDoNumero(urgentes)}
          </span>
        ) : null}
        {/* [AG6 urgência] fim */}
        {total > 0 ? (
          <span
            data-pilula="numero"
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-px cz-num text-[11px] leading-4 font-bold",
              corDoNumero,
            )}
          >
            {textoDoNumero(total)}
          </span>
        ) : null}
      </span>
      {/* Recolhido: uma pilula so no canto do icone; o alerta vence. */}
      <span
        aria-hidden
        data-pilula={emAlerta ? "alerta" : "numero"}
        className={cn(
          "absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center gap-px rounded-full px-1 cz-num text-[10px] leading-4 font-bold ring-2 ring-sidebar rail-aberto:hidden",
          emAlerta ? corDoAlerta : corDoNumero,
        )}
      >
        {/* [AG6 urgência] início */}
        {sino}
        {textoDoNumero(emAlerta ? urgentes : total)}
        {/* [AG6 urgência] fim */}
      </span>
    </>
  );
}
