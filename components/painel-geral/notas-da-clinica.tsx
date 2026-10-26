"use client";

import { Check, NotebookPen, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  escreverNotaDaClinicaAction,
  excluirNotaDaClinicaAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import {
  autoria,
  contagemNoPainel,
  dataEHoraNaClinica,
  NOTA_MAXIMA,
  notaValida,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
import type {
  NotaDaClinica,
  NotasDaClinica as Notas,
} from "@/lib/queries/painel-geral";

// As notas internas da equipe Conduzza sobre a clinica, no detalhe do Painel
// geral (segunda leva, 26/10/2026; escolha (6) do dono). So a equipe
// Conduzza le e escreve (a guarda vive na acao e no banco); a equipe da
// clinica nunca ve. NUNCA dado de paciente: o aviso fica fixo ao lado do
// campo, antes de escrever. Cada nota com o autor e a data (no fuso da
// clinica, como o resto do detalhe), a mais nova primeiro. Excluir so a
// propria nota, sempre com confirmacao; a nota de outra pessoa mostra o
// "Excluir" visivel e desabilitado, com a dica (o banco recusa do mesmo
// jeito). O texto da nota nunca vai para log nem para a trilha.

export function NotasDaClinica({
  clinicId,
  leitura,
  fuso,
}: {
  clinicId: string;
  /**
   * As notas, a mais nova primeiro, cada uma com o "minha" do banco (so a
   * propria nota se exclui); "erro": a leitura falhou.
   */
  leitura: Notas | "erro";
  /** clinic.timezone: a data de cada nota no relogio da clinica. */
  fuso: string;
}) {
  const notas = leitura === "erro" ? "erro" : leitura.notas;
  const ids = useId();
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, startSalvar] = useTransition();
  const [excluindo, setExcluindo] = useState<NotaDaClinica | null>(null);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);
  const [excluindoAgora, startExcluir] = useTransition();
  const podeSalvar = notaValida(texto) && !salvando;

  const salvar = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (salvando) {
      return;
    }
    if (!notaValida(texto)) {
      setErro(TEXTOS_DO_PAINEL.notaInvalida);
      return;
    }
    setErro(null);
    startSalvar(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await escreverNotaDaClinicaAction({ clinicId, texto });
      } catch {
        r = null;
      }
      if (r?.ok) {
        setTexto("");
        toast.success(TEXTOS_DO_PAINEL.notaSalva);
        return;
      }
      const mensagem = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(mensagem);
      toast.error(mensagem);
    });
  };

  const fecharExclusao = (aberto: boolean) => {
    if (excluindoAgora || aberto) {
      return;
    }
    setExcluindo(null);
    setErroAoExcluir(null);
  };

  const confirmarExclusao = () => {
    const nota = excluindo;
    if (!nota || excluindoAgora) {
      return;
    }
    setErroAoExcluir(null);
    startExcluir(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await excluirNotaDaClinicaAction({ clinicId, notaId: nota.id });
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(TEXTOS_DO_PAINEL.notaExcluida);
        setExcluindo(null);
        return;
      }
      const mensagem = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErroAoExcluir(mensagem);
      toast.error(mensagem);
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
            <NotebookPen className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${ids}-titulo`}>
              {TEXTOS_DO_PAINEL.notasTitulo}
            </CardTitle>
            <CardDescription>{TEXTOS_DO_PAINEL.notasDescricao}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={salvar} className="grid gap-2" noValidate>
          <Aviso
            tom="warning"
            role="note"
            titulo={TEXTOS_DO_PAINEL.naoEscrevaDadoDePaciente}
          >
            {TEXTOS_DO_PAINEL.naoEscrevaDadoDePacienteApoio}
          </Aviso>
          <Label htmlFor={`${ids}-nota`}>{TEXTOS_DO_PAINEL.novaNota}</Label>
          <Textarea
            id={`${ids}-nota`}
            value={texto}
            onChange={(evento) => {
              setTexto(evento.target.value);
              setErro(null);
            }}
            rows={3}
            maxLength={NOTA_MAXIMA}
            aria-invalid={erro !== null || undefined}
            aria-describedby={`${ids}-nota-apoio`}
            disabled={salvando}
          />
          <p
            id={`${ids}-nota-apoio`}
            className="flex flex-wrap justify-between gap-x-3 text-[11px] text-text-tertiary"
          >
            <span>{TEXTOS_DO_PAINEL.regraDaNota}</span>
            <span className="cz-num">
              {contagemNoPainel(texto.length)} de{" "}
              {contagemNoPainel(NOTA_MAXIMA)}
            </span>
          </p>
          <div aria-live="polite" aria-atomic="true">
            {erro ? (
              <Aviso tom="alert" role="note">
                {erro}
              </Aviso>
            ) : null}
          </div>
          <div>
            {/* Desabilitado com o campo vazio: a regra escrita no apoio do
                campo e o porque, ligado ao botao. */}
            <Button
              type="submit"
              variant="outline"
              disabled={!podeSalvar}
              aria-busy={salvando || undefined}
              aria-describedby={`${ids}-nota-apoio`}
            >
              <Check aria-hidden />
              {salvando
                ? TEXTOS_DO_PAINEL.salvandoNota
                : TEXTOS_DO_PAINEL.salvarNota}
            </Button>
          </div>
        </form>

        {notas === "erro" ? (
          <Aviso tom="alert" role="note">
            {TEXTOS_DO_PAINEL.notasSemLeitura}
          </Aviso>
        ) : notas.length === 0 ? (
          <div className="grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-text-strong">
              {TEXTOS_DO_PAINEL.nenhumaNota}
            </p>
            <p className="text-[12px] text-text-secondary">
              {TEXTOS_DO_PAINEL.nenhumaNotaApoio}
            </p>
          </div>
        ) : (
          <ol aria-label={TEXTOS_DO_PAINEL.notasTitulo} className="grid gap-2">
            {notas.map((nota) => (
              <li
                key={nota.id}
                className="grid gap-1.5 rounded-lg border border-border px-3.5 py-3"
              >
                <p className="text-[13.5px] break-words whitespace-pre-wrap text-foreground">
                  {nota.texto}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] text-text-secondary">
                    Escrita {autoria(nota.autor)} em{" "}
                    <span className="cz-num">
                      {dataEHoraNaClinica(nota.criadaEm, fuso)}
                    </span>
                  </p>
                  <BotaoExcluirNota
                    minha={nota.minha}
                    onExcluir={() => {
                      setErroAoExcluir(null);
                      setExcluindo(nota);
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        {leitura !== "erro" && leitura.temMais ? (
          <p className="text-[12px] text-text-secondary">
            {TEXTOS_DO_PAINEL.notasTemMais}
          </p>
        ) : null}
      </CardContent>

      <Dialog open={excluindo !== null} onOpenChange={fecharExclusao}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{TEXTOS_DO_PAINEL.excluirNotaTitulo}</DialogTitle>
            <DialogDescription>
              {TEXTOS_DO_PAINEL.excluirNotaEfeito}
            </DialogDescription>
          </DialogHeader>
          {excluindo ? (
            <p className="max-h-40 overflow-y-auto rounded-lg bg-surface-2 px-3.5 py-3 text-[13px] break-words whitespace-pre-wrap">
              {excluindo.texto}
            </p>
          ) : null}
          <div aria-live="polite" aria-atomic="true">
            {erroAoExcluir ? (
              <Aviso tom="alert" role="note">
                {erroAoExcluir}
              </Aviso>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={excluindoAgora}
              onClick={() => fecharExclusao(false)}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={excluindoAgora}
              aria-busy={excluindoAgora || undefined}
              onClick={confirmarExclusao}
            >
              <Trash2 aria-hidden />
              {excluindoAgora
                ? TEXTOS_DO_PAINEL.excluindoNota
                : TEXTOS_DO_PAINEL.excluirNota}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * "Excluir nota": so de quem escreveu. A nota de outra pessoa mostra o
 * botao visivel e desabilitado, com a dica.
 */
function BotaoExcluirNota({
  minha,
  onExcluir,
}: {
  minha: boolean;
  onExcluir: () => void;
}) {
  const botao = (
    <Button
      size="sm"
      variant="ghost"
      disabled={!minha}
      onClick={minha ? onExcluir : undefined}
    >
      <Trash2 aria-hidden />
      {TEXTOS_DO_PAINEL.excluirNota}
    </Button>
  );
  return minha ? (
    botao
  ) : (
    <DisabledWithHint hint={TEXTOS_DO_PAINEL.soQuemEscreveuExclui}>
      {botao}
    </DisabledWithHint>
  );
}
