import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { EtiquetasDoPaciente } from "@/components/pacientes/comum";
import type { PatientTag } from "@/lib/design/status";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// Identidade da ficha: quem e a pessoa, como falar com ela e o que ela ja
// carrega de etiqueta derivada. Nada aqui e editavel: o cadastro tem bloco
// proprio, na coluna da direita.
export function CabecalhoPaciente({
  contato,
  etiquetas,
}: {
  contato: ContatoDaFicha;
  etiquetas: PatientTag[];
}) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <ContactAvatar name={contato.name} phone={contato.phone_e164} size={56} />
      <div className="grid min-w-0 gap-1.5">
        <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
          {contato.name ?? "Sem nome"}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-text-secondary">
          <span className="cz-num">{formatarTelefone(contato.phone_e164)}</span>
          <span aria-hidden className="size-1 rounded-full bg-border-heavy" />
          <span>
            <span className="sr-only">, </span>
            {contato.insurance?.name ?? "Particular"}
            {contato.insurance && contato.insurance_card ? (
              <>
                , carteirinha{" "}
                <span className="cz-num">{contato.insurance_card}</span>
              </>
            ) : null}
          </span>
        </p>
        <EtiquetasDoPaciente etiquetas={etiquetas} />
      </div>
    </header>
  );
}
