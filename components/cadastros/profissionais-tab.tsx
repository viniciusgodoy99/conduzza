"use client";

import { Plus, Sunrise, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  salvarJornadaAction,
  salvarProfissionalAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  AvisoDeConsultas,
  BotaoProtegido,
  ChipSituacao,
  DetalheSomenteLeitura,
} from "@/components/cadastros/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
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
import { WEEKDAY_LABELS, type Profissional } from "@/lib/queries/catalogo";

type FormProfissional = {
  id?: string;
  name: string;
  council_type: string;
  council_number: string;
  specialties: string[];
  calendar_color: string;
  active: boolean;
};

type FaixaForm = {
  chave: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  unit_id: string | null;
};

const COR_PADRAO = "#84cc16";

const FORM_VAZIO: FormProfissional = {
  name: "",
  council_type: "",
  council_number: "",
  specialties: [],
  calendar_color: COR_PADRAO,
  active: true,
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0]?.charAt(0) ?? "";
  const ultima =
    partes.length > 1 ? (partes[partes.length - 1]?.charAt(0) ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

function horaCurta(valor: string): string {
  // O banco devolve "HH:MM:SS"; o input type="time" quer "HH:MM".
  return valor.slice(0, 5);
}

// Fim antes do inicio e uma janela que VIRA O DIA (plantao 22:00 as 02:00),
// prevista no modelo de dados (catalogo_clinico.sql e scheduling.ts). A tela
// diz isso em texto e pede confirmacao ao salvar, para uma inversao por
// engano (18:00 as 08:00) nao virar plantao calado (achado 43).
//
// Fim 00:00 NAO e plantao: e "ate a meia-noite". O motor (scheduling.ts e
// vaga_de_espera_indisponivel no banco) leva esse fim para 00:00 do dia
// seguinte, entao o ultimo horario termina exatamente a meia-noite e nenhum
// comeca depois dela. O campo de hora nao aceita 24:00, e 23:59 perderia o
// ultimo horario: 00:00 e o unico jeito de dizer "ate a meia-noite".
function terminaAMeiaNoite(faixa: { ends_at: string }): boolean {
  return horaCurta(faixa.ends_at) === "00:00";
}

function viraODia(faixa: { starts_at: string; ends_at: string }): boolean {
  return (
    faixa.starts_at !== "" &&
    faixa.ends_at !== "" &&
    !terminaAMeiaNoite(faixa) &&
    horaCurta(faixa.ends_at) < horaCurta(faixa.starts_at)
  );
}

let contadorChave = 0;
function novaChave(): string {
  contadorChave += 1;
  return `faixa-${contadorChave}`;
}

export function ProfissionaisTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
  timezone,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormProfissional>(FORM_VAZIO);
  const [faixas, setFaixasBruto] = useState<FaixaForm[]>([]);
  const [especialidadeDigitada, setEspecialidadeDigitada] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Quem so ve Cadastros consulta a jornada por dia neste mesmo painel, em
  // modo leitura (achado 41).
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  // Faixa que vira o dia (achado 43): pedindoVirada mostra a pergunta;
  // confirmarVirada guarda o "sim" ate a jornada mudar de novo.
  const [pedindoVirada, setPedindoVirada] = useState(false);
  const [confirmarVirada, setConfirmarVirada] = useState(false);
  // Desativacao com consultas futuras esperando confirmacao (achado 37).
  const [aviso, setAviso] = useState<{
    consultas: number;
    primeira: string | null;
  } | null>(null);

  const temVariasUnidades = catalogo.unidades.length >= 2;

  // Mexeu na jornada: a confirmacao de plantao anterior nao vale mais.
  const setFaixas = (proximas: FaixaForm[]) => {
    setConfirmarVirada(false);
    setPedindoVirada(false);
    setFaixasBruto(proximas);
  };

  const abrir = (profissional?: Profissional, leitura = false) => {
    setErro(null);
    setAviso(null);
    setConfirmarVirada(false);
    setPedindoVirada(false);
    setSomenteLeitura(leitura);
    setEspecialidadeDigitada("");
    if (profissional) {
      setForm({
        id: profissional.id,
        name: profissional.name,
        council_type: profissional.council_type ?? "",
        council_number: profissional.council_number ?? "",
        specialties: profissional.specialties,
        calendar_color: profissional.calendar_color ?? COR_PADRAO,
        active: profissional.active,
      });
      const salvas = catalogo.jornadas
        .filter((j) => j.professional_id === profissional.id)
        .map((j) => ({
          chave: novaChave(),
          weekday: j.weekday,
          starts_at: horaCurta(j.starts_at),
          ends_at: horaCurta(j.ends_at),
          unit_id: j.unit_id,
        }));
      setFaixas(salvas);
      // Plantao que ja estava salvo nao pede confirmacao de novo ate a
      // jornada mudar (a linha continua dizendo "termina no dia seguinte").
      setConfirmarVirada(salvas.some(viraODia));
    } else {
      setForm(FORM_VAZIO);
      setFaixas([]);
    }
    setAberto(true);
  };

  const adicionarEspecialidade = () => {
    const valor = especialidadeDigitada.trim();
    if (!valor) return;
    if (!form.specialties.includes(valor)) {
      setForm({ ...form, specialties: [...form.specialties, valor] });
    }
    setEspecialidadeDigitada("");
  };

  const removerEspecialidade = (valor: string) => {
    setForm({
      ...form,
      specialties: form.specialties.filter((s) => s !== valor),
    });
  };

  const adicionarFaixa = () => {
    setFaixas([
      ...faixas,
      {
        chave: novaChave(),
        weekday: 1,
        starts_at: "08:00",
        ends_at: "12:00",
        unit_id: null,
      },
    ]);
  };

  const atualizarFaixa = (chave: string, mudanca: Partial<FaixaForm>) => {
    setFaixas(
      faixas.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f)),
    );
  };

  const removerFaixa = (chave: string) => {
    setFaixas(faixas.filter((f) => f.chave !== chave));
  };

  const salvar = async (
    opcoes: { confirmarVirada?: boolean; confirmarConsultas?: boolean } = {},
  ) => {
    // Validacao da jornada ANTES de qualquer gravacao (achado 36): antes, a
    // faixa invalida so era recusada depois de o profissional ja existir.
    for (const faixa of faixas) {
      if (!faixa.starts_at || !faixa.ends_at) {
        setErro("Preencha início e fim de todas as faixas da jornada.");
        return;
      }
      if (horaCurta(faixa.starts_at) === horaCurta(faixa.ends_at)) {
        setErro(
          `A faixa de ${WEEKDAY_LABELS[faixa.weekday] ?? "um dos dias"} começa e termina no mesmo horário. Corrija o início ou o fim.`,
        );
        return;
      }
    }
    const confirmouVirada = opcoes.confirmarVirada === true || confirmarVirada;
    if (faixas.some(viraODia) && !confirmouVirada) {
      setErro(null);
      setConfirmarVirada(false);
      setAviso(null);
      setPedindoVirada(true);
      return;
    }
    setPedindoVirada(false);
    if (opcoes.confirmarVirada) {
      setConfirmarVirada(true);
    }

    setSalvando(true);
    setErro(null);
    const criando = !form.id;
    const resultado = await salvarProfissionalAction({
      id: form.id,
      name: form.name,
      council_type: form.council_type.trim() || null,
      council_number: form.council_number.trim() || null,
      specialties: form.specialties,
      calendar_color: form.calendar_color || null,
      active: form.active,
      confirmar_consultas: opcoes.confirmarConsultas === true,
    });
    if (!resultado.ok || !resultado.id) {
      setSalvando(false);
      if (resultado.code === "consultas_no_periodo") {
        setAviso({
          consultas: resultado.consultas ?? 0,
          primeira: resultado.primeiraConsulta ?? null,
        });
        return;
      }
      setErro(resultado.error ?? "Não foi possível salvar o profissional.");
      return;
    }
    setAviso(null);
    // O id fica no formulario ANTES da jornada: se ela falhar, o proximo
    // Salvar atualiza este profissional em vez de criar um duplicado.
    const novoId = resultado.id;
    setForm((atual) => ({ ...atual, id: novoId }));
    const resultadoJornada = await salvarJornadaAction(
      novoId,
      faixas.map((f) => ({
        weekday: f.weekday,
        starts_at: f.starts_at,
        ends_at: f.ends_at,
        unit_id: f.unit_id,
      })),
    );
    setSalvando(false);
    if (!resultadoJornada.ok) {
      const motivo = resultadoJornada.error ?? "Tente de novo.";
      setErro(
        criando
          ? `O profissional foi criado, mas a jornada não foi salva. ${motivo} Corrija e clique em Salvar de novo.`
          : `O profissional foi salvo, mas a jornada não. ${motivo}`,
      );
      aoMudar();
      return;
    }
    toast.success(criando ? "Profissional criado" : "Profissional atualizado");
    setAberto(false);
    aoMudar();
  };

  const resumoJornada = (profissionalId: string): string => {
    const dias = new Set(
      catalogo.jornadas
        .filter((j) => j.professional_id === profissionalId)
        .map((j) => j.weekday),
    ).size;
    if (dias === 0) return "Sem jornada";
    return dias === 1 ? "1 dia/semana" : `${dias} dias/semana`;
  };

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus strokeWidth={1.5} className="size-4" /> Novo profissional
        </BotaoProtegido>
      </div>

      {catalogo.profissionais.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Nenhum profissional cadastrado"
          description="Cadastre quem atende na clínica para montar a agenda e liberar o agendamento pela IA."
          action={
            podeEditar
              ? {
                  label: "Cadastrar o primeiro profissional",
                  onClick: () => abrir(),
                }
              : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Conselho</TableHead>
                <TableHead>Especialidades</TableHead>
                <TableHead>Jornada</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogo.profissionais.map((profissional) => {
                const extras = profissional.specialties.length - 3;
                return (
                  <TableRow key={profissional.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-text-secondary">
                          {iniciais(profissional.name)}
                          {profissional.calendar_color ? (
                            <span
                              aria-hidden="true"
                              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-background"
                              style={{
                                backgroundColor: profissional.calendar_color,
                              }}
                            />
                          ) : null}
                        </span>
                        {profissional.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {profissional.council_type
                        ? `${profissional.council_type} ${profissional.council_number ?? ""}`.trim()
                        : "Sem conselho"}
                    </TableCell>
                    <TableCell>
                      {profissional.specialties.length === 0 ? null : (
                        <span className="flex flex-wrap items-center gap-1">
                          {profissional.specialties.slice(0, 3).map((esp) => (
                            <Badge
                              key={esp}
                              variant="secondary"
                              className="text-[11px]"
                            >
                              {esp}
                            </Badge>
                          ))}
                          {extras > 0 ? (
                            <span className="text-xs text-text-secondary">
                              +{extras}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {resumoJornada(profissional.id)}
                    </TableCell>
                    <TableCell>
                      <ChipSituacao active={profissional.active} />
                    </TableCell>
                    <TableCell>
                      <AcoesDaLinha
                        podeEditar={podeEditar}
                        dica={dica}
                        nome={profissional.name}
                        aoEditar={() => abrir(profissional)}
                        aoVerDetalhes={() => abrir(profissional, true)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent className="w-[480px] overflow-y-auto p-5 sm:max-w-[480px]">
          <SheetHeader className="p-0">
            <SheetTitle>
              {somenteLeitura
                ? form.name
                : form.id
                  ? "Editar profissional"
                  : "Novo profissional"}
            </SheetTitle>
          </SheetHeader>
          {somenteLeitura ? (
            <DetalheSomenteLeitura
              itens={[
                {
                  rotulo: "Conselho",
                  valor: form.council_type
                    ? `${form.council_type} ${form.council_number}`.trim()
                    : "Sem conselho",
                },
                {
                  rotulo: "Especialidades",
                  valor: form.specialties.join(", "),
                },
                {
                  rotulo: "Situação",
                  valor: <ChipSituacao active={form.active} />,
                },
                {
                  rotulo: "Jornada semanal",
                  valor:
                    faixas.length === 0 ? (
                      "Sem jornada cadastrada"
                    ) : (
                      <ul className="grid gap-1">
                        {[...faixas]
                          .sort(
                            (a, b) =>
                              a.weekday - b.weekday ||
                              a.starts_at.localeCompare(b.starts_at),
                          )
                          .map((faixa) => (
                            <li key={faixa.chave} className="tabular-nums">
                              {WEEKDAY_LABELS[faixa.weekday]}: {faixa.starts_at}{" "}
                              às {faixa.ends_at}
                              {viraODia(faixa)
                                ? " (termina no dia seguinte)"
                                : terminaAMeiaNoite(faixa)
                                  ? " (meia-noite)"
                                  : ""}
                              {temVariasUnidades && faixa.unit_id
                                ? `, ${
                                    catalogo.unidades.find(
                                      (u) => u.id === faixa.unit_id,
                                    )?.name ?? "unidade removida"
                                  }`
                                : ""}
                            </li>
                          ))}
                      </ul>
                    ),
                },
              ]}
            />
          ) : null}
          {/* O formulario fica fora da arvore visivel no modo leitura
              (atributo hidden, que o preflight do Tailwind forca). */}
          <div className="grid gap-4 py-4" hidden={somenteLeitura}>
            <div className="grid gap-2">
              <Label htmlFor="prof-nome">Nome</Label>
              <Input
                id="prof-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="prof-conselho">Conselho</Label>
                <Input
                  id="prof-conselho"
                  value={form.council_type}
                  onChange={(e) =>
                    setForm({ ...form, council_type: e.target.value })
                  }
                  placeholder="CRM, CRO, CREFITO... (vazio se não tiver)"
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prof-numero">Número</Label>
                <Input
                  id="prof-numero"
                  value={form.council_number}
                  onChange={(e) =>
                    setForm({ ...form, council_number: e.target.value })
                  }
                  className="h-10"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prof-especialidade">Especialidades</Label>
              {form.specialties.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.specialties.map((esp) => (
                    <Badge
                      key={esp}
                      variant="secondary"
                      className="gap-1 pr-1 text-[12px]"
                    >
                      {esp}
                      {/* Visual de 16px, area de toque de 40px (achado 44):
                          o pseudo-elemento estende o clique sem mudar o
                          tamanho do chip. */}
                      <button
                        type="button"
                        onClick={() => removerEspecialidade(esp)}
                        aria-label={`Remover ${esp}`}
                        className="relative flex size-4 items-center justify-center rounded-full after:absolute after:-inset-3 after:content-[''] hover:bg-muted"
                      >
                        <X strokeWidth={1.5} className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Input
                id="prof-especialidade"
                value={especialidadeDigitada}
                onChange={(e) => setEspecialidadeDigitada(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionarEspecialidade();
                  }
                }}
                placeholder="Digite e aperte Enter para adicionar"
                className="h-10"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="prof-cor">Cor na agenda</Label>
              <input
                id="prof-cor"
                type="color"
                value={form.calendar_color}
                onChange={(e) =>
                  setForm({ ...form, calendar_color: e.target.value })
                }
                className="h-10 w-16 cursor-pointer rounded-md border bg-transparent p-1"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="prof-ativo">Profissional ativo</Label>
              <Switch
                id="prof-ativo"
                checked={form.active}
                onCheckedChange={(v) => {
                  setAviso(null);
                  setForm({ ...form, active: v });
                }}
              />
            </div>
            {form.id && !form.active ? (
              <p className="text-xs text-text-secondary">
                Desativado, o profissional sai da Agenda e da oferta de
                horários. Consultas já marcadas não são desmarcadas.
              </p>
            ) : null}

            <div className="grid gap-3 border-t pt-4">
              <div className="grid gap-1">
                <p className="text-sm font-semibold">Jornada semanal</p>
                <p className="text-xs text-text-secondary">
                  Almoço: crie duas faixas no mesmo dia (manhã e tarde).
                </p>
              </div>
              {faixas.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  Sem jornada cadastrada. Sem faixas, a agenda não abre horários
                  para este profissional.
                </p>
              ) : (
                <div className="grid gap-2">
                  {faixas.map((faixa) => (
                    <div
                      key={faixa.chave}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Select
                        value={String(faixa.weekday)}
                        onValueChange={(v) =>
                          atualizarFaixa(faixa.chave, { weekday: Number(v) })
                        }
                      >
                        <SelectTrigger className="h-10 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAY_LABELS.map((rotulo, indice) => (
                            <SelectItem key={rotulo} value={String(indice)}>
                              {rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="time"
                        value={faixa.starts_at}
                        onChange={(e) =>
                          atualizarFaixa(faixa.chave, {
                            starts_at: e.target.value,
                          })
                        }
                        aria-label="Início da faixa"
                        className="h-10 w-[104px]"
                      />
                      <Input
                        type="time"
                        value={faixa.ends_at}
                        onChange={(e) =>
                          atualizarFaixa(faixa.chave, {
                            ends_at: e.target.value,
                          })
                        }
                        aria-label="Fim da faixa"
                        className="h-10 w-[104px]"
                      />
                      {viraODia(faixa) ? (
                        <span className="flex basis-full items-center gap-1.5 text-xs [color:var(--warning-text)]">
                          <Sunrise
                            strokeWidth={1.5}
                            className="size-4 shrink-0"
                            aria-hidden
                          />
                          Termina no dia seguinte (plantão noturno)
                        </span>
                      ) : null}
                      {temVariasUnidades ? (
                        <Select
                          value={faixa.unit_id ?? "todas"}
                          onValueChange={(v) =>
                            atualizarFaixa(faixa.chave, {
                              unit_id: v === "todas" ? null : v,
                            })
                          }
                        >
                          <SelectTrigger className="h-10 w-[130px]">
                            <SelectValue placeholder="Unidade" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">
                              Qualquer unidade
                            </SelectItem>
                            {catalogo.unidades.map((unidade) => (
                              <SelectItem key={unidade.id} value={unidade.id}>
                                {unidade.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        onClick={() => removerFaixa(faixa.chave)}
                        aria-label="Remover faixa"
                      >
                        <Trash2 strokeWidth={1.5} className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                onClick={adicionarFaixa}
                className="h-10"
              >
                <Plus strokeWidth={1.5} className="size-4" /> Adicionar faixa
              </Button>
            </div>

            {erro ? (
              <p role="alert" className="text-sm [color:var(--alert-text)]">
                {erro}
              </p>
            ) : null}
            {pedindoVirada ? (
              <div
                role="alert"
                className="grid gap-3 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] p-3"
              >
                <div className="flex items-start gap-2 text-sm">
                  <Sunrise
                    strokeWidth={1.5}
                    className="mt-0.5 size-4 shrink-0 [color:var(--warning-text)]"
                    aria-hidden
                  />
                  <p>
                    Uma faixa termina no dia seguinte (plantão noturno): a
                    agenda vai abrir horários depois da meia-noite. Se o fim
                    ficou antes do início por engano, corrija a faixa.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="h-10"
                    disabled={salvando}
                    onClick={() => void salvar({ confirmarVirada: true })}
                  >
                    É plantão, salvar assim
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => setPedindoVirada(false)}
                  >
                    Corrigir a faixa
                  </Button>
                </div>
              </div>
            ) : aviso ? (
              <AvisoDeConsultas
                consultas={aviso.consultas}
                primeira={aviso.primeira}
                timezone={timezone}
                rotuloConfirmar="Desativar mesmo assim"
                confirmando={salvando}
                aoConfirmar={() => void salvar({ confirmarConsultas: true })}
              />
            ) : (
              <Button
                onClick={() => void salvar()}
                disabled={salvando}
                className="h-10"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
