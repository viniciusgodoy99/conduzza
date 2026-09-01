"use client";

import { CalendarClock, Phone } from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ChipDoToque } from "@/components/confirmacoes/chip-do-toque";
import { horaLocal } from "@/components/confirmacoes/lista-confirmacoes";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { temRiscoDeFalta } from "@/lib/domain/etiquetas";
import { PATIENT_TAG } from "@/lib/design/status";
import type { FaltaDoDia } from "@/lib/queries/confirmacoes";

// Aba secundaria da Tela 2: quem faltou hoje e o toque da regua pos falta.
// A falta e sempre acao explicita de alguem (regra 3.5), entao esta lista e o
// registro do que a recepcao marcou, nunca inferencia por passagem de tempo.
//
// O toque pos falta tem as 3 camadas: forma (envelope com certo ou com xis),
// rotulo em texto e cor.

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
    <div className="overflow-hidden rounded-lg border">
      <ul className="grid">
        {faltas.map((falta) => {
          const nome =
            falta.contact?.name ?? falta.contact?.phone_e164 ?? "Sem nome";
          const telefone = falta.contact?.phone_e164 ?? null;
          const faltasAnteriores = falta.contact?.no_show_count ?? 0;
          const IconeDeRisco = PATIENT_TAG.risco_de_falta.icon;
          return (
            <li
              key={falta.id}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0"
            >
              <span className="w-12 shrink-0 font-mono text-[13px] tabular-nums">
                {horaLocal(falta.starts_at, timezone)}
              </span>
              <ContactAvatar
                name={falta.contact?.name ?? null}
                phone={telefone ?? ""}
                size={32}
              />
              <span className="flex min-w-0 flex-1 basis-40 items-center gap-1.5">
                {temRiscoDeFalta(faltasAnteriores) && IconeDeRisco ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full"
                        style={{
                          color: "var(--alert-text)",
                          backgroundColor: "var(--alert-bg)",
                        }}
                      >
                        <IconeDeRisco
                          strokeWidth={1.5}
                          className="size-3.5"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {faltasAnteriores} faltas anteriores
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {faltasAnteriores} faltas anteriores
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <span className="truncate text-sm font-medium">{nome}</span>
              </span>
              <span className="min-w-0 basis-40 truncate text-[13px] text-text-secondary">
                {falta.service_link?.procedure?.name ?? "Procedimento"}
              </span>
              <ChipDoToque
                toque={falta.toque}
                horaLocal={(iso) => horaLocal(iso, timezone)}
                vazio="Sem contato ainda"
              />
              <span className="ml-auto flex items-center gap-1">
                {telefone ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    asChild
                  >
                    <a
                      href={`tel:${telefone}`}
                      aria-label={`Ligar para ${nome}`}
                    >
                      <Phone strokeWidth={1.5} className="size-4" aria-hidden />
                    </a>
                  </Button>
                ) : null}
                {podeEditar ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10"
                    onClick={() => onRemarcar(falta)}
                  >
                    <CalendarClock
                      strokeWidth={1.5}
                      className="size-4"
                      aria-hidden
                    />
                    Remarcar
                  </Button>
                ) : (
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10"
                      disabled
                    >
                      <CalendarClock
                        strokeWidth={1.5}
                        className="size-4"
                        aria-hidden
                      />
                      Remarcar
                    </Button>
                  </DisabledWithHint>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {/* O caminho REAL de ativação. Este rodapé mandava para a tela de
          Automações, que é um placeholder: a recepção ia lá, via "módulo em
          construção" e concluía que o recurso não existia, quando o
          interruptor estava a um clique daqui. */}
      <p className="border-t px-3 py-2 text-xs text-text-secondary">
        O contato automático depois da falta é a régua de recuperação (no dia da
        falta e dois dias depois). Ligue no botão{" "}
        <strong>Mensagens automáticas</strong>, aba{" "}
        <strong>Depois da falta</strong>.
      </p>
    </div>
  );
}
