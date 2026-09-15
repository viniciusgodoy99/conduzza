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
  followups: (clinicId: string) =>
    ["automacoes", clinicId, "followups"] as const,
};

export async function fetchVolumesDaEstimativa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<VolumesDaEstimativa> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  // Janela FECHADA em agora: "nos ultimos 30 dias" com consulta futura na
  // conta seria mentira (achado da revisao de 14/09/2026).
  const agora = new Date().toISOString();
  const [consultas, faltas, preco] = await Promise.all([
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("send_confirmation", true)
      .gte("starts_at", desde30d)
      .lt("starts_at", agora),
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "faltou")
      .gte("starts_at", desde30d)
      .lt("starts_at", agora),
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
  const agora = new Date().toISOString();
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
              .lt("starts_at", agora)
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
              .gte("starts_at", desde30d)
              .lt("starts_at", agora),
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

// ---------------------------------------------------------------------------
// Reguas de follow-up por etapa da jornada (fase 3 da 4.8).

import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";

export type ReguaDeFollowup = ReguaDeConfirmacao & {
  trigger_stage: string;
  /** Nome da etapa na jornada da clinica (a regua guarda so a chave). */
  etapa_nome: string;
  /** Entradas na etapa nos ultimos 30 dias (estimativa de volume). */
  eventos30d: number;
  /** Contatos HOJE na etapa sem autorizacao para receber mensagens. */
  sem_autorizacao: number;
  total_na_etapa: number;
};

export async function fetchFollowups(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ReguaDeFollowup[]> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [reguas, etapas, jaEnviou] = await Promise.all([
    supabase
      .from("cadence")
      .select(
        "id, name, active, send_window_start, send_window_end, send_weekdays, trigger_stage",
      )
      .eq("clinic_id", clinicId)
      .eq("kind", "followup")
      .order("name"),
    supabase
      .from("funnel_stage_def")
      .select("chave, nome")
      .eq("clinic_id", clinicId),
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
  const nomePorChave = new Map(
    ((etapas.data ?? []) as { chave: string; nome: string }[]).map((etapa) => [
      etapa.chave,
      etapa.nome,
    ]),
  );
  const primeiraAtivacao = (jaEnviou.data ?? []).length === 0;

  return Promise.all(
    ((reguas.data ?? []) as Record<string, unknown>[]).map(async (regua) => {
      const chave = regua.trigger_stage as string;
      const [passos, entradas30d, contatos, enviados, pulados] =
        await Promise.all([
          supabase
            .from("cadence_step")
            .select("id, offset_minutes, fixed_body")
            .eq("clinic_id", clinicId)
            .eq("cadence_id", regua.id as string)
            .order("offset_minutes"),
          supabase
            .from("contact")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinicId)
            .eq("funnel_stage", chave)
            .gte("funnel_stage_changed_at", desde30d),
          // Quem esta na etapa HOJE, para a contagem de sem autorizacao
          // (spec 7.6). Teto de 1000: na escala do projeto uma etapa nao
          // passa disso; acima, a contagem vira "pelo menos".
          supabase
            .from("contact")
            .select("id, contact_consent (channel, granted_at, revoked_at)")
            .eq("clinic_id", clinicId)
            .eq("funnel_stage", chave)
            .limit(1000),
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
      const linhas = (contatos.data ?? []) as {
        id: string;
        contact_consent: LinhaConsent[] | null;
      }[];
      const semAutorizacao = linhas.filter(
        (linha) => !consentimentoVigenteDeLinhas(linha.contact_consent ?? []),
      ).length;
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
        trigger_stage: chave,
        etapa_nome: nomePorChave.get(chave) ?? chave,
        eventos30d: entradas30d.count ?? 0,
        sem_autorizacao: semAutorizacao,
        total_na_etapa: linhas.length,
      } satisfies ReguaDeFollowup;
    }),
  );
}

// ---------------------------------------------------------------------------
// Metricas por regua (spec 7.8, fase 4 da 4.8): so numero REAL. Respondidas
// e agendadas NAO aparecem: sem atribuicao de resposta confiavel, seria
// numero inventado; chegam com a atribuicao.

export type MetricasDaRegua = {
  enviadas30d: number;
  naFila: number;
  puladasPorMotivo: { motivo: string; total: number }[];
  entregues30d: number;
  /** Consentimentos revogados ate 24h depois de um envio DESTA regua. */
  descadastros30d: number;
  /** O detalhamento bateu no teto de 1000 linhas: valores sao aproximados. */
  aproximado: boolean;
};

export async function fetchMetricasDaRegua(
  supabase: SupabaseClient,
  clinicId: string,
  cadenceId: string,
): Promise<MetricasDaRegua> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [enviadas, naFila, puladas] = await Promise.all([
    supabase
      .from("cadence_run")
      .select("id, cadence_step!inner(cadence_id)", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("cadence_step.cadence_id", cadenceId)
      .gte("sent_at", desde30d),
    supabase
      .from("cadence_run")
      .select("id, cadence_step!inner(cadence_id)", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("cadence_step.cadence_id", cadenceId)
      .is("sent_at", null)
      .is("skipped_reason", null),
    // Motivos e entregas agrupados em memoria: PostgREST nao agrega por
    // grupo, e 1000 linhas de 30 dias cobrem a escala com folga.
    supabase
      .from("cadence_run")
      .select(
        "skipped_reason, sent_at, contact_id, message:message_id ( delivery_status ), cadence_step!inner(cadence_id)",
      )
      .eq("clinic_id", clinicId)
      .eq("cadence_step.cadence_id", cadenceId)
      .gte("scheduled_for", desde30d)
      .order("scheduled_for", { ascending: false })
      .limit(1000),
  ]);
  // Erro de leitura NAO vira zero nos cartoes: numero falso e pior que
  // estado de erro (o useQuery do componente trata o throw).
  if (enviadas.error || naFila.error || puladas.error) {
    throw new Error(
      (enviadas.error ?? naFila.error ?? puladas.error)!.message,
    );
  }

  const linhas = (puladas.data ?? []) as {
    skipped_reason: string | null;
    sent_at: string | null;
    contact_id: string;
    message: { delivery_status: string | null }[] | {
      delivery_status: string | null;
    } | null;
  }[];

  const porMotivo = new Map<string, number>();
  let entregues = 0;
  const enviosPorContato = new Map<string, string[]>();
  for (const linha of linhas) {
    if (linha.skipped_reason) {
      porMotivo.set(
        linha.skipped_reason,
        (porMotivo.get(linha.skipped_reason) ?? 0) + 1,
      );
    }
    const mensagem = Array.isArray(linha.message)
      ? linha.message[0]
      : linha.message;
    if (
      mensagem?.delivery_status === "entregue" ||
      mensagem?.delivery_status === "lida"
    ) {
      entregues += 1;
    }
    if (linha.sent_at) {
      const lista = enviosPorContato.get(linha.contact_id) ?? [];
      lista.push(linha.sent_at);
      enviosPorContato.set(linha.contact_id, lista);
    }
  }

  // Descadastro em ate 24h depois de um envio desta regua: o sinal mais
  // honesto de mensagem indesejada que temos hoje.
  let descadastros = 0;
  const contatos = [...enviosPorContato.keys()];
  const revogadosTodos: { contact_id: string; revoked_at: string }[] = [];
  // Em lotes de 500 (limite pratico do .in), SEM descartar o excedente.
  for (let i = 0; i < contatos.length; i += 500) {
    const { data: revogados, error: erroRevogados } = await supabase
      .from("contact_consent")
      .select("contact_id, revoked_at")
      .eq("clinic_id", clinicId)
      .in("contact_id", contatos.slice(i, i + 500))
      .not("revoked_at", "is", null)
      .gte("revoked_at", desde30d);
    if (erroRevogados) {
      // Descadastro e o unico sinal de mensagem indesejada que o produto
      // tem: zero falso aqui e pior que estado de erro (as outras tres
      // leituras ja lancavam; esta ficou para tras na correcao anterior).
      throw new Error(erroRevogados.message);
    }
    revogadosTodos.push(
      ...((revogados ?? []) as { contact_id: string; revoked_at: string }[]),
    );
  }
  {
    for (const linha of revogadosTodos) {
      const envios = enviosPorContato.get(linha.contact_id) ?? [];
      const revogadoEm = new Date(linha.revoked_at).getTime();
      if (
        envios.some((envio) => {
          const enviadoEm = new Date(envio).getTime();
          return (
            revogadoEm >= enviadoEm &&
            revogadoEm <= enviadoEm + 24 * 60 * 60_000
          );
        })
      ) {
        descadastros += 1;
      }
    }
  }

  return {
    enviadas30d: enviadas.count ?? 0,
    naFila: naFila.count ?? 0,
    puladasPorMotivo: [...porMotivo.entries()]
      .map(([motivo, total]) => ({ motivo, total }))
      .sort((a, b) => b.total - a.total),
    entregues30d: entregues,
    descadastros30d: descadastros,
    aproximado: linhas.length >= 1000,
  };
}
