"use client";

import { BadgeX, ClipboardCheck, Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  registrarRequisitoDaProducaoAction,
  revogarRequisitoDaProducaoAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import {
  dataEHoraNaClinica,
  efeitoDeRevogar,
  ESCOPO_DO_REQUISITO,
  EVIDENCIA_MAXIMA,
  evidenciaValida,
  ehRequisitoDaEquipe,
  linhasDosRequisitos,
  MOTIVO_MAXIMO,
  motivoValido,
  REQUISITO_STATUS,
  TEXTOS_DO_PAINEL,
  versaoMudouDepoisDaRodada,
  type LinhaDoRequisito,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import type { RequisitosDaProducao } from "@/lib/queries/painel-geral";

// "Para liberar a produção" no detalhe da clinica do Painel geral (onda 2,
// item 11; contrato secoes 3.3 e 5.4; decisoes P11a a P11e do dono). Cada
// requisito em 3 camadas: "Cumprido" (CircleCheck, success), "Falta"
// (CircleDashed, neutral) e "Revogado" (BadgeX, alert). Os do banco se
// conferem sozinhos (so leitura, com o que o banco viu); os da equipe
// Conduzza tem "Registrar" (dialogo com a evidencia, 3 a 500, e para quem
// vale: o termo so para esta clinica, os outros para todas) e, com o
// registro vivo, "Registrar de novo" (o banco substitui a evidencia, sem
// tirar ninguem da producao) e "Revogar" (dialogo com o motivo
// obrigatorio; revogar o que vale para todas devolve as clinicas em
// producao para Teste, e o dialogo diz isso). Tudo vem de
// requisitos_da_producao (o registro vem no detalhe). A "Produção" do
// cartao do agente so habilita com tudo cumprido (producaoLiberada).
//
// P11e: a rodada do CFM fica registrada com a versao do filtro e do modelo
// na evidencia (o dialogo mostra as de agora); se as de agora nao aparecem
// na evidencia do registro vivo, o cartao avisa, sem travar a producao.
//
// Banco sem a migration da producao ("indisponivel"): o cartao diz que a
// producao ainda nao chegou, sem lista. Leitura que falhou: o erro, nunca
// uma lista que afirma o que nao conferiu. Evidencia e motivo sao da equipe
// Conduzza, nunca dado de paciente, e nao vao para log.

type Dialogo =
  | { tipo: "registrar"; linha: LinhaDoRequisito }
  | { tipo: "revogar"; linha: LinhaDoRequisito };

export function RequisitosDaProducaoCartao({
  clinicId,
  fuso,
  requisitos,
  versoes,
  emProducao = false,
}: {
  clinicId: string;
  /** Fuso da clinica (CLAUDE.md 3.6): as datas dos registros. */
  fuso: string;
  requisitos: RequisitosDaProducao | "erro";
  /**
   * As versoes de agora do filtro e do modelo (P11e). Nulas: a tela nao
   * conferiu (sem aviso).
   */
  versoes: { filtro: string; modelo: string } | null;
  /**
   * A clinica esta em producao (revisao da onda 2): revogar o que vale so
   * para ela a tira da producao na hora, e o dialogo diz isso.
   */
  emProducao?: boolean;
}) {
  const ids = useId();
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const abrir = (proximo: Dialogo) => {
    setTexto("");
    setErro(null);
    setDialogo(proximo);
  };
  const fechar = () => {
    if (pendente) {
      return;
    }
    setDialogo(null);
    setTexto("");
    setErro(null);
  };

  const valido =
    dialogo?.tipo === "registrar"
      ? evidenciaValida(texto)
      : dialogo?.tipo === "revogar"
        ? motivoValido(texto)
        : false;

  const confirmar = () => {
    if (!dialogo || !valido) {
      return;
    }
    const atual = dialogo;
    setErro(null);
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        if (atual.tipo === "registrar") {
          r = ehRequisitoDaEquipe(atual.linha.chave)
            ? await registrarRequisitoDaProducaoAction({
                clinicId,
                chave: atual.linha.chave,
                evidencia: texto,
              })
            : { ok: false, error: TEXTOS_DO_PAINEL.dadosInvalidos };
        } else {
          r = atual.linha.vivo
            ? await revogarRequisitoDaProducaoAction({
                clinicId,
                id: atual.linha.vivo.id,
                motivo: texto,
              })
            : { ok: false, error: TEXTOS_DO_PAINEL.requisitoJaRevogado };
        }
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(
          atual.tipo === "registrar"
            ? TEXTOS_DO_PAINEL.requisitoRegistrado
            : TEXTOS_DO_PAINEL.requisitoRevogado,
        );
        setDialogo(null);
        setTexto("");
        return;
      }
      const mensagem = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(mensagem);
      toast.error(mensagem);
    });
  };

  const linhas =
    requisitos !== "erro" && requisitos.estado === "lido"
      ? linhasDosRequisitos(requisitos)
      : [];
  const avisoDaVersao = versaoMudouDepoisDaRodada(linhas, versoes);

  // Para quem vale o registro: o do dialogo de registrar pela chave; o do
  // de revogar pelo proprio registro (geral = todas as clinicas).
  const valeParaTodas =
    dialogo?.tipo === "registrar"
      ? ehRequisitoDaEquipe(dialogo.linha.chave) &&
        ESCOPO_DO_REQUISITO[dialogo.linha.chave] === "todas"
      : dialogo?.tipo === "revogar"
        ? dialogo.linha.vivo?.geral === true
        : false;

  return (
    <Card role="region" aria-labelledby={`${ids}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <ClipboardCheck className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${ids}-titulo`}>
              {TEXTOS_DO_PAINEL.requisitosTitulo}
            </CardTitle>
            <CardDescription>
              {TEXTOS_DO_PAINEL.requisitosDescricao}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {requisitos === "erro" ? (
          <Aviso tom="alert" role="note">
            {TEXTOS_DO_PAINEL.requisitosSemLeitura}
          </Aviso>
        ) : requisitos.estado === "indisponivel" ? (
          <Aviso tom="info" role="note">
            {TEXTOS_DO_PAINEL.requisitosIndisponiveis}
          </Aviso>
        ) : (
          <>
            {avisoDaVersao ? (
              <Aviso tom="warning" role="note">
                {TEXTOS_DO_PAINEL.versaoMudou}
              </Aviso>
            ) : null}
            {linhas.length === 0 ? (
              <Aviso tom="alert" role="note">
                {TEXTOS_DO_PAINEL.requisitosSemLeitura}
              </Aviso>
            ) : (
              <ul className="grid gap-2" aria-label="Requisitos da produção">
                {linhas.map((linha) => (
                  <LinhaDoCartao
                    key={linha.chave}
                    linha={linha}
                    fuso={fuso}
                    pendente={pendente}
                    aoRegistrar={() => abrir({ tipo: "registrar", linha })}
                    aoRevogar={() => abrir({ tipo: "revogar", linha })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={dialogo !== null}
        onOpenChange={(aberto) => !aberto && fechar()}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {dialogo?.tipo === "revogar"
                ? `Revogar: ${dialogo.linha.rotulo}?`
                : `Registrar: ${dialogo?.linha.rotulo ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {valeParaTodas
                ? TEXTOS_DO_PAINEL.valeParaTodas
                : TEXTOS_DO_PAINEL.valeSoParaEsta}
            </DialogDescription>
          </DialogHeader>
          {dialogo?.tipo === "revogar" ? (
            <Aviso tom="warning" role="note">
              {efeitoDeRevogar({ valeParaTodas, emProducao })}
            </Aviso>
          ) : null}
          {dialogo?.tipo === "registrar" &&
          dialogo.linha.chave === "rodada_cfm" &&
          versoes ? (
            <p className="text-[13px] break-words text-text-secondary">
              {TEXTOS_DO_PAINEL.versoesParaAEvidencia(
                versoes.filtro,
                versoes.modelo,
              )}
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-texto`}>
              {dialogo?.tipo === "revogar"
                ? "Motivo (obrigatório)"
                : `${TEXTOS_DO_PAINEL.evidencia} (obrigatória)`}
            </Label>
            <Textarea
              id={`${ids}-texto`}
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value);
                setErro(null);
              }}
              rows={3}
              maxLength={
                dialogo?.tipo === "revogar" ? MOTIVO_MAXIMO : EVIDENCIA_MAXIMA
              }
              aria-describedby={`${ids}-apoio`}
              disabled={pendente}
            />
            <p id={`${ids}-apoio`} className="text-[11px] text-text-tertiary">
              {dialogo?.tipo === "revogar"
                ? TEXTOS_DO_PAINEL.regraDoMotivoDaConta
                : TEXTOS_DO_PAINEL.evidenciaApoio}
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
            <Button variant="ghost" disabled={pendente} onClick={fechar}>
              Voltar
            </Button>
            {/* Desabilitado enquanto o texto nao esta na faixa: a regra
                escrita no apoio do campo e o porque. */}
            <Button
              variant={dialogo?.tipo === "revogar" ? "destructive" : "default"}
              disabled={!valido || pendente}
              aria-busy={pendente || undefined}
              aria-describedby={`${ids}-apoio`}
              onClick={confirmar}
            >
              {dialogo?.tipo === "revogar" ? (
                <BadgeX aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              {pendente
                ? dialogo?.tipo === "revogar"
                  ? TEXTOS_DO_PAINEL.revogando
                  : TEXTOS_DO_PAINEL.registrando
                : dialogo?.tipo === "revogar"
                  ? TEXTOS_DO_PAINEL.revogar
                  : TEXTOS_DO_PAINEL.registrar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LinhaDoCartao({
  linha,
  fuso,
  pendente,
  aoRegistrar,
  aoRevogar,
}: {
  linha: LinhaDoRequisito;
  fuso: string;
  pendente: boolean;
  aoRegistrar: () => void;
  aoRevogar: () => void;
}) {
  return (
    <li className="grid gap-1.5 rounded-lg border border-border px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="font-semibold break-words text-text-strong">
            {linha.rotulo}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip size="sm" definition={REQUISITO_STATUS[linha.estado]} />
            <span className="text-[12px] text-text-secondary">
              {linha.daEquipe
                ? "Registrado pela equipe Conduzza"
                : "Conferido pelo banco"}
            </span>
          </span>
        </div>
        {linha.daEquipe ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" disabled={pendente} onClick={aoRegistrar}>
              <Plus aria-hidden />
              {linha.vivo
                ? TEXTOS_DO_PAINEL.registrarDeNovo
                : TEXTOS_DO_PAINEL.registrar}
            </Button>
            {linha.vivo ? (
              <Button variant="ghost" disabled={pendente} onClick={aoRevogar}>
                <BadgeX aria-hidden />
                {TEXTOS_DO_PAINEL.revogar}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {linha.detalhe ? (
        <p className="text-[13px] break-words text-text-secondary">
          {linha.detalhe}
        </p>
      ) : null}
      {linha.vivo ? (
        <p className="text-[12px] break-words text-text-secondary">
          {linha.vivo.registradoEm ? (
            <span className="cz-num">
              {`Registrado em ${dataEHoraNaClinica(linha.vivo.registradoEm, fuso)}`}
            </span>
          ) : (
            "Registrado"
          )}
          {linha.vivo.geral ? ", vale para todas as clínicas" : ""}
          {linha.vivo.evidencia ? `. Evidência: ${linha.vivo.evidencia}` : "."}
        </p>
      ) : linha.revogado ? (
        <p className="text-[12px] break-words text-text-secondary">
          {linha.revogado.revogadoEm ? (
            <span className="cz-num">
              {`Revogado em ${dataEHoraNaClinica(linha.revogado.revogadoEm, fuso)}`}
            </span>
          ) : (
            "Revogado"
          )}
          {linha.revogado.motivoDaRevogacao
            ? `. Motivo: ${linha.revogado.motivoDaRevogacao}`
            : "."}
        </p>
      ) : null}
    </li>
  );
}
