import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

import { SOURCE_CHANNELS, type SourceChannel } from "@/lib/domain/attribution";

// Rotulos e formatos compartilhados da Tela 4 (Leads). Linguagem de
// recepcionista: o canal aparece com nome humano, nunca a string tecnica do
// banco. Fonte unica para filtros, cartao, lista e drawer.

export const CANAL_LABELS: Record<SourceChannel, string> = {
  trafego_pago: "Tráfego pago",
  busca_organica: "Busca orgânica",
  redes_sociais: "Redes sociais",
  doctoralia_diretorios: "Doctoralia e diretórios",
  indicacao: "Indicação",
  retorno: "Retorno",
  offline: "Offline",
  direto: "Direto",
};

export const CANAIS: readonly { valor: SourceChannel; rotulo: string }[] =
  SOURCE_CHANNELS.map((canal) => ({
    valor: canal,
    rotulo: CANAL_LABELS[canal],
  }));

/** Rotulo humano do canal; canal desconhecido volta como veio, nunca some. */
export function rotuloDoCanal(canal: string | null): string | null {
  if (!canal) {
    return null;
  }
  return CANAL_LABELS[canal as SourceChannel] ?? canal;
}

/** Tempo relativo curto ("há 2 horas"), no locale pt-BR. */
export function tempoRelativo(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), {
    locale: ptBR,
    addSuffix: true,
  });
}

/** Data local no fuso da clinica (regra 3.6): dd/mm/aaaa. */
export function dataLocal(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: timezone });
}
