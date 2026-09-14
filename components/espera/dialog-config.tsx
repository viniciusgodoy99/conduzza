"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { salvarConfigReofertaAction } from "@/app/(app)/espera/actions";
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
import type { ConfigDaEspera } from "@/lib/queries/espera";

// Configuracao da reoferta (decisao do dono: onda configuravel por clinica,
// padrao 5; janela padrao 30 minutos). A policy de clinic so deixa o
// administrador salvar; a tela ja recebe essa permissao resolvida.

export function DialogConfig({
  aberto,
  onFechar,
  config,
  aoMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  config: ConfigDaEspera;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [onda, setOnda] = useState(String(config.waveSize));
  const [janela, setJanela] = useState(String(config.responseMinutes));
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    if (aberto) {
      setOnda(String(config.waveSize));
      setJanela(String(config.responseMinutes));
    }
  }, [aberto, config]);

  const salvar = () => {
    iniciarTransicao(async () => {
      const resultado = await salvarConfigReofertaAction({
        wave_size: Number(onda),
        response_minutes: Number(janela),
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível salvar.");
        return;
      }
      toast.success("Configuração da reoferta salva.");
      onFechar();
      await aoMudar();
    });
  };

  const valida =
    Number.isInteger(Number(onda)) &&
    Number(onda) >= 1 &&
    Number(onda) <= 20 &&
    Number.isInteger(Number(janela)) &&
    Number(janela) >= 5 &&
    Number(janela) <= 240;

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Como a reoferta funciona</DialogTitle>
          <DialogDescription>
            Quando um horário vaga, a oferta sai para as primeiras pessoas da
            fila e o primeiro que responder fica com ele.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="config-onda">Pessoas por onda</Label>
            <Input
              id="config-onda"
              type="number"
              min={1}
              max={20}
              className="h-10"
              value={onda}
              onChange={(e) => setOnda(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="config-janela">Minutos para responder</Label>
            <Input
              id="config-janela"
              type="number"
              min={5}
              max={240}
              className="h-10"
              value={janela}
              onChange={(e) => setJanela(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-text-tertiary">
          Ninguém respondeu no prazo, a oferta passa para as próximas pessoas
          da fila sozinha.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Cancelar
          </Button>
          <Button className="h-10" disabled={pendente || !valida} onClick={salvar}>
            {pendente ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
