"use client";

import { Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
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

export function BarraDeAnexo({
  aoEnviar,
  pendente,
  desabilitado,
  arquivoDeFora,
  aoConsumirArquivoDeFora,
}: {
  aoEnviar: (arquivo: File, legenda: string, notaDeVoz: boolean) => void;
  pendente: boolean;
  desabilitado: boolean;
  /** arquivo vindo de arrastar e soltar ou de colar, tratado no compositor */
  arquivoDeFora?: File | null;
  aoConsumirArquivoDeFora?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [legenda, setLegenda] = useState("");
  const [notaDeVoz, setNotaDeVoz] = useState(false);
  const [gravando, setGravando] = useState(false);
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

  // Arrastar e colar entram por aqui: o estado do arquivo escolhido e um so,
  // senao a previa mostraria um arquivo e o envio mandaria outro.
  useEffect(() => {
    if (!arquivoDeFora) {
      return;
    }
    void (async () => {
      const pronto = await reduzirImagem(arquivoDeFora);
      setEscolhido(pronto);
      setNotaDeVoz(false);
      aoConsumirArquivoDeFora?.();
    })();
  }, [arquivoDeFora, aoConsumirArquivoDeFora]);

  const receber = async (arquivo: File) => {
    const pronto = await reduzirImagem(arquivo);
    setEscolhido(pronto);
    setNotaDeVoz(false);
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const gravador = new MediaRecorder(stream);
      pedacosRef.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) {
          pedacosRef.current.push(evento.data);
        }
      };
      gravador.onstop = () => {
        const blob = new Blob(pedacosRef.current, { type: "audio/webm" });
        setEscolhido(
          new File([blob], "nota-de-voz.webm", { type: "audio/webm" }),
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

  if (escolhido) {
    const ehImagem = escolhido.type.startsWith("image/");
    return (
      <div className="grid gap-2 rounded-lg border bg-surface-2 p-2.5">
        <div className="flex items-center gap-2.5">
          {ehImagem ? (
            // eslint-disable-next-line @next/next/no-img-element -- previa local
            <img
              src={URL.createObjectURL(escolhido)}
              alt=""
              className="size-12 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-4">
              <Paperclip strokeWidth={1.5} className="size-5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {notaDeVoz ? "Nota de voz" : escolhido.name}
            </span>
            <span className="text-[11.5px] text-text-tertiary">
              {tamanhoLegivel(escolhido.size)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEscolhido(null);
              setLegenda("");
              setNotaDeVoz(false);
            }}
            aria-label="Remover o arquivo"
          >
            <X strokeWidth={1.5} className="size-4" />
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <input
            value={legenda}
            onChange={(evento) => setLegenda(evento.target.value)}
            placeholder="Legenda (opcional)"
            aria-label="Legenda do arquivo"
            className="h-10 flex-1 rounded-lg border border-input bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button
            type="button"
            disabled={pendente}
            onClick={() => aoEnviar(escolhido, legenda, notaDeVoz)}
          >
            <Send strokeWidth={1.5} className="size-4" />
            {pendente ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACEITOS.join(",")}
        className="sr-only"
        onChange={(evento) => {
          const arquivo = evento.target.files?.[0];
          if (arquivo) {
            void receber(arquivo);
          }
          evento.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={desabilitado || gravando}
        onClick={() => inputRef.current?.click()}
        aria-label="Anexar arquivo"
        title="Anexar foto, documento ou áudio"
      >
        <Paperclip strokeWidth={1.5} className="size-4" />
      </Button>
      <Button
        type="button"
        variant={gravando ? "destructive" : "ghost"}
        size="sm"
        disabled={desabilitado}
        onClick={() => (gravando ? pararGravacao() : void iniciarGravacao())}
        aria-label={gravando ? "Parar a gravação" : "Gravar nota de voz"}
        title={gravando ? "Parar a gravação" : "Gravar nota de voz"}
      >
        {gravando ? (
          <Square strokeWidth={1.5} className="size-4" />
        ) : (
          <Mic strokeWidth={1.5} className="size-4" />
        )}
        {gravando ? (
          <span className="font-mono text-[11px] tabular-nums">
            {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
          </span>
        ) : null}
      </Button>
    </div>
  );
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

  return { props, sobrevoando, classes: cn(sobrevoando && "ring-2 ring-ring/50") };
}
