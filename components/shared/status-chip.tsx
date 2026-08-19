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

// Chip de status no estilo do handoff: pilula com fundo da familia semantica
// e texto na variante de texto da mesma familia (par validado pelo teste de
// contraste). As 3 camadas sao obrigatorias: icone, rotulo e cor.
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
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        className,
      )}
      style={{ color: tone.text, backgroundColor: tone.bg }}
    >
      {Icon ? (
        <Icon strokeWidth={1.5} className="size-3.5 shrink-0" />
      ) : (
        <span
          aria-hidden
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-foreground"
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
