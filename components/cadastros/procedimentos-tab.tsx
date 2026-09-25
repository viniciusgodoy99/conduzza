"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarProcedimentoAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  PreviaDeReais,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { DataTable } from "@/components/shared/data-table";
import { StatusChip } from "@/components/shared/status-chip";
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
import { IA_AGENDA_STATUS } from "@/lib/design/status";
import type { Procedimento } from "@/lib/queries/catalogo";
import {
  centavosParaReais,
  formatarCentavos,
  lerReais,
} from "@/lib/utils/moeda";

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
  // Quem so ve Cadastros (recepcao, leitura, profissional) abre o mesmo
  // painel em modo leitura para consultar descricao e preparo (achado 41).
  const [somenteLeitura, setSomenteLeitura] = useState(false);

  const nomeRecurso = (resourceId: string | null): string => {
    if (!resourceId) {
      return "";
    }
    return (
      catalogo.recursos.find((recurso) => recurso.id === resourceId)?.name ?? ""
    );
  };

  const abrir = (procedimento?: Procedimento, leitura = false) => {
    setErro(null);
    setSomenteLeitura(leitura);
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
    const centavos = lerReais(form.preco_reais);
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

  const colunas: ColumnDef<Procedimento>[] = [
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
      id: "duracao",
      header: "Duração padrão",
      meta: { align: "right" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.default_duration_min} min
        </span>
      ),
    },
    {
      id: "preco",
      header: "Preço base",
      meta: { align: "right" },
      cell: ({ row }) =>
        row.original.base_price_cents !== null ? (
          <span className="whitespace-nowrap text-text-strong">
            {formatarCentavos(row.original.base_price_cents)}
          </span>
        ) : (
          <span className="font-sans whitespace-nowrap text-text-secondary">
            Sem preço fixo
          </span>
        ),
    },
    {
      id: "avaliacao",
      header: "Exige avaliação",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {row.original.requires_evaluation ? "Sim" : "Não"}
        </span>
      ),
    },
    {
      id: "recurso",
      header: "Recurso",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {nomeRecurso(row.original.resource_id) || "Nenhum"}
        </span>
      ),
    },
    {
      id: "ia",
      header: "IA",
      cell: ({ row }) => (
        <StatusChip
          size="sm"
          definition={
            IA_AGENDA_STATUS[row.original.bookable_by_ai ? "sim" : "nao"]
          }
        />
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
          <Plus aria-hidden /> Novo procedimento
        </BotaoProtegido>
      </div>

      {catalogo.procedimentos.length === 0 ? (
        <VazioDaAba
          icon={ClipboardList}
          titulo="Nenhum procedimento cadastrado"
          descricao="Cadastre os procedimentos da clínica para a agenda e o agente oferecerem os serviços certos."
          acao={{
            rotulo: "Cadastrar o primeiro procedimento",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.procedimentos} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={
          somenteLeitura
            ? form.name
            : form.id
              ? "Editar procedimento"
              : "Novo procedimento"
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
              { rotulo: "Descrição", valor: form.description },
              {
                rotulo: "Orientação de preparo enviada ao paciente",
                valor: form.prep_instructions,
              },
              {
                rotulo: "Duração padrão",
                valor: (
                  <>
                    <span className="cz-num">{form.default_duration_min}</span>{" "}
                    min
                  </>
                ),
              },
              {
                rotulo: "Preço base",
                valor: (() => {
                  const centavos = lerReais(form.preco_reais);
                  return typeof centavos === "number" ? (
                    <span className="cz-num">{formatarCentavos(centavos)}</span>
                  ) : (
                    "Sem preço fixo"
                  );
                })(),
              },
              {
                rotulo: "Exige avaliação antes",
                valor: form.requires_evaluation ? "Sim" : "Não",
              },
              {
                rotulo: "Recurso necessário",
                valor:
                  form.resource_id === SEM_RECURSO
                    ? "Nenhum"
                    : nomeRecurso(form.resource_id),
              },
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
            <Label htmlFor="proc-nome">Nome</Label>
            <Input
              id="proc-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
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
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="grid gap-1.5">
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
                className="cz-num"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proc-preco">Preço base (R$)</Label>
              <Input
                id="proc-preco"
                inputMode="decimal"
                placeholder="Vazio: sem preço fixo"
                value={form.preco_reais}
                onChange={(e) =>
                  setForm({ ...form, preco_reais: e.target.value })
                }
                aria-describedby="proc-preco-previa"
                className="cz-num"
              />
              <PreviaDeReais texto={form.preco_reais} id="proc-preco-previa" />
            </div>
          </div>
          <CampoDeMarcar
            id="proc-avaliacao"
            rotulo="Exige avaliação antes"
            marcado={form.requires_evaluation}
            aoMudar={(marcado) =>
              setForm({ ...form, requires_evaluation: marcado })
            }
          />
          <div className="grid gap-1.5">
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
          <div className="grid gap-1.5">
            <Label htmlFor="proc-recurso">Recurso necessário</Label>
            <Select
              value={form.resource_id}
              onValueChange={(v) => setForm({ ...form, resource_id: v })}
            >
              <SelectTrigger id="proc-recurso" className="w-full">
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
          <CampoDeMarcar
            id="proc-ia"
            rotulo="IA pode agendar"
            descricao="O agente pode oferecer e agendar este procedimento"
            marcado={form.bookable_by_ai}
            aoMudar={(marcado) => setForm({ ...form, bookable_by_ai: marcado })}
          />
          <CampoDeMarcar
            id="proc-ativo"
            rotulo="Procedimento ativo"
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
        </div>
      </PainelDeCadastro>
    </div>
  );
}
