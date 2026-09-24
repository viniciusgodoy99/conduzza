"use client";

import { FileText } from "lucide-react";

// Pre-visualizacao em balao de WhatsApp: corpo de texto, botoes (confirmacao)
// e, quando o passo tem anexo, a midia acima do texto, como o paciente ve.

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
}: {
  corpo: string;
  botoes?: string[];
  anexo?: AnexoDaPreview | null;
}) {
  // O WhatsApp nao mostra legenda em audio. Com audio E texto, o envio real
  // manda o audio sozinho e o texto numa mensagem separada, logo depois (com
  // os botoes, na confirmacao): a previa mostra os DOIS baloes, senao
  // prometeria um texto embaixo do player que o paciente nunca ve.
  if (anexo?.tipo === "audio" && corpo) {
    return (
      <div
        className="grid gap-2 rounded-lg p-3"
        style={{ background: "var(--surface-3)" }}
        aria-label="Pré-visualização das mensagens"
      >
        <Bolha corpo="" anexo={anexo} />
        <Bolha corpo={corpo} botoes={botoes} />
      </div>
    );
  }
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: "var(--surface-3)" }}
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
    <div className="max-w-xs rounded-lg rounded-tl-sm border bg-card p-3 shadow-sm">
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
            <span className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px]">
              <FileText
                strokeWidth={1.5}
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
      <p className="text-[13px] whitespace-pre-line">
        {corpo ||
          (anexo ? "" : "A mensagem aparece aqui enquanto você escreve.")}
      </p>
      {botoes && botoes.length > 0 ? (
        <div className="mt-2 grid gap-1 border-t pt-2">
          {botoes.map((botao) => (
            <span
              key={botao}
              className="rounded-md border py-1.5 text-center text-[12.5px] font-medium text-primary"
            >
              {botao}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-right text-[10px] text-text-tertiary">14:00</p>
    </div>
  );
}
