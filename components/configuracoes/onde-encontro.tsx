import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LinkDeFora, OndeEncontrar } from "@/lib/domain/onde-encontrar";
import { cn } from "@/lib/utils/index";

// "Onde encontro": o caminho ate o dado na Meta ou no Google, com o botao que
// abre a tela e a ajuda oficial (decisao do dono de 17/11/2026).

const ESTILO_DO_LINK =
  "inline-flex min-h-10 w-fit items-center gap-1.5 rounded-md text-[12.5px] font-semibold text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid";

function LinkDeAjuda({ link }: { link: LinkDeFora }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className={ESTILO_DO_LINK}
    >
      {link.rotulo}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">(abre em outra aba)</span>
    </a>
  );
}

/** O bloco inteiro: os passos numerados, o botao e a ajuda oficial. */
export function OndeEncontro({
  ajuda,
  titulo = "Onde encontro",
  className,
}: {
  ajuda: OndeEncontrar;
  titulo?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="onde-encontro"
      className={cn(
        "grid gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-3",
        className,
      )}
    >
      <p className="text-[12.5px] font-semibold text-text-strong">{titulo}</p>
      <ol className="grid list-decimal gap-1 pl-5 text-[12.5px] text-text-secondary">
        {ajuda.passos.map((passo) => (
          <li key={passo}>{passo}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {ajuda.link ? (
          <Button asChild variant="outline" className="w-fit">
            <a href={ajuda.link.href} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {ajuda.link.rotulo}{" "}
              <span className="sr-only">(abre em outra aba)</span>
            </a>
          </Button>
        ) : null}
        {ajuda.ajuda ? <LinkDeAjuda link={ajuda.ajuda} /> : null}
      </div>
    </div>
  );
}

/** A versao de uma linha, embaixo de um campo: o caminho e o link da tela. */
export function OndeEncontroDoCampo({
  ajuda,
  className,
}: {
  ajuda: OndeEncontrar;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-0.5", className)}>
      <p className="text-[11px] text-text-secondary">
        <span className="font-semibold text-text-strong">Onde encontro: </span>
        {ajuda.passos.join(" ")}
      </p>
      {ajuda.link ? <LinkDeAjuda link={ajuda.link} /> : null}
    </div>
  );
}
