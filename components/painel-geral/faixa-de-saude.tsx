"use client";

import { useId } from "react";

import { useParametrosDaLista } from "@/components/painel-geral/parametros-da-lista";
import {
  contagemNoPainel,
  SAUDE_STATUS,
  SAUDES,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import type { SaudeNoPainel } from "@/lib/queries/painel-geral";
import { cn } from "@/lib/utils";

// A faixa da saude no topo do Painel geral (segunda leva, 26/10/2026;
// desenho: mantidos os cartoes de hoje, uma faixa com as tres contagens,
// clicavel como filtro). Uma contagem por saude (Saudavel, Atencao, Em
// risco) de TODAS as clinicas da leitura (os totais do banco, que a leitura
// confere com as linhas), cada uma em 3 camadas (icone, rotulo e cor) e com
// o numero; o clique filtra a lista pela saude (o mesmo filtro "Saúde" da
// barra, na URL) e o segundo clique tira o filtro. Botoes com aria-pressed
// e 40px de alvo.

export function FaixaDeSaude({
  contagem,
}: {
  /** Quantas clinicas em cada saude (os totais da leitura). */
  contagem: Record<SaudeNoPainel, number>;
}) {
  const id = useId();
  const { filtros, definir } = useParametrosDaLista();

  const escolher = (saude: SaudeNoPainel) =>
    definir({ saude: filtros.saude === saude ? null : saude });

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card p-3 shadow-sm"
    >
      <div className="grid gap-0.5">
        <p
          id={`${id}-titulo`}
          className="text-[13.5px] font-bold text-text-strong"
        >
          {TEXTOS_DO_PAINEL.faixaDeSaude}
        </p>
        <p className="text-[12px] text-text-secondary">
          {TEXTOS_DO_PAINEL.faixaDeSaudeApoio}
        </p>
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-titulo`}
        className="flex flex-wrap gap-2 sm:ml-auto"
      >
        {SAUDES.map((saude) => {
          const definicao = SAUDE_STATUS[saude];
          const tom = STATUS_TONE_VARS[definicao.tone];
          const Icone = definicao.icon;
          const ligada = filtros.saude === saude;
          const quantas = contagem[saude];
          return (
            <button
              key={saude}
              type="button"
              aria-pressed={ligada}
              onClick={() => escolher(saude)}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-lg border border-transparent px-3 text-[13px] font-semibold cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
                // Ligada nao depende so da cor: o anel de tinta em volta,
                // alem do aria-pressed.
                ligada
                  ? "shadow-xs ring-2 ring-text-strong"
                  : "hover:border-border-strong",
              )}
              style={{ color: tom.text, backgroundColor: tom.bg }}
            >
              {Icone ? <Icone aria-hidden className="size-4 shrink-0" /> : null}
              <span>{definicao.label}</span>
              <span className="cz-num text-[15px]">
                {contagemNoPainel(quantas)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
