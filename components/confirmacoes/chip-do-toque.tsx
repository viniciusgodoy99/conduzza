import {
  Clock3,
  MailCheck,
  MailX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { EstadoDoToque } from "@/lib/queries/confirmacoes";

// O que aconteceu com a mensagem automática desta consulta.
//
// Antes disto, "enviada às 08:12", "na fila", "pulada porque o paciente não
// autorizou" e "não planejada porque o motor está parado" apareciam todos como
// a mesma linha, sem chip nenhum: a recepção não tinha como saber se o sistema
// já tinha falado com o paciente. Ela cobrava de novo às cegas, ou pior,
// confiava que a régua tinha cobrado quando nada saiu.
//
// Três camadas (seção 5 do CLAUDE.md): ícone com forma distinta, rótulo em
// texto e cor. Nunca só cor, nunca o mesmo ícone em cores diferentes.

/** Motivos gravados em cadence_run.skipped_reason, em português de recepção. */
const MOTIVO: Record<string, string> = {
  sem_consentimento: "não autorizou mensagens",
  desconectado: "WhatsApp estava fora do ar",
  fora_janela: "fora do horário de envio",
  condicao_parada: "não era mais necessária",
  falha_envio: "falhou no envio",
  teto_gasto: "limite de gasto atingido",
};

type Aparencia = {
  icone: LucideIcon;
  rotulo: string;
  cor: string;
  fundo: string;
};

function aparencia(
  toque: EstadoDoToque,
  horaLocal: (iso: string) => string,
): Aparencia | null {
  switch (toque.situacao) {
    case "enviado":
      return {
        icone: MailCheck,
        rotulo: `Mensagem enviada às ${horaLocal(toque.em)}`,
        cor: "var(--success-text)",
        fundo: "var(--success-bg)",
      };
    case "na_fila":
      return {
        icone: Clock3,
        rotulo: `Mensagem sai às ${horaLocal(toque.para)}`,
        cor: "var(--info-text)",
        fundo: "var(--info-bg)",
      };
    case "pulado":
      return {
        icone: TriangleAlert,
        rotulo: `Não enviada: ${MOTIVO[toque.motivo] ?? toque.motivo}`,
        cor: "var(--warning-text)",
        fundo: "var(--warning-bg)",
      };
    case "nenhum":
      return null;
  }
}

export function ChipDoToque({
  toque,
  horaLocal,
  /**
   * O que dizer quando não existe toque nenhum. A lista do dia prefere não
   * dizer nada (a consulta pode simplesmente não ter vencido ainda); a aba de
   * faltas mostra "Sem contato ainda", porque ali a ausência é a informação.
   */
  vazio,
}: {
  toque: EstadoDoToque;
  horaLocal: (iso: string) => string;
  vazio?: string;
}) {
  const visual = aparencia(toque, horaLocal);
  if (!visual) {
    if (!vazio) {
      return null;
    }
    return (
      <span
        className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap"
        style={{
          color: "var(--neutral-text)",
          backgroundColor: "var(--neutral-bg)",
        }}
      >
        <MailX strokeWidth={1.5} className="size-3.5 shrink-0" aria-hidden />
        {vazio}
      </span>
    );
  }
  const Icone = visual.icone;
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap"
      style={{ color: visual.cor, backgroundColor: visual.fundo }}
    >
      <Icone strokeWidth={1.5} className="size-3.5 shrink-0" aria-hidden />
      {visual.rotulo}
    </span>
  );
}
