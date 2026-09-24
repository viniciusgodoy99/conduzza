import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// O tailwind-merge precisa conhecer os nomes que o globals.css acrescenta ao
// tema (Conduzza Design System, docs/06 secao 4.4). Sem isso,
// cn("rounded-lg", "rounded-card") manteria as duas classes e o resultado
// dependeria da ordem do CSS. Os utilitarios cz-* (cz-num, cz-eyebrow,
// cz-scroll, cz-transition) e hit-40 nao entram: nao disputam propriedade com
// nenhuma classe do Tailwind (por isso cz-eyebrow nao carrega cor).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["control", "card", "bubble", "modal"],
      shadow: ["pop"],
      spacing: [
        "sidebar",
        "sidebar-collapsed",
        "topbar",
        "inbox-list",
        "context-panel",
        "gutter",
      ],
      container: ["content"],
      ease: ["standard"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
