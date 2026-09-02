"use client";

import { Download, ImageOff, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

// Foto recebida do paciente: miniatura na bolha, tela cheia ao clicar.
//
// TAMANHO FIXO de proposito. O fio rola para o fim quando chega mensagem nova
// (thread.tsx:78), e imagem sem altura reservada faz o conteudo pular na cara
// de quem esta lendo. 240x180 reserva o espaco antes de o arquivo chegar.
//
// A hora fica ABAIXO da foto, nunca sobreposta: hora por cima exigiria um veu
// escuro para o contraste, e veu e gradiente decorativo, proibido pela secao 5.

const LARGURA = 240;
const ALTURA = 180;

export function FotoDaConversa({
  messageId,
  legenda,
}: {
  messageId: string;
  legenda: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const src = `/api/atendimento/midia/${messageId}`;

  if (falhou) {
    return (
      <div
        className="grid place-items-center gap-1.5 rounded-md border border-dashed p-4 text-center"
        style={{ width: LARGURA, height: ALTURA }}
      >
        <ImageOff strokeWidth={1.5} className="size-5 text-text-tertiary" />
        <span className="text-[12px] text-text-secondary">
          Não foi possível carregar a foto
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="block overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        style={{ width: LARGURA, height: ALTURA }}
        aria-label="Abrir a foto em tela cheia"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a rota devolve
            302 para uma URL assinada de validade curta; o otimizador do Next
            precisaria de dominio fixo e guardaria copia de foto de paciente. */}
        <img
          src={src}
          alt={legenda ?? "Foto enviada pelo paciente"}
          width={LARGURA}
          height={ALTURA}
          className="size-full bg-surface-3 object-cover"
          onError={() => setFalhou(true)}
        />
      </button>

      {aberta ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Foto em tela cheia"
          onClick={() => setAberta(false)}
        >
          <div
            className="grid max-h-full max-w-4xl gap-3"
            onClick={(evento) => evento.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- mesmo motivo */}
            <img
              src={src}
              alt={legenda ?? "Foto enviada pelo paciente"}
              className="max-h-[80vh] w-auto rounded-md object-contain"
            />
            <div className="flex items-center justify-between gap-3">
              {legenda ? (
                <p className="text-[13px] text-white">{legenda}</p>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 gap-2">
                {/* download=1 e obrigatorio: <a download> e ignorado quando a
                    resposta vem de outro dominio, e sem ele o clique NAVEGA
                    para o arquivo em vez de baixar. */}
                <Button asChild variant="secondary" size="sm">
                  <a href={`${src}?download=1`}>
                    <Download strokeWidth={1.5} className="size-4" />
                    Baixar
                  </a>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAberta(false)}
                >
                  <X strokeWidth={1.5} className="size-4" />
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
