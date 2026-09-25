import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";

// Barra horizontal de magnitude (o unico grafico de ranking permitido pelo
// brief): rotulo a esquerda, trilho no meio, valor mono a direita. O trilho
// e a BarraDeProgresso do design system (docs/06 secao 4.6), que carrega
// role="img" + aria-label: sem isso a barra e invisivel para leitor de tela.
//
// Piso de largura so para valor > 0 (dentro da BarraDeProgresso): barra
// desenhada para zero mente numa tela de decisao de dinheiro (achado da
// revisao de 08/09/2026).

export function BarraHorizontal({
  rotulo,
  valor,
  maximo,
  total,
  destaque = true,
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
}) {
  const participacao =
    total !== undefined && total > 0
      ? `${((valor / total) * 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}%`
      : null;
  return (
    <div className="grid min-h-7 grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
      <span className="truncate text-[13px] text-foreground" title={rotulo}>
        {rotulo}
      </span>
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
