"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Pergunta antes de excluir mensagem ou regua (achado 48). Excluir era um
// clique so, e o cascade do banco leva junto o historico de envios
// (cadence_run ON DELETE CASCADE): as metricas zeram, o chip da lista do dia
// some e uma resposta a mensagem ja enviada pode nao ser mais reconhecida. O
// dialogo diz exatamente o que se perde, no padrao das outras exclusoes do
// app ("Isso não pode ser desfeito."). Tres usos: passo, regua de excecao e
// regua de follow-up.

export function DialogoDeExclusao({
  aberto,
  titulo,
  descricao,
  consequencias,
  rotuloConfirmar,
  pendente,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  /** O que se perde, uma frase por item. */
  consequencias: readonly string[];
  rotuloConfirmar: string;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground marker:text-text-secondary">
          {consequencias.map((consequencia) => (
            <li key={consequencia}>{consequencia}</li>
          ))}
        </ul>
        <p className="text-[13px] font-semibold text-text-strong">
          Isso não pode ser desfeito.
        </p>
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={pendente}
            onClick={onConfirmar}
          >
            <Trash2 aria-hidden />
            {pendente ? "Excluindo..." : rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O que some quando o historico de envios vai junto (passo ou regua). */
export const PERDAS_DO_HISTORICO = {
  resposta:
    "Quem já recebeu continua com a mensagem no WhatsApp, mas uma resposta a ela pode não ser mais reconhecida e cai no Atendimento para a recepção.",
} as const;
