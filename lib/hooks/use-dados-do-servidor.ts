"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

// initialData do TanStack v5 so vale quando a entrada de cache NAO existe.
// Na revisita de uma tela dentro do gcTime, o cache parado da visita anterior
// vence o dado que o servidor acabou de buscar (e que segurou a navegacao
// RSC): a lista pinta velha por um instante e um refetch duplicado dispara do
// browser logo depois. Este hook injeta o dado do servidor no cache durante a
// renderizacao (mesmo momento em que o HydrationBoundary oficial hidrata),
// entao a primeira pintura ja sai atual e o refetch de montagem nao dispara.
//
// Na MONTAGEM o dado do servidor e mais novo que o cache parado: o canal
// Realtime que o mantinha vivo foi desassinado quando a tela desmontou.
//
// Com a tela ABERTA isso deixa de ser verdade (defeito de 06/10/2026, docs/05):
// a resposta de uma Server Action que revalida (o Assumir revalida /leads)
// traz um retrato renderizado no fim DAQUELA action, e a fila de actions do
// Next e serial: com outra action na fila (o Enviar clicado antes de o
// Assumir voltar), o retrato so entra quando a ultima termina, depois de o
// tempo real ja ter posto no cache o que aconteceu no meio. Gravar esse
// retrato apagava a previa nova do cartao. Por isso, num cache mantido pelo
// tempo real (`vivoPorTempoReal`), o payload que chega com a tela montada nao
// e gravado: ele so marca a consulta para ser relida do banco, depois do
// commit. Os outros caches seguem como antes (o retrato do servidor vence).
//
// Passe undefined para nao aplicar (ex.: o dado do servidor e de outro
// recorte, como um dia diferente do que a tela esta mostrando).
export function useDadosDoServidor<T>(
  queryKey: QueryKey,
  dados: T | undefined,
  opcoes: { vivoPorTempoReal?: boolean } = {},
) {
  const queryClient = useQueryClient();
  // Guarda a ULTIMA referencia aplicada: cada payload RSC novo (revisita ou
  // router.refresh) e um objeto novo e reaplica; re-renders do proprio cliente
  // reusam a referencia e nao tocam o cache.
  const ultimoAplicado = useRef<unknown>(undefined);
  const precisaReler = useRef(false);
  if (dados !== undefined && ultimoAplicado.current !== dados) {
    const naMontagem = ultimoAplicado.current === undefined;
    ultimoAplicado.current = dados;
    if (naMontagem || !opcoes.vivoPorTempoReal) {
      queryClient.setQueryData(queryKey, dados);
    } else {
      precisaReler.current = true;
    }
  }
  // Fora da renderizacao (invalidar dispara busca): depois do commit que
  // trouxe o retrato, a consulta e relida do banco, que ja tem tudo o que o
  // tempo real entregou.
  useEffect(() => {
    if (precisaReler.current) {
      precisaReler.current = false;
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  });
}
