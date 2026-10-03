"use client";

import { useEffect, useState } from "react";

/**
 * O valor depois de parar de mudar por `ms`: a previa nao consulta o banco a
 * cada tecla do campo de tempo.
 */
export function useValorAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const timer = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(timer);
  }, [valor, ms]);
  return atrasado;
}
