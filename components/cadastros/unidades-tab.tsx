"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarUnidadeAction } from "@/app/(app)/cadastros/actions";
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

  const colunas: ColumnDef<Unidade>[] = [
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
      id: "endereco",
      header: "Endereço",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {row.original.address ?? "Não informado"}
        </span>
      ),
    },
    {
      id: "telefone",
      header: "Telefone",
      cell: ({ row }) =>
        row.original.phone ? (
          <span className="cz-num whitespace-nowrap">{row.original.phone}</span>
        ) : (
          <span className="text-text-secondary">Não informado</span>
        ),
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
          <Plus aria-hidden /> Nova unidade
        </BotaoProtegido>
      </div>

      {catalogo.unidades.length === 0 ? (
        <VazioDaAba
          icon={Building2}
          titulo="Nenhuma unidade cadastrada"
          descricao="Cadastre a primeira unidade da clínica para organizar agenda e recursos."
          acao={{
            rotulo: "Cadastrar a primeira unidade",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.unidades} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={form.id ? "Editar unidade" : "Nova unidade"}
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
            <Label htmlFor="unidade-nome">Nome</Label>
            <Input
              id="unidade-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="unidade-endereco">Endereço</Label>
            <Input
              id="unidade-endereco"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="unidade-telefone">Telefone</Label>
            <Input
              id="unidade-telefone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="cz-num"
            />
          </div>
          <CampoDeMarcar
            id="unidade-ativa"
            rotulo="Unidade ativa"
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
        </div>
      </PainelDeCadastro>
    </div>
  );
}
