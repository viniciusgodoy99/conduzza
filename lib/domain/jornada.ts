import {
  BadgePlus,
  CalendarPlus,
  CheckCheck,
  Circle,
  Flag,
  Gem,
  Handshake,
  Heart,
  MessageSquareText,
  Package,
  Phone,
  Repeat,
  Sparkles,
  Star,
  Timer,
  Trophy,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";

import type { StatusDefinition, StatusTone } from "@/lib/design/status";

// A jornada configuravel da clinica (migration 20260909100000). Este modulo e
// puro e serve cliente e servidor: transforma as linhas de funnel_stage_def em
// tudo que a tela precisa (definicao visual das 3 camadas, agrupamento do
// Kanban, consultas por papel).
//
// GARANTIA QUE SIMPLIFICA TUDO: as quatro chaves de sistema ('novo',
// 'agendou', 'compareceu', 'perdido') existem em TODA jornada, porque a
// semeadura as cria, a chave e imutavel e etapa de sistema e indelevel (tudo
// por gatilho no banco). Codigo pode referencia-las com seguranca; so as
// etapas LIVRES variam por clinica.

export type PapelDeEtapa = "entrada" | "agendou" | "compareceu" | "perdido";

export type EtapaDaJornada = {
  id: string;
  chave: string;
  nome: string;
  posicao: number;
  tom: StatusTone;
  icone: string;
  papel: PapelDeEtapa | null;
  termos_chave: string[];
  meta_event_name: string | null;
  conversao_ativa: boolean;
  is_sale: boolean;
  is_first_contact: boolean;
  value_source: "service_link" | "fixo" | null;
  value_cents: number | null;
};

/**
 * Catalogo FIXO de icones que uma etapa pode usar.
 *
 * O banco guarda o nome (kebab); o componente vem daqui. Catalogo fechado de
 * proposito: icone e uma das 3 camadas da regra de status (forma, rotulo,
 * cor), entao precisa ser um conjunto que o app sabe desenhar, nao texto
 * livre.
 */
export const ICONES_DE_ETAPA: Record<string, LucideIcon> = {
  "badge-plus": BadgePlus,
  "message-square-text": MessageSquareText,
  timer: Timer,
  "calendar-plus": CalendarPlus,
  "check-check": CheckCheck,
  "user-round-x": UserRoundX,
  circle: Circle,
  star: Star,
  heart: Heart,
  package: Package,
  gem: Gem,
  flag: Flag,
  sparkles: Sparkles,
  handshake: Handshake,
  repeat: Repeat,
  phone: Phone,
  trophy: Trophy,
};

/** As 3 camadas (forma, rotulo, cor) de uma etapa, no formato do StatusChip. */
export function definicaoDaEtapa(etapa: EtapaDaJornada): StatusDefinition {
  return {
    label: etapa.nome,
    tone: etapa.tom,
    icon: ICONES_DE_ETAPA[etapa.icone] ?? Circle,
  };
}

/** Mapa chave -> etapa, para consulta O(1) nas telas. */
export function porChave(
  jornada: readonly EtapaDaJornada[],
): Map<string, EtapaDaJornada> {
  return new Map(jornada.map((etapa) => [etapa.chave, etapa]));
}

/** A etapa com um papel de sistema; as quatro existem em toda jornada. */
export function etapaPorPapel(
  jornada: readonly EtapaDaJornada[],
  papel: PapelDeEtapa,
): EtapaDaJornada | null {
  return jornada.find((etapa) => etapa.papel === papel) ?? null;
}

/**
 * Agrupa itens com funnel_stage pelas etapas DA JORNADA, na ordem de posicao.
 *
 * Item cuja etapa nao esta na jornada nao some em silencio: cai na etapa de
 * entrada, que existe garantidamente. (Na pratica o banco impede o caso, mas
 * um cache momentaneamente velho na troca de jornada nao pode derrubar o
 * Kanban.)
 */
export function agruparPorJornada<T extends { funnel_stage: string }>(
  itens: readonly T[],
  jornada: readonly EtapaDaJornada[],
): Map<string, T[]> {
  const grupos = new Map<string, T[]>(
    jornada.map((etapa) => [etapa.chave, [] as T[]]),
  );
  const entrada = etapaPorPapel(jornada, "entrada");
  for (const item of itens) {
    const balde =
      grupos.get(item.funnel_stage) ??
      (entrada ? grupos.get(entrada.chave) : undefined);
    balde?.push(item);
  }
  return grupos;
}
