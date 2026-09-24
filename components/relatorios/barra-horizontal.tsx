// Barra horizontal de magnitude (o unico grafico de ranking permitido pelo
// brief): rotulo a esquerda, trilho no meio, valor mono a direita. O trilho
// carrega role="img" + aria-label (padrao de components/pacientes/comum.tsx):
// sem isso a barra e invisivel para leitor de tela.
//
// Piso de largura so para valor > 0: barra desenhada para zero mente numa
// tela de decisao de dinheiro (achado da revisao de 08/09/2026).

export function BarraHorizontal({
  rotulo,
  valor,
  maximo,
  destaque = true,
}: {
  rotulo: string;
  valor: number;
  maximo: number;
  /** false = tom neutro (ex.: "sem atribuição", que é magnitude sem canal). */
  destaque?: boolean;
}) {
  const largura =
    maximo > 0 && valor > 0 ? Math.max(3, (valor / maximo) * 100) : 0;
  return (
    <div className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3">
      <span className="truncate text-sm">{rotulo}</span>
      <span
        role="img"
        aria-label={`${rotulo}: ${valor}`}
        className="block h-2.5 overflow-hidden rounded-full bg-surface-4"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${largura}%`,
            background: destaque ? "var(--chart-bar)" : "var(--neutral)",
          }}
        />
      </span>
      <span className="text-right font-mono text-sm text-text-secondary tabular-nums">
        {valor.toLocaleString("pt-BR")}
      </span>
    </div>
  );
}
