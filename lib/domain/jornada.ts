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
import { normalizarTexto } from "@/lib/domain/attribution";

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

/**
 * Assumir a conversa de um lead NOVO o move para "Em contato" (decisao do
 * dono em 19/09/2026): atender e o primeiro contato de verdade. Regras
 * defensivas, nesta ordem: so contato kind lead; so quando a etapa ATUAL tem
 * papel de entrada (quem ja avancou ou se perdeu nao volta por causa de um
 * clique em Assumir); e so se a chave em_contato ainda existir na jornada
 * (ela e etapa LIVRE, renomeavel e excluivel; a clinica que a excluiu nao
 * quer essa automacao). Devolve a chave de destino ou null para nao mover.
 */
export function etapaAposAssumir(params: {
  kind: "lead" | "paciente";
  etapaAtual: Pick<EtapaDaJornada, "chave" | "papel"> | null;
  jornada: readonly Pick<EtapaDaJornada, "chave" | "papel">[];
}): string | null {
  if (params.kind !== "lead") {
    return null;
  }
  if (!params.etapaAtual || params.etapaAtual.papel !== "entrada") {
    return null;
  }
  const destino = params.jornada.find((etapa) => etapa.chave === "em_contato");
  if (!destino || destino.chave === params.etapaAtual.chave) {
    return null;
  }
  return destino.chave;
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
/** O que a decisao por termo-chave precisa saber de cada etapa. */
type EtapaParaTermo = Pick<
  EtapaDaJornada,
  "chave" | "posicao" | "papel" | "termos_chave"
>;

/**
 * Decide se um corpo de mensagem move o contato de etapa por TERMO-CHAVE
 * (fase 4 da jornada configuravel). Pura, zero I/O; quem le a jornada e grava
 * o contato e o ingest.
 *
 * Regras, na ordem em que eliminam:
 * - corpo vazio, jornada vazia ou etapa atual desconhecida: nao move (etapa
 *   fora da jornada e cache velho; ser conservador aqui nao perde nada).
 * - contato em etapa de perda NUNCA sai por termo: reativar quem se perdeu e
 *   decisao de gente (ou do gatilho de agendamento), nao de palavra solta.
 * - so anda PARA FRENTE (posicao maior que a atual) e nunca PARA a etapa de
 *   perda: "nao quero mais, era so o valor" nao pode perder ninguem.
 * - entre os termos que casaram, vence o mais longo (mais especifico), como
 *   na atribuicao de campanha; empate fica com a etapa mais cedo na jornada.
 *
 * Normalizacao identica a da atribuicao: minusculas, sem acento, espacos
 * colapsados, substring simples.
 */
export function etapaPorTermoChave<T extends EtapaParaTermo>(
  corpo: string | null,
  etapaAtual: string,
  jornada: readonly T[],
): T | null {
  if (!corpo) {
    return null;
  }
  const corpoNormalizado = normalizarTexto(corpo);
  if (corpoNormalizado === "") {
    return null;
  }
  const atual = jornada.find((etapa) => etapa.chave === etapaAtual);
  if (!atual || atual.papel === "perdido") {
    return null;
  }

  let vencedora: T | null = null;
  let maiorComprimento = 0;
  for (const etapa of [...jornada].sort((a, b) => a.posicao - b.posicao)) {
    if (etapa.papel === "perdido" || etapa.posicao <= atual.posicao) {
      continue;
    }
    for (const termo of etapa.termos_chave) {
      const termoNormalizado = normalizarTexto(termo);
      if (
        termoNormalizado !== "" &&
        termoNormalizado.length > maiorComprimento &&
        corpoNormalizado.includes(termoNormalizado)
      ) {
        vencedora = etapa;
        maiorComprimento = termoNormalizado.length;
      }
    }
  }
  return vencedora;
}

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
