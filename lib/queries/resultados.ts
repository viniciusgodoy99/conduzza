import type { SupabaseClient } from "@supabase/supabase-js";

// Agregados da tela de Resultados (Modulo 10), calculados NO BANCO pela RPC
// resultados_da_clinica (migration 20260908170000). A versao anterior somava
// linhas no servidor de aplicacao e tinha dois defeitos graves, achados na
// revisao adversarial de 08/09/2026:
//
// 1. O PostgREST corta em 1000 linhas por resposta, entao o ".limit(5000)"
//    era ilusorio: acima de 1000 contatos TODOS os indicadores ficavam
//    errados em silencio. Agregado em SQL nao tem teto.
// 2. "Agendamentos" contava a etapa ATUAL, e quem agendou e depois foi
//    arrastado para Perdido sumia da conta, inflando a taxa de
//    comparecimento. Agora a coorte vem da tabela appointment: quem JA
//    agendou e quem JA compareceu, cada pessoa contada uma vez.
//
// A RPC e SECURITY INVOKER: a RLS de contact e appointment decide o que o
// usuario enxerga (regra 3.1). A tela mostra so contagens, nunca nome ou
// telefone de paciente.

export type CanalResumo = { canal: string | null; total: number };

export type ResultadosResumo = {
  totalLeads: number;
  /**
   * Etapa ATUAL de cada contato, chaveada pela CHAVE da jornada da clinica
   * (as etapas sao configuraveis; as chaves de sistema existem sempre).
   */
  porEtapa: Record<string, number>;
  /** COORTE: quem ja teve agendamento, mesmo que hoje esteja em Perdido */
  agendamentos: number;
  /** COORTE: quem ja compareceu alguma vez */
  comparecimentos: number;
  perdidos: number;
  porCanal: CanalResumo[];
  rastreados: number;
  naoRastreados: number;
};

type RespostaRpc = {
  total_leads: number;
  por_etapa: Record<string, number>;
  agendaram: number;
  compareceram: number;
  por_canal: { canal: string | null; total: number }[];
};

export async function fetchResultados(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ResultadosResumo> {
  const { data, error } = await supabase.rpc("resultados_da_clinica", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const bruto = (data ?? {}) as Partial<RespostaRpc>;

  const porEtapa: Record<string, number> = bruto.por_etapa ?? {};

  const porCanal: CanalResumo[] = (bruto.por_canal ?? []).map((linha) => ({
    canal: linha.canal,
    total: linha.total,
  }));

  const totalLeads = bruto.total_leads ?? 0;
  const naoRastreados =
    porCanal.find((linha) => linha.canal === null)?.total ?? 0;

  return {
    totalLeads,
    porEtapa,
    agendamentos: bruto.agendaram ?? 0,
    comparecimentos: bruto.compareceram ?? 0,
    // 'perdido' e chave de sistema: existe em toda jornada, por gatilho.
    perdidos: porEtapa["perdido"] ?? 0,
    porCanal,
    rastreados: totalLeads - naoRastreados,
    naoRastreados,
  };
}
