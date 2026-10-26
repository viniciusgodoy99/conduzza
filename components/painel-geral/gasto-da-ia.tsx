import { Coins } from "lucide-react";
import { useId } from "react";

import {
  dolares,
  dolaresPrecisos,
  estadoDoGasto,
  GASTO_STATUS,
  textoDasChamadas,
} from "@/components/painel-geral/painel-geral";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GastoNoPainel } from "@/lib/queries/painel-geral";
import { cn } from "@/lib/utils";

// O gasto de IA da clinica no detalhe do Painel geral (onda 1): as ultimas
// 24 horas (a janela movel do teto) contra o teto diario, o mes corrente no
// fuso da clinica e, a parte, o gasto sem o simulador (so o que o agente
// gastou conversando pelo WhatsApp). Em centavos de dolar arredondados pelo
// banco. A barra mede, nao julga (so os tons da barra); o perto do teto e o
// teto atingido vem no chip, em 3 camadas. Server Component.
//
// Segunda leva (26/10/2026, pedido do dono: "Esse gasto de IA ta certo?"):
// os quatro valores com a precisao real (microdolares do banco: "US$
// 0,001"; nunca "US$ 0,00" quando houve gasto) e as chamadas ao modelo de
// cada recorte. A barra continua medindo em centavos contra o teto (a regra
// do teto e em centavos).

/** Um recorte: o valor com a precisao real e as chamadas embaixo. */
function Recorte({
  rotulo,
  microdolares,
  chamadas,
  className,
}: {
  rotulo: string;
  microdolares: number;
  chamadas: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3",
        className,
      )}
    >
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="grid gap-0.5">
        <span className="cz-num text-[15px] font-semibold text-text-strong">
          {dolaresPrecisos(microdolares)}
        </span>
        <span className="text-[12px] text-text-secondary">
          {textoDasChamadas(chamadas)}
        </span>
      </dd>
    </div>
  );
}

export function GastoDaIa({
  gasto,
  tetoDiarioCentavos,
}: {
  gasto: GastoNoPainel;
  tetoDiarioCentavos: number | null;
}) {
  const id = useId();
  const estado = estadoDoGasto(gasto.ultimas24hCentavos, tetoDiarioCentavos);
  const nas24h = dolaresPrecisos(gasto.ultimas24hMicrodolares);
  const legenda =
    tetoDiarioCentavos === null
      ? `${nas24h}, sem teto`
      : `${nas24h} de ${dolares(tetoDiarioCentavos)}`;
  return (
    <Card role="region" aria-labelledby={`${id}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Coins className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>Gasto de IA</CardTitle>
            <CardDescription>
              Em dólares, com o simulador. O teto vale para as últimas 24 horas.
            </CardDescription>
          </div>
        </div>
        {estado === "perto" || estado === "atingido" ? (
          <CardAction>
            <StatusChip size="sm" definition={GASTO_STATUS[estado]} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <BarraDeProgresso
          valor={gasto.ultimas24hCentavos}
          maximo={tetoDiarioCentavos ?? 0}
          rotulo="Últimas 24 horas"
          legenda={legenda}
          ariaLabel={`Gasto das últimas 24 horas: ${legenda}`}
        />
        <p className="-mt-2 text-[12px] text-text-secondary">
          {textoDasChamadas(gasto.ultimas24hChamadas)} nas últimas 24 horas
        </p>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <Recorte
            rotulo="No mês"
            microdolares={gasto.mesMicrodolares}
            chamadas={gasto.mesChamadas}
          />
          <Recorte
            rotulo="Sem o simulador, no mês"
            microdolares={gasto.mesSemSimuladorMicrodolares}
            chamadas={gasto.mesSemSimuladorChamadas}
          />
          <Recorte
            rotulo="Sem o simulador, nas últimas 24 horas"
            microdolares={gasto.ultimas24hSemSimuladorMicrodolares}
            chamadas={gasto.ultimas24hSemSimuladorChamadas}
            className="sm:col-span-2"
          />
        </dl>
      </CardContent>
    </Card>
  );
}
