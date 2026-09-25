"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  aprovarEncaixeAction,
  recusarEncaixeAction,
} from "@/app/(app)/agenda/actions";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  APPOINTMENT_STATUS,
  STATUS_TONE_VARS,
  type AppointmentStatus,
  type StatusDefinition,
} from "@/lib/design/status";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Painel lateral "Pendente de voce" (264px, cartao do design system, docs/06
// secao 5.6): encaixes sugeridos pela IA aguardando aprovacao humana. Abaixo,
// a legenda compacta dos 10 status da agenda (3 camadas: icone, rotulo e
// cor). "Aprovar" vai no botao suave: o unico lime cheio da tela e o "Novo
// agendamento".

const CHIP_ENCAIXE_IA: StatusDefinition = {
  label: "Encaixe da IA",
  tone: "ai",
  icon: Sparkles,
};

function diaEHora(instante: string, timezone: string): string {
  const data = new Date(instante);
  const dia = data.toLocaleDateString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const hora = data.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia} · ${hora}`;
}

export function PendingPanel({
  contexto,
  pendencias,
}: {
  contexto: ContextoAgenda;
  pendencias: ConsultaDaAgenda[];
}) {
  const queryClient = useQueryClient();
  const [emAndamento, setEmAndamento] = useState<{
    id: string;
    acao: "aprovar" | "recusar";
  } | null>(null);

  async function tratar(id: string, acao: "aprovar" | "recusar") {
    setEmAndamento({ id, acao });
    try {
      const resultado =
        acao === "aprovar"
          ? await aprovarEncaixeAction(id)
          : await recusarEncaixeAction(id);
      if (resultado.ok) {
        toast.success(
          acao === "aprovar" ? "Encaixe aprovado" : "Encaixe recusado",
        );
      } else if (resultado.code === "ja_tratado") {
        toast.info(resultado.error ?? "Este encaixe já foi tratado.");
      } else {
        toast.error(resultado.error ?? "Não foi possível tratar o encaixe.");
      }
    } catch {
      toast.error("Não foi possível tratar o encaixe. Tente de novo.");
    } finally {
      setEmAndamento(null);
      await queryClient.invalidateQueries({
        queryKey: ["agenda", contexto.clinicId],
      });
    }
  }

  return (
    <aside
      aria-label="Pendente de você"
      className="hidden w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm xl:flex"
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-base font-bold tracking-[-0.01em]">
          Pendente de você
        </h2>
      </div>

      <div className="flex cz-scroll min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {pendencias.length === 0 ? (
          // Vazio compacto no tom da IA (ladrilho lime suave com o Sparkles):
          // quem sugere encaixe e a IA.
          <div className="flex flex-col items-center justify-center gap-2 px-2 py-7 text-center">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-card bg-ai-bg">
              <Sparkles className="size-[18px] text-ai-text" aria-hidden />
            </span>
            <p className="text-sm font-bold tracking-[-0.01em] text-text-strong">
              Nada pendente de você
            </p>
            <p className="text-[13px] text-text-secondary">
              Quando a IA sugerir um encaixe, ele aparece aqui para aprovação.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pendencias.map((consulta) => {
              const ocupado = emAndamento?.id === consulta.id;
              return (
                <li
                  key={consulta.id}
                  className="flex flex-col gap-2.5 rounded-xl border border-border p-3"
                >
                  <span className="flex">
                    <StatusChip size="sm" definition={CHIP_ENCAIXE_IA} />
                  </span>
                  <div className="grid gap-0.5">
                    <p className="truncate text-[13px] font-semibold text-text-strong">
                      {consulta.contact?.name ??
                        consulta.contact?.phone_e164 ??
                        "Paciente"}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {consulta.service_link?.procedure?.name ??
                        "Procedimento não informado"}
                    </p>
                    <p className="cz-num text-xs text-text-secondary">
                      {diaEHora(consulta.starts_at, contexto.timezone)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {contexto.podeEditar ? (
                      <>
                        <Button
                          variant="secondary"
                          className="h-10 flex-1"
                          disabled={ocupado}
                          onClick={() => tratar(consulta.id, "aprovar")}
                        >
                          {ocupado && emAndamento?.acao === "aprovar" ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : null}
                          Aprovar
                        </Button>
                        <Button
                          variant="outline"
                          className="h-10 flex-1"
                          disabled={ocupado}
                          onClick={() => tratar(consulta.id, "recusar")}
                        >
                          {ocupado && emAndamento?.acao === "recusar" ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : null}
                          Recusar
                        </Button>
                      </>
                    ) : (
                      <>
                        <DisabledWithHint
                          hint={contexto.dica}
                          className="flex-1"
                        >
                          <Button
                            variant="secondary"
                            className="h-10 w-full"
                            disabled
                          >
                            Aprovar
                          </Button>
                        </DisabledWithHint>
                        <DisabledWithHint
                          hint={contexto.dica}
                          className="flex-1"
                        >
                          <Button
                            variant="outline"
                            className="h-10 w-full"
                            disabled
                          >
                            Recusar
                          </Button>
                        </DisabledWithHint>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-2 border-t border-border pt-4">
          <h3 className="cz-eyebrow text-text-secondary">
            Legenda de situações
          </h3>
          <ul className="grid gap-1.5">
            {(
              Object.entries(APPOINTMENT_STATUS) as [
                AppointmentStatus,
                StatusDefinition,
              ][]
            ).map(([status, definicao]) => {
              const tone = STATUS_TONE_VARS[definicao.tone];
              const Icone = definicao.icon;
              return (
                <li key={status} className="flex items-center gap-2">
                  {Icone ? (
                    <Icone
                      className="size-3.5 shrink-0"
                      style={{ color: tone.text }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="text-xs text-text-secondary">
                    {definicao.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
