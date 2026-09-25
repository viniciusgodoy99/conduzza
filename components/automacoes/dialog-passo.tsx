"use client";

import { useEffect, useState } from "react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Dialogo de momento de um passo: criar mensagem nova (momento + texto) ou
// mudar o momento de uma existente. O SENTIDO e da regua e nao se escolhe:
// confirmacao conta antes da consulta, pos falta conta depois do evento.

export function DialogPasso({
  aberto,
  onFechar,
  titulo,
  sentido,
  eventoRotulo,
  offsetInicialMin,
  pedirTexto,
  pendente,
  aoConfirmar,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  sentido: "antes" | "depois";
  /** "a consulta" | "a falta", para a frase do dialogo. */
  eventoRotulo: string;
  offsetInicialMin: number | null;
  pedirTexto: boolean;
  pendente: boolean;
  aoConfirmar: (offsetMinutes: number, texto: string) => void;
}) {
  const absoluto = Math.abs(offsetInicialMin ?? 1440);
  const emDias = absoluto % 1440 === 0 && absoluto > 0;
  const [valor, setValor] = useState(
    String(emDias ? absoluto / 1440 : Math.max(1, Math.round(absoluto / 60))),
  );
  const [unidade, setUnidade] = useState<"horas" | "dias">(
    emDias ? "dias" : "horas",
  );
  const [texto, setTexto] = useState("");

  useEffect(() => {
    if (!aberto) {
      return;
    }
    const abs = Math.abs(offsetInicialMin ?? 1440);
    const dias = abs % 1440 === 0 && abs > 0;
    setValor(String(dias ? abs / 1440 : Math.max(1, Math.round(abs / 60))));
    setUnidade(dias ? "dias" : "horas");
    setTexto("");
  }, [aberto, offsetInicialMin]);

  const confirmar = () => {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero < 0) {
      return;
    }
    const minutos = numero * (unidade === "dias" ? 1440 : 60);
    aoConfirmar(sentido === "antes" ? -minutos : minutos, texto.trim());
  };

  const valorValido =
    Number.isInteger(Number(valor)) &&
    Number(valor) >= (sentido === "antes" ? 1 : 0) &&
    Number(valor) * (unidade === "dias" ? 1440 : 60) <= 43_200;

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {sentido === "antes"
              ? `Quanto tempo antes d${eventoRotulo} a mensagem sai.`
              : `Quanto tempo depois d${eventoRotulo} a mensagem sai. Zero envia no mesmo dia.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="passo-valor">Quanto tempo</Label>
            <Input
              id="passo-valor"
              type="number"
              min={sentido === "antes" ? 1 : 0}
              className="cz-num"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="passo-unidade">Unidade</Label>
            <Select
              value={unidade}
              onValueChange={(v) => setUnidade(v as "horas" | "dias")}
            >
              <SelectTrigger id="passo-unidade" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="horas">
                  {sentido === "antes" ? "horas antes" : "horas depois"}
                </SelectItem>
                <SelectItem value="dias">
                  {sentido === "antes" ? "dias antes" : "dias depois"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {pedirTexto ? (
          <div className="grid gap-1.5">
            <Label htmlFor="passo-texto">Mensagem</Label>
            <Textarea
              id="passo-texto"
              rows={4}
              maxLength={2000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escreva a mensagem. Dá para ajustar depois no editor."
              className="text-sm"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={
              pendente || !valorValido || (pedirTexto && texto.trim() === "")
            }
            onClick={confirmar}
          >
            {pendente ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
