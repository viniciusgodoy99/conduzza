"use client";

import { Clock, Lock, RotateCcw, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EnvioEmVoo } from "@/lib/domain/envios-em-voo";
import { cn } from "@/lib/utils";

// A mensagem que a atendente já mandou e que ainda não voltou do servidor.
//
// Ela existe porque a caixa de texto passou a esvaziar NA HORA. Sem esta
// bolha haveria uma janela em que o texto sumiu da caixa e nada apareceu na
// conversa, que é pior que a demora original: parece que a mensagem se perdeu.

export function BolhaEmVoo({
  envio,
  aoTentarDeNovo,
  aoDescartar,
}: {
  envio: EnvioEmVoo;
  aoTentarDeNovo: () => void;
  aoDescartar: () => void;
}) {
  if (envio.estado === "falhou") {
    return (
      <CartaoNaoEnviada
        envio={envio}
        aoTentarDeNovo={aoTentarDeNovo}
        aoDescartar={aoDescartar}
      />
    );
  }
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "grid max-w-[74%] gap-1 border border-dashed px-3 py-2",
          "rounded-[14px_4px_14px_14px]",
          envio.ehNota
            ? "[border-color:var(--warning)] [background:var(--warning-bg)]"
            : "border-border-strong bg-surface-4/60",
        )}
      >
        {envio.ehNota ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold [color:var(--warning-text)]">
            <Lock strokeWidth={1.5} className="size-3" />
            Nota interna, o paciente não vê
          </span>
        ) : null}
        <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
          {envio.corpo}
        </p>
        {/* Três camadas, como a regra 5 exige: a forma do relógio, a palavra
            "enviando" e a cor esmaecida. Fica no mesmo canto onde a hora e o
            "falhou" das mensagens reais já vivem, para a pessoa procurar o
            estado sempre no mesmo lugar. */}
        <span className="flex items-center justify-end gap-1 font-mono text-[10.5px] text-text-tertiary tabular-nums">
          <Clock strokeWidth={1.5} className="size-3" />
          enviando
        </span>
      </div>
    </div>
  );
}

/**
 * A mensagem não saiu, e o texto dela mora aqui.
 *
 * Este cartão é a razão de ser segura a limpeza imediata da caixa: sem um
 * lugar para a mensagem recusada existir, esvaziar a caixa na hora seria
 * perder o que a pessoa escreveu. Ele espera na conversa a que pertence, mesmo
 * que a atendente já tenha ido atender outra pessoa.
 */
function CartaoNaoEnviada({
  envio,
  aoTentarDeNovo,
  aoDescartar,
}: {
  envio: EnvioEmVoo;
  aoTentarDeNovo: () => void;
  aoDescartar: () => void;
}) {
  return (
    <div className="flex justify-end">
      <div className="grid max-w-[74%] gap-2 rounded-[14px_4px_14px_14px] border [border-color:var(--alert)] px-3 py-2 [background:var(--alert-bg)]">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold [color:var(--alert-text)]">
          <TriangleAlert strokeWidth={1.5} className="size-3 shrink-0" />
          {envio.incerto ? "Envio não confirmado" : "Não enviada"}
        </span>
        <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
          {envio.corpo}
        </p>
        {envio.erro ? (
          <p className="text-[11.5px] text-text-secondary">{envio.erro}</p>
        ) : null}
        <div className="flex items-center gap-1.5 justify-self-end">
          {/* Envio INCERTO não ganha botão de reenviar.
              A linha nasce no banco antes da espera anti-ban, então uma falha
              de rede na volta não prova que nada saiu. Um reenvio às cegas faz
              o paciente receber a mesma coisa duas vezes, e neste canal não
              oficial mensagem repetida é do tipo que acelera banimento do
              número da clínica. Quem quiser mandar de novo confere a conversa
              e escreve, que é um gesto consciente. */}
          {envio.incerto ? null : (
            <Button size="sm" variant="outline" onClick={aoTentarDeNovo}>
              <RotateCcw strokeWidth={1.5} className="size-4" />
              Tentar de novo
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={aoDescartar}>
            <Trash2 strokeWidth={1.5} className="size-4" />
            {envio.incerto ? "Entendi, esconder" : "Descartar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
