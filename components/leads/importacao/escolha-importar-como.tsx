"use client";

import type { ImportarComo } from "@/lib/integrations/importar-contatos";
import { cn } from "@/lib/utils";

// "Importar como" (decisao do dono em 20/10/2026: "Vira paciente, e eu
// preciso incluir várias pessoas aí, pode ser manualmente ou via
// importação"). Fica no ultimo passo, junto do botao que grava: e ali que a
// pessoa decide o que a planilha e. Leads e o padrao, como sempre. Durante e
// depois do envio a escolha trava, para os lotes de uma mesma importacao
// nunca sairem metade como lead e metade como paciente.
//
// A opcao escolhida segue a receita de selecionado do DS (lime suave com
// borda lime-700), com o radio nativo como pista que nao depende de cor,
// como o passo da autorizacao.

export const OPCOES_IMPORTAR_COMO: readonly {
  valor: ImportarComo;
  rotulo: string;
  descricao: string;
}[] = [
  {
    valor: "leads",
    rotulo: "Leads",
    descricao:
      "Entram no funil como leads. Quem já está na clínica continua como está.",
  },
  {
    valor: "pacientes",
    rotulo: "Pacientes",
    descricao:
      "Entram direto em Pacientes, sem consulta marcada. Quem já é lead passa a paciente, sem mudar de etapa.",
  },
];

export function EscolhaImportarComo({
  valor,
  aoEscolher,
  travado = false,
}: {
  valor: ImportarComo;
  aoEscolher: (valor: ImportarComo) => void;
  /** A importacao ja comecou: a escolha nao muda mais. */
  travado?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <p
        id="importar-como-rotulo"
        className="text-[13.5px] font-semibold text-text-strong"
      >
        Importar como
      </p>
      <div
        role="radiogroup"
        aria-labelledby="importar-como-rotulo"
        className="grid gap-2 sm:grid-cols-2"
      >
        {OPCOES_IMPORTAR_COMO.map((item) => {
          const escolhida = valor === item.valor;
          return (
            <label
              key={item.valor}
              className={cn(
                "flex min-h-10 items-start gap-3 rounded-xl border px-3.5 py-3 cz-transition",
                travado ? "cursor-not-allowed" : "cursor-pointer",
                escolhida
                  ? "border-primary-edge bg-primary-soft"
                  : "border-border-strong bg-card",
                !escolhida && !travado && "hover:bg-surface-subtle",
              )}
            >
              <input
                type="radio"
                name="importar-como"
                value={item.valor}
                checked={escolhida}
                disabled={travado}
                onChange={() => aoEscolher(item.valor)}
                className="mt-0.5 size-4 shrink-0 accent-(--primary-edge)"
              />
              <span className="grid gap-0.5">
                <span
                  className={cn(
                    "text-sm text-text-strong",
                    escolhida ? "font-bold" : "font-semibold",
                  )}
                >
                  {item.rotulo}
                </span>
                <span className="text-xs text-text-secondary">
                  {item.descricao}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
