"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  ehOrdemPadrao,
  lerFiltrosDoPainel,
  lerOrdemDaLista,
  type FiltrosDoPainel,
  type OrdemDaLista,
} from "@/components/painel-geral/painel-geral";

// Os filtros e a ordem da lista do Painel geral moram na URL (o link leva o
// mesmo recorte), trocados com history.replaceState: o roteador do Next
// acompanha sem ir ao servidor, e a lista e a faixa de saude do topo (dois
// componentes) leem a mesma URL. Segunda leva (26/10/2026): a saude e a
// ordem entraram aqui.

/** Os parametros que a lista escreve na URL. */
export type ParametroDaLista =
  "busca" | "uso" | "conta" | "agente" | "saude" | "ordem" | "sentido";

export function useParametrosDaLista(): {
  filtros: FiltrosDoPainel;
  ordem: OrdemDaLista;
  definir: (mudancas: Partial<Record<ParametroDaLista, string | null>>) => void;
  definirOrdem: (ordem: OrdemDaLista) => void;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filtros = useMemo(
    () => lerFiltrosDoPainel(searchParams),
    [searchParams],
  );
  const ordem = useMemo(() => lerOrdemDaLista(searchParams), [searchParams]);

  const definir = useCallback(
    (mudancas: Partial<Record<ParametroDaLista, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [chave, valor] of Object.entries(mudancas)) {
        if (valor === null || valor === undefined || valor === "") {
          params.delete(chave);
        } else {
          params.set(chave, valor);
        }
      }
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${pathname}?${qs}` : pathname,
      );
    },
    [pathname, searchParams],
  );

  // A ordem padrao (o ultimo acesso mais recente primeiro) nao vai para a
  // URL: o link sem ordem e o mesmo da tela sem clique.
  const definirOrdem = useCallback(
    (nova: OrdemDaLista) =>
      definir(
        ehOrdemPadrao(nova)
          ? { ordem: null, sentido: null }
          : { ordem: nova.coluna, sentido: nova.sentido },
      ),
    [definir],
  );

  return { filtros, ordem, definir, definirOrdem };
}
