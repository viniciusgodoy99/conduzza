import type { SupabaseClient } from "@supabase/supabase-js";

import { CLINICAS_DA_FASE_CONTROLADA } from "@/lib/ia/liberacao";

// Leitura da aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026): a liberacao da IA na clinica, o numero escolhido, os
// telefones da equipe e o estado do interruptor geral. Contrato do banco na
// migration 20261006120000_ia_liberacao_pela_tela.sql: administrador ou
// gestor ATIVO da propria clinica le as tres tabelas da liberacao quando ela
// esta na lista fechada (ou e e_de_teste, nas suites); o interruptor geral chega so como
// booleano (ia_interruptor_ligado). A escrita nunca passa por aqui: e das
// Server Actions da aba, pelas RPCs definir_*_da_ia.
//
// Os telefones sao da EQUIPE (quem conversa com a IA nesta fase), nao de
// paciente: nao entram na trilha de leitura. Nada daqui vai para log.

/**
 * A aba so existe nas clinicas da fase controlada (teste123 e Conduzza
 * Teste). Decisao do SERVIDOR (pagina e Server Actions), pela constante
 * espelho de ia_clinicas_da_fase_controlada(). Clinica e_de_teste das suites
 * nao entra: o banco aceita a escrita dela so para os testes.
 */
export function abaDaIaVisivel(clinicId: string): boolean {
  return CLINICAS_DA_FASE_CONTROLADA.includes(clinicId.trim().toLowerCase());
}

/** O modo gravado em ia_liberacao (check do banco). */
export type ModoDaIa = "simulador" | "contatos";

export type LiberacaoDaClinica = {
  liberada: boolean;
  modo: ModoDaIa;
  /** T7: a pausa da clinica (a tela de pausar vem no E5). */
  pausadaPelaClinica: boolean;
  /** Teto das ultimas 24 horas, em centavos de dolar. */
  tetoDiarioCentavosUsd: number;
};

/** Uma linha de ia_numero_liberado. */
export type NumeroDaIa = { whatsappAccountId: string; ativo: boolean };

/** Uma linha de ia_contato_liberado (telefone da equipe). */
export type TelefoneDaIa = {
  id: string;
  /** A chave canonica gravada pelo banco (E.164 com o nono digito). */
  telefone: string;
  rotulo: string | null;
  ativo: boolean;
};

export type DadosDaIa = {
  /** Nula: a clinica nunca ganhou linha de liberacao (nunca foi ligada). */
  liberacao: LiberacaoDaClinica | null;
  numeros: NumeroDaIa[];
  telefones: TelefoneDaIa[];
  interruptorLigado: boolean;
};

type LinhaDaLiberacao = {
  liberada: boolean;
  modo: string;
  pausada_pela_clinica: boolean;
  teto_diario_centavos_usd: number;
};

type LinhaDoNumero = { whatsapp_account_id: string; ativo: boolean };

type LinhaDoTelefone = {
  id: string;
  phone_key: string;
  rotulo: string | null;
  ativo: boolean;
};

function modoDaLinha(modo: string): ModoDaIa {
  if (modo === "simulador" || modo === "contatos") {
    return modo;
  }
  // O check do banco so aceita os dois; outro valor e banco e codigo
  // desencontrados, e a aba mostra o erro em vez de adivinhar.
  throw new Error("modo da liberacao desconhecido");
}

/**
 * Tudo o que a aba le, de uma vez. Qualquer leitura que falha lanca: a
 * pagina mostra o erro da aba, nunca uma clinica "desligada" que nao e.
 */
export async function fetchLiberacaoDaIa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<DadosDaIa> {
  const [liberacao, numeros, telefones, interruptor] = await Promise.all([
    supabase
      .from("ia_liberacao")
      .select("liberada, modo, pausada_pela_clinica, teto_diario_centavos_usd")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("ia_numero_liberado")
      .select("whatsapp_account_id, ativo")
      .eq("clinic_id", clinicId),
    supabase
      .from("ia_contato_liberado")
      .select("id, phone_key, rotulo, ativo")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: true }),
    supabase.rpc("ia_interruptor_ligado"),
  ]);
  if (
    liberacao.error ||
    numeros.error ||
    telefones.error ||
    interruptor.error
  ) {
    throw new Error("leitura da liberacao da IA falhou");
  }
  if (typeof interruptor.data !== "boolean") {
    throw new Error("estado do interruptor geral ilegivel");
  }

  const linha = liberacao.data as LinhaDaLiberacao | null;
  return {
    liberacao: linha
      ? {
          liberada: linha.liberada,
          modo: modoDaLinha(linha.modo),
          pausadaPelaClinica: linha.pausada_pela_clinica,
          tetoDiarioCentavosUsd: linha.teto_diario_centavos_usd,
        }
      : null,
    numeros: ((numeros.data ?? []) as LinhaDoNumero[]).map((numero) => ({
      whatsappAccountId: numero.whatsapp_account_id,
      ativo: numero.ativo,
    })),
    telefones: ((telefones.data ?? []) as LinhaDoTelefone[]).map(
      (telefone) => ({
        id: telefone.id,
        telefone: telefone.phone_key,
        rotulo: telefone.rotulo,
        ativo: telefone.ativo,
      }),
    ),
    interruptorLigado: interruptor.data,
  };
}

/**
 * Um numero ATIVO (nao removido) desta clinica, com a situacao da conexao
 * crua; nulo quando nao existe, e removido ou e de outra clinica. Para a
 * acao de escolher o numero (a RLS de whatsapp_account recorta por clinica;
 * o filtro por clinic_id e a segunda camada).
 */
export async function fetchNumeroDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
  whatsappAccountId: string,
): Promise<{ id: string; connectionStatus: string | null } | null> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select("id, connection_status")
    .eq("id", whatsappAccountId)
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .maybeSingle();
  if (error) {
    throw new Error("leitura do numero falhou");
  }
  const linha = data as { id: string; connection_status: string | null } | null;
  return linha
    ? { id: linha.id, connectionStatus: linha.connection_status }
    : null;
}
