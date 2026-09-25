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

  // Os mesmos limites da action (e do banco); cada campo diz o seu, e o
  // Salvar so libera com os dois dentro.
  const ondaValida =
    onda.trim() !== "" &&
    Number.isInteger(Number(onda)) &&
    Number(onda) >= 1 &&
    Number(onda) <= 20;
  const janelaValida =
    janela.trim() !== "" &&
    Number.isInteger(Number(janela)) &&
    Number(janela) >= 5 &&
    Number(janela) <= 240;
  const valida = ondaValida && janelaValida;

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Como a reoferta funciona</DialogTitle>
          <DialogDescription>
            Quando um horário vaga, a oferta sai para as primeiras pessoas da
            fila e o primeiro que responder fica com ele.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="config-onda">Pessoas por onda</Label>
            <Input
              id="config-onda"
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              className="cz-num"
              aria-invalid={!ondaValida}
              aria-describedby="config-onda-dica"
              value={onda}
              onChange={(e) => setOnda(e.target.value)}
            />
            <p
              id="config-onda-dica"
              className={
                ondaValida
                  ? "text-[11px] text-text-secondary"
                  : "text-[11px] font-medium text-alert-text"
              }
            >
              De <span className="cz-num">1</span> a{" "}
              <span className="cz-num">20</span> pessoas.
            </p>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="config-janela">Minutos para responder</Label>
            <Input
              id="config-janela"
              type="number"
              inputMode="numeric"
              min={5}
              max={240}
              className="cz-num"
              aria-invalid={!janelaValida}
              aria-describedby="config-janela-dica"
              value={janela}
              onChange={(e) => setJanela(e.target.value)}
            />
            <p
              id="config-janela-dica"
              className={
                janelaValida
                  ? "text-[11px] text-text-secondary"
                  : "text-[11px] font-medium text-alert-text"
              }
            >
              De <span className="cz-num">5</span> a{" "}
              <span className="cz-num">240</span> minutos.
            </p>
          </div>
        </div>
        <p className="text-[13px] text-text-secondary">
          Ninguém respondeu no prazo, a oferta passa para as próximas pessoas da
          fila sozinha.
        </p>
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={pendente || !valida} onClick={salvar}>
            {pendente ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
