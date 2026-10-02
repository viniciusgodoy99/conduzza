"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { excluirBloqueioAction } from "@/app/(app)/cadastros/actions";
import { descreverPeriodoDoBloqueio } from "@/components/agenda/bloqueio-comum";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { ENCAIXE_DO_BLOQUEIO } from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BloqueioDaAgenda } from "@/lib/queries/agenda";

// Detalhe e remocao de um bloqueio, iguais nos dois caminhos que levam a
// eles: o balao da faixa hachurada (FaixaDeBloqueio) e o menu da consulta que
// cruza o bloqueio (AppointmentMenu), onde a faixa fica coberta pelo bloco.
// Quem dispara o "Remover bloqueio" e de cada lugar (botao no balao, item no
// menu); o texto, a regra de quem pode e a confirmacao com o remover() vivem
// aqui, para os dois nunca divergirem.

/** Remover bloqueio: admin e gestor, a mesma regra da RLS. */
export function podeRemoverBloqueio(contexto: ContextoAgenda): boolean {
  return contexto.podeEditarCadastros;
}

export function nomeDoProfissionalDoBloqueio(
  contexto: ContextoAgenda,
  bloqueio: BloqueioDaAgenda,
): string {
  return (
    contexto.catalogo.profissionais.find(
      (p) => p.id === bloqueio.professional_id,
    )?.name ?? "Profissional removido"
  );
}

/**
 * Motivo (com o Ban, como na faixa: nunca so cor), profissional, periodo no
 * fuso da clinica e se o bloqueio permite encaixe (chip com icone, rotulo e
 * cor). O rotulo "Horario bloqueado" e opcional: no menu ele e o titulo da
 * secao.
 */
export function ResumoDoBloqueio({
  contexto,
  bloqueio,
  comRotulo = true,
  idRotulo,
  idMotivo,
  id,
}: {
  contexto: ContextoAgenda;
  bloqueio: BloqueioDaAgenda;
  comRotulo?: boolean;
  /** Para o balao ganhar nome (aria-labelledby) do texto que ja esta na tela. */
  idRotulo?: string;
  idMotivo?: string;
  /** Para o item "Remover bloqueio" do menu descrever qual bloqueio sai. */
  id?: string;
}) {
  const periodo = descreverPeriodoDoBloqueio(
    bloqueio.starts_at,
    bloqueio.ends_at,
    contexto.timezone,
  );
  return (
    // gap-2.5: o mesmo respiro do balao entre o texto e o chip.
    <div className="grid gap-2.5">
      <div id={id} className="grid gap-0.5">
        {comRotulo ? (
          <span
            id={idRotulo}
            className="cz-eyebrow text-[10px] text-text-tertiary"
          >
            Horário bloqueado
          </span>
        ) : null}
        <span className="flex min-w-0 items-start gap-1.5">
          <Ban
            className="mt-0.5 size-3.5 shrink-0 text-text-secondary"
            aria-hidden
          />
          <span
            id={idMotivo}
            className="min-w-0 text-sm font-bold break-words text-text-strong"
          >
            {bloqueio.reason}
          </span>
        </span>
        <span className="truncate text-xs text-text-secondary">
          {nomeDoProfissionalDoBloqueio(contexto, bloqueio)}
        </span>
        <span className="cz-num text-xs text-text-secondary">{periodo}</span>
      </div>
      <StatusChip
        size="sm"
        className="w-fit"
        definition={
          ENCAIXE_DO_BLOQUEIO[
            bloqueio.blocks_overbooking ? "impede" : "permite"
          ]
        }
      />
    </div>
  );
}

/**
 * Confirmacao do "Remover bloqueio", com a chamada da Server Action. Quem usa
 * monta o dialogo quando a pessoa pede a remocao e o desmonta no onFechar
 * (sucesso, Cancelar, Esc ou o X).
 */
export function ConfirmarRemocaoDoBloqueio({
  contexto,
  bloqueio,
  onFechar,
}: {
  contexto: ContextoAgenda;
  bloqueio: BloqueioDaAgenda;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nome = nomeDoProfissionalDoBloqueio(contexto, bloqueio);
  const periodo = descreverPeriodoDoBloqueio(
    bloqueio.starts_at,
    bloqueio.ends_at,
    contexto.timezone,
  );

  const remover = async () => {
    setRemovendo(true);
    setErro(null);
    // A chamada da Server Action rejeita com rede caida, excecao no servidor
    // ou deploy novo no meio. Sem o finally, removendo ficava true para
    // sempre e o dialogo nao fechava mais (Cancelar, Esc e o X travados).
    let removido = false;
    try {
      const resultado = await excluirBloqueioAction(bloqueio.id);
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível remover o bloqueio.");
        return;
      }
      removido = true;
      toast.success("Bloqueio removido");
    } catch {
      setErro("Não foi possível remover o bloqueio. Tente de novo.");
    } finally {
      setRemovendo(false);
      // O bloqueio nao tem tempo real: refaz os dias em cache (o prefixo
      // cobre a visao Dia e as 7 da Semana; so as queries ativas buscam de
      // novo). Tambem na falha: o delete pode ter gravado e a resposta se
      // perdido no caminho.
      void queryClient.invalidateQueries({
        queryKey: ["agenda", contexto.clinicId],
      });
      if (removido) {
        onFechar();
      }
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(aberta) => {
        if (!aberta && !removendo) {
          onFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Remover bloqueio</DialogTitle>
          <DialogDescription>
            O bloqueio de {nome} (<span className="cz-num">{periodo}</span>)
            será removido e os horários voltam para a oferta.
          </DialogDescription>
        </DialogHeader>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={removendo}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => void remover()}
            disabled={removendo}
          >
            {removendo ? "Removendo..." : "Remover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
