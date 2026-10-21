"use client";

import { Building2, OctagonPause, Play } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  reativarClinicaAction,
  suspenderClinicaAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import {
  dataEHoraNaClinica,
  MOTIVO_MAXIMO,
  motivoValido,
  SITUACAO_DA_CONTA_STATUS,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { SuspensaoNoPainel } from "@/lib/queries/painel-geral";

// A conta da clinica no detalhe do Painel geral (onda 1, decisao do dono de
// 20/10/2026): "Suspender conta" e "Reativar conta", sempre com o dialogo
// que diz o efeito e o motivo obrigatorio (3 a 300 letras, o check do
// banco), que vai para a trilha com o usuario e a data. Suspender e acao
// perigosa (variante destrutiva no botao e no dialogo, com o OctagonPause,
// o icone do status Suspensa, sempre em alerta); reativar nao apaga nada e
// volta tudo como estava, menos as mensagens automaticas que venceram
// durante a suspensao (canceladas, para nao sair fora de hora).

/** O aviso do fim da reativacao, com as mensagens vencidas quando houve. */
export function textoDaReativacao(
  nome: string,
  jobsVencidos: number | undefined,
): string {
  if (!jobsVencidos) {
    return `Conta da ${nome} reativada.`;
  }
  return jobsVencidos === 1
    ? `Conta da ${nome} reativada. 1 mensagem automática vencida foi cancelada.`
    : `Conta da ${nome} reativada. ${jobsVencidos.toLocaleString("pt-BR")} mensagens automáticas vencidas foram canceladas.`;
}

export function ContaDaClinica({
  clinicId,
  nome,
  fuso,
  suspensao,
}: {
  clinicId: string;
  nome: string;
  fuso: string;
  suspensao: SuspensaoNoPainel | null;
}) {
  const ids = useId();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const suspensa = suspensao !== null;
  const podeConfirmar = motivoValido(motivo) && !pendente;

  const fechar = (abrir: boolean) => {
    if (pendente) {
      return;
    }
    setAberto(abrir);
    if (!abrir) {
      setMotivo("");
      setErro(null);
    }
  };

  const confirmar = () => {
    if (!motivoValido(motivo)) {
      setErro(TEXTOS_DO_PAINEL.motivoCurto);
      return;
    }
    setErro(null);
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = suspensa
          ? await reativarClinicaAction({ clinicId, motivo })
          : await suspenderClinicaAction({ clinicId, motivo });
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(
          suspensa
            ? textoDaReativacao(nome, r.jobsVencidos)
            : `Conta da ${nome} suspensa.`,
        );
        setAberto(false);
        setMotivo("");
        return;
      }
      const texto = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(texto);
      toast.error(texto);
    });
  };

  return (
    <Card role="region" aria-labelledby={`${ids}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Building2 className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${ids}-titulo`}>Conta da clínica</CardTitle>
            <CardDescription>
              Suspender mantém todos os dados. Reativar volta tudo como estava.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <StatusChip
            definition={
              SITUACAO_DA_CONTA_STATUS[suspensa ? "suspensa" : "ativa"]
            }
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {suspensao ? (
          <Aviso
            tom="alert"
            icone={OctagonPause}
            role="note"
            titulo={`Suspensa desde ${dataEHoraNaClinica(suspensao.suspensaEm, fuso)}`}
          >
            <span className="break-words">Motivo: {suspensao.motivo}</span>
          </Aviso>
        ) : (
          <p className="text-[13px] text-text-secondary">
            A equipe da clínica entra e usa o sistema normalmente.
          </p>
        )}
        <div>
          {suspensa ? (
            <Button onClick={() => fechar(true)}>
              <Play aria-hidden />
              Reativar conta
            </Button>
          ) : (
            // Destrutivo como o botao do dialogo: o OctagonPause e o icone
            // do status Suspensa (alert) e nunca sai em outra cor.
            <Button variant="destructive" onClick={() => fechar(true)}>
              <OctagonPause aria-hidden />
              Suspender conta
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {suspensa
                ? `Reativar a conta da ${nome}?`
                : `Suspender a conta da ${nome}?`}
            </DialogTitle>
            <DialogDescription>
              {suspensa
                ? "Confira o que acontece ao reativar."
                : "Confira o que acontece ao suspender."}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground">
            {(suspensa
              ? TEXTOS_DO_PAINEL.efeitoDaReativacao
              : TEXTOS_DO_PAINEL.efeitoDaSuspensao
            ).map((efeito) => (
              <li key={efeito}>{efeito}</li>
            ))}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-motivo`}>Motivo (obrigatório)</Label>
            <Textarea
              id={`${ids}-motivo`}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value);
                setErro(null);
              }}
              rows={3}
              maxLength={MOTIVO_MAXIMO}
              aria-invalid={erro !== null || undefined}
              aria-describedby={`${ids}-motivo-apoio`}
              placeholder={
                suspensa
                  ? "Ex.: pagamento em dia de novo"
                  : "Ex.: pagamento atrasado há 30 dias"
              }
              disabled={pendente}
            />
            <p
              id={`${ids}-motivo-apoio`}
              className="text-[11px] text-text-tertiary"
            >
              {TEXTOS_DO_PAINEL.regraDoMotivoDaConta}
            </p>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {erro ? (
              <Aviso tom="alert" role="note">
                {erro}
              </Aviso>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => fechar(false)}
            >
              Voltar
            </Button>
            {/* Desabilitado enquanto o motivo nao esta na faixa: a regra
                escrita no apoio do campo e o porque, para quem le e para o
                leitor de tela. */}
            <Button
              variant={suspensa ? "default" : "destructive"}
              disabled={!podeConfirmar}
              aria-busy={pendente || undefined}
              aria-describedby={`${ids}-motivo-apoio`}
              onClick={confirmar}
            >
              {suspensa ? <Play aria-hidden /> : <OctagonPause aria-hidden />}
              {pendente
                ? suspensa
                  ? "Reativando..."
                  : "Suspendendo..."
                : suspensa
                  ? "Reativar conta"
                  : "Suspender conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
