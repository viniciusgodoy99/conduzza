"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, History, ShieldCheck, ShieldOff } from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import type { ConsentInfo, ContactSummary } from "@/lib/queries/conversations";

// Painel de contexto (handoff): dados do contato, estado da autorizacao de
// mensagens e origem. Agendamento e historico chegam com as Fases 2 e 4:
// os blocos existem como placeholders honestos.

const CONSENT_SOURCE_LABEL: Record<string, string> = {
  formulario_site: "Formulário do site",
  anuncio_ctwa: "Anúncio click-to-WhatsApp",
  recepcao: "Cadastro na recepção",
  importacao_planilha: "Importação de planilha",
  conversa: "Iniciou a conversa",
};

const STAGE_LABEL: Record<string, string> = {
  novo: "Novo",
  em_contato: "Em contato",
  aguardando_resposta: "Aguardando resposta",
  agendou: "Agendou",
  compareceu: "Compareceu",
  perdido: "Perdido",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 border-b px-4 py-4 last:border-b-0">
      <h3 className="text-[10.5px] font-semibold tracking-[0.08em] text-text-tertiary uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-[12.5px]">
      <span className="text-text-tertiary">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

export function ContextPanel({
  contact,
  consent,
}: {
  contact: ContactSummary;
  consent: ConsentInfo;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <Section title="Contato">
        <div className="flex items-center gap-3">
          <ContactAvatar name={contact.name} phone={contact.phone_e164} />
          <div className="grid min-w-0">
            <span className="truncate text-sm font-semibold">
              {contact.name ?? "Sem nome"}
            </span>
            <span className="font-mono text-xs text-text-secondary tabular-nums">
              {contact.phone_e164}
            </span>
          </div>
        </div>
        <Row
          label="Tipo"
          value={contact.kind === "paciente" ? "Paciente" : "Lead"}
        />
        <Row
          label="Etapa"
          value={STAGE_LABEL[contact.funnel_stage] ?? contact.funnel_stage}
        />
        <Row
          label="Primeiro contato"
          value={
            contact.first_contact_at
              ? format(new Date(contact.first_contact_at), "dd/MM/yyyy", {
                  locale: ptBR,
                })
              : null
          }
        />
      </Section>

      <Section title="Autorização de mensagens">
        {consent ? (
          <div className="flex items-start gap-2 text-[12.5px]">
            <ShieldCheck
              strokeWidth={1.5}
              className="mt-0.5 size-4 shrink-0 [color:var(--success)]"
            />
            <div className="grid">
              <span className="font-medium [color:var(--success-text)]">
                Autorizado a receber mensagens
              </span>
              <span className="text-text-tertiary">
                {CONSENT_SOURCE_LABEL[consent.source] ?? consent.source} ·{" "}
                {format(new Date(consent.granted_at), "dd/MM/yyyy", {
                  locale: ptBR,
                })}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-[12.5px]">
            <ShieldOff
              strokeWidth={1.5}
              className="mt-0.5 size-4 shrink-0 [color:var(--alert)]"
            />
            <div className="grid">
              <span className="font-medium [color:var(--alert-text)]">
                Sem autorização para receber mensagens
              </span>
              <span className="text-text-tertiary">
                A clínica só pode responder quando o contato escrever primeiro.
              </span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Origem">
        {contact.source_channel || contact.source_campaign ? (
          <div className="grid gap-1.5">
            <Row label="Canal" value={contact.source_channel} />
            <Row label="Campanha" value={contact.source_campaign} />
          </div>
        ) : (
          <p className="text-[12.5px] text-text-tertiary">
            Origem ainda não identificada. A captura automática chega com o
            módulo de leads.
          </p>
        )}
      </Section>

      <Section title="Agendamentos">
        <p className="flex items-center gap-2 text-[12.5px] text-text-tertiary">
          <CalendarClock strokeWidth={1.5} className="size-4 shrink-0" />
          Os agendamentos do contato aparecem aqui quando a agenda entrar no ar.
        </p>
      </Section>

      <Section title="Histórico">
        <p className="flex items-center gap-2 text-[12.5px] text-text-tertiary">
          <History strokeWidth={1.5} className="size-4 shrink-0" />A linha do
          tempo completa chega com a ficha do paciente.
        </p>
      </Section>
    </div>
  );
}
