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
  // Recuperacao de soluco no meio do audio: cada pedaco passa pela rota (sessao,
  // RLS, trilha, Storage), e um pedaco que falha faz o navegador desistir do
  // elemento. Ate 2 vezes, o player recarrega e volta ao mesmo ponto; o
  // contador zera quando o audio volta a tocar.
  const tocouRef = useRef(false);
  const tocandoRef = useRef(false);
  const posicaoRef = useRef(0);
  const tentativasRef = useRef(0);

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
    </div>
  );
}
