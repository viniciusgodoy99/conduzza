"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef } from "react";

// initialData do TanStack v5 so vale quando a entrada de cache NAO existe.
// Na revisita de uma tela dentro do gcTime, o cache parado da visita anterior
// vence o dado que o servidor acabou de buscar (e que segurou a navegacao
// RSC): a lista pinta velha por um instante e um refetch duplicado dispara do
// browser logo depois. Este hook injeta o dado do servidor no cache durante a
// renderizacao (mesmo momento em que o HydrationBoundary oficial hidrata),
// entao a primeira pintura ja sai atual e o refetch de montagem nao dispara.
//
// O dado do servidor e sempre mais novo que o cache parado: o canal Realtime
// que o mantinha vivo foi desassinado quando a tela desmontou.
//
// Passe undefined para nao aplicar (ex.: o dado do servidor e de outro
// recorte, como um dia diferente do que a tela esta mostrando).
export function useDadosDoServidor<T>(
  queryKey: QueryKey,
  dados: T | undefined,
) {
  const queryClient = useQueryClient();
  // Guarda a ULTIMA referencia aplicada: cada payload RSC novo (revisita ou
  // router.refresh) e um objeto novo e reaplica; re-renders do proprio cliente
  // reusam a referencia e nao tocam o cache.
  const ultimoAplicado = useRef<unknown>(undefined);
  if (dados !== undefined && ultimoAplicado.current !== dados) {
    ultimoAplicado.current = dados;
    queryClient.setQueryData(queryKey, dados);
  }
}
