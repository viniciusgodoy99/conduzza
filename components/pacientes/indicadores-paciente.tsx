import { CalendarCheck, Percent, TriangleAlert } from "lucide-react";

import { BarraComparecimento, SemDado } from "@/components/pacientes/comum";
import type { StatusIcon } from "@/lib/design/status";
import {
  porcentagemDeComparecimento,
  type IndicadoresDoPaciente,
} from "@/lib/domain/pacientes-ui";

// Os tres cartoes da ficha. Total de consultas = compareceu + faltou:
// cancelada com aviso nao e o mesmo que sumir no dia, entao nao entra na
// conta. Sem consulta nenhuma a taxa NAO existe e a tela poe traco, nunca 0%,
// que leria como paciente que nunca aparece.

function Cartao({
  rotulo,
  icone: Icone,
  children,
}: {
  rotulo: string;
  icone: StatusIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 rounded-lg border p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <Icone strokeWidth={1.5} className="size-4 shrink-0" aria-hidden />
        {rotulo}
      </span>
      {children}
    </div>
  );
}

export function IndicadoresPaciente({
  indicadores,
}: {
  indicadores: IndicadoresDoPaciente;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Cartao rotulo="Total de consultas" icone={CalendarCheck}>
        <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
          {indicadores.totalConsultas}
        </span>
      </Cartao>
      <Cartao rotulo="Faltas" icone={TriangleAlert}>
        <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
          {indicadores.faltas}
        </span>
      </Cartao>
      <Cartao rotulo="Taxa de comparecimento" icone={Percent}>
        {indicadores.taxaComparecimento === null ? (
          <span className="font-mono text-2xl leading-none font-semibold">
            <SemDado leitura="Sem consulta registrada" />
          </span>
        ) : (
          <div className="grid gap-2">
            <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
              {porcentagemDeComparecimento(indicadores.taxaComparecimento)}
            </span>
            <BarraComparecimento
              taxa={indicadores.taxaComparecimento}
              mostrarValor={false}
              className="max-w-none"
            />
          </div>
        )}
      </Cartao>
    </div>
  );
}
