"use client";

import { Ban, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import {
  DICA_REMOVER_SEM_PERMISSAO,
  descreverPeriodoDoBloqueio,
} from "@/components/agenda/bloqueio-comum";
import {
  ConfirmarRemocaoDoBloqueio,
  nomeDoProfissionalDoBloqueio,
  podeRemoverBloqueio,
  ResumoDoBloqueio,
} from "@/components/agenda/detalhe-do-bloqueio";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BloqueioDaAgenda } from "@/lib/queries/agenda";

// Bloqueio na grade: hachura a 45 graus sobre o afundado (a camada de forma,
// C19) e o motivo num chip solido com o Ban. Nunca so cor. A faixa e um botao:
// o clique (ou Enter) abre um popover com motivo, profissional, periodo e
// encaixe, e o "Remover bloqueio" com confirmacao (o detalhe e a confirmacao
// sao os mesmos do menu da consulta, em detalhe-do-bloqueio.tsx). Quem nao
// pode remover ve a acao desabilitada com o porque logo abaixo (mesma regra
// da RLS: admin e gestor). E a unica excecao ao pointer-events-none dentro da
// coluna: o clique no vao continua valendo fora da faixa (event.target
// diferente do vao, a coluna ignora). A altura e a duracao real, sem minimo:
// esticar mentiria o periodo e tomaria o clique do vao vizinho. O bloqueio
// coberto por uma consulta e removido pelo menu dela.

const HACHURA =
  "repeating-linear-gradient(45deg, var(--border-heavy) 0 1px, transparent 1px 8px)";

export function FaixaDeBloqueio({
  contexto,
  bloqueio,
  top,
  height,
}: {
  contexto: ContextoAgenda;
  bloqueio: BloqueioDaAgenda;
  /** Ja recortados na parte visivel da grade (faixaNaGrade). */
  top: number;
  height: number;
}) {
  const [aberto, setAberto] = useState(false);
  // O popover nasce onde a pessoa clicou: a faixa de um dia inteiro passa da
  // altura da tela e, ancorado na faixa inteira, ele sairia fora da vista.
  const [ancora, setAncora] = useState({ x: 8, y: 8 });
  const [confirmando, setConfirmando] = useState(false);
  const idDica = useId();
  const idRotulo = useId();
  const idMotivo = useId();

  const nome = nomeDoProfissionalDoBloqueio(contexto, bloqueio);
  const periodo = descreverPeriodoDoBloqueio(
    bloqueio.starts_at,
    bloqueio.ends_at,
    contexto.timezone,
  );
  const podeRemover = podeRemoverBloqueio(contexto);

  return (
    <>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute inset-x-0.5 z-[1] flex cursor-pointer items-start overflow-hidden rounded-md border border-border-strong bg-surface-4 p-1 text-left transition-shadow duration-(--dur-fast) outline-none hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid"
            style={{ top, height, backgroundImage: HACHURA }}
            aria-label={`Bloqueio de ${nome}: ${bloqueio.reason}, ${periodo}`}
            onClick={(event) => {
              // Teclado (detail 0) abre no topo da faixa, junto do motivo.
              if (event.detail === 0) {
                setAncora({ x: 8, y: 8 });
                return;
              }
              const caixa = event.currentTarget.getBoundingClientRect();
              setAncora({
                x: event.clientX - caixa.left,
                y: event.clientY - caixa.top,
              });
            }}
          >
            <PopoverAnchor asChild>
              <span
                aria-hidden
                className="pointer-events-none absolute size-px"
                style={{ left: ancora.x, top: ancora.y }}
              />
            </PopoverAnchor>
            <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
              <Ban className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{bloqueio.reason}</span>
            </span>
          </button>
        </PopoverTrigger>
        {/* O Radix desenha o popover com role=dialog e sem nome: o nome sai
            do texto que ja esta na tela ("Horario bloqueado" e o motivo). */}
        <PopoverContent
          side="bottom"
          align="start"
          className="w-72"
          aria-labelledby={`${idRotulo} ${idMotivo}`}
        >
          <ResumoDoBloqueio
            contexto={contexto}
            bloqueio={bloqueio}
            idRotulo={idRotulo}
            idMotivo={idMotivo}
          />
          <div className="grid gap-1">
            <Button
              variant="destructive"
              className="h-10 w-full"
              disabled={!podeRemover}
              aria-describedby={podeRemover ? undefined : idDica}
              onClick={() => {
                setAberto(false);
                setConfirmando(true);
              }}
            >
              <Trash2 aria-hidden /> Remover bloqueio
            </Button>
            {podeRemover ? null : (
              <p id={idDica} className="text-xs text-text-secondary">
                {DICA_REMOVER_SEM_PERMISSAO}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {confirmando ? (
        <ConfirmarRemocaoDoBloqueio
          contexto={contexto}
          bloqueio={bloqueio}
          onFechar={() => setConfirmando(false)}
        />
      ) : null}
    </>
  );
}
