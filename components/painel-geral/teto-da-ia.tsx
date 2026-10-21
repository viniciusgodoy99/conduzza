"use client";

import { Check, Wallet } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  definirTetoDaIaAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import {
  dolaresParaCampo,
  lerRespostasPorHora,
  lerTetoEmDolares,
  RESPOSTAS_MAXIMAS,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TetosDaIa } from "@/lib/queries/painel-geral";

// O teto de gasto da IA da clinica no detalhe do Painel geral (onda 1): o
// teto das ultimas 24 horas em dolares (janela movel, o simulador conta
// junto) e as respostas do agente por conversa em uma hora. So a equipe
// Conduzza muda (a acao e a RPC definir_teto_da_ia conferem). A tela le os
// dolares como as outras telas leem reais ("5,00", "5.5", "12") e manda
// centavos; fora da faixa (0,01 a 1.000 dolares, 1 a 200 respostas, a
// mesma da RPC e do Zod da acao), o campo diz o que falta antes de ir ao
// servidor.
//
// Sem a linha de liberacao (a clinica nunca teve o agente), nao ha teto
// para mudar; com a conta suspensa e a liberacao ligada, o banco recusa
// (a clinica sai da lista). Nos dois casos os campos ficam visiveis e
// desabilitados, com o porque escrito e na dica. O teto vai de US$ 0,01 a
// US$ 1.000 (o banco manteve o teto maior que zero: para zerar o gasto, o
// agente desligado).

type Erros = { teto?: string; respostas?: string; geral?: string };

export function TetoDaIa({
  clinicId,
  tetos,
  bloqueio = null,
}: {
  clinicId: string;
  /** Nulo: a clinica ainda nao tem a linha (o teto nasce com o agente). */
  tetos: TetosDaIa | null;
  /**
   * Por que o teto nao muda agora, mesmo com a linha (a conta suspensa com
   * a liberacao ligada: o banco recusa). Nulo: muda.
   */
  bloqueio?: string | null;
}) {
  const ids = useId();
  const [teto, setTeto] = useState(
    tetos ? dolaresParaCampo(tetos.tetoDiarioCentavos) : "",
  );
  const [respostas, setRespostas] = useState(
    tetos ? String(tetos.tetoRespostasPorConversaHora) : "",
  );
  const [erros, setErros] = useState<Erros>({});
  const [pendente, startTransition] = useTransition();
  // O porque dos campos desabilitados: sem a linha, ou a conta suspensa.
  const travado = tetos === null ? TEXTOS_DO_PAINEL.tetoSemLinha : bloqueio;
  const desabilitado = travado !== null;

  const salvar = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (desabilitado || pendente) {
      return;
    }
    const centavos = lerTetoEmDolares(teto);
    const porHora = lerRespostasPorHora(respostas);
    const novos: Erros = {
      ...(centavos === null ? { teto: TEXTOS_DO_PAINEL.tetoInvalido } : {}),
      ...(porHora === null
        ? { respostas: TEXTOS_DO_PAINEL.respostasInvalidas }
        : {}),
    };
    setErros(novos);
    if (centavos === null || porHora === null) {
      return;
    }
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await definirTetoDaIaAction({
          clinicId,
          tetoDiarioCentavos: centavos,
          respostasPorConversaHora: porHora,
        });
      } catch {
        r = null;
      }
      if (r?.ok) {
        setTeto(dolaresParaCampo(centavos));
        toast.success("Teto de gasto salvo.");
        return;
      }
      const texto = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErros({ geral: texto });
      toast.error(texto);
    });
  };

  const botao = (
    <Button
      type="submit"
      variant="outline"
      disabled={desabilitado || pendente}
      aria-busy={pendente || undefined}
    >
      <Check aria-hidden />
      {pendente ? "Salvando..." : "Salvar teto"}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby={`${ids}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Wallet className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${ids}-titulo`}>Teto de gasto</CardTitle>
            <CardDescription>{TEXTOS_DO_PAINEL.tetoExplicacao}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={salvar} className="grid gap-4">
          {travado ? (
            <p className="text-[13px] text-text-secondary">{travado}</p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-teto`}>Teto a cada 24 horas (US$)</Label>
            <Input
              id={`${ids}-teto`}
              inputMode="decimal"
              autoComplete="off"
              className="cz-num"
              placeholder="5,00"
              value={teto}
              onChange={(evento) => {
                setTeto(evento.target.value);
                setErros((atuais) => ({ ...atuais, teto: undefined }));
              }}
              aria-invalid={erros.teto ? true : undefined}
              aria-describedby={erros.teto ? `${ids}-teto-erro` : undefined}
              disabled={desabilitado || pendente}
            />
            {erros.teto ? (
              <p
                id={`${ids}-teto-erro`}
                className="text-[12px] text-alert-text"
              >
                {erros.teto}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-respostas`}>
              Respostas por conversa em 1 hora
            </Label>
            <Input
              id={`${ids}-respostas`}
              inputMode="numeric"
              autoComplete="off"
              className="cz-num"
              placeholder="20"
              maxLength={String(RESPOSTAS_MAXIMAS).length}
              value={respostas}
              onChange={(evento) => {
                setRespostas(evento.target.value);
                setErros((atuais) => ({ ...atuais, respostas: undefined }));
              }}
              aria-invalid={erros.respostas ? true : undefined}
              aria-describedby={`${ids}-respostas-apoio`}
              disabled={desabilitado || pendente}
            />
            <p
              id={`${ids}-respostas-apoio`}
              className={
                erros.respostas
                  ? "text-[12px] text-alert-text"
                  : "text-[12px] text-text-secondary"
              }
            >
              {erros.respostas ?? TEXTOS_DO_PAINEL.respostasExplicacao}
            </p>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {erros.geral ? (
              <Aviso tom="alert" role="note">
                {erros.geral}
              </Aviso>
            ) : null}
          </div>
          <div>
            {travado ? (
              <DisabledWithHint hint={travado}>{botao}</DisabledWithHint>
            ) : (
              botao
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
