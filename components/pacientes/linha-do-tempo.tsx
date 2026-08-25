import { CalendarRange } from "lucide-react";

import { BlocoFicha, dataHoraLocal } from "@/components/pacientes/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import type { ConsultaDoPaciente } from "@/lib/queries/pacientes";

// Linha do tempo das consultas, da mais recente para a mais antiga. O valor e
// o preco ATUAL do vinculo, passado por exibirPrecoVinculo: "Coberto" e
// rotulo, nunca moeda, e vinculo sem preco informado nao inventa R$ 0,00. Nao
// existe historico de preco cobrado, entao a ficha nao promete um.
export function LinhaDoTempo({
  consultas,
  timezone,
}: {
  consultas: ConsultaDoPaciente[];
  timezone: string;
}) {
  return (
    <BlocoFicha titulo="Consultas">
      {consultas.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Nenhuma consulta ainda"
          description="Assim que a primeira consulta for marcada, ela aparece aqui com profissional, procedimento e situação."
          action={{ label: "Agendar", href: "/agenda" }}
        />
      ) : (
        <ol className="grid gap-4">
          {consultas.map((consulta, indice) => {
            const definicao = APPOINTMENT_STATUS[consulta.status];
            const preco = exibirPrecoVinculo(consulta);
            return (
              <li
                key={consulta.id}
                className="grid grid-cols-[10px_minmax(0,1fr)] gap-3"
              >
                <span
                  className="relative flex justify-center pt-1.5"
                  aria-hidden
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: STATUS_TONE_VARS[definicao.tone].marker,
                    }}
                  />
                  {indice < consultas.length - 1 ? (
                    <span className="absolute top-5 -bottom-4 w-px bg-border" />
                  ) : null}
                </span>
                <div className="grid gap-1.5">
                  <span className="font-mono text-[13px] tabular-nums">
                    {dataHoraLocal(consulta.starts_at, timezone)}
                  </span>
                  <span className="text-sm font-medium">
                    {consulta.procedure_name ?? "Procedimento não informado"}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {consulta.professional_name ?? "Profissional não informado"}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip definition={definicao} />
                    {preco.kind === "vazio" ? null : (
                      <span className="font-mono text-[13px] text-text-secondary tabular-nums">
                        {preco.text}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </BlocoFicha>
  );
}
