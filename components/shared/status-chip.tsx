import { STATUS_TONE_VARS, type StatusDefinition } from "@/lib/design/status";
import { cn } from "@/lib/utils";

type StatusChipProps = {
  definition: StatusDefinition;
  /** Sobrescreve o rotulo (ex.: nome do atendente na conversa em atendimento) */
  label?: string;
  /** Iniciais exibidas quando a camada de forma do status e um avatar */
  avatarInitials?: string;
  className?: string;
};

// Anatomia do chip (brief secao 3.5): 24px de altura, raio 6px, icone de 14px
// com traco 1,5px, rotulo 12px semibold, fundo com 12% de opacidade da cor
// semantica e texto na cor cheia. As 3 camadas sao obrigatorias.
export function StatusChip({
  definition,
  label,
  avatarInitials,
  className,
}: StatusChipProps) {
  const tone = STATUS_TONE_VARS[definition.tone];
  const Icon = definition.icon;
  const text = label ?? definition.label;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold whitespace-nowrap",
        className,
      )}
      style={{
        color: tone.strong,
        // Tinta da cor semantica sobre a superficie de card (brief 3.5), com o
        // percentual por tema em --chip-tint. A mistura com var(--card), e nao
        // com transparente, torna o fundo opaco e o contraste deterministico.
        backgroundColor: `color-mix(in srgb, ${tone.base} var(--chip-tint), var(--card))`,
      }}
    >
      {Icon ? (
        <Icon strokeWidth={1.5} className="size-3.5 shrink-0" />
      ) : (
        <span
          aria-hidden
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-foreground"
          style={{
            backgroundColor: `color-mix(in srgb, ${tone.base} 24%, var(--card))`,
          }}
        >
          {avatarInitials ?? "?"}
        </span>
      )}
      <span>{text}</span>
    </span>
  );
}
