"use client";

import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import { statusAposRemarcar } from "@/lib/domain/appointment-status";
import { vinculoEquivalente } from "@/lib/domain/remarcacao";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Pecas compartilhadas pelos dois caminhos de remarcar (menu do bloco e
// arrastar e soltar na grade): a chave do aviso ao paciente, a nota de que a
// confirmacao anterior deixa de valer e o filtro de profissionais que atendem
// o mesmo procedimento pelo mesmo convenio (achados 79 e 85).

/** Codigos da remarcacao que a tela corrige sem fechar o dialogo. */
export const ERROS_CORRIGIVEIS_NA_REMARCACAO: ReadonlySet<string> = new Set([
  "conflito",
  "conflito_recurso",
  "sem_vinculo",
  "fora_da_jornada",
  "bloqueado",
]);

/** O profissional de destino atende o procedimento e o convenio da consulta? */
export function atendeAConsulta(
  contexto: ContextoAgenda,
  consulta: ConsultaDaAgenda,
  professionalId: string,
): boolean {
  if (professionalId === consulta.professional_id) {
    return true;
  }
  const procedureId = consulta.service_link?.procedure?.id;
  if (!procedureId) {
    return false;
  }
  const profissional = contexto.catalogo.profissionais.find(
    (p) => p.id === professionalId,
  );
  if (!profissional?.active) {
    return false;
  }
  return (
    vinculoEquivalente(contexto.catalogo.vinculos, {
      professionalId,
      procedureId,
      insuranceId: consulta.service_link?.insurance?.id ?? null,
    }) !== null
  );
}

/** So quem pode receber a consulta: o atual e os que tem o mesmo vinculo. */
export function profissionaisParaRemarcar(
  contexto: ContextoAgenda,
  consulta: ConsultaDaAgenda,
) {
  return contexto.catalogo.profissionais.filter((p) =>
    atendeAConsulta(contexto, consulta, p.id),
  );
}

export function ChaveAvisarPaciente({
  id,
  marcada,
  aoMudar,
}: {
  id: string;
  marcada: boolean;
  aoMudar: (marcada: boolean) => void;
}) {
  const idDescricao = `${id}-descricao`;
  return (
    <div className="grid gap-1">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Label htmlFor={id}>Avisar o paciente pelo WhatsApp</Label>
        <Switch
          id={id}
          checked={marcada}
          onCheckedChange={aoMudar}
          aria-describedby={idDescricao}
        />
      </div>
      <p id={idDescricao} className="text-xs text-text-secondary">
        {marcada
          ? "Sai uma mensagem automática com o novo dia e horário, só se o paciente autorizou receber mensagens."
          : "Nenhuma mensagem sai. Avise o paciente por telefone ou pela conversa."}
      </p>
    </div>
  );
}

/** A confirmacao anterior valia para o horario antigo: diz isso antes de mover. */
export function NotaDaConfirmacao({
  consulta,
}: {
  consulta: ConsultaDaAgenda;
}) {
  const depois = statusAposRemarcar(consulta.status);
  if (depois === consulta.status) {
    return null;
  }
  return (
    <p className="text-xs text-text-secondary">
      A situação volta para {APPOINTMENT_STATUS[depois].label}, porque a
      confirmação de antes valia para o horário antigo.
    </p>
  );
}
