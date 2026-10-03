"use client";

import { useEffect, useState } from "react";

/**
 * O instante "agora", renovado a cada minuto: uma atividade com hora vira
 * "Atrasada" sozinha, sem recarregar a tela. `inicialISO` vem do servidor
 * quando a lista e renderizada la, para a primeira pintura do navegador sair
 * igual a do servidor.
 */
export function useAgora(inicialISO?: string, intervaloMs = 60_000): Date {
  const [agora, setAgora] = useState(() =>
    inicialISO ? new Date(inicialISO) : new Date(),
  );
  useEffect(() => {
    // Primeira atualizacao logo depois da montagem (o dado do servidor pode
    // ter alguns segundos), depois a cada intervalo.
    const primeiro = setTimeout(() => setAgora(new Date()), 0);
    const timer = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => {
      clearTimeout(primeiro);
      clearInterval(timer);
    };
  }, [intervaloMs]);
  return agora;
}
