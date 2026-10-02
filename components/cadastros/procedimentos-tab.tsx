"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Plus, SlidersHorizontal, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  salvarProcedimentoAction,
  sincronizarVinculosDoProcedimentoAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  AvatarDoProfissional,
  BotaoProtegido,
  COBERTO_PELO_CONVENIO,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  PreviaDeReais,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { DataTable } from "@/components/shared/data-table";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import {
  ajusteAoMarcar,
  avisoDosVinculosDesativados,
  conveniosParaMarcar,
  linhaAoAdicionar,
  linhasDosVinculos,
  linhasQueAAgendaOferece,
  listaCurta,
  personalizar,
  precisaSincronizarVinculos,
  profissionaisParaAdicionar,
  resumoDoProcedimento,
  valoresDoAjuste,
  vinculosDasLinhas,
  voltarAoPadrao,
  type AjusteDoConvenio,
  type EstadoDosVinculos,
  type LinhaDoProfissional,
  type ModoPreco,
  type PadraoDoProcedimento,
} from "@/lib/domain/vinculos-do-procedimento";
import type {
  Convenio,
  Procedimento,
  Profissional,
} from "@/lib/queries/catalogo";
import { cn } from "@/lib/utils";
import {
  centavosParaReais,
  formatarCentavos,
  lerReais,
} from "@/lib/utils/moeda";

// Aba Procedimentos. Desde 29/09/2026 (decisao do dono) o vinculo de tres
// pontas (profissional x procedimento x convenio, spec 3.5) e feito AQUI, na
// secao "Quem faz e convenios" do modal: a aba Vinculos saiu de Cadastros. O
// campo "Recurso necessario" tambem saiu da tela; a coluna e a trava do banco
// continuam, e salvar o procedimento nao mexe nelas.

type FormProcedimento = {
  id?: string;
  name: string;
  description: string;
  default_duration_min: string;
  preco_reais: string;
  requires_evaluation: boolean;
  prep_instructions: string;
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
  bookable_by_ai: true,
  active: true,
};

const PARTICULAR = "Particular";

// Procedimento novo: nada gravado na abertura.
const SEM_LINHAS: readonly LinhaDoProfissional[] = [];

// Ids da secao "Quem faz e convenios" (so existe uma no modal).
const ID_DO_TITULO = "proc-quem-faz-titulo";
const ID_DO_ADICIONAR = "proc-adicionar-profissional";
const idDoRemover = (professionalId: string) => `qf-${professionalId}-remover`;

const MODOS_DE_PRECO: { valor: ModoPreco; rotulo: string }[] = [
  { valor: "valor", rotulo: "Valor em reais" },
  { valor: "coberto", rotulo: "Coberto pelo convênio" },
  { valor: "sem", rotulo: "Sem preço informado" },
];

// Padrao que o procedimento GRAVADO da aos vinculos (para ler, ao abrir,
// quem segue o padrao e quem e excecao).
function padraoGravado(procedimento: Procedimento): PadraoDoProcedimento {
  return {
    basePriceCents: procedimento.base_price_cents,
    durationMin: procedimento.default_duration_min,
  };
}

// Padrao que o FORMULARIO da agora (o que "seguir o padrao" vai gravar). Com
// preco ou duracao ilegiveis, mostra sem valor e sem minutos: o Salvar
// confere os dois antes de gravar qualquer coisa.
function padraoDoFormulario(form: FormProcedimento): PadraoDoProcedimento {
  const preco = lerReais(form.preco_reais);
  const duracao = Number(form.default_duration_min);
  return {
    basePriceCents: typeof preco === "number" ? preco : null,
    durationMin: Number.isInteger(duracao) && duracao > 0 ? duracao : 0,
  };
}

// Os tres estados de preco, cada um com a sua forma (docs/04): valor em
// reais, "Coberto" como rotulo (nunca R$ 0,00) e sem preco em texto.
function PrecoDoVinculo({
  price_cents,
  covered_by_insurance,
}: {
  price_cents: number | null;
  covered_by_insurance: boolean;
}) {
  const preco = exibirPrecoVinculo({ price_cents, covered_by_insurance });
  if (preco.kind === "coberto") {
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
}

function Duracao({ minutos }: { minutos: number | null }) {
  if (minutos === null || minutos <= 0) {
    return <span className="text-text-secondary">Duração a definir</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="cz-num">{minutos}</span> min
    </span>
  );
}

type NomesDoCatalogo = {
  profissional: (id: string) => Profissional | undefined;
  convenio: (id: string) => Convenio | undefined;
  nomeDoProfissional: (id: string) => string;
  nomeDoConvenio: (id: string | null) => string;
};

// Um convenio aceito por um profissional: segue o padrao do procedimento
// (uma linha de leitura com "Personalizar") ou e excecao (modo de preco,
// valor e duracao proprios, com "Usar o padrão" para voltar).
//
// O cabecalho e o MESMO nos dois estados, com o botao de alternar sempre no
// mesmo lugar da arvore: so mudam rotulo, icone e acao. Assim o React
// reaproveita o mesmo <button> e o foco do teclado fica nele (antes o botao
// era desmontado e o FocusScope do Radix jogava o foco para o topo do
// modal). O bloco da excecao vem logo abaixo do cabecalho, entao o proximo
// Tab ja cai no modo de preco.
function LinhaDoConvenio({
  ajuste,
  nomeDoProfissional,
  nomeDoConvenio,
  convenioInativo,
  padrao,
  idBase,
  aoMudar,
}: {
  ajuste: AjusteDoConvenio;
  nomeDoProfissional: string;
  nomeDoConvenio: string;
  convenioInativo: boolean;
  padrao: PadraoDoProcedimento;
  idBase: string;
  aoMudar: (ajuste: AjusteDoConvenio) => void;
}) {
  const personalizado = !ajuste.padrao;
  const particular = ajuste.insuranceId === null;
  const idDaExcecao = `${idBase}-excecao`;
  const valores = valoresDoAjuste(ajuste, padrao);
  return (
    <li
      className={cn(
        "grid gap-2.5 border-b border-border py-1 pr-1 pl-3 last:border-b-0",
        personalizado && "pb-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "flex min-w-0 items-center gap-2",
            personalizado
              ? "flex-1"
              : // Largura fixa alinha o preco entre as linhas; com o selo
                // Inativo o nome precisa de mais espaco.
                convenioInativo
                ? "shrink-0"
                : "w-28 shrink-0",
          )}
        >
          <span className="truncate text-[13px] font-semibold text-text-strong">
            {nomeDoConvenio}
          </span>
          {convenioInativo ? <ChipSituacao active={false} /> : null}
        </span>
        {personalizado ? null : (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-[13px]">
            <PrecoDoVinculo
              price_cents={valores.price_cents}
              covered_by_insurance={valores.covered_by_insurance}
            />
            <span aria-hidden className="text-text-secondary">
              ·
            </span>
            <Duracao minutos={valores.duration_min} />
          </span>
        )}
        <span className="text-xs text-text-secondary">
          {personalizado ? "Personalizado" : "Padrão do procedimento"}
        </span>
        <Button
          variant="ghost"
          className="h-10"
          onClick={() =>
            aoMudar(
              personalizado
                ? voltarAoPadrao(ajuste, padrao)
                : personalizar(ajuste, padrao),
            )
          }
          aria-expanded={personalizado}
          aria-controls={personalizado ? idDaExcecao : undefined}
          aria-label={
            personalizado
              ? `Usar o padrão em ${nomeDoConvenio} de ${nomeDoProfissional}`
              : `Personalizar ${nomeDoConvenio} de ${nomeDoProfissional}`
          }
        >
          {personalizado ? (
            <Undo2 aria-hidden />
          ) : (
            <SlidersHorizontal aria-hidden />
          )}
          {personalizado ? "Usar o padrão" : "Personalizar"}
        </Button>
      </div>
      {personalizado ? (
        <div id={idDaExcecao} className="grid gap-2.5 pr-2">
          <SegmentedControl
            ariaLabel={`Modo de preço de ${nomeDoConvenio}`}
            block
            // Em tela estreita as tres opcoes quebram linha em vez de vazar.
            className="h-auto flex-wrap"
            value={ajuste.modo}
            onChange={(modo) => aoMudar({ ...ajuste, modo })}
            options={MODOS_DE_PRECO.map(({ valor, rotulo }) => ({
              value: valor,
              label: rotulo,
              disabled: valor === "coberto" && particular,
            }))}
          />
          {particular ? (
            <p className="text-xs text-text-secondary">
              Coberto pelo convênio só vale quando um convênio é escolhido.
            </p>
          ) : null}
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {ajuste.modo === "valor" ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${idBase}-preco`}>
                  Valor (R$)
                  <span className="sr-only"> de {nomeDoConvenio}</span>
                </Label>
                <Input
                  id={`${idBase}-preco`}
                  value={ajuste.precoReais}
                  onChange={(e) =>
                    aoMudar({ ...ajuste, precoReais: e.target.value })
                  }
                  inputMode="decimal"
                  placeholder="250,00"
                  aria-describedby={`${idBase}-previa`}
                  className="cz-num"
                />
                <PreviaDeReais
                  texto={ajuste.precoReais}
                  id={`${idBase}-previa`}
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor={`${idBase}-duracao`}>
                Duração (min)
                <span className="sr-only"> de {nomeDoConvenio}</span>
              </Label>
              <Input
                id={`${idBase}-duracao`}
                type="number"
                min={5}
                max={600}
                step={5}
                value={ajuste.duracao}
                onChange={(e) =>
                  aoMudar({ ...ajuste, duracao: e.target.value })
                }
                className="w-32 cz-num"
              />
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// Secao "Quem faz e convenios" do modal (caso do Dr. Joao, spec 3.5): uma
// linha por profissional que faz o procedimento e, em cada uma, os convenios
// que ELE aceita neste procedimento. Particular e sempre uma opcao (nao e um
// convenio cadastrado); o convenio inativo so aparece onde ja estava marcado
// ou gravado quando o modal abriu, para o proximo Salvar nao desativar o
// vinculo sem ninguem pedir e para o desmarcar por engano ter volta. O mesmo
// vale para o profissional inativo removido: volta pelo "Adicionar quem faz",
// com os convenios e valores gravados (`linhasNaAbertura`).
function QuemFazEConvenios({
  linhas,
  linhasNaAbertura,
  aoMudarLinhas,
  padrao,
  profissionais,
  convenios,
  nomes,
}: {
  linhas: LinhaDoProfissional[];
  /** As linhas gravadas quando o modal abriu (vazio no procedimento novo) */
  linhasNaAbertura: readonly LinhaDoProfissional[];
  aoMudarLinhas: (linhas: LinhaDoProfissional[]) => void;
  padrao: PadraoDoProcedimento;
  profissionais: Profissional[];
  convenios: Convenio[];
  nomes: NomesDoCatalogo;
}) {
  const naLista = new Set(linhas.map((linha) => linha.professionalId));
  const disponiveis = profissionaisParaAdicionar(
    profissionais,
    linhas,
    linhasNaAbertura,
  );
  const temProfissionalAtivo = profissionais.some((p) => p.active);

  // Foco depois do Remover: o cartao sai inteiro com o botao que tinha o
  // foco, e o FocusScope do Radix mandaria o foco para o topo do modal. Vai
  // para o Remover do proximo cartao ou, no ultimo, para "Adicionar quem
  // faz"; se esse campo estiver desabilitado, para o titulo da secao.
  const focoDepoisDeRemover = useRef<string | null>(null);
  useEffect(() => {
    const alvo = focoDepoisDeRemover.current;
    if (alvo === null) {
      return;
    }
    focoDepoisDeRemover.current = null;
    const elemento = document.getElementById(alvo);
    if (elemento instanceof HTMLButtonElement && !elemento.disabled) {
      elemento.focus();
      return;
    }
    document.getElementById(ID_DO_TITULO)?.focus();
  }, [linhas]);

  const remover = (professionalId: string) => {
    const indice = linhas.findIndex(
      (linha) => linha.professionalId === professionalId,
    );
    const proxima = indice === -1 ? undefined : linhas[indice + 1];
    focoDepoisDeRemover.current = proxima
      ? idDoRemover(proxima.professionalId)
      : ID_DO_ADICIONAR;
    aoMudarLinhas(
      linhas.filter((linha) => linha.professionalId !== professionalId),
    );
  };

  const ordemDoConvenio = (insuranceId: string | null): number => {
    if (insuranceId === null) {
      return -1;
    }
    const indice = convenios.findIndex((c) => c.id === insuranceId);
    return indice === -1 ? Number.MAX_SAFE_INTEGER : indice;
  };

  const trocarLinha = (
    professionalId: string,
    mudar: (linha: LinhaDoProfissional) => LinhaDoProfissional,
  ) =>
    aoMudarLinhas(
      linhas.map((linha) =>
        linha.professionalId === professionalId ? mudar(linha) : linha,
      ),
    );

  const adicionar = (professionalId: string) => {
    if (!professionalId || naLista.has(professionalId)) {
      return;
    }
    // Novo entra atendendo Particular pelo padrao (os convenios, quem
    // cadastra marca: nem todo profissional aceita todo convenio); quem
    // estava gravado quando o modal abriu volta como estava.
    aoMudarLinhas([
      ...linhas,
      linhaAoAdicionar(professionalId, linhasNaAbertura, padrao),
    ]);
  };

  const marcarConvenio = (
    professionalId: string,
    insuranceId: string | null,
    marcado: boolean,
  ) =>
    trocarLinha(professionalId, (linha) => {
      const semEste = linha.convenios.filter(
        (ajuste) => ajuste.insuranceId !== insuranceId,
      );
      if (!marcado) {
        return { ...linha, convenios: semEste };
      }
      return {
        ...linha,
        convenios: [
          ...semEste,
          ajusteAoMarcar(professionalId, insuranceId, linhasNaAbertura, padrao),
        ].sort(
          (a, b) =>
            ordemDoConvenio(a.insuranceId) - ordemDoConvenio(b.insuranceId),
        ),
      };
    });

  const trocarAjuste = (professionalId: string, novo: AjusteDoConvenio) =>
    trocarLinha(professionalId, (linha) => ({
      ...linha,
      convenios: linha.convenios.map((ajuste) =>
        ajuste.insuranceId === novo.insuranceId ? novo : ajuste,
      ),
    }));

  return (
    <section
      aria-labelledby={ID_DO_TITULO}
      className="grid gap-3 border-t border-border pt-4"
    >
      <div className="grid gap-1">
        <h3
          id={ID_DO_TITULO}
          // Alvo de foco de reserva do Remover (nao entra na ordem do Tab).
          tabIndex={-1}
          className="text-sm font-bold text-text-strong"
        >
          Quem faz e convênios
        </h3>
        <p className="text-xs text-text-secondary">
          Preço e duração vêm do procedimento: Particular pelo preço base e
          convênio como Coberto. Personalize só o que for diferente para um
          profissional ou convênio. A chave &quot;IA pode agendar&quot; vale
          para todos.
        </p>
      </div>

      {linhas.length === 0 ? (
        <p className="rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-text-secondary">
          Ninguém faz este procedimento ainda. Sem isso, a agenda e a IA não
          conseguem marcar.
        </p>
      ) : (
        <ul className="grid gap-3">
          {linhas.map((linha) => {
            const profissional = nomes.profissional(linha.professionalId);
            const nome = nomes.nomeDoProfissional(linha.professionalId);
            const idLinha = `qf-${linha.professionalId}`;
            const marcados = new Set(
              linha.convenios.map((ajuste) => ajuste.insuranceId),
            );
            const opcoes: {
              id: string | null;
              nome: string;
              inativo: boolean;
            }[] = [
              { id: null, nome: PARTICULAR, inativo: false },
              ...conveniosParaMarcar(convenios, linha, linhasNaAbertura).map(
                (c) => ({ id: c.id, nome: c.name, inativo: !c.active }),
              ),
            ];
            return (
              <li key={linha.professionalId}>
                <div
                  role="group"
                  aria-labelledby={`${idLinha}-nome`}
                  className="grid gap-2 rounded-xl border border-border bg-card p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <AvatarDoProfissional
                      nome={nome}
                      cor={profissional?.calendar_color ?? null}
                    />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        id={`${idLinha}-nome`}
                        className="truncate text-[13.5px] font-bold text-text-strong"
                      >
                        {nome}
                      </span>
                      {profissional && !profissional.active ? (
                        <ChipSituacao active={false} />
                      ) : null}
                    </div>
                    <Button
                      id={idDoRemover(linha.professionalId)}
                      variant="ghost"
                      className="h-10 shrink-0"
                      onClick={() => remover(linha.professionalId)}
                      aria-label={`Remover ${nome} deste procedimento`}
                    >
                      <X aria-hidden /> Remover
                    </Button>
                  </div>
                  <fieldset className="grid">
                    <legend className="mb-0.5 text-xs font-semibold text-foreground">
                      Atende por
                    </legend>
                    <div className="flex flex-wrap gap-x-5">
                      {opcoes.map((opcao) => (
                        <label
                          key={opcao.id ?? "particular"}
                          className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13.5px] text-foreground"
                        >
                          <Checkbox
                            checked={marcados.has(opcao.id)}
                            onCheckedChange={(valor) =>
                              marcarConvenio(
                                linha.professionalId,
                                opcao.id,
                                valor === true,
                              )
                            }
                          />
                          <span>{opcao.nome}</span>
                          {opcao.inativo ? (
                            <ChipSituacao active={false} />
                          ) : null}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {linha.convenios.length === 0 ? (
                    <p className="text-xs text-warning-text">
                      Marque ao menos o Particular ou um convênio, ou remova{" "}
                      {nome} deste procedimento.
                    </p>
                  ) : (
                    <ul className="grid rounded-lg border border-border">
                      {linha.convenios.map((ajuste) => (
                        <LinhaDoConvenio
                          key={ajuste.insuranceId ?? "particular"}
                          ajuste={ajuste}
                          nomeDoProfissional={nome}
                          nomeDoConvenio={nomes.nomeDoConvenio(
                            ajuste.insuranceId,
                          )}
                          convenioInativo={
                            ajuste.insuranceId !== null &&
                            nomes.convenio(ajuste.insuranceId)?.active === false
                          }
                          padrao={padrao}
                          idBase={`${idLinha}-${ajuste.insuranceId ?? "particular"}`}
                          aoMudar={(novo) =>
                            trocarAjuste(linha.professionalId, novo)
                          }
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={ID_DO_ADICIONAR}>Adicionar quem faz</Label>
        <Select
          // Sempre vazio: escolher adiciona a linha e o campo volta ao
          // texto de ajuda, pronto para o proximo.
          value=""
          onValueChange={adicionar}
          disabled={disponiveis.length === 0}
        >
          <SelectTrigger
            id={ID_DO_ADICIONAR}
            className="w-full"
            aria-describedby={
              disponiveis.length === 0
                ? "proc-adicionar-profissional-dica"
                : undefined
            }
          >
            <SelectValue placeholder="Escolha o profissional" />
          </SelectTrigger>
          <SelectContent>
            {disponiveis.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {/* So o inativo que estava gravado quando o modal abriu
                    chega aqui; o selo mantem o status em 3 camadas. */}
                {p.active ? null : <ChipSituacao active={false} />}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {disponiveis.length === 0 ? (
          <p
            id="proc-adicionar-profissional-dica"
            className="text-xs text-text-secondary"
          >
            {temProfissionalAtivo
              ? "Todos os profissionais ativos já estão na lista."
              : "Cadastre os profissionais na aba Profissionais para dizer quem faz este procedimento."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// Modo leitura (recepcao, profissional, leitura em "Ver detalhes"): quem faz,
// por qual convenio, por quanto e em quanto tempo. E o que a recepcao
// responde ao paciente, entao mostra so o que a Agenda oferece hoje
// (profissional ativo; Particular ou convenio ativo), como a coluna "Quem
// faz" da tabela, e avisa numa nota quando algo ficou de fora.
function QuemFazSomenteLeitura({
  linhas,
  padrao,
  nomes,
  ativos,
}: {
  linhas: LinhaDoProfissional[];
  padrao: PadraoDoProcedimento;
  nomes: NomesDoCatalogo;
  ativos: { profissionais: string[]; convenios: string[] };
}) {
  const oferecidas = linhasQueAAgendaOferece(
    linhas,
    ativos.profissionais,
    ativos.convenios,
  );
  const nota = oferecidas.ocultos ? (
    <p className="text-xs text-text-secondary">
      Profissionais e convênios inativos não aparecem aqui, porque a Agenda não
      os oferece.
    </p>
  ) : null;
  if (oferecidas.linhas.length === 0) {
    return (
      <div className="grid gap-1 whitespace-normal">
        <span className="text-text-secondary">
          {oferecidas.ocultos
            ? "Nenhum profissional ativo faz este procedimento."
            : "Ninguém faz este procedimento ainda."}
        </span>
        {nota}
      </div>
    );
  }
  return (
    <div className="grid gap-3 whitespace-normal">
      <ul className="grid gap-3">
        {oferecidas.linhas.map((linha) => (
          <li key={linha.professionalId} className="grid gap-1">
            <span className="font-semibold text-text-strong">
              {nomes.nomeDoProfissional(linha.professionalId)}
            </span>
            <ul className="grid gap-1">
              {linha.convenios.map((ajuste) => {
                const valores = valoresDoAjuste(ajuste, padrao);
                return (
                  <li
                    key={ajuste.insuranceId ?? "particular"}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <span className="text-text-secondary">
                      {nomes.nomeDoConvenio(ajuste.insuranceId)}:
                    </span>
                    <PrecoDoVinculo
                      price_cents={valores.price_cents}
                      covered_by_insurance={valores.covered_by_insurance}
                    />
                    <span aria-hidden className="text-text-secondary">
                      ·
                    </span>
                    <Duracao minutos={valores.duration_min} />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {nota}
    </div>
  );
}

export function ProcedimentosTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormProcedimento>(FORM_VAZIO);
  // "Quem faz e convenios" do procedimento aberto (vinculos de tres pontas).
  const [linhas, setLinhas] = useState<LinhaDoProfissional[]>([]);
  // Como o procedimento estava quando o modal abriu (nulo no novo): diz o
  // que pode voltar na secao e se o Salvar precisa regravar os vinculos.
  const [abertura, setAbertura] = useState<EstadoDosVinculos | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Quem so ve Cadastros (recepcao, leitura, profissional) abre o mesmo
  // modal em modo leitura para consultar descricao, preparo e quem faz
  // (achado 41).
  const [somenteLeitura, setSomenteLeitura] = useState(false);

  const nomes = useMemo<NomesDoCatalogo>(() => {
    const profissionais = new Map(catalogo.profissionais.map((p) => [p.id, p]));
    const convenios = new Map(catalogo.convenios.map((c) => [c.id, c]));
    return {
      profissional: (id) => profissionais.get(id),
      convenio: (id) => convenios.get(id),
      nomeDoProfissional: (id) =>
        profissionais.get(id)?.name ?? "Profissional removido",
      nomeDoConvenio: (id) =>
        id === null
          ? PARTICULAR
          : (convenios.get(id)?.name ?? "Convênio removido"),
    };
  }, [catalogo.profissionais, catalogo.convenios]);

  // O que a Agenda oferece hoje: profissionais e convenios ativos, na ordem
  // do catalogo. Alimenta as colunas da tabela e o "Ver detalhes".
  const ativos = useMemo(
    () => ({
      profissionais: catalogo.profissionais
        .filter((p) => p.active)
        .map((p) => p.id),
      convenios: catalogo.convenios.filter((c) => c.active).map((c) => c.id),
    }),
    [catalogo.profissionais, catalogo.convenios],
  );

  // Colunas "Quem faz" e "Convênios": o que a Agenda oferece hoje (vinculo
  // ativo de profissional e convenio ativos).
  const resumos = useMemo(() => {
    const mapa = new Map<string, { quemFaz: string[]; convenios: string[] }>();
    for (const procedimento of catalogo.procedimentos) {
      const resumo = resumoDoProcedimento(
        catalogo.vinculos,
        procedimento.id,
        ativos.profissionais,
        ativos.convenios,
      );
      mapa.set(procedimento.id, {
        quemFaz: resumo.profissionais.map(nomes.nomeDoProfissional),
        convenios: resumo.convenios.map(nomes.nomeDoConvenio),
      });
    }
    return mapa;
  }, [catalogo.procedimentos, catalogo.vinculos, ativos, nomes]);

  const padrao = padraoDoFormulario(form);

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
            bookable_by_ai: procedimento.bookable_by_ai,
            active: procedimento.active,
          }
        : FORM_VAZIO,
    );
    if (procedimento) {
      const gravado = padraoGravado(procedimento);
      const iniciais = linhasDosVinculos(
        catalogo.vinculos,
        procedimento.id,
        gravado,
        catalogo.profissionais.map((p) => p.id),
        catalogo.convenios.map((c) => c.id),
      );
      setLinhas(iniciais);
      setAbertura({
        linhas: iniciais,
        padrao: gravado,
        iaPodeAgendar: procedimento.bookable_by_ai,
      });
    } else {
      setLinhas([]);
      setAbertura(null);
    }
    setAberto(true);
  };

  const salvar = async () => {
    const centavos = lerReais(form.preco_reais);
    if (centavos === undefined) {
      setErro("Informe o preço em reais, por exemplo 150,00, ou deixe vazio.");
      return;
    }
    const duracao = Number(form.default_duration_min);
    if (!Number.isInteger(duracao) || duracao < 5 || duracao > 600) {
      setErro("Informe a duração em minutos (entre 5 e 600).");
      return;
    }
    // Quem faz e convenios e conferido ANTES de gravar o procedimento: um
    // erro aqui nao deixa o procedimento salvo pela metade.
    const padraoAgora: PadraoDoProcedimento = {
      basePriceCents: centavos,
      durationMin: duracao,
    };
    const vinculos = vinculosDasLinhas(linhas, padraoAgora, {
      profissional: nomes.nomeDoProfissional,
      convenio: nomes.nomeDoConvenio,
    });
    if (!vinculos.ok) {
      setErro(vinculos.erro);
      return;
    }
    setSalvando(true);
    setErro(null);
    // resource_id fica fora de proposito: recursos sairam da tela e o
    // update nao toca a coluna (a trava do banco continua valendo).
    const resultado = await salvarProcedimentoAction({
      id: form.id,
      name: form.name,
      description: form.description.trim() || null,
      default_duration_min: duracao,
      base_price_cents: centavos,
      requires_evaluation: form.requires_evaluation,
      prep_instructions: form.prep_instructions.trim() || null,
      bookable_by_ai: form.bookable_by_ai,
      active: form.active,
    });
    if (!resultado.ok || !resultado.id) {
      setSalvando(false);
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    const procedureId = resultado.id;
    const criado = !form.id;
    // So regrava os vinculos quando algo de que eles dependem mudou: a lista
    // da tela vem do catalogo em cache e regravar sem mudanca desativaria o
    // que outro gestor acabou de incluir ou o que nao veio no catalogo.
    const sincronizar = precisaSincronizarVinculos(abertura, {
      linhas,
      padrao: padraoAgora,
      iaPodeAgendar: form.bookable_by_ai,
    });
    const sincronia = sincronizar
      ? await sincronizarVinculosDoProcedimentoAction(
          procedureId,
          vinculos.vinculos,
        )
      : null;
    setSalvando(false);
    if (sincronia && !sincronia.ok) {
      // O procedimento ja esta gravado: o proximo Salvar edita o mesmo, em
      // vez de criar outro igual.
      setForm((atual) => ({ ...atual, id: procedureId }));
      setErro(
        `O procedimento foi salvo, mas quem faz e os convênios não. ${
          sincronia.error ?? "Tente salvar de novo."
        }`,
      );
      aoMudar();
      return;
    }
    // Vinculo que saiu nao aparece mais para marcar: a recepcao precisa
    // saber, sobretudo quando ninguem pediu (catalogo parado ou cortado).
    const saiuDaAgenda = avisoDosVinculosDesativados(
      sincronia?.resumo?.desativados ?? 0,
    );
    toast.success(
      criado ? "Procedimento criado" : "Procedimento atualizado",
      saiuDaAgenda
        ? { description: saiuDaAgenda, duration: 10_000 }
        : undefined,
    );
    const consultas = sincronia?.resumo?.consultasFuturas ?? 0;
    if (consultas > 0) {
      // Tirar alguem ou um convenio nao desmarca nada (achado 37).
      toast.warning(
        consultas === 1
          ? "1 consulta já marcada continua valendo com quem saiu deste procedimento. Remarque ou cancele pela Agenda, se for o caso."
          : `${consultas} consultas já marcadas continuam valendo com quem saiu deste procedimento. Remarque ou cancele pela Agenda, se for o caso.`,
        { duration: 10_000 },
      );
    }
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
      id: "quem-faz",
      header: "Quem faz",
      cell: ({ row }) => {
        const quemFaz = resumos.get(row.original.id)?.quemFaz ?? [];
        if (quemFaz.length === 0) {
          return (
            <span className="whitespace-nowrap text-text-secondary">
              Ninguém definido
            </span>
          );
        }
        return (
          <span
            className="block max-w-[240px] truncate text-foreground"
            title={quemFaz.join(", ")}
          >
            {listaCurta(quemFaz, 2)}
          </span>
        );
      },
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
      id: "convenios",
      header: "Convênios",
      cell: ({ row }) => {
        const convenios = resumos.get(row.original.id)?.convenios ?? [];
        if (convenios.length === 0) {
          return <span className="text-text-secondary">Nenhum</span>;
        }
        return (
          <span
            className="block max-w-[240px] truncate text-text-secondary"
            title={convenios.join(", ")}
          >
            {listaCurta(convenios, 3)}
          </span>
        );
      },
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
        // Largo: a secao "Quem faz e convenios" tem uma linha por
        // profissional, com os convenios e as excecoes de cada um.
        larga
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
                rotulo: "Quem faz e convênios",
                valor: (
                  <QuemFazSomenteLeitura
                    linhas={linhas}
                    padrao={padrao}
                    nomes={nomes}
                    ativos={ativos}
                  />
                ),
              },
              {
                rotulo: "IA pode agendar",
                valor: (
                  <StatusChip
                    size="sm"
                    definition={
                      IA_AGENDA_STATUS[form.bookable_by_ai ? "sim" : "nao"]
                    }
                  />
                ),
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
          <CampoDeMarcar
            id="proc-ia"
            rotulo="IA pode agendar"
            descricao="O agente pode oferecer e agendar este procedimento, com todos os profissionais e convênios abaixo"
            marcado={form.bookable_by_ai}
            aoMudar={(marcado) => setForm({ ...form, bookable_by_ai: marcado })}
          />
          <CampoDeMarcar
            id="proc-ativo"
            rotulo="Procedimento ativo"
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
          {/* So monta no modo de edicao: no de leitura o resumo acima ja
              mostra quem faz, e os ids dos campos nao se repetem. */}
          {somenteLeitura ? null : (
            <QuemFazEConvenios
              linhas={linhas}
              linhasNaAbertura={abertura?.linhas ?? SEM_LINHAS}
              aoMudarLinhas={setLinhas}
              padrao={padrao}
              profissionais={catalogo.profissionais}
              convenios={catalogo.convenios}
              nomes={nomes}
            />
          )}
        </div>
      </PainelDeCadastro>
    </div>
  );
}
