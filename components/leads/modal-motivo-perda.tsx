"use client";

import { useState } from "react";
import { toast } from "sonner";

import { mudarEtapaAction } from "@/app/(app)/leads/actions";
import {
  executarEmLotes,
  LOTE_DE_ACOES,
  mensagemDeFalhaParcial,
} from "@/components/leads/em-lotes";
import { Aviso } from "@/components/shared/aviso";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOST_REASONS } from "@/lib/domain/leads-ui";
import { cn } from "@/lib/utils";

// Mover para Perdido exige motivo (check do banco e regra do funil). Este
// dialogo e a UNICA porta: o Kanban, o drawer e a barra de acoes em massa
// abrem ele e so a confirmacao persiste. Cancelar nao grava nada.
//
// Selecao grande (achado 95) vai em lotes de 100 com progresso. Se um lote
// falha, o que ja foi gravado avisa o chamador (onSucesso com os ids
// gravados) e o dialogo fica aberto so com os que faltam, para tentar de novo.

export function ModalMotivoPerda({
  contactIds,
  onFechar,
  onSucesso,
}: {
  /** null fecha o dialogo; a lista de ids abre (1 do Kanban, N da massa). */
  contactIds: string[] | null;
  onFechar: () => void;
  /** Chamado com os ids que de fato foram para Perdido (todos ou parte) */
  onSucesso?: (ids: string[], motivo: string, nota: string | null) => void;
}) {
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [feitos, setFeitos] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Depois de uma falha no meio, so os que faltam.
  const [pendentes, setPendentes] = useState<string[] | null>(null);

  const aberto = contactIds !== null && contactIds.length > 0;
  const alvo = pendentes ?? contactIds ?? [];
  const salvando = feitos !== null;

  const fechar = () => {
    setMotivo(null);
    setNota("");
    setErro(null);
    setPendentes(null);
    setFeitos(null);
    onFechar();
  };

  const confirmar = async () => {
    if (alvo.length === 0 || !motivo) {
      return;
    }
    const notaAparada = nota.trim();
    if (motivo === "outro" && notaAparada.length < 2) {
      setErro("Descreva o motivo da perda.");
      return;
    }
    setFeitos(0);
    setErro(null);
    const resultado = await executarEmLotes(
      alvo,
      (lote) =>
        mudarEtapaAction({
          contact_ids: lote,
          etapa: "perdido",
          lost_reason: motivo,
          lost_reason_note: notaAparada ? notaAparada : undefined,
        }),
      setFeitos,
    );
    setFeitos(null);
    if (resultado.feitos.length > 0) {
      onSucesso?.(resultado.feitos, motivo, notaAparada ? notaAparada : null);
    }
    if (resultado.erro !== null) {
      setPendentes(resultado.restantes);
      setErro(
        resultado.feitos.length > 0
          ? `${mensagemDeFalhaParcial(resultado, alvo.length)} Toque em Marcar como perdido para tentar os que faltam.`
          : resultado.erro,
      );
      return;
    }
    toast.success(
      alvo.length > 1
        ? `${alvo.length} leads marcados como perdidos`
        : "Lead marcado como perdido",
    );
    fechar();
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(a) => (!a && !salvando ? fechar() : null)}
    >
      <DialogContent className="sm:max-w-[420px]" showCloseButton={!salvando}>
        <DialogHeader>
          <DialogTitle>Motivo da perda</DialogTitle>
          <DialogDescription>
            {alvo.length > 1 ? (
              <>
                Escolha por que estes{" "}
                <span className="cz-num">{alvo.length}</span> leads não
                seguiram.
              </>
            ) : (
              "Escolha por que este lead não seguiu."
            )}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Motivo da perda" className="grid">
          {LOST_REASONS.map((opcao) => (
            <label
              key={opcao.codigo}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border-l-2 px-2.5 cz-transition hover:bg-surface-3",
                motivo === opcao.codigo
                  ? "border-l-primary-edge bg-primary-soft hover:bg-primary-soft"
                  : "border-l-transparent",
              )}
            >
              <input
                type="radio"
                name="motivo-perda"
                value={opcao.codigo}
                checked={motivo === opcao.codigo}
                onChange={() => setMotivo(opcao.codigo)}
                className="size-4 accent-(--primary-edge)"
              />
              <span
                className={cn(
                  "text-sm",
                  motivo === opcao.codigo && "font-semibold text-text-strong",
                )}
              >
                {opcao.rotulo}
              </span>
            </label>
          ))}
        </div>
        {motivo === "outro" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="perda-nota">Descreva o motivo</Label>
            <Textarea
              id="perda-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
            />
          </div>
        ) : null}
        {salvando && alvo.length > LOTE_DE_ACOES ? (
          <BarraDeProgresso
            valor={feitos ?? 0}
            maximo={alvo.length}
            rotulo="Marcando como perdidos"
            legenda={`${feitos ?? 0} de ${alvo.length}`}
            ariaLabel={`${feitos ?? 0} de ${alvo.length} leads marcados`}
          />
        ) : null}
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando || !motivo}>
            {salvando ? "Salvando..." : "Marcar como perdido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
