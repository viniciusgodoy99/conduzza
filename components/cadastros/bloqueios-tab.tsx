"use client";

import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  criarBloqueiosEmLoteAction,
  excluirBloqueioAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { instanteLocal } from "@/lib/domain/horarios";
import type { Bloqueio } from "@/lib/queries/catalogo";

// Aba de Bloqueios pontuais (ferias, congresso, imprevisto). Almoco nao e
// bloqueio, e jornada. Criacao em lote conforme spec 3.9: varios
// profissionais de uma vez, mesmo periodo e motivo.

type FormBloqueio = {
  professionalIds: string[];
  inicio: string;
  fim: string;
  motivo: string;
  impedirEncaixe: boolean;
};

const FORM_VAZIO: FormBloqueio = {
  professionalIds: [],
  inicio: "",
  fim: "",
  motivo: "",
  impedirEncaixe: true,
};

function formatarMomento(iso: string, timezone: string): string {
  const data = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const hora = new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
}

export function BloqueiosTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
  timezone,
}: TabProps) {
  const [criarAberto, setCriarAberto] = useState(false);
  const [form, setForm] = useState<FormBloqueio>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [paraExcluir, setParaExcluir] = useState<Bloqueio | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const nomeProfissional = (id: string) =>
    catalogo.profissionais.find((p) => p.id === id)?.name ??
    "Profissional removido";

  const abrirCriacao = () => {
    setErro(null);
    setForm(FORM_VAZIO);
    setCriarAberto(true);
  };

  const alternarProfissional = (id: string, marcado: boolean) => {
    setForm((atual) => ({
      ...atual,
      professionalIds: marcado
        ? [...atual.professionalIds, id]
        : atual.professionalIds.filter((p) => p !== id),
    }));
  };

  const todosSelecionados =
    catalogo.profissionais.length > 0 &&
    form.professionalIds.length === catalogo.profissionais.length;

  const alternarTodos = (marcado: boolean) => {
    setForm((atual) => ({
      ...atual,
      professionalIds: marcado ? catalogo.profissionais.map((p) => p.id) : [],
    }));
  };

  const salvar = async () => {
    if (form.professionalIds.length === 0) {
      setErro("Escolha pelo menos um profissional.");
      return;
    }
    if (!form.inicio || !form.fim) {
      setErro("Informe o início e o fim do bloqueio.");
      return;
    }
    if (!form.motivo.trim()) {
      setErro("Informe o motivo do bloqueio.");
      return;
    }
    setSalvando(true);
    setErro(null);
    // O input datetime-local devolve "aaaa-mm-ddTHH:MM" no relogio de quem
    // digita. Interpretamos essa data e hora no FUSO DA CLINICA (regra 3.6),
    // nunca no fuso do navegador.
    const [inicioDia, inicioHora] = form.inicio.split("T");
    const [fimDia, fimHora] = form.fim.split("T");
    const resultado = await criarBloqueiosEmLoteAction({
      professional_ids: form.professionalIds,
      starts_at: instanteLocal(timezone, inicioDia!, inicioHora!).toISOString(),
      ends_at: instanteLocal(timezone, fimDia!, fimHora!).toISOString(),
      reason: form.motivo.trim(),
      blocks_overbooking: form.impedirEncaixe,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível criar os bloqueios.");
      return;
    }
    toast.success(
      form.professionalIds.length === 1
        ? "Bloqueio criado"
        : "Bloqueios criados",
    );
    setCriarAberto(false);
    aoMudar();
  };

  const excluir = async () => {
    if (!paraExcluir) {
      return;
    }
    setExcluindo(true);
    setErroExclusao(null);
    const resultado = await excluirBloqueioAction(paraExcluir.id);
    setExcluindo(false);
    if (!resultado.ok) {
      setErroExclusao(
        resultado.error ?? "Não foi possível remover o bloqueio.",
      );
      return;
    }
    toast.success("Bloqueio removido");
    setParaExcluir(null);
    aoMudar();
  };

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={abrirCriacao}
        >
          <Plus strokeWidth={1.5} className="size-4" /> Novo bloqueio
        </BotaoProtegido>
      </div>

      {catalogo.bloqueios.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="Nenhum bloqueio futuro"
          description="Crie um bloqueio para tirar da oferta os horários de férias, congressos ou imprevistos."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profissional</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Encaixe</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.bloqueios.map((bloqueio) => (
                <TableRow key={bloqueio.id}>
                  <TableCell className="font-medium">
                    {nomeProfissional(bloqueio.professional_id)}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] tabular-nums">
                    {formatarMomento(bloqueio.starts_at, timezone)}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] tabular-nums">
                    {formatarMomento(bloqueio.ends_at, timezone)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {bloqueio.reason}
                  </TableCell>
                  <TableCell
                    className={
                      bloqueio.blocks_overbooking
                        ? "[color:var(--alert-text)]"
                        : "text-text-secondary"
                    }
                  >
                    {bloqueio.blocks_overbooking
                      ? "Impede encaixe"
                      : "Permite encaixe"}
                  </TableCell>
                  <TableCell>
                    {podeEditar ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={() => {
                          setErroExclusao(null);
                          setParaExcluir(bloqueio);
                        }}
                        aria-label={`Remover bloqueio de ${nomeProfissional(bloqueio.professional_id)}`}
                      >
                        <Trash2 strokeWidth={1.5} className="size-4" />
                      </Button>
                    ) : (
                      <DisabledWithHint hint={dica}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          disabled
                          aria-label={`Remover bloqueio de ${nomeProfissional(bloqueio.professional_id)}`}
                        >
                          <Trash2 strokeWidth={1.5} className="size-4" />
                        </Button>
                      </DisabledWithHint>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={criarAberto} onOpenChange={setCriarAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo bloqueio</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Profissionais</Label>
              {catalogo.profissionais.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Cadastre um profissional antes de criar bloqueios.
                </p>
              ) : (
                <div className="grid gap-1 rounded-lg border p-2">
                  <label className="flex min-h-10 items-center gap-2 rounded px-2 text-sm font-medium">
                    <Checkbox
                      checked={todosSelecionados}
                      onCheckedChange={(v) => alternarTodos(v === true)}
                    />
                    Selecionar todos
                  </label>
                  {catalogo.profissionais.map((profissional) => (
                    <label
                      key={profissional.id}
                      className="flex min-h-10 items-center gap-2 rounded px-2 text-sm"
                    >
                      <Checkbox
                        checked={form.professionalIds.includes(profissional.id)}
                        onCheckedChange={(v) =>
                          alternarProfissional(profissional.id, v === true)
                        }
                      />
                      {profissional.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="bloqueio-inicio">Início</Label>
                <Input
                  id="bloqueio-inicio"
                  type="datetime-local"
                  value={form.inicio}
                  onChange={(e) => setForm({ ...form, inicio: e.target.value })}
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bloqueio-fim">Fim</Label>
                <Input
                  id="bloqueio-fim"
                  type="datetime-local"
                  value={form.fim}
                  onChange={(e) => setForm({ ...form, fim: e.target.value })}
                  className="h-10"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bloqueio-motivo">Motivo</Label>
              <Input
                id="bloqueio-motivo"
                value={form.motivo}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Férias, congresso, imprevisto"
                className="h-10"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="bloqueio-encaixe">
                Impedir encaixe neste período
              </Label>
              <Switch
                id="bloqueio-encaixe"
                checked={form.impedirEncaixe}
                onCheckedChange={(v) => setForm({ ...form, impedirEncaixe: v })}
              />
            </div>
            <p className="text-sm text-text-secondary">
              O bloqueio aparece hachurado na agenda e os horários somem da
              oferta.
            </p>
            {erro ? (
              <p role="alert" className="text-sm [color:var(--alert-text)]">
                {erro}
              </p>
            ) : null}
            <Button onClick={salvar} disabled={salvando} className="h-10">
              {salvando ? "Salvando..." : "Criar bloqueio"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={paraExcluir !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setParaExcluir(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover bloqueio</DialogTitle>
          </DialogHeader>
          {paraExcluir ? (
            <p className="text-sm text-text-secondary">
              O bloqueio de {nomeProfissional(paraExcluir.professional_id)} (
              {formatarMomento(paraExcluir.starts_at, timezone)} até{" "}
              {formatarMomento(paraExcluir.ends_at, timezone)}) será removido e
              os horários voltam para a oferta.
            </p>
          ) : null}
          {erroExclusao ? (
            <p role="alert" className="text-sm [color:var(--alert-text)]">
              {erroExclusao}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setParaExcluir(null)}
            >
              Cancelar
            </Button>
            <Button onClick={excluir} disabled={excluindo} className="h-10">
              {excluindo ? "Removendo..." : "Remover"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
