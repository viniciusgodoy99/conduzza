import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import {
  etiquetasDoLead,
  type TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import { cn } from "@/lib/utils";

// As etiquetas do lead na lista e no cartao do quadro (relato do dono em
// 20/10/2026: a etiqueta gravava, mas so a gaveta mostrava). Ate 2 chips
// compactos, o mesmo ChipDeEtiqueta do Atendimento, e "+N" com as que
// sobram. O tom e o da etiqueta cadastrada com o mesmo nome; sem ela,
// neutro (lib/domain/etiquetas-do-lead.ts). O nome sempre aparece: nunca so
// cor.
//
// O "+N" visual nao e acessivel sozinho (e title nao funciona no toque): o
// leitor de tela ouve o nome das que sobraram, e o title do conjunto traz a
// lista inteira para quem usa o mouse. Os chips encolhem com reticencias; o
// "+N" nunca some. Lead sem etiqueta: nada.

/** Quantas etiquetas aparecem antes do "+N". */
export const ETIQUETAS_VISIVEIS = 2;

export function EtiquetasDoLead({
  tags,
  tons,
  className,
}: {
  tags: readonly string[];
  tons: TonsDasEtiquetas;
  className?: string;
}) {
  if (tags.length === 0) {
    return null;
  }
  const etiquetas = etiquetasDoLead(tags, tons);
  const visiveis = etiquetas.slice(0, ETIQUETAS_VISIVEIS);
  const resto = etiquetas.slice(ETIQUETAS_VISIVEIS);
  return (
    <span
      data-etiquetas-do-lead=""
      title={etiquetas.map((etiqueta) => etiqueta.nome).join(", ")}
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-hidden",
        className,
      )}
    >
      {visiveis.map((etiqueta) => (
        <ChipDeEtiqueta
          key={etiqueta.nome}
          nome={etiqueta.nome}
          tom={etiqueta.tom}
          tamanho="compacto"
          className="max-w-[96px] shrink"
        />
      ))}
      {resto.length > 0 ? (
        <>
          <span
            aria-hidden
            className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] bg-surface-4 px-1.5 cz-num text-[10.5px] font-medium text-foreground"
          >
            {`+${resto.length}`}
          </span>
          <span className="sr-only">
            {`, mais ${resto.map((etiqueta) => etiqueta.nome).join(", ")}`}
          </span>
        </>
      ) : null}
    </span>
  );
}
