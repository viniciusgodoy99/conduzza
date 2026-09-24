import { STATUS_TONE_VARS, type StatusDefinition } from "@/lib/design/status";
import { cn } from "@/lib/utils";

type StatusChipProps = {
  definition: StatusDefinition;
  /** Sobrescreve o rotulo (ex.: nome do atendente na conversa em atendimento) */
  label?: string;
  /** Iniciais exibidas quando a camada de forma do status e um avatar */
  avatarInitials?: string;
  /** md (24px) e o padrao; sm (20px) para tabela densa, cartao e lista */
  size?: "sm" | "md";
  className?: string;
};

// Chip de status com a pele do Badge do design system Conduzza: pilula com
// fundo da familia semantica e texto na variante de texto da mesma familia
// (par validado pelo teste de contraste). As 3 camadas sao obrigatorias:
// icone, rotulo e cor. Nunca o "dot" do Badge do DS no lugar do icone
// (docs/06, conflito C8): a forma do icone e a camada que discrimina o status.
export function StatusChip({
  definition,
  label,
  avatarInitials,
  size = "md",
  className,
}: StatusChipProps) {
  const tone = STATUS_TONE_VARS[definition.tone];
  const Icon = definition.icon;
  const text = label ?? definition.label;
  const pequeno = size === "sm";

  return (
    <span
      data-size={size}
      className={cn(
        "inline-flex items-center rounded-full font-semibold tracking-[-0.005em] whitespace-nowrap",
        pequeno
          ? "h-5 gap-1 px-[7px] text-[11px]"
          : "h-6 gap-1.5 px-[9px] text-xs",
        className,
      )}
      style={{ color: tone.text, backgroundColor: tone.bg }}
    >
      {Icon ? (
        <Icon
          aria-hidden
          className={cn(
            "shrink-0",
            pequeno ? "size-3" : "size-[13px]",
            definition.iconClassName,
          )}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-foreground",
            pequeno ? "size-3" : "size-[13px]",
          )}
          style={{
            backgroundColor: `color-mix(in srgb, ${tone.marker} 30%, ${tone.bg})`,
          }}
        >
          {avatarInitials ?? "?"}
        </span>
      )}
      <span>{text}</span>
    </span>
  );
}
