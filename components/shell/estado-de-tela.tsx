import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Bloco de estado de tela inteira do shell (docs/06 secao 5.1): ladrilho de
// 52px com o icone, titulo, texto e acoes. Serve aos estados antes do shell
// (aguardando liberacao, sem clinica, acesso que nao carregou, criar
// clinica), ao error.tsx e aos not-found. Status nunca so por cor: o icone
// de forma propria e o titulo em texto carregam o sentido.

type Tom = "neutro" | "aviso" | "alerta" | "destaque";

// Ladrilho e cor do icone por tom. So o de erro pinta o ladrilho; os
// demais ficam no afundado e a cor vai no icone.
const LADRILHO: Record<Tom, string> = {
  neutro: "bg-surface-4 text-text-secondary",
  aviso: "bg-surface-4 text-warning-text",
  alerta: "bg-alert-bg text-alert-text",
  destaque: "bg-surface-4 text-primary-text",
};

export function EstadoDeTela({
  icone: Icone,
  tom = "neutro",
  titulo,
  descricao,
  emCartao = false,
  children,
  className,
}: {
  icone: LucideIcon;
  tom?: Tom;
  titulo: string;
  descricao?: React.ReactNode;
  /**
   * Cartao proprio (telas fora do shell, sobre o canvas) com titulo de 19px.
   * Sem cartao, o bloco fica solto dentro do shell com titulo de 16px.
   */
  emCartao?: boolean;
  /** Acoes e conteudo extra, abaixo do texto */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full max-w-md justify-items-center gap-3 text-center",
        emCartao && "rounded-card border border-border bg-card p-8 shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-[52px] place-items-center rounded-card",
          LADRILHO[tom],
        )}
      >
        <Icone className="size-6" />
      </span>
      <h1
        className={cn(
          "font-bold",
          emCartao
            ? "text-[19px] leading-[1.25] tracking-[-0.015em]"
            : "text-base leading-[1.3] tracking-[-0.01em]",
        )}
      >
        {titulo}
      </h1>
      {descricao ? (
        <div
          className={cn(
            "grid max-w-[44ch] gap-2 text-text-secondary",
            emCartao ? "text-[13.5px]" : "text-[13px]",
          )}
        >
          {descricao}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Fundo das telas que aparecem sem o shell (antes de haver clinica ativa). */
export function TelaSemShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 md:p-8">
      {children}
    </main>
  );
}
