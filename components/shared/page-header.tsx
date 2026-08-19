import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Acoes da pagina (botoes), alinhadas a direita */
  children?: React.ReactNode;
  className?: string;
};

// Titulo de pagina: 22px semibold (brief secao 3.6).
export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="grid gap-1">
        <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </header>
  );
}
