"use client";

import { useState } from "react";
import { toast } from "sonner";

import { mudarEtapaAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOST_REASONS } from "@/lib/domain/leads-ui";

// Mover para Perdido exige motivo (check do banco e regra do funil). Este
// dialogo e a UNICA porta: o Kanban e a barra de acoes em massa abrem ele e
// so a confirmacao persiste. Cancelar nao grava nada.

export function ModalMotivoPerda({
  contactIds,
  onFechar,
  onSucesso,
}: {
  /** null fecha o dialogo; a lista de ids abre (1 do Kanban, N da massa). */
  contactIds: string[] | null;
  onFechar: () => void;
  onSucesso?: (ids: string[], motivo: string, nota: string | null) => void;
}) {
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aberto = contactIds !== null && contactIds.length > 0;

  const fechar = () => {
    setMotivo(null);
    setNota("");
    setErro(null);
    onFechar();
  };

  const confirmar = async () => {
    if (!contactIds || !motivo) {
      return;
    }
    const notaAparada = nota.trim();
    if (motivo === "outro" && notaAparada.length < 2) {
      setErro("Descreva o motivo da perda.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await mudarEtapaAction({
      contact_ids: contactIds,
      etapa: "perdido",
      lost_reason: motivo,
      lost_reason_note: notaAparada ? notaAparada : undefined,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível marcar como perdido.");
      return;
    }
    toast.success(
      contactIds.length > 1
        ? `${contactIds.length} leads marcados como perdidos`
        : "Lead marcado como perdido",
    );
    onSucesso?.(contactIds, motivo, notaAparada ? notaAparada : null);
    fechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => (!a ? fechar() : null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Motivo da perda</DialogTitle>
          <DialogDescription>
            {contactIds && contactIds.length > 1
              ? `Escolha por que estes ${contactIds.length} leads não seguiram.`
              : "Escolha por que este lead não seguiu."}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Motivo da perda" className="grid">
          {LOST_REASONS.map((opcao) => (
            <label
              key={opcao.codigo}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 hover:bg-surface-3"
            >
              <input
                type="radio"
                name="motivo-perda"
                value={opcao.codigo}
                checked={motivo === opcao.codigo}
                onChange={() => setMotivo(opcao.codigo)}
                className="size-4 accent-primary"
              />
              <span className="text-sm">{opcao.rotulo}</span>
            </label>
          ))}
        </div>
        {motivo === "outro" ? (
          <div className="grid gap-2">
            <Label htmlFor="perda-nota">Descreva o motivo</Label>
            <Textarea
              id="perda-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
            />
          </div>
        ) : null}
        {erro ? (
          <p role="alert" className="text-sm [color:var(--alert-text)]">
            {erro}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            className="h-10"
            onClick={confirmar}
            disabled={salvando || !motivo}
          >
            {salvando ? "Salvando..." : "Marcar como perdido"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
