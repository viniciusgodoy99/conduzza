"use client";

import { Check, Link2, MoreVertical, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  alternarVinculoIaAction,
  duplicarVinculosAction,
  salvarVinculoAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import { BotaoProtegido } from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import type { Profissional, Vinculo } from "@/lib/queries/catalogo";

// Aba de Vínculos: a matriz de três pontas (profissional x procedimento x
// convênio). Acordeão por profissional, tabela inline, edição na linha e
// duplicação de vínculos entre profissionais.

type ModoPreco = "valor" | "coberto" | "sem";

const PARTICULAR = "particular";

function tituloProfissional(p: Profissional): string {
  const partes: string[] = [p.name];
  const conselho = [p.council_type, p.council_number]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" ");
  if (conselho) {
    partes.push(conselho);
  }
  if (p.specialties.length > 0) {
    partes.push(p.specialties.join(", "));
  }
  return partes.join(" · ");
}

function centavosParaReais(cents: number | null): string {
  if (cents === null) {
    return "";
  }
  return (cents / 100).toFixed(2).replace(".", ",");
}

function reaisParaCentavos(texto: string): number | null {
  const normalizado = texto.trim().replace(/\./g, "").replace(",", ".");
  if (normalizado === "") {
    return null;
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) {
    return null;
  }
  return Math.round(valor * 100);
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
      precoCentavos = reaisParaCentavos(formNovo.precoReais);
      if (precoCentavos === null) {
        setErroNovo("Informe o valor em reais, por exemplo 250,00.");
        return;
      }
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
      precoCentavos = reaisParaCentavos(formEdicao.precoReais);
      if (precoCentavos === null) {
        setErroEdicao("Informe o valor em reais, por exemplo 250,00.");
        return;
      }
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

  return (
    <div className="grid gap-3">
      {semVinculos ? (
        <div className="grid gap-3">
          <EmptyState
            icon={Link2}
            title="Nenhum vínculo cadastrado"
            description="O vínculo diz quem faz o quê, por quanto e em quanto tempo. Sem ele, a IA não informa preço nem agenda."
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <DisabledWithHint hint="A importação por planilha chega em breve. Por enquanto, use Adicionar vínculo.">
              <Button size="lg" disabled className="h-11">
                Importar de planilha
              </Button>
            </DisabledWithHint>
            <BotaoProtegido
              podeEditar={podeEditar}
              dica={dica}
              onClick={() => abrirNovo(profissionaisVisiveis[0]?.id ?? "")}
            >
              <Plus strokeWidth={1.5} className="size-4" /> Adicionar vínculo
            </BotaoProtegido>
          </div>
        </div>
      ) : null}

      {profissionaisVisiveis.length > 0 ? (
        <Accordion type="multiple" className="grid gap-2">
          {profissionaisVisiveis.map((profissional) => {
            const vinculos = vinculosPorProfissional.get(profissional.id) ?? [];
            return (
              <AccordionItem
                key={profissional.id}
                value={profissional.id}
                className="rounded-lg border px-3 last:border-b"
              >
                <div className="flex items-center gap-2">
                  <AccordionTrigger className="min-h-10 flex-1 py-3 text-left text-sm font-medium">
                    {tituloProfissional(profissional)}
                  </AccordionTrigger>
                  <BotaoProtegido
                    podeEditar={podeEditar}
                    dica={dica}
                    variant="outline"
                    size="sm"
                    onClick={() => abrirNovo(profissional.id)}
                  >
                    <Plus strokeWidth={1.5} className="size-4" /> Adicionar
                  </BotaoProtegido>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={`Mais ações para ${profissional.name}`}
                      >
                        <MoreVertical strokeWidth={1.5} className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!podeEditar || vinculos.length === 0}
                        onClick={() => abrirDuplicar(profissional.id)}
                      >
                        Duplicar para outro profissional
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <AccordionContent className="pb-3">
                  {vinculos.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed px-4 py-4">
                      <p className="text-sm text-text-secondary">
                        Este profissional ainda não tem vínculos.
                      </p>
                      <BotaoProtegido
                        podeEditar={podeEditar}
                        dica={dica}
                        variant="outline"
                        size="sm"
                        onClick={() => abrirNovo(profissional.id)}
                      >
                        <Plus strokeWidth={1.5} className="size-4" /> Adicionar
                      </BotaoProtegido>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Procedimento</TableHead>
                            <TableHead>Convênio</TableHead>
                            <TableHead>Preço</TableHead>
                            <TableHead>Duração</TableHead>
                            <TableHead>IA</TableHead>
                            <TableHead className="w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vinculos.map((vinculo) => {
                            const preco = exibirPrecoVinculo(vinculo);
                            const emEdicao =
                              editandoId === vinculo.id && formEdicao !== null;
                            return (
                              <TableRow key={vinculo.id}>
                                <TableCell className="font-medium">
                                  {nomeProcedimento.get(vinculo.procedure_id) ??
                                    "Procedimento removido"}
                                </TableCell>
                                <TableCell className="text-text-secondary">
                                  {vinculo.insurance_id === null
                                    ? "Particular"
                                    : (nomeConvenio.get(vinculo.insurance_id) ??
                                      "Convênio removido")}
                                </TableCell>
                                <TableCell>
                                  {emEdicao && formEdicao ? (
                                    <div className="grid min-w-44 gap-1.5">
                                      <Select
                                        value={formEdicao.modo}
                                        onValueChange={(v) =>
                                          setFormEdicao({
                                            ...formEdicao,
                                            modo: v as ModoPreco,
                                          })
                                        }
                                      >
                                        <SelectTrigger className="h-10 w-full">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="valor">
                                            Valor em reais
                                          </SelectItem>
                                          <SelectItem
                                            value="coberto"
                                            disabled={
                                              vinculo.insurance_id === null
                                            }
                                          >
                                            Coberto pelo convênio
                                          </SelectItem>
                                          <SelectItem value="sem">
                                            Sem preço informado
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                      {formEdicao.modo === "valor" ? (
                                        <Input
                                          value={formEdicao.precoReais}
                                          onChange={(e) =>
                                            setFormEdicao({
                                              ...formEdicao,
                                              precoReais: e.target.value,
                                            })
                                          }
                                          inputMode="decimal"
                                          placeholder="250,00"
                                          aria-label="Valor em reais"
                                          className="h-10 font-mono tabular-nums"
                                        />
                                      ) : null}
                                    </div>
                                  ) : preco.kind === "coberto" ? (
                                    <span className="text-text-secondary">
                                      {preco.text}
                                    </span>
                                  ) : preco.kind === "valor" ? (
                                    <span className="font-mono tabular-nums">
                                      {preco.text}
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  {emEdicao && formEdicao ? (
                                    <Input
                                      type="number"
                                      min={5}
                                      max={600}
                                      value={formEdicao.duration_min}
                                      onChange={(e) =>
                                        setFormEdicao({
                                          ...formEdicao,
                                          duration_min: e.target.value,
                                        })
                                      }
                                      aria-label="Duração em minutos"
                                      className="h-10 w-24 tabular-nums"
                                    />
                                  ) : (
                                    `${vinculo.duration_min} min`
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="grid gap-1">
                                    <Switch
                                      checked={vinculo.bookable_by_ai}
                                      disabled={
                                        !podeEditar ||
                                        alternandoId === vinculo.id
                                      }
                                      onCheckedChange={(v) =>
                                        void alternarIa(vinculo, v)
                                      }
                                      aria-label="IA pode agendar"
                                      className="scale-90"
                                    />
                                    {!vinculo.bookable_by_ai ? (
                                      <span className="text-xs text-text-tertiary">
                                        Só a recepção agenda
                                      </span>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {emEdicao ? (
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-10"
                                        disabled={salvandoEdicao}
                                        onClick={() =>
                                          void salvarEdicao(vinculo)
                                        }
                                        aria-label="Salvar vínculo"
                                      >
                                        <Check
                                          strokeWidth={1.5}
                                          className="size-4"
                                        />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-10"
                                        disabled={salvandoEdicao}
                                        onClick={cancelarEdicao}
                                        aria-label="Cancelar edição"
                                      >
                                        <X
                                          strokeWidth={1.5}
                                          className="size-4"
                                        />
                                      </Button>
                                    </div>
                                  ) : podeEditar ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-10"
                                      onClick={() => iniciarEdicao(vinculo)}
                                      aria-label="Editar vínculo"
                                    >
                                      <Pencil
                                        strokeWidth={1.5}
                                        className="size-4"
                                      />
                                    </Button>
                                  ) : (
                                    <DisabledWithHint hint={dica}>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-10"
                                        disabled
                                        aria-label="Editar vínculo"
                                      >
                                        <Pencil
                                          strokeWidth={1.5}
                                          className="size-4"
                                        />
                                      </Button>
                                    </DisabledWithHint>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {editandoId !== null &&
                          erroEdicao !== null &&
                          vinculos.some((v) => v.id === editandoId) ? (
                            <TableRow>
                              <TableCell colSpan={6}>
                                <p
                                  role="alert"
                                  className="text-sm [color:var(--alert-text)]"
                                >
                                  {erroEdicao}
                                </p>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : null}

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar vínculo</DialogTitle>
          </DialogHeader>
          {formNovo ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="vinculo-profissional">Profissional</Label>
                <Select
                  value={formNovo.professional_id}
                  onValueChange={(v) =>
                    setFormNovo({ ...formNovo, professional_id: v })
                  }
                >
                  <SelectTrigger
                    id="vinculo-profissional"
                    className="h-10 w-full"
                  >
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
              <div className="grid gap-2">
                <Label htmlFor="vinculo-procedimento">Procedimento</Label>
                <Select
                  value={formNovo.procedure_id}
                  onValueChange={escolherProcedimento}
                >
                  <SelectTrigger
                    id="vinculo-procedimento"
                    className="h-10 w-full"
                  >
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
              <div className="grid gap-2">
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
                  <SelectTrigger id="vinculo-convenio" className="h-10 w-full">
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
              <div className="grid gap-2">
                <Label>Modo de preço</Label>
                <div className="flex flex-wrap gap-1 rounded-md border p-1">
                  {modoBotoes.map(({ valor, rotulo }) => {
                    const cobertoBloqueado =
                      valor === "coberto" &&
                      formNovo.insurance_id === PARTICULAR;
                    return (
                      <Button
                        key={valor}
                        type="button"
                        size="sm"
                        variant={formNovo.modo === valor ? "default" : "ghost"}
                        disabled={cobertoBloqueado}
                        className="h-10 flex-1 whitespace-nowrap"
                        aria-pressed={formNovo.modo === valor}
                        onClick={() =>
                          setFormNovo({ ...formNovo, modo: valor })
                        }
                      >
                        {rotulo}
                      </Button>
                    );
                  })}
                </div>
                {formNovo.insurance_id === PARTICULAR ? (
                  <p className="text-xs text-text-tertiary">
                    Coberto pelo convênio só vale quando um convênio é
                    escolhido.
                  </p>
                ) : null}
              </div>
              {formNovo.modo === "valor" ? (
                <div className="grid gap-2">
                  <Label htmlFor="vinculo-preco">Valor em reais</Label>
                  <Input
                    id="vinculo-preco"
                    value={formNovo.precoReais}
                    onChange={(e) =>
                      setFormNovo({ ...formNovo, precoReais: e.target.value })
                    }
                    inputMode="decimal"
                    placeholder="250,00"
                    className="h-10 font-mono tabular-nums"
                  />
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="vinculo-duracao">Duração (minutos)</Label>
                <Input
                  id="vinculo-duracao"
                  type="number"
                  min={5}
                  max={600}
                  value={formNovo.duration_min}
                  onChange={(e) =>
                    setFormNovo({ ...formNovo, duration_min: e.target.value })
                  }
                  className="h-10 w-32 tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="vinculo-ia">A IA pode agendar</Label>
                <Switch
                  id="vinculo-ia"
                  checked={formNovo.bookable_by_ai}
                  onCheckedChange={(v) =>
                    setFormNovo({ ...formNovo, bookable_by_ai: v })
                  }
                />
              </div>
              {erroNovo ? (
                <p role="alert" className="text-sm [color:var(--alert-text)]">
                  {erroNovo}
                </p>
              ) : null}
              <Button
                onClick={() => void salvarNovo()}
                disabled={salvandoNovo}
                className="h-10"
              >
                {salvandoNovo ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          ) : null}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicar para outro profissional</DialogTitle>
          </DialogHeader>
          {duplicar ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="duplicar-destino">
                  Profissional que vai receber
                </Label>
                <Select
                  value={duplicar.destinoId}
                  onValueChange={(v) =>
                    setDuplicar({ ...duplicar, destinoId: v })
                  }
                >
                  <SelectTrigger id="duplicar-destino" className="h-10 w-full">
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
              <div className="grid gap-2">
                <Label>Vínculos para copiar</Label>
                <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2">
                  {(vinculosPorProfissional.get(duplicar.origemId) ?? []).map(
                    (vinculo) => {
                      const marcado = duplicar.selecionados.has(vinculo.id);
                      return (
                        <label
                          key={vinculo.id}
                          className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm"
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
              </div>
              {erroDuplicar ? (
                <p role="alert" className="text-sm [color:var(--alert-text)]">
                  {erroDuplicar}
                </p>
              ) : null}
              <Button
                onClick={() => void confirmarDuplicar()}
                disabled={duplicando}
                className="h-10"
              >
                {duplicando ? "Copiando..." : "Copiar vínculos"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
