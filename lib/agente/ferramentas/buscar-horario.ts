// Ferramenta buscar_horario do agente de IA (E4, contrato da E4 secao 2;
// AG3): horarios livres de um procedimento, lidos da Agenda de verdade.
// PURO: o plano diz o que carregar (profissionais, recursos e o periodo); o
// carregador do servidor (lib/agente/agenda.ts) le a Agenda com o clinic_id
// explicito, sem nome nem telefone de paciente; e a escolha roda aqui, sobre
// o availableSlots que a Agenda ja usa (lib/domain/scheduling.ts).
//
// Regras:
//  - So vinculo do agente (as duas chaves "IA pode agendar", profissional e
//    convenio ativos: o catalogo de buscar_procedimento) com id e duracao.
//    A duracao e a do VINCULO, como na Agenda e na RPC.
//  - O periodo vai da antecedencia minima ao horizonte da configuracao
//    publicada (D13, ninguem inventa valor): o primeiro inicio e agora mais a
//    antecedencia (mais FOLGA_DA_ANTECEDENCIA_MS, para o horario oferecido
//    continuar valido ate a reserva vencer: o agendar confere a antecedencia
//    de novo na hora da marcacao) e o ultimo, agora mais o horizonte. Tudo no
//    fuso da clinica (regra 3.6).
//  - Convenio pela MESMA regra de buscar_procedimento (convenioParaAgenda):
//    identificado sem vinculo nenhum daquele procedimento (e do profissional
//    pedido) e "convenio_nao_atendido" (D14), com o particular do Cadastro (o
//    valor so quando a clinica deixa informar preco, e so o que veio do
//    Cadastro). Com vinculo ATIVO que a IA nao marca (sem "IA pode agendar",
//    ou sem duracao), e "convenio_so_com_a_equipe": o profissional atende,
//    so a equipe marca, e o modelo passa sem dizer que nao atende (correcao
//    da E4). Duvida sobre o convenio volta como opcoes, sem valor.
//  - Nunca inventa: sem horario, "sem_horario". AG2 (27/10/2026): quando
//    NENHUM profissional do pedido tem jornada cadastrada, o resultado e
//    "agenda_nao_cadastrada".
//
// AG3 (27/10/2026), o agendamento completo:
//  - UNIDADE: o parametro `unidade` (codigo u1, u2... de consultar_unidades,
//    ou null). Com unidade, so a jornada dela e a sem unidade contam (a sem
//    unidade vale para todas, como a Agenda e a RPC). Cada horario devolvido
//    traz a unidade dele: a da faixa de jornada; a faixa sem unidade, com a
//    unidade pedida, e dela, e sem unidade pedida e da unica unidade ativa da
//    clinica (com mais de uma, fica sem unidade, e o modelo pergunta). A
//    faixa de uma unidade que nao esta entre as ativas do agente nao entra
//    (nunca se oferece horario num lugar que o modelo nao pode nomear). O
//    profissional pedido sem jornada na unidade pedida: "nao_atende_na_
//    unidade".
//  - GRADE: os inicios saem na grade do profissional (professional.
//    grade_minutos) ou, sem ela, de duracao em duracao, contados do inicio
//    da faixa de jornada (ancorarNaJornada): 08:00, 08:45, 09:30... com grade
//    de 45. Antes era a grade de 15 minutos da Agenda.
//  - IDADE: com o nascimento conhecido (o do cadastro do contato ou o
//    informado na conversa), o profissional cuja idade atendida nao inclui a
//    do paciente no dia do horario fica de fora; nenhum sobrando:
//    "idade_nao_atendida" (sem dizer a idade a ninguem).
//  - OFERTA ESPALHADA: ate HORARIOS_POR_BUSCA horarios, o primeiro de cada
//    um dos proximos periodos (manha, tarde, noite) de cada dia, em vez dos
//    primeiros inicios colados de 15 em 15 minutos; sobrando vaga, outros
//    horarios do mesmo dia com pelo menos 1 hora de distancia.
//  - HORA PEDIDA: com `hora` ("HH:mm"), "hora_pedida_livre" (a hora esta
//    livre no dia pedido, ou no primeiro dia em que estiver) com ela, ou
//    "hora_pedida_ocupada" com os horarios mais proximos dela.
//  - Os codigos h1, h2... continuam os do turno e passam a valer entre as
//    mensagens pelo estado do atendimento (lib/agente/atendimento.ts):
//    mapeiam para (service_link_id, profissional, unidade, inicio, fim) no
//    servidor; nada disso vai ao modelo.

import { TZDate } from "@date-fns/tz";
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  agendaCompleta,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";
import type {
  FatosDaFerramenta,
  HorarioLivreDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import {
  diaCivil,
  horaParaMinutos,
  instanteLocal,
  minutosLocais,
} from "@/lib/domain/horarios";
import {
  availableSlots,
  type IntervaloOcupado,
  type JanelaSemanal,
} from "@/lib/domain/scheduling";

import {
  coberturaDoConvenio,
  convenioParaAgenda,
  indiceDosProfissionais,
  valoresDosVinculos,
  type CatalogoDoAgente,
  type ConvenioDoAgente,
  type ProcedimentoDoIndice,
  type VinculoDoAgente,
} from "./buscar-procedimento";
import type { UnidadeDoAgente } from "./cadastro-do-agente";
import { idadeNoDia } from "./registrar-dados";
import { MINUTOS_DA_RESERVA } from "./reservar-horario";

// ---------------------------------------------------------------------------
// Parametros
// ---------------------------------------------------------------------------

export const NOME_DA_BUSCA_DE_HORARIO = "buscar_horario";

/** No maximo isto de horarios por resposta da ferramenta (AG3: espalhados). */
export const HORARIOS_POR_BUSCA = 4;

/** Com a hora pedida: no maximo isto de horarios (a hora ou as mais proximas). */
export const HORARIOS_DA_HORA_PEDIDA = 3;

/** A distancia minima entre dois horarios oferecidos no mesmo dia. */
const DISTANCIA_NO_MESMO_DIA_MS = 60 * 60_000;

/**
 * Folga sobre a antecedencia minima. A RPC do reservar confere a
 * antecedencia com o relogio do banco, e a do agendar confere DE NOVO na
 * hora da marcacao, que pode vir ate MINUTOS_DA_RESERVA depois da reserva.
 * Todo horario oferecido tem de continuar valido ate a reserva vencer: a
 * folga e a reserva inteira mais 2 minutos, que cobrem o turno entre o
 * agoraMs do inicio dele e a reserva (PRAZO_DO_TURNO_MS, 45 s, e as leituras
 * antes do turno). Com 5 minutos (revisao da E4), a reserva ainda viva era
 * recusada com antes_da_antecedencia quando a pessoa confirmava.
 */
export const FOLGA_DA_ANTECEDENCIA_MS = (MINUTOS_DA_RESERVA + 2) * 60_000;

const UMA_HORA_MS = 60 * 60_000;
const UM_DIA_MS = 24 * UMA_HORA_MS;

/** Fuso de quando o da clinica nao e valido (CLAUDE.md 3.6). */
export const FUSO_PADRAO_DA_AGENDA = "America/Fortaleza";

export const PERIODOS_DO_DIA = ["manha", "tarde", "noite"] as const;
export type PeriodoDoDia = (typeof PERIODOS_DO_DIA)[number];

/**
 * O periodo pelo INICIO do horario, em minutos locais: manha antes das
 * 12:00, tarde das 12:00 as 17:59, noite das 18:00 em diante.
 */
const FAIXA_DO_PERIODO: Readonly<Record<PeriodoDoDia, [number, number]>> = {
  manha: [0, 12 * 60],
  tarde: [12 * 60, 18 * 60],
  noite: [18 * 60, 24 * 60],
};

// ---------------------------------------------------------------------------
// Entrada e definicao para a Responses API
// ---------------------------------------------------------------------------

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Entrada validada no servidor (o modelo nunca e confiavel). AG3: unidade e
 * hora; ausentes (chamada de antes da AG3) valem null.
 */
export const entradaDaBuscaDeHorarioSchema = z
  .object({
    procedimento: z.string().trim().min(1).max(64),
    profissional: z.string().trim().max(64).nullable(),
    convenio: z.string().trim().max(256).nullable(),
    a_partir_de: z.string().trim().max(10).nullable(),
    periodo: z.enum(PERIODOS_DO_DIA).nullable(),
    unidade: z.string().trim().max(16).nullable().optional(),
    hora: z.string().trim().max(5).nullable().optional(),
  })
  .strict();

/**
 * Definicao para a Responses API (strict: todas as propriedades exigidas,
 * nenhuma a mais). Escrita a mao, como buscar_procedimento; um teste confere
 * que as chaves batem com entradaDaBuscaDeHorarioSchema.
 */
export const FERRAMENTA_BUSCAR_HORARIO: FunctionTool = {
  type: "function",
  name: NOME_DA_BUSCA_DE_HORARIO,
  strict: true,
  description:
    "Consulta na Agenda da clínica horários livres de um procedimento, espalhados pelos próximos períodos e dias, cada um com um código (h1, h2...), o profissional e a unidade. Com hora, diz se aquela hora está livre ou traz as mais próximas.",
  parameters: {
    type: "object",
    properties: {
      procedimento: {
        type: "string",
        description:
          "Código do procedimento no bloco <procedimentos>, por exemplo p3.",
      },
      profissional: {
        type: ["string", "null"],
        description:
          "Código do profissional no bloco <profissionais>, por exemplo r2, ou null para qualquer profissional.",
      },
      convenio: {
        type: ["string", "null"],
        description:
          "Nome do convênio (e do plano, se o paciente disse) como o paciente falou, ou o chamar_com da opção que o paciente confirmou, ou null para o particular.",
      },
      a_partir_de: {
        type: ["string", "null"],
        description:
          "Dia a partir do qual procurar, no formato aaaa-mm-dd, ou null para o primeiro horário possível.",
      },
      periodo: {
        type: ["string", "null"],
        enum: ["manha", "tarde", "noite", null],
        description:
          "Período do dia: manha (antes das 12:00), tarde (das 12:00 às 18:00) ou noite (depois das 18:00), ou null para qualquer período.",
      },
      unidade: {
        type: ["string", "null"],
        description:
          "Código da unidade que a pessoa prefere (u1, u2...), de consultar_unidades, ou null para qualquer unidade.",
      },
      hora: {
        type: ["string", "null"],
        description:
          "A hora que a pessoa pediu, no formato HH:mm (por exemplo 15:00), ou null. Com a_partir_de, a hora daquele dia.",
      },
    },
    required: [
      "procedimento",
      "profissional",
      "convenio",
      "a_partir_de",
      "periodo",
      "unidade",
      "hora",
    ],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// O que o carregador le (lib/agente/agenda.ts) e devolve
// ---------------------------------------------------------------------------

/** O que a busca precisa da Agenda: profissionais, recursos e o periodo. */
export type PedidoDaAgenda = {
  profissionais: string[];
  recursos: string[];
  /**
   * Os vinculos do catalogo (de qualquer profissional) cujo procedimento usa
   * um dos `recursos`: a reserva viva de OUTRA conversa num deles ocupa o
   * recurso (revisao da E4; a RPC confere o mesmo). Ausente: nenhum.
   */
  vinculosDosRecursos?: { serviceLinkId: string; recursoId: string }[];
  inicio: Date;
  fim: Date;
};

/**
 * Uma faixa da jornada semanal com a unidade (AG3; ausente ou nula = a faixa
 * vale para qualquer unidade, como na Agenda).
 */
export type JanelaDaAgenda = JanelaSemanal & { unidadeId?: string | null };

/**
 * A Agenda lida para o pedido, SO horarios (nunca nome, telefone nem
 * observacao de paciente): jornada semanal por profissional (com a unidade
 * de cada faixa), bloqueios, consultas nao canceladas (encaixe conta),
 * reservas vivas de OUTRAS conversas e a ocupacao de cada recurso por
 * qualquer profissional.
 */
export type AgendaCarregada = {
  jornadas: ReadonlyMap<string, readonly JanelaDaAgenda[]>;
  bloqueios: ReadonlyMap<string, readonly IntervaloOcupado[]>;
  consultas: ReadonlyMap<string, readonly IntervaloOcupado[]>;
  reservas: ReadonlyMap<string, readonly IntervaloOcupado[]>;
  recursos: ReadonlyMap<string, readonly IntervaloOcupado[]>;
};

export const AGENDA_VAZIA: AgendaCarregada = {
  jornadas: new Map(),
  bloqueios: new Map(),
  consultas: new Map(),
  reservas: new Map(),
  recursos: new Map(),
};

// ---------------------------------------------------------------------------
// Datas no fuso da clinica
// ---------------------------------------------------------------------------

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

/** O fuso da clinica, ou o padrao quando ele nao e um fuso IANA valido. */
export function fusoDaAgenda(fuso: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO_DA_AGENDA;
  }
}

/**
 * "terça, 21/10" e "14:00" no fuso da clinica (o formato do contrato). O ano
 * so entra quando nao e o de `agoraMs` ("terça, 21/10/2027"): com horizonte
 * de ate 365 dias, o mesmo dia e mes pode ser deste ano ou do proximo.
 */
export function diaEHora(
  instante: Date,
  fuso: string,
  agoraMs: number,
): { dia: string; hora: string } {
  const valido = fusoDaAgenda(fuso);
  const local = new TZDate(instante.getTime(), valido);
  const agora = new TZDate(agoraMs, valido);
  const dd = String(local.getDate()).padStart(2, "0");
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  const ano =
    local.getFullYear() === agora.getFullYear()
      ? ""
      : `/${local.getFullYear()}`;
  const hh = String(local.getHours()).padStart(2, "0");
  const mi = String(local.getMinutes()).padStart(2, "0");
  return {
    dia: `${DIAS_DA_SEMANA[local.getDay()] ?? ""}, ${dd}/${mm}${ano}`,
    hora: `${hh}:${mi}`,
  };
}

/** "terça, 21/10 às 14:00" (trilha e passos). */
export function diaAsHora(instante: Date, fuso: string, agoraMs: number) {
  const { dia, hora } = diaEHora(instante, fuso, agoraMs);
  return `${dia} às ${hora}`;
}

/** aaaa-mm-dd que existe no calendario, ou null. */
function diaValido(texto: string): string | null {
  if (!DIA.test(texto)) {
    return null;
  }
  const [ano, mes, dia] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1));
  return data.getUTCFullYear() === ano &&
    data.getUTCMonth() + 1 === mes &&
    data.getUTCDate() === dia
    ? texto
    : null;
}

// ---------------------------------------------------------------------------
// Plano e escolha
// ---------------------------------------------------------------------------

/** Um vinculo que agenda: com id e duracao (o resto, so preco). */
export type VinculoAgendavel = VinculoDoAgente & {
  id: string;
  duracaoMin: number;
};

function agendavel(v: VinculoDoAgente): v is VinculoAgendavel {
  return v.id !== null && v.duracaoMin !== null && v.duracaoMin > 0;
}

/** Um horario oferecido, guardado pelo turno sob o codigo. */
export type HorarioOferecido = {
  codigo: string;
  serviceLinkId: string;
  profissionalId: string;
  /** ISO (UTC). */
  inicio: string;
  fim: string;
  dia: string;
  hora: string;
  profissional: string;
  procedimento: string;
  duracaoMin: number;
  /** AG3: a unidade do horario (null = sem unidade definida). */
  unidadeId: string | null;
  unidade: string | null;
  unidadeCodigo: string | null;
  /** AG3: o convenio do vinculo (null = particular). */
  convenioId: string | null;
  /** AG3: quando foi oferecido (ISO, UTC); o estado guarda. */
  oferecidoEm: string;
};

export type ResultadoDaBuscaDeHorario = {
  /** JSON para o modelo (function_call_output). */
  saida: string;
  /** Centavos de todo valor devolvido (precosDoTurno do filtro). */
  precos: number[];
  /** O passo da trilha, so com nomes do Cadastro e datas. */
  passo: string;
  /** Codigo do resultado, para log e teste (lista fechada). */
  resultado:
    | "horarios"
    | "hora_pedida_livre"
    | "hora_pedida_ocupada"
    | "sem_horario"
    | "agenda_nao_cadastrada"
    | "agenda_nao_configurada"
    | "procedimento_nao_agendavel"
    | "profissional_nao_encontrado"
    | "unidade_nao_encontrada"
    | "nao_atende_na_unidade"
    | "idade_nao_atendida"
    | "convenio_nao_atendido"
    | "convenio_so_com_a_equipe"
    | "convenio_nao_informado"
    | "convenio_nao_encontrado"
    | "convenio_nao_confirmado"
    | "plano_nao_informado"
    | "entrada_invalida";
  /** Os horarios com codigo (vazio sem horario). */
  horarios: HorarioOferecido[];
  /**
   * O que a saida afirma do convenio identificado, para os fatos do turno
   * (AG2): "atende" quando ele tem vinculo no procedimento (horarios, sem
   * horario, so com a equipe), "nao_atende" no convenio_nao_atendido, com
   * o procedimento. Com horarios, tambem os horarios livres (o dia, a hora
   * e a unidade como foram ao modelo).
   */
  fatos?: FatosDaFerramenta;
};

/** O que a escolha precisa depois que a Agenda foi lida. */
export type PlanoDaBusca = {
  procedimento: ProcedimentoDoIndice;
  /** "particular" ou o nome do convenio identificado, como vai ao modelo. */
  convenio: string;
  /** O convenio identificado no Cadastro (null no particular). */
  convenioDoCadastro?: ConvenioDoAgente | null;
  /** O nome do profissional pedido, ou null (qualquer um). */
  profissional: string | null;
  /** AG3: o id do profissional pedido, ou null. */
  profissionalId?: string | null;
  vinculos: VinculoAgendavel[];
  inicio: Date;
  /** O ultimo inicio possivel (agora mais o horizonte). */
  limite: Date;
  periodo: PeriodoDoDia | null;
  fuso: string;
  agoraMs: number;
  /** AG3: a unidade pedida, ou null (qualquer unidade). */
  unidade?: UnidadeDoAgente | null;
  /** AG3: as unidades ativas do agente (a da faixa tem de estar aqui). */
  unidades?: readonly UnidadeDoAgente[];
  /** AG3: a hora pedida ("HH:mm"), ou null. */
  hora?: string | null;
  /** AG3: o dia pedido (aaaa-mm-dd, a_partir_de), ou null. */
  diaPedido?: string | null;
  /** AG3: a grade de cada profissional (minutos), quando cadastrada. */
  grades?: ReadonlyMap<string, number>;
  /** AG3: a idade atendida de cada profissional, quando cadastrada. */
  idades?: ReadonlyMap<string, { minima: number | null; maxima: number | null }>;
  /** AG3: os nascimentos conhecidos do paciente (aaaa-mm-dd). */
  nascimentos?: readonly string[];
};

export type PlanoOuResultado =
  | { tipo: "resultado"; resultado: ResultadoDaBuscaDeHorario }
  | { tipo: "plano"; plano: PlanoDaBusca; pedido: PedidoDaAgenda };

function pronto(
  resultado: ResultadoDaBuscaDeHorario["resultado"],
  saida: Record<string, unknown>,
  passo: string,
  precos: number[] = [],
  fatos?: FatosDaFerramenta,
): PlanoOuResultado {
  return {
    tipo: "resultado",
    resultado: {
      saida: JSON.stringify({ resultado, ...saida }),
      precos,
      passo,
      resultado,
      horarios: [],
      ...(fatos === undefined ? {} : { fatos }),
    },
  };
}

/** O convenio do plano atende (tem vinculo no procedimento). */
function fatosDoConvenio(
  convenio: ConvenioDoAgente | null | undefined,
  procedimento: string,
): FatosDaFerramenta | undefined {
  return convenio === null || convenio === undefined
    ? undefined
    : { coberturas: [coberturaDoConvenio(convenio, "atende", procedimento)] };
}

function rotuloDaModalidade(convenio: string): string {
  return convenio === "particular"
    ? "no particular"
    : `pelo convênio ${convenio}`;
}

function textoDaBusca(
  procedimento: string,
  profissional: string | null,
  convenio: string,
  unidade: string | null = null,
): string {
  const com = profissional === null ? "" : ` com ${profissional}`;
  const onde = unidade === null ? "" : `, na unidade ${unidade}`;
  return `Consultou a agenda de ${procedimento}${com}, ${rotuloDaModalidade(convenio)}${onde}`;
}

/**
 * O primeiro passo de buscar_horario: valida a entrada, identifica o
 * procedimento, o profissional, o convenio e a unidade, e devolve o que
 * carregar da Agenda (ou o resultado, quando nem precisa ler a Agenda).
 * Nunca lanca.
 */
export function planejarBuscaDeHorario(entrada: {
  catalogo: CatalogoDoAgente;
  agenda: AgendaDoAgente;
  argumentos: unknown;
  agoraMs: number;
  fuso: string;
  /** A clinica deixa informar preco (habilidade informar_preco_e_convenio). */
  informarValor: boolean;
  /**
   * AG3: os nascimentos conhecidos do paciente (aaaa-mm-dd: o do cadastro
   * do contato e o informado na conversa), para a idade atendida. Nunca vai
   * ao modelo. Ausente: nenhum.
   */
  nascimentos?: readonly string[];
}): PlanoOuResultado {
  const { catalogo } = entrada;
  const lido = entradaDaBuscaDeHorarioSchema.safeParse(entrada.argumentos);
  if (!lido.success) {
    return pronto(
      "entrada_invalida",
      {},
      "Tentou consultar a agenda com um pedido incompleto",
    );
  }
  const pedido = lido.data;
  const aPartirDe =
    pedido.a_partir_de === null || pedido.a_partir_de === ""
      ? null
      : diaValido(pedido.a_partir_de);
  if (pedido.a_partir_de !== null && pedido.a_partir_de !== "" && !aPartirDe) {
    return pronto(
      "entrada_invalida",
      {},
      "Tentou consultar a agenda com uma data fora do formato",
    );
  }
  const hora =
    pedido.hora === null || pedido.hora === undefined || pedido.hora === ""
      ? null
      : pedido.hora;
  if (hora !== null && !HORA.test(hora)) {
    return pronto(
      "entrada_invalida",
      {},
      "Tentou consultar a agenda com uma hora fora do formato",
    );
  }
  if (!agendaCompleta(entrada.agenda)) {
    return pronto(
      "agenda_nao_configurada",
      {},
      "Consultou a agenda: a antecedência e o horizonte não estão preenchidos",
    );
  }

  const codigo = pedido.procedimento.toLowerCase();
  const procedimento = catalogo.procedimentos.find((p) => p.codigo === codigo);
  if (procedimento === undefined) {
    return pronto(
      "procedimento_nao_agendavel",
      {},
      "Procurou na agenda um procedimento que não está entre os que o assistente marca",
    );
  }

  let profissional: { id: string; nome: string } | null = null;
  const codigoDoProfissional = (pedido.profissional ?? "").toLowerCase();
  if (codigoDoProfissional !== "") {
    const achado = indiceDosProfissionais(catalogo).find(
      (p) => p.codigo === codigoDoProfissional,
    );
    if (achado === undefined) {
      return pronto(
        "profissional_nao_encontrado",
        { procedimento: procedimento.nome },
        `Consultou a agenda de ${procedimento.nome}: o profissional pedido não está entre os que o assistente marca`,
      );
    }
    profissional = { id: achado.id, nome: achado.nome };
  }

  // AG3: a unidade pedida (o codigo de consultar_unidades).
  const unidades = catalogo.unidades ?? [];
  let unidade: UnidadeDoAgente | null = null;
  const codigoDaUnidade = (pedido.unidade ?? "").toLowerCase();
  if (codigoDaUnidade !== "") {
    const achada = unidades.find((u) => u.codigo === codigoDaUnidade);
    if (achada === undefined) {
      return pronto(
        "unidade_nao_encontrada",
        { procedimento: procedimento.nome },
        `Consultou a agenda de ${procedimento.nome}: a unidade pedida não está entre as unidades ativas`,
      );
    }
    unidade = achada;
  }

  const doProcedimento = catalogo.vinculos
    .filter(agendavel)
    .filter(
      (v) =>
        v.procedimentoId === procedimento.id &&
        (profissional === null || v.profissionalId === profissional.id),
    );
  if (doProcedimento.length === 0) {
    return pronto(
      "procedimento_nao_agendavel",
      {
        procedimento: procedimento.nome,
        ...(profissional === null ? {} : { profissional: profissional.nome }),
      },
      profissional === null
        ? `Consultou a agenda de ${procedimento.nome}: o assistente não marca este procedimento`
        : `Consultou a agenda de ${procedimento.nome}: o assistente não marca este procedimento com ${profissional.nome}`,
    );
  }

  const convenio = convenioParaAgenda(catalogo, pedido.convenio);
  const doPaciente = `Consultou a agenda de ${procedimento.nome}`;
  switch (convenio.tipo) {
    case "convenio_nao_informado":
      return pronto(
        "convenio_nao_informado",
        { procedimento: procedimento.nome },
        `${doPaciente}: a consulta não trouxe um nome de convênio que dê para identificar`,
      );
    case "convenio_nao_encontrado":
      return pronto(
        "convenio_nao_encontrado",
        { procedimento: procedimento.nome },
        `${doPaciente}: nenhum convênio parecido no Cadastro`,
      );
    case "convenio_nao_confirmado":
      return pronto(
        "convenio_nao_confirmado",
        {
          procedimento: procedimento.nome,
          opcoes: convenio.opcoes,
          mais_opcoes: convenio.maisOpcoes,
        },
        `${doPaciente}: não deu para confirmar qual convênio; parecidos no Cadastro: ${convenio.nomes.join(", ")}${convenio.maisOpcoes ? " e outros" : ""}`,
      );
    case "plano_nao_informado":
      return pronto(
        "plano_nao_informado",
        {
          procedimento: procedimento.nome,
          planos_da_operadora: convenio.opcoes,
        },
        `${doPaciente}: falta saber qual plano de ${convenio.operadora}`,
      );
    case "particular":
    case "casou":
      break;
  }

  const nomeDoConvenio =
    convenio.tipo === "casou" ? convenio.nome : "particular";
  const convenioDoCadastro =
    convenio.tipo === "casou" ? convenio.convenio : null;
  const vinculos = doProcedimento.filter((v) =>
    convenio.tipo === "casou"
      ? v.convenioId === convenio.convenio.id
      : v.convenioId === null,
  );
  if (vinculos.length === 0 && convenio.tipo === "casou") {
    // O profissional atende o convenio neste procedimento, mas por um
    // vinculo que a IA nao marca (sem "IA pode agendar" ou sem duracao): so
    // a equipe marca. Dizer que ele "nao atende" seria falso e empurraria o
    // paciente para o particular.
    const doPedido = (v: {
      procedimentoId: string;
      profissionalId: string;
      convenioId: string | null;
    }) =>
      v.procedimentoId === procedimento.id &&
      v.convenioId === convenio.convenio.id &&
      (profissional === null || v.profissionalId === profissional.id);
    const soComAEquipe =
      catalogo.vinculos.some(doPedido) ||
      (catalogo.conveniosSoComAEquipe ?? []).some(doPedido);
    if (soComAEquipe) {
      return pronto(
        "convenio_so_com_a_equipe",
        {
          procedimento: procedimento.nome,
          convenio: convenio.nome,
          ...(profissional === null ? {} : { profissional: profissional.nome }),
        },
        `${doPaciente}: o convênio ${convenio.nome} é atendido, mas só a equipe marca por ele`,
        [],
        fatosDoConvenio(convenio.convenio, procedimento.nome),
      );
    }
    // D14: o convenio foi identificado, mas nenhum vinculo deste
    // procedimento (e do profissional pedido) e dele. O modelo avisa e
    // oferece o particular; o valor so quando a clinica deixa informar preco.
    const particulares = doProcedimento.filter((v) => v.convenioId === null);
    const valores = entrada.informarValor
      ? valoresDosVinculos(particulares)
      : { linhas: [], precos: [] };
    return pronto(
      "convenio_nao_atendido",
      {
        procedimento: procedimento.nome,
        convenio: convenio.nome,
        ...(profissional === null ? {} : { profissional: profissional.nome }),
        atende_particular: particulares.length > 0,
        ...(entrada.informarValor && particulares.length > 0
          ? { particular: valores.linhas }
          : {}),
      },
      `${doPaciente}: o convênio ${convenio.nome} não tem vínculo para marcar este procedimento${particulares.length > 0 ? "; o particular tem" : "; o particular também não"}`,
      valores.precos,
      {
        coberturas: [
          coberturaDoConvenio(
            convenio.convenio,
            "nao_atende",
            procedimento.nome,
          ),
        ],
      },
    );
  }
  if (vinculos.length === 0) {
    return pronto(
      "procedimento_nao_agendavel",
      {
        procedimento: procedimento.nome,
        convenio: nomeDoConvenio,
        ...(profissional === null ? {} : { profissional: profissional.nome }),
      },
      `${doPaciente}: o assistente não marca este procedimento no particular`,
    );
  }

  // O periodo: da antecedencia (com a folga) ao horizonte, e a partir do dia
  // pedido, tudo no fuso da clinica.
  const fuso = fusoDaAgenda(entrada.fuso);
  const minimo =
    entrada.agoraMs +
    entrada.agenda.antecedenciaHoras * UMA_HORA_MS +
    FOLGA_DA_ANTECEDENCIA_MS;
  const limite = entrada.agoraMs + entrada.agenda.horizonteDias * UM_DIA_MS;
  const doDia =
    aPartirDe === null
      ? Number.NEGATIVE_INFINITY
      : instanteLocal(fuso, aPartirDe, "00:00").getTime();
  const inicio = Math.max(minimo, doDia);
  const ultimoDia = diaEHora(new Date(limite), fuso, entrada.agoraMs).dia;
  const textoDaModalidade = textoDaBusca(
    procedimento.nome,
    profissional?.nome ?? null,
    nomeDoConvenio,
    unidade?.nome ?? null,
  );
  if (!(inicio <= limite)) {
    return pronto(
      "sem_horario",
      {
        procedimento: procedimento.nome,
        convenio: nomeDoConvenio,
        ...(profissional === null ? {} : { profissional: profissional.nome }),
        ...(unidade === null ? {} : { unidade: unidade.nome }),
        ate: ultimoDia,
      },
      `${textoDaModalidade}: o dia pedido passa do horizonte (até ${ultimoDia})`,
      [],
      fatosDoConvenio(convenioDoCadastro, procedimento.nome),
    );
  }
  const maiorDuracao = Math.max(...vinculos.map((v) => v.duracaoMin));
  const recursos = [
    ...new Set(
      vinculos.flatMap((v) => (v.recursoId === null ? [] : [v.recursoId])),
    ),
  ].sort();
  const grades = new Map<string, number>();
  const idades = new Map<string, { minima: number | null; maxima: number | null }>();
  for (const p of catalogo.profissionais ?? []) {
    if (typeof p.gradeMinutos === "number") {
      grades.set(p.id, p.gradeMinutos);
    }
    const minima = typeof p.idadeMinima === "number" ? p.idadeMinima : null;
    const maxima = typeof p.idadeMaxima === "number" ? p.idadeMaxima : null;
    if (minima !== null || maxima !== null) {
      idades.set(p.id, { minima, maxima });
    }
  }
  return {
    tipo: "plano",
    plano: {
      procedimento,
      convenio: nomeDoConvenio,
      convenioDoCadastro,
      profissional: profissional?.nome ?? null,
      profissionalId: profissional?.id ?? null,
      vinculos,
      inicio: new Date(inicio),
      limite: new Date(limite),
      periodo: pedido.periodo,
      fuso,
      agoraMs: entrada.agoraMs,
      unidade,
      unidades,
      hora,
      diaPedido: aPartirDe,
      grades,
      idades,
      nascimentos: [...(entrada.nascimentos ?? [])].filter(
        (n) => diaValido(n) !== null,
      ),
    },
    pedido: {
      profissionais: [...new Set(vinculos.map((v) => v.profissionalId))].sort(),
      recursos,
      vinculosDosRecursos: catalogo.vinculos.flatMap((v) =>
        v.id !== null && v.recursoId !== null && recursos.includes(v.recursoId)
          ? [{ serviceLinkId: v.id, recursoId: v.recursoId }]
          : [],
      ),
      inicio: new Date(inicio),
      fim: new Date(limite + maiorDuracao * 60_000),
    },
  };
}

function periodoDe(inicio: Date, fuso: string): PeriodoDoDia {
  const minutos = minutosLocais(fuso, inicio);
  return minutos < FAIXA_DO_PERIODO.manha[1]
    ? "manha"
    : minutos < FAIXA_DO_PERIODO.tarde[1]
      ? "tarde"
      : "noite";
}

function noPeriodo(
  inicio: Date,
  periodo: PeriodoDoDia | null,
  fuso: string,
): boolean {
  if (periodo === null) {
    return true;
  }
  const [de, ate] = FAIXA_DO_PERIODO[periodo];
  const minutos = minutosLocais(fuso, inicio);
  return minutos >= de && minutos < ate;
}

/** O profissional atende a idade do paciente no dia (sem limite: atende). */
function atendeAIdade(
  plano: Pick<PlanoDaBusca, "idades" | "nascimentos" | "fuso">,
  profissionalId: string,
  inicio: Date,
): boolean {
  const faixa = plano.idades?.get(profissionalId);
  const nascimentos = plano.nascimentos ?? [];
  if (faixa === undefined || nascimentos.length === 0) {
    return true;
  }
  const dia = diaCivil(plano.fuso, inicio);
  return nascimentos.every((nascimento) => {
    const idade = idadeNoDia(nascimento, dia);
    if (idade === null) {
      return true;
    }
    return (
      (faixa.minima === null || idade >= faixa.minima) &&
      (faixa.maxima === null || idade <= faixa.maxima)
    );
  });
}

/** Um horario livre, ja com o vinculo e a unidade. */
type Livre = {
  vinculo: VinculoAgendavel;
  inicio: Date;
  fim: Date;
  unidade: UnidadeDoAgente | null;
};

/**
 * As faixas de jornada de um profissional por unidade: com a unidade
 * pedida, uma lista so (as faixas dela e as sem unidade, que valem para
 * todas); sem, uma lista por unidade (e uma das sem unidade). A faixa de
 * unidade que nao esta entre as ativas do agente fica de fora.
 */
function faixasPorUnidade(
  jornadas: readonly JanelaDaAgenda[],
  unidadePedida: UnidadeDoAgente | null,
  unidades: readonly UnidadeDoAgente[],
): { unidade: UnidadeDoAgente | null; faixas: JanelaSemanal[] }[] {
  const ativas = new Map(unidades.map((u) => [u.id, u]));
  const daFaixa = (j: JanelaDaAgenda) => j.unidadeId ?? null;
  if (unidadePedida !== null) {
    const faixas = jornadas.filter(
      (j) => daFaixa(j) === null || daFaixa(j) === unidadePedida.id,
    );
    return faixas.length === 0 ? [] : [{ unidade: unidadePedida, faixas }];
  }
  const grupos = new Map<string | null, JanelaSemanal[]>();
  for (const j of jornadas) {
    const chave = daFaixa(j);
    if (chave !== null && !ativas.has(chave)) {
      continue;
    }
    const lista = grupos.get(chave) ?? [];
    lista.push(j);
    grupos.set(chave, lista);
  }
  // A faixa sem unidade, na clinica de uma unidade so, e dessa unidade.
  const unica = unidades.length === 1 ? (unidades[0] ?? null) : null;
  return [...grupos.entries()].map(([chave, faixas]) => ({
    unidade: chave === null ? unica : (ativas.get(chave) ?? null),
    faixas,
  }));
}

/**
 * Todos os horarios livres do plano sobre a Agenda lida: por vinculo e por
 * unidade, na grade do profissional (ou da duracao) contada do inicio da
 * faixa, no periodo pedido, dentro do horizonte e na idade atendida. Em
 * ordem de tempo (empate: profissional, vinculo, unidade).
 */
function horariosLivres(
  plano: PlanoDaBusca,
  agenda: AgendaCarregada,
): Livre[] {
  const livres: Livre[] = [];
  const unidades = plano.unidades ?? [];
  for (const vinculo of plano.vinculos) {
    const p = vinculo.profissionalId;
    const grupos = faixasPorUnidade(
      agenda.jornadas.get(p) ?? [],
      plano.unidade ?? null,
      unidades,
    );
    for (const grupo of grupos) {
      const slots = availableSlots({
        timezone: plano.fuso,
        rangeStart: plano.inicio,
        rangeEnd: new Date(plano.limite.getTime() + vinculo.duracaoMin * 60_000),
        durationMin: vinculo.duracaoMin,
        schedule: grupo.faixas,
        blocks: [...(agenda.bloqueios.get(p) ?? [])],
        appointments: [...(agenda.consultas.get(p) ?? [])],
        holds: [...(agenda.reservas.get(p) ?? [])],
        resourceBusy:
          vinculo.recursoId === null
            ? undefined
            : [...(agenda.recursos.get(vinculo.recursoId) ?? [])],
        gridMin: plano.grades?.get(p) ?? vinculo.duracaoMin,
        ancorarNaJornada: true,
        now: plano.inicio,
      });
      for (const slot of slots) {
        if (
          slot.startsAt.getTime() <= plano.limite.getTime() &&
          noPeriodo(slot.startsAt, plano.periodo, plano.fuso) &&
          atendeAIdade(plano, p, slot.startsAt)
        ) {
          livres.push({
            vinculo,
            inicio: slot.startsAt,
            fim: slot.endsAt,
            unidade: grupo.unidade,
          });
        }
      }
    }
  }
  // O mesmo vinculo no mesmo inicio por duas faixas (com e sem unidade):
  // uma vez so, a com unidade.
  const vistos = new Map<string, Livre>();
  for (const livre of livres) {
    const chave = `${livre.vinculo.id}|${livre.inicio.getTime()}`;
    const antes = vistos.get(chave);
    if (antes === undefined || (antes.unidade === null && livre.unidade !== null)) {
      vistos.set(chave, livre);
    }
  }
  return [...vistos.values()].sort(
    (a, b) =>
      a.inicio.getTime() - b.inicio.getTime() ||
      a.vinculo.profissional.localeCompare(b.vinculo.profissional, "pt-BR") ||
      a.vinculo.id.localeCompare(b.vinculo.id) ||
      (a.unidade?.codigo ?? "").localeCompare(b.unidade?.codigo ?? ""),
  );
}

/**
 * A oferta espalhada: o primeiro horario de cada (dia, periodo), em ordem
 * de tempo, ate `quantos`; sobrando vaga, outros horarios a pelo menos 1
 * hora dos ja escolhidos no mesmo dia.
 */
function espalhar(livres: readonly Livre[], fuso: string, quantos: number): Livre[] {
  const escolhidos: Livre[] = [];
  const grupos = new Set<string>();
  for (const livre of livres) {
    const chave = `${diaCivil(fuso, livre.inicio)}|${periodoDe(livre.inicio, fuso)}`;
    if (!grupos.has(chave)) {
      grupos.add(chave);
      escolhidos.push(livre);
      if (escolhidos.length >= quantos) {
        break;
      }
    }
  }
  if (escolhidos.length < quantos) {
    for (const livre of livres) {
      if (escolhidos.length >= quantos) {
        break;
      }
      const dia = diaCivil(fuso, livre.inicio);
      const perto = escolhidos.some(
        (e) =>
          e === livre ||
          (diaCivil(fuso, e.inicio) === dia &&
            Math.abs(e.inicio.getTime() - livre.inicio.getTime()) <
              DISTANCIA_NO_MESMO_DIA_MS),
      );
      if (!perto) {
        escolhidos.push(livre);
      }
    }
  }
  return escolhidos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/**
 * Com a hora pedida: os livres exatamente nela (no dia pedido ou, sem dia,
 * no primeiro dia em que ela estiver livre), ou os mais proximos dela (no
 * dia pedido; sem nenhum ali, o mais proximo de cada dia seguinte).
 */
function pelaHora(
  livres: readonly Livre[],
  plano: PlanoDaBusca,
  hora: string,
): { livre: boolean; escolhidos: Livre[]; dia: string | null } {
  const alvo = horaParaMinutos(hora);
  const fuso = plano.fuso;
  const diaDe = (l: Livre) => diaCivil(fuso, l.inicio);
  const naHora = (l: Livre) => minutosLocais(fuso, l.inicio) === alvo;
  const diaPedido = plano.diaPedido ?? null;
  const exatos = livres.filter(
    (l) => naHora(l) && (diaPedido === null || diaDe(l) === diaPedido),
  );
  if (exatos.length > 0) {
    const primeiroDia = diaDe(exatos[0] as Livre);
    return {
      livre: true,
      escolhidos: exatos
        .filter((l) => diaDe(l) === primeiroDia)
        .slice(0, HORARIOS_DA_HORA_PEDIDA),
      dia: primeiroDia,
    };
  }
  const distancia = (l: Livre) => Math.abs(minutosLocais(fuso, l.inicio) - alvo);
  const doDia =
    diaPedido === null ? [] : livres.filter((l) => diaDe(l) === diaPedido);
  if (doDia.length > 0) {
    return {
      livre: false,
      escolhidos: [...doDia]
        .sort(
          (a, b) =>
            distancia(a) - distancia(b) || a.inicio.getTime() - b.inicio.getTime(),
        )
        .slice(0, HORARIOS_DA_HORA_PEDIDA)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime()),
      dia: diaPedido,
    };
  }
  // O mais proximo da hora em cada dia, dos primeiros dias.
  const porDia = new Map<string, Livre>();
  for (const livre of livres) {
    const dia = diaDe(livre);
    const antes = porDia.get(dia);
    if (antes === undefined || distancia(livre) < distancia(antes)) {
      porDia.set(dia, livre);
    }
  }
  return {
    livre: false,
    escolhidos: [...porDia.values()]
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
      .slice(0, HORARIOS_DA_HORA_PEDIDA),
    dia: diaPedido,
  };
}

/** O gerador dos codigos: a partir de um numero, ou o do estado. */
export type GeradorDeCodigo = number | (() => string);

/**
 * O segundo passo: os horarios livres de cada vinculo do plano sobre a
 * Agenda lida, escolhidos (espalhados, ou pela hora pedida), com os codigos
 * do gerador (h1 na primeira busca, ou o proximo livre do estado). Nunca
 * lanca.
 */
export function escolherHorarios(
  plano: PlanoDaBusca,
  agenda: AgendaCarregada,
  codigos: GeradorDeCodigo,
): ResultadoDaBuscaDeHorario {
  const unidadePedida = plano.unidade ?? null;
  const base = {
    procedimento: plano.procedimento.nome,
    convenio: plano.convenio,
    ...(plano.profissional === null
      ? {}
      : { profissional: plano.profissional }),
    ...(unidadePedida === null ? {} : { unidade: unidadePedida.nome }),
  };
  const texto = textoDaBusca(
    plano.procedimento.nome,
    plano.profissional,
    plano.convenio,
    unidadePedida?.nome ?? null,
  );
  const fatos = fatosDoConvenio(
    plano.convenioDoCadastro,
    plano.procedimento.nome,
  );
  const comFatos = <T extends object>(objeto: T) =>
    fatos === undefined ? objeto : { ...objeto, fatos };

  // AG2: nenhum profissional do pedido com jornada cadastrada. Nao e "sem
  // horario": a agenda dele nao existe, e o modelo passa para a equipe.
  if (
    plano.vinculos.every(
      (v) => (agenda.jornadas.get(v.profissionalId) ?? []).length === 0,
    )
  ) {
    return comFatos({
      saida: JSON.stringify({ resultado: "agenda_nao_cadastrada", ...base }),
      precos: [],
      passo: `${texto}: a agenda ${plano.profissional === null ? "de quem faz este procedimento" : "deste profissional"} não está cadastrada`,
      resultado: "agenda_nao_cadastrada" as const,
      horarios: [],
    });
  }

  // AG3: com a unidade pedida, nenhum profissional do pedido atende nela.
  if (
    unidadePedida !== null &&
    plano.vinculos.every((v) =>
      (agenda.jornadas.get(v.profissionalId) ?? []).every(
        (j) => (j.unidadeId ?? null) !== null && j.unidadeId !== unidadePedida.id,
      ),
    )
  ) {
    return comFatos({
      saida: JSON.stringify({ resultado: "nao_atende_na_unidade", ...base }),
      precos: [],
      passo: `${texto}: ${plano.profissional === null ? "ninguém que faz este procedimento atende" : "este profissional não atende"} nesta unidade`,
      resultado: "nao_atende_na_unidade" as const,
      horarios: [],
    });
  }

  // AG3: com o nascimento conhecido, nenhum profissional do pedido atende a
  // idade do paciente (hoje e no fim do horizonte).
  const idadeAtendida = (v: VinculoAgendavel) =>
    atendeAIdade(plano, v.profissionalId, plano.inicio) ||
    atendeAIdade(plano, v.profissionalId, plano.limite);
  if (!plano.vinculos.some(idadeAtendida)) {
    return comFatos({
      saida: JSON.stringify({ resultado: "idade_nao_atendida", ...base }),
      precos: [],
      passo: `${texto}: ${plano.profissional === null ? "nenhum profissional deste procedimento atende" : "este profissional não atende"} a idade do paciente`,
      resultado: "idade_nao_atendida" as const,
      horarios: [],
    });
  }

  const livres = horariosLivres(plano, agenda);
  if (livres.length === 0) {
    const ate = diaEHora(plano.limite, plano.fuso, plano.agoraMs).dia;
    return comFatos({
      saida: JSON.stringify({ resultado: "sem_horario", ...base, ate }),
      precos: [],
      passo: `${texto}: nenhum horário livre${plano.periodo === null ? "" : " no período pedido"} até ${ate}`,
      resultado: "sem_horario" as const,
      horarios: [],
    });
  }

  const hora = plano.hora ?? null;
  let escolhidos: Livre[];
  let resultado: "horarios" | "hora_pedida_livre" | "hora_pedida_ocupada" =
    "horarios";
  let diaPedido: string | null = null;
  if (hora === null) {
    escolhidos = espalhar(livres, plano.fuso, HORARIOS_POR_BUSCA);
  } else {
    const lida = pelaHora(livres, plano, hora);
    escolhidos = lida.escolhidos;
    resultado = lida.livre ? "hora_pedida_livre" : "hora_pedida_ocupada";
    diaPedido = lida.dia;
  }

  let numero = typeof codigos === "number" ? codigos : 0;
  const proximoCodigo = () => {
    if (typeof codigos === "function") {
      return codigos();
    }
    const codigo = `h${numero}`;
    numero += 1;
    return codigo;
  };
  const oferecidoEm = new Date(plano.agoraMs).toISOString();
  const horarios: HorarioOferecido[] = escolhidos.map((livre) => {
    const { dia, hora: aHora } = diaEHora(livre.inicio, plano.fuso, plano.agoraMs);
    return {
      codigo: proximoCodigo(),
      serviceLinkId: livre.vinculo.id,
      profissionalId: livre.vinculo.profissionalId,
      inicio: livre.inicio.toISOString(),
      fim: livre.fim.toISOString(),
      dia,
      hora: aHora,
      profissional: livre.vinculo.profissional,
      procedimento: plano.procedimento.nome,
      duracaoMin: livre.vinculo.duracaoMin,
      unidadeId: livre.unidade?.id ?? null,
      unidade: livre.unidade?.nome ?? null,
      unidadeCodigo: livre.unidade?.codigo ?? null,
      convenioId: livre.vinculo.convenioId,
      oferecidoEm,
    };
  });
  const pedidoNoDia =
    hora === null
      ? {}
      : {
          hora_pedida: hora,
          ...(diaPedido === null
            ? {}
            : {
                dia_pedido: diaEHora(
                  instanteLocal(plano.fuso, diaPedido, "12:00"),
                  plano.fuso,
                  plano.agoraMs,
                ).dia,
              }),
        };
  const lista = horarios
    .map(
      (h) =>
        `${h.dia} às ${h.hora} (${h.profissional}${h.unidade === null ? "" : `, ${h.unidade}`})`,
    )
    .join(", ");
  const passo =
    resultado === "horarios"
      ? `${texto}: encontrou ${lista}`
      : resultado === "hora_pedida_livre"
        ? `${texto}: a hora pedida (${hora}) está livre: ${lista}`
        : `${texto}: a hora pedida (${hora}) não está livre${diaPedido === null ? "" : " nesse dia"}; os mais próximos: ${lista}`;
  const livresDoTurno: HorarioLivreDoTurno[] = horarios.map((h) => ({
    dia: h.dia,
    hora: h.hora,
    unidade: h.unidade,
  }));
  const horariosDaSaida = horarios.map((h) => ({
    codigo: h.codigo,
    dia: h.dia,
    hora: h.hora,
    profissional: h.profissional,
    procedimento: h.procedimento,
    duracao_min: h.duracaoMin,
    unidade: h.unidade,
    ...(h.unidadeCodigo === null ? {} : { unidade_codigo: h.unidadeCodigo }),
  }));
  // Revisao final da AG3 (item 5): a hora e o dia que a pessoa pediu vao ao
  // modelo, mas nos fatos sao eco do pedido (so valem na frase que nega ou
  // pergunta): "sua consulta sera quarta as 15h" com a hora pedida ocupada
  // nao passa por ter vindo da busca.
  const eco =
    hora === null
      ? null
      : "dia_pedido" in pedidoNoDia
        ? `${String(pedidoNoDia.dia_pedido)} às ${hora}`
        : hora;
  return {
    saida: JSON.stringify({
      resultado,
      ...base,
      ...pedidoNoDia,
      horarios: horariosDaSaida,
    }),
    precos: [],
    passo,
    resultado,
    horarios,
    // Revisao da AG2: os horarios livres sao a unica prova de "tenho as
    // 14h" (o dia e a hora como foram ao modelo; AG3, com a unidade).
    fatos: {
      ...fatos,
      horarios: livresDoTurno,
      ...(eco === null
        ? {}
        : {
            ecos: [eco],
            saidaSemEco: JSON.stringify({
              resultado,
              ...base,
              horarios: horariosDaSaida,
            }),
          }),
    },
  };
}

// ---------------------------------------------------------------------------
// A reconferencia leve (AG3): o horario oferecido antes continua livre?
// ---------------------------------------------------------------------------

/** Um horario do estado para reconferir. */
export type HorarioParaReconferir = {
  codigo: string;
  serviceLinkId: string;
  unidadeId: string | null;
  inicio: string;
  fim: string;
};

/**
 * O pedido da Agenda que cobre os horarios a reconferir (os profissionais,
 * os recursos e o intervalo), ou null quando nenhum vinculo deles esta mais
 * no catalogo.
 */
export function pedidoDaReconferencia(
  catalogo: CatalogoDoAgente,
  horarios: readonly HorarioParaReconferir[],
): PedidoDaAgenda | null {
  const vinculos = horarios
    .map((h) => catalogo.vinculos.find((v) => v.id === h.serviceLinkId))
    .filter((v): v is VinculoDoAgente => v !== undefined && agendavel(v));
  if (vinculos.length === 0) {
    return null;
  }
  const inicios = horarios.map((h) => Date.parse(h.inicio));
  const fins = horarios.map((h) => Date.parse(h.fim));
  if (![...inicios, ...fins].every(Number.isFinite)) {
    return null;
  }
  const recursos = [
    ...new Set(vinculos.flatMap((v) => (v.recursoId === null ? [] : [v.recursoId]))),
  ].sort();
  return {
    profissionais: [...new Set(vinculos.map((v) => v.profissionalId))].sort(),
    recursos,
    vinculosDosRecursos: catalogo.vinculos.flatMap((v) =>
      v.id !== null && v.recursoId !== null && recursos.includes(v.recursoId)
        ? [{ serviceLinkId: v.id, recursoId: v.recursoId }]
        : [],
    ),
    inicio: new Date(Math.min(...inicios)),
    fim: new Date(Math.max(...fins)),
  };
}

/**
 * O horario continua livre sobre a Agenda lida agora: o vinculo ainda e do
 * agente, o inicio esta entre a antecedencia (com a folga) e o horizonte, a
 * jornada da unidade dele o cobre inteiro e nada o ocupa (bloqueio,
 * consulta, reserva de outra conversa, recurso). A grade nao conta (a RPC
 * nao confere grade). Nunca lanca.
 */
export function horarioContinuaLivre(entrada: {
  catalogo: CatalogoDoAgente;
  agenda: AgendaCarregada;
  config: AgendaDoAgente;
  horario: HorarioParaReconferir;
  agoraMs: number;
  fuso: string;
}): boolean {
  const { catalogo, agenda, horario } = entrada;
  if (!agendaCompleta(entrada.config)) {
    return false;
  }
  const vinculo = catalogo.vinculos.find((v) => v.id === horario.serviceLinkId);
  if (vinculo === undefined || !agendavel(vinculo)) {
    return false;
  }
  const inicio = Date.parse(horario.inicio);
  const fim = Date.parse(horario.fim);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) {
    return false;
  }
  const minimo =
    entrada.agoraMs +
    entrada.config.antecedenciaHoras * UMA_HORA_MS +
    FOLGA_DA_ANTECEDENCIA_MS;
  const limite = entrada.agoraMs + entrada.config.horizonteDias * UM_DIA_MS;
  if (inicio < minimo || inicio > limite) {
    return false;
  }
  const unidades = catalogo.unidades ?? [];
  const unidade =
    horario.unidadeId === null
      ? null
      : (unidades.find((u) => u.id === horario.unidadeId) ?? null);
  if (horario.unidadeId !== null && unidade === null) {
    return false;
  }
  const p = vinculo.profissionalId;
  const faixas = (agenda.jornadas.get(p) ?? []).filter(
    (j) =>
      unidade === null ||
      (j.unidadeId ?? null) === null ||
      j.unidadeId === unidade.id,
  );
  const fuso = fusoDaAgenda(entrada.fuso);
  const slots = availableSlots({
    timezone: fuso,
    rangeStart: new Date(inicio),
    rangeEnd: new Date(fim),
    durationMin: Math.round((fim - inicio) / 60_000),
    schedule: faixas,
    blocks: [...(agenda.bloqueios.get(p) ?? [])],
    appointments: [...(agenda.consultas.get(p) ?? [])],
    holds: [...(agenda.reservas.get(p) ?? [])],
    resourceBusy:
      vinculo.recursoId === null
        ? undefined
        : [...(agenda.recursos.get(vinculo.recursoId) ?? [])],
    gridMin: 1,
    now: new Date(inicio),
  });
  return slots.some((s) => s.startsAt.getTime() === inicio);
}

/**
 * Teto, em bytes, de UMA saida de buscar_horario neste catalogo (reserva do
 * gasto, lib/agente/gasto.ts): os horarios com os maiores nomes (do
 * procedimento, do profissional e da unidade), ou as opcoes de convenio (o
 * mesmo teto de buscar_procedimento cobre), ou o particular do convenio nao
 * atendido.
 */
export function limiteDaSaidaDaBuscaDeHorario(
  catalogo: CatalogoDoAgente,
): number {
  const noJson = (texto: string) =>
    Buffer.byteLength(JSON.stringify(texto), "utf8");
  const maiorProcedimento = catalogo.procedimentos.reduce(
    (maior, p) => Math.max(maior, noJson(p.nome)),
    0,
  );
  const maiorProfissional = catalogo.vinculos.reduce(
    (maior, v) => Math.max(maior, noJson(v.profissional)),
    0,
  );
  const maiorUnidade = (catalogo.unidades ?? []).reduce(
    (maior, u) => Math.max(maior, noJson(u.nome)),
    0,
  );
  const vinculos = catalogo.vinculos.reduce(
    (soma, v) => soma + noJson(v.profissional) + 96,
    0,
  );
  return (
    640 +
    maiorProcedimento +
    maiorProfissional +
    maiorUnidade +
    Math.max(HORARIOS_POR_BUSCA, HORARIOS_DA_HORA_PEDIDA) *
      (200 + maiorProcedimento + maiorProfissional + maiorUnidade) +
    vinculos
  );
}
