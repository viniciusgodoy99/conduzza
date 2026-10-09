"use client";

import { Circle, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

// Cartoes de radio da Tela 6 (docs/06 5.14): tom de voz e modo de operacao.
// Molde do passo de consentimento da importacao (role="radiogroup" com o
// radio nativo), com o marcador Circle/CircleDot da 5.14 no lugar do radio
// visivel: o radio nativo continua la (sr-only), recebe o foco e as setas do
// teclado, e o anel de foco aparece no cartao inteiro. Escolhido pela
// receita "Selecionado" da 4.7 (lime suave com borda lime-700) e com o
// negrito no rotulo: a escolha nunca depende so da cor.

export type OpcaoDeCartao<T extends string> = {
  valor: T;
  rotulo: string;
  descricao?: string;
  /** Texto extra em destaque dentro do cartao (a frase de exemplo do tom). */
  exemplo?: string;
};

export function CartoesDeEscolha<T extends string>({
  nome,
  rotuloDoGrupo,
  opcoes,
  valor,
  aoEscolher,
  desabilitado = false,
  className,
}: {
  /** O name dos radios (um por grupo na tela). */
  nome: string;
  rotuloDoGrupo: string;
  opcoes: readonly OpcaoDeCartao<T>[];
  valor: T;
  aoEscolher: (valor: T) => void;
  desabilitado?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotuloDoGrupo}
      aria-disabled={desabilitado || undefined}
      className={cn("grid gap-2", className)}
    >
      {opcoes.map((opcao) => {
        const escolhida = opcao.valor === valor;
        const Marcador = escolhida ? CircleDot : Circle;
        return (
          <label
            key={opcao.valor}
            className={cn(
              "flex min-h-10 items-start gap-3 rounded-xl border px-3.5 py-3 cz-transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus focus-within:outline-solid",
              escolhida
                ? "border-primary-edge bg-primary-soft"
                : "border-border-strong bg-card",
              desabilitado
                ? "cursor-not-allowed opacity-45"
                : cn("cursor-pointer", !escolhida && "hover:bg-surface-subtle"),
            )}
          >
            <input
              type="radio"
              name={nome}
              value={opcao.valor}
              checked={escolhida}
              disabled={desabilitado}
              onChange={() => aoEscolher(opcao.valor)}
              className="sr-only"
            />
            <Marcador
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                escolhida ? "text-primary-text" : "text-text-secondary",
              )}
            />
            <span className="grid min-w-0 gap-1">
              <span
                className={cn(
                  "text-sm text-text-strong",
                  escolhida ? "font-bold" : "font-semibold",
                )}
              >
                {opcao.rotulo}
              </span>
              {opcao.exemplo ? (
                <span className="text-[13px] text-foreground italic">
                  {`“${opcao.exemplo}”`}
                </span>
              ) : null}
              {opcao.descricao ? (
                <span className="text-xs text-text-secondary">
                  {opcao.descricao}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
