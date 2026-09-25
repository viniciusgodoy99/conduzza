import type { LucideIcon } from "lucide-react";

import { Card, CardAction, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Bloco de Resultados e do Inicio na moldura do Card do design system
// Conduzza (docs/06 secoes 5.2 e 5.9): cabecalho com icone de 16px, titulo
// h2 de 16px em negrito e metadado de 13px; corpo em grade com padding de
// 16px, ou sem padding quando o conteudo e uma tabela ou uma lista de linhas.
// Sem "use client": serve ao painel do Inicio (Server Component) e as abas.

export function Secao({
  titulo,
  icone: Icone,
  meta,
  acao,
  semPadding = false,
  className,
  corpoClassName,
  children,
}: {
  titulo: string;
  icone?: LucideIcon;
  /** Linha curta abaixo do titulo (recorte, total, ultimo envio) */
  meta?: React.ReactNode;
  /** Controle a direita do cabecalho (ex.: o seletor de dimensao) */
  acao?: React.ReactNode;
  /** Corpo sem padding: tabela ou lista de linhas de ponta a ponta */
  semPadding?: boolean;
  className?: string;
  corpoClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <h2 className="flex min-w-0 items-center gap-2 text-base leading-[1.3] font-bold tracking-[-0.01em]">
          {Icone ? (
            <Icone
              aria-hidden
              className="size-4 shrink-0 text-text-secondary"
            />
          ) : null}
          <span className="min-w-0">{titulo}</span>
        </h2>
        {meta ? (
          <p className="text-[13px] text-text-secondary">{meta}</p>
        ) : null}
        {acao ? <CardAction>{acao}</CardAction> : null}
      </CardHeader>
      <div
        className={cn(
          semPadding ? "grid" : "grid content-start gap-3 p-4",
          corpoClassName,
        )}
      >
        {children}
      </div>
    </Card>
  );
}
