"use client";

import { useState } from "react";
import { toast } from "sonner";

import { concederConsentimentoAction } from "@/app/(app)/leads/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Registro da autorizacao a partir da lista do dia (achado 57). O paciente
// marcado por telefone nasce sem autorizacao (regra 3.3) e a confirmacao
// automatica pula a consulta; antes, a recepcao via "nao autorizou mensagens"
// e nao tinha caminho dali. E a MESMA Server Action da ficha
// (concederConsentimentoAction), com origem recepcao e evidencia obrigatoria:
// quem registra precisa dizer quando e como o paciente autorizou. So aparece
// para "sem autorizacao registrada"; quem pediu para nao receber volta pela
// ficha, onde a evidencia de reconsentimento e conferida de novo.

export function DialogoDeAutorizacao({
  contactId,
  nome,
  onFechar,
  aoRegistrar,
}: {
  contactId: string;
  nome: string;
  onFechar: () => void;
  /** Recarrega a lista: a linha deixa de aparecer como sem autorizacao. */
  aoRegistrar: () => Promise<unknown> | void;
}) {
  const [evidencia, setEvidencia] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const evidenciaValida = evidencia.trim().length >= 2;

  const registrar = async () => {
    if (!evidenciaValida) {
      setErro("Descreva quando e como o paciente autorizou.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await concederConsentimentoAction({
      contact_id: contactId,
      source: "recepcao",
      evidence: evidencia.trim(),
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível registrar a autorização.");
      return;
    }
    toast.success("Autorização registrada");
    await aoRegistrar();
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Registrar autorização</DialogTitle>
          <DialogDescription>
            Registre como {nome} autorizou a clínica a mandar mensagem no
            WhatsApp. Com a autorização registrada, as próximas mensagens
            automáticas podem sair para este paciente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
            <span className="text-text-secondary">Como autorizou</span>
            <span className="text-foreground">Recepção</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirmacoes-autorizacao-evidencia">
              Evidência
            </Label>
            <Input
              id="confirmacoes-autorizacao-evidencia"
              value={evidencia}
              maxLength={500}
              autoFocus
              placeholder="Ex.: autorizou por telefone ao marcar a consulta"
              onChange={(evento) => setEvidencia(evento.target.value)}
            />
            <p className="text-[11px] text-text-secondary">
              Obrigatória: quando e como a autorização foi dada.
            </p>
          </div>
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            disabled={salvando || !evidenciaValida}
            onClick={() => void registrar()}
          >
            {salvando ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
