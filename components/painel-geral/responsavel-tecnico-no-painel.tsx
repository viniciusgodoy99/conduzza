"use client";

import { ExternalLink, IdCard, ShieldCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  conferirRegistroDoRtAction,
  type ResultadoDoPainel,
} from "@/app/(admin)/painel-geral/actions";
import {
  dataEHoraNaClinica,
  PORTAL_DO_CONSELHO,
  TEXTOS_DO_PAINEL as T,
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
import type { ResponsavelTecnico } from "@/lib/queries/preparo";

// O registro do responsavel tecnico (RT) da clinica, no detalhe do Painel geral
// (AG7, decisao do dono de 05/11/2026): a equipe Conduzza consulta o portal do
// conselho e marca "Registro conferido". Sem isso, nenhuma orientacao de
// preparo sai (preparo_em_vigor). So a equipe Conduzza chega aqui, e o proprio
// RT (conta antiga designada antes) ve o botao desabilitado; a acao e a RPC
// conferem de novo. O carregando e o loading.tsx da rota.

export function ResponsavelTecnicoNoPainel({
  clinicId,
  leitura,
  proprioRt,
  fuso,
}: {
  clinicId: string;
  /** A designacao aberta; null: sem RT; "erro": a leitura falhou. */
  leitura: ResponsavelTecnico | null | "erro";
  /** A sessao e a pessoa designada RT: nao confere o proprio registro. */
  proprioRt: boolean;
  /** clinic.timezone. */
  fuso: string;
}) {
  const [conferindo, startConferir] = useTransition();

  const conferir = (rtId: string) => {
    startConferir(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await conferirRegistroDoRtAction({ clinicId, rtId });
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(T.registroConferido);
        return;
      }
      toast.error(r ? r.error : T.semResposta);
    });
  };

  const corpo = () => {
    if (leitura === "erro") {
      return (
        <Aviso tom="alert" role="alert">
          {T.rtErroAoCarregar}
        </Aviso>
      );
    }
    if (leitura === null) {
      return <p className="text-[13px] text-text-secondary">{T.rtVazio}</p>;
    }
    const portal = PORTAL_DO_CONSELHO[leitura.conselho];
    const botao = (
      <Button
        className="h-10"
        disabled={proprioRt || conferindo}
        onClick={proprioRt ? undefined : () => conferir(leitura.id)}
      >
        <ShieldCheck aria-hidden />
        {conferindo ? T.conferindoRegistro : T.marcarRegistroConferido}
      </Button>
    );
    return (
      <>
        <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          {[
            [T.rtNome, leitura.nome],
            [T.rtConselho, leitura.conselho],
            [T.rtNumero, leitura.numero],
            [T.rtUf, leitura.uf],
          ].map(([rotulo, valor]) => (
            <div key={rotulo} className="min-w-0">
              <dt className="text-text-secondary">{rotulo}</dt>
              <dd className="break-words font-medium text-text-strong">
                {valor}
              </dd>
            </div>
          ))}
        </dl>
        {portal ? (
          <a
            href={portal}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 w-fit items-center gap-1.5 text-[13px] font-medium text-text-strong underline"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            {T.rtPortal(leitura.conselho)}
          </a>
        ) : (
          <p className="text-[13px] text-text-secondary">
            {T.rtSemPortal(leitura.conselho)}
          </p>
        )}
        {leitura.registroConferidoEm ? (
          <Aviso tom="success" role="status">
            {T.rtConferidoEm(
              dataEHoraNaClinica(leitura.registroConferidoEm, fuso),
            )}
          </Aviso>
        ) : (
          <>
            <Aviso tom="warning" role="note">
              {T.rtNaoConferido}
            </Aviso>
            {proprioRt ? (
              <DisabledWithHint hint={T.rtProprioNaoConfere}>
                {botao}
              </DisabledWithHint>
            ) : (
              botao
            )}
          </>
        )}
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IdCard aria-hidden className="size-4" />
          {T.rtTitulo}
        </CardTitle>
        <CardDescription>{T.rtDescricao}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">{corpo()}</CardContent>
    </Card>
  );
}
