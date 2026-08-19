// Badge de nao lidas da sidebar, no estilo do handoff (#EF7E70 com texto
// escuro). O contrato existe desde a Fase 0; as fontes de dados chegam nas
// Fases 1 e 4. Sem numero inventado: badge so aparece com contagem real.
export function NavBadge({ count }: { count: number | null | undefined }) {
  if (!count || count <= 0) {
    return null;
  }
  return (
    <span className="ml-auto rounded-full px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium [color:var(--sidebar-badge-text)] tabular-nums [background:var(--sidebar-badge)]">
      {count > 99 ? "99+" : count}
    </span>
  );
}
