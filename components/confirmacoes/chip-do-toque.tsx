import {
  Mail,
  MailCheck,
  MailWarning,
  MailX,
  type LucideIcon,
} from "lucide-react";

import {
  STATUS_TONE_VARS,
  type ConsentStatus,
  type StatusTone,
} from "@/lib/design/status";
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
// texto e cor. Nunca só cor, nunca o mesmo ícone em cores diferentes: os
// quatro envelopes (MailCheck, Mail, MailWarning, MailX) são exclusivos deste
// chip, e o TriangleAlert que o "pulado" usava é só do status Faltou (tabela
// de ícones reservados, docs/06 seção 4.6; achado 65).
//
// Forma do StatusChip md (docs/06 seção 5.7), feita aqui porque a hora vai
// em cz-num dentro do rótulo. O motivo de uma mensagem que não saiu fica
// numa linha de apoio abaixo do chip: o chip diz a situação em duas palavras
// e o motivo, que pode ser longo, quebra linha sem estourar a coluna.

/** Motivos gravados em cadence_run.skipped_reason, em português de recepção. */
const MOTIVO: Record<string, string> = {
  desconectado: "o WhatsApp da clínica estava fora do ar",
  fora_janela: "fora do horário de envio",
  condicao_parada: "não era mais necessária",
  falha_envio: "falhou no envio",
  teto_gasto: "limite de gasto atingido",
  remarcacao_pedida: "o paciente pediu para remarcar",
  canal_ocupado: "o WhatsApp da clínica ficou com fila até a hora da consulta",
  consulta_remarcada: "a consulta mudou de horário",
  toque_atrasado: "atrasou e a mensagem seguinte cobriu",
};

/**
 * O motivo em português. "sem_consentimento" depende do estado da
 * autorização (achado 57): quem nunca foi registrado não "recusou", e quem
 * pediu para não receber precisa aparecer diferente. Código novo que ainda
 * não tem tradução nunca aparece cru na tela.
 */
export function motivoDoPulo(
  motivo: string,
  consentimento?: ConsentStatus,
): string {
  if (motivo === "sem_consentimento") {
    if (consentimento === "revogado") {
      return "o paciente pediu para não receber mensagens";
    }
    if (consentimento === "autorizado") {
      return "sem autorização na hora do envio";
    }
    return "sem autorização registrada";
  }
  return MOTIVO[motivo] ?? "motivo não identificado";
}

function Pilula({
  tom,
  icone: Icone,
  children,
}: {
  tom: StatusTone;
  icone: LucideIcon;
  children: React.ReactNode;
}) {
  const cores = STATUS_TONE_VARS[tom];
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-full px-[9px] text-xs font-semibold tracking-[-0.005em] whitespace-nowrap"
      style={{ color: cores.text, backgroundColor: cores.bg }}
    >
      <Icone className="size-[13px] shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

export function ChipDoToque({
  toque,
  horaLocal,
  consentimento,
  /**
   * O que dizer quando não existe toque nenhum. A lista do dia prefere não
   * dizer nada (a consulta pode simplesmente não ter vencido ainda); a aba de
   * faltas mostra "Sem contato ainda", porque ali a ausência é a informação.
   */
  vazio,
}: {
  toque: EstadoDoToque;
  horaLocal: (iso: string) => string;
  /** Estado da autorização do paciente, para dizer o motivo certo. */
  consentimento?: ConsentStatus;
  vazio?: string;
}) {
  switch (toque.situacao) {
    case "enviado":
      return (
        <Pilula tom="success" icone={MailCheck}>
          Mensagem enviada às{" "}
          <span className="cz-num">{horaLocal(toque.em)}</span>
        </Pilula>
      );
    case "na_fila":
      return (
        <Pilula tom="info" icone={Mail}>
          Mensagem sai às{" "}
          <span className="cz-num">{horaLocal(toque.para)}</span>
        </Pilula>
      );
    case "pulado":
      return (
        <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
          <Pilula tom="warning" icone={MailWarning}>
            Não enviada
          </Pilula>
          <span className="max-w-[240px] text-[11px] leading-[1.35] text-text-secondary">
            {motivoDoPulo(toque.motivo, consentimento)}
          </span>
        </span>
      );
    case "nenhum":
      return vazio ? (
        <Pilula tom="neutral" icone={MailX}>
          {vazio}
        </Pilula>
      ) : null;
  }
}
