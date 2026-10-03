import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ACOES,
  automacaoDeFluxoLinhaSchema,
  previaDaAutomacaoSchema,
  STATUS_DE_EXECUCAO,
  type AutomacaoDeFluxo,
  type ExecucaoDeAutomacao,
  type GatilhoDeAutomacao,
  type PreviaDaAutomacao,
  type UsoDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";

// Leituras das automacoes de fluxo (migration 20261002130000). A RLS recorta
// por clinica: membro ativo le as regras e o historico; so admin e gestor
// escrevem as regras (pelas Server Actions da aba de Configuracoes), e o
// historico so o motor escreve.
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

const AUTOMACAO_SELECT =
  "id, nome, ativa, gatilho, etapa, espera_minutos, acao, etapa_destino, motivo_perda, etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto, vigente_desde, created_at, updated_at";

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
});

/** Limite do historico na tela: as ultimas execucoes. */
export const LIMITE_DO_HISTORICO = 50;

/**
 * As ultimas execucoes da clinica (ou de uma regra), mais novas primeiro. O
 * nome do contato e dado de paciente: grave a trilha de leitura ao chamar.
 */
export async function fetchHistoricoDeAutomacoes(
  supabase: SupabaseClient,
  clinicId: string,
  automacaoId: string | null,
): Promise<ExecucaoDeAutomacao[]> {
  let consulta = supabase
    .from("automacao_execucao")
    .select(
      "id, automacao_id, status, motivo, de_etapa, para_etapa, acao, etiqueta, etiqueta_nome, executada_em, created_at, contact:contact_id(name)",
    )
    .eq("clinic_id", clinicId);
  if (automacaoId !== null) {
    consulta = consulta.eq("automacao_id", automacaoId);
  }
  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .limit(LIMITE_DO_HISTORICO);
  if (error) {
    throw new Error(error.message);
  }
  return z
    .array(execucaoSchema)
    .parse(data ?? [])
    .map(({ contact, ...linha }) => ({
      ...linha,
      contato: contact?.name ?? null,
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
