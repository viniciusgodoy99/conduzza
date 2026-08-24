"use client";

import { Building2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarUnidadeAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido, chipAtivo } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
import type { Unidade } from "@/lib/queries/catalogo";

type FormUnidade = {
  id?: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

const FORM_VAZIO: FormUnidade = {
  name: "",
  address: "",
  phone: "",
  active: true,
};

export function UnidadesTab({ catalogo, podeEditar, dica, aoMudar }: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormUnidade>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = (unidade?: Unidade) => {
    setErro(null);
    setForm(
      unidade
        ? {
            id: unidade.id,
            name: unidade.name,
            address: unidade.address ?? "",
            phone: unidade.phone ?? "",
            active: unidade.active,
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await salvarUnidadeAction({
      id: form.id,
      name: form.name,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      active: form.active,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Unidade atualizada" : "Unidade criada");
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
          <Plus strokeWidth={1.5} className="size-4" /> Nova unidade
        </BotaoProtegido>
      </div>

      {catalogo.unidades.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma unidade cadastrada"
          description="Cadastre a primeira unidade da clínica para organizar agenda e recursos."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.unidades.map((unidade) => {
                const chip = chipAtivo(unidade.active);
                return (
                  <TableRow key={unidade.id}>
                    <TableCell className="font-medium">
                      {unidade.name}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {unidade.address ?? ""}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] tabular-nums">
                      {unidade.phone ?? ""}
                    </TableCell>
                    <TableCell className={chip.classe}>{chip.texto}</TableCell>
                    <TableCell>
                      {podeEditar ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => abrir(unidade)}
                          aria-label={`Editar ${unidade.name}`}
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
                            aria-label={`Editar ${unidade.name}`}
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
              {form.id ? "Editar unidade" : "Nova unidade"}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="unidade-nome">Nome</Label>
              <Input
                id="unidade-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unidade-endereco">Endereço</Label>
              <Input
                id="unidade-endereco"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unidade-telefone">Telefone</Label>
              <Input
                id="unidade-telefone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="unidade-ativa">Unidade ativa</Label>
              <Switch
                id="unidade-ativa"
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
