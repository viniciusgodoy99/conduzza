import { STATUS_TONE_VARS } from "@/lib/design/status";
import type { TomDeEtiqueta } from "@/lib/domain/etiquetas-de-conversa";
import { cn } from "@/lib/utils";

// Chip de etiqueta de conversa. Nao reusa o StatusChip de proposito: aquele
// exige um icone e cai no avatar de iniciais quando nao tem, e etiqueta nao
// e status do produto, e vocabulario da clinica.
//
// A camada discriminante e o NOME, sempre renderizado: a cor acompanha, nunca
// carrega sozinha o significado (regra 5).

export function ChipDeEtiqueta({
  nome,
  tom,
  className,
}: {
  nome: string;
  tom: TomDeEtiqueta;
  className?: string;
}) {
  const cores = STATUS_TONE_VARS[tom];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] max-w-full shrink-0 items-center overflow-hidden rounded-full px-1.5 text-[10.5px] font-semibold",
        className,
      )}
      style={{ color: cores.text, backgroundColor: cores.bg }}
      title={nome}
    >
      {/* O truncate vive no TEXTO: num container inline-flex ele nao
          produziria reticencias, e dois nomes longos apareceriam cortados
          no mesmo ponto, indistinguiveis. */}
      <span className="truncate">{nome}</span>
    </span>
  );
}
