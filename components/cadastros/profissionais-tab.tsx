"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BriefcaseMedical, Plus, Sunrise, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  salvarJornadaAction,
  salvarProfissionalAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  AvatarDoProfissional,
  AvisoDeConsultas,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
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

// Constante de dominio, nao de interface: e a cor de agenda que um
// profissional novo recebe (dado gravado em professional.calendar_color, que
// a clinica troca no seletor). Por isso e o unico hex do arquivo (docs/06
// secao 5.11).
const COR_PADRAO = "#84cc16";

const FORM_VAZIO: FormProfissional = {
  name: "",
  council_type: "",
  council_number: "",
  specialties: [],
  calendar_color: COR_PADRAO,
  active: true,
};

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

  const diasDeJornada = (profissionalId: string): number =>
    new Set(
      catalogo.jornadas
        .filter((j) => j.professional_id === profissionalId)
        .map((j) => j.weekday),
    ).size;

  const colunas: ColumnDef<Profissional>[] = [
    {
      id: "nome",
      header: "Nome",
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <AvatarDoProfissional
            nome={row.original.name}
            cor={row.original.calendar_color}
          />
          <span className="truncate font-semibold text-text-strong">
            {row.original.name}
          </span>
        </span>
      ),
    },
    {
      id: "conselho",
      header: "Conselho",
      cell: ({ row }) =>
        row.original.council_type ? (
          <span className="cz-num whitespace-nowrap text-text-secondary">
            {`${row.original.council_type} ${row.original.council_number ?? ""}`.trim()}
          </span>
        ) : (
          <span className="text-text-secondary">Sem conselho</span>
        ),
    },
    {
      id: "especialidades",
      header: "Especialidades",
      cell: ({ row }) => {
        const especialidades = row.original.specialties;
        if (especialidades.length === 0) {
          return <span className="text-text-secondary">Sem especialidade</span>;
        }
        const restantes = especialidades.slice(3);
        return (
          <span className="flex flex-wrap items-center gap-1 py-1.5">
            {especialidades.slice(0, 3).map((esp) => (
              // Especialidade e Tag neutra do DS (variante outline do
              // Badge), nunca status: sem icone e sem cor semantica.
              <Badge
                key={esp}
                variant="outline"
                className="h-5 px-2 text-[11px]"
              >
                {esp}
              </Badge>
            ))}
            {restantes.length > 0 ? (
              <span
                className="cz-num text-xs text-text-secondary"
                title={restantes.join(", ")}
              >
                +{restantes.length}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "jornada",
      header: "Jornada",
      cell: ({ row }) => {
        const dias = diasDeJornada(row.original.id);
        if (dias === 0) {
          return <span className="text-text-secondary">Sem jornada</span>;
        }
        return (
          <span className="whitespace-nowrap text-text-secondary">
            <span className="cz-num">{dias}</span>{" "}
            {dias === 1 ? "dia/semana" : "dias/semana"}
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
          <Plus aria-hidden /> Novo profissional
        </BotaoProtegido>
      </div>

      {catalogo.profissionais.length === 0 ? (
        <VazioDaAba
          icon={BriefcaseMedical}
          titulo="Nenhum profissional cadastrado"
          descricao="Cadastre quem atende na clínica para montar a agenda e liberar o agendamento pela IA."
          acao={{
            rotulo: "Cadastrar o primeiro profissional",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.profissionais} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        larga
        titulo={
          somenteLeitura
            ? form.name
            : form.id
              ? "Editar profissional"
              : "Novo profissional"
        }
        erro={somenteLeitura ? null : erro}
        aviso={
          somenteLeitura ? null : pedindoVirada ? (
            <Aviso tom="warning" icone={Sunrise} role="alert">
              <p>
                Uma faixa termina no dia seguinte (plantão noturno): a agenda
                vai abrir horários depois da meia-noite. Se o fim ficou antes do
                início por engano, corrija a faixa.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={salvando}
                  onClick={() => void salvar({ confirmarVirada: true })}
                >
                  É plantão, salvar assim
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPedindoVirada(false)}
                >
                  Corrigir a faixa
                </Button>
              </div>
            </Aviso>
          ) : aviso ? (
            <AvisoDeConsultas
              consultas={aviso.consultas}
              primeira={aviso.primeira}
              timezone={timezone}
              rotuloConfirmar="Desativar mesmo assim"
              confirmando={salvando}
              aoConfirmar={() => void salvar({ confirmarConsultas: true })}
            />
          ) : null
        }
        rodape={
          somenteLeitura ? undefined : pedindoVirada || aviso ? (
            <Button variant="ghost" onClick={fechar}>
              Cancelar
            </Button>
          ) : (
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
              {
                rotulo: "Conselho",
                valor: form.council_type ? (
                  <span className="cz-num">
                    {`${form.council_type} ${form.council_number}`.trim()}
                  </span>
                ) : (
                  "Sem conselho"
                ),
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
                          <li key={faixa.chave}>
                            {WEEKDAY_LABELS[faixa.weekday]}:{" "}
                            <span className="cz-num">{faixa.starts_at}</span> às{" "}
                            <span className="cz-num">{faixa.ends_at}</span>
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
        <div className="grid gap-4" hidden={somenteLeitura}>
          <div className="grid gap-1.5">
            <Label htmlFor="prof-nome">Nome</Label>
            <Input
              id="prof-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prof-conselho">Conselho</Label>
              <Input
                id="prof-conselho"
                value={form.council_type}
                onChange={(e) =>
                  setForm({ ...form, council_type: e.target.value })
                }
                placeholder="CRM, CRO, CREFITO... (vazio se não tiver)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prof-numero">Número</Label>
              <Input
                id="prof-numero"
                value={form.council_number}
                onChange={(e) =>
                  setForm({ ...form, council_number: e.target.value })
                }
                className="cz-num"
              />
            </div>
          </div>
          {/* gap-2 (8px) e nao 1,5: a area de toque do "x" passa 8px acima
              e abaixo da etiqueta e nao pode cobrir o rotulo nem o campo. */}
          <div className="grid gap-2">
            <Label htmlFor="prof-especialidade">Especialidades</Label>
            {form.specialties.length > 0 ? (
              <ul
                aria-label="Especialidades adicionadas"
                className="flex flex-wrap gap-2"
              >
                {form.specialties.map((esp) => (
                  <li key={esp} className="flex">
                    {/* A etiqueta nao recorta (overflow-visible): o botao de
                        remover tem 40x40px de verdade (achados 44 e R16).
                        Ele comeca depois do nome, entao tocar no fim do nome
                        nao remove nada, e passa so 8px da borda da
                        etiqueta, o mesmo vao ate a vizinha. */}
                    <Badge
                      variant="outline"
                      className="gap-1 overflow-visible pr-0"
                    >
                      {esp}
                      <button
                        type="button"
                        onClick={() => removerEspecialidade(esp)}
                        aria-label={`Remover ${esp}`}
                        className="group/remover relative -my-2 -mr-2 flex size-10 shrink-0 items-center pl-2 outline-none"
                      >
                        <span className="grid size-5 place-items-center rounded-sm text-text-secondary cz-transition group-hover/remover:bg-surface-3 group-hover/remover:text-text-strong group-focus-visible/remover:outline-2 group-focus-visible/remover:outline-offset-1 group-focus-visible/remover:outline-focus group-focus-visible/remover:outline-solid">
                          <X aria-hidden className="size-3" />
                        </span>
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
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
              className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-card p-1 cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            />
          </div>
          <CampoDeMarcar
            id="prof-ativo"
            rotulo="Profissional ativo"
            descricao={
              form.id && !form.active
                ? "Desativado, o profissional sai da Agenda e da oferta de horários. Consultas já marcadas não são desmarcadas."
                : undefined
            }
            marcado={form.active}
            aoMudar={(marcado) => {
              setAviso(null);
              setForm({ ...form, active: marcado });
            }}
          />

          <div className="grid gap-3 border-t border-border pt-4">
            <div className="grid gap-1">
              <p className="text-sm font-bold text-text-strong">
                Jornada semanal
              </p>
              <p className="text-xs text-text-secondary">
                Almoço: crie duas faixas no mesmo dia (manhã e tarde).
              </p>
            </div>
            {faixas.length === 0 ? (
              <p className="text-[13px] text-text-secondary">
                Sem jornada cadastrada. Sem faixas, a agenda não abre horários
                para este profissional.
              </p>
            ) : (
              <div className="grid gap-2">
                {faixas.map((faixa) => (
                  <div
                    key={faixa.chave}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-4 p-2"
                  >
                    <Select
                      value={String(faixa.weekday)}
                      onValueChange={(v) =>
                        atualizarFaixa(faixa.chave, { weekday: Number(v) })
                      }
                    >
                      <SelectTrigger
                        aria-label="Dia da faixa"
                        className="w-[110px]"
                      >
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
                      className="w-[112px] cz-num"
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
                      className="w-[112px] cz-num"
                    />
                    {temVariasUnidades ? (
                      <Select
                        value={faixa.unit_id ?? "todas"}
                        onValueChange={(v) =>
                          atualizarFaixa(faixa.chave, {
                            unit_id: v === "todas" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Unidade da faixa"
                          className="w-[130px]"
                        >
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
                      className="ml-auto"
                      onClick={() => removerFaixa(faixa.chave)}
                      aria-label="Remover faixa"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                    {viraODia(faixa) ? (
                      <span className="flex basis-full items-center gap-1.5 px-1 text-xs font-medium text-warning-text">
                        <Sunrise className="size-4 shrink-0" aria-hidden />
                        Termina no dia seguinte (plantão noturno)
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              onClick={adicionarFaixa}
              className="justify-self-start"
            >
              <Plus aria-hidden /> Adicionar faixa
            </Button>
          </div>
        </div>
      </PainelDeCadastro>
    </div>
  );
}
