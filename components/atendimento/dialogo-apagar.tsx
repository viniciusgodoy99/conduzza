"use client";

import { differenceInMinutes } from "date-fns";
import { CircleSlash, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MessageItem } from "@/lib/queries/conversations";

// Apagar mensagem, com as duas opcoes do WhatsApp.
//
// O prazo de 60 horas e do WhatsApp, nao nosso: passado ele, o aplicativo do
// paciente recusa a revogacao. Conferimos aqui E no banco
// (pode_apagar_mensagem). A copia da tela existe para nao oferecer um botao
// que vai falhar; quem decide de verdade continua sendo o banco, e se as duas
// divergirem a pessoa ve a recusa em texto.
const PRAZO_MINUTOS = 60 * 60;

/** A mensagem chegou a sair para o WhatsApp? */
function saiuDaClinica(message: MessageItem): boolean {
  return (
    message.delivery_status === "enviada" ||
    message.delivery_status === "entregue" ||
    message.delivery_status === "lida"
  );
}

/**
 * Por que "apagar para todos" nao cabe nesta mensagem, se nao couber.
 *
 * Exportada porque a bolha precisa da MESMA resposta para decidir se ainda
 * oferece o menu numa mensagem apagada so aqui. Duas copias desta regra
 * divergiriam, e a divergencia apareceria como um botao que abre um dialogo
 * onde tudo esta desabilitado.
 */
export function impedimentoParaTodos(message: MessageItem): string | null {
  if (message.is_internal_note) {
    return "Nota interna nunca saiu da clínica, então só existe aqui.";
  }
  if (message.direction === "entrada") {
    return "O WhatsApp não deixa apagar no aparelho do paciente uma mensagem que foi ele quem escreveu.";
  }
  if (!saiuDaClinica(message)) {
    return "Esta mensagem não chegou a sair, então não há o que apagar no WhatsApp do paciente.";
  }
  const minutos = differenceInMinutes(new Date(), new Date(message.created_at));
  if (minutos > PRAZO_MINUTOS) {
    return "O WhatsApp só deixa apagar para todos até 60 horas depois do envio.";
  }
  return null;
}

export function DialogoApagar({
  message,
  aberto,
  aoFechar,
  aoApagar,
  pendente,
  erro,
}: {
  message: MessageItem | null;
  aberto: boolean;
  aoFechar: () => void;
  aoApagar: (escopo: "todos" | "local") => void;
  pendente: boolean;
  erro: string | null;
}) {
  const [escolhido, setEscolhido] = useState<"todos" | "local" | null>(null);
  if (!message) {
    return null;
  }
  const impedimento = impedimentoParaTodos(message);
  // Já apagada só aqui, e a pessoa voltou para ampliar o alcance. O conteúdo já
  // foi para o cofre; o que falta é tirar do celular do paciente.
  const ampliando = message.deleted_at !== null;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) {
          setEscolhido(null);
          aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {ampliando
              ? "Apagar também no WhatsApp do paciente?"
              : "Apagar esta mensagem?"}
          </DialogTitle>
          <DialogDescription>
            {ampliando
              ? "Esta mensagem já saiu da conversa da clínica, mas continua no celular do paciente."
              : "O conteúdo sai da conversa e fica guardado no registro da clínica, com a hora e o nome de quem apagou."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={pendente || impedimento !== null}
            onClick={() => {
              setEscolhido("todos");
              aoApagar("todos");
            }}
          >
            <Trash2 strokeWidth={1.5} className="size-4 shrink-0" />
            <span className="grid gap-0.5">
              <span className="text-[13px] font-semibold">
                Apagar para todos
              </span>
              <span className="text-[11.5px] font-normal text-text-secondary">
                Some daqui e do WhatsApp do paciente. Ele vê que uma mensagem
                foi apagada.
              </span>
            </span>
            {pendente && escolhido === "todos" ? (
              <span className="ml-auto text-[11.5px] text-text-tertiary">
                Apagando...
              </span>
            ) : null}
          </Button>

          {/* O motivo fica FORA do botão desabilitado.
              Dentro, ele herdava o disabled:opacity-50 e caía para 2,3:1 de
              contraste, abaixo do mínimo AA de 4,5:1 da regra 5: a única
              explicação de por que a ação não cabe era justamente a parte
              ilegível. O title de reserva também não funcionava, porque botão
              desabilitado não dispara tooltip. */}
          {impedimento ? (
            <p className="px-1 text-[11.5px] leading-snug text-text-secondary">
              {impedimento}
            </p>
          ) : null}

          {!ampliando ? (
            <Button
              variant="outline"
              className="h-auto justify-start gap-3 py-3 text-left"
              disabled={pendente}
              onClick={() => {
                setEscolhido("local");
                aoApagar("local");
              }}
            >
              <CircleSlash strokeWidth={1.5} className="size-4 shrink-0" />
              <span className="grid gap-0.5">
                <span className="text-[13px] font-semibold">
                  Apagar só aqui
                </span>
                <span className="text-[11.5px] font-normal text-text-secondary">
                  {message.is_internal_note
                    ? "Some da conversa da clínica. A nota nunca foi para o paciente."
                    : "Some da conversa da clínica. O paciente continua vendo no celular dele."}
                </span>
              </span>
              {pendente && escolhido === "local" ? (
                <span className="ml-auto text-[11.5px] text-text-tertiary">
                  Apagando...
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>

        {erro ? (
          <p role="alert" className="text-[12px] [color:var(--alert-text)]">
            {erro}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={aoFechar}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
