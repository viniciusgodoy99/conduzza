import { STATUS_TONE_VARS } from "@/lib/design/status";
import { cn } from "@/lib/utils";

// Origem do lead (canal de aquisicao) em pilula neutra, com a mesma medida do
// StatusChip. Origem e categoria, nao estado: por isso fica sem icone e sem
// cor de familia, e nunca e lida como status. Usada no cartao do Kanban (sm)
// e no cabecalho do drawer (md).
export function ChipDeOrigem({
  rotulo,
  size = "sm",
}: {
  rotulo: string;
  size?: "sm" | "md";
}) {
  const neutro = STATUS_TONE_VARS.neutral;
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center rounded-full font-semibold tracking-[-0.005em] whitespace-nowrap",
        size === "sm" ? "h-5 px-[7px] text-[11px]" : "h-6 px-[9px] text-xs",
      )}
      style={{ color: neutro.text, backgroundColor: neutro.bg }}
    >
      <span className="truncate">{rotulo}</span>
    </span>
  );
}
