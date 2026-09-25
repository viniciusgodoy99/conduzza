import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  /** Texto ou trechos (ex.: numeros em cz-num dentro da frase) */
  description?: React.ReactNode;
  /** Linha curta em caixa alta acima do titulo (ex.: o grupo do menu) */
  eyebrow?: string;
  /** Acoes da pagina (botoes), alinhadas a direita */
  children?: React.ReactNode;
  className?: string;
};

// Titulo de pagina no desenho do PageHeader do design system Conduzza
// (docs/06 secao 4.6): h1 de 24px em negrito (continua sendo o unico h1 da
// tela), apoio de 13,5px e as acoes empurradas para a direita, alinhadas pela
// base do texto.
export function PageHeader({
  title,
  description,
  eyebrow,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end gap-4", className)}>
      <div className="grid min-w-0 gap-1">
        {eyebrow ? (
          <p className="cz-eyebrow text-text-secondary">{eyebrow}</p>
        ) : null}
        <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[62ch] text-[13.5px] text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {children}
        </div>
      ) : null}
    </header>
  );
}
