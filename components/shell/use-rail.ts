"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { COOKIE_DO_RAIL, type PreferenciaDoRail } from "@/lib/navigation";

// Estado do menu lateral (docs/06 secao 5.1). A LARGURA do rail e decidida
// pelo CSS (atributo data-rail na raiz do shell e a variante rail-aberto do
// globals.css), entao a primeira pintura ja sai certa, sem piscar. Este hook
// so precisa saber se o rail esta aberto para o botao de recolher e expandir
// (rotulo, icone e aria-expanded) e para ligar a dica dos itens recolhidos.

const CONSULTA_LARGA = "(min-width: 1600px)";
const UM_ANO_EM_SEGUNDOS = 31_536_000;

function assinarLargura(aoMudar: () => void): () => void {
  const consulta = window.matchMedia(CONSULTA_LARGA);
  consulta.addEventListener("change", aoMudar);
  return () => consulta.removeEventListener("change", aoMudar);
}

function larguraAtual(): boolean {
  return window.matchMedia(CONSULTA_LARGA).matches;
}

// No servidor nao ha largura: vale so a preferencia gravada. O CSS cobre o
// "auto" em 1600px ou mais ate a hidratacao.
function larguraNoServidor(): boolean {
  return false;
}

export function useRail(preferenciaInicial: PreferenciaDoRail) {
  const [preferencia, setPreferencia] = useState(preferenciaInicial);
  const larga = useSyncExternalStore(
    assinarLargura,
    larguraAtual,
    larguraNoServidor,
  );
  const aberto =
    preferencia === "expanded" || (preferencia === "auto" && larga);

  // Grava a escolha em cookie (o layout le no servidor e o data-rail ja
  // chega certo na proxima carga). Quando a escolha coincide com o que a
  // largura daria sozinha, o cookie e apagado e o menu volta a seguir a tela.
  const alternarRail = useCallback(() => {
    const proxima: PreferenciaDoRail = aberto ? "collapsed" : "expanded";
    const automatica: PreferenciaDoRail = larga ? "expanded" : "collapsed";
    if (proxima === automatica) {
      document.cookie = `${COOKIE_DO_RAIL}=; path=/; max-age=0; samesite=lax`;
      setPreferencia("auto");
      return;
    }
    document.cookie = `${COOKIE_DO_RAIL}=${proxima}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax`;
    setPreferencia(proxima);
  }, [aberto, larga]);

  return { preferencia, aberto, alternarRail };
}
