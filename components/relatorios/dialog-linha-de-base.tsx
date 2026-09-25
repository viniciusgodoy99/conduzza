"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { registrarLinhaDeBaseAction } from "@/app/(app)/relatorios/actions";
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
import { Textarea } from "@/components/ui/textarea";

// Registro da linha de base de no-show (tarefa 6.3): o numero e INFORMADO
// pela clinica, medido nos 30 dias anteriores a implantacao, e so o
// administrador registra. Corrigir e registrar de novo: a tabela e
// append-only e a linha mais recente vale.

export function DialogLinhaDeBase({
  aberto,
  onFechar,
  aoMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [taxa, setTaxa] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [nota, setNota] = useState("");
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    if (aberto) {
      setTaxa("");
      setDe("");
      setAte("");
      setNota("");
    }
  }, [aberto]);

  const taxaNumero = Number(taxa.replace(",", "."));
  const valida =
    taxa.trim() !== "" &&
    Number.isFinite(taxaNumero) &&
    taxaNumero >= 0 &&
    taxaNumero <= 100 &&
    /^\d{4}-\d{2}-\d{2}$/.test(de) &&
    /^\d{4}-\d{2}-\d{2}$/.test(ate) &&
    de <= ate;

  const salvar = () => {
    iniciarTransicao(async () => {
      const resultado = await registrarLinhaDeBaseAction({
        rate_percent: Math.round(taxaNumero * 100) / 100,
        measured_from: de,
        measured_to: ate,
        note: nota.trim() || undefined,
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível registrar.");
        return;
      }
      if (resultado.aviso) {
        toast.warning(resultado.aviso);
      } else {
        toast.success("Linha de base registrada.");
      }
      onFechar();
      await aoMudar();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar a linha de base</DialogTitle>
          <DialogDescription>
            A taxa de faltas da clínica ANTES das mensagens automáticas, medida
            no período indicado. É contra esse número que o relatório prova o
            resultado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="linha-de-base-taxa">Taxa de faltas (%)</Label>
            <Input
              id="linha-de-base-taxa"
              inputMode="decimal"
              placeholder="Ex.: 18"
              value={taxa}
              onChange={(evento) => setTaxa(evento.target.value)}
              className="cz-num"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Período medido</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={de}
                onChange={(evento) => setDe(evento.target.value)}
                className="cz-num"
                aria-label="Início do período medido"
              />
              <span className="text-xs text-text-secondary">até</span>
              <Input
                type="date"
                value={ate}
                onChange={(evento) => setAte(evento.target.value)}
                className="cz-num"
                aria-label="Fim do período medido"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="linha-de-base-nota">
              Como foi medida (opcional)
            </Label>
            <Textarea
              id="linha-de-base-nota"
              placeholder="Ex.: planilha da recepção, agenda de papel, sistema anterior"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!valida || pendente} onClick={salvar}>
            {pendente ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
