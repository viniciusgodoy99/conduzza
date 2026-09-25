import { CalendarClock } from "lucide-react";

import { StatusChip } from "@/components/shared/status-chip";
import { APPOINTMENT_FLAG, APPOINTMENT_STATUS } from "@/lib/design/status";
import type { LinhaDeHistorico } from "@/lib/queries/agenda";

// Conteudo de uma linha da trilha da consulta, compartilhado pelo historico
// da consulta e pelo historico do dia (achado 84): QUEM mudou (nome do
// perfil), O QUE mudou (situacao em 3 camadas ou a remarcacao com o antes e o
// depois) e QUANDO (data e hora no fuso da clinica).

const AUTORIA_SEM_PERFIL: Record<LinhaDeHistorico["changed_by"], string> = {
  usuario: "Equipe",
  ia: "IA",
  paciente: "Paciente",
  sistema: "Sistema",
};

/** "dd/MM às HH:mm" no fuso da clinica. */
export function momentoNoFuso(timezone: string, instante: string): string {
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
  return `${dia} às ${hora}`;
}

export function autorDaLinha(linha: LinhaDeHistorico): string {
  if (linha.changed_by === "usuario" && linha.autor_nome) {
    return linha.autor_nome;
  }
  return AUTORIA_SEM_PERFIL[linha.changed_by];
}

export function ConteudoDaLinhaDoHistorico({
  linha,
  timezone,
  nomeDoProfissional,
}: {
  linha: LinhaDeHistorico;
  timezone: string;
  nomeDoProfissional: (id: string | null) => string | null;
}) {
  const autor = autorDaLinha(linha);

  if (
    linha.kind === "remarcacao" &&
    linha.previous_starts_at &&
    linha.new_starts_at
  ) {
    const de = nomeDoProfissional(linha.previous_professional_id);
    const para = nomeDoProfissional(linha.new_professional_id);
    const trocouProfissional =
      linha.previous_professional_id !== linha.new_professional_id;
    return (
      <div className="grid min-w-0 gap-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-strong">
          <CalendarClock
            className="size-4 shrink-0 text-text-secondary"
            aria-hidden
          />
          Remarcada
        </span>
        <span className="text-sm text-text-secondary">
          De{" "}
          <span className="cz-num">
            {momentoNoFuso(timezone, linha.previous_starts_at)}
          </span>{" "}
          para{" "}
          <span className="cz-num">
            {momentoNoFuso(timezone, linha.new_starts_at)}
          </span>
          {trocouProfissional && de && para ? ` (de ${de} para ${para})` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
          <span>Situação depois:</span>
          <StatusChip definition={APPOINTMENT_STATUS[linha.status]} />
          <span>por {autor}</span>
        </span>
      </div>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StatusChip
        definition={
          // Pedido de remarcacao: evento sem mudanca de situacao.
          linha.event === "remarcacao_pedida"
            ? APPOINTMENT_FLAG.remarcacao_pedida
            : APPOINTMENT_STATUS[linha.status]
        }
      />
      <span className="text-sm text-text-secondary">por {autor}</span>
    </span>
  );
}
