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
   *  semPreco conta esses a parte, para a tela nunca somar null como zero. */
  recuperadas: { total: number; receitaCents: number; semPreco: number };
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
  recuperadas: { total: number; receita_cents: number; sem_preco: number };
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
