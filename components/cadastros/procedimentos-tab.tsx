"use client";

import { Pencil, Plus, Stethoscope } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarProcedimentoAction } from "@/app/(app)/cadastros/actions";
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
import { Textarea } from "@/components/ui/textarea";
import type { Procedimento } from "@/lib/queries/catalogo";
import { formatarCentavos } from "@/lib/utils/moeda";

// Valor sentinela do Select de recurso: o item do shadcn nao aceita value "".
const SEM_RECURSO = "nenhum";

type FormProcedimento = {
  id?: string;
  name: string;
  description: string;
  default_duration_min: string;
  preco_reais: string;
  requires_evaluation: boolean;
  prep_instructions: string;
  resource_id: string;
  bookable_by_ai: boolean;
  active: boolean;
};

const FORM_VAZIO: FormProcedimento = {
  name: "",
  description: "",
  default_duration_min: "40",
  preco_reais: "",
  requires_evaluation: false,
  prep_instructions: "",
  resource_id: SEM_RECURSO,
  bookable_by_ai: true,
  active: true,
};

// "120,50" ou "120.50" viram 12050 centavos; vazio vira null; texto que nao
// e numero vira undefined para a tela avisar antes de chamar a action.
function reaisParaCentavos(texto: string): number | null | undefined {
  const limpo = texto.trim();
  if (limpo === "") {
    return null;
  }
  const numero = Number(limpo.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numero) || numero < 0) {
    return undefined;
  }
  return Math.round(numero * 100);
}

function centavosParaReais(cents: number | null): string {
  if (cents === null) {
    return "";
  }
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function ProcedimentosTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormProcedimento>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomeRecurso = (resourceId: string | null): string => {
    if (!resourceId) {
      return "";
    }
    return (
      catalogo.recursos.find((recurso) => recurso.id === resourceId)?.name ?? ""
    );
  };

  const abrir = (procedimento?: Procedimento) => {
    setErro(null);
    setForm(
      procedimento
        ? {
            id: procedimento.id,
            name: procedimento.name,
            description: procedimento.description ?? "",
            default_duration_min: String(procedimento.default_duration_min),
            preco_reais: centavosParaReais(procedimento.base_price_cents),
            requires_evaluation: procedimento.requires_evaluation,
            prep_instructions: procedimento.prep_instructions ?? "",
            resource_id: procedimento.resource_id ?? SEM_RECURSO,
            bookable_by_ai: procedimento.bookable_by_ai,
            active: procedimento.active,
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const salvar = async () => {
    const centavos = reaisParaCentavos(form.preco_reais);
    if (centavos === undefined) {
      setErro("Informe o preço em reais, por exemplo 150,00, ou deixe vazio.");
      return;
    }
    const duracao = Number(form.default_duration_min);
    if (!Number.isInteger(duracao) || duracao < 5) {
      setErro("Informe a duração em minutos (mínimo de 5).");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await salvarProcedimentoAction({
      id: form.id,
      name: form.name,
      description: form.description.trim() || null,
      default_duration_min: duracao,
      base_price_cents: centavos,
      requires_evaluation: form.requires_evaluation,
      prep_instructions: form.prep_instructions.trim() || null,
      resource_id: form.resource_id === SEM_RECURSO ? null : form.resource_id,
      bookable_by_ai: form.bookable_by_ai,
      active: form.active,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Procedimento atualizado" : "Procedimento criado");
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
          <Plus strokeWidth={1.5} className="size-4" /> Novo procedimento
        </BotaoProtegido>
      </div>

      {catalogo.procedimentos.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Nenhum procedimento cadastrado"
          description="Cadastre os procedimentos da clínica para a agenda e o agente oferecerem os serviços certos."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Duração padrão</TableHead>
                <TableHead>Preço base</TableHead>
                <TableHead>Exige avaliação</TableHead>
                <TableHead>Recurso</TableHead>
                <TableHead>IA</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.procedimentos.map((procedimento) => {
                const chip = chipAtivo(procedimento.active);
                return (
                  <TableRow key={procedimento.id}>
                    <TableCell className="font-medium">
                      {procedimento.name}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {procedimento.default_duration_min} min
                    </TableCell>
                    <TableCell className="font-mono text-[12px] tabular-nums">
                      {procedimento.base_price_cents !== null
                        ? formatarCentavos(procedimento.base_price_cents)
                        : ""}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {procedimento.requires_evaluation ? "Sim" : ""}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {nomeRecurso(procedimento.resource_id)}
                    </TableCell>
                    <TableCell>
                      {procedimento.bookable_by_ai ? (
                        <span className="text-[color:var(--success-text)]">
                          IA agenda
                        </span>
                      ) : (
                        <span className="text-text-tertiary">Só recepção</span>
                      )}
                    </TableCell>
                    <TableCell className={chip.classe}>{chip.texto}</TableCell>
                    <TableCell>
                      {podeEditar ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => abrir(procedimento)}
                          aria-label={`Editar ${procedimento.name}`}
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
                            aria-label={`Editar ${procedimento.name}`}
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
        <SheetContent className="w-[420px] overflow-y-auto p-5">
          <SheetHeader className="p-0">
            <SheetTitle>
              {form.id ? "Editar procedimento" : "Novo procedimento"}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="proc-nome">Nome</Label>
              <Input
                id="proc-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-descricao">Descrição</Label>
              <Textarea
                id="proc-descricao"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="proc-duracao">Duração (min)</Label>
                <Input
                  id="proc-duracao"
                  type="number"
                  min={5}
                  step={5}
                  value={form.default_duration_min}
                  onChange={(e) =>
                    setForm({ ...form, default_duration_min: e.target.value })
                  }
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proc-preco">Preço base (R$)</Label>
                <Input
                  id="proc-preco"
                  inputMode="decimal"
                  placeholder="Vazio: sem preço fixo"
                  value={form.preco_reais}
                  onChange={(e) =>
                    setForm({ ...form, preco_reais: e.target.value })
                  }
                  className="h-10"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="proc-avaliacao">Exige avaliação antes</Label>
              <Switch
                id="proc-avaliacao"
                checked={form.requires_evaluation}
                onCheckedChange={(v) =>
                  setForm({ ...form, requires_evaluation: v })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-preparo">
                Orientação de preparo enviada ao paciente
              </Label>
              <Textarea
                id="proc-preparo"
                value={form.prep_instructions}
                onChange={(e) =>
                  setForm({ ...form, prep_instructions: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-recurso">Recurso necessário</Label>
              <Select
                value={form.resource_id}
                onValueChange={(v) => setForm({ ...form, resource_id: v })}
              >
                <SelectTrigger id="proc-recurso" className="h-10 w-full">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_RECURSO}>Nenhum</SelectItem>
                  {catalogo.recursos.map((recurso) => (
                    <SelectItem key={recurso.id} value={recurso.id}>
                      {recurso.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-1">
                <Label htmlFor="proc-ia">IA pode agendar</Label>
                <p className="text-xs text-text-secondary">
                  O agente pode oferecer e agendar este procedimento
                </p>
              </div>
              <Switch
                id="proc-ia"
                checked={form.bookable_by_ai}
                onCheckedChange={(v) => setForm({ ...form, bookable_by_ai: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="proc-ativo">Procedimento ativo</Label>
              <Switch
                id="proc-ativo"
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
