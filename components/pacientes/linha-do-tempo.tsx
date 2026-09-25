import { CalendarPlus, History } from "lucide-react";
import Link from "next/link";

import { BlocoFicha, dataHoraLocal } from "@/components/pacientes/comum";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import type { ConsultaDoPaciente } from "@/lib/queries/pacientes";

// Linha do tempo das consultas, da mais recente para a mais antiga. O valor e
// o preco ATUAL do vinculo, passado por exibirPrecoVinculo: "Coberto" e
// rotulo, nunca moeda, e vinculo sem preco informado nao inventa R$ 0,00. Nao
// existe historico de preco cobrado, entao a ficha nao promete um.
//
// O marcador colorido e so enfeite (aria-hidden): o status vai no StatusChip,
// com icone, rotulo e cor. Profissional so enxerga a propria agenda (RLS de
// appointment), e o vazio diz isso em vez de "nenhuma consulta ainda".
export function LinhaDoTempo({
  consultas,
  timezone,
  contactId,
  podeAgendar,
  dicaAgendar,
  soDaSuaAgenda = false,
}: {
  consultas: ConsultaDoPaciente[];
  timezone: string;
  contactId: string;
  podeAgendar: boolean;
  dicaAgendar: string;
  soDaSuaAgenda?: boolean;
}) {
  const agendar = podeAgendar ? (
    <Button variant="outline" asChild>
      <Link href={`/agenda?agendar=${contactId}`}>
        <CalendarPlus aria-hidden />
        Agendar
      </Link>
    </Button>
  ) : (
    <DisabledWithHint hint={dicaAgendar}>
      <Button variant="outline" disabled>
        <CalendarPlus aria-hidden />
        Agendar
      </Button>
    </DisabledWithHint>
  );

  return (
    <BlocoFicha titulo="Consultas">
      {consultas.length === 0 ? (
        soDaSuaAgenda ? (
          // History, e nao CalendarRange: o "Vale ate" do pacote usa esse
          // icone em outra cor na mesma ficha (tabela de icones, 4.6).
          <EmptyState
            icon={History}
            title="Nenhuma consulta deste paciente na sua agenda"
            description="Você vê só as consultas da sua agenda. As marcadas com outros profissionais não aparecem aqui."
          >
            {agendar}
          </EmptyState>
        ) : (
          <EmptyState
            icon={History}
            title="Nenhuma consulta ainda"
            description="Assim que a primeira consulta for marcada, ela aparece aqui com profissional, procedimento e situação."
          >
            {agendar}
          </EmptyState>
        )
      ) : (
        <ol className="grid">
          {consultas.map((consulta, indice) => {
            const definicao = APPOINTMENT_STATUS[consulta.status];
            const preco = exibirPrecoVinculo(consulta);
            return (
              <li
                key={consulta.id}
                className="relative grid grid-cols-[12px_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
              >
                <span aria-hidden className="flex justify-center pt-[5px]">
                  <span
                    className="size-2.5 shrink-0 rounded-full ring-[3px] ring-card"
                    style={{
                      backgroundColor: STATUS_TONE_VARS[definicao.tone].marker,
                    }}
                  />
                </span>
                {indice < consultas.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute top-5 -bottom-0 left-[5px] w-px bg-border-heavy"
                  />
                ) : null}
                <div className="grid min-w-0 gap-1">
                  <span className="cz-num text-[12.5px] text-text-secondary">
                    {dataHoraLocal(consulta.starts_at, timezone)}
                  </span>
                  <span className="text-sm font-semibold text-text-strong">
                    {consulta.procedure_name ?? "Procedimento não informado"}
                  </span>
                  <span className="text-[13px] text-text-secondary">
                    {consulta.professional_name ?? "Profissional não informado"}
                  </span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <StatusChip definition={definicao} />
                    {preco.kind === "vazio" ? null : (
                      <span className="cz-num text-[13px] text-text-secondary">
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
