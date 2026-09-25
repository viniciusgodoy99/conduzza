"use client";

import { useDraggable } from "@dnd-kit/core";
import { Zap } from "lucide-react";

import { AppointmentMenu } from "@/components/agenda/appointment-menu";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import { STATUS_TERMINAIS } from "@/lib/domain/appointment-status";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Bloco de consulta na grade, na pele do AppointmentCard do design system
// (docs/06 secao 5.6, C9): fundo da familia do status, barra de 3px na cor do
// status, altura proporcional a duracao. Tres faixas de altura:
// - menos de 48px: uma linha, nome e icone do status no canto;
// - 48 a 71px: nome; procedimento e convenio; rotulo do status (as 3
//   camadas: icone, rotulo e cor);
// - 72px ou mais: acrescenta o horario no topo ("08:00 às 08:30").
// Encaixe: borda tracejada, deslocamento de 8px e "Encaixe" com o Zap, sempre
// na cor neutra (um icone, uma cor). Sem translateY no hover: colide com o
// transform do arrasto (dnd-kit).

const ZAP_DO_ENCAIXE = STATUS_TONE_VARS.neutral.text;

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
  // Faixas de altura (96px/hora na visao Dia, 48px na Semana).
  const umaLinha = height < 48;
  const comHorario = height >= 72;
  const largura = 100 / lanes;
  const encaixe = consulta.is_overbooking;
  const duracaoMin = Math.round(
    (new Date(consulta.ends_at).getTime() -
      new Date(consulta.starts_at).getTime()) /
      60_000,
  );
  const horaDe = (instante: string) =>
    new Date(instante).toLocaleTimeString("pt-BR", {
      timeZone: contexto.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
  const hora = horaDe(consulta.starts_at);
  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";

  return (
    <AppointmentMenu contexto={contexto} consulta={consulta}>
      <button
        type="button"
        ref={setNodeRef}
        {...listeners}
        {...atributosDeArrasto}
        className="absolute z-[3] flex overflow-hidden rounded-md text-left transition-shadow duration-(--dur-fast) outline-none hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid"
        style={{
          top: top + 1,
          height: Math.max(height - 2, 20),
          left: `calc(${lane * largura}% + ${encaixe ? 10 : 2}px)`,
          width: `calc(${largura}% - ${encaixe ? 12 : 4}px)`,
          backgroundColor: tone.bg,
          // So longhands: misturar "border" com "borderLeft" faz o React
          // reclamar e pode perder a barra do status numa atualizacao.
          borderColor: tone.marker,
          borderStyle: encaixe ? "dashed" : "none",
          borderWidth: encaixe ? 1 : 0,
          borderLeftStyle: "solid",
          borderLeftWidth: 3,
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
        {umaLinha ? (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-1 px-2">
            <span className="truncate text-[13px] leading-[14px] font-semibold text-text-strong">
              {nome}
            </span>
            {Icone ? (
              <Icone
                className="size-3.5 shrink-0"
                style={{ color: tone.text }}
                aria-hidden
              />
            ) : null}
          </span>
        ) : (
          <span
            className={
              comHorario
                ? "flex min-w-0 flex-1 flex-col px-2 py-1"
                : "flex min-w-0 flex-1 flex-col px-2 py-0.5"
            }
          >
            {comHorario ? (
              <span
                className="truncate cz-num text-[11px] leading-[14px] font-semibold"
                style={{ color: tone.text }}
              >
                {hora} às {horaDe(consulta.ends_at)}
              </span>
            ) : null}
            <span className="truncate text-[13px] leading-[14px] font-semibold text-text-strong">
              {nome}
            </span>
            <span className="truncate text-[11px] leading-[14px] text-text-secondary">
              {consulta.service_link?.procedure?.name ?? "Procedimento"}
              {" · "}
              {consulta.service_link?.insurance?.name ?? "Particular"}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[11px] leading-[14px] font-semibold">
              {Icone ? (
                <Icone
                  className="size-3 shrink-0"
                  style={{ color: tone.text }}
                  aria-hidden
                />
              ) : null}
              <span className="truncate" style={{ color: tone.text }}>
                {definicao.label}
                {consulta.approval_status === "pendente"
                  ? " · aguarda aprovação"
                  : ""}
                {" · "}
                <span className="cz-num">{duracaoMin} min</span>
              </span>
              {encaixe ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5"
                  style={{ color: ZAP_DO_ENCAIXE }}
                >
                  <span aria-hidden>·</span>
                  <Zap className="size-3" aria-hidden />
                  Encaixe
                </span>
              ) : null}
            </span>
          </span>
        )}
      </button>
    </AppointmentMenu>
  );
}
