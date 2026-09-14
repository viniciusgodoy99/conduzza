import type { SupabaseClient } from "@supabase/supabase-js";

// Consultas da Tela 7 (Automacoes). A carga das reguas em si reusa
// fetchReguasDaClinica (lib/queries/confirmacoes.ts): mesma forma, mesmo
// cache, e o painel da Tela 2 e esta tela enxergam sempre o mesmo dado.
// Aqui ficam so os numeros da ESTIMATIVA de volume (spec 7.5).

export type VolumesDaEstimativa = {
  /** Consultas marcadas nos ultimos 30 dias com confirmacao ligada. */
  consultas30d: number;
  /** Faltas registradas nos ultimos 30 dias. */
  faltas30d: number;
  /** Preco por mensagem (centavos) da tabela message_pricing; null = sem preco. */
  precoCents: number | null;
};

export const automacoesKeys = {
  volumes: (clinicId: string) => ["automacoes", clinicId, "volumes"] as const,
  excecoes: (clinicId: string) =>
    ["automacoes", clinicId, "excecoes"] as const,
};

export async function fetchVolumesDaEstimativa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<VolumesDaEstimativa> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [consultas, faltas, preco] = await Promise.all([
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("send_confirmation", true)
      .gte("starts_at", desde30d),
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "faltou")
      .gte("starts_at", desde30d),
    // Tabela global (sem clinic_id), legivel por autenticado; nasce VAZIA
    // porque o preco em BRL e a pendencia P1 e nao se inventa valor.
    supabase
      .from("message_pricing")
      .select("cents")
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    consultas30d: consultas.count ?? 0,
    faltas30d: faltas.count ?? 0,
    precoCents: (preco.data?.cents as number | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Excecoes da regua de confirmacao (fase 2 da 4.8): regua por procedimento e
// regua reforcada por historico de falta. O planner ja escolhe a mais
// especifica; aqui e so leitura para a tela.

import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";

export type ExcecaoDeConfirmacao = ReguaDeConfirmacao & {
  procedure: { id: string; name: string } | null;
  for_no_show_history: boolean;
  no_show_threshold: number;
  /** Consultas dos ultimos 30 dias no recorte da excecao (estimativa). */
  eventos30d: number;
};

export type ProcedimentoParaExcecao = { id: string; name: string };

export async function fetchExcecoesDeConfirmacao(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<{
  excecoes: ExcecaoDeConfirmacao[];
  procedimentos: ProcedimentoParaExcecao[];
}> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [reguas, procedimentos, jaEnviou] = await Promise.all([
    supabase
      .from("cadence")
      .select(
        "id, name, active, send_window_start, send_window_end, send_weekdays, for_no_show_history, no_show_threshold, procedure:procedure_id (id, name)",
      )
      .eq("clinic_id", clinicId)
      .eq("kind", "confirmacao")
      .or("procedure_id.not.is.null,for_no_show_history.eq.true")
      .order("name"),
    supabase
      .from("procedure")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", clinicId)
      .not("sent_at", "is", null)
      .limit(1),
  ]);
  if (reguas.error) {
    throw new Error(reguas.error.message);
  }
  const linhas = (reguas.data ?? []) as Record<string, unknown>[];
  const primeiraAtivacao = (jaEnviou.data ?? []).length === 0;

  // Poucas excecoes por clinica (uma por procedimento com preparo, mais a
  // reforcada): as consultas por regua abaixo sao baratas e em paralelo.
  const excecoes = await Promise.all(
    linhas.map(async (regua) => {
      const procedureBruto = regua.procedure;
      const procedure = (
        Array.isArray(procedureBruto) ? procedureBruto[0] : procedureBruto
      ) as { id: string; name: string } | null;
      const reforcada = regua.for_no_show_history as boolean;
      const [passos, eventos, enviados, pulados] = await Promise.all([
        supabase
          .from("cadence_step")
          .select("id, offset_minutes, fixed_body")
          .eq("clinic_id", clinicId)
          .eq("cadence_id", regua.id as string)
          .order("offset_minutes"),
        procedure
          ? supabase
              .from("appointment")
              .select("id, service_link!inner(procedure_id)", {
                count: "exact",
                head: true,
              })
              .eq("clinic_id", clinicId)
              .eq("send_confirmation", true)
              .eq("service_link.procedure_id", procedure.id)
              .gte("starts_at", desde30d)
          : supabase
              .from("appointment")
              .select("id, contact!inner(no_show_count)", {
                count: "exact",
                head: true,
              })
              .eq("clinic_id", clinicId)
              .eq("send_confirmation", true)
              .gte(
                "contact.no_show_count",
                (regua.no_show_threshold as number) ?? 2,
              )
              .gte("starts_at", desde30d),
        supabase
          .from("cadence_run")
          .select("id, cadence_step!inner(cadence_id)", {
            count: "exact",
            head: true,
          })
          .eq("clinic_id", clinicId)
          .eq("cadence_step.cadence_id", regua.id as string)
          .gte("sent_at", desde24h),
        supabase
          .from("cadence_run")
          .select("id, cadence_step!inner(cadence_id)", {
            count: "exact",
            head: true,
          })
          .eq("clinic_id", clinicId)
          .eq("cadence_step.cadence_id", regua.id as string)
          .not("skipped_reason", "is", null)
          .gte("scheduled_for", desde24h),
      ]);
      return {
        id: regua.id as string,
        name: regua.name as string,
        active: regua.active as boolean,
        send_window_start: (regua.send_window_start as string | null) ?? null,
        send_window_end: (regua.send_window_end as string | null) ?? null,
        send_weekdays: (regua.send_weekdays as number[] | null) ?? null,
        passos: (passos.data ?? []) as ReguaDeConfirmacao["passos"],
        primeira_ativacao: primeiraAtivacao,
        enviados_24h: enviados.count ?? 0,
        pulados_24h: pulados.count ?? 0,
        procedure,
        for_no_show_history: reforcada,
        no_show_threshold: (regua.no_show_threshold as number) ?? 2,
        eventos30d: eventos.count ?? 0,
      } satisfies ExcecaoDeConfirmacao;
    }),
  );
  return {
    excecoes,
    procedimentos: (procedimentos.data ?? []) as ProcedimentoParaExcecao[],
  };
}
