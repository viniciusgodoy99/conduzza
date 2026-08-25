import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { EtiquetasDoPaciente } from "@/components/pacientes/comum";
import type { PatientTag } from "@/lib/design/status";
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
    <header className="flex flex-wrap items-start gap-4">
      <ContactAvatar name={contato.name} phone={contato.phone_e164} size={48} />
      <div className="grid min-w-0 gap-1.5">
        <h1 className="text-[22px] leading-tight font-semibold">
          {contato.name ?? "Sem nome"}
        </h1>
        <p className="font-mono text-[13px] text-text-secondary">
          {contato.phone_e164}
        </p>
        <p className="text-sm text-text-secondary">
          {contato.insurance?.name ?? "Particular"}
          {contato.insurance && contato.insurance_card
            ? `, carteirinha ${contato.insurance_card}`
            : ""}
        </p>
        <EtiquetasDoPaciente etiquetas={etiquetas} />
      </div>
    </header>
  );
}
