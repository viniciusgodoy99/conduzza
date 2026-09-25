"use client";

import { CalendarClock, Phone } from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ChipDoToque } from "@/components/confirmacoes/chip-do-toque";
import {
  AcaoDeLinha,
  NomeDoPaciente,
  horaLocal,
} from "@/components/confirmacoes/lista-confirmacoes";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FaltaDoDia } from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Aba secundaria da Tela 2: quem faltou hoje e o toque da regua pos falta.
// A falta e sempre acao explicita de alguem (regra 3.5), entao esta lista e o
// registro do que a recepcao marcou, nunca inferencia por passagem de tempo.
//
// Mesmo cartao da lista do dia (docs/06 secao 5.7): grade por subgrid a
// partir de 1280px, com cabecalho de colunas. O toque pos falta tem as 3
// camadas: forma (envelope proprio de cada situacao), rotulo e cor.

const GRADE =
  "xl:grid xl:grid-cols-[56px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(200px,auto)_auto] xl:gap-x-3";
const SUBGRADE = "xl:col-span-full xl:grid xl:grid-cols-subgrid";

export function ListaFaltas({
  faltas,
  timezone,
  podeEditar,
  dicaSemPermissao,
  onRemarcar,
}: {
  faltas: FaltaDoDia[];
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  onRemarcar: (falta: FaltaDoDia) => void;
}) {
  return (
    <Card className="overflow-clip">
      <div className={GRADE}>
        <div
          aria-hidden
          className={cn(
            "sticky top-0 z-[1] hidden h-9 items-center border-b border-border-strong bg-surface-subtle px-3.5 cz-eyebrow text-text-secondary",
            SUBGRADE,
          )}
        >
          <span>Hora</span>
          <span>Paciente</span>
          <span>Procedimento</span>
          <span>Mensagem depois da falta</span>
          <span className="text-right">Ações</span>
        </div>
        <ul className={cn("grid", SUBGRADE)}>
          {faltas.map((falta) => {
            const nome =
              falta.contact?.name ?? falta.contact?.phone_e164 ?? "Sem nome";
            const telefone = falta.contact?.phone_e164 ?? null;
            return (
              <li
                key={falta.id}
                className={cn(
                  "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3.5 py-2 cz-transition last:border-b-0 hover:bg-surface-subtle",
                  SUBGRADE,
                )}
              >
                <span className="w-12 shrink-0 cz-num text-[13px] font-semibold text-text-strong xl:w-auto">
                  {horaLocal(falta.starts_at, timezone)}
                </span>
                <span className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
                  <ContactAvatar
                    name={falta.contact?.name ?? null}
                    phone={telefone ?? ""}
                    size={30}
                  />
                  <NomeDoPaciente
                    contactId={falta.contact_id}
                    nome={nome}
                    faltas={falta.contact?.no_show_count ?? 0}
                  />
                </span>
                <span className="min-w-0 basis-40 truncate text-[13px] text-text-secondary">
                  {falta.service_link?.procedure?.name ?? "Procedimento"}
                </span>
                <span className="flex min-w-0">
                  <ChipDoToque
                    toque={falta.toque}
                    consentimento={falta.consent_estado}
                    horaLocal={(iso) => horaLocal(iso, timezone)}
                    vazio="Sem contato ainda"
                  />
                </span>
                <span className="ml-auto flex items-center gap-0.5 xl:ml-0 xl:justify-self-end">
                  {/* Sem telefone o botao continua visivel e desabilitado,
                      com a dica (docs/06 secao 5.7): sumir escondia o porque. */}
                  <AcaoDeLinha
                    icone={Phone}
                    rotulo={`Ligar para ${nome}`}
                    href={telefone ? `tel:${telefone}` : undefined}
                    externo
                    desabilitado={!telefone}
                    dica={
                      telefone
                        ? `Ligar para ${telefone}`
                        : "Sem telefone cadastrado"
                    }
                  />
                  {podeEditar ? (
                    <Button variant="outline" onClick={() => onRemarcar(falta)}>
                      <CalendarClock aria-hidden />
                      Remarcar
                    </Button>
                  ) : (
                    <DisabledWithHint hint={dicaSemPermissao}>
                      <Button variant="outline" disabled>
                        <CalendarClock aria-hidden />
                        Remarcar
                      </Button>
                    </DisabledWithHint>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {/* O caminho REAL de ativação. Este rodapé mandava para a tela de
          Automações, que é um placeholder: a recepção ia lá, via "módulo em
          construção" e concluía que o recurso não existia, quando o
          interruptor estava a um clique daqui. */}
      <p className="border-t border-border bg-surface-subtle px-3.5 py-3 text-xs text-text-secondary">
        O contato automático depois da falta é a régua de recuperação. Ligue no
        botão <strong>Mensagens automáticas</strong>, aba{" "}
        <strong>Depois da falta</strong>.
      </p>
    </Card>
  );
}
