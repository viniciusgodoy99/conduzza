// Regras puras de envio de mensagem (sem I/O, testaveis direto).
// A decisao de bloqueio vive aqui; quem consulta banco e provider e o
// orquestrador em lib/integrations/whatsapp/send.ts.

export type SendBlockReason = "sem_consentimento" | "desconectado";

export type SendDecision =
  { allowed: true } | { allowed: false; reason: SendBlockReason };

export function canSendDecision(input: {
  consentActive: boolean;
  accountStatus: string | null;
}): SendDecision {
  // Consentimento vem primeiro: e a regra inegociavel do CLAUDE.md 3.3.
  if (!input.consentActive) {
    return { allowed: false, reason: "sem_consentimento" };
  }
  if (input.accountStatus !== "conectado") {
    return { allowed: false, reason: "desconectado" };
  }
  return { allowed: true };
}

// Janela de 24h do canal OFICIAL (Meta). Com uazapi/fake nao existe janela:
// o chamador so consulta isto quando provider.isOfficialChannel for true.
export type WindowPhase =
  "sem_janela" | "ok" | "atencao" | "alerta" | "expirada";

export type WindowState = {
  phase: WindowPhase;
  remainingMs: number;
};

const HOUR_MS = 60 * 60 * 1000;

export function windowState(
  windowExpiresAt: string | Date | null,
  now: Date,
): WindowState {
  if (!windowExpiresAt) {
    return { phase: "sem_janela", remainingMs: 0 };
  }
  const expires =
    windowExpiresAt instanceof Date
      ? windowExpiresAt
      : new Date(windowExpiresAt);
  const remainingMs = expires.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { phase: "expirada", remainingMs: 0 };
  }
  // Ambar abaixo de 4h, alerta abaixo de 1h (brief, Tela 1).
  if (remainingMs < HOUR_MS) {
    return { phase: "alerta", remainingMs };
  }
  if (remainingMs < 4 * HOUR_MS) {
    return { phase: "atencao", remainingMs };
  }
  return { phase: "ok", remainingMs };
}
