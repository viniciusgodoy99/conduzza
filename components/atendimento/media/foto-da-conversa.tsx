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
        className="grid place-items-center gap-1.5 rounded-xl border border-dashed border-border-heavy bg-surface-4 p-4 text-center text-text-secondary"
        style={{ width: LARGURA, height: ALTURA }}
      >
        <ImageOff aria-hidden className="size-5" />
        <span className="text-[12px]">Não foi possível carregar a foto</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
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
          className="size-full bg-surface-4 object-cover"
          onError={() => setFalhou(true)}
        />
      </button>

      {aberta ? (
        // Visor sem desfoque (C14): fundo de midia escuro e opaco nos dois
        // temas. Os controles e a legenda vao em cartao, e nao em texto
        // solto sobre o escuro, para o contraste nao depender do tema.
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-(--overlay-media) p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Foto em tela cheia"
          onClick={() => setAberta(false)}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") {
              setAberta(false);
            }
          }}
        >
          <div
            className="grid max-h-full max-w-4xl gap-3"
            onClick={(evento) => evento.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- mesmo motivo */}
            <img
              src={src}
              alt={legenda ?? "Foto enviada pelo paciente"}
              className="max-h-[80vh] w-auto rounded-xl object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              {legenda ? (
                <p className="min-w-0 rounded-md bg-card px-3 py-2 text-[13px] text-foreground">
                  {legenda}
                </p>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 gap-2">
                {/* download=1 e obrigatorio: <a download> e ignorado quando a
                    resposta vem de outro dominio, e sem ele o clique NAVEGA
                    para o arquivo em vez de baixar. */}
                <Button asChild variant="outline">
                  <a href={`${src}?download=1`}>
                    <Download aria-hidden />
                    Baixar
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAberta(false)}
                  autoFocus
                >
                  <X aria-hidden />
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
