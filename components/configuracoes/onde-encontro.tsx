import { ChevronRight, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LinkDeFora, OndeEncontrar } from "@/lib/domain/onde-encontrar";
import { cn } from "@/lib/utils/index";

// "Onde encontro": o caminho ate o dado na Meta ou no Google, com o botao que
// abre a tela e a ajuda oficial (decisao do dono de 17/11/2026). Desde
// 26/11/2026 (tela que mostra e nao explica) o caminho fica recolhido num
// <details>: a linha "Onde encontro" abre os passos e os links.

function LinkDeAjuda({ link }: { link: LinkDeFora }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-md text-[12.5px] font-semibold text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      {link.rotulo}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">(abre em outra aba)</span>
    </a>
  );
}

/** O caminho recolhido: a linha que abre, os passos, o botao e a ajuda. */
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
    <details data-slot="onde-encontro" className={cn("group/onde", className)}>
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-md text-[12.5px] font-semibold text-text-secondary cz-transition hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 cz-transition group-open/onde:rotate-90 motion-reduce:transition-none"
        />
        {titulo}
      </summary>
      <div className="grid gap-2 pb-1 pl-5">
        <ol className="grid list-decimal gap-1 pl-5 text-[12.5px] text-text-secondary">
          {ajuda.passos.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {ajuda.link ? (
            <Button asChild variant="outline" className="w-fit">
              <a
                href={ajuda.link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink aria-hidden />
                {ajuda.link.rotulo}{" "}
                <span className="sr-only">(abre em outra aba)</span>
              </a>
            </Button>
          ) : null}
          {ajuda.ajuda ? <LinkDeAjuda link={ajuda.ajuda} /> : null}
        </div>
      </div>
    </details>
  );
}

/** Embaixo de um campo: o mesmo caminho recolhido. */
export const OndeEncontroDoCampo = OndeEncontro;
