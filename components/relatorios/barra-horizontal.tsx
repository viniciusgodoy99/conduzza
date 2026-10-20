import Link from "next/link";

import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { cn } from "@/lib/utils";

// Barra horizontal de magnitude (o unico grafico de ranking permitido pelo
// brief): rotulo a esquerda, trilho no meio, valor mono a direita. O trilho
// e a BarraDeProgresso do design system (docs/06 secao 4.6), que carrega
// role="img" + aria-label: sem isso a barra e invisivel para leitor de tela.
//
// Piso de largura so para valor > 0 (dentro da BarraDeProgresso): barra
// desenhada para zero mente numa tela de decisao de dinheiro (achado da
// revisao de 08/09/2026).
//
// Com `link` (Origem dos leads, pedido do dono em 20/10/2026), o rotulo vira
// link para a lista de Leads com os mesmos leads da barra: alvo de 40px de
// altura (a linha cresce junto, para dois alvos nunca se sobreporem) e o
// nome acessivel dizendo o destino.

export function BarraHorizontal({
  rotulo,
  valor,
  maximo,
  total,
  destaque = true,
  link,
}: {
  rotulo: string;
  valor: number;
  maximo: number;
  /**
   * Denominador da participacao. Presente, o valor ganha " · 44,0%" ao lado
   * (e no aria-label): a participacao escrita e o que substitui a rosca,
   * proibida pelo brief (conflito C12).
   */
  total?: number;
  /** false = tom neutro (ex.: "sem atribuição", que é magnitude sem canal). */
  destaque?: boolean;
  /** O rotulo vira link: o destino e o nome acessivel dele. */
  link?: { href: string; nome: string };
}) {
  const participacao =
    total !== undefined && total > 0
      ? `${((valor / total) * 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}%`
      : null;
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3",
        link ? "min-h-10" : "min-h-7",
      )}
    >
      {link ? (
        <Link
          href={link.href}
          // Um link por barra, todos para /leads: sem prefetch, a lista
          // carrega no clique.
          prefetch={false}
          aria-label={link.nome}
          title={rotulo}
          className="flex min-h-10 min-w-0 items-center rounded-sm text-[13px] font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <span className="truncate">{rotulo}</span>
        </Link>
      ) : (
        <span className="truncate text-[13px] text-foreground" title={rotulo}>
          {rotulo}
        </span>
      )}
      <BarraDeProgresso
        valor={valor}
        maximo={maximo}
        tom={destaque ? "destaque" : "neutro"}
        ariaLabel={`${rotulo}: ${valor}${participacao ? `, ${participacao}` : ""}`}
      />
      <span className="text-right cz-num text-[13px] font-semibold whitespace-nowrap text-text-strong">
        {valor.toLocaleString("pt-BR")}
        {participacao ? (
          <span className="font-normal text-text-secondary">
            {" · "}
            {participacao}
          </span>
        ) : null}
      </span>
    </div>
  );
}
