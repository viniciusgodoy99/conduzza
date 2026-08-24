"use client";

import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarConvenioAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido, chipAtivo } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Convenio } from "@/lib/queries/catalogo";

type FormConvenio = {
  id?: string;
  name: string;
  plan_name: string;
  requires_card: boolean;
  notes: string;
  active: boolean;
};

const FORM_VAZIO: FormConvenio = {
  name: "",
  plan_name: "",
  requires_card: false,
  notes: "",
  active: true,
};

export function ConveniosTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormConvenio>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = (convenio?: Convenio) => {
    setErro(null);
    setForm(
      convenio
        ? {
            id: convenio.id,
            name: convenio.name,
            plan_name: convenio.plan_name ?? "",
            requires_card: convenio.requires_card,
            notes: convenio.notes ?? "",
            active: convenio.active,
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await salvarConvenioAction({
      id: form.id,
      name: form.name,
      plan_name: form.plan_name.trim() || null,
      requires_card: form.requires_card,
      notes: form.notes.trim() || null,
      active: form.active,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Convênio atualizado" : "Convênio criado");
    setAberto(false);
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
          <Plus strokeWidth={1.5} className="size-4" /> Novo convênio
        </BotaoProtegido>
      </div>

      {catalogo.convenios.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nenhum convênio cadastrado"
          description="Cadastre os convênios que a clínica atende para a recepcionista informar cobertura e preço."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Carteirinha obrigatória</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.convenios.map((convenio) => {
                const chip = chipAtivo(convenio.active);
                return (
                  <TableRow key={convenio.id}>
                    <TableCell className="font-medium">
                      {convenio.name}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {convenio.plan_name ?? ""}
                    </TableCell>
                    <TableCell>
                      {convenio.requires_card ? "Sim" : "Não"}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-text-secondary">
                      {convenio.notes ?? ""}
                    </TableCell>
                    <TableCell className={chip.classe}>{chip.texto}</TableCell>
                    <TableCell>
                      {podeEditar ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => abrir(convenio)}
                          aria-label={`Editar ${convenio.name}`}
                        >
                          <Pencil strokeWidth={1.5} className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent className="w-[380px] p-5">
          <SheetHeader className="p-0">
            <SheetTitle>
              {form.id ? "Editar convênio" : "Novo convênio"}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="convenio-nome">Nome</Label>
              <Input
                id="convenio-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convenio-plano">Plano</Label>
              <Input
                id="convenio-plano"
                value={form.plan_name}
                onChange={(e) =>
                  setForm({ ...form, plan_name: e.target.value })
                }
                className="h-10"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="convenio-carteirinha">
                Carteirinha obrigatória
              </Label>
              <Switch
                id="convenio-carteirinha"
                checked={form.requires_card}
                onCheckedChange={(v) => setForm({ ...form, requires_card: v })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convenio-observacoes">Observações</Label>
              <Textarea
                id="convenio-observacoes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="convenio-ativo">Convênio ativo</Label>
              <Switch
                id="convenio-ativo"
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
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
    </div>
  );
}
