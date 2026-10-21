import { Coins } from "lucide-react";
import { useId } from "react";

import {
  dolares,
  estadoDoGasto,
  GASTO_STATUS,
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

// O gasto de IA da clinica no detalhe do Painel geral (onda 1): as ultimas
// 24 horas (a janela movel do teto) contra o teto diario, o mes corrente no
// fuso da clinica e, a parte, o gasto sem o simulador (so o que o agente
// gastou conversando pelo WhatsApp). Em centavos de dolar arredondados pelo
// banco. A barra mede, nao julga (so os tons da barra); o perto do teto e o
// teto atingido vem no chip, em 3 camadas. Server Component.

export function GastoDaIa({
  gasto,
  tetoDiarioCentavos,
}: {
  gasto: GastoNoPainel;
  tetoDiarioCentavos: number | null;
}) {
  const id = useId();
  const estado = estadoDoGasto(gasto.ultimas24hCentavos, tetoDiarioCentavos);
  const legenda =
    tetoDiarioCentavos === null
      ? `${dolares(gasto.ultimas24hCentavos)}, sem teto`
      : `${dolares(gasto.ultimas24hCentavos)} de ${dolares(tetoDiarioCentavos)}`;
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
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div className="grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
            <dt className="text-text-secondary">No mês</dt>
            <dd className="cz-num text-[15px] font-semibold text-text-strong">
              {dolares(gasto.mesCentavos)}
            </dd>
          </div>
          <div className="grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
            <dt className="text-text-secondary">Sem o simulador, no mês</dt>
            <dd className="cz-num text-[15px] font-semibold text-text-strong">
              {dolares(gasto.mesSemSimuladorCentavos)}
            </dd>
          </div>
          <div className="grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3 sm:col-span-2">
            <dt className="text-text-secondary">
              Sem o simulador, nas últimas 24 horas
            </dt>
            <dd className="cz-num text-[15px] font-semibold text-text-strong">
              {dolares(gasto.ultimas24hSemSimuladorCentavos)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
