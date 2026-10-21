"use client";

import { CircleQuestionMark, Power, PowerOff } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  definirInterruptorGeralAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import { LIGADO_DESLIGADO_STATUS } from "@/components/agente/whatsapp/agente-de-ia";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// O interruptor geral do agente (todas as clinicas de uma vez), no topo da
// lista do Painel geral desde a onda 2 (decisao P8 do dono; antes, um
// cartao da aba Agente de IA de Configuracoes). O mesmo comportamento de
// antes: ligar pede confirmacao; desligar e na hora (o lado seguro: as
// conversas do agente voltam para a equipe, sem mensagem ao paciente). So a
// equipe Conduzza chega ao painel; a acao e o banco conferem de novo. O
// estado em 3 camadas (Ligado, CircleCheck success; Desligado, CirclePause
// neutral). Leitura que falhou: o aviso, nunca um estado inventado.

export function InterruptorGeral({
  ligado,
}: {
  /** Nulo: a leitura do interruptor falhou. */
  ligado: boolean | null;
}) {
  const ids = useId();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const mudar = (novo: boolean) => {
    setErro(null);
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await definirInterruptorGeralAction({ ligado: novo });
      } catch {
        r = null;
      }
      setConfirmando(false);
      if (r?.ok) {
        toast.success(
          novo
            ? TEXTOS_DO_PAINEL.interruptorLigado
            : TEXTOS_DO_PAINEL.interruptorDesligado,
        );
        return;
      }
      const texto = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(texto);
      toast.error(texto);
    });
  };

  return (
    <Card role="region" aria-labelledby={`${ids}-titulo`}>
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id={`${ids}-titulo`}>
            {TEXTOS_DO_PAINEL.interruptorTitulo}
          </CardTitle>
          <CardDescription>
            {TEXTOS_DO_PAINEL.interruptorDescricao}
          </CardDescription>
        </div>
        {ligado === null ? null : (
          <CardAction>
            <StatusChip
              size="sm"
              definition={
                LIGADO_DESLIGADO_STATUS[ligado ? "ligado" : "desligado"]
              }
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* Sempre montada: o leitor de tela anuncia o erro novo. */}
        <div aria-live="polite" aria-atomic="true" className="grid gap-2">
          {erro ? (
            <Aviso tom="alert" role="note">
              {erro}
            </Aviso>
          ) : null}
        </div>
        {ligado === null ? (
          <Aviso tom="neutral" icone={CircleQuestionMark} role="note">
            {TEXTOS_DO_PAINEL.interruptorSemLeitura}
          </Aviso>
        ) : ligado ? (
          <Button
            variant="outline"
            className="w-fit"
            disabled={pendente}
            aria-busy={pendente || undefined}
            onClick={() => mudar(false)}
          >
            <PowerOff aria-hidden />
            {pendente ? "Desligando..." : "Desligar o interruptor geral"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-fit"
            disabled={pendente}
            aria-busy={pendente || undefined}
            onClick={() => {
              setErro(null);
              setConfirmando(true);
            }}
          >
            <Power aria-hidden />
            {pendente ? "Ligando..." : "Ligar o interruptor geral"}
          </Button>
        )}
        <p className="text-[12px] text-text-secondary">
          {TEXTOS_DO_PAINEL.interruptorEfeito}
        </p>
      </CardContent>

      <Dialog
        open={confirmando}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setConfirmando(false) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{TEXTOS_DO_PAINEL.interruptorLigarTitulo}</DialogTitle>
            <DialogDescription>
              {TEXTOS_DO_PAINEL.interruptorLigarTexto}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              aria-busy={pendente || undefined}
              onClick={() => mudar(true)}
            >
              <Power aria-hidden />
              {pendente ? "Ligando..." : "Ligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
