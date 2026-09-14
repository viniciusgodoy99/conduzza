"use client";

import { cn } from "@/lib/utils";

// O editor em linha do tempo horizontal do brief da Tela 7:
// Agendou ──● 72h antes ──● 24h antes ──● 3h antes ── Consulta
// Cada ponto e um botao (alvo minimo de 40px) que abre o editor do passo.
// Ponto sem texto ganha aviso visual E textual (3 camadas, nunca so cor).

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
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-center gap-1 py-1">
        <span className="text-[12.5px] font-medium text-text-secondary">
          {inicioRotulo}
        </span>
        {pontos.map((ponto) => (
          <span key={ponto.id} className="flex items-center gap-1">
            <span aria-hidden className="h-px w-6 bg-border" />
            <button
              type="button"
              aria-pressed={selecionadoId === ponto.id}
              onClick={() => onSelecionar(ponto.id)}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                selecionadoId === ponto.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "text-text-secondary hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  background:
                    selecionadoId === ponto.id
                      ? "currentColor"
                      : ponto.temTexto
                        ? "var(--success)"
                        : "var(--warning)",
                }}
              />
              {ponto.rotulo}
              {!ponto.temTexto ? (
                <span className="text-[11px] font-normal opacity-80">
                  (sem texto)
                </span>
              ) : null}
            </button>
          </span>
        ))}
        {fimRotulo ? (
          <>
            <span aria-hidden className="h-px w-6 bg-border" />
            <span className="text-[12.5px] font-medium text-text-secondary">
              {fimRotulo}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
