"use client";

import { Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Anexar e gravar, no compositor do Atendimento.
//
// Tres caminhos para o mesmo lugar, porque a recepcao usa os tres: o clipe
// (escolher no computador), arrastar e soltar sobre a conversa, e colar uma
// imagem copiada. Faltar qualquer um deles faz a pessoa achar que o sistema
// nao aceita arquivo.
//
// FOTO E REDUZIDA ANTES DE SUBIR. Uma foto de celular passa de 4 MB e seria
// recusada pelo limite de corpo da plataforma. Reduzir para 1600px de lado
// maior resolve na origem e ainda deixa a foto legivel para leitura de exame.
// Documento nao pode ser reduzido: acima do teto, a mensagem diz o tamanho.

const LADO_MAXIMO = 1600;
const QUALIDADE = 0.85;
const TETO_BYTES = 3_800_000;

const ACEITOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "application/pdf",
];

async function reduzirImagem(arquivo: File): Promise<File> {
  if (!arquivo.type.startsWith("image/") || arquivo.type === "image/gif") {
    return arquivo;
  }
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(
      1,
      LADO_MAXIMO / Math.max(bitmap.width, bitmap.height),
    );
    if (escala === 1 && arquivo.size <= TETO_BYTES) {
      return arquivo;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return arquivo;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALIDADE),
    );
    if (!blob) {
      return arquivo;
    }
    return new File([blob], arquivo.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    // Navegador sem suporte: segue com o original e o teto decide.
    return arquivo;
  }
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * As duas partes que a barra entrega ao compositor, que decide onde cada uma
 * fica: os BOTOES (clipe e microfone, na linha de ferramentas) e a PREVIA do
 * arquivo escolhido (acima do campo). O estado mora aqui, num lugar so: se
 * cada parte tivesse o seu, a previa mostraria um arquivo e o envio mandaria
 * outro.
 */
export type PartesDoAnexo = {
  botoes: React.ReactNode;
  previa: React.ReactNode;
};

export function BarraDeAnexo({
  aoEnviar,
  pendente,
  desabilitado,
  arquivoDeFora,
  aoConsumirArquivoDeFora,
  enviadoEm,
  children,
}: {
  /** Posiciona as partes; a barra nao decide o layout do compositor */
  children: (partes: PartesDoAnexo) => React.ReactNode;
  aoEnviar: (arquivo: File, legenda: string, notaDeVoz: boolean) => void;
  pendente: boolean;
  desabilitado: boolean;
  /** arquivo vindo de arrastar e soltar ou de colar, tratado no compositor */
  arquivoDeFora?: File | null;
  aoConsumirArquivoDeFora?: () => void;
  /**
   * Carimbo que muda a cada envio BEM-SUCEDIDO. Sem isto a previa continua na
   * tela com o botao ativo depois do envio, e o reflexo de clicar de novo
   * manda o MESMO arquivo outra vez ao paciente (nao ha idempotencia neste
   * caminho, cada clique gera um id novo).
   */
  enviadoEm?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [legenda, setLegenda] = useState("");
  const [notaDeVoz, setNotaDeVoz] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!gravando) {
      return;
    }
    const timer = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [gravando]);

  // Envio concluiu: limpa a previa. Sem isto o botao volta a ficar ativo com o
  // mesmo arquivo e o segundo clique reenvia ao paciente.
  const primeiroCarimbo = useRef(enviadoEm);
  useEffect(() => {
    if (enviadoEm && enviadoEm !== primeiroCarimbo.current) {
      primeiroCarimbo.current = enviadoEm;
      setEscolhido(null);
      setLegenda("");
      setNotaDeVoz(false);
      setErroLocal(null);
    }
  }, [enviadoEm]);

  // O microfone precisa ser solto quando o componente sai da tela. Sem isto,
  // trocar para a aba de nota interna no meio de uma gravacao deixa o
  // indicador do navegador aceso e o microfone da recepcao aberto, ouvindo a
  // sala, sem nada na tela dizendo isso.
  useEffect(() => {
    return () => {
      const g = gravadorRef.current;
      if (g && g.state !== "inactive") {
        g.stream.getTracks().forEach((t) => t.stop());
        g.stop();
      }
    };
  }, []);

  // Arrastar e colar entram por aqui: o estado do arquivo escolhido e um so,
  // senao a previa mostraria um arquivo e o envio mandaria outro.
  useEffect(() => {
    if (!arquivoDeFora) {
      return;
    }
    void (async () => {
      await receber(arquivoDeFora);
      aoConsumirArquivoDeFora?.();
    })();
  }, [arquivoDeFora, aoConsumirArquivoDeFora]);

  const receber = async (arquivo: File) => {
    const pronto = await reduzirImagem(arquivo);
    // O teto existe no servidor, mas o corpo da requisicao e cortado pela
    // plataforma ANTES de chegar la: sem esta guarda, um PDF grande falha sem
    // nenhuma mensagem util na tela.
    if (pronto.size > TETO_BYTES) {
      setErroLocal(
        `O arquivo tem ${tamanhoLegivel(pronto.size)} e o limite é de 3,8 MB.`,
      );
      setEscolhido(null);
      return;
    }
    setErroLocal(null);
    setEscolhido(pronto);
    setNotaDeVoz(false);
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // O formato NAO pode ser fixado no codigo: o Safari grava audio/mp4 e o
      // Firefox audio/ogg. Rotular tudo como webm faria o arquivo mentir sobre
      // o proprio conteudo, e o WhatsApp recusaria ou entregaria mudo.
      const gravador = new MediaRecorder(stream);
      pedacosRef.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) {
          pedacosRef.current.push(evento.data);
        }
      };
      gravador.onstop = () => {
        const formato = (gravador.mimeType || "audio/webm").split(";")[0]!;
        const extensao = formato.includes("mp4")
          ? "m4a"
          : formato.includes("ogg")
            ? "ogg"
            : "webm";
        const blob = new Blob(pedacosRef.current, { type: formato });
        setEscolhido(
          new File([blob], `nota-de-voz.${extensao}`, { type: formato }),
        );
        setNotaDeVoz(true);
        stream.getTracks().forEach((t) => t.stop());
      };
      gravador.start();
      gravadorRef.current = gravador;
      setSegundos(0);
      setGravando(true);
    } catch {
      // Permissao negada ou sem microfone: o botao volta ao normal e a pessoa
      // ainda pode anexar um audio pelo clipe.
      setGravando(false);
    }
  };

  const pararGravacao = () => {
    gravadorRef.current?.stop();
    gravadorRef.current = null;
    setGravando(false);
  };

  const removerArquivo = () => {
    setEscolhido(null);
    setLegenda("");
    setNotaDeVoz(false);
  };

  const previa = escolhido ? (
    <div className="grid gap-2 rounded-xl border border-border-strong bg-card p-2.5 shadow-xs">
      <div className="flex items-center gap-2.5">
        {escolhido.type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- previa local
          <img
            src={URL.createObjectURL(escolhido)}
            alt=""
            className="size-12 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-4">
            {notaDeVoz ? (
              <Mic aria-hidden className="size-5 text-text-secondary" />
            ) : (
              <Paperclip aria-hidden className="size-5 text-text-secondary" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-text-strong">
            {notaDeVoz ? "Nota de voz" : escolhido.name}
          </span>
          <span className="cz-num text-[11.5px] text-text-secondary">
            {tamanhoLegivel(escolhido.size)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={removerArquivo}
          aria-label="Remover o arquivo"
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={legenda}
          onChange={(evento) => setLegenda(evento.target.value)}
          placeholder="Legenda (opcional)"
          aria-label="Legenda do arquivo"
          className="min-w-[160px] flex-1"
        />
        {/* Tinta, e nao lime: o lime da tela e o Enviar do texto. */}
        <Button
          type="button"
          variant="solid"
          disabled={pendente}
          onClick={() => aoEnviar(escolhido, legenda, notaDeVoz)}
        >
          <Send aria-hidden />
          {pendente ? "Enviando..." : "Enviar arquivo"}
        </Button>
      </div>
    </div>
  ) : erroLocal ? (
    <p role="alert" className="text-[12px] text-alert-text">
      {erroLocal}
    </p>
  ) : null;

  const botoes = escolhido ? null : (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACEITOS.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(evento) => {
          const arquivo = evento.target.files?.[0];
          if (arquivo) {
            void receber(arquivo);
          }
          evento.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-text-secondary"
            disabled={desabilitado || gravando}
            onClick={() => inputRef.current?.click()}
            aria-label="Anexar arquivo"
          >
            <Paperclip aria-hidden className="size-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Anexar arquivo</TooltipContent>
      </Tooltip>
      {gravando ? (
        <button
          type="button"
          onClick={pararGravacao}
          aria-label="Parar a gravação"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-alert-bg px-3 text-[13px] font-semibold text-alert-text cz-transition hover:bg-alert-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <Square aria-hidden className="size-4" />
          Gravando
          <span className="cz-num">
            {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
          </span>
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-text-secondary"
              disabled={desabilitado}
              onClick={() => void iniciarGravacao()}
              aria-label="Gravar nota de voz"
            >
              <Mic aria-hidden className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Gravar nota de voz</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return <>{children({ botoes, previa })}</>;
}

/** Aceita o arquivo vindo de arrastar e soltar ou de colar. */
export function useArquivoSolto(
  aoReceber: (arquivo: File) => void,
  ativo: boolean,
) {
  const [sobrevoando, setSobrevoando] = useState(false);

  const props = {
    onDragOver: (evento: React.DragEvent) => {
      if (!ativo) return;
      evento.preventDefault();
      setSobrevoando(true);
    },
    onDragLeave: () => setSobrevoando(false),
    onDrop: (evento: React.DragEvent) => {
      if (!ativo) return;
      evento.preventDefault();
      setSobrevoando(false);
      const arquivo = evento.dataTransfer.files?.[0];
      if (arquivo) {
        aoReceber(arquivo);
      }
    },
    onPaste: (evento: React.ClipboardEvent) => {
      if (!ativo) return;
      const arquivo = Array.from(evento.clipboardData.files)[0];
      if (arquivo) {
        evento.preventDefault();
        aoReceber(arquivo);
      }
    },
  };

  return {
    props,
    sobrevoando,
    classes: cn(
      sobrevoando &&
        "outline-2 -outline-offset-4 outline-dashed outline-primary-edge",
    ),
  };
}
