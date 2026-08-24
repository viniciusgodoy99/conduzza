"use client";

import { Package2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  excluirPacoteAction,
  salvarPacoteAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Pacote } from "@/lib/queries/catalogo";
import { formatarCentavos } from "@/lib/utils/moeda";

type FormPacote = {
  id?: string;
  procedure_id: string;
  sessions: string;
  preco: string;
  validity_days: string;
};

const FORM_VAZIO: FormPacote = {
  procedure_id: "",
  sessions: "10",
  preco: "",
  validity_days: "",
};

// Converte "1.234,56" (ou "1234.56") digitado em reais para centavos.
function reaisParaCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

function centavosParaReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function PacotesTab({ catalogo, podeEditar, dica, aoMudar }: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormPacote>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pacoteParaRemover, setPacoteParaRemover] = useState<Pacote | null>(
    null,
  );
  const [removendo, setRemovendo] = useState(false);
  const [erroRemocao, setErroRemocao] = useState<string | null>(null);

  const nomeProcedimento = (procedureId: string) =>
    catalogo.procedimentos.find((p) => p.id === procedureId)?.name ??
    "Procedimento removido";

  const abrir = (pacote?: Pacote) => {
    setErro(null);
    setForm(
      pacote
        ? {
            id: pacote.id,
            procedure_id: pacote.procedure_id,
            sessions: String(pacote.sessions),
            preco: centavosParaReais(pacote.price_cents),
            validity_days:
              pacote.validity_days === null ? "" : String(pacote.validity_days),
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const salvar = async () => {
    setErro(null);
    if (!form.procedure_id) {
      setErro("Escolha o procedimento do pacote.");
      return;
    }
    const sessions = Number(form.sessions);
    if (!Number.isInteger(sessions) || sessions < 1) {
      setErro("Informe quantas sessões o pacote inclui (no mínimo 1).");
      return;
    }
    const priceCents = reaisParaCentavos(form.preco);
    if (priceCents === null) {
      setErro("Informe o preço do pacote em reais.");
      return;
    }
    let validityDays: number | null = null;
    if (form.validity_days.trim() !== "") {
      const dias = Number(form.validity_days);
      if (!Number.isInteger(dias) || dias < 1) {
        setErro(
          "A validade precisa ser um número de dias (ou fique em branco).",
        );
        return;
      }
      validityDays = dias;
    }

    setSalvando(true);
    const resultado = await salvarPacoteAction({
      id: form.id,
      procedure_id: form.procedure_id,
      sessions,
      price_cents: priceCents,
      validity_days: validityDays,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Pacote atualizado" : "Pacote criado");
    setAberto(false);
    aoMudar();
  };

  const remover = async () => {
    if (!pacoteParaRemover) return;
    setRemovendo(true);
    setErroRemocao(null);
    const resultado = await excluirPacoteAction(pacoteParaRemover.id);
    setRemovendo(false);
    if (!resultado.ok) {
      setErroRemocao(resultado.error ?? "Não foi possível remover o pacote.");
      return;
    }
    toast.success("Pacote removido");
    setPacoteParaRemover(null);
    aoMudar();
  };

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus strokeWidth={1.5} className="size-4" /> Novo pacote
        </BotaoProtegido>
      </div>

      {catalogo.pacotes.length === 0 ? (
        <EmptyState
          icon={Package2}
          title="Nenhum pacote cadastrado"
          description="Pacotes de várias sessões (10 de drenagem, por exemplo) são essenciais em estética. Cadastre o primeiro para a recepção oferecer."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Procedimento</TableHead>
                <TableHead>Sessões</TableHead>
                <TableHead>Preço do pacote</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.pacotes.map((pacote) => (
                <TableRow key={pacote.id}>
                  <TableCell className="font-medium">
                    {nomeProcedimento(pacote.procedure_id)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {pacote.sessions}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] tabular-nums">
                    {formatarCentavos(pacote.price_cents)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {pacote.validity_days === null
                      ? "Sem validade"
                      : `${pacote.validity_days} dias`}
                  </TableCell>
                  <TableCell>
                    {podeEditar ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => abrir(pacote)}
                          aria-label={`Editar pacote de ${nomeProcedimento(pacote.procedure_id)}`}
                        >
                          <Pencil strokeWidth={1.5} className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => {
                            setErroRemocao(null);
                            setPacoteParaRemover(pacote);
                          }}
                          aria-label={`Remover pacote de ${nomeProcedimento(pacote.procedure_id)}`}
                        >
                          <Trash2 strokeWidth={1.5} className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent className="w-[380px] p-5">
          <SheetHeader className="p-0">
            <SheetTitle>{form.id ? "Editar pacote" : "Novo pacote"}</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="pacote-procedimento">Procedimento</Label>
              <Select
                value={form.procedure_id}
                onValueChange={(v) => setForm({ ...form, procedure_id: v })}
              >
                <SelectTrigger id="pacote-procedimento" className="h-10 w-full">
                  <SelectValue placeholder="Escolha o procedimento" />
                </SelectTrigger>
                <SelectContent>
                  {catalogo.procedimentos.map((procedimento) => (
                    <SelectItem key={procedimento.id} value={procedimento.id}>
                      {procedimento.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pacote-sessoes">Quantidade de sessões</Label>
              <Input
                id="pacote-sessoes"
                type="number"
                min={1}
                value={form.sessions}
                onChange={(e) => setForm({ ...form, sessions: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pacote-preco">Preço do pacote (R$)</Label>
              <Input
                id="pacote-preco"
                inputMode="decimal"
                placeholder="Ex.: 1.200,00"
                value={form.preco}
                onChange={(e) => setForm({ ...form, preco: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pacote-validade">Validade (dias)</Label>
              <Input
                id="pacote-validade"
                type="number"
                min={1}
                placeholder="Em branco: sem validade"
                value={form.validity_days}
                onChange={(e) =>
                  setForm({ ...form, validity_days: e.target.value })
                }
                className="h-10"
              />
            </div>
            {erro ? (
              <p role="alert" className="text-sm [color:var(--alert-text)]">
                {erro}
              </p>
            ) : null}
            <Button onClick={salvar} disabled={salvando} className="h-10">
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={pacoteParaRemover !== null}
        onOpenChange={(open) => {
          if (!open) setPacoteParaRemover(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover este pacote?</DialogTitle>
          </DialogHeader>
          {pacoteParaRemover ? (
            <p className="text-sm text-text-secondary">
              {nomeProcedimento(pacoteParaRemover.procedure_id)},{" "}
              {pacoteParaRemover.sessions}{" "}
              {pacoteParaRemover.sessions === 1 ? "sessão" : "sessões"},{" "}
              {formatarCentavos(pacoteParaRemover.price_cents)}.
            </p>
          ) : null}
          {erroRemocao ? (
            <p role="alert" className="text-sm [color:var(--alert-text)]">
              {erroRemocao}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setPacoteParaRemover(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="h-10"
              onClick={remover}
              disabled={removendo}
            >
              {removendo ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
