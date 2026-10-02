"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  definirObjetivoDeConversaoAction,
  removerObjetivoDeConversaoAction,
} from "@/app/(app)/relatorios/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatarPercentualDoObjetivo,
  lerPercentualDoObjetivo,
} from "@/lib/domain/exportacao-de-resultados";
import type { ObjetivoDeConversao } from "@/lib/queries/relatorios";

// Objetivo de conversao (A3): o percentual que a clinica quer ver na Taxa de
// conversao. So admin e gestor abrem este dialogo (para os outros papeis o
// botao fica visivel e desabilitado, com dica). A mesma faixa vale aqui, no
// Zod da Server Action e no check do banco: de 0,1 a 100, uma casa decimal.

export function DialogObjetivoDeConversao({
  aberto,
  onFechar,
  objetivo,
  aoMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  objetivo: ObjetivoDeConversao;
  aoMudar: () => Promise<unknown> | void;
}) {
  const idDoCampo = useId();
  const idDaAjuda = useId();
  const [texto, setTexto] = useState("");
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    if (aberto) {
      setTexto(
        objetivo ? formatarPercentualDoObjetivo(objetivo.percentual) : "",
      );
    }
  }, [aberto, objetivo]);

  const percentual = lerPercentualDoObjetivo(texto);
  const invalido = texto.trim() !== "" && percentual === null;

  const salvar = () => {
    if (percentual === null) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await definirObjetivoDeConversaoAction({ percentual });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível salvar o objetivo.");
        return;
      }
      toast.success("Objetivo de conversão salvo.");
      onFechar();
      await aoMudar();
    });
  };

  const remover = () => {
    iniciarTransicao(async () => {
      const resultado = await removerObjetivoDeConversaoAction();
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível remover o objetivo.");
        return;
      }
      toast.success("Objetivo de conversão removido.");
      onFechar();
      await aoMudar();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Objetivo de conversão</DialogTitle>
          <DialogDescription>
            A porcentagem de leads do período que a clínica quer ver agendando
            consulta. Aparece embaixo da taxa de conversão, para comparar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={idDoCampo}>Objetivo (%)</Label>
          <Input
            id={idDoCampo}
            inputMode="decimal"
            placeholder="Ex.: 60"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" && percentual !== null && !pendente) {
                evento.preventDefault();
                salvar();
              }
            }}
            aria-invalid={invalido || undefined}
            aria-describedby={idDaAjuda}
            className="cz-num"
          />
          <p
            id={idDaAjuda}
            className={
              invalido ? "text-xs text-alert-text" : "text-xs text-text-secondary"
            }
          >
            De 0,1 a 100, com até uma casa decimal.
          </p>
        </div>
        <DialogFooter className="gap-2">
          {objetivo ? (
            <Button
              variant="destructive"
              className="sm:mr-auto"
              disabled={pendente}
              onClick={remover}
            >
              Remover objetivo
            </Button>
          ) : null}
          <Button variant="outline" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button disabled={percentual === null || pendente} onClick={salvar}>
            {pendente ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
