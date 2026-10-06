"use client";

import { useCallback, useState } from "react";

// O que a regiao role=status da lista de agendadas anuncia (secao 4.4 do
// desenho): "Mensagem agendada.", "Mensagem agendada excluída.", "A mensagem
// agendada saiu." e "A mensagem agendada não saiu.". A regiao fica montada
// sempre; o texto muda. A mesma frase duas vezes seguidas (duas exclusoes)
// ganha um espaco fixo no fim na vez par, para o leitor de tela anunciar de
// novo: texto igual nao e mudanca.

export type Anuncio = { texto: string; vez: number };

export const SEM_ANUNCIO: Anuncio = { texto: "", vez: 0 };

export function textoDoAnuncio(anuncio: Anuncio): string {
  if (!anuncio.texto) {
    return "";
  }
  return anuncio.vez % 2 === 0 ? `${anuncio.texto} ` : anuncio.texto;
}

export function useAnuncio(): {
  anuncio: Anuncio;
  anunciar: (texto: string) => void;
} {
  const [anuncio, setAnuncio] = useState<Anuncio>(SEM_ANUNCIO);
  const anunciar = useCallback((texto: string) => {
    setAnuncio((atual) => ({ texto, vez: atual.vez + 1 }));
  }, []);
  return { anuncio, anunciar };
}
