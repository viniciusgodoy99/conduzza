"use client";

import { Send, Trash2 } from "lucide-react";

import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// As duas confirmacoes do item da lista de agendadas (secao 4.4 do desenho):
// excluir (nao da para desfazer) e enviar agora (sai na hora, em nome de
// quem confirma). Os textos sao os do desenho. O erro aparece dentro do
// dialogo, que nao fecha: a pessoa le o motivo e decide.
//
// `aoFecharFoco` deixa quem abriu cuidar do foco depois de fechar (excluir
// tira o item da lista, e o foco vai para o proximo item ou para o titulo).

export function textoDaConfirmacaoDeExcluir(contato: string | null): string {
  const quem = contato?.trim() || "o contato";
  return `Ela não vai ser enviada para ${quem}. Não dá para desfazer.`;
}

export function tituloDaConfirmacaoDeEnviarAgora(
  contato: string | null,
): string {
  const quem = contato?.trim() || "o contato";
  return `Enviar agora para ${quem}?`;
}

export function textoDaConfirmacaoDeEnviarAgora(
  quando: string,
  numero: string | null,
): string {
  return numero?.trim()
    ? `A mensagem marcada para ${quando} sai agora, em seu nome, pelo número ${numero.trim()}.`
    : `A mensagem marcada para ${quando} sai agora, em seu nome.`;
}

type CascaProps = {
  aberto: boolean;
  aoFechar: () => void;
  pendente: boolean;
  erro: string | null;
  aoConfirmar: () => void;
  /** Ao fechar: devolve true quando quem abriu ja cuidou do foco */
  aoFecharFoco?: () => boolean;
};

export function ConfirmacaoDeExcluir({
  aberto,
  aoFechar,
  pendente,
  erro,
  aoConfirmar,
  aoFecharFoco,
  contato,
}: CascaProps & { contato: string | null }) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir && !pendente) {
          aoFechar();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[420px]"
        onCloseAutoFocus={(evento) => {
          if (aoFecharFoco?.()) {
            evento.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Excluir esta mensagem agendada?</DialogTitle>
          <DialogDescription>
            {textoDaConfirmacaoDeExcluir(contato)}
          </DialogDescription>
        </DialogHeader>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={aoFechar}
            disabled={pendente}
          >
            Manter
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={aoConfirmar}
            disabled={pendente}
          >
            <Trash2 aria-hidden className="size-4" />
            {pendente ? "Excluindo..." : "Excluir mensagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmacaoDeEnviarAgora({
  aberto,
  aoFechar,
  pendente,
  erro,
  aoConfirmar,
  aoFecharFoco,
  contato,
  quando,
  numero,
}: CascaProps & {
  contato: string | null;
  /** "amanhã às 09:00", "08/10 às 11:00" */
  quando: string;
  /** O nome do numero, so com mais de um numero ativo */
  numero: string | null;
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir && !pendente) {
          aoFechar();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[420px]"
        onCloseAutoFocus={(evento) => {
          if (aoFecharFoco?.()) {
            evento.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{tituloDaConfirmacaoDeEnviarAgora(contato)}</DialogTitle>
          <DialogDescription>
            {textoDaConfirmacaoDeEnviarAgora(quando, numero)}
          </DialogDescription>
        </DialogHeader>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={aoFechar}
            disabled={pendente}
          >
            Manter agendada
          </Button>
          <Button type="button" onClick={aoConfirmar} disabled={pendente}>
            <Send aria-hidden className="size-4" />
            {pendente ? "Enviando..." : "Enviar agora"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
