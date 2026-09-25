"use client";

import { FileText, Reply } from "lucide-react";

// Pre-visualizacao em balao de WhatsApp: corpo de texto, botoes (confirmacao)
// e, quando o passo tem anexo, a midia acima do texto, como o paciente ve.
//
// Ponto de vista do PACIENTE (docs/06 secao 5.10, C30): a mensagem chega
// como bolha recebida, a esquerda, branca, com os botoes em fileiras neutras
// embaixo, como o WhatsApp mostra. Sem lime: a previa nao gasta a cor da
// tela e nao confunde com a bolha da atendente.

export type AnexoDaPreview = {
  tipo: "image" | "audio" | "document";
  /** URL assinada; null enquanto assina (mostra o cartao sem a midia). */
  url: string | null;
  nome: string | null;
};

export function BalaoWhatsApp({
  corpo,
  botoes,
  anexo,
  seguinte,
}: {
  corpo: string;
  botoes?: string[];
  anexo?: AnexoDaPreview | null;
  /**
   * Segunda mensagem que o envio real manda logo depois (com anexo, a
   * confirmacao vira a midia e em seguida o menu com os botoes).
   */
  seguinte?: { corpo: string; botoes?: string[] } | null;
}) {
  // O WhatsApp nao mostra legenda em audio. Com audio E texto, o envio real
  // manda o audio sozinho e o texto numa mensagem separada, logo depois (com
  // os botoes, na confirmacao): a previa mostra os DOIS baloes, senao
  // prometeria um texto embaixo do player que o paciente nunca ve.
  if (anexo?.tipo === "audio" && corpo) {
    return (
      <div
        role="group"
        className="grid gap-2 rounded-card bg-surface-4 p-3.5"
        aria-label="Pré-visualização das mensagens"
      >
        <Bolha corpo="" anexo={anexo} />
        <Bolha corpo={corpo} botoes={botoes} />
      </div>
    );
  }
  if (seguinte) {
    return (
      <div
        role="group"
        className="grid gap-2 rounded-card bg-surface-4 p-3.5"
        aria-label="Pré-visualização das mensagens"
      >
        <Bolha corpo={corpo} anexo={anexo} />
        <Bolha corpo={seguinte.corpo} botoes={seguinte.botoes} />
      </div>
    );
  }
  return (
    <div
      role="group"
      className="grid gap-2 rounded-card bg-surface-4 p-3.5"
      aria-label="Pré-visualização da mensagem"
    >
      <Bolha corpo={corpo} botoes={botoes} anexo={anexo} />
    </div>
  );
}

function Bolha({
  corpo,
  botoes,
  anexo,
}: {
  corpo: string;
  botoes?: string[];
  anexo?: AnexoDaPreview | null;
}) {
  return (
    <div className="w-full max-w-[320px] justify-self-start overflow-hidden rounded-bubble rounded-bl-[6px] border border-border bg-card text-[13.5px] leading-[1.5] text-foreground shadow-xs">
      <div className="px-3 pt-[9px] pb-[7px]">
        {anexo ? (
          <div className="mb-2">
            {anexo.tipo === "image" && anexo.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={anexo.url}
                alt="Foto anexada ao passo"
                className="max-h-40 w-full rounded-md object-cover"
              />
            ) : anexo.tipo === "audio" && anexo.url ? (
              <audio controls src={anexo.url} className="w-full">
                O navegador não toca este áudio.
              </audio>
            ) : (
              <span className="flex items-center gap-2 rounded-md bg-surface-4 px-2.5 py-2 text-[12.5px]">
                <FileText
                  className="size-4 shrink-0 text-text-secondary"
                  aria-hidden
                />
                <span className="min-w-0 truncate">
                  {anexo.nome ?? "Arquivo anexado"}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {corpo || !anexo ? (
          <p
            className={
              corpo ? "whitespace-pre-line" : "text-text-secondary italic"
            }
          >
            {corpo || "A mensagem aparece aqui enquanto você escreve."}
          </p>
        ) : null}
        <p className="mt-1 text-right cz-num text-[11px] text-text-secondary">
          14:00
        </p>
      </div>
      {botoes && botoes.length > 0 ? (
        <div className="grid">
          {botoes.map((botao) => (
            <span
              key={botao}
              className="flex h-9 items-center justify-center gap-1.5 border-t border-border text-[13px] font-semibold text-foreground"
            >
              <Reply className="size-3.5 shrink-0" aria-hidden />
              {botao}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
