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
// A lista das etapas (icone, nome e tom, e a marca de Regua) e o dialogo de
// confirmacao tambem sao um so. Na linha e na gaveta a etapa atual vem
// marcada e os textos falam de um lead so; na barra, nada mudou.

/** Item de lista dentro do popover, na casca do item de menu do DS (40px). */
export const ITEM_DO_POPOVER =
  "flex min-h-10 w-full items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] font-medium text-foreground outline-none cz-transition hover:bg-accent hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45";

/** O que escolher uma etapa faz, antes de qualquer gravacao. */
export type DecisaoDeEtapa =
  | { tipo: "pedir_motivo" }
  /** regua: o nome da regua ligada; null quando nao deu para conferir */
  | { tipo: "confirmar"; regua: string | null }
  | { tipo: "mover" };

/** O nome da regua de follow-up ligada em cada etapa (uma por etapa). */
export function reguasPorEtapa(
  reguas: readonly ReguaDaEtapa[] | null,
): Map<string, string> {
  return new Map((reguas ?? []).map((regua) => [regua.etapa, regua.nome]));
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
  // Etapa com regua (ou sem como saber): confirma antes, dizendo quem passa
  // a receber mensagem. Sem regua, move direto, como sempre.
  const regua = reguasPorEtapa(reguas).get(etapa.chave);
  if (reguas === null || regua !== undefined) {
    return { tipo: "confirmar", regua: regua ?? null };
  }
  return { tipo: "mover" };
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
        const regua = reguaPorEtapa.get(def.chave);
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
                <span className="sr-only"> de follow-up ligada: {regua}</span>
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
};

/** Quem muda de etapa: a selecao da barra em massa ou um lead so. */
export type QuemMudaDeEtapa =
  | {
      tipo: "selecao";
      total: number;
      /** Com autorizacao e fora da etapa: os que passam a receber a regua */
      recebem: number;
    }
  | { tipo: "lead"; nome: string; autorizado: boolean };

function fraseDeUmLead(autorizado: boolean, reguaConferida: boolean): string {
  if (!autorizado) {
    return "Este lead está sem autorização e não recebe nada por esta mudança.";
  }
  return reguaConferida
    ? "Este lead tem autorização e vai receber as mensagens automáticas dela."
    : "Se tiver, este lead vai receber as mensagens automáticas dela, porque tem autorização.";
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
            {confirmacao?.regua
              ? `A etapa ${confirmacao.nome} tem régua de follow-up ligada (${confirmacao.regua}).`
              : "Não foi possível conferir se esta etapa tem régua de follow-up ligada."}
          </DialogDescription>
        </DialogHeader>
        {quem.tipo === "lead" ? (
          <p className="text-[13px] leading-[1.5] text-foreground">
            {fraseDeUmLead(quem.autorizado, Boolean(confirmacao?.regua))}
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
