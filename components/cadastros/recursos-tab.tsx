"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DoorOpen, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarRecursoAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  PainelDeCadastro,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const colunas: ColumnDef<Recurso>[] = [
    {
      id: "nome",
      header: "Nome",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "tipo",
      header: "Tipo",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {RESOURCE_KIND_LABELS[row.original.kind]}
        </span>
      ),
    },
    {
      id: "unidade",
      header: "Unidade",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {nomeUnidade(row.original.unit_id)}
        </span>
      ),
    },
    {
      id: "procedimentos",
      header: "Procedimentos",
      cell: ({ row }) => {
        const total = contarProcedimentos(row.original.id);
        return (
          <span className="whitespace-nowrap text-text-secondary">
            {total === 0 ? (
              "Nenhum procedimento"
            ) : (
              <>
                <span className="cz-num">{total}</span>{" "}
                {total === 1 ? "procedimento" : "procedimentos"}
              </>
            )}
          </span>
        );
      },
    },
    {
      id: "situacao",
      header: "Situação",
      cell: ({ row }) => <ChipSituacao active={row.original.active} />,
    },
    {
      id: "acoes",
      header: () => <span className="sr-only">Ações</span>,
      meta: { align: "right", numeric: false },
      cell: ({ row }) => (
        <AcoesDaLinha
          podeEditar={podeEditar}
          dica={dica}
          nome={row.original.name}
          aoEditar={() => abrir(row.original)}
        />
      ),
    },
  ];

  const fechar = () => setAberto(false);

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus aria-hidden /> Novo recurso
        </BotaoProtegido>
      </div>

      {catalogo.recursos.length === 0 ? (
        <VazioDaAba
          icon={DoorOpen}
          titulo="Nenhum recurso cadastrado"
          descricao="Cadastre salas, cabines e equipamentos: recursos evitam que dois procedimentos usem o mesmo equipamento no mesmo horário."
          acao={{
            rotulo: "Cadastrar o primeiro recurso",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.recursos} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={form.id ? "Editar recurso" : "Novo recurso"}
        erro={erro}
        rodape={
          <RodapeDeSalvar
            salvando={salvando}
            aoCancelar={fechar}
            aoSalvar={() => void salvar()}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="recurso-nome">Nome</Label>
            <Input
              id="recurso-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recurso-tipo">Tipo</Label>
            <Select
              value={form.kind}
              onValueChange={(v) =>
                setForm({ ...form, kind: v as Recurso["kind"] })
              }
            >
              <SelectTrigger id="recurso-tipo" className="w-full">
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
          <div className="grid gap-1.5">
            <Label htmlFor="recurso-unidade">Unidade</Label>
            <Select
              value={form.unit_id}
              onValueChange={(v) => setForm({ ...form, unit_id: v })}
            >
              <SelectTrigger id="recurso-unidade" className="w-full">
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
          <CampoDeMarcar
            id="recurso-ativo"
            rotulo="Recurso ativo"
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
        </div>
      </PainelDeCadastro>
    </div>
  );
}
