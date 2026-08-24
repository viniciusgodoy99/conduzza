"use client";

import { Armchair, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarRecursoAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido, chipAtivo } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RESOURCE_KIND_LABELS, type Recurso } from "@/lib/queries/catalogo";

// Valor sentinela do Select para "recurso disponível em todas as unidades"
// (o Radix Select não aceita item com value vazio).
const TODAS = "todas";

type FormRecurso = {
  id?: string;
  name: string;
  kind: Recurso["kind"];
  unit_id: string;
  active: boolean;
};

const FORM_VAZIO: FormRecurso = {
  name: "",
  kind: "sala",
  unit_id: TODAS,
  active: true,
};

export function RecursosTab({ catalogo, podeEditar, dica, aoMudar }: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormRecurso>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomeUnidade = (unitId: string | null) => {
    if (!unitId) {
      return "Todas";
    }
    return (
      catalogo.unidades.find((unidade) => unidade.id === unitId)?.name ??
      "Todas"
    );
  };

  const contarProcedimentos = (recursoId: string) =>
    catalogo.procedimentos.filter(
      (procedimento) => procedimento.resource_id === recursoId,
    ).length;

  const abrir = (recurso?: Recurso) => {
    setErro(null);
    setForm(
      recurso
        ? {
            id: recurso.id,
            name: recurso.name,
            kind: recurso.kind,
            unit_id: recurso.unit_id ?? TODAS,
            active: recurso.active,
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await salvarRecursoAction({
      id: form.id,
      name: form.name,
      kind: form.kind,
      unit_id: form.unit_id === TODAS ? null : form.unit_id,
      active: form.active,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Recurso atualizado" : "Recurso criado");
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
          <Plus strokeWidth={1.5} className="size-4" /> Novo recurso
        </BotaoProtegido>
      </div>

      {catalogo.recursos.length === 0 ? (
        <EmptyState
          icon={Armchair}
          title="Nenhum recurso cadastrado"
          description="Cadastre salas, cabines e equipamentos: recursos evitam que dois procedimentos usem o mesmo equipamento no mesmo horário."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Procedimentos</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.recursos.map((recurso) => {
                const chip = chipAtivo(recurso.active);
                const total = contarProcedimentos(recurso.id);
                return (
                  <TableRow key={recurso.id}>
                    <TableCell className="font-medium">
                      {recurso.name}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {RESOURCE_KIND_LABELS[recurso.kind]}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {nomeUnidade(recurso.unit_id)}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {total === 0
                        ? "Nenhum procedimento"
                        : total === 1
                          ? "1 procedimento"
                          : `${total} procedimentos`}
                    </TableCell>
                    <TableCell className={chip.classe}>{chip.texto}</TableCell>
                    <TableCell>
                      {podeEditar ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => abrir(recurso)}
                          aria-label={`Editar ${recurso.name}`}
                        >
                          <Pencil strokeWidth={1.5} className="size-4" />
                        </Button>
                      ) : (
                        <DisabledWithHint hint={dica}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            disabled
                            aria-label={`Editar ${recurso.name}`}
                          >
                            <Pencil strokeWidth={1.5} className="size-4" />
                          </Button>
                        </DisabledWithHint>
                      )}
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
              {form.id ? "Editar recurso" : "Novo recurso"}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="recurso-nome">Nome</Label>
              <Input
                id="recurso-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recurso-tipo">Tipo</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm({ ...form, kind: v as Recurso["kind"] })
                }
              >
                <SelectTrigger id="recurso-tipo" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(RESOURCE_KIND_LABELS) as [
                      Recurso["kind"],
                      string,
                    ][]
                  ).map(([valor, rotulo]) => (
                    <SelectItem key={valor} value={valor}>
                      {rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recurso-unidade">Unidade</Label>
              <Select
                value={form.unit_id}
                onValueChange={(v) => setForm({ ...form, unit_id: v })}
              >
                <SelectTrigger id="recurso-unidade" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas as unidades</SelectItem>
                  {catalogo.unidades.map((unidade) => (
                    <SelectItem key={unidade.id} value={unidade.id}>
                      {unidade.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="recurso-ativo">Recurso ativo</Label>
              <Switch
                id="recurso-ativo"
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
