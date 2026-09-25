"use client";

import { SendHorizonal } from "lucide-react";
import { useState } from "react";

import {
  situacaoDoNumero,
  telefoneDoNumero,
} from "@/components/automacoes/numeros-de-envio";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NumeroDaClinica } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Por qual numero o teste da mensagem sai (varios numeros por clinica,
// docs/07, Fase 4). So abre com MAIS DE UM numero ativo: com um so, o botao
// testa direto, como sempre. O numero manda o teste para ele mesmo
// (testarEnvioAction), entao so numero conectado pode ser escolhido; o
// desconectado fica visivel, desabilitado, com o caminho para reconectar.
//
// Montado so enquanto aberto (quem chama decide): cada abertura comeca no
// numero padrao, nunca na escolha da vez anterior.

export function DialogoDeTeste({
  numeros,
  padraoId,
  pendente,
  onFechar,
  onEnviar,
}: {
  numeros: NumeroDaClinica[];
  /** O numero ja marcado (numeroPadraoDoTeste): conectado, ou nulo. */
  padraoId: string | null;
  pendente: boolean;
  onFechar: () => void;
  onEnviar: (whatsappAccountId: string) => void;
}) {
  const [escolhido, setEscolhido] = useState<string | null>(padraoId);
  const algumConectado = numeros.some(
    (numero) => numero.connection_status === "conectado",
  );

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Testar no WhatsApp da clínica</DialogTitle>
          <DialogDescription>
            O teste sai pelo número escolhido e chega nele mesmo, com dados de
            exemplo. Nenhum paciente recebe.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={pendente} className="grid gap-2">
          <legend className="sr-only">Por qual número o teste sai</legend>
          {numeros.map((numero) => {
            const conectado = numero.connection_status === "conectado";
            const marcado = escolhido === numero.id;
            const telefone = telefoneDoNumero(numero.display_phone);
            const idDetalhe = `numero-do-teste-${numero.id}`;
            return (
              <label
                key={numero.id}
                className={cn(
                  "flex min-h-10 items-start gap-3 rounded-xl border px-3.5 py-3 cz-transition",
                  !conectado
                    ? "cursor-not-allowed border-border bg-surface-4"
                    : marcado
                      ? "cursor-pointer border-primary-edge bg-primary-soft"
                      : "cursor-pointer border-border-strong bg-card hover:bg-surface-subtle",
                )}
              >
                <input
                  type="radio"
                  name="numero-do-teste"
                  value={numero.id}
                  checked={marcado}
                  disabled={!conectado}
                  aria-describedby={idDetalhe}
                  onChange={() => setEscolhido(numero.id)}
                  className="mt-0.5 size-4 shrink-0 accent-(--primary-edge)"
                />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span
                    className={cn(
                      "text-sm text-text-strong",
                      marcado ? "font-bold" : "font-semibold",
                    )}
                  >
                    {numero.nome}
                    {numero.principal ? (
                      <span className="font-normal text-text-secondary">
                        {" "}
                        (principal)
                      </span>
                    ) : null}
                  </span>
                  <span
                    id={idDetalhe}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    {telefone ? (
                      <span className="cz-num text-xs text-text-secondary">
                        {telefone}
                      </span>
                    ) : null}
                    <StatusChip
                      size="sm"
                      definition={situacaoDoNumero(numero.connection_status)}
                    />
                    {!conectado ? (
                      <span className="text-xs text-text-secondary">
                        Reconecte em Configurações para testar por este número.
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {!algumConectado ? (
          <Aviso tom="warning">
            Nenhum número está conectado agora. Reconecte em Configurações, aba
            WhatsApp, para testar.
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={pendente || escolhido === null}
            onClick={() => {
              if (escolhido !== null) {
                onEnviar(escolhido);
              }
            }}
          >
            <SendHorizonal aria-hidden />
            {pendente ? "Enviando..." : "Enviar teste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
