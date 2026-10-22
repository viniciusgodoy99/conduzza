"use client";

import { Check, Workflow } from "lucide-react";

import { contarLeads } from "@/components/leads/em-lotes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import { opcoesDaEtapa } from "@/lib/domain/reguas-de-followup";
import type { ReguaDaEtapa } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Mudar a etapa pelas tres portas da lista de Leads: a barra em massa, a
// linha da lista e a gaveta (pedido do dono em 20/10/2026: "nao consigo
// alterar a etapa ... por aqui, era pra eu conseguir"). As tres seguem as
// MESMAS regras, que moram aqui e nao se copiam:
// - Perdido (pelo PAPEL da etapa: a clinica pode ter renomeado) abre o
//   motivo da perda, a unica porta para Perdido;
// - etapa com regua de follow-up ligada, ou sem como saber (as reguas nao
//   carregaram), pede confirmacao dizendo quem passa a receber a regua;
// - sem regua, move direto.
// Desde a onda 4 (reguas por etiqueta) a etapa pode ter varias reguas
// ligadas, e cada lead recebe UMA, a que vale para as etiquetas dele (no
// lead ou na conversa; a escolha e do banco). Com a regua geral sozinha, o
// texto de antes; com varias (ou so com etiqueta), a confirmacao diz que
// cada lead recebe a que vale para as etiquetas dele, e quais sao.
// A lista das etapas (icone, nome e tom, e a marca de Regua) e o dialogo de
// confirmacao tambem sao um so. Na linha e na gaveta a etapa atual vem
// marcada e os textos falam de um lead so; na barra, nada mudou.

/** Item de lista dentro do popover, na casca do item de menu do DS (40px). */
export const ITEM_DO_POPOVER =
  "flex min-h-10 w-full items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] font-medium text-foreground outline-none cz-transition hover:bg-accent hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45";

/** O que escolher uma etapa faz, antes de qualquer gravacao. */
export type DecisaoDeEtapa =
  | { tipo: "pedir_motivo" }
  | {
      tipo: "confirmar";
      /** O nome da regua ligada (ou os nomes); null: nao deu para conferir */
      regua: string | null;
      /**
       * As reguas ligadas da etapa, na ordem, quando nao e so a geral (onda
       * 4): cada lead recebe a que vale para as etiquetas dele.
       */
      reguas?: readonly ReguaDaEtapa[];
    }
  | { tipo: "mover" };

/** A regua geral (sem etiqueta), a de antes da onda 4 inclusive. */
function ehGeral(regua: ReguaDaEtapa): boolean {
  return (regua.etiquetas ?? []).length === 0;
}

/** "A", "A e B", "A, B e C". */
function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) {
    return nomes[0] ?? "";
  }
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * As reguas de follow-up ligadas de cada etapa, na ordem que chegaram (a da
 * precedencia, fetchReguasDeFollowup). Desde a onda 4, uma LISTA por etapa.
 */
export function reguasPorEtapa(
  reguas: readonly ReguaDaEtapa[] | null,
): Map<string, ReguaDaEtapa[]> {
  const mapa = new Map<string, ReguaDaEtapa[]>();
  for (const regua of reguas ?? []) {
    const lista = mapa.get(regua.etapa) ?? [];
    lista.push(regua);
    mapa.set(regua.etapa, lista);
  }
  return mapa;
}

/** Os nomes das reguas de uma etapa numa frase: "A" ou "A e B". */
export function nomesDasReguas(reguas: readonly ReguaDaEtapa[]): string {
  return listaDeNomes(reguas.map((regua) => regua.nome));
}

/**
 * As regras da mudanca de etapa, para um lead ou para a selecao. Pura: quem
 * chama abre o motivo, a confirmacao ou grava.
 */
export function decidirMudancaDeEtapa(
  etapa: Pick<EtapaDaJornada, "chave" | "papel">,
  reguas: readonly ReguaDaEtapa[] | null,
): DecisaoDeEtapa {
  if (etapa.papel === "perdido") {
    return { tipo: "pedir_motivo" };
  }
  // Sem como saber: confirma antes, dizendo que nao deu para conferir.
  if (reguas === null) {
    return { tipo: "confirmar", regua: null };
  }
  // Etapa com regua: confirma antes, dizendo quem passa a receber
  // mensagem. Sem regua, move direto, como sempre.
  const daEtapa = reguasPorEtapa(reguas).get(etapa.chave) ?? [];
  if (daEtapa.length === 0) {
    return { tipo: "mover" };
  }
  const [unica] = daEtapa;
  if (daEtapa.length === 1 && unica && ehGeral(unica)) {
    return { tipo: "confirmar", regua: unica.nome };
  }
  return {
    tipo: "confirmar",
    regua: nomesDasReguas(daEtapa),
    reguas: daEtapa,
  };
}

/**
 * A lista das etapas da jornada dentro do popover. Sem hook: quem abre o
 * popover guarda o estado, e o teste acha o onClick na arvore.
 */
export function OpcoesDeEtapa({
  jornada,
  reguas,
  etapaAtual,
  aoEscolher,
}: {
  jornada: readonly EtapaDaJornada[];
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: readonly ReguaDaEtapa[] | null;
  /**
   * A etapa do lead, na linha e na gaveta: vem marcada (aria-current e o
   * check) e os textos falam de um lead so. A barra em massa nao passa.
   */
  etapaAtual?: string;
  aoEscolher: (etapa: EtapaDaJornada) => void;
}) {
  const reguaPorEtapa = reguasPorEtapa(reguas);
  return (
    <div className="grid">
      {jornada.map((def) => {
        const definicao = definicaoDaEtapa(def);
        const tone = STATUS_TONE_VARS[definicao.tone];
        const Icone = definicao.icon;
        const daEtapa = reguaPorEtapa.get(def.chave);
        const regua = daEtapa ? nomesDasReguas(daEtapa) : undefined;
        const atual = def.chave === etapaAtual;
        return (
          <button
            key={def.chave}
            type="button"
            className={ITEM_DO_POPOVER}
            aria-current={atual ? "true" : undefined}
            onClick={() => aoEscolher(def)}
          >
            {Icone ? (
              <Icone
                className="size-[15px] shrink-0"
                style={{ color: tone.text }}
                aria-hidden
              />
            ) : null}
            <span className="truncate">{definicao.label}</span>
            {regua !== undefined ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-text-secondary">
                <Workflow className="size-3" aria-hidden />
                Régua
                <span className="sr-only">
                  {(daEtapa?.length ?? 0) > 1
                    ? ` de follow-up: ${daEtapa?.length} ligadas, ${regua}`
                    : ` de follow-up ligada: ${regua}`}
                </span>
              </span>
            ) : null}
            {atual ? (
              <Check
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 text-primary-text",
                  regua === undefined && "ml-auto",
                )}
              />
            ) : null}
          </button>
        );
      })}
      <p className="border-t border-border px-[9px] pt-2 pb-1 text-[11px] leading-[1.4] text-text-secondary">
        {reguas === null
          ? "Não foi possível conferir as réguas de follow-up. Antes de mover, a tela pede confirmação."
          : reguaPorEtapa.size > 0
            ? "Etapa com Régua manda mensagens automáticas para quem tem autorização."
            : "Nenhuma etapa tem régua de follow-up ligada."}
      </p>
      {/* Automacoes de fluxo (02/10/2026): o gatilho "entrou na etapa"
          vale para todo movimento, inclusive o em massa. */}
      <p className="px-[9px] pb-1 text-[11px] leading-[1.4] text-text-secondary">
        {etapaAtual === undefined
          ? "Mover também pode disparar as automações de fluxo da etapa de destino, para cada lead."
          : "Mover também pode disparar as automações de fluxo da etapa de destino."}
      </p>
    </div>
  );
}

export type ConfirmacaoDeEtapa = {
  chave: string;
  nome: string;
  /** Nome da regua ligada; null quando nao deu para conferir as reguas */
  regua: string | null;
  /**
   * As reguas ligadas da etapa quando nao e so a geral (onda 4): cada lead
   * recebe a que vale para as etiquetas dele.
   */
  reguas?: readonly ReguaDaEtapa[];
};

/**
 * Cada lead recebe a regua que vale para as etiquetas dele: as opcoes, na
 * ordem, e o que acontece sem nenhuma. "(Psiquiatria, Odontologia ou a
 * geral)".
 */
function quemRecebeQual(reguas: readonly ReguaDaEtapa[]): {
  opcoes: string;
  semGeral: boolean;
} {
  const filtros = reguas.map((regua) => ({
    etiquetas: regua.etiquetas ?? [],
    etiquetas_modo: regua.etiquetas_modo ?? ("qualquer" as const),
  }));
  return {
    opcoes: opcoesDaEtapa(filtros),
    semGeral: !reguas.some(ehGeral),
  };
}

/** Quem muda de etapa: a selecao da barra em massa ou um lead so. */
export type QuemMudaDeEtapa =
  | {
      tipo: "selecao";
      total: number;
      /** Com autorizacao e fora da etapa: os que passam a receber a regua */
      recebem: number;
    }
  | { tipo: "lead"; nome: string; autorizado: boolean };

function fraseDeUmLead(
  autorizado: boolean,
  reguaConferida: boolean,
  reguas: readonly ReguaDaEtapa[] | undefined,
): string {
  if (!autorizado) {
    return "Este lead está sem autorização e não recebe nada por esta mudança.";
  }
  if (reguas && reguas.length > 0) {
    const { opcoes, semGeral } = quemRecebeQual(reguas);
    return `Este lead tem autorização e recebe a régua que vale para as etiquetas dele (${opcoes}).${
      semGeral ? " Sem nenhuma dessas etiquetas, não recebe nada." : ""
    }`;
  }
  return reguaConferida
    ? "Este lead tem autorização e vai receber as mensagens automáticas dela."
    : "Se tiver, este lead vai receber as mensagens automáticas dela, porque tem autorização.";
}

/** A descricao do dialogo: a regua (ou as reguas) da etapa. */
function descricaoDaConfirmacao(
  confirmacao: ConfirmacaoDeEtapa | null,
): string {
  if (!confirmacao?.regua) {
    return "Não foi possível conferir se esta etapa tem régua de follow-up ligada.";
  }
  const varias = (confirmacao.reguas?.length ?? 0) > 1;
  return varias
    ? `A etapa ${confirmacao.nome} tem ${confirmacao.reguas?.length} réguas de follow-up ligadas (${confirmacao.regua}).`
    : `A etapa ${confirmacao.nome} tem régua de follow-up ligada (${confirmacao.regua}).`;
}

/**
 * Confirmacao antes de mover para uma etapa com regua (ou sem como saber).
 * Sem hook: quem abre guarda a confirmacao.
 */
export function DialogoMoverParaEtapa({
  confirmacao,
  quem,
  aoCancelar,
  aoConfirmar,
  aoDevolverFoco,
}: {
  /** null fecha o dialogo */
  confirmacao: ConfirmacaoDeEtapa | null;
  quem: QuemMudaDeEtapa;
  aoCancelar: () => void;
  aoConfirmar: (confirmacao: ConfirmacaoDeEtapa) => void;
  /** Para onde o foco volta ao fechar; sem ele, o padrao do Radix */
  aoDevolverFoco?: (evento: Event) => void;
}) {
  return (
    <Dialog
      open={confirmacao !== null}
      onOpenChange={(aberto) => (!aberto ? aoCancelar() : null)}
    >
      <DialogContent
        className="sm:max-w-[420px]"
        onCloseAutoFocus={aoDevolverFoco}
      >
        <DialogHeader>
          <DialogTitle>
            {quem.tipo === "lead" ? (
              <>
                Mover {quem.nome} para {confirmacao?.nome}?
              </>
            ) : (
              <>Mover para {confirmacao?.nome}?</>
            )}
          </DialogTitle>
          <DialogDescription>
            {descricaoDaConfirmacao(confirmacao)}
          </DialogDescription>
        </DialogHeader>
        {quem.tipo === "lead" ? (
          <p className="text-[13px] leading-[1.5] text-foreground">
            {fraseDeUmLead(
              quem.autorizado,
              Boolean(confirmacao?.regua),
              confirmacao?.reguas,
            )}
          </p>
        ) : confirmacao?.reguas && confirmacao.reguas.length > 0 ? (
          // Varias reguas (ou so com etiqueta): cada lead recebe a que vale
          // para as etiquetas dele, que o banco escolhe.
          <p className="text-[13px] leading-[1.5] text-foreground">
            <span className="cz-num font-bold text-text-strong">
              {quem.recebem}
            </span>{" "}
            {quem.recebem === 1
              ? "lead com autorização recebe"
              : "leads com autorização recebem"}{" "}
            a régua que vale para as etiquetas de cada um (
            {quemRecebeQual(confirmacao.reguas).opcoes}).
            {quemRecebeQual(confirmacao.reguas).semGeral
              ? " Quem não tiver nenhuma dessas etiquetas não recebe nada."
              : null}
            {quem.total - quem.recebem > 0
              ? ` Os outros ${quem.total - quem.recebem} não recebem nada por esta mudança (estão sem autorização ou já estavam nesta etapa).`
              : null}
          </p>
        ) : (
          <p className="text-[13px] leading-[1.5] text-foreground">
            {confirmacao?.regua ? "" : "Se tiver, "}
            <span className="cz-num font-bold text-text-strong">
              {quem.recebem}
            </span>{" "}
            {quem.recebem === 1
              ? "lead com autorização vai receber"
              : "leads com autorização vão receber"}{" "}
            as mensagens automáticas dela.
            {quem.total - quem.recebem > 0
              ? ` Os outros ${quem.total - quem.recebem} não recebem nada por esta mudança (estão sem autorização ou já estavam nesta etapa).`
              : null}
          </p>
        )}
        <p className="text-[13px] leading-[1.5] text-text-secondary">
          Se {confirmacao?.nome} tiver automação de fluxo ligada, ela também
          roda{" "}
          {quem.tipo === "lead" ? "para este lead." : "para cada lead movido."}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => aoCancelar()}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (confirmacao) {
                aoConfirmar(confirmacao);
              }
            }}
          >
            {quem.tipo === "lead" ? (
              "Mover lead"
            ) : (
              <>Mover {contarLeads(quem.total)}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
