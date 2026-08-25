import { dataLocal, rotuloDoCanal } from "@/components/leads/rotulos";
import { BlocoFicha, LinhaDaFicha } from "@/components/pacientes/comum";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// De onde a pessoa veio, preservado desde o tempo de lead: o gatilho de
// origem imutavel impede que virar paciente apague a atribuicao. E o que
// responde "qual campanha traz paciente que comparece".
export function OrigemPaciente({
  contato,
  timezone,
}: {
  contato: ContatoDaFicha;
  timezone: string;
}) {
  const canal = rotuloDoCanal(contato.source_channel);
  const quando = contato.source_captured_at ?? contato.first_contact_at;

  return (
    <BlocoFicha titulo="Origem">
      <div className="grid gap-2">
        <LinhaDaFicha rotulo="Canal">
          {canal ?? <span className="text-text-tertiary">Não informado</span>}
        </LinhaDaFicha>
        <LinhaDaFicha rotulo="Campanha">
          {contato.source_campaign ?? (
            <span className="text-text-tertiary">Sem campanha</span>
          )}
        </LinhaDaFicha>
        <LinhaDaFicha rotulo="Chegou em">
          {dataLocal(quando, timezone)}
        </LinhaDaFicha>
      </div>
    </BlocoFicha>
  );
}
