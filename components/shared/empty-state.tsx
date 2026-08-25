import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Vazio inicial: uma acao principal clara (estado 1 da secao 8 do brief) */
  action?: { label: string; onClick?: () => void; href?: string };
  /** Vazio por filtro: botao de limpar filtros (estado 2 da secao 8 do brief) */
  onClearFilters?: () => void;
  /** Acoes customizadas (ex.: botoes protegidos por permissao) no lugar de action */
  children?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  onClearFilters,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon strokeWidth={1.5} className="size-5 text-text-secondary" />
      </span>
      <div className="grid gap-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {description ? (
          <p className="max-w-96 text-sm text-text-secondary">{description}</p>
        ) : null}
      </div>
      {action ? (
        action.href ? (
          <Button asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        )
      ) : null}
      {onClearFilters ? (
        <Button variant="outline" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      ) : null}
      {children}
    </div>
  );
}
