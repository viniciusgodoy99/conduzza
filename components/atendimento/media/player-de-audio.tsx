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

  useEffect(() => {
    const elemento = audioRef.current;
    if (!elemento) {
      return;
    }
    const aoTempo = () => setPosicao(elemento.currentTime);
    const aoCarregar = () => setDuracao(elemento.duration);
    const aoTerminar = () => {
      setTocando(false);
      setPosicao(0);
    };
    elemento.addEventListener("timeupdate", aoTempo);
    elemento.addEventListener("loadedmetadata", aoCarregar);
    elemento.addEventListener("ended", aoTerminar);
    return () => {
      elemento.removeEventListener("timeupdate", aoTempo);
      elemento.removeEventListener("loadedmetadata", aoCarregar);
      elemento.removeEventListener("ended", aoTerminar);
    };
  }, []);

  if (falhou) {
    return (
      <span className="text-[12.5px] text-text-secondary">
        Não foi possível carregar o áudio
      </span>
    );
  }

  const alternar = () => {
    const elemento = audioRef.current;
    if (!elemento) {
      return;
    }
    if (elemento.paused) {
      void elemento.play();
      setTocando(true);
    } else {
      elemento.pause();
      setTocando(false);
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      <audio
        ref={audioRef}
        src={`/api/atendimento/midia/${messageId}`}
        preload="metadata"
        onError={() => setFalhou(true)}
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? "Pausar o áudio" : "Tocar o áudio"}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-4 hover:bg-surface-5 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {tocando ? (
          <Pause strokeWidth={1.5} className="size-4" />
        ) : (
          <Play strokeWidth={1.5} className="size-4" />
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
        className="h-1 min-w-[110px] flex-1 cursor-pointer accent-[var(--primary)]"
      />
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
        {duracao > 0 ? `${tempo(posicao)} / ${tempo(duracao)}` : tempo(posicao)}
      </span>
    </div>
  );
}
