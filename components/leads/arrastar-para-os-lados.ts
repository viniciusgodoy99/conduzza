import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Quadro do Kanban mais largo que a tela (relato de um administrador de
// clinica em 20/10/2026: "nao consigo puxar para o lado"). Com 8 a 10 etapas
// a barra de rolagem lateral fica no pe da coluna mais comprida, que pode ter
// centenas de cartoes, e o mouse comum nao rola para os lados. Tres caminhos,
// todos no MESMO elemento que rola:
// - arrastar o FUNDO do quadro com o botao principal do mouse (vao entre
//   cartoes, cabecalho da coluna, espaco abaixo de uma coluna curta);
// - as setas da faixa acima do quadro (kanban-board.tsx), que andam 80% da
//   largura visivel, suave salvo movimento reduzido;
// - o teclado: o quadro e focavel e as setas do teclado rolam (nativo).
//
// O arrasto nunca comeca em cartao (ali o dnd-kit arrasta o lead e o clique
// abre o drawer), em controle (botao, link, campo, select ou qualquer coisa
// focavel) nem na barra de rolagem, que continua do navegador. So mouse: no
// toque o navegador ja rola sozinho. O ponteiro fica capturado no quadro
// (sair dele no meio do arrasto nao solta) e o texto nao seleciona: o
// kanban-board poe select-none enquanto arrasta.
//
// A logica do arrasto mora em criarArrastoDoQuadro, sem React nem DOM, e o
// teste de unidade roda em node com um quadro falso.

/**
 * O que nunca inicia o arrasto: o cartao do lead (data-cartao-do-lead, no
 * lead-card) e todo controle. O "focavel" pega tambem a descricao da etapa,
 * que abre a dica pelo teclado e tem cursor proprio.
 */
export const SELETOR_QUE_NAO_ARRASTA = [
  "[data-cartao-do-lead]",
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable]",
  "[role='button']",
  "[role='link']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** Quanto cada seta anda: 80% da largura visivel, sobrando contexto. */
export const FRACAO_DAS_SETAS = 0.8;

/** Folga de 1px: com zoom ou tela densa o scrollLeft sai fracionado. */
const FOLGA = 1;

const MENOS_MOVIMENTO = "(prefers-reduced-motion: reduce)";

/** -1 volta para as etapas anteriores; 1 avanca para as proximas. */
export type Sentido = -1 | 1;

export type LimitesDaRolagem = {
  /** O conteudo passa da largura visivel: ha o que rolar. */
  excede: boolean;
  noComeco: boolean;
  noFim: boolean;
};

/**
 * Antes de medir (HTML do servidor e primeira pintura) a faixa ja aparece,
 * porque e o caso comum: a jornada padrao tem 6 colunas de no minimo 228px,
 * que passam da largura na maioria das telas de notebook, e o relato veio de
 * jornadas com 8 a 10 etapas. Onde o quadro cabe, a faixa some na primeira
 * medida. O esqueleto (colunas-carregando) reserva a mesma faixa.
 */
export const LIMITES_ANTES_DE_MEDIR: LimitesDaRolagem = {
  excede: true,
  noComeco: true,
  noFim: false,
};

/** O que o arrasto le e escreve no elemento que rola (o real ou um falso). */
export type QuadroQueRola = {
  scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly clientTop: number;
  readonly clientLeft: number;
  getBoundingClientRect(): { readonly top: number; readonly left: number };
  contains(outro: Node | null): boolean;
  setPointerCapture(ponteiro: number): void;
};

/** O que o arrasto le do evento de ponteiro (o do React serve). */
export type EventoDoPonteiro = {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
  readonly currentTarget: QuadroQueRola;
};

export function limitesDaRolagem(
  quadro: Pick<QuadroQueRola, "scrollLeft" | "scrollWidth" | "clientWidth">,
): LimitesDaRolagem {
  const maximo = quadro.scrollWidth - quadro.clientWidth;
  return {
    excede: maximo > FOLGA,
    noComeco: quadro.scrollLeft <= FOLGA,
    noFim: quadro.scrollLeft >= maximo - FOLGA,
  };
}

/** O scrollBy de uma seta: 80% da largura visivel, no sentido pedido. */
export function rolagemDasSetas(
  larguraVisivel: number,
  sentido: Sentido,
  menosMovimento: boolean,
): ScrollToOptions {
  return {
    left: sentido * Math.round(larguraVisivel * FRACAO_DAS_SETAS),
    behavior: menosMovimento ? "auto" : "smooth",
  };
}

function podeArrastar(evento: EventoDoPonteiro): boolean {
  const quadro = evento.currentTarget;
  if (evento.pointerType !== "mouse" || evento.button !== 0) {
    return false;
  }
  if (!limitesDaRolagem(quadro).excede) {
    return false;
  }
  // O closest sobe do alvo ate o proprio quadro, que e focavel: so conta o
  // controle que esta DENTRO dele.
  const controle =
    (evento.target as Element | null)?.closest(SELETOR_QUE_NAO_ARRASTA) ?? null;
  if (controle !== null && controle !== quadro && quadro.contains(controle)) {
    return false;
  }
  // Fora da area do conteudo e a barra de rolagem: ela e do navegador.
  const caixa = quadro.getBoundingClientRect();
  return (
    evento.clientY < caixa.top + quadro.clientTop + quadro.clientHeight &&
    evento.clientX < caixa.left + quadro.clientLeft + quadro.clientWidth
  );
}

/**
 * O arrasto do fundo do quadro, sem React: os tres manipuladores vao no
 * elemento que rola (onPointerDown, onPointerMove e o fim, que serve para
 * pointerup, pointercancel e lostpointercapture). aoMudar avisa quando o
 * arrasto comeca e termina, para o cursor e o select-none.
 */
export function criarArrastoDoQuadro(aoMudar: (arrastando: boolean) => void) {
  let arrasto: {
    ponteiro: number;
    xInicial: number;
    rolagemInicial: number;
  } | null = null;

  const terminar = () => {
    if (arrasto !== null) {
      arrasto = null;
      aoMudar(false);
    }
  };

  return {
    aoApertar(evento: EventoDoPonteiro) {
      if (arrasto !== null || !podeArrastar(evento)) {
        return;
      }
      const quadro = evento.currentTarget;
      arrasto = {
        ponteiro: evento.pointerId,
        xInicial: evento.clientX,
        rolagemInicial: quadro.scrollLeft,
      };
      // Capturado, o ponteiro segue falando com o quadro mesmo fora dele.
      quadro.setPointerCapture(evento.pointerId);
      aoMudar(true);
    },
    aoMover(evento: EventoDoPonteiro) {
      if (arrasto === null || evento.pointerId !== arrasto.ponteiro) {
        return;
      }
      // Botao ja solto sem pointerup (menu de contexto, troca de janela).
      if ((evento.buttons & 1) === 0) {
        terminar();
        return;
      }
      // O conteudo acompanha a mao: puxar para a esquerda mostra as proximas
      // etapas. O navegador limita o valor entre o comeco e o fim.
      evento.currentTarget.scrollLeft =
        arrasto.rolagemInicial - (evento.clientX - arrasto.xInicial);
    },
    aoSoltar(evento: Pick<EventoDoPonteiro, "pointerId">) {
      if (arrasto !== null && evento.pointerId === arrasto.ponteiro) {
        terminar();
      }
    },
  };
}

/**
 * Liga o quadro: ref do elemento que rola, os limites medidos (faixa e
 * setas), o estado do arrasto (cursor), rolar() das setas e os eventos de
 * ponteiro para espalhar no elemento. medir() fica exposto para quem muda o
 * conteudo sem mudar a caixa (o ResizeObserver so ve a caixa).
 */
export function useArrastarParaOsLados() {
  const ref = useRef<HTMLDivElement>(null);
  const [limites, setLimites] = useState(LIMITES_ANTES_DE_MEDIR);
  const [arrastando, setArrastando] = useState(false);
  const [arrasto] = useState(() =>
    criarArrastoDoQuadro((valor) => {
      setArrastando(valor);
      if (valor) {
        // Como num clique comum, apertar desfaz a selecao que havia (e o
        // navegador nao tenta arrastar um texto selecionado).
        document.getSelection()?.removeAllRanges();
      }
    }),
  );

  const medir = useCallback(() => {
    const quadro = ref.current;
    if (!quadro) {
      return;
    }
    const medidos = limitesDaRolagem(quadro);
    setLimites((atuais) =>
      atuais.excede === medidos.excede &&
      atuais.noComeco === medidos.noComeco &&
      atuais.noFim === medidos.noFim
        ? atuais
        : medidos,
    );
  }, []);

  // Mede antes da pintura, a cada rolagem (as pontas mudam) e a cada mudanca
  // de tamanho (janela, menu lateral recolhido ou aberto).
  useLayoutEffect(() => {
    const quadro = ref.current;
    if (!quadro) {
      return;
    }
    medir();
    quadro.addEventListener("scroll", medir, { passive: true });
    const observador =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observador?.observe(quadro);
    return () => {
      quadro.removeEventListener("scroll", medir);
      observador?.disconnect();
    };
  }, [medir]);

  const rolar = useCallback((sentido: Sentido) => {
    const quadro = ref.current;
    if (!quadro) {
      return;
    }
    quadro.scrollBy(
      rolagemDasSetas(
        quadro.clientWidth,
        sentido,
        window.matchMedia(MENOS_MOVIMENTO).matches,
      ),
    );
  }, []);

  return {
    ref,
    limites,
    arrastando,
    medir,
    rolar,
    eventosDoArrasto: {
      onPointerDown: arrasto.aoApertar,
      onPointerMove: arrasto.aoMover,
      onPointerUp: arrasto.aoSoltar,
      onPointerCancel: arrasto.aoSoltar,
      onLostPointerCapture: arrasto.aoSoltar,
    },
  };
}
