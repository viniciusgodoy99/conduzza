"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Player de audio recebido do paciente.
//
// SEM ONDA DESENHADA, de proposito. Uma onda de verdade exige decodificar o
// audio no navegador (caro, e num computador de recepcao isso trava a aba) ou
// o worker gravar os picos no download. Onda gerada a partir do id da mensagem
// seria desenho bonito representando dado que nao existe, e a secao 7 do
// CLAUDE.md e clara: nao inventar dado. Uma barra de progresso honesta diz a
// mesma coisa que importa, que e onde o audio esta.
//
// O <input type="range"> e nativo por acessibilidade: busca por teclado e
// leitura por leitor de tela vem de graca, e o alvo de toque passa dos 40px.
//
// preload="none" (02/10/2026): o audio so e pedido quando a pessoa toca. A
// rota entrega os bytes pela propria origem, pedaco por pedaco, com a sessao
// (nada expira; antes o link de 5 minutos vencia e o audio parava em uns 2
// segundos). Abrir uma conversa com varios audios nao dispara um pedido, nem
// um registro de "leu a midia" na trilha, para cada um. A duracao aparece
// depois do primeiro toque.

// Velocidade, como no WhatsApp (pedido do dono em 06/10/2026): o botao ao
// lado do tempo gira 1x, 1,5x e 2x. O navegador mantem o tom da voz
// (preservesPitch e o padrao). A escolha vale para todos os audios e fica
// guardada neste navegador (conveniencia de quem escuta; sem storage, volta
// a 1x). defaultPlaybackRate junto do playbackRate: a recuperacao de soluco
// chama load(), que devolveria o audio a 1x no meio da escuta.
export const VELOCIDADES_DO_AUDIO = [1, 1.5, 2] as const;
export type VelocidadeDoAudio = (typeof VELOCIDADES_DO_AUDIO)[number];
const CHAVE_DA_VELOCIDADE = "cz-audio-velocidade";

/** A proxima velocidade do giro (2x volta para 1x). */
export function proximaVelocidade(atual: VelocidadeDoAudio): VelocidadeDoAudio {
  const indice = VELOCIDADES_DO_AUDIO.indexOf(atual);
  return VELOCIDADES_DO_AUDIO[(indice + 1) % VELOCIDADES_DO_AUDIO.length] ?? 1;
}

/** "1x", "1,5x", "2x": a virgula decimal da recepcao. */
export function rotuloDaVelocidade(velocidade: VelocidadeDoAudio): string {
  return `${String(velocidade).replace(".", ",")}x`;
}

function velocidadeGuardada(): VelocidadeDoAudio {
  try {
    const salva = Number(window.localStorage.getItem(CHAVE_DA_VELOCIDADE));
    return VELOCIDADES_DO_AUDIO.find((v) => v === salva) ?? 1;
  } catch {
    return 1;
  }
}

function tempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) {
    return "0:00";
  }
  const min = Math.floor(segundos / 60);
  const seg = Math.floor(segundos % 60);
  return `${min}:${String(seg).padStart(2, "0")}`;
}

export function PlayerDeAudio({ messageId }: { messageId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  // Comeca em 1x no servidor e na hidratacao; a guardada entra no efeito.
  const [velocidade, setVelocidade] = useState<VelocidadeDoAudio>(1);
  // Recuperacao de soluco no meio do audio: cada pedaco passa pela rota (sessao,
  // RLS, trilha, Storage), e um pedaco que falha faz o navegador desistir do
  // elemento. Ate 2 vezes, o player recarrega e volta ao mesmo ponto; o
  // contador zera quando o audio volta a tocar.
  const tocouRef = useRef(false);
  const tocandoRef = useRef(false);
  const posicaoRef = useRef(0);
  const tentativasRef = useRef(0);

  useEffect(() => {
    setVelocidade(velocidadeGuardada());
  }, []);

  useEffect(() => {
    const elemento = audioRef.current;
    if (!elemento) {
      return;
    }
    elemento.defaultPlaybackRate = velocidade;
    elemento.playbackRate = velocidade;
  }, [velocidade]);

  const trocarVelocidade = () => {
    const proxima = proximaVelocidade(velocidade);
    setVelocidade(proxima);
    try {
      window.localStorage.setItem(CHAVE_DA_VELOCIDADE, String(proxima));
    } catch {
      // sem storage: vale so ate recarregar
    }
  };

  useEffect(() => {
    const elemento = audioRef.current;
    if (!elemento) {
      return;
    }
    const aoTempo = () => {
      posicaoRef.current = elemento.currentTime;
      setPosicao(elemento.currentTime);
    };
    const aoVoltarATocar = () => {
      tentativasRef.current = 0;
    };
    const aoCarregar = () => setDuracao(elemento.duration);
    const aoTerminar = () => {
      tocandoRef.current = false;
      posicaoRef.current = 0;
      setTocando(false);
      setPosicao(0);
    };
    elemento.addEventListener("playing", aoVoltarATocar);
    elemento.addEventListener("timeupdate", aoTempo);
    elemento.addEventListener("loadedmetadata", aoCarregar);
    elemento.addEventListener("ended", aoTerminar);
    return () => {
      elemento.removeEventListener("playing", aoVoltarATocar);
      elemento.removeEventListener("timeupdate", aoTempo);
      elemento.removeEventListener("loadedmetadata", aoCarregar);
      elemento.removeEventListener("ended", aoTerminar);
    };
  }, []);

  if (falhou) {
    return (
      <span className="text-[12.5px] text-(--bolha-meta,var(--text-secondary))">
        Não foi possível carregar o áudio
      </span>
    );
  }

  const tocar = (elemento: HTMLAudioElement) => {
    tocouRef.current = true;
    tocandoRef.current = true;
    setTocando(true);
    elemento.play().catch(() => {
      // Pedido de play interrompido (o load da recuperacao, por exemplo):
      // o botao volta ao "Tocar" em vez de mentir que esta tocando.
      tocandoRef.current = false;
      setTocando(false);
    });
  };

  const alternar = () => {
    const elemento = audioRef.current;
    if (!elemento) {
      return;
    }
    if (elemento.paused) {
      tocar(elemento);
    } else {
      elemento.pause();
      tocandoRef.current = false;
      setTocando(false);
    }
  };

  const aoErro = () => {
    const elemento = audioRef.current;
    if (!elemento || !tocouRef.current || tentativasRef.current >= 2) {
      setFalhou(true);
      return;
    }
    tentativasRef.current += 1;
    const voltarPara = posicaoRef.current;
    const estavaTocando = tocandoRef.current;
    elemento.addEventListener(
      "loadedmetadata",
      () => {
        elemento.currentTime = voltarPara;
        if (estavaTocando) {
          tocar(elemento);
        }
      },
      { once: true },
    );
    elemento.load();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <audio
        ref={audioRef}
        src={`/api/atendimento/midia/${messageId}`}
        preload="none"
        onError={aoErro}
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? "Pausar o áudio" : "Tocar o áudio"}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-4 text-text-strong cz-transition hover:bg-surface-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        {tocando ? (
          <Pause aria-hidden className="size-4" />
        ) : (
          <Play aria-hidden className="size-4" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duracao || 0}
        step={0.1}
        value={posicao}
        aria-label="Posição do áudio"
        onChange={(evento) => {
          const valor = Number(evento.target.value);
          setPosicao(valor);
          if (audioRef.current) {
            audioRef.current.currentTime = valor;
          }
        }}
        className="h-1 min-w-[110px] flex-1 cursor-pointer accent-(--primary-edge)"
      />
      <span className="shrink-0 cz-num text-[11px] text-(--bolha-meta,var(--text-secondary))">
        {duracao > 0 ? `${tempo(posicao)} / ${tempo(duracao)}` : tempo(posicao)}
      </span>
      <button
        type="button"
        onClick={trocarVelocidade}
        aria-label={`Velocidade do áudio: ${rotuloDaVelocidade(velocidade)}. Trocar para ${rotuloDaVelocidade(proximaVelocidade(velocidade))}`}
        title="Velocidade do áudio"
        // Alvo de 40px com a pilula pequena dentro (hit-40 nao funciona
        // dentro de overflow-hidden, e a bolha pode cortar).
        className="group/velocidade -my-1 grid size-10 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        <span
          aria-hidden
          className="inline-flex h-6 min-w-9 items-center justify-center rounded-full bg-surface-4 px-1.5 cz-num text-[11px] font-bold text-text-strong cz-transition group-hover/velocidade:bg-surface-5"
        >
          {rotuloDaVelocidade(velocidade)}
        </span>
      </button>
    </div>
  );
}
