import { Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";

// Mensagem enviada direto pelo WhatsApp do numero conectado (celular,
// WhatsApp Web, outro aparelho vinculado), fora do sistema (05/10/2026). O
// sistema nao sabe quem digitou, entao no lugar do nome entra "Pelo WhatsApp"
// com o Smartphone, sempre neutro: e o mesmo sentido de "aparelho da clinica"
// que o icone ja tem no selo do numero e no filtro da lista (docs/06 4.6 e
// 5.3). Autoria em tres camadas: lado e pele da bolha enviada, icone e texto.
//
// "Pelo WhatsApp" sozinho e ambiguo para quem ouve (tudo sai pelo WhatsApp):
// o leitor de tela ouve a frase inteira, e o mouse ve a mesma frase no title.
// O rotulo visivel fica fora da arvore de acessibilidade para nao ser lido
// duas vezes.

export const AUTOR_PELO_CELULAR = "Pelo WhatsApp";

export const EXPLICACAO_PELO_CELULAR =
  "Enviada direto pelo WhatsApp da clínica, fora do sistema";

/**
 * Icone e rotulo "Pelo WhatsApp". O tamanho e a cor do texto vem de quem usa
 * (a linha de autor da bolha, a gaveta do lead); o icone acompanha a cor.
 *
 * Bloco flex, nunca inline-flex solto no meio do texto: com o svg como
 * primeiro item, a linha de base de um inline-flex vira a base do icone e o
 * rotulo sobe. Quem usa poe dentro de uma linha flex.
 */
export function MarcaPeloCelular({ className }: { className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center", className)}>
      <span
        aria-hidden
        title={EXPLICACAO_PELO_CELULAR}
        className="flex min-w-0 items-center gap-1"
      >
        <Smartphone className="size-3 shrink-0" />
        {AUTOR_PELO_CELULAR}
      </span>
      <span className="sr-only">{EXPLICACAO_PELO_CELULAR}</span>
    </span>
  );
}
