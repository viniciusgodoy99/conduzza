// Badge de contagem do rail (Atendimento e Confirmações). O contrato existe
// desde a Fase 0; as fontes de dados chegam nas Fases 1 e 4. Sem numero
// inventado: badge so aparece com contagem real.
export function NavBadge({
  count,
  urgent = false,
}: {
  count: number | null | undefined;
  urgent?: boolean;
}) {
  if (!count || count <= 0) {
    return null;
  }
  return (
    <span
      className={
        urgent
          ? "ml-auto rounded-full bg-alert px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium text-destructive-foreground tabular-nums"
          : "ml-auto rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium text-foreground tabular-nums"
      }
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
