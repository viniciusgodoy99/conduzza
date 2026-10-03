"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Plus, SlidersHorizontal, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  salvarProcedimentoAction,
  sincronizarVinculosDoProcedimentoAction,
  type CadastroActionResult,
  type ResultadoDosVinculosDoProcedimento,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  AvatarDoProfissional,
  AvisoDeConsultas,
  BotaoProtegido,
  COBERTO_PELO_CONVENIO,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  PreviaDeReais,
  useFocoDeVoltaAoSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { ListaDeConvenios } from "@/components/cadastros/lista-de-convenios";
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
import {
  listaFalada,
  ROTULO_SALVAR_MESMO_ASSIM,
} from "@/lib/domain/convenios-do-medico";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import {
  ajusteAoMarcar,
  avisoDosVinculosDesativados,
  contextoDosPlanos,
  conveniosParaMarcar,
  desmarcarPlano,
  extrasDaSincronizacao,
  FORA_DO_CADASTRO,
  linhaAoAdicionar,
  linhasDosVinculos,
  linhasQueAAgendaOferece,
  listaCurta,
  marcarPlano,
  NOTA_PLANO_EM_USO,
  personalizar,
  planosParaMarcar,
  planosQueCobremNaAbertura,
  precisaSincronizarVinculos,
  profissionaisParaAdicionar,
  resumoDoProcedimento,
  ROTULO_DOS_PLANOS,
  valoresDoAjuste,
  vinculosDasLinhas,
  voltarAoPadrao,
  type AberturaComPlanos,
  type AjusteDoConvenio,
  type ContextoDosPlanos,
  type EstadoDosVinculos,
  type LinhaDoProfissional,
  type ModoPreco,
  type PadraoDoProcedimento,
  type VinculoDesejado,
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
//
// Convenio pelo profissional (decisao do dono em 02/10/2026): acima de "Quem
// faz" fica "Convenios que cobrem este procedimento" (procedure_insurance,
// D1). Cada profissional mostra so os convenios que cobrem E que ele atende
// no cadastro dele (professional_insurance), ja marcados ao entrar;
// desmarcar no cartao dele e a excecao deste procedimento. O Particular
// continua sempre oferecido e desmarcavel por procedimento (D7). A regra de
// oferta e de pre-marcacao mora em lib/domain/vinculos-do-procedimento.ts;
// aqui fica a tela e a ordem de gravacao (gravarProcedimento, abaixo).

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
const SEM_PLANOS: readonly string[] = [];

// Ids da secao "Quem faz e convenios" (so existe uma no modal).
const ID_DO_TITULO = "proc-quem-faz-titulo";
const ID_DO_ADICIONAR = "proc-adicionar-profissional";
const idDoRemover = (professionalId: string) => `qf-${professionalId}-remover`;

// Alvos de foco do aviso de consultas (D4): o proprio aviso, quando ele
// entra no lugar do Salvar, e o Salvar do rodape, quando o aviso sai.
const ID_DO_AVISO = "proc-aviso-de-consultas";
const ID_DO_SALVAR = "proc-salvar";

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

// Limites do procedimentoSchema da action, conferidos antes de qualquer
// gravacao: na edicao quem faz e os convenios sao gravados ANTES da linha do
// procedimento, entao um campo recusado depois deixaria o Salvar pela metade.
const NOME_MINIMO = 2;
const PRECO_MAXIMO_CENTAVOS = 100_000_000;

const ERRO_GENERICO_DO_SALVAR = "Não foi possível salvar.";

/** Ajuda de "Convenios que cobrem este procedimento" (sem travessao) */
export const AJUDA_DOS_CONVENIOS_QUE_COBREM =
  "Quem faz este procedimento e atende o convênio no cadastro do profissional recebe o convênio já marcado, em Quem faz e convênios.";

/** D6: nenhum convenio para oferecer. So texto: trocar de aba fecha o modal */
export const VAZIO_DOS_CONVENIOS_QUE_COBREM =
  "Nenhum convênio ativo. Cadastre ou reative um na aba Convênios para marcar quais cobrem este procedimento.";

/** Nenhum convenio marcado em "cobrem": todos ficam so com o Particular */
export const SO_PARTICULAR =
  "Nenhum convênio marcado: este procedimento é só Particular.";

/** Ajuda de "Quem faz e convenios" (sem travessao) */
export const AJUDA_DE_QUEM_FAZ =
  'Cada profissional mostra os convênios que cobrem este procedimento e que ele atende no cadastro dele, já marcados. Desmarcar aqui vale só para este procedimento. Preço e duração vêm do procedimento: Particular pelo preço base e convênio como Coberto. Personalize só o que for diferente. A chave "IA pode agendar" vale para todos.';

/**
 * Titulo do aviso de consultas antes de gravar (D4): o Salvar tira do
 * procedimento uma combinacao de quem faz e convenio com consulta marcada.
 */
export function tituloDoAvisoDosVinculos(consultas: number): string {
  const marcadas =
    consultas === 1 ? "1 consulta marcada" : `${consultas} consultas marcadas`;
  return `Há ${marcadas} em combinações de quem faz e convênio que saem deste procedimento. Remarque ou cancele, se for o caso.`;
}

/**
 * Frase ao vivo de "cobrem" quando um convenio que estava marcado na
 * abertura e desmarcado: quem deixa de atender por ele aqui. null se
 * ninguem atendia por ele neste procedimento.
 */
export function fraseDoConvenioQueSai(
  convenio: string,
  profissionais: readonly string[],
): string | null {
  if (profissionais.length === 0) {
    return null;
  }
  const verbo = profissionais.length === 1 ? "deixa" : "deixam";
  return `Ao tirar ${convenio}, ${listaFalada(profissionais)} ${verbo} de atender por este convênio neste procedimento.`;
}

/**
 * Convenio que cobre mas o profissional nao atende no cadastro dele: a
 * tela explica no cartao por que ele nao aparece para marcar.
 */
export function fraseDeQuemNaoAtende(
  profissional: string,
  convenios: readonly string[],
): string | null {
  if (convenios.length === 0) {
    return null;
  }
  return `${profissional} não atende ${listaFalada(convenios)} no cadastro do profissional. Para incluir, marque em Convênios que atende, na aba Profissionais.`;
}

// ---------------------------------------------------------------------------
// Ordem de gravacao do Salvar (critica §3.4)
// ---------------------------------------------------------------------------
// EDITAR: a sincronia (RPC sincronizar_vinculos_do_procedimento no modo
// novo, com a trava otimista) vem ANTES da linha do procedimento, com
// confirmar false. Se ela tirar uma combinacao com consulta futura, nada e
// gravado e a tela mostra o aviso (D4); "Salvar mesmo assim" refaz com
// confirmar true. So entao a linha do procedimento e gravada (a action
// alinha a chave da IA nos vinculos). Assim cancelar o aviso nao deixa o
// preco base gravado com quem segue o padrao ainda no preco antigo.
// CRIAR: a linha primeiro (a RPC precisa do id), depois a sincronia, sem
// nada na abertura.
// Qualquer erro da sincronia recarrega o catalogo (aoMudar): o CZ409 da aba
// parada (D5) e o 23514 de quem nao atende pedem dados novos.

/** As actions que o Salvar usa (injetadas para o teste de unidade) */
export type AcoesDoSalvar = {
  salvarProcedimento: (input: unknown) => Promise<CadastroActionResult>;
  sincronizar: (
    procedureId: unknown,
    linhas: unknown,
    extras?: unknown,
  ) => Promise<ResultadoDosVinculosDoProcedimento>;
};

/** Os campos que vao para salvarProcedimentoAction, sem o id */
export type CamposDoProcedimento = {
  name: string;
  description: string | null;
  default_duration_min: number;
  base_price_cents: number | null;
  requires_evaluation: boolean;
  prep_instructions: string | null;
  bookable_by_ai: boolean;
  active: boolean;
};

export type PedidoDeSalvar = {
  /** Procedimento ja gravado (editar); ausente ao criar */
  id?: string;
  campos: CamposDoProcedimento;
  /** As linhas da tela com valor concreto (vinculosDasLinhas, ja conferidas) */
  vinculos: VinculoDesejado[];
  /** A tela agora: linhas, padrao do formulario, chave da IA e "cobrem" */
  agora: EstadoDosVinculos & { planos: readonly string[] };
  /** Retrato da abertura; nulo no procedimento novo */
  abertura: AberturaComPlanos | null;
  /** A pessoa confirmou o aviso de consultas ("Salvar mesmo assim") */
  confirmar: boolean;
};

export type DesfechoDoSalvar =
  | {
      tipo: "salvo";
      id: string;
      criado: boolean;
      /** Combinacoes que sairam da agenda (vinculos desativados) */
      desativados: number;
      consultasFuturas: number;
    }
  | {
      /** Nada foi gravado: mostrar o aviso e reenviar com confirmar */
      tipo: "aviso";
      consultas: number;
      primeira: string | null;
    }
  | {
      tipo: "erro";
      erro: string;
      /** A linha do procedimento ja existe: o formulario guarda o id */
      id?: string;
      /** Chamar aoMudar (o catalogo e a matriz podem estar parados) */
      recarregar: boolean;
      /**
       * A sincronia ja gravou: a nova abertura e o que esta no banco agora,
       * para o proximo Salvar nao reenviar a abertura velha (daria CZ409).
       */
      abertura?: AberturaComPlanos;
    };

/** O que fica gravado depois de uma sincronia aplicada */
function aberturaDepoisDaSincronia(
  agora: PedidoDeSalvar["agora"],
): AberturaComPlanos {
  return {
    linhas: agora.linhas,
    padrao: agora.padrao,
    iaPodeAgendar: agora.iaPodeAgendar,
    planos: [...agora.planos],
    // Com a sincronia aplicada, procedure_insurance = planos (sem cura).
    planosGravados: [...agora.planos],
  };
}

export async function gravarProcedimento(
  pedido: PedidoDeSalvar,
  acoes: AcoesDoSalvar,
): Promise<DesfechoDoSalvar> {
  const { id, campos, vinculos, agora, abertura, confirmar } = pedido;

  if (!id) {
    const criado = await acoes.salvarProcedimento(campos);
    if (criado.parcial && criado.id) {
      return {
        tipo: "erro",
        erro: criado.error ?? ERRO_GENERICO_DO_SALVAR,
        id: criado.id,
        recarregar: true,
      };
    }
    if (!criado.ok || !criado.id) {
      return {
        tipo: "erro",
        erro: criado.error ?? ERRO_GENERICO_DO_SALVAR,
        recarregar: false,
      };
    }
    const novoId = criado.id;
    const sincronia = await acoes.sincronizar(
      novoId,
      vinculos,
      extrasDaSincronizacao(null, agora.planos, false),
    );
    if (!sincronia.ok) {
      return {
        tipo: "erro",
        erro: `O procedimento foi salvo, mas quem faz e os convênios não. ${
          sincronia.error ?? "Tente salvar de novo."
        }`,
        id: novoId,
        recarregar: true,
      };
    }
    return {
      tipo: "salvo",
      id: novoId,
      criado: true,
      desativados: sincronia.resumo?.desativados ?? 0,
      consultasFuturas: sincronia.resumo?.consultasFuturas ?? 0,
    };
  }

  // So regrava os vinculos quando algo de que eles dependem mudou: a lista
  // da tela vem do catalogo em cache e regravar sem mudanca desativaria o
  // que outro gestor acabou de incluir (a trava otimista recusaria, mas sem
  // motivo para quem nao mexeu em nada).
  let sincronia: ResultadoDosVinculosDoProcedimento | null = null;
  let novaAbertura: AberturaComPlanos | undefined;
  if (precisaSincronizarVinculos(abertura, agora)) {
    sincronia = await acoes.sincronizar(
      id,
      vinculos,
      extrasDaSincronizacao(abertura, agora.planos, confirmar),
    );
    if (!sincronia.ok) {
      if (
        sincronia.code === "consultas_no_periodo" &&
        sincronia.motivo === "vinculos"
      ) {
        return {
          tipo: "aviso",
          consultas: sincronia.consultas ?? 0,
          primeira: sincronia.primeiraConsulta ?? null,
        };
      }
      return {
        tipo: "erro",
        erro:
          sincronia.error ?? "Não foi possível salvar quem faz e os convênios.",
        recarregar: true,
      };
    }
    novaAbertura = aberturaDepoisDaSincronia(agora);
  }

  const resultado = await acoes.salvarProcedimento({ id, ...campos });
  if (resultado.parcial && resultado.id) {
    return {
      tipo: "erro",
      erro: resultado.error ?? ERRO_GENERICO_DO_SALVAR,
      id: resultado.id,
      recarregar: true,
      abertura: novaAbertura,
    };
  }
  if (!resultado.ok) {
    if (novaAbertura) {
      const detalhe =
        resultado.error && resultado.error !== ERRO_GENERICO_DO_SALVAR
          ? ` ${resultado.error}`
          : "";
      return {
        tipo: "erro",
        erro: `Quem faz e os convênios foram salvos, mas os dados do procedimento não.${detalhe} Clique em Salvar de novo.`,
        recarregar: true,
        abertura: novaAbertura,
      };
    }
    return {
      tipo: "erro",
      erro: resultado.error ?? ERRO_GENERICO_DO_SALVAR,
      recarregar: false,
    };
  }
  return {
    tipo: "salvo",
    id,
    criado: false,
    desativados: sincronia?.resumo?.desativados ?? 0,
    consultasFuturas: sincronia?.resumo?.consultasFuturas ?? 0,
  };
}

const ACOES_DO_SALVAR: AcoesDoSalvar = {
  salvarProcedimento: salvarProcedimentoAction,
  sincronizar: sincronizarVinculosDoProcedimentoAction,
};

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

// Secao "Convenios que cobrem este procedimento" (D1), acima de "Quem faz".
// Abre com procedure_insurance mais os convenios em uso num vinculo ativo do
// procedimento (a cura, com NOTA_PLANO_EM_USO): sem isso o Salvar seria
// recusado. Marcar entra para quem faz e atende o convenio; desmarcar tira
// de todos. Marcar de novo o que estava marcado na abertura volta cada
// profissional como estava (a excecao continua excecao): marcarPlano.
function ConveniosQueCobrem({
  convenios,
  planos,
  marcadosNaAbertura,
  soDoVinculo,
  linhasNaAbertura,
  nomes,
  aoMudar,
}: {
  convenios: Convenio[];
  planos: readonly string[];
  /** "Cobrem" na abertura, com a cura (vazio no procedimento novo) */
  marcadosNaAbertura: readonly string[];
  /** Marcados na abertura so porque um vinculo ativo usa */
  soDoVinculo: readonly string[];
  linhasNaAbertura: readonly LinhaDoProfissional[];
  nomes: NomesDoCatalogo;
  aoMudar: (insuranceId: string, marcado: boolean) => void;
}) {
  const marcados = new Set(planos);
  const emUso = new Set(soDoVinculo);
  const opcoes = planosParaMarcar(convenios, planos, marcadosNaAbertura).map(
    (c) => ({
      id: c.id,
      nome: c.name,
      plano: c.plan_name,
      inativo: !c.active,
      // A nota explica por que veio marcado; desmarcado, ela nao vale mais.
      nota:
        emUso.has(c.id) && marcados.has(c.id) ? NOTA_PLANO_EM_USO : undefined,
    }),
  );
  // Quem deixa de atender por um convenio que estava marcado na abertura.
  const frasesDosQueSaem = marcadosNaAbertura
    .filter((id) => !marcados.has(id))
    .map((id) =>
      fraseDoConvenioQueSai(
        nomes.nomeDoConvenio(id),
        linhasNaAbertura
          .filter((linha) =>
            linha.convenios.some((ajuste) => ajuste.insuranceId === id),
          )
          .map((linha) => nomes.nomeDoProfissional(linha.professionalId)),
      ),
    )
    .filter((frase): frase is string => frase !== null);
  const soParticular = opcoes.length > 0 && planos.length === 0;

  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <ListaDeConvenios
        legenda={ROTULO_DOS_PLANOS}
        ajuda={AJUDA_DOS_CONVENIOS_QUE_COBREM}
        opcoes={opcoes}
        marcados={marcados}
        aoMudar={aoMudar}
        vazio={VAZIO_DOS_CONVENIOS_QUE_COBREM}
      />
      {/* Sempre montada (vazia ou nao), para o leitor de tela anunciar o
          que muda ao marcar e desmarcar. */}
      <div aria-live="polite" className="grid gap-1">
        {soParticular ? (
          <p className="text-xs text-text-secondary">{SO_PARTICULAR}</p>
        ) : null}
        {frasesDosQueSaem.map((frase) => (
          <p key={frase} className="text-xs text-text-secondary">
            {frase}
          </p>
        ))}
      </div>
    </div>
  );
}

// Secao "Quem faz e convenios" do modal (caso do Dr. Joao, spec 3.5): uma
// linha por profissional que faz o procedimento e, em cada uma, os convenios
// que ELE aceita neste procedimento. Particular e sempre uma opcao (nao e um
// convenio cadastrado). Os convenios oferecidos sao os que cobrem agora e que
// ele atende no cadastro dele (`contexto`); o marcado ou gravado fora do
// cadastro dele continua, com FORA_DO_CADASTRO, para o proximo Salvar nao
// desativar o vinculo sem ninguem pedir. O convenio inativo so aparece onde
// ja estava marcado ou gravado quando o modal abriu. O profissional inativo
// removido volta pelo "Adicionar quem faz", com os convenios e valores
// gravados (`linhasNaAbertura`), so com o que cobre agora.
function QuemFazEConvenios({
  linhas,
  linhasNaAbertura,
  aoMudarLinhas,
  padrao,
  profissionais,
  convenios,
  contexto,
  nomes,
}: {
  linhas: LinhaDoProfissional[];
  /** As linhas gravadas quando o modal abriu (vazio no procedimento novo) */
  linhasNaAbertura: readonly LinhaDoProfissional[];
  aoMudarLinhas: (linhas: LinhaDoProfissional[]) => void;
  padrao: PadraoDoProcedimento;
  profissionais: Profissional[];
  convenios: Convenio[];
  /** O que cobre agora e quem atende o que (contextoDosPlanos) */
  contexto: ContextoDosPlanos;
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
    // Novo entra com Particular e os convenios que atende e que cobrem
    // agora, tudo pelo padrao; quem estava gravado quando o modal abriu
    // volta como estava, so com o que cobre agora.
    aoMudarLinhas([
      ...linhas,
      linhaAoAdicionar(professionalId, linhasNaAbertura, padrao, contexto),
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
        <p className="text-xs text-text-secondary">{AJUDA_DE_QUEM_FAZ}</p>
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
            const doCadastro = conveniosParaMarcar(
              convenios,
              linha,
              linhasNaAbertura,
              contexto,
            );
            const opcoes: {
              id: string | null;
              nome: string;
              inativo: boolean;
              foraDoCadastro: boolean;
            }[] = [
              // D7: o Particular e sempre uma opcao, desmarcavel aqui.
              {
                id: null,
                nome: PARTICULAR,
                inativo: false,
                foraDoCadastro: false,
              },
              ...doCadastro.map(({ convenio, foraDoCadastro }) => ({
                id: convenio.id,
                nome: convenio.name,
                inativo: !convenio.active,
                foraDoCadastro,
              })),
            ];
            // Cobre, esta ativo e ele nao atende: explica por que nao
            // aparece para marcar (muda no cadastro do profissional).
            const oferecidos = new Set(doCadastro.map((o) => o.convenio.id));
            const atende = contexto.atende(linha.professionalId);
            const naoAtende = fraseDeQuemNaoAtende(
              nome,
              convenios
                .filter(
                  (c) =>
                    contexto.cobre.has(c.id) &&
                    c.active &&
                    !atende.has(c.id) &&
                    !oferecidos.has(c.id),
                )
                .map((c) => c.name),
            );
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
                      {opcoes.map((opcao) => {
                        const chave = opcao.id ?? "particular";
                        const idDoFora = `${idLinha}-${chave}-fora`;
                        return (
                          <div
                            key={chave}
                            className="flex flex-wrap items-center gap-x-2"
                          >
                            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13.5px] text-foreground">
                              <Checkbox
                                checked={marcados.has(opcao.id)}
                                onCheckedChange={(valor) =>
                                  marcarConvenio(
                                    linha.professionalId,
                                    opcao.id,
                                    valor === true,
                                  )
                                }
                                aria-describedby={
                                  opcao.foraDoCadastro ? idDoFora : undefined
                                }
                              />
                              <span>{opcao.nome}</span>
                              {opcao.inativo ? (
                                <ChipSituacao active={false} />
                              ) : null}
                            </label>
                            {/* Fora do rotulo, para o nome da caixa
                                continuar so o convenio; ligado a ela por
                                aria-describedby. Texto, nunca so cor. */}
                            {opcao.foraDoCadastro ? (
                              <span
                                id={idDoFora}
                                className="text-xs text-warning-text"
                              >
                                {FORA_DO_CADASTRO}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                  {naoAtende ? (
                    <p className="text-xs text-text-secondary">{naoAtende}</p>
                  ) : null}
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

// Modo leitura de "Convenios que cobrem": so os ativos (o que a Agenda
// oferece), como em QuemFazSomenteLeitura, com nota se algum ficou de fora.
function CobremSomenteLeitura({
  planos,
  nomes,
}: {
  planos: readonly string[];
  nomes: NomesDoCatalogo;
}) {
  const ativos = planos.filter((id) => nomes.convenio(id)?.active === true);
  const nota =
    ativos.length !== planos.length ? (
      <p className="text-xs text-text-secondary">
        Convênios inativos não aparecem aqui, porque a Agenda não os oferece.
      </p>
    ) : null;
  return (
    <div className="grid gap-1 whitespace-normal">
      {ativos.length === 0 ? (
        <span className="text-text-secondary">
          Nenhum convênio cobre: este procedimento é só Particular.
        </span>
      ) : (
        <span>{ativos.map(nomes.nomeDoConvenio).join(", ")}</span>
      )}
      {nota}
    </div>
  );
}

export function ProcedimentosTab({
  catalogo,
  matriz,
  podeEditar,
  dica,
  aoMudar,
  timezone,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormProcedimento>(FORM_VAZIO);
  // "Quem faz e convenios" do procedimento aberto (vinculos de tres pontas).
  const [linhas, setLinhasDaTela] = useState<LinhaDoProfissional[]>([]);
  // "Convenios que cobrem este procedimento" marcados agora.
  const [planos, setPlanosDaTela] = useState<string[]>([]);
  // Os marcados na abertura so porque um vinculo ativo usa (a cura).
  const [soDoVinculo, setSoDoVinculo] = useState<string[]>([]);
  // Como o procedimento estava quando o modal abriu (nulo no novo): diz o
  // que pode voltar nas secoes, se o Salvar precisa regravar os vinculos e o
  // que vai para a trava otimista da RPC (nunca o catalogo de agora).
  const [abertura, setAbertura] = useState<AberturaComPlanos | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Consultas futuras em combinacoes que saem (D4): nada foi gravado e o
  // Salvar espera "Salvar mesmo assim".
  const [aviso, setAviso] = useState<{
    consultas: number;
    primeira: string | null;
  } | null>(null);
  // Foco do teclado com o aviso: ele entra no lugar do Salvar, que sai com o
  // foco, e o FocusScope do Radix jogaria o foco para o topo do modal, a
  // dezenas de Tabs da confirmacao. O AvisoDeConsultas recebe o foco ao
  // aparecer (#proc-aviso-de-consultas, fora da ordem do Tab): o proximo Tab
  // cai em "Abrir a Agenda" e o seguinte em "Salvar mesmo assim", e um Enter
  // repetido nao confirma nada sem leitura. Quando o "Salvar mesmo assim"
  // termina em erro e o aviso sai, o foco volta para o Salvar do rodape.
  const focoDeVolta = useFocoDeVoltaAoSalvar(ID_DO_SALVAR, {
    avisoAberto: aviso !== null,
    salvando,
  });
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

  // Quem atende o que (matriz de agora) e o que cobre na tela agora. A
  // abertura so entra pelo que cobria (o desfazer seguro).
  const marcadosNaAbertura = abertura?.planos;
  const contexto = useMemo(
    () =>
      contextoDosPlanos({
        planos,
        marcadosNaAbertura,
        atendimentos: matriz.atendimentos,
        convenios: catalogo.convenios,
      }),
    [planos, marcadosNaAbertura, matriz.atendimentos, catalogo.convenios],
  );

  const linhasNaAbertura = abertura?.linhas ?? SEM_LINHAS;

  // Mexeu em quem faz ou em "cobrem": a confirmacao pedida no aviso era
  // para outra lista e nao vale mais.
  const mudarLinhas = (proximas: LinhaDoProfissional[]) => {
    setAviso(null);
    setLinhasDaTela(proximas);
  };

  const mudarPlano = (insuranceId: string, marcado: boolean) => {
    const atual = { planos, linhas };
    const proxima = marcado
      ? marcarPlano(atual, insuranceId, contexto, linhasNaAbertura, padrao)
      : desmarcarPlano(atual, insuranceId);
    setAviso(null);
    setPlanosDaTela(proxima.planos);
    setLinhasDaTela(proxima.linhas);
  };

  const abrir = (procedimento?: Procedimento, leitura = false) => {
    setErro(null);
    setAviso(null);
    focoDeVolta.esquecer();
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
      const ordemDosConvenios = catalogo.convenios.map((c) => c.id);
      const iniciais = linhasDosVinculos(
        catalogo.vinculos,
        procedimento.id,
        gravado,
        catalogo.profissionais.map((p) => p.id),
        ordemDosConvenios,
      );
      // "Cobrem" com a cura: procedure_insurance mais os convenios dos
      // vinculos ativos. Os gravados crus vao para a trava otimista.
      const cobrem = planosQueCobremNaAbertura(
        procedimento.id,
        matriz.coberturas,
        catalogo.vinculos,
        ordemDosConvenios,
      );
      setLinhasDaTela(iniciais);
      setPlanosDaTela(cobrem.marcados);
      setSoDoVinculo(cobrem.soDoVinculo);
      setAbertura({
        linhas: iniciais,
        padrao: gravado,
        iaPodeAgendar: procedimento.bookable_by_ai,
        planos: cobrem.marcados,
        planosGravados: cobrem.gravados,
      });
    } else {
      setLinhasDaTela([]);
      setPlanosDaTela([]);
      setSoDoVinculo([]);
      setAbertura(null);
    }
    setAberto(true);
  };

  // Ordem de gravacao em gravarProcedimento (critica §3.4). `confirmar` vem
  // do "Salvar mesmo assim" do aviso de consultas (D4).
  const salvar = async (opcoes: { confirmar?: boolean } = {}) => {
    const confirmar = opcoes.confirmar === true;
    // Veio do "Salvar mesmo assim" e o aviso vai sair com o botao que tinha o
    // foco: o foco volta para o Salvar do rodape.
    const devolverFocoAoSalvar = () => {
      if (confirmar) {
        focoDeVolta.devolver();
      }
    };
    // Erro de formulario: nada foi gravado; o aviso (se havia) sai para o
    // rodape voltar a ter o Salvar.
    const recusar = (mensagem: string) => {
      devolverFocoAoSalvar();
      setAviso(null);
      setErro(mensagem);
    };
    if (form.name.trim().length < NOME_MINIMO) {
      recusar("Informe o nome do procedimento.");
      return;
    }
    const centavos = lerReais(form.preco_reais);
    if (centavos === undefined) {
      recusar("Informe o preço em reais, por exemplo 150,00, ou deixe vazio.");
      return;
    }
    if (centavos !== null && centavos > PRECO_MAXIMO_CENTAVOS) {
      recusar("Informe um preço de até R$ 1.000.000,00.");
      return;
    }
    const duracao = Number(form.default_duration_min);
    if (!Number.isInteger(duracao) || duracao < 5 || duracao > 600) {
      recusar("Informe a duração em minutos (entre 5 e 600).");
      return;
    }
    // Quem faz e convenios e conferido ANTES de gravar qualquer coisa: um
    // erro aqui nao deixa o procedimento salvo pela metade. Com `planos`,
    // recusa o convenio marcado para alguem e que nao cobre (a RPC daria
    // 23514).
    const padraoAgora: PadraoDoProcedimento = {
      basePriceCents: centavos,
      durationMin: duracao,
    };
    const vinculos = vinculosDasLinhas(
      linhas,
      padraoAgora,
      {
        profissional: nomes.nomeDoProfissional,
        convenio: nomes.nomeDoConvenio,
      },
      planos,
    );
    if (!vinculos.ok) {
      recusar(vinculos.erro);
      return;
    }
    setSalvando(true);
    setErro(null);
    const desfecho = await gravarProcedimento(
      {
        id: form.id,
        // resource_id fica fora de proposito: recursos sairam da tela e o
        // update nao toca a coluna (a trava do banco continua valendo).
        campos: {
          name: form.name,
          description: form.description.trim() || null,
          default_duration_min: duracao,
          base_price_cents: centavos,
          requires_evaluation: form.requires_evaluation,
          prep_instructions: form.prep_instructions.trim() || null,
          bookable_by_ai: form.bookable_by_ai,
          active: form.active,
        },
        vinculos: vinculos.vinculos,
        agora: {
          linhas,
          padrao: padraoAgora,
          iaPodeAgendar: form.bookable_by_ai,
          planos,
        },
        abertura,
        confirmar,
      },
      ACOES_DO_SALVAR,
    );
    setSalvando(false);

    if (desfecho.tipo === "aviso") {
      setAviso({ consultas: desfecho.consultas, primeira: desfecho.primeira });
      return;
    }
    if (desfecho.tipo === "erro") {
      devolverFocoAoSalvar();
      setAviso(null);
      const idGravado = desfecho.id;
      if (idGravado) {
        // A linha ja existe: o proximo Salvar edita a mesma, em vez de
        // criar outra igual.
        setForm((atual) => ({ ...atual, id: idGravado }));
      }
      if (desfecho.abertura) {
        // Quem faz e "cobrem" ja estao no banco como na tela: o proximo
        // Salvar parte daqui (a abertura velha daria CZ409).
        setAbertura(desfecho.abertura);
        setSoDoVinculo([]);
      }
      setErro(desfecho.erro);
      if (desfecho.recarregar) {
        aoMudar();
      }
      return;
    }

    // Vinculo que saiu nao aparece mais para marcar: a recepcao precisa
    // saber, sobretudo quando ninguem pediu.
    const saiuDaAgenda = avisoDosVinculosDesativados(desfecho.desativados);
    toast.success(
      desfecho.criado ? "Procedimento criado" : "Procedimento atualizado",
      saiuDaAgenda
        ? { description: saiuDaAgenda, duration: 10_000 }
        : undefined,
    );
    // Reserva: o aviso antes de gravar (D4) ja cobre quem confirmou.
    if (!confirmar && desfecho.consultasFuturas > 0) {
      const consultas = desfecho.consultasFuturas;
      toast.warning(
        consultas === 1
          ? "1 consulta já marcada continua valendo com quem saiu deste procedimento. Remarque ou cancele pela Agenda, se for o caso."
          : `${consultas} consultas já marcadas continuam valendo com quem saiu deste procedimento. Remarque ou cancele pela Agenda, se for o caso.`,
        { duration: 10_000 },
      );
    }
    setAviso(null);
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
        aviso={
          somenteLeitura || !aviso ? null : (
            // O aviso recebe o foco quando entra (fora da ordem do Tab).
            <AvisoDeConsultas
              id={ID_DO_AVISO}
              consultas={aviso.consultas}
              primeira={aviso.primeira}
              timezone={timezone}
              titulo={tituloDoAvisoDosVinculos(aviso.consultas)}
              rotuloConfirmar={ROTULO_SALVAR_MESMO_ASSIM}
              confirmando={salvando}
              aoConfirmar={() => void salvar({ confirmar: true })}
            />
          )
        }
        rodape={
          somenteLeitura ? undefined : (
            // O RodapeDeSalvar de sempre, aberto aqui: com o aviso, quem
            // confirma e ele e o rodape fica so com Cancelar (que nao muda de
            // lugar na arvore); o Salvar tem id para o foco voltar a ele.
            <>
              <Button variant="ghost" onClick={fechar}>
                Cancelar
              </Button>
              {aviso ? null : (
                <Button
                  id={ID_DO_SALVAR}
                  onClick={() => void salvar()}
                  disabled={salvando}
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </Button>
              )}
            </>
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
                rotulo: ROTULO_DOS_PLANOS,
                valor: <CobremSomenteLeitura planos={planos} nomes={nomes} />,
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
              maxLength={120}
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
              maxLength={2000}
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
              maxLength={4000}
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
          {/* So montam no modo de edicao: no de leitura o resumo acima ja
              mostra o que cobre e quem faz, e os ids dos campos nao se
              repetem. */}
          {somenteLeitura ? null : (
            <>
              <ConveniosQueCobrem
                convenios={catalogo.convenios}
                planos={planos}
                marcadosNaAbertura={abertura?.planos ?? SEM_PLANOS}
                soDoVinculo={soDoVinculo}
                linhasNaAbertura={linhasNaAbertura}
                nomes={nomes}
                aoMudar={mudarPlano}
              />
              <QuemFazEConvenios
                linhas={linhas}
                linhasNaAbertura={linhasNaAbertura}
                aoMudarLinhas={mudarLinhas}
                padrao={padrao}
                profissionais={catalogo.profissionais}
                convenios={catalogo.convenios}
                contexto={contexto}
                nomes={nomes}
              />
            </>
          )}
        </div>
      </PainelDeCadastro>
    </div>
  );
}
