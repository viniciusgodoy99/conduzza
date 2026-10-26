import { Milestone } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import {
  PASSO_STATUS,
  passosDaImplantacao,
  TEXTOS_DO_PAINEL,
  textoDaImplantacao,
  type PassoDaImplantacao,
} from "@/components/painel-geral/painel-geral";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ClinicaNoPainel } from "@/lib/queries/painel-geral";

// A implantacao de uma clinica no Painel geral (segunda leva, 26/10/2026;
// escolha (2) do dono): "N de 6 passos", com a lista dos passos no detalhe
// e na dica da lista. Cada passo Feito (CircleCheck, sucesso) ou Falta
// (CircleDashed, neutro), os pares do requisito da producao: 3 camadas. O
// banco decide cada passo (migration 20261026110000); o nome e o que ele
// contou moram em painel-geral.ts.

/** A ancora do cartao no detalhe: o link da lista leva direto para ele. */
export const ANCORA_DA_IMPLANTACAO = "implantacao";

function ListaDePassos({
  passos,
  rotuloId,
  comDetalhe,
}: {
  passos: readonly PassoDaImplantacao[];
  rotuloId?: string;
  /** No detalhe, o que o banco contou embaixo de cada passo. */
  comDetalhe: boolean;
}) {
  return (
    <ul aria-labelledby={rotuloId} className="grid gap-2">
      {passos.map((passo) => (
        <li key={passo.chave} className="flex items-start gap-2">
          <StatusChip
            size="sm"
            className="mt-px shrink-0"
            definition={PASSO_STATUS[passo.feito ? "feito" : "falta"]}
          />
          <span className="grid gap-0.5">
            <span>{passo.rotulo}</span>
            {comDetalhe ? (
              <span className="text-[12px] text-text-secondary">
                {passo.detalhe}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A celula Implantacao da lista: "4 de 6 passos" leva ao cartao do detalhe,
 * e a dica (no foco e no ponteiro) lista os passos.
 */
export function ImplantacaoNaLinha({
  clinica,
}: {
  clinica: Pick<ClinicaNoPainel, "id" | "nome" | "implantacao">;
}) {
  const passos = passosDaImplantacao(clinica);
  const texto = textoDaImplantacao(
    clinica.implantacao.feitos,
    clinica.implantacao.total,
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/painel-geral/${clinica.id}#${ANCORA_DA_IMPLANTACAO}`}
          aria-label={`${texto} da implantação da ${clinica.nome}`}
          className="inline-flex min-h-10 items-center text-text-strong underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="cz-num">{texto}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-[320px] p-2.5">
        <ListaDePassos passos={passos} comDetalhe={false} />
      </TooltipContent>
    </Tooltip>
  );
}

/** O cartao "Implantação" do detalhe. */
export function ImplantacaoDaClinicaCartao({
  clinica,
}: {
  clinica: Pick<ClinicaNoPainel, "implantacao">;
}) {
  const id = useId();
  const passos = passosDaImplantacao(clinica);
  return (
    <Card
      id={ANCORA_DA_IMPLANTACAO}
      role="region"
      aria-labelledby={`${id}-titulo`}
      className="scroll-mt-4"
    >
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Milestone className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>
              {TEXTOS_DO_PAINEL.implantacaoTitulo}
            </CardTitle>
            <CardDescription>
              {TEXTOS_DO_PAINEL.implantacaoDescricao}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <span className="cz-num text-[13px] font-semibold text-text-strong">
            {textoDaImplantacao(
              clinica.implantacao.feitos,
              clinica.implantacao.total,
            )}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="text-[13px]">
        <ListaDePassos passos={passos} rotuloId={`${id}-titulo`} comDetalhe />
      </CardContent>
    </Card>
  );
}
