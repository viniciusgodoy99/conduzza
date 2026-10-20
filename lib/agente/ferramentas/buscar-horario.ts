// Ferramenta buscar_horario do agente de IA (E4, contrato da E4 secao 2):
// ate 3 horarios livres de um procedimento, lidos da Agenda de verdade.
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
//  - Os 3 PRIMEIROS horarios livres em ordem de tempo (empate: profissional
//    e vinculo), com codigo h1, h2...: escolher assim faz a mesma busca, com
//    a_partir_de no dia de um horario oferecido e o periodo dele, devolver
//    esse horario de novo entre os 3 (o modelo reserva pelo codigo da busca
//    da propria resposta). Os codigos valem so no turno e mapeiam para
//    (service_link_id, starts_at) no servidor; nada disso vai ao modelo.
//  - Nunca inventa: sem horario, "sem_horario".

import { TZDate } from "@date-fns/tz";
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  agendaCompleta,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";
import { instanteLocal, minutosLocais } from "@/lib/domain/horarios";
import {
  availableSlots,
  type IntervaloOcupado,
  type JanelaSemanal,
} from "@/lib/domain/scheduling";

import {
  convenioParaAgenda,
  indiceDosProfissionais,
  valoresDosVinculos,
  type CatalogoDoAgente,
  type ProcedimentoDoIndice,
  type VinculoDoAgente,
} from "./buscar-procedimento";
import { MINUTOS_DA_RESERVA } from "./reservar-horario";

// ---------------------------------------------------------------------------
// Parametros
// ---------------------------------------------------------------------------

export const NOME_DA_BUSCA_DE_HORARIO = "buscar_horario";

/** No maximo isto de horarios por resposta da ferramenta (contrato). */
export const HORARIOS_POR_BUSCA = 3;

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

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDaBuscaDeHorarioSchema = z
  .object({
    procedimento: z.string().trim().min(1).max(64),
    profissional: z.string().trim().max(64).nullable(),
    convenio: z.string().trim().max(256).nullable(),
    a_partir_de: z.string().trim().max(10).nullable(),
    periodo: z.enum(PERIODOS_DO_DIA).nullable(),
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
    "Consulta na Agenda da clínica até 3 horários livres de um procedimento, com um código para cada horário (h1, h2...). Os códigos valem só dentro desta resposta.",
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
    },
    required: [
      "procedimento",
      "profissional",
      "convenio",
      "a_partir_de",
      "periodo",
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
 * A Agenda lida para o pedido, SO horarios (nunca nome, telefone nem
 * observacao de paciente): jornada semanal por profissional, bloqueios,
 * consultas nao canceladas (encaixe conta), reservas vivas de OUTRAS
 * conversas e a ocupacao de cada recurso por qualquer profissional.
 */
export type AgendaCarregada = {
  jornadas: ReadonlyMap<string, readonly JanelaSemanal[]>;
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
    | "sem_horario"
    | "agenda_nao_configurada"
    | "procedimento_nao_agendavel"
    | "profissional_nao_encontrado"
    | "convenio_nao_atendido"
    | "convenio_so_com_a_equipe"
    | "convenio_nao_informado"
    | "convenio_nao_encontrado"
    | "convenio_nao_confirmado"
    | "plano_nao_informado"
    | "entrada_invalida";
  /** Os horarios com codigo (vazio fora de "horarios"). */
  horarios: HorarioOferecido[];
};

/** O que a escolha precisa depois que a Agenda foi lida. */
export type PlanoDaBusca = {
  procedimento: ProcedimentoDoIndice;
  /** "particular" ou o nome do convenio identificado, como vai ao modelo. */
  convenio: string;
  /** O nome do profissional pedido, ou null (qualquer um). */
  profissional: string | null;
  vinculos: VinculoAgendavel[];
  inicio: Date;
  /** O ultimo inicio possivel (agora mais o horizonte). */
  limite: Date;
  periodo: PeriodoDoDia | null;
  fuso: string;
  agoraMs: number;
};

export type PlanoOuResultado =
  | { tipo: "resultado"; resultado: ResultadoDaBuscaDeHorario }
  | { tipo: "plano"; plano: PlanoDaBusca; pedido: PedidoDaAgenda };

function pronto(
  resultado: ResultadoDaBuscaDeHorario["resultado"],
  saida: Record<string, unknown>,
  passo: string,
  precos: number[] = [],
): PlanoOuResultado {
  return {
    tipo: "resultado",
    resultado: {
      saida: JSON.stringify({ resultado, ...saida }),
      precos,
      passo,
      resultado,
      horarios: [],
    },
  };
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
): string {
  const com = profissional === null ? "" : ` com ${profissional}`;
  return `Consultou a agenda de ${procedimento}${com}, ${rotuloDaModalidade(convenio)}`;
}

/**
 * O primeiro passo de buscar_horario: valida a entrada, identifica o
 * procedimento, o profissional e o convenio, e devolve o que carregar da
 * Agenda (ou o resultado, quando nem precisa ler a Agenda). Nunca lanca.
 */
export function planejarBuscaDeHorario(entrada: {
  catalogo: CatalogoDoAgente;
  agenda: AgendaDoAgente;
  argumentos: unknown;
  agoraMs: number;
  fuso: string;
  /** A clinica deixa informar preco (habilidade informar_preco_e_convenio). */
  informarValor: boolean;
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
  );
  if (!(inicio <= limite)) {
    return pronto(
      "sem_horario",
      {
        procedimento: procedimento.nome,
        convenio: nomeDoConvenio,
        ...(profissional === null ? {} : { profissional: profissional.nome }),
        ate: ultimoDia,
      },
      `${textoDaModalidade}: o dia pedido passa do horizonte (até ${ultimoDia})`,
    );
  }
  const maiorDuracao = Math.max(...vinculos.map((v) => v.duracaoMin));
  const recursos = [
    ...new Set(
      vinculos.flatMap((v) => (v.recursoId === null ? [] : [v.recursoId])),
    ),
  ].sort();
  return {
    tipo: "plano",
    plano: {
      procedimento,
      convenio: nomeDoConvenio,
      profissional: profissional?.nome ?? null,
      vinculos,
      inicio: new Date(inicio),
      limite: new Date(limite),
      periodo: pedido.periodo,
      fuso,
      agoraMs: entrada.agoraMs,
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

/**
 * O segundo passo: os horarios livres de cada vinculo do plano sobre a
 * Agenda lida (availableSlots, grade de 15 minutos da Agenda), os 3
 * primeiros em ordem de tempo, com os codigos a partir de `primeiroNumero`
 * (h1 na primeira busca do turno, h4 na segunda...). Nunca lanca.
 */
export function escolherHorarios(
  plano: PlanoDaBusca,
  agenda: AgendaCarregada,
  primeiroNumero: number,
): ResultadoDaBuscaDeHorario {
  type Livre = { vinculo: VinculoAgendavel; inicio: Date; fim: Date };
  const livres: Livre[] = [];
  for (const vinculo of plano.vinculos) {
    const p = vinculo.profissionalId;
    const slots = availableSlots({
      timezone: plano.fuso,
      rangeStart: plano.inicio,
      rangeEnd: new Date(plano.limite.getTime() + vinculo.duracaoMin * 60_000),
      durationMin: vinculo.duracaoMin,
      schedule: [...(agenda.jornadas.get(p) ?? [])],
      blocks: [...(agenda.bloqueios.get(p) ?? [])],
      appointments: [...(agenda.consultas.get(p) ?? [])],
      holds: [...(agenda.reservas.get(p) ?? [])],
      resourceBusy:
        vinculo.recursoId === null
          ? undefined
          : [...(agenda.recursos.get(vinculo.recursoId) ?? [])],
      now: plano.inicio,
    });
    for (const slot of slots) {
      if (
        slot.startsAt.getTime() <= plano.limite.getTime() &&
        noPeriodo(slot.startsAt, plano.periodo, plano.fuso)
      ) {
        livres.push({ vinculo, inicio: slot.startsAt, fim: slot.endsAt });
      }
    }
  }
  livres.sort(
    (a, b) =>
      a.inicio.getTime() - b.inicio.getTime() ||
      a.vinculo.profissional.localeCompare(b.vinculo.profissional, "pt-BR") ||
      a.vinculo.id.localeCompare(b.vinculo.id),
  );

  const base = {
    procedimento: plano.procedimento.nome,
    convenio: plano.convenio,
    ...(plano.profissional === null
      ? {}
      : { profissional: plano.profissional }),
  };
  const texto = textoDaBusca(
    plano.procedimento.nome,
    plano.profissional,
    plano.convenio,
  );
  if (livres.length === 0) {
    const ate = diaEHora(plano.limite, plano.fuso, plano.agoraMs).dia;
    return {
      saida: JSON.stringify({ resultado: "sem_horario", ...base, ate }),
      precos: [],
      passo: `${texto}: nenhum horário livre${plano.periodo === null ? "" : " no período pedido"} até ${ate}`,
      resultado: "sem_horario",
      horarios: [],
    };
  }

  const horarios: HorarioOferecido[] = livres
    .slice(0, HORARIOS_POR_BUSCA)
    .map((livre, indice) => {
      const { dia, hora } = diaEHora(livre.inicio, plano.fuso, plano.agoraMs);
      return {
        codigo: `h${primeiroNumero + indice}`,
        serviceLinkId: livre.vinculo.id,
        profissionalId: livre.vinculo.profissionalId,
        inicio: livre.inicio.toISOString(),
        fim: livre.fim.toISOString(),
        dia,
        hora,
        profissional: livre.vinculo.profissional,
        procedimento: plano.procedimento.nome,
        duracaoMin: livre.vinculo.duracaoMin,
      };
    });
  return {
    saida: JSON.stringify({
      resultado: "horarios",
      ...base,
      horarios: horarios.map((h) => ({
        codigo: h.codigo,
        dia: h.dia,
        hora: h.hora,
        profissional: h.profissional,
        procedimento: h.procedimento,
        duracao_min: h.duracaoMin,
      })),
    }),
    precos: [],
    passo: `${texto}: encontrou ${horarios
      .map((h) => `${h.dia} às ${h.hora} (${h.profissional})`)
      .join(", ")}`,
    resultado: "horarios",
    horarios,
  };
}

/**
 * Teto, em bytes, de UMA saida de buscar_horario neste catalogo (reserva do
 * gasto, lib/agente/gasto.ts): os 3 horarios com os maiores nomes, ou as
 * opcoes de convenio (o mesmo teto de buscar_procedimento cobre), ou o
 * particular do convenio nao atendido.
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
  const vinculos = catalogo.vinculos.reduce(
    (soma, v) => soma + noJson(v.profissional) + 96,
    0,
  );
  return (
    512 +
    maiorProcedimento +
    maiorProfissional +
    HORARIOS_POR_BUSCA * (160 + maiorProcedimento + maiorProfissional) +
    vinculos
  );
}
