import { OctagonAlert, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  /** Vazio inicial: uma acao principal clara (estado 1 da secao 8 do brief) */
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
    /** Padrao: a variante principal (lime). Use outra quando o lime ja esta na tela */
    variant?: React.ComponentProps<typeof Button>["variant"];
  };
  /** Vazio por filtro: botao de limpar filtros (estado 2 da secao 8 do brief) */
  onClearFilters?: () => void;
  /** Acoes customizadas (ex.: botoes protegidos por permissao) no lugar de action */
  children?: React.ReactNode;
  /** Versao menor, para dentro de cartao, painel ou coluna estreita */
  compact?: boolean;
  className?: string;
} & (
  | { tom?: "padrao"; icon: LucideIcon }
  // Erro de carregamento: o icone e sempre OctagonAlert (tabela de icones
  // reservados, docs/06 secao 4.6), por isso nao se passa outro.
  | { tom: "erro"; icon?: undefined }
);

// Vazio no desenho do EmptyState do design system Conduzza (docs/06 secao
// 4.6): sem moldura propria, ladrilho lime suave com o icone, titulo, uma
// linha de apoio e a proxima acao. Onde o vazio fica solto na pagina, quem
// chama o poe dentro de um Card. O titulo continua sendo paragrafo, e nao
// heading, para nao somar um nivel de titulo onde a tela nao tem.
export function EmptyState({
  icon,
  tom = "padrao",
  title,
  description,
  action,
  onClearFilters,
  children,
  compact = false,
  className,
}: EmptyStateProps) {
  const erro = tom === "erro";
  const Icon = erro || !icon ? OctagonAlert : icon;
  const temAcoes = Boolean(action || onClearFilters || children);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-5 py-7" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-card",
          compact ? "size-[38px]" : "size-[52px]",
          erro ? "bg-alert-bg" : "bg-primary-soft",
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            compact ? "size-[18px]" : "size-6",
            erro ? "text-alert-text" : "text-primary-text",
          )}
        />
      </span>
      <p
        className={cn(
          "font-bold tracking-[-0.01em] text-text-strong",
          compact ? "text-sm" : "text-base",
        )}
      >
        {title}
      </p>
      {description ? (
        <p className="max-w-[44ch] text-[13px] text-text-secondary">
          {description}
        </p>
      ) : null}
      {temAcoes ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            action.href ? (
              <Button asChild variant={action.variant}>
                <a href={action.href}>{action.label}</a>
              </Button>
            ) : (
              <Button variant={action.variant} onClick={action.onClick}>
                {action.label}
              </Button>
            )
          ) : null}
          {onClearFilters ? (
            <Button variant="outline" onClick={onClearFilters}>
              Limpar filtros
            </Button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
