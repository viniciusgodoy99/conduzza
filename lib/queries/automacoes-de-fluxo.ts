import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ACOES,
  automacaoDeFluxoLinhaSchema,
  previaDaAutomacaoSchema,
  STATUS_DA_ACAO,
  STATUS_DE_EXECUCAO,
  type AutomacaoDeFluxo,
  type ExecucaoDeAutomacao,
  type GatilhoDeAutomacao,
  type PreviaDaAutomacao,
  type UsoDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";

// Leituras das automacoes de fluxo (migration 20261002130000; regra composta
// desde a onda 4, migration 20261024110000). A RLS recorta por clinica:
// membro ativo le as regras, as condicoes, as acoes e o historico; as regras
// so admin e gestor gravam (pela RPC salvar_automacao_de_fluxo, chamada pelas
// Server Actions da aba de fluxo da tela Automacoes,
// app/(app)/automacoes/fluxo-actions.ts), e o historico so o motor escreve.
// A tela so chama estas leituras para administrador e gestor (decisao do
// dono de 20/10/2026).
//
// As colunas de acao de automacao_fluxo sao legado (a limpeza da onda 4 as
// apaga): a regra le o "Se" de automacao_condicao e o "Faz" de
// automacao_acao, embutidos na mesma ida.
//
// ORDEM DE PUBLICACAO (decidida pelo coordenador em 22/10/2026): as
// migrations 20261024100000 e 20261024110000 sobem ANTES deste codigo, que
// le as tabelas filhas e a coluna combinar delas. Sem elas a leitura e erro
// como outro qualquer, e a aba mostra o proprio estado de erro (falha
// fechada; correcao de 22/10/2026: antes caia nas colunas de antes, que nao
// tem as condicoes e a ordem das acoes da regra composta).
//
// O historico traz o NOME do contato, que e dado de paciente: quem chama
// fetchHistoricoDeAutomacoes grava a trilha de leitura (a action da aba faz
// isso). As outras leituras sao configuracao e contagem, sem paciente.

export const automacoesDeFluxoKeys = {
  /** Prefixo para invalidar tudo das automacoes de fluxo. */
  todas: ["automacoes-de-fluxo"] as const,
  daClinica: (clinicId: string) => ["automacoes-de-fluxo", clinicId] as const,
  uso: (clinicId: string, ids: readonly string[]) =>
    [
      "automacoes-de-fluxo",
      clinicId,
      "uso",
      [...ids].sort().join(","),
    ] as const,
  historico: (clinicId: string, automacaoId: string | null) =>
    [
      "automacoes-de-fluxo",
      clinicId,
      "historico",
      automacaoId ?? "todas",
    ] as const,
  previa: (
    clinicId: string,
    gatilho: GatilhoDeAutomacao,
    etapa: string,
    esperaMinutos: number | null,
  ) =>
    [
      "automacoes-de-fluxo",
      clinicId,
      "previa",
      gatilho,
      etapa,
      esperaMinutos,
    ] as const,
};

/** A regra com as filhas: o "Se" (condicoes) e o "Faz" (acoes). */
export const AUTOMACAO_SELECT =
  "id, nome, ativa, gatilho, etapa, espera_minutos, combinar, vigente_desde, created_at, updated_at, condicoes:automacao_condicao(posicao, tipo, etiqueta), acoes:automacao_acao(posicao, acao, etapa_destino, motivo_perda, etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto)";

/** As regras da clinica, na ordem em que foram criadas. */
export async function fetchAutomacoesDeFluxo(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<AutomacaoDeFluxo[]> {
  const { data, error } = await supabase
    .from("automacao_fluxo")
    .select(AUTOMACAO_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  // Valor fora do vocabulario (banco a frente do app) vira erro da aba, em
  // vez de uma frase mentindo sobre o que a regra faz.
  return z.array(automacaoDeFluxoLinhaSchema).parse(data ?? []);
}

/**
 * Quantas vezes cada regra fez o que manda (status executada) e quando foi a
 * ultima. Uma consulta por regra: o count exato e a linha mais recente saem
 * da mesma ida (limit 1 com count), pelo indice (automacao_id, created_at).
 */
export async function fetchUsoDasAutomacoes(
  supabase: SupabaseClient,
  clinicId: string,
  ids: readonly string[],
): Promise<Record<string, UsoDaAutomacao>> {
  const resultados = await Promise.all(
    ids.map(async (id) => {
      const { data, count, error } = await supabase
        .from("automacao_execucao")
        .select("executada_em", { count: "exact" })
        .eq("clinic_id", clinicId)
        .eq("automacao_id", id)
        .eq("status", "executada")
        .order("executada_em", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) {
        throw new Error(error.message);
      }
      const ultima =
        ((data ?? [])[0] as { executada_em: string | null } | undefined)
          ?.executada_em ?? null;
      return [id, { vezes: count ?? 0, ultima }] as const;
    }),
  );
  return Object.fromEntries(resultados);
}

const execucaoDaAcaoSchema = z.object({
  posicao: z.number().int(),
  acao: z.enum(ACOES),
  status: z.enum(STATUS_DA_ACAO),
  motivo: z.string().nullable(),
  para_etapa: z.string().nullable(),
  etiqueta: z.string().nullable(),
  etiqueta_nome: z.string().nullable(),
  executada_em: z.string().nullable(),
});

const execucaoSchema = z.object({
  id: z.string(),
  automacao_id: z.string(),
  status: z.enum(STATUS_DE_EXECUCAO),
  motivo: z.string().nullable(),
  de_etapa: z.string(),
  para_etapa: z.string().nullable(),
  // O retrato do que a regra fez na hora (o historico descreve por ele).
  acao: z.enum(ACOES).nullable(),
  etiqueta: z.string().nullable(),
  etiqueta_nome: z.string().nullable(),
  executada_em: z.string().nullable(),
  created_at: z.string(),
  contact: z.object({ name: z.string().nullable() }).nullable().optional(),
  // O retrato por acao (onda 4); vazio nas execucoes de antes.
  acoes: z.array(execucaoDaAcaoSchema).nullable().optional(),
});

/** Limite do historico na tela: as ultimas execucoes. */
export const LIMITE_DO_HISTORICO = 50;

/** As colunas do historico, com o retrato de cada acao embutido. */
export const HISTORICO_SELECT =
  "id, automacao_id, status, motivo, de_etapa, para_etapa, acao, etiqueta, etiqueta_nome, executada_em, created_at, contact:contact_id(name), acoes:automacao_execucao_acao(posicao, acao, status, motivo, para_etapa, etiqueta, etiqueta_nome, executada_em)";

/**
 * As ultimas execucoes da clinica (ou de uma regra), mais novas primeiro, com
 * o que cada acao fez ou nao fez. O nome do contato e dado de paciente:
 * grave a trilha de leitura ao chamar.
 */
export async function fetchHistoricoDeAutomacoes(
  supabase: SupabaseClient,
  clinicId: string,
  automacaoId: string | null,
): Promise<ExecucaoDeAutomacao[]> {
  let pedido = supabase
    .from("automacao_execucao")
    .select(HISTORICO_SELECT)
    .eq("clinic_id", clinicId);
  if (automacaoId !== null) {
    pedido = pedido.eq("automacao_id", automacaoId);
  }
  const { data, error } = await pedido
    .order("created_at", { ascending: false })
    .limit(LIMITE_DO_HISTORICO);
  if (error) {
    throw new Error(error.message);
  }
  return z
    .array(execucaoSchema)
    .parse(data ?? [])
    .map(({ contact, acoes, ...linha }) => ({
      ...linha,
      contato: contact?.name ?? null,
      acoes: [...(acoes ?? [])].sort((a, b) => a.posicao - b.posicao),
    }));
}

/**
 * Quantos leads a regra alcanca agora e quantos ja passaram do ponto (a
 * regra nao e retroativa). Lanca com o codigo do banco para a action
 * traduzir.
 */
export async function fetchPreviaDaAutomacao(
  supabase: SupabaseClient,
  clinicId: string,
  params: {
    gatilho: GatilhoDeAutomacao;
    etapa: string;
    esperaMinutos: number | null;
  },
): Promise<PreviaDaAutomacao> {
  const { data, error } = await supabase.rpc("previa_da_automacao_de_fluxo", {
    p_clinic_id: clinicId,
    p_gatilho: params.gatilho,
    p_etapa: params.etapa,
    ...(params.esperaMinutos === null
      ? {}
      : { p_espera_minutos: params.esperaMinutos }),
  });
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code,
      hint: error.hint,
    });
  }
  return previaDaAutomacaoSchema.parse(data);
}
