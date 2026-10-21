"use client";

import { Power } from "lucide-react";

import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cicloDaAutomacao,
  descreverAcao,
  descreverGatilho,
  resolvedorDeNomes,
  textoDoCiclo,
  type AutomacaoDeFluxo,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

import { PreviaDaAutomacao } from "./previa-da-automacao";

// Ligar pede confirmacao com a previa: a regra nao e retroativa, e quem ja
// passou do ponto fica de fora. Se ligar fecharia um ciclo com outra
// automacao ligada (espelho do detector do banco), o botao fica desabilitado
// e o aviso diz o caminho.

export function DialogoParaLigar({
  regra,
  automacoes,
  jornada,
  etiquetas,
  clinicId,
  pendente,
  aoFechar,
  aoConfirmar,
}: {
  /** nula fecha o dialogo */
  regra: AutomacaoDeFluxo | null;
  automacoes: readonly AutomacaoDeFluxo[];
  jornada: readonly EtapaDaJornada[];
  etiquetas: readonly EtiquetaDeConversa[] | null;
  clinicId: string;
  pendente: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const nomeDaEtapa = resolvedorDeNomes(jornada);
  const ciclo = regra
    ? cicloDaAutomacao({ ...regra, ativa: true }, automacoes)
    : null;

  return (
    <Dialog
      open={regra !== null}
      onOpenChange={(v) => (!v ? aoFechar() : null)}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Ligar {regra?.nome}?</DialogTitle>
          <DialogDescription>
            {regra
              ? `${descreverGatilho(regra, nomeDaEtapa)}: ${descreverAcao(
                  regra,
                  {
                    etapa: nomeDaEtapa,
                    etiqueta: resolvedorDeNomes(etiquetas),
                  },
                ).replace(/^./, (letra) => letra.toLowerCase())}.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {regra ? (
          <PreviaDaAutomacao
            clinicId={clinicId}
            gatilho={regra.gatilho}
            etapa={regra.etapa}
            nomeDaEtapa={nomeDaEtapa(regra.etapa)}
            esperaMinutos={regra.espera_minutos}
          />
        ) : null}
        {ciclo ? (
          <Aviso tom="alert" titulo="Fecha um ciclo com outra automação">
            Com esta ligada, o lead ficaria indo e voltando sozinho:{" "}
            {textoDoCiclo(ciclo, nomeDaEtapa)}. Mude o destino ou desligue a
            outra automação antes.
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={pendente || ciclo !== null} onClick={aoConfirmar}>
            <Power className="size-4" aria-hidden />
            {pendente ? "Ligando..." : "Ligar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
