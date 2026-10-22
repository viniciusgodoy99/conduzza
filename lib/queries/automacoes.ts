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
  vinculadas: (clinicId: string) =>
    ["automacoes", clinicId, "vinculadas"] as const,
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
// Reguas vinculadas de confirmacao e de pos-falta (decisao do dono em
// 29/09/2026; antes eram as "excecoes" da confirmacao, so por procedimento e
// a reforcada). Cada regua tem UM vinculo: medico, especialidade ou
// procedimento; sem vinculo e a geral. Quem escolhe a regua de cada consulta
// e o banco (regua_da_consulta); aqui e so leitura para a tela.

import {
  chaveDeEspecialidade,
  especialidadesDosProfissionais,
  vinculoDaLinha,
  type KindVinculavel,
  type OpcoesDeVinculo,
  type VinculoDaRegua,
} from "@/components/automacoes/vinculo-da-regua";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";

export type ReguaVinculada = ReguaDeConfirmacao & {
  kind: KindVinculavel;
  /** null: regua so reforcada por historico de falta, sem vinculo. */
  vinculo: VinculoDaRegua | null;
  for_no_show_history: boolean;
  no_show_threshold: number;
  /**
   * Consultas marcadas (confirmacao) ou faltas registradas (pos-falta) dos
   * ultimos 30 dias no recorte da regua (estimativa de volume).
   */
  eventos30d: number;
};

export type DadosDasReguasVinculadas = {
  /** As vinculadas dos dois tipos; cada aba fica com as do seu. */
  reguas: ReguaVinculada[];
  /** Medicos, especialidades e procedimentos ATIVOS, para o dialogo. */
  opcoes: OpcoesDeVinculo;
};

// As colunas novas de cadence (professional_id, specialty) chegam em
// lib/supabase/database.types.ts pelo outro grupo desta frente; o cliente
// daqui nao e tipado, entao a forma da linha fica local.
type LinhaDoProfissional = {
  id: string;
  name: string;
  specialties: string[] | null;
  active: boolean;
};

export async function fetchReguasVinculadas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<DadosDasReguasVinculadas> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const agora = new Date().toISOString();
  const [reguas, procedimentos, profissionais, jaEnviou, linhaDeBase] =
    await Promise.all([
      supabase
        .from("cadence")
        .select(
          "id, kind, name, active, send_window_start, send_window_end, send_weekdays, for_no_show_history, no_show_threshold, specialty, procedure:procedure_id (id, name), professional:professional_id (id, name)",
        )
        .eq("clinic_id", clinicId)
        .in("kind", ["confirmacao", "pos_falta"])
        .or(
          "procedure_id.not.is.null,professional_id.not.is.null,specialty.not.is.null,for_no_show_history.eq.true",
        )
        .order("name"),
      supabase
        .from("procedure")
        .select("id, name")
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("name"),
      // TODOS os profissionais: os ativos montam as opcoes do dialogo, e a
      // estimativa por especialidade casa tambem quem ja saiu do cadastro
      // (a consulta dos ultimos 30 dias continua sendo dele).
      supabase
        .from("professional")
        .select("id, name, specialties, active")
        .eq("clinic_id", clinicId)
        .order("name"),
      supabase
        .from("cadence_run")
        .select("id")
        .eq("clinic_id", clinicId)
        .not("sent_at", "is", null)
        .limit(1),
      // A vinculada de confirmacao tambem mexe na taxa de falta: sem linha de
      // base, ligar qualquer uma lembra o registro (achado 49).
      supabase
        .from("no_show_baseline")
        .select("id")
        .eq("clinic_id", clinicId)
        .limit(1),
    ]);
  // Lista vazia por erro de leitura diria "Nenhum médico ativo" sem ser
  // verdade: melhor o estado de erro da tela.
  const erro = reguas.error ?? procedimentos.error ?? profissionais.error;
  if (erro) {
    throw new Error(erro.message);
  }
  const linhas = (reguas.data ?? []) as Record<string, unknown>[];
  const todosOsProfissionais = (profissionais.data ??
    []) as LinhaDoProfissional[];
  const primeiraAtivacao = (jaEnviou.data ?? []).length === 0;
  const semLinhaDeBase = (linhaDeBase.data ?? []).length === 0;

  // Quem atende cada especialidade, pela MESMA chave do banco.
  const profissionaisDaEspecialidade = (chave: string): string[] =>
    todosOsProfissionais
      .filter((profissional) =>
        (profissional.specialties ?? []).some(
          (especialidade) => chaveDeEspecialidade(especialidade) === chave,
        ),
      )
      .map((profissional) => profissional.id);

  // Estimativa de 30 dias no recorte da regua, janela FECHADA em agora (como
  // fetchVolumesDaEstimativa). Conta o recorte inteiro, sem descontar o que
  // uma regua mais especifica levaria: e a ordem de grandeza, nao a divisao.
  const contarEventos = async (
    kind: KindVinculavel,
    vinculo: VinculoDaRegua | null,
    reforcada: boolean,
    limiar: number,
  ): Promise<number> => {
    let doRecorte: string[] | null = null;
    if (vinculo?.tipo === "especialidade") {
      doRecorte = profissionaisDaEspecialidade(vinculo.chave);
      if (doRecorte.length === 0) {
        return 0;
      }
    }
    const colunas = ["id"];
    if (vinculo?.tipo === "procedimento") {
      colunas.push("service_link!inner(procedure_id)");
    }
    if (reforcada) {
      colunas.push("contact!inner(no_show_count)");
    }
    let consulta = supabase
      .from("appointment")
      .select(colunas.join(", "), { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .gte("starts_at", desde30d)
      .lt("starts_at", agora);
    consulta =
      kind === "confirmacao"
        ? consulta.eq("send_confirmation", true)
        : consulta.eq("status", "faltou");
    if (vinculo?.tipo === "procedimento") {
      consulta = consulta.eq("service_link.procedure_id", vinculo.id);
    } else if (vinculo?.tipo === "medico") {
      consulta = consulta.eq("professional_id", vinculo.id);
    } else if (doRecorte) {
      consulta = consulta.in("professional_id", doRecorte);
    }
    if (reforcada) {
      consulta = consulta.gte("contact.no_show_count", limiar);
    }
    const { count } = await consulta;
    return count ?? 0;
  };

  // Poucas vinculadas por clinica (alguns medicos, especialidades e
  // procedimentos com preparo, mais a reforcada): as consultas por regua
  // abaixo sao baratas e em paralelo.
  const vinculadas = await Promise.all(
    linhas.map(async (regua) => {
      const kind = regua.kind as KindVinculavel;
      const vinculo = vinculoDaLinha(regua);
      const reforcada = regua.for_no_show_history as boolean;
      const limiar = (regua.no_show_threshold as number | null) ?? 2;
      const [passos, eventos, enviados, pulados] = await Promise.all([
        supabase
          .from("cadence_step")
          .select(
            "id, offset_minutes, fixed_body, media_path, media_type, media_mimetype, media_filename",
          )
          .eq("clinic_id", clinicId)
          .eq("cadence_id", regua.id as string)
          .order("offset_minutes"),
        contarEventos(kind, vinculo, reforcada, limiar),
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
        // So a confirmacao pede a linha de base (achado 49): a pos-falta
        // nao muda a taxa de falta que ela mede.
        pede_linha_de_base: kind === "confirmacao" && semLinhaDeBase,
        enviados_24h: enviados.count ?? 0,
        pulados_24h: pulados.count ?? 0,
        kind,
        vinculo,
        for_no_show_history: reforcada,
        no_show_threshold: limiar,
        eventos30d: eventos,
      } satisfies ReguaVinculada;
    }),
  );

  const ativos = todosOsProfissionais.filter(
    (profissional) => profissional.active,
  );
  return {
    reguas: vinculadas,
    opcoes: {
      medicos: ativos.map((profissional) => ({
        id: profissional.id,
        nome: profissional.name,
      })),
      especialidades: especialidadesDosProfissionais(ativos),
      procedimentos: (
        (procedimentos.data ?? []) as { id: string; name: string }[]
      ).map((procedimento) => ({
        id: procedimento.id,
        nome: procedimento.name,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Reguas de follow-up por etapa da jornada (fase 3 da 4.8) e, desde a onda 4
// (item 16, migration 20261024100000), por etiqueta: a etapa pode ter as
// reguas com etiqueta e uma geral, e para cada lead vale uma por vez
// (regua_de_followup_do_contato; espelho em lib/domain/reguas-de-followup).

import { z } from "zod";

import {
  chaveDaEtiqueta,
  MODOS_DO_FILTRO,
  opcoesDeEtiqueta,
  type ModoDoFiltro,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";

/**
 * Quantos leads cada regua alcanca HOJE (RPC alcance_das_reguas_de_followup,
 * contagens sem dado de paciente).
 */
export type AlcanceDaRegua = {
  /** Leads hoje na etapa com as etiquetas da regua (a geral: todos). */
  casam: number;
  /** Para quem ela e a vigente agora (0 se desligada). */
  recebem: number;
  /** Dos que casam, os sem autorizacao para receber mensagens. */
  sem_autorizacao: number;
  /** Dos que casam, os que entraram na etapa nos ultimos 30 dias. */
  entradas_30d: number;
};

export type ReguaDeFollowup = ReguaDeConfirmacao & {
  trigger_stage: string;
  /** Nome da etapa na jornada da clinica (a regua guarda so a chave). */
  etapa_nome: string;
  /** Os NOMES das etiquetas do filtro; vazio: a regua geral da etapa. */
  etiquetas: string[];
  etiquetas_modo: ModoDoFiltro;
  /** A ordem entre as com etiqueta da etapa (vale a de cima). */
  prioridade: number;
  created_at: string;
  /**
   * Entradas na etapa nos ultimos 30 dias que casam com a regua (a
   * estimativa de volume). Sem o alcance, a contagem da etapa inteira, que
   * e a ordem de grandeza (como nas reguas vinculadas).
   */
  eventos30d: number;
  /** As contagens de hoje; nulo quando a leitura delas falhou. */
  alcance: AlcanceDaRegua | null;
};

/** O que a aba Follow-up de leads recebe. */
export type DadosDosFollowups = {
  reguas: ReguaDeFollowup[];
  /**
   * Por etapa (chave): leads da etapa, com regua ligada nela, para quem
   * nenhuma vale (a etapa sem regua geral). Nulo: a contagem nao carregou.
   */
  semReguaPorEtapa: Record<string, number> | null;
};

const numeroSchema = z.number().int().min(0);

/**
 * O jsonb de alcance_das_reguas_de_followup: por regua e por etapa. Forma
 * diferente (banco a frente ou atras do app) vira "nao carregou", nunca
 * numero inventado.
 */
const alcanceSchema = z.object({
  reguas: z.array(
    z.object({
      id: z.string(),
      casam: numeroSchema,
      recebem: numeroSchema,
      sem_autorizacao: numeroSchema,
      entradas_30d: numeroSchema,
    }),
  ),
  etapas: z.array(z.object({ chave: z.string(), sem_regua: numeroSchema })),
});

const COLUNAS_DA_REGUA =
  "id, name, active, send_window_start, send_window_end, send_weekdays, trigger_stage, created_at";
const COLUNAS_DO_FILTRO = "etiquetas, etiquetas_modo, prioridade";

/**
 * As reguas de follow-up com o filtro. O codigo da onda 4 sobe DEPOIS da
 * migration 20261024100000 (ordem decidida pelo coordenador em 22/10/2026):
 * sem as colunas do filtro, a leitura e erro como outro qualquer e a aba
 * mostra o proprio estado de erro (falha fechada; correcao de 22/10/2026).
 */
async function lerReguasDeFollowup(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("cadence")
    .select(`${COLUNAS_DA_REGUA}, ${COLUNAS_DO_FILTRO}`)
    .eq("clinic_id", clinicId)
    .eq("kind", "followup")
    .order("name");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Record<string, unknown>[];
}

/** O modo gravado, ou "qualquer" (o padrao da coluna) se vier outra coisa. */
function modoDaLinha(valor: unknown): ModoDoFiltro {
  return (MODOS_DO_FILTRO as readonly unknown[]).includes(valor)
    ? (valor as ModoDoFiltro)
    : "qualquer";
}

export async function fetchFollowups(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<DadosDosFollowups> {
  const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [linhas, etapas, jaEnviou, alcanceBruto] = await Promise.all([
    lerReguasDeFollowup(supabase, clinicId),
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
    // As contagens de hoje (casam, recebem, sem autorizacao, entradas em 30
    // dias, e quem fica sem regua na etapa), numa ida so, no banco: com
    // varias reguas por etapa a conta depende da precedencia, que mora la.
    supabase.rpc("alcance_das_reguas_de_followup", { p_clinic_id: clinicId }),
  ]);
  const nomePorChave = new Map(
    ((etapas.data ?? []) as { chave: string; nome: string }[]).map((etapa) => [
      etapa.chave,
      etapa.nome,
    ]),
  );
  const primeiraAtivacao = (jaEnviou.data ?? []).length === 0;
  // Leitura que falha (ou forma estranha) vira "nao carregou": as reguas
  // continuam na tela, so as contagens dizem que nao vieram.
  const alcance = alcanceBruto.error
    ? null
    : (alcanceSchema.safeParse(alcanceBruto.data).data ?? null);
  const alcancePorRegua = new Map(
    (alcance?.reguas ?? []).map((linha) => [linha.id, linha]),
  );

  // Sem o alcance, a estimativa usa as entradas da etapa inteira (uma
  // contagem por etapa, nao por regua).
  const entradasDaEtapa = new Map<string, Promise<number>>();
  const entradasSemFiltro = (chave: string): Promise<number> => {
    const pronta = entradasDaEtapa.get(chave);
    if (pronta) {
      return pronta;
    }
    const contagem = Promise.resolve(
      supabase
        .from("contact")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("funnel_stage", chave)
        .gte("funnel_stage_changed_at", desde30d),
    ).then(({ count }) => count ?? 0);
    entradasDaEtapa.set(chave, contagem);
    return contagem;
  };

  const reguas = await Promise.all(
    linhas.map(async (regua) => {
      const chave = regua.trigger_stage as string;
      const id = regua.id as string;
      const doAlcance = alcancePorRegua.get(id) ?? null;
      const [passos, enviados, pulados, entradas30d] = await Promise.all([
        supabase
          .from("cadence_step")
          .select(
            "id, offset_minutes, fixed_body, media_path, media_type, media_mimetype, media_filename",
          )
          .eq("clinic_id", clinicId)
          .eq("cadence_id", id)
          .order("offset_minutes"),
        supabase
          .from("cadence_run")
          .select("id, cadence_step!inner(cadence_id)", {
            count: "exact",
            head: true,
          })
          .eq("clinic_id", clinicId)
          .eq("cadence_step.cadence_id", id)
          .gte("sent_at", desde24h),
        supabase
          .from("cadence_run")
          .select("id, cadence_step!inner(cadence_id)", {
            count: "exact",
            head: true,
          })
          .eq("clinic_id", clinicId)
          .eq("cadence_step.cadence_id", id)
          .not("skipped_reason", "is", null)
          .gte("scheduled_for", desde24h),
        doAlcance ? doAlcance.entradas_30d : entradasSemFiltro(chave),
      ]);
      return {
        id,
        name: regua.name as string,
        active: regua.active as boolean,
        send_window_start: (regua.send_window_start as string | null) ?? null,
        send_window_end: (regua.send_window_end as string | null) ?? null,
        send_weekdays: (regua.send_weekdays as number[] | null) ?? null,
        passos: (passos.data ?? []) as ReguaDeConfirmacao["passos"],
        primeira_ativacao: primeiraAtivacao,
        // Follow-up nao mexe na taxa de falta: nunca pede a linha de base.
        pede_linha_de_base: false,
        enviados_24h: enviados.count ?? 0,
        pulados_24h: pulados.count ?? 0,
        trigger_stage: chave,
        etapa_nome: nomePorChave.get(chave) ?? chave,
        etiquetas: Array.isArray(regua.etiquetas)
          ? (regua.etiquetas as unknown[]).filter(
              (etiqueta): etiqueta is string => typeof etiqueta === "string",
            )
          : [],
        etiquetas_modo: modoDaLinha(regua.etiquetas_modo),
        prioridade: typeof regua.prioridade === "number" ? regua.prioridade : 0,
        created_at: (regua.created_at as string | null) ?? "",
        eventos30d: entradas30d,
        alcance: doAlcance
          ? {
              casam: doAlcance.casam,
              recebem: doAlcance.recebem,
              sem_autorizacao: doAlcance.sem_autorizacao,
              entradas_30d: doAlcance.entradas_30d,
            }
          : null,
      } satisfies ReguaDeFollowup;
    }),
  );

  return {
    reguas,
    semReguaPorEtapa: alcance
      ? Object.fromEntries(
          alcance.etapas.map((etapa) => [etapa.chave, etapa.sem_regua]),
        )
      : null,
  };
}

/** Teto da leitura das etiquetas em uso (so a coluna tags, sem paciente). */
const TETO_DAS_ETIQUETAS_EM_USO = 2000;

/**
 * As etiquetas que a clinica tem para escolher num filtro: as do catalogo
 * de conversa (com o tom) e as que ja estao nos leads, sem repetir pelo
 * nome (opcoesDeEtiqueta, a mesma regra do "Etiquetar lead"). Le SO a
 * coluna tags dos contatos com etiqueta, ate 2000, e devolve os nomes
 * distintos: nenhum contato identificado sai daqui (por isso sem trilha de
 * leitura, como as contagens da tela). Leitura que falha lanca.
 */
export async function fetchEtiquetasParaFiltro(
  supabase: SupabaseClient,
  clinicId: string,
  catalogo: readonly EtiquetaDeConversa[],
): Promise<OpcaoDeEtiqueta[]> {
  const { data, error } = await supabase
    .from("contact")
    .select("tags")
    .eq("clinic_id", clinicId)
    .neq("tags", "{}")
    .limit(TETO_DAS_ETIQUETAS_EM_USO);
  if (error) {
    throw new Error(error.message);
  }
  const emUso = ((data ?? []) as { tags: unknown }[]).map((linha) => ({
    tags: Array.isArray(linha.tags)
      ? (linha.tags as unknown[]).filter(
          (tag): tag is string =>
            typeof tag === "string" && chaveDaEtiqueta(tag).length > 0,
        )
      : [],
  }));
  return opcoesDeEtiqueta(catalogo, emUso);
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
    throw new Error((enviadas.error ?? naFila.error ?? puladas.error)!.message);
  }

  const linhas = (puladas.data ?? []) as {
    skipped_reason: string | null;
    sent_at: string | null;
    contact_id: string;
    message:
      | { delivery_status: string | null }[]
      | {
          delivery_status: string | null;
        }
      | null;
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
