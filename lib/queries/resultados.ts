import type { SupabaseClient } from "@supabase/supabase-js";

import { FUNNEL_STAGE, type FunnelStage } from "@/lib/design/status";

// Agregados da tela de Resultados (Modulo 10). v1: usa SO dado que ja existe
// (a etapa do funil e o canal de origem de cada contact), sem depender do
// retorno para a Meta, que e escopo novo (docs/06, Caminho B). A RLS recorta
// por clinica; a tela mostra apenas contagens, nunca nome ou telefone de
// paciente, entao nao passa por trilha de leitura.
//
// Sem filtro de periodo nesta versao: o recorte por data entra junto com o
// seletor de periodo (proximo passo). Aqui e o total da clinica.

export type CanalResumo = { canal: string | null; total: number };

export type ResultadosResumo = {
  totalLeads: number;
  porEtapa: Record<FunnelStage, number>;
  agendamentos: number;
  comparecimentos: number;
  perdidos: number;
  porCanal: CanalResumo[];
  rastreados: number;
  naoRastreados: number;
};

// Teto de seguranca, mesmo espirito do LEADS_LIMIT: a agregacao roda no
// servidor sobre as colunas minimas. Clinicas do produto sao pequenas; acima
// do teto a conta passa a precisar de uma RPC de agregacao no banco.
export const RESULTADOS_LIMIT = 5000;

const ETAPAS = Object.keys(FUNNEL_STAGE) as FunnelStage[];

export async function fetchResultados(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ResultadosResumo> {
  const { data, error } = await supabase
    .from("contact")
    .select("funnel_stage, source_channel")
    .eq("clinic_id", clinicId)
    .limit(RESULTADOS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }

  const linhas = (data ?? []) as {
    funnel_stage: FunnelStage;
    source_channel: string | null;
  }[];

  const porEtapa = Object.fromEntries(
    ETAPAS.map((etapa) => [etapa, 0]),
  ) as Record<FunnelStage, number>;
  const canalMap = new Map<string | null, number>();

  for (const linha of linhas) {
    if (linha.funnel_stage in porEtapa) {
      porEtapa[linha.funnel_stage] += 1;
    }
    canalMap.set(
      linha.source_channel,
      (canalMap.get(linha.source_channel) ?? 0) + 1,
    );
  }

  const totalLeads = linhas.length;
  // Quem chegou ao menos em "agendou": compareceu passou por agendar antes
  // (o funil so avanca), entao entra na contagem de agendamentos tambem.
  const agendamentos = porEtapa.agendou + porEtapa.compareceu;
  const comparecimentos = porEtapa.compareceu;
  const perdidos = porEtapa.perdido;

  const porCanal: CanalResumo[] = [...canalMap.entries()]
    .map(([canal, total]) => ({ canal, total }))
    .sort((a, b) => b.total - a.total);

  const naoRastreados = canalMap.get(null) ?? 0;
  const rastreados = totalLeads - naoRastreados;

  return {
    totalLeads,
    porEtapa,
    agendamentos,
    comparecimentos,
    perdidos,
    porCanal,
    rastreados,
    naoRastreados,
  };
}
