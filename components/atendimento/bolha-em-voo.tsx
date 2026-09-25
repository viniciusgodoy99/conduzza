"use client";

import {
  Lock,
  OctagonAlert,
  RotateCcw,
  SendHorizonal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EnvioEmVoo } from "@/lib/domain/envios-em-voo";
import { cn } from "@/lib/utils";

// A mensagem que a atendente já mandou e que ainda não voltou do servidor.
//
// Ela existe porque a caixa de texto passou a esvaziar NA HORA. Sem esta
// bolha haveria uma janela em que o texto sumiu da caixa e nada apareceu na
// conversa, que é pior que a demora original: parece que a mensagem se perdeu.
//
// Desenho do design system (docs/06 secao 5.3, "Envio em voo"): a mesma casca
// da bolha real (raio 18, cauda de 6px a direita), tracejada enquanto nao
// volta. Icones da tabela de reservados (secao 4.6): "enviando" e
// SendHorizonal (o Clock e so do status Aguardando) e a falha e OctagonAlert
// em alerta, o mesmo da mensagem real que nao foi entregue (o TriangleAlert
// e so do status Faltou).

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
          "grid max-w-[74%] gap-1 rounded-bubble rounded-br-[6px] border border-dashed px-3 py-2",
          envio.ehNota
            ? "border-(--warning) bg-warning-bg text-warning-text"
            : "border-border-heavy bg-transparent text-foreground",
        )}
      >
        {envio.ehNota ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-warning-text">
            <Lock aria-hidden className="size-3" />
            Nota interna, o paciente não vê
          </span>
        ) : null}
        <p className="text-[13.5px] leading-[1.5] break-words whitespace-pre-wrap">
          {envio.corpo}
        </p>
        {/* Três camadas, como a regra 5 exige: a forma do aviãozinho, a
            palavra "enviando" e o tom de apoio. Fica no mesmo canto onde a
            hora e o "falhou" das mensagens reais já vivem, para a pessoa
            procurar o estado sempre no mesmo lugar. Um ícone, uma cor: o
            mesmo tom na resposta e na nota. */}
        <span className="flex items-center justify-end gap-1 cz-num text-[11px] text-text-secondary">
          <SendHorizonal aria-hidden className="size-3" />
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
      <div className="grid max-w-[74%] gap-2 rounded-bubble rounded-br-[6px] border border-(--alert) bg-alert-bg px-3 py-2.5 text-foreground">
        <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-alert-text">
          <OctagonAlert aria-hidden className="size-3 shrink-0" />
          {envio.incerto ? "Envio não confirmado" : "Não enviada"}
        </span>
        <p className="text-[13.5px] leading-[1.5] break-words whitespace-pre-wrap">
          {envio.corpo}
        </p>
        {envio.erro ? (
          <p className="text-[11.5px] text-text-secondary">{envio.erro}</p>
        ) : null}
        {/* flex-wrap: no celular a bolha tem 74% da largura do fio, e os dois
            botoes lado a lado passavam da borda do cartao. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 justify-self-end">
          {/* Envio INCERTO não ganha botão de reenviar.
              A linha nasce no banco antes da espera anti-ban, então uma falha
              de rede na volta não prova que nada saiu. Um reenvio às cegas faz
              o paciente receber a mesma coisa duas vezes, e neste canal não
              oficial mensagem repetida é do tipo que acelera banimento do
              número da clínica. Quem quiser mandar de novo confere a conversa
              e escreve, que é um gesto consciente. */}
          {envio.incerto ? null : (
            <Button size="sm" variant="outline" onClick={aoTentarDeNovo}>
              <RotateCcw aria-hidden />
              Tentar de novo
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={aoDescartar}>
            <Trash2 aria-hidden />
            {envio.incerto ? "Entendi, esconder" : "Descartar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
