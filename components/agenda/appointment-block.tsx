"use client";

import { useDraggable } from "@dnd-kit/core";

import { AppointmentMenu } from "@/components/agenda/appointment-menu";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import { STATUS_TERMINAIS } from "@/lib/domain/appointment-status";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Bloco de consulta na grade: altura proporcional a duracao, borda esquerda
// de 4px na cor do status, nome 13px semibold, procedimento 11px, icone do
// status no canto. Menos de 30 min mostra so o nome. Encaixe: borda
// tracejada com deslocamento de 8px. As 3 camadas de status (icone, rotulo,
// cor) vem do design system.

export function AppointmentBlock({
  contexto,
  consulta,
  top,
  height,
  lane,
  lanes,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}) {
  // Arrastavel para remarcar (sensor exige 8px de movimento, entao o clique
  // continua abrindo o menu). Status terminal nao se remarca.
  const arrastavel =
    contexto.podeEditar && !STATUS_TERMINAIS.includes(consulta.status);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: consulta.id,
      data: { consulta },
      disabled: !arrastavel,
    });
  // O dnd-kit marca aria-disabled quando o arrasto esta desligado (status
  // terminal), mas o MENU do bloco continua valido (ver historico): sem esta
  // limpeza, leitores de tela e testes tratam o bloco como inerte.
  const { "aria-disabled": _ariaDisabledDoDnd, ...atributosDeArrasto } =
    attributes;
  void _ariaDisabledDoDnd;

  const definicao = APPOINTMENT_STATUS[consulta.status];
  const tone = STATUS_TONE_VARS[definicao.tone];
  const Icone = definicao.icon;
  const curto = height < 48; // menos de 30 min em 96px/hora
  const largura = 100 / lanes;
  const encaixe = consulta.is_overbooking;
  const duracaoMin = Math.round(
    (new Date(consulta.ends_at).getTime() -
      new Date(consulta.starts_at).getTime()) /
      60_000,
  );
  const hora = new Date(consulta.starts_at).toLocaleTimeString("pt-BR", {
    timeZone: contexto.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <AppointmentMenu contexto={contexto} consulta={consulta}>
      <button
        type="button"
        ref={setNodeRef}
        {...listeners}
        {...atributosDeArrasto}
        className="absolute z-[3] overflow-hidden rounded-[6px] border bg-card text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2"
        style={{
          top,
          height: Math.max(height, 20),
          left: `calc(${lane * largura}% + ${encaixe ? 10 : 2}px)`,
          width: `calc(${largura}% - ${encaixe ? 12 : 4}px)`,
          borderLeftWidth: 4,
          borderLeftColor: tone.marker,
          borderStyle: encaixe ? "dashed" : "solid",
          ...(transform
            ? {
                transform: `translate(${transform.x}px, ${transform.y}px)`,
                zIndex: 30,
                opacity: 0.85,
              }
            : {}),
          ...(isDragging ? { cursor: "grabbing" } : {}),
        }}
        aria-label={`${consulta.contact?.name ?? "Paciente"}, ${hora}, ${definicao.label}`}
      >
        <span className="flex h-full flex-col gap-0.5 px-2 py-1">
          <span className="flex items-center justify-between gap-1">
            <span className="truncate text-[13px] leading-tight font-semibold">
              {consulta.contact?.name ??
                consulta.contact?.phone_e164 ??
                "Paciente"}
            </span>
            {Icone ? (
              <Icone
                strokeWidth={1.5}
                className="size-3.5 shrink-0"
                style={{ color: tone.text }}
                aria-hidden
              />
            ) : null}
          </span>
          {curto ? null : (
            <>
              <span className="truncate text-[11px] text-text-secondary">
                {consulta.service_link?.procedure?.name ?? ""}
                {consulta.service_link?.insurance?.name
                  ? ` · ${consulta.service_link.insurance.name}`
                  : " · Particular"}
              </span>
              <span
                className="mt-auto truncate text-[10.5px] font-medium"
                style={{ color: tone.text }}
              >
                {definicao.label}
                {consulta.approval_status === "pendente"
                  ? " · aguarda aprovação"
                  : ""}
                {` · ${duracaoMin} min`}
              </span>
            </>
          )}
        </span>
      </button>
    </AppointmentMenu>
  );
}
