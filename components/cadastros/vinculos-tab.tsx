"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, Ellipsis, Link2, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  alternarVinculoAtivoAction,
  alternarVinculoIaAction,
  duplicarVinculosAction,
  salvarVinculoAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AvatarDoProfissional,
  BotaoProtegido,
  COBERTO_PELO_CONVENIO,
  CampoDeMarcar,
  ChipSituacao,
  PreviaDeReais,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import type { Profissional, Vinculo } from "@/lib/queries/catalogo";
import { centavosParaReais, lerReais } from "@/lib/utils/moeda";

// Aba de Vínculos: a matriz de três pontas (profissional x procedimento x
// convênio). Acordeão por profissional, tabela inline, edição na linha e
// duplicação de vínculos entre profissionais.

type ModoPreco = "valor" | "coberto" | "sem";

const PARTICULAR = "particular";

// O que vem depois do nome no gatilho do acordeao (" · CRM 12345 ·
// Endocrinologia, Nutrologia"). O gatilho junta nome e resto num texto
// continuo: o nome acessivel e exatamente "Dr. Joao Pereira · CRM 12345 ·
// Endocrinologia, Nutrologia" (o e2e de Cadastros procura assim).
function restoDoTitulo(p: Profissional): string {
  const partes: string[] = [];
  const conselho = [p.council_type, p.council_number]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" ");
  if (conselho) {
    partes.push(conselho);
  }
  if (p.specialties.length > 0) {
    partes.push(p.specialties.join(", "));
  }
  return partes.map((parte) => ` · ${parte}`).join("");
}

// Valor em reais do vinculo: vazio e invalido tem mensagens diferentes, e
// "250.00" e lido como R$ 250,00 (achado 34), nunca R$ 25.000,00.
function erroDoValor(texto: string): string | null {
  const centavos = lerReais(texto);
  if (centavos === null) {
    return "Informe o valor em reais, por exemplo 250,00.";
  }
  if (centavos === undefined) {
    return "Não entendemos o valor. Use o formato 250,00.";
  }
  return null;
}

function modoDoVinculo(v: Vinculo): ModoPreco {
  if (v.covered_by_insurance && v.price_cents === null) {
    return "coberto";
  }
  if (v.price_cents !== null) {
    return "valor";
  }
  return "sem";
}

type FormNovo = {
  professional_id: string;
  procedure_id: string;
  insurance_id: string;
  modo: ModoPreco;
  precoReais: string;
  duration_min: string;
  bookable_by_ai: boolean;
};

type FormEdicao = {
  modo: ModoPreco;
  precoReais: string;
  duration_min: string;
};

type EstadoDuplicar = {
  origemId: string;
  destinoId: string;
  selecionados: Set<string>;
};

export function VinculosTab({ catalogo, podeEditar, dica, aoMudar }: TabProps) {
  const [novoAberto, setNovoAberto] = useState(false);
  const [formNovo, setFormNovo] = useState<FormNovo | null>(null);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erroNovo, setErroNovo] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEdicao, setFormEdicao] = useState<FormEdicao | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);

  const [alternandoId, setAlternandoId] = useState<string | null>(null);
  const [ativandoId, setAtivandoId] = useState<string | null>(null);

  const [duplicar, setDuplicar] = useState<EstadoDuplicar | null>(null);
  const [duplicando, setDuplicando] = useState(false);
  const [erroDuplicar, setErroDuplicar] = useState<string | null>(null);

  const vinculosPorProfissional = useMemo(() => {
    const mapa = new Map<string, Vinculo[]>();
    for (const vinculo of catalogo.vinculos) {
      const lista = mapa.get(vinculo.professional_id) ?? [];
      lista.push(vinculo);
      mapa.set(vinculo.professional_id, lista);
    }
    return mapa;
  }, [catalogo.vinculos]);

  const nomeProcedimento = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of catalogo.procedimentos) {
      mapa.set(p.id, p.name);
    }
    return mapa;
  }, [catalogo.procedimentos]);

  const nomeConvenio = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of catalogo.convenios) {
      mapa.set(c.id, c.name);
    }
    return mapa;
  }, [catalogo.convenios]);

  const abrirNovo = (professionalId: string) => {
    setErroNovo(null);
    setFormNovo({
      professional_id: professionalId,
      procedure_id: "",
      insurance_id: PARTICULAR,
      modo: "sem",
      precoReais: "",
      duration_min: "",
      bookable_by_ai: true,
    });
    setNovoAberto(true);
  };

  const escolherProcedimento = (procedureId: string) => {
    if (!formNovo) {
      return;
    }
    const procedimento = catalogo.procedimentos.find(
      (p) => p.id === procedureId,
    );
    setFormNovo({
      ...formNovo,
      procedure_id: procedureId,
      duration_min:
        formNovo.duration_min === "" && procedimento
          ? String(procedimento.default_duration_min)
          : formNovo.duration_min,
    });
  };

  const salvarNovo = async () => {
    if (!formNovo) {
      return;
    }
    setErroNovo(null);
    if (!formNovo.professional_id) {
      setErroNovo("Escolha o profissional.");
      return;
    }
    if (!formNovo.procedure_id) {
      setErroNovo("Escolha o procedimento.");
      return;
    }
    const duracao = Number(formNovo.duration_min);
    if (!Number.isInteger(duracao) || duracao < 5 || duracao > 600) {
      setErroNovo("Informe a duração em minutos (entre 5 e 600).");
      return;
    }
    let precoCentavos: number | null = null;
    if (formNovo.modo === "valor") {
      const erroValor = erroDoValor(formNovo.precoReais);
      if (erroValor) {
        setErroNovo(erroValor);
        return;
      }
      precoCentavos = lerReais(formNovo.precoReais) ?? null;
    }
    setSalvandoNovo(true);
    const resultado = await salvarVinculoAction({
      professional_id: formNovo.professional_id,
      procedure_id: formNovo.procedure_id,
      insurance_id:
        formNovo.insurance_id === PARTICULAR ? null : formNovo.insurance_id,
      price_cents: formNovo.modo === "valor" ? precoCentavos : null,
      covered_by_insurance: formNovo.modo === "coberto",
      duration_min: duracao,
      bookable_by_ai: formNovo.bookable_by_ai,
      active: true,
    });
    setSalvandoNovo(false);
    if (!resultado.ok) {
      setErroNovo(resultado.error ?? "Não foi possível criar o vínculo.");
      return;
    }
    toast.success("Vínculo criado");
    setNovoAberto(false);
    aoMudar();
  };

  const iniciarEdicao = (vinculo: Vinculo) => {
    setErroEdicao(null);
    setEditandoId(vinculo.id);
    setFormEdicao({
      modo: modoDoVinculo(vinculo),
      precoReais: centavosParaReais(vinculo.price_cents),
      duration_min: String(vinculo.duration_min),
    });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setFormEdicao(null);
    setErroEdicao(null);
  };

  const salvarEdicao = async (vinculo: Vinculo) => {
    if (!formEdicao) {
      return;
    }
    setErroEdicao(null);
    const duracao = Number(formEdicao.duration_min);
    if (!Number.isInteger(duracao) || duracao < 5 || duracao > 600) {
      setErroEdicao("Informe a duração em minutos (entre 5 e 600).");
      return;
    }
    let precoCentavos: number | null = null;
    if (formEdicao.modo === "valor") {
      const erroValor = erroDoValor(formEdicao.precoReais);
      if (erroValor) {
        setErroEdicao(erroValor);
        return;
      }
      precoCentavos = lerReais(formEdicao.precoReais) ?? null;
    }
    setSalvandoEdicao(true);
    const resultado = await salvarVinculoAction({
      id: vinculo.id,
      professional_id: vinculo.professional_id,
      procedure_id: vinculo.procedure_id,
      insurance_id: vinculo.insurance_id,
      price_cents: formEdicao.modo === "valor" ? precoCentavos : null,
      covered_by_insurance: formEdicao.modo === "coberto",
      duration_min: duracao,
      bookable_by_ai: vinculo.bookable_by_ai,
      active: vinculo.active,
    });
    setSalvandoEdicao(false);
    if (!resultado.ok) {
      setErroEdicao(resultado.error ?? "Não foi possível salvar o vínculo.");
      return;
    }
    toast.success("Vínculo atualizado");
    cancelarEdicao();
    aoMudar();
  };

  const alternarIa = async (vinculo: Vinculo, ligado: boolean) => {
    setAlternandoId(vinculo.id);
    const resultado = await alternarVinculoIaAction(vinculo.id, ligado);
    setAlternandoId(null);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível alterar a chave da IA.");
    }
    aoMudar();
  };

  // Desativar/Reativar o vinculo (achado 33): o inativo sai do agendamento
  // e da reoferta da lista de espera; as consultas antigas continuam
  // apontando para ele.
  const alternarAtivo = async (vinculo: Vinculo) => {
    setAtivandoId(vinculo.id);
    const resultado = await alternarVinculoAtivoAction(
      vinculo.id,
      !vinculo.active,
    );
    setAtivandoId(null);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível alterar o vínculo.");
      return;
    }
    toast.success(
      vinculo.active
        ? "Vínculo desativado. Ele não aparece mais para agendar."
        : "Vínculo reativado",
    );
    aoMudar();
  };

  const abrirDuplicar = (origemId: string) => {
    const vinculos = vinculosPorProfissional.get(origemId) ?? [];
    setErroDuplicar(null);
    setDuplicar({
      origemId,
      destinoId: "",
      selecionados: new Set(vinculos.map((v) => v.id)),
    });
  };

  const confirmarDuplicar = async () => {
    if (!duplicar) {
      return;
    }
    setErroDuplicar(null);
    if (!duplicar.destinoId) {
      setErroDuplicar("Escolha o profissional que vai receber os vínculos.");
      return;
    }
    if (duplicar.selecionados.size === 0) {
      setErroDuplicar("Marque ao menos um vínculo para copiar.");
      return;
    }
    setDuplicando(true);
    const resultado = await duplicarVinculosAction(
      Array.from(duplicar.selecionados),
      duplicar.destinoId,
    );
    setDuplicando(false);
    if (!resultado.ok) {
      setErroDuplicar(
        resultado.error ?? "Não foi possível duplicar os vínculos.",
      );
      return;
    }
    // Com ok true o .error pode vir informativo ("3 copiados, 1 já existia").
    toast.success(resultado.error ?? "Vínculos copiados");
    setDuplicar(null);
    aoMudar();
  };

  const profissionaisVisiveis = catalogo.profissionais.filter(
    (p) => p.active || (vinculosPorProfissional.get(p.id) ?? []).length > 0,
  );

  const modoBotoes: { valor: ModoPreco; rotulo: string }[] = [
    { valor: "valor", rotulo: "Valor em reais" },
    { valor: "coberto", rotulo: "Coberto pelo convênio" },
    { valor: "sem", rotulo: "Sem preço informado" },
  ];

  const semVinculos = catalogo.vinculos.length === 0;

  const nomeDoVinculo = (vinculo: Vinculo): string =>
    `${nomeProcedimento.get(vinculo.procedure_id) ?? "Procedimento removido"}, ${
      vinculo.insurance_id === null
        ? "Particular"
        : (nomeConvenio.get(vinculo.insurance_id) ?? "Convênio removido")
    }`;

  const celulaDoPreco = (vinculo: Vinculo) => {
    if (editandoId === vinculo.id && formEdicao) {
      return (
        <div className="grid min-w-48 gap-1.5 py-2">
          <Select
            value={formEdicao.modo}
            onValueChange={(v) =>
              setFormEdicao({ ...formEdicao, modo: v as ModoPreco })
            }
          >
            <SelectTrigger aria-label="Modo de preço" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="valor">Valor em reais</SelectItem>
              <SelectItem
                value="coberto"
                disabled={vinculo.insurance_id === null}
              >
                Coberto pelo convênio
              </SelectItem>
              <SelectItem value="sem">Sem preço informado</SelectItem>
            </SelectContent>
          </Select>
          {formEdicao.modo === "valor" ? (
            <>
              <Input
                value={formEdicao.precoReais}
                onChange={(e) =>
                  setFormEdicao({ ...formEdicao, precoReais: e.target.value })
                }
                inputMode="decimal"
                placeholder="250,00"
                aria-label="Valor em reais"
                className="cz-num"
              />
              <PreviaDeReais texto={formEdicao.precoReais} />
            </>
          ) : null}
        </div>
      );
    }
    const preco = exibirPrecoVinculo(vinculo);
    if (preco.kind === "coberto") {
      // "Coberto" e rotulo, nunca moeda (o caso do Dr. Joao no e2e).
      return (
        <StatusChip
          size="sm"
          definition={COBERTO_PELO_CONVENIO}
          label={preco.text}
        />
      );
    }
    if (preco.kind === "valor") {
      return (
        <span className="cz-num whitespace-nowrap text-text-strong">
          {preco.text}
        </span>
      );
    }
    return (
      <span className="whitespace-nowrap text-text-secondary">
        Sem preço informado
      </span>
    );
  };

  const acoesDoVinculo = (vinculo: Vinculo) => {
    const nome = nomeDoVinculo(vinculo);
    if (editandoId === vinculo.id && formEdicao) {
      return (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={salvandoEdicao}
            onClick={() => void salvarEdicao(vinculo)}
            aria-label="Salvar vínculo"
          >
            <Check aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={salvandoEdicao}
            onClick={cancelarEdicao}
            aria-label="Cancelar edição"
          >
            <X aria-hidden />
          </Button>
        </div>
      );
    }
    if (!podeEditar) {
      return (
        <div className="flex items-center justify-end gap-1">
          <DisabledWithHint hint={dica}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Editar vínculo ${nome}`}
            >
              <Pencil aria-hidden />
            </Button>
          </DisabledWithHint>
          <DisabledWithHint hint={dica}>
            <Button variant="ghost" className="min-w-[92px]" disabled>
              {vinculo.active ? "Desativar" : "Reativar"}
            </Button>
          </DisabledWithHint>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => iniciarEdicao(vinculo)}
          aria-label={`Editar vínculo ${nome}`}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          className="min-w-[92px]"
          disabled={ativandoId === vinculo.id}
          onClick={() => void alternarAtivo(vinculo)}
          aria-label={`${vinculo.active ? "Desativar" : "Reativar"} vínculo ${nome}`}
        >
          {vinculo.active ? "Desativar" : "Reativar"}
        </Button>
      </div>
    );
  };

  // A chave da IA vale na hora (sem Salvar), por isso continua Switch.
  const chaveDaIa = (vinculo: Vinculo) => {
    const rotulo = `IA pode agendar ${nomeDoVinculo(vinculo)}`;
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        {podeEditar ? (
          <Switch
            size="sm"
            checked={vinculo.bookable_by_ai}
            disabled={alternandoId === vinculo.id}
            onCheckedChange={(v) => void alternarIa(vinculo, v)}
            aria-label={rotulo}
          />
        ) : (
          <DisabledWithHint hint={dica}>
            <Switch
              size="sm"
              checked={vinculo.bookable_by_ai}
              disabled
              aria-label={rotulo}
            />
          </DisabledWithHint>
        )}
        <span className="text-xs text-text-secondary">
          {vinculo.bookable_by_ai ? "IA agenda" : "Só a recepção agenda"}
        </span>
      </div>
    );
  };

  const colunas: ColumnDef<Vinculo>[] = [
    {
      id: "procedimento",
      header: "Procedimento",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {nomeProcedimento.get(row.original.procedure_id) ??
            "Procedimento removido"}
        </span>
      ),
    },
    {
      id: "convenio",
      header: "Convênio",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {row.original.insurance_id === null
            ? "Particular"
            : (nomeConvenio.get(row.original.insurance_id) ??
              "Convênio removido")}
        </span>
      ),
    },
    {
      id: "preco",
      header: "Preço",
      cell: ({ row }) => celulaDoPreco(row.original),
    },
    {
      id: "duracao",
      header: "Duração",
      cell: ({ row }) =>
        editandoId === row.original.id && formEdicao ? (
          <Input
            type="number"
            min={5}
            max={600}
            value={formEdicao.duration_min}
            onChange={(e) =>
              setFormEdicao({ ...formEdicao, duration_min: e.target.value })
            }
            aria-label="Duração em minutos"
            className="w-24 cz-num"
          />
        ) : (
          <span className="whitespace-nowrap">
            <span className="cz-num">{row.original.duration_min}</span> min
          </span>
        ),
    },
    {
      id: "ia",
      header: "IA",
      cell: ({ row }) => chaveDaIa(row.original),
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
      cell: ({ row }) => acoesDoVinculo(row.original),
    },
  ];

  return (
    <div className="grid gap-3">
      {semVinculos ? (
        // Acao principal do vazio (achados 42 e 116): a importacao por
        // planilha nao existe, entao nao aparece nem como promessa. Aqui ela
        // e o unico lime da aba (nao ha "Novo vinculo" no topo).
        <VazioDaAba
          icon={Link2}
          titulo="Nenhum vínculo cadastrado"
          descricao="O vínculo diz quem faz o quê, por quanto e em quanto tempo. Sem ele, a IA não informa preço nem agenda."
          acao={{
            rotulo: "Adicionar vínculo",
            onClick: () => abrirNovo(profissionaisVisiveis[0]?.id ?? ""),
            variant: "default",
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <p className="max-w-[80ch] text-[13px] text-text-secondary">
          Para trocar o profissional, o procedimento ou o convênio de um
          vínculo, desative o vínculo e crie outro. As consultas já marcadas
          continuam com o vínculo antigo.
        </p>
      )}

      {profissionaisVisiveis.length > 0 ? (
        <Accordion type="multiple" className="grid gap-3">
          {profissionaisVisiveis.map((profissional) => {
            const vinculos = vinculosPorProfissional.get(profissional.id) ?? [];
            const erroDesteProfissional =
              editandoId !== null &&
              erroEdicao !== null &&
              vinculos.some((v) => v.id === editandoId);
            return (
              <AccordionItem
                key={profissional.id}
                value={profissional.id}
                className="overflow-hidden rounded-card border border-border bg-card shadow-sm"
              >
                {/* O gatilho vem dentro de um h3 do Radix: e o h3 que cresce
                    para empurrar contador e acoes para a direita. */}
                <div className="flex items-center gap-2 pr-3 pl-4 [&>h3]:min-w-0 [&>h3]:flex-1">
                  <AccordionTrigger className="min-h-14 min-w-0 flex-1 gap-3 py-2 font-medium">
                    <span className="flex min-w-0 items-center gap-3">
                      <AvatarDoProfissional
                        nome={profissional.name}
                        cor={profissional.calendar_color}
                      />
                      <span className="min-w-0 truncate">
                        <span className="font-bold text-text-strong">
                          {profissional.name}
                        </span>
                        <span className="text-text-secondary">
                          {restoDoTitulo(profissional)}
                        </span>
                      </span>
                    </span>
                  </AccordionTrigger>
                  {/* O contador fica fora do gatilho: o nome acessivel do
                      gatilho e so o titulo do profissional. */}
                  <span className="hidden shrink-0 text-xs whitespace-nowrap text-text-secondary sm:inline">
                    <span className="cz-num">{vinculos.length}</span>{" "}
                    {vinculos.length === 1 ? "vínculo" : "vínculos"}
                  </span>
                  <BotaoProtegido
                    podeEditar={podeEditar}
                    dica={dica}
                    variant="outline"
                    onClick={() => abrirNovo(profissional.id)}
                  >
                    <Plus aria-hidden /> Adicionar
                  </BotaoProtegido>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mais ações para ${profissional.name}`}
                      >
                        <Ellipsis aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-w-72">
                      {/* Item desabilitado leva a dica em texto dentro do
                          proprio item (achado 44): tooltip dentro de menu
                          nao abre em toque. */}
                      <DropdownMenuItem
                        disabled={!podeEditar || vinculos.length === 0}
                        onClick={() => abrirDuplicar(profissional.id)}
                        className="flex-col items-start justify-center gap-0.5 py-2"
                      >
                        <span>Duplicar para outro profissional</span>
                        {!podeEditar ? (
                          <span className="text-xs font-normal text-text-secondary">
                            {dica}
                          </span>
                        ) : vinculos.length === 0 ? (
                          <span className="text-xs font-normal text-text-secondary">
                            Este profissional ainda não tem vínculos para
                            copiar.
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <AccordionContent className="pb-0">
                  <div className="border-t border-border">
                    {vinculos.length === 0 ? (
                      <p className="px-4 py-5 text-[13px] text-text-secondary">
                        Este profissional ainda não tem vínculos. Use Adicionar
                        para dizer o que ele atende.
                      </p>
                    ) : (
                      <DataTable
                        variant="bare"
                        dense
                        columns={colunas}
                        data={vinculos}
                      />
                    )}
                    {erroDesteProfissional ? (
                      <div className="border-t border-border px-4 py-3">
                        <Aviso tom="alert" role="alert">
                          {erroEdicao}
                        </Aviso>
                      </div>
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : null}

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent
          className="sm:max-w-[640px]"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Adicionar vínculo</DialogTitle>
          </DialogHeader>
          {formNovo ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="vinculo-profissional">Profissional</Label>
                <Select
                  value={formNovo.professional_id}
                  onValueChange={(v) =>
                    setFormNovo({ ...formNovo, professional_id: v })
                  }
                >
                  <SelectTrigger id="vinculo-profissional" className="w-full">
                    <SelectValue placeholder="Escolha o profissional" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogo.profissionais
                      .filter((p) => p.active)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="vinculo-procedimento">Procedimento</Label>
                  <Select
                    value={formNovo.procedure_id}
                    onValueChange={escolherProcedimento}
                  >
                    <SelectTrigger id="vinculo-procedimento" className="w-full">
                      <SelectValue placeholder="Escolha o procedimento" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogo.procedimentos
                        .filter((p) => p.active)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="vinculo-convenio">Convênio</Label>
                  <Select
                    value={formNovo.insurance_id}
                    onValueChange={(v) =>
                      setFormNovo({
                        ...formNovo,
                        insurance_id: v,
                        modo:
                          v === PARTICULAR && formNovo.modo === "coberto"
                            ? "sem"
                            : formNovo.modo,
                      })
                    }
                  >
                    <SelectTrigger id="vinculo-convenio" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PARTICULAR}>Particular</SelectItem>
                      {catalogo.convenios
                        .filter((c) => c.active)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <p className="text-xs font-semibold text-foreground">
                  Modo de preço
                </p>
                <SegmentedControl
                  ariaLabel="Modo de preço"
                  block
                  value={formNovo.modo}
                  onChange={(modo) => setFormNovo({ ...formNovo, modo })}
                  options={modoBotoes.map(({ valor, rotulo }) => ({
                    value: valor,
                    label: rotulo,
                    disabled:
                      valor === "coberto" &&
                      formNovo.insurance_id === PARTICULAR,
                  }))}
                />
                {formNovo.insurance_id === PARTICULAR ? (
                  <p className="text-xs text-text-secondary">
                    Coberto pelo convênio só vale quando um convênio é
                    escolhido.
                  </p>
                ) : null}
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {formNovo.modo === "valor" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="vinculo-preco">Valor em reais</Label>
                    <Input
                      id="vinculo-preco"
                      value={formNovo.precoReais}
                      onChange={(e) =>
                        setFormNovo({
                          ...formNovo,
                          precoReais: e.target.value,
                        })
                      }
                      inputMode="decimal"
                      placeholder="250,00"
                      aria-describedby="vinculo-preco-previa"
                      className="cz-num"
                    />
                    <PreviaDeReais
                      texto={formNovo.precoReais}
                      id="vinculo-preco-previa"
                    />
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor="vinculo-duracao">Duração (minutos)</Label>
                  <Input
                    id="vinculo-duracao"
                    type="number"
                    min={5}
                    max={600}
                    value={formNovo.duration_min}
                    onChange={(e) =>
                      setFormNovo({
                        ...formNovo,
                        duration_min: e.target.value,
                      })
                    }
                    className="w-32 cz-num"
                  />
                </div>
              </div>
              <CampoDeMarcar
                id="vinculo-ia"
                rotulo="A IA pode agendar"
                marcado={formNovo.bookable_by_ai}
                aoMudar={(marcado) =>
                  setFormNovo({ ...formNovo, bookable_by_ai: marcado })
                }
              />
              {erroNovo ? (
                <Aviso tom="alert" role="alert">
                  {erroNovo}
                </Aviso>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarNovo()} disabled={salvandoNovo}>
              {salvandoNovo ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={duplicar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setDuplicar(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-[480px]"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Duplicar para outro profissional</DialogTitle>
          </DialogHeader>
          {duplicar ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="duplicar-destino">
                  Profissional que vai receber
                </Label>
                <Select
                  value={duplicar.destinoId}
                  onValueChange={(v) =>
                    setDuplicar({ ...duplicar, destinoId: v })
                  }
                >
                  <SelectTrigger id="duplicar-destino" className="w-full">
                    <SelectValue placeholder="Escolha o profissional" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogo.profissionais
                      .filter((p) => p.active && p.id !== duplicar.origemId)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-foreground">
                  Vínculos para copiar
                </legend>
                <div className="grid cz-scroll max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                  {(vinculosPorProfissional.get(duplicar.origemId) ?? []).map(
                    (vinculo) => {
                      const marcado = duplicar.selecionados.has(vinculo.id);
                      return (
                        <label
                          key={vinculo.id}
                          className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13.5px] text-foreground cz-transition hover:bg-surface-3"
                        >
                          <Checkbox
                            checked={marcado}
                            onCheckedChange={(v) => {
                              const proximos = new Set(duplicar.selecionados);
                              if (v === true) {
                                proximos.add(vinculo.id);
                              } else {
                                proximos.delete(vinculo.id);
                              }
                              setDuplicar({
                                ...duplicar,
                                selecionados: proximos,
                              });
                            }}
                          />
                          <span>
                            {nomeProcedimento.get(vinculo.procedure_id) ??
                              "Procedimento removido"}
                            <span className="text-text-secondary">
                              {" · "}
                              {vinculo.insurance_id === null
                                ? "Particular"
                                : (nomeConvenio.get(vinculo.insurance_id) ??
                                  "Convênio removido")}
                            </span>
                          </span>
                        </label>
                      );
                    },
                  )}
                </div>
              </fieldset>
              {erroDuplicar ? (
                <Aviso tom="alert" role="alert">
                  {erroDuplicar}
                </Aviso>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDuplicar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void confirmarDuplicar()}
              disabled={duplicando}
            >
              {duplicando ? "Copiando..." : "Copiar vínculos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
