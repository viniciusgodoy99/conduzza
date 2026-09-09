import type { SupabaseClient } from "@supabase/supabase-js";

// Agregados do painel "Conversoes devolvidas a Meta" (Resultados), pela RPC
// conversoes_devolvidas_da_clinica (migration 20260910100000). SECURITY
// INVOKER: a RLS de conversion_event decide o que o usuario enxerga. So
// contagens, soma de valor e a data do ultimo envio; nenhum dado de paciente.

export type ConversoesResumo = {
  porStatus: {
    registrado: number;
    enfileirado: number;
    enviado: number;
    falhou: number;
    descartado: number;
  };
  total: number;
  valorEnviadoCents: number;
  comCtwa: number;
  ultimoEnvio: string | null;
};

type RespostaRpc = {
  por_status: Record<string, number>;
  valor_enviado_cents: number;
  com_ctwa: number;
  ultimo_envio: string | null;
};

export async function fetchConversoesDevolvidas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ConversoesResumo> {
  const { data, error } = await supabase.rpc(
    "conversoes_devolvidas_da_clinica",
    { p_clinic_id: clinicId },
  );
  if (error) {
    throw new Error(error.message);
  }
  const bruto = (data ?? {}) as Partial<RespostaRpc>;
  const porStatusBruto = bruto.por_status ?? {};
  const porStatus = {
    registrado: porStatusBruto["registrado"] ?? 0,
    enfileirado: porStatusBruto["enfileirado"] ?? 0,
    enviado: porStatusBruto["enviado"] ?? 0,
    falhou: porStatusBruto["falhou"] ?? 0,
    descartado: porStatusBruto["descartado"] ?? 0,
  };
  return {
    porStatus,
    total:
      porStatus.registrado +
      porStatus.enfileirado +
      porStatus.enviado +
      porStatus.falhou +
      porStatus.descartado,
    valorEnviadoCents: bruto.valor_enviado_cents ?? 0,
    comCtwa: bruto.com_ctwa ?? 0,
    ultimoEnvio: bruto.ultimo_envio ?? null,
  };
}
