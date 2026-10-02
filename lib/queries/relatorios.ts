import type { SupabaseClient } from "@supabase/supabase-js";

import {
  APPOINTMENT_STATUS,
  type AppointmentStatus,
} from "@/lib/design/status";
import {
  diaCivil,
  diasEntre,
  limitesDoDia,
  somarDias,
} from "@/lib/domain/horarios";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";

// Agregados POR PERIODO do Painel (Tela 5) e dos Relatorios (Tela 11),
// calculados no banco pelas RPCs da migration 20260918100000: uma por
// familia de tabela varrida (contact, appointment, message), cada uma
// devolvendo o periodo pedido E o anterior de mesma duracao numa chamada.
//
// Regras herdadas das licoes das telas anteriores:
// - Agregado e SQL: o PostgREST corta em 1000 linhas e o corte e silencioso.
// - Erro de leitura LANCA, nunca vira zero falso (precedente de
//   fetchMetricasDaRegua). Isso inclui a resposta null das RPCs: e a trava
//   do papel profissional no banco, e a tela trata como recorte
//   indisponivel, jamais como "0".
// - Fuso: os limites chegam PRONTOS em UTC, calculados aqui com
//   limitesDoDia no fuso da clinica (regra 3.6). A assinatura publica fala
//   em DIAS CIVIS (aaaa-mm-dd), que tambem sao o que entra nas chaves de
//   cache: estaveis e legiveis.
// - O que nao existe no shape nao existe no produto: nao ha chave de custo
//   em reais (message_pricing vazia, pendencia P1) nem de "% resolvido pela
//   IA" (nada escreve author='ia' ainda). Ausencia != zero.

export type Periodizado<T> = { atual: T; anterior: T | null };

export type LinhaDeCanal = {
  canal: string | null;
  leads: number;
  agendaram: number;
  compareceram: number;
};

export type LinhaDeCampanha = {
  campanha: string | null;
  campanhaId: string | null;
  leads: number;
  agendaram: number;
  compareceram: number;
};

export type FunilDoPeriodo = {
  leads: number;
  agendamentosCriados: number;
  comparecimentos: number;
  faltas: number;
  /** Dos leads que CHEGARAM no periodo: quantos ja agendaram/compareceram. */
  coorte: { leads: number; agendaram: number; compareceram: number };
  porCanal: LinhaDeCanal[];
  porCampanha: LinhaDeCampanha[];
};

export type AgendaDoPeriodo = {
  /** Consultas com inicio no periodo. */
  total: number;
  /** Consultas CRIADAS no periodo, qualquer status. */
  criados: number;
  porStatus: Record<AppointmentStatus, number>;
  /**
   * Confirmada em algum momento (status atual OU trilha de status): sem a
   * trilha, confirmado que virou compareceu perderia a confirmacao e a taxa
   * sairia falsa. Publicar como "X de Y" com Y = total.
   */
  confirmadasAlgumaVez: number;
  porProfissional: {
    professionalId: string;
    nome: string;
    total: number;
    compareceu: number;
    faltou: number;
    cancelados: number;
  }[];
  porProcedimento: {
    procedureId: string;
    nome: string;
    total: number;
    compareceu: number;
    faltou: number;
  }[];
  /** Horarios do periodo preenchidos pela reoferta (mesma regua do card da
   *  Tela 2: slot_starts_at). receitaCents ignora vinculo sem preco;
   *  semPreco conta esses a parte, para a tela nunca somar null como zero.
   *  receitaCents e null para quem nao e admin nem gestor (Fase 3: reais so
   *  para a gestao, aplicado NO BANCO): null e "sem acesso", nunca zero. */
  recuperadas: {
    total: number;
    receitaCents: number | null;
    semPreco: number;
  };
  /** Faltas do periodo cujo contato criou consulta nova em ate 30 dias.
   *  Factual: "remarcou apos a falta", nunca "recuperada pela regua". */
  remarcadasAposFalta: { faltas: number; remarcadas: number };
};

export type PivoDaRegua = {
  primeiraReguaEm: string;
  antes: { comDesfecho: number; faltas: number };
  depois: { comDesfecho: number; faltas: number };
} | null;

export type AtendimentoDoPeriodo = {
  conversasIniciadas: number;
  /** Mediana e p90, nunca media: uma noite sem plantao destruiria a media.
   *  null = sem conversa respondida no recorte ("sem dados", nunca 0). */
  primeiraResposta: {
    conversas: number;
    respondidas: number;
    medianaSegundos: number | null;
    p90Segundos: number | null;
  };
  mensagens: {
    porAutor: Record<string, number>;
    entrada: number;
    saida: number;
    notasInternas: number;
  };
};

/** Contagens do INSTANTE (nao do periodo): por isso ficam fora das RPCs. */
export type ProximasAcoes = {
  confirmacoesPendentesAmanha: number;
  aguardandoHumano: number;
  semResposta24h: number;
};

export type LinhaDeBase = {
  ratePercent: number;
  measuredFrom: string;
  measuredTo: string;
  note: string | null;
  createdAt: string;
} | null;

/**
 * Faturamento estimado de um periodo (faturamento_do_periodo): so consultas
 * com status compareceu, recortadas por starts_at. Valor = preco do vinculo,
 * senao o preco base do procedimento; "Coberto" pelo convenio sem valor NAO
 * cai no preco base e conta em cobertas; sem preco nenhum conta em semPreco;
 * preco 0 entra em comValor (gratuito de verdade).
 */
export type FaturamentoDoPeriodo = {
  comparecimentos: number;
  valorCents: number;
  comValor: number;
  cobertas: number;
  semPreco: number;
};

/** Um dia civil da clinica na serie "Leads x consultas agendadas". */
export type PontoDaSerie = {
  /** aaaa-mm-dd, dia civil no fuso da clinica */
  dia: string;
  leads: number;
  agendadas: number;
};

/** Sem linha = sem objetivo (o rodape "Objetivo: X%" some). */
export type ObjetivoDeConversao = {
  percentual: number;
  atualizadoEm: string;
} | null;

// ---------------------------------------------------------------------------
// Abas da Tela 11 (Fase 3): Visao geral, Marketing, Comercial, Agente de IA
// ---------------------------------------------------------------------------

export const ABAS_DE_RESULTADOS = [
  { chave: "geral", rotulo: "Visão geral" },
  { chave: "marketing", rotulo: "Marketing" },
  { chave: "comercial", rotulo: "Comercial" },
  { chave: "ia", rotulo: "Agente de IA" },
] as const;

export type AbaDeResultados = (typeof ABAS_DE_RESULTADOS)[number]["chave"];

/**
 * Links antigos (as 5 abas de antes da Fase 3) continuam abrindo a vista
 * que recebeu o conteudo: Origem foi para Marketing, Agendamentos e
 * Confirmacao para Comercial, Custos para Agente de IA. "ia" manteve a chave.
 */
const ALIAS_DAS_ABAS: Record<string, AbaDeResultados> = {
  origem: "marketing",
  agendamentos: "comercial",
  confirmacao: "comercial",
  custos: "ia",
};

/** ?aba= da URL -> aba da tela. Ausente ou desconhecida cai na Visao geral. */
export function resolverAbaDeResultados(
  valor: string | null | undefined,
): AbaDeResultados {
  if (!valor) {
    return "geral";
  }
  const direta = ABAS_DE_RESULTADOS.find((aba) => aba.chave === valor);
  if (direta) {
    return direta.chave;
  }
  // hasOwn: "constructor" ou "toString" na URL nao podem achar o prototipo.
  return Object.prototype.hasOwnProperty.call(ALIAS_DAS_ABAS, valor)
    ? (ALIAS_DAS_ABAS[valor] ?? "geral")
    : "geral";
}

export const relatoriosKeys = {
  funil: (clinicId: string, diaDe: string, diaAte: string) =>
    ["relatorios", clinicId, "funil", diaDe, diaAte] as const,
  agenda: (
    clinicId: string,
    diaDe: string,
    diaAte: string,
    professionalId: string | null,
  ) =>
    ["relatorios", clinicId, "agenda", diaDe, diaAte, professionalId] as const,
  atendimento: (clinicId: string, diaDe: string, diaAte: string) =>
    ["relatorios", clinicId, "atendimento", diaDe, diaAte] as const,
  linhaDeBase: (clinicId: string) =>
    ["relatorios", clinicId, "linha-de-base"] as const,
  faturamento: (clinicId: string, diaDe: string, diaAte: string) =>
    ["relatorios", clinicId, "faturamento", diaDe, diaAte] as const,
  serie: (clinicId: string, diaDe: string, diaAte: string) =>
    ["relatorios", clinicId, "serie", diaDe, diaAte] as const,
  objetivo: (clinicId: string) =>
    ["relatorios", clinicId, "objetivo-de-conversao"] as const,
  proximasAcoes: (clinicId: string) =>
    ["inicio", clinicId, "proximas-acoes"] as const,
};

// ---------------------------------------------------------------------------
// Janela: dias civis da clinica -> limites UTC + inicio do periodo anterior
// ---------------------------------------------------------------------------

/**
 * [de, ate) em UTC para o intervalo de dias civis [diaDe, diaAte] no fuso da
 * clinica, mais o inicio do periodo anterior CONTIGUO de mesma duracao em
 * dias civis. Passar o inicio anterior explicito (em vez de derivar por
 * subtracao de instantes no SQL) mantem os dois periodos em dias civis
 * exatos mesmo em fuso com horario de verao.
 */
export function janelaDoPeriodo(
  timezone: string,
  diaDe: string,
  diaAte: string,
): { de: string; ate: string; deAnterior: string } {
  const dias = diasEntre(diaDe, diaAte) + 1;
  return {
    de: limitesDoDia(timezone, diaDe).inicio.toISOString(),
    ate: limitesDoDia(timezone, diaAte).fim.toISOString(),
    deAnterior: limitesDoDia(timezone, somarDias(diaDe, -dias)).inicio.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fetchers das RPCs
// ---------------------------------------------------------------------------

type Opcoes = { comparar?: boolean };

function exigirCorpo<T>(data: unknown, rpc: string): { atual: T; anterior?: T } {
  // null e a trava de papel do banco (profissional pedindo agregado da
  // clinica, ou o recorte de outro profissional). Nunca renderizar zero.
  if (data === null || data === undefined) {
    throw new Error(`Recorte indisponível para este perfil (${rpc}).`);
  }
  return data as { atual: T; anterior?: T };
}

type FunilRpc = {
  leads: number;
  agendamentos_criados: number;
  comparecimentos: number;
  faltas: number;
  coorte: { leads: number; agendaram: number; compareceram: number };
  por_canal: {
    canal: string | null;
    leads: number;
    agendaram: number;
    compareceram: number;
  }[];
  por_campanha: {
    campanha: string | null;
    campanha_id: string | null;
    leads: number;
    agendaram: number;
    compareceram: number;
  }[];
};

function lerFunil(bloco: FunilRpc): FunilDoPeriodo {
  return {
    leads: bloco.leads,
    agendamentosCriados: bloco.agendamentos_criados,
    comparecimentos: bloco.comparecimentos,
    faltas: bloco.faltas,
    coorte: bloco.coorte,
    porCanal: bloco.por_canal,
    porCampanha: bloco.por_campanha.map((linha) => ({
      campanha: linha.campanha,
      campanhaId: linha.campanha_id,
      leads: linha.leads,
      agendaram: linha.agendaram,
      compareceram: linha.compareceram,
    })),
  };
}

export async function fetchFunilDoPeriodo(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  diaDe: string,
  diaAte: string,
  opcoes: Opcoes = {},
): Promise<Periodizado<FunilDoPeriodo>> {
  const janela = janelaDoPeriodo(timezone, diaDe, diaAte);
  const { data, error } = await supabase.rpc("funil_do_periodo", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
    ...(opcoes.comparar === false ? {} : { p_de_anterior: janela.deAnterior }),
  });
  if (error) {
    throw new Error(error.message);
  }
  const corpo = exigirCorpo<FunilRpc>(data, "funil_do_periodo");
  return {
    atual: lerFunil(corpo.atual),
    anterior: corpo.anterior ? lerFunil(corpo.anterior) : null,
  };
}

type AgendaRpc = {
  total: number;
  criados: number;
  por_status: Record<string, number>;
  confirmadas_alguma_vez: number;
  por_profissional: {
    professional_id: string;
    nome: string;
    total: number;
    compareceu: number;
    faltou: number;
    cancelados: number;
  }[];
  por_procedimento: {
    procedure_id: string;
    nome: string;
    total: number;
    compareceu: number;
    faltou: number;
  }[];
  /** receita_cents e null para recepcao, leitura e profissional. */
  recuperadas: {
    total: number;
    receita_cents: number | null;
    sem_preco: number;
  };
  remarcadas_apos_falta: { faltas: number; remarcadas: number };
};

type PivoRpc = {
  primeira_regua_em: string;
  antes: { com_desfecho: number; faltas: number };
  depois: { com_desfecho: number; faltas: number };
} | null;

/** Zero-fill: o group by do banco omite status sem consulta, e etapa que
 *  some em silencio e mentira visual. A lista oficial vem do design. */
function preencherStatus(
  bruto: Record<string, number>,
): Record<AppointmentStatus, number> {
  const cheio = {} as Record<AppointmentStatus, number>;
  for (const status of Object.keys(APPOINTMENT_STATUS) as AppointmentStatus[]) {
    cheio[status] = bruto[status] ?? 0;
  }
  return cheio;
}

function lerAgenda(bloco: AgendaRpc): AgendaDoPeriodo {
  return {
    total: bloco.total,
    criados: bloco.criados,
    porStatus: preencherStatus(bloco.por_status),
    confirmadasAlgumaVez: bloco.confirmadas_alguma_vez,
    porProfissional: bloco.por_profissional.map((linha) => ({
      professionalId: linha.professional_id,
      nome: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
      cancelados: linha.cancelados,
    })),
    porProcedimento: bloco.por_procedimento.map((linha) => ({
      procedureId: linha.procedure_id,
      nome: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
    })),
    recuperadas: {
      total: bloco.recuperadas.total,
      receitaCents: bloco.recuperadas.receita_cents,
      semPreco: bloco.recuperadas.sem_preco,
    },
    remarcadasAposFalta: bloco.remarcadas_apos_falta,
  };
}

export async function fetchAgendaDoPeriodo(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  diaDe: string,
  diaAte: string,
  opcoes: Opcoes & { professionalId?: string | null } = {},
): Promise<Periodizado<AgendaDoPeriodo> & { pivo: PivoDaRegua }> {
  const janela = janelaDoPeriodo(timezone, diaDe, diaAte);
  const { data, error } = await supabase.rpc("agenda_do_periodo", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
    ...(opcoes.comparar === false ? {} : { p_de_anterior: janela.deAnterior }),
    ...(opcoes.professionalId ? { p_professional_id: opcoes.professionalId } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  const corpo = exigirCorpo<AgendaRpc>(data, "agenda_do_periodo") as {
    atual: AgendaRpc;
    anterior?: AgendaRpc;
    pivo: PivoRpc;
  };
  return {
    atual: lerAgenda(corpo.atual),
    anterior: corpo.anterior ? lerAgenda(corpo.anterior) : null,
    pivo: corpo.pivo
      ? {
          primeiraReguaEm: corpo.pivo.primeira_regua_em,
          antes: {
            comDesfecho: corpo.pivo.antes.com_desfecho,
            faltas: corpo.pivo.antes.faltas,
          },
          depois: {
            comDesfecho: corpo.pivo.depois.com_desfecho,
            faltas: corpo.pivo.depois.faltas,
          },
        }
      : null,
  };
}

type AtendimentoRpc = {
  conversas_iniciadas: number;
  primeira_resposta: {
    conversas: number;
    respondidas: number;
    mediana_segundos: number | null;
    p90_segundos: number | null;
  };
  mensagens: {
    por_autor: Record<string, number>;
    entrada: number;
    saida: number;
    notas_internas: number;
  };
};

function lerAtendimento(bloco: AtendimentoRpc): AtendimentoDoPeriodo {
  return {
    conversasIniciadas: bloco.conversas_iniciadas,
    primeiraResposta: {
      conversas: bloco.primeira_resposta.conversas,
      respondidas: bloco.primeira_resposta.respondidas,
      medianaSegundos: bloco.primeira_resposta.mediana_segundos,
      p90Segundos: bloco.primeira_resposta.p90_segundos,
    },
    mensagens: {
      porAutor: bloco.mensagens.por_autor,
      entrada: bloco.mensagens.entrada,
      saida: bloco.mensagens.saida,
      notasInternas: bloco.mensagens.notas_internas,
    },
  };
}

export async function fetchAtendimentoDoPeriodo(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  diaDe: string,
  diaAte: string,
  opcoes: Opcoes = {},
): Promise<Periodizado<AtendimentoDoPeriodo>> {
  const janela = janelaDoPeriodo(timezone, diaDe, diaAte);
  const { data, error } = await supabase.rpc("atendimento_do_periodo", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
    ...(opcoes.comparar === false ? {} : { p_de_anterior: janela.deAnterior }),
  });
  if (error) {
    throw new Error(error.message);
  }
  const corpo = exigirCorpo<AtendimentoRpc>(data, "atendimento_do_periodo");
  return {
    atual: lerAtendimento(corpo.atual),
    anterior: corpo.anterior ? lerAtendimento(corpo.anterior) : null,
  };
}

// ---------------------------------------------------------------------------
// Contagens do instante e linha de base
// ---------------------------------------------------------------------------

export async function fetchProximasAcoes(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
): Promise<ProximasAcoes> {
  // O mesmo recorte "pendentes de amanha" do contador do menu (layout.tsx).
  const amanha = limitesDoDia(timezone, somarDias(diaCivil(timezone, new Date()), 1));
  const ha24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const [pendentes, aguardando, semResposta] = await Promise.all([
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("status", STATUS_PENDENTES)
      .gte("starts_at", amanha.inicio.toISOString())
      .lt("starts_at", amanha.fim.toISOString()),
    supabase
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "aguardando_humano")
      .eq("awaiting_reply", true),
    supabase
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("awaiting_reply", true)
      .neq("status", "resolvida")
      .lt("last_inbound_at", ha24h),
  ]);

  // Numero falso e pior que estado de erro: qualquer falha derruba o bloco.
  for (const resposta of [pendentes, aguardando, semResposta]) {
    if (resposta.error) {
      throw new Error(resposta.error.message);
    }
  }
  return {
    confirmacoesPendentesAmanha: pendentes.count ?? 0,
    aguardandoHumano: aguardando.count ?? 0,
    semResposta24h: semResposta.count ?? 0,
  };
}


export async function fetchLinhaDeBase(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<LinhaDeBase> {
  const { data, error } = await supabase
    .from("no_show_baseline")
    .select("rate_percent, measured_from, measured_to, note, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return {
    ratePercent: Number(data.rate_percent),
    measuredFrom: data.measured_from,
    measuredTo: data.measured_to,
    note: data.note,
    createdAt: data.created_at,
  };
}

// ---------------------------------------------------------------------------
// Fase 3: faturamento, serie diaria e objetivo de conversao
// ---------------------------------------------------------------------------

type FaturamentoRpc = {
  comparecimentos: number;
  valor_cents: number;
  com_valor: number;
  cobertas: number;
  sem_preco: number;
};

function lerFaturamento(bloco: FaturamentoRpc): FaturamentoDoPeriodo {
  return {
    comparecimentos: bloco.comparecimentos,
    valorCents: bloco.valor_cents,
    comValor: bloco.com_valor,
    cobertas: bloco.cobertas,
    semPreco: bloco.sem_preco,
  };
}

/**
 * Faturamento estimado do periodo e do anterior. So chamar para admin e
 * gestor: a funcao devolve null para qualquer outro papel (e para outra
 * clinica), e aqui null vira null, que a tela mostra como "Sem acesso".
 * Nunca zero: zero e um numero medido, null e falta de permissao.
 */
export async function fetchFaturamentoDoPeriodo(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  diaDe: string,
  diaAte: string,
  opcoes: Opcoes = {},
): Promise<Periodizado<FaturamentoDoPeriodo> | null> {
  const janela = janelaDoPeriodo(timezone, diaDe, diaAte);
  const { data, error } = await supabase.rpc("faturamento_do_periodo", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
    ...(opcoes.comparar === false ? {} : { p_de_anterior: janela.deAnterior }),
  });
  if (error) {
    throw new Error(error.message);
  }
  if (data === null || data === undefined) {
    return null;
  }
  const corpo = data as { atual: FaturamentoRpc; anterior?: FaturamentoRpc };
  return {
    atual: lerFaturamento(corpo.atual),
    anterior: corpo.anterior ? lerFaturamento(corpo.anterior) : null,
  };
}

/**
 * Um ponto por dia civil da clinica no periodo, com zero no dia vazio. Os
 * criterios sao os do funil_do_periodo (leads por first_contact_at,
 * agendadas por created_at): a soma bate com os cartoes da Visao geral.
 */
export async function fetchSerieDiariaDoPeriodo(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  diaDe: string,
  diaAte: string,
): Promise<PontoDaSerie[]> {
  const janela = janelaDoPeriodo(timezone, diaDe, diaAte);
  const { data, error } = await supabase.rpc("serie_diaria_do_periodo", {
    p_clinic_id: clinicId,
    p_de: janela.de,
    p_ate: janela.ate,
  });
  if (error) {
    throw new Error(error.message);
  }
  if (data === null || data === undefined) {
    // Trava do profissional no banco: recorte indisponivel, nunca serie zerada.
    throw new Error("Recorte indisponível para este perfil (serie_diaria_do_periodo).");
  }
  return (data as PontoDaSerie[]).map((ponto) => ({
    dia: ponto.dia,
    leads: ponto.leads,
    agendadas: ponto.agendadas,
  }));
}

export async function fetchObjetivoDeConversao(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ObjetivoDeConversao> {
  const { data, error } = await supabase
    .from("objetivo_de_conversao")
    .select("percentual, updated_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return {
    percentual: Number(data.percentual),
    atualizadoEm: data.updated_at as string,
  };
}
