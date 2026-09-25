"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { IdCard, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarConvenioAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // Modo leitura para quem so ve Cadastros (achado 41): a recepcao consulta
  // as observacoes do convenio inteiras antes de responder o paciente.
  const [somenteLeitura, setSomenteLeitura] = useState(false);

  const abrir = (convenio?: Convenio, leitura = false) => {
    setErro(null);
    setSomenteLeitura(leitura);
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

  const colunas: ColumnDef<Convenio>[] = [
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
      id: "plano",
      header: "Plano",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {row.original.plan_name ?? "Não informado"}
        </span>
      ),
    },
    {
      id: "carteirinha",
      header: "Carteirinha obrigatória",
      cell: ({ row }) => (row.original.requires_card ? "Sim" : "Não"),
    },
    {
      id: "observacoes",
      header: "Observações",
      // Duas linhas na tabela, texto inteiro no title e no painel (Editar ou
      // Ver detalhes): nunca cortado sem alternativa.
      cell: ({ row }) =>
        row.original.notes ? (
          <span
            className="line-clamp-2 max-w-[280px] py-1.5 whitespace-normal text-text-secondary"
            title={row.original.notes}
          >
            {row.original.notes}
          </span>
        ) : (
          <span className="text-text-secondary">Sem observações</span>
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
          aoVerDetalhes={() => abrir(row.original, true)}
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
          <Plus aria-hidden /> Novo convênio
        </BotaoProtegido>
      </div>

      {catalogo.convenios.length === 0 ? (
        <VazioDaAba
          icon={IdCard}
          titulo="Nenhum convênio cadastrado"
          descricao="Cadastre os convênios que a clínica atende para a recepcionista informar cobertura e preço."
          acao={{
            rotulo: "Cadastrar o primeiro convênio",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.convenios} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={
          somenteLeitura
            ? form.name
            : form.id
              ? "Editar convênio"
              : "Novo convênio"
        }
        erro={somenteLeitura ? null : erro}
        rodape={
          somenteLeitura ? undefined : (
            <RodapeDeSalvar
              salvando={salvando}
              aoCancelar={fechar}
              aoSalvar={() => void salvar()}
            />
          )
        }
      >
        {somenteLeitura ? (
          <DetalheSomenteLeitura
            itens={[
              { rotulo: "Plano", valor: form.plan_name },
              {
                rotulo: "Carteirinha obrigatória",
                valor: form.requires_card ? "Sim" : "Não",
              },
              { rotulo: "Observações", valor: form.notes },
              {
                rotulo: "Situação",
                valor: <ChipSituacao active={form.active} />,
              },
            ]}
          />
        ) : null}
        {/* O formulario fica fora da arvore visivel no modo leitura
            (atributo hidden, que o preflight do Tailwind forca). */}
        <div className="grid gap-4" hidden={somenteLeitura}>
          <div className="grid gap-1.5">
            <Label htmlFor="convenio-nome">Nome</Label>
            <Input
              id="convenio-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="convenio-plano">Plano</Label>
            <Input
              id="convenio-plano"
              value={form.plan_name}
              onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
            />
          </div>
          <CampoDeMarcar
            id="convenio-carteirinha"
            rotulo="Carteirinha obrigatória"
            marcado={form.requires_card}
            aoMudar={(marcado) => setForm({ ...form, requires_card: marcado })}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="convenio-observacoes">Observações</Label>
            <Textarea
              id="convenio-observacoes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>
          <CampoDeMarcar
            id="convenio-ativo"
            rotulo="Convênio ativo"
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
        </div>
      </PainelDeCadastro>
    </div>
  );
}
