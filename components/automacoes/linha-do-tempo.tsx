"use client";

import { MessageSquareDashed } from "lucide-react";

import { cn } from "@/lib/utils";

// O editor em linha do tempo horizontal do brief da Tela 7:
// Agendou, ponto 72h antes, ponto 24h antes, ponto 3h antes, Consulta.
// Cada ponto e um botao (alvo minimo de 40px) que abre o editor do passo.
// Desenho do design system (docs/06 secao 5.10): pilula clara com borda, e
// a escolhida em tinta (bg-inverse), nunca preenchida de lime. Ponto sem
// texto ganha icone proprio e o texto "(sem texto)": o ponto colorido
// sozinho era status so por cor.

/** Numero dentro do rotulo ("72 horas antes") em cz-num. */
function ComNumeros({ texto }: { texto: string }) {
  return texto.split(/(\d+)/).map((parte, indice) =>
    /^\d+$/.test(parte) ? (
      <span key={indice} className="cz-num">
        {parte}
      </span>
    ) : (
      parte
    ),
  );
}

export type PontoDaLinha = {
  id: string;
  rotulo: string;
  temTexto: boolean;
};

export function LinhaDoTempo({
  inicioRotulo,
  fimRotulo,
  pontos,
  selecionadoId,
  onSelecionar,
}: {
  inicioRotulo: string;
  fimRotulo: string | null;
  pontos: PontoDaLinha[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
}) {
  return (
    // O p-1 deixa o contorno de foco (2px com 2px de folga) inteiro dentro
    // do conteiner que rola na horizontal.
    <div className="cz-scroll overflow-x-auto">
      <div className="flex min-w-max items-center gap-1.5 p-1">
        <span className="text-[12.5px] font-medium text-text-secondary">
          {inicioRotulo}
        </span>
        {pontos.map((ponto) => {
          const selecionado = selecionadoId === ponto.id;
          return (
            <span key={ponto.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-px w-6 bg-border-strong" />
              <button
                type="button"
                aria-pressed={selecionado}
                onClick={() => onSelecionar(ponto.id)}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
                  selecionado
                    ? "border-transparent bg-inverse text-inverse-foreground shadow-none"
                    : "border-border-strong bg-card text-text-strong shadow-xs hover:bg-surface-subtle",
                )}
              >
                {!ponto.temTexto ? (
                  <MessageSquareDashed
                    aria-hidden
                    className={cn(
                      "size-3.5 shrink-0",
                      !selecionado && "text-warning-text",
                    )}
                  />
                ) : null}
                <span>
                  <ComNumeros texto={ponto.rotulo} />
                </span>
                {!ponto.temTexto ? (
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      !selecionado && "text-warning-text",
                    )}
                  >
                    (sem texto)
                  </span>
                ) : null}
              </button>
            </span>
          );
        })}
        {fimRotulo ? (
          <>
            <span aria-hidden className="h-px w-6 bg-border-strong" />
            <span className="text-[12.5px] font-medium text-text-secondary">
              {fimRotulo}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
