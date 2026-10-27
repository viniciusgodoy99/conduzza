// Fatos do turno: o que a camada deterministica do filtro de saida aceita
// como verdade numa resposta da IA (etapa AG2, 27/10/2026). PURO, zero I/O.
//
// A regra de ouro: fato critico so vale se uma ferramenta do turno disse. O
// preco ja era assim desde o E2 (precosDoTurno, filtro-deterministico.ts);
// aqui entram as quatro categorias novas, no mesmo molde (entrada opcional:
// quando quem chama passa os fatos, a regra vale; os textos estaticos
// conferidos na publicacao da Tela 6 nao passam fatos e nao mudam):
//  - horario_nao_verificado: toda data e toda hora do rascunho tem de estar
//    nas saidas das ferramentas do turno ou nos textos publicados que o
//    modelo recebe (base, instrucoes, nome da clinica, a hora na clinica) ou
//    que vao colados na resposta (saudacao, encerramento). A mensagem nova
//    do paciente tambem e fonte, mas SO numa frase que nega ou pergunta
//    ("15:00 nao tenho", "prefere as 15:00?"): repetir a hora do paciente
//    afirmando nao vale. Os formatos sao normalizados antes de comparar
//    ("14h", "14:00" e "as 2 da tarde" sao a mesma hora; "21/10",
//    "21/10/2026" e "21 de outubro", a mesma data). Revisao da AG2: a frase
//    que AFIRMA horario livre (tenho, temos, vaga, livre, pode ser, consigo,
//    da, disponivel) so passa com o horario livre que uma ferramenta de
//    agenda trouxe no turno (horariosLivres), conferido EM PAR (o dia com a
//    hora dele, nunca separados), e tambem a data sem hora ("tenho vaga dia
//    30", "amanha de manha tenho vaga"); o texto publicado e a mensagem do
//    paciente nunca provam horario livre.
//  - endereco_nao_verificado: logradouro com numero ("Av. Santos Dumont,
//    1500") so se veio de ferramenta do turno (consultar_unidades) ou dos
//    textos publicados. Nunca da mensagem do paciente. O endereco que veio
//    da ferramenta e nome de lugar: as vedacoes clinicas nao leem o trecho
//    do rascunho que bate com ele ("Rua das Dores, 100";
//    trechosDeEnderecoDasFerramentas e filtro-deterministico.ts).
//  - cobertura_nao_verificada: dizer que o convenio cobre, que e aceito ou
//    que a clinica atende por ele so com um resultado de cobertura do turno
//    (buscar_procedimento, buscar_horario, buscar_profissionais), do mesmo
//    convenio (e do plano, quando citado) e do mesmo procedimento, quando a
//    frase cita um; negar tambem so com fato ("sem informacao" nunca vira
//    "nao cobre"), a nao ser que o Cadastro nao tenha nenhum convenio ativo
//    (semConvenioAtivo). Revisao da AG2: depois de "aceita", "atende pelo",
//    "trabalha com" e "cobre", tudo o que nao for meio de pagamento
//    ("cartao", "pix", "dinheiro", "boleto") nem "particular" exige fato
//    (a operadora fora da lista e fora do Cadastro nunca tem fato). A base
//    publicada NAO vale aqui: so ferramenta.
//  - acao_nao_executada: dizer que marcou, reservou, confirmou, cancelou,
//    remarcou ou colocou na lista de espera so com o sucesso da ferramenta
//    correspondente neste turno, inclusive nas formas curtas ("Agendado!",
//    "Consulta cancelada", "Ta marcado", "Ja deixei agendado"). O estado de
//    uma consulta que ja existia ("sua consulta esta marcada para...") vale
//    com a consulta lida por ferramenta (confirmar_presenca) ou marcada
//    neste turno.
//
// So BLOQUEIA, como toda regra deterministica: o rascunho que passa aqui
// ainda vai ao verificador por modelo (filtro.ts). As regras leem o rascunho
// SEM os textos fixos colados em volta dele (saudacao, aviso e encerramento:
// nao sao afirmacao do modelo e ja foram conferidos na publicacao), em
// visoes proprias: a base com a mascara do catalogo para data, hora e acao
// (sem as expressoes permitidas de padroes.ts, que trocam "garantida" por
// "reservada") e a base sem mascara para endereco e convenio (o nome do
// convenio precisa ser visto). A unica negacao lida e a da propria
// afirmacao de fato ("ainda nao marquei" nao afirma acao).

import type { CategoriaDosFatos } from "@/lib/domain/conformidade/categorias";
import {
  mascararNomes,
  normalizarBase,
} from "@/lib/domain/conformidade/normalizar";
import {
  CONVENIO_NO_OBJETO,
  FUNCAO_NO_OBJETO,
  LUGAR_OU_PRECO_COBERTO,
  MEIOS_DE_PAGAMENTO,
  NAO_E_CONVENIO,
  OBJETO_GENERICO_DE_COBRE,
  PARTICULAR,
  SUJEITO_QUE_NAO_E_CONVENIO,
} from "@/lib/domain/conformidade/palavras-do-convenio";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * O que uma ferramenta do turno disse de um convenio:
 *  - coberto: buscar_procedimento disse "coberto" para o convenio e plano;
 *  - atende: o convenio tem vinculo no procedimento (aceito), com ou sem
 *    valor (buscar_procedimento, buscar_horario), ou o profissional atende
 *    por ele (buscar_profissionais);
 *  - nao_atende: buscar_horario disse convenio_nao_atendido (nenhum vinculo
 *    do convenio no procedimento, nem so com a equipe).
 * "Sem informacao" nao vira estado nenhum.
 */
export const ESTADOS_DA_COBERTURA = [
  "coberto",
  "atende",
  "nao_atende",
] as const;
export type EstadoDaCobertura = (typeof ESTADOS_DA_COBERTURA)[number];

/** As acoes que uma ferramenta do turno pode ter executado com sucesso. */
export const ACOES_DO_TURNO = [
  "reservou",
  "marcou",
  "confirmou_presenca",
  "cancelou",
  "remarcou",
  "lista_de_espera",
] as const;
export type AcaoDoTurno = (typeof ACOES_DO_TURNO)[number];

/** Um convenio do Cadastro (o nome da operadora e o plano). */
export type ConvenioDosFatos = { nome: string; plano: string | null };

export type CoberturaDoTurno = ConvenioDosFatos & {
  estado: EstadoDaCobertura;
  /**
   * O procedimento do fato, com o nome do Cadastro que a ferramenta trouxe
   * (revisao da AG2: "a Unimed cobre o ultrassom" so com o fato da Unimed
   * para o ultrassom). Nulo: a ferramenta afirmou o convenio sem
   * procedimento (buscar_profissionais sem o filtro de procedimento), e o
   * fato nao sustenta frase que cita procedimento.
   */
  procedimento: string | null;
};

/**
 * Um horario livre que uma ferramenta de agenda trouxe no turno, com o dia
 * e a hora exatamente como ela devolveu ao modelo ("terca, 21/10" e
 * "14:00").
 */
export type HorarioLivreDoTurno = { dia: string; hora: string };

/** Um dia do calendario (hoje no fuso da clinica). */
export type DiaDaClinica = { dia: number; mes: number; ano: number };

/** O que uma ferramenta acrescenta aos fatos, alem da propria saida. */
export type FatosDaFerramenta = {
  coberturas?: readonly CoberturaDoTurno[];
  acao?: AcaoDoTurno;
  /** A ferramenta leu uma consulta que ja existia (confirmar_presenca). */
  consultaLida?: boolean;
  /**
   * Os horarios livres que a ferramenta trouxe (buscar_horario) ou reservou
   * (reservar_horario): a unica prova de "tenho as 14h".
   */
  horarios?: readonly HorarioLivreDoTurno[];
};

export type FatosDoTurno = {
  /** As saidas (o JSON que o modelo leu) das ferramentas do turno. */
  saidasDasFerramentas: readonly string[];
  /**
   * Os textos publicados que o modelo recebe (base, instrucoes, nome da
   * clinica, a linha da hora na clinica) e os que vao colados na resposta
   * (saudacao, encerramento): fonte de data, hora e endereco.
   */
  textosPublicados: readonly string[];
  /**
   * Os textos fixos colados em volta da resposta (saudacao, aviso de
   * assistente virtual, encerramento, frase fixa escolhida): as regras dos
   * fatos tiram estes trechos do rascunho antes de ler. Nao sao afirmacao
   * do modelo.
   */
  textosColados: readonly string[];
  /** Todos os convenios do Cadastro, para reconhecer o nome no rascunho. */
  convenios: readonly ConvenioDosFatos[];
  /** O que as ferramentas do turno disseram de cada convenio. */
  coberturas: readonly CoberturaDoTurno[];
  /** As acoes que as ferramentas do turno executaram com sucesso. */
  acoes: readonly AcaoDoTurno[];
  /** Uma ferramenta do turno leu uma consulta que ja existia. */
  consultaLida: boolean;
  /** O ano de hoje no fuso da clinica (data sem ano no fato e deste ano). */
  anoCorrente: number;
  /**
   * Os horarios livres que as ferramentas de agenda trouxeram no turno: a
   * unica fonte da frase que afirma horario livre.
   */
  horariosLivres: readonly HorarioLivreDoTurno[];
  /**
   * Os nomes dos procedimentos ativos do Cadastro, para ler o procedimento
   * citado ao lado do convenio ("a Unimed cobre a Limpeza de pele").
   */
  procedimentos: readonly string[];
  /**
   * O Cadastro do turno nao tem nenhum convenio ativo: a negativa ("nao
   * atendemos convenio, so particular") e verdade sem ferramenta. So vale
   * com `convenios` vazio (o contrario e fato incoerente e bloqueia).
   */
  semConvenioAtivo: boolean;
  /**
   * Hoje no fuso da clinica, para ler "hoje" e "amanha" na frase que afirma
   * horario livre. Nulo: nao se sabe, e essa frase nao passa.
   */
  hoje: DiaDaClinica | null;
};

export type AchadoDosFatos = { categoria: CategoriaDosFatos; regra: string };

/** Os fatos de um turno sem ferramenta, sem texto e sem convenio. */
export function fatosVazios(anoCorrente: number): FatosDoTurno {
  return {
    saidasDasFerramentas: [],
    textosPublicados: [],
    textosColados: [],
    convenios: [],
    coberturas: [],
    acoes: [],
    consultaLida: false,
    anoCorrente,
    horariosLivres: [],
    procedimentos: [],
    semConvenioAtivo: false,
    hoje: null,
  };
}

// ---------------------------------------------------------------------------
// Validacao (o filtro nao confia em quem chama)
// ---------------------------------------------------------------------------

function listaDeTextos(valor: unknown): boolean {
  return Array.isArray(valor) && valor.every((v) => typeof v === "string");
}

function convenioValido(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const c = valor as Record<string, unknown>;
  return (
    typeof c.nome === "string" &&
    (c.plano === null || typeof c.plano === "string")
  );
}

function coberturaValida(valor: unknown): boolean {
  if (!convenioValido(valor)) {
    return false;
  }
  const c = valor as Record<string, unknown>;
  return (
    (ESTADOS_DA_COBERTURA as readonly unknown[]).includes(c.estado) &&
    (c.procedimento === null || typeof c.procedimento === "string")
  );
}

function horarioLivreValido(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const h = valor as Record<string, unknown>;
  return typeof h.dia === "string" && typeof h.hora === "string";
}

function inteiroEntre(valor: unknown, minimo: number, maximo: number) {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= minimo &&
    valor <= maximo
  );
}

function diaDaClinicaValido(valor: unknown): boolean {
  if (valor === null) {
    return true;
  }
  if (typeof valor !== "object") {
    return false;
  }
  const d = valor as Record<string, unknown>;
  return (
    inteiroEntre(d.dia, 1, 31) &&
    inteiroEntre(d.mes, 1, 12) &&
    inteiroEntre(d.ano, 2000, 2200)
  );
}

/** Os fatos tem exatamente o formato esperado? Qualquer desvio bloqueia. */
export function fatosValidos(valor: unknown): valor is FatosDoTurno {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const f = valor as Record<string, unknown>;
  return (
    listaDeTextos(f.saidasDasFerramentas) &&
    listaDeTextos(f.textosPublicados) &&
    listaDeTextos(f.textosColados) &&
    Array.isArray(f.convenios) &&
    f.convenios.every(convenioValido) &&
    Array.isArray(f.coberturas) &&
    f.coberturas.every(coberturaValida) &&
    Array.isArray(f.acoes) &&
    f.acoes.every((a) => (ACOES_DO_TURNO as readonly unknown[]).includes(a)) &&
    typeof f.consultaLida === "boolean" &&
    inteiroEntre(f.anoCorrente, 2000, 2200) &&
    Array.isArray(f.horariosLivres) &&
    f.horariosLivres.every(horarioLivreValido) &&
    listaDeTextos(f.procedimentos) &&
    typeof f.semConvenioAtivo === "boolean" &&
    // Sem convenio ativo com convenio no Cadastro e fato incoerente.
    !(f.semConvenioAtivo && f.convenios.length > 0) &&
    diaDaClinicaValido(f.hoje)
  );
}

// ---------------------------------------------------------------------------
// Data e hora
// ---------------------------------------------------------------------------

const MESES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;
const NOME_DO_MES = `(?:${MESES.join("|")})`;

export type DataLida = { dia: number; mes: number | null; ano: number | null };

export type DatasEHoras = {
  datas: DataLida[];
  /** "HH:MM", com a hora em dois digitos. */
  horas: string[];
};

/** "rascunho": o que o modelo escreveu. "fonte": de onde o fato vale. */
export type ModoDaLeitura = "rascunho" | "fonte";

// dd/mm e dd/mm/aaaa (ou aa). Ponto e hifen so com o ano de quatro digitos:
// "1.500" e preco, "2-3 dias" e quantidade.
const DATA_COM_BARRA =
  /(?<![\d/.,:])(\d{1,2})\s?\/\s?(\d{1,2})(?:\s?\/\s?(\d{4}|\d{2}))?(?![\d/]|[.,]\d)/g;
const DATA_COM_PONTO = /(?<![\d/.,:])(\d{1,2})[.-](\d{1,2})[.-](\d{4})(?!\d)/g;
// "16 de outubro", "1o de maio" (o "º" vira "o" na base), "21 de outubro
// de 2026".
const DATA_POR_EXTENSO = new RegExp(
  `(?<![\\d/.,])(\\d{1,2})o?\\s+de\\s+(${NOME_DO_MES})(?:\\s+de\\s+(\\d{4}))?\\b`,
  "g",
);
// "dia 30" so quando acompanha hora ("dia 30 as 14h", "dia 30, 9h30"): sem
// mes nem hora, "dia 30" e so o dia do mes e nao e lido.
const DIA_COM_HORA =
  /\bdia\s+(\d{1,2})\b(?!\s*(?:\/|de\s+[a-z]))(?=\s*,?\s*(?:(?:as|a partir das|pelas|das)\s+\d{1,2}(?!\d)|\d{1,2}\s?(?:h(?![a-z])|hs\b|hrs?\b|:\d{2})))/g;
// Logradouro com data no nome ("Rua 7 de Setembro", "Av. 13 de Maio"): a
// data e nome, nao data.
const DATA_QUE_E_NOME =
  /\b(?:rua|r\.|avenida|av\.?|travessa|alameda|praca|estrada|rodovia|largo|ladeira|bairro|conjunto|colegio|escola|hospital|shopping|edificio|predio|galeria|vila|parque|viaduto|ponte)\s*$/;
// "24/7" (o tempo todo) e fracao de valor ("1/3 do valor") nao sao data.
const DEPOIS_DE_DATA_QUE_NAO_E =
  /^\s*(?:d[oa]s?\s+(?:valor|total|preco|pagamento|procedimento|sessao|sessoes)\b|horas?\b|h\b|x\b|%)/;

// Uma expressao de hora so: "as 14", "das 8", "a partir das 9h", "ate as
// 18:30", "pelas 10 e meia", "14:00", "14h", "14h30", "14hs", "14 hrs",
// "14h30min", "10 horas".
const PREFIXO_DE_HORA = "(?:as|das|pelas|a partir das|ate as)";
const HORA = new RegExp(
  `(\\b${PREFIXO_DE_HORA}\\s+)?(?<![\\d:.,/])(\\d{1,2})(?:\\s?:\\s?(\\d{2})(?![\\d:])|\\s?(h|hs|hrs?|horas?)(?![a-z])(?:\\s?(\\d{2})(?!\\d))?(?:\\s?min\\b)?|\\s+e\\s+(meia|\\d{2})\\b)?(?![\\d/]|[.,]\\d|:)`,
  "g",
);
// "de 8 as 18", "de 8 a 18h": o primeiro numero tambem e hora.
const INICIO_DE_FAIXA =
  /\bde\s+(\d{1,2})(?=\s+(?:as|ate as)\s+\d{1,2}\b|\s+a\s+\d{1,2}\s?(?:h|hs|horas)(?![a-z]))/g;
const MEIO_DIA = /\bmeio[- ]?dia\b/g;
const MEIA_NOITE = /\bmeia[- ]?noite\b/g;

// "as 2 consultas", "as 3 opcoes": o artigo, nao a hora.
const QUANTIDADE_DEPOIS =
  /^\s*(?:sessoes|sessao|consultas?|vagas?|opcoes|opcao|unidades?|aplicacoes|aplicacao|vezes|pessoas?|primeir|ultim|outr|mais\b|anos?\b|meses|mes\b|dias?\b|semanas?|reais|real\b|r\$|%|x\b|parcelas?|pacientes?|clinicas?|salas?|profissionais|medic|doutor|areas?|regioes|procedimentos?|retornos?|avaliacoes|minutos?|min\b|segundos?|horarios?|datas?|perguntas?|mensagens?)/;
// Duracao: "dura 1h", "leva 2h", "em 6h", "1h de duracao", "48h antes".
const ANTES_DE_DURACAO =
  /(?:\b(?:dura|duram|durar|durando|duracao|leva|levam|levar|levando|demora|demoram|demorar|demorando|intervalo|jejum|a cada)\s+(?:\S+\s+){0,2}|\b(?:em|por)\s+)$/;
const DEPOIS_DE_DURACAO =
  /^\s*(?:de\s+(?:duracao|antecedencia|atraso|tolerancia|jejum|repouso|intervalo|espera|procedimento|sessao|aplicacao|consulta|atendimento|viagem|voo|carro|ida|antecipacao)\b|antes\b|depois\b|apos\b|seguid|por\s+(?:dia|semana|sessao|mes)\b|semanais\b|diarias\b|de\s+cada\b)/;
const PERIODO_DEPOIS = /^\s*(?:da|de|a)\s+(manha|tarde|noite)\b/;
/** Hora sem "as" na frente ate isto, no rascunho, e duracao ("dura 1h"). */
const MAIOR_HORA_QUE_E_DURACAO = 5;

function dataValida(dia: number, mes: number | null): boolean {
  return dia >= 1 && dia <= 31 && (mes === null || (mes >= 1 && mes <= 12));
}

function anoDe(texto: string | undefined): number | null {
  if (texto === undefined) {
    return null;
  }
  const n = Number(texto);
  return texto.length === 2 ? 2000 + n : n;
}

function hora(h: number, m: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "as 2 da tarde" e 14:00; "as 8 da noite", 20:00. */
function comPeriodo(h: number, depois: string): number {
  const periodo = PERIODO_DEPOIS.exec(depois)?.[1];
  if ((periodo === "tarde" || periodo === "noite") && h >= 1 && h < 12) {
    return h + 12;
  }
  return h;
}

/** Uma data ou uma hora lida, com a posicao no texto. */
type TemporalLido =
  | { tipo: "data"; indice: number; fim: number; data: DataLida }
  | { tipo: "hora"; indice: number; fim: number; hora: string };

/**
 * As datas e as horas de um texto JA NORMALIZADO, com a posicao, na ordem
 * de leitura de datasEHorasDoTexto (primeiro as datas, depois as horas).
 */
function temporaisDoTexto(base: string, modo: ModoDaLeitura): TemporalLido[] {
  const lidos: TemporalLido[] = [];
  const rascunho = modo === "rascunho";
  const antes = (indice: number) =>
    base.slice(Math.max(0, indice - 40), indice);
  const depois = (fim: number) => base.slice(fim, fim + 40);
  const data = (indice: number, fim: number, lida: DataLida) =>
    lidos.push({ tipo: "data", indice, fim, data: lida });
  const comHora = (indice: number, fim: number, lida: string | null) => {
    if (lida !== null) {
      lidos.push({ tipo: "hora", indice, fim, hora: lida });
    }
  };

  for (const m of base.matchAll(DATA_COM_BARRA)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const indice = m.index ?? 0;
    const fim = indice + m[0].length;
    if (
      rascunho &&
      ((dia === 24 && mes === 7 && m[3] === undefined) ||
        DEPOIS_DE_DATA_QUE_NAO_E.test(depois(fim)))
    ) {
      continue;
    }
    if (dataValida(dia, mes)) {
      data(indice, fim, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_COM_PONTO)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const indice = m.index ?? 0;
    if (dataValida(dia, mes)) {
      data(indice, indice + m[0].length, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_POR_EXTENSO)) {
    const indice = m.index ?? 0;
    if (rascunho && DATA_QUE_E_NOME.test(antes(indice))) {
      continue;
    }
    const dia = Number(m[1]);
    const mes = MESES.indexOf(m[2] as (typeof MESES)[number]) + 1;
    if (dataValida(dia, mes)) {
      data(indice, indice + m[0].length, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DIA_COM_HORA)) {
    const dia = Number(m[1]);
    const indice = m.index ?? 0;
    if (dataValida(dia, null)) {
      data(indice, indice + m[0].length, { dia, mes: null, ano: null });
    }
  }

  for (const m of base.matchAll(HORA)) {
    const [, prefixo, hh, mmDosPontos, unidade, mmDoH, mmDoE] = m;
    const inicio = (m.index ?? 0) + (prefixo?.length ?? 0);
    const fim = (m.index ?? 0) + m[0].length;
    const depoisDela = depois(fim);
    const comPeriodoDepois = PERIODO_DEPOIS.test(depoisDela);
    const h = Number(hh);
    const doisPontos = mmDosPontos !== undefined;
    const comH = unidade !== undefined && !unidade.startsWith("hora");
    const emHoras = unidade !== undefined && unidade.startsWith("hora");
    const comE = mmDoE !== undefined;

    if (prefixo === undefined) {
      // Numero solto so e hora com dois pontos, com "h", com "e meia" ou
      // com o periodo ("2 da tarde"). "Dias 14 e 15" nao e hora: sem "as",
      // so "e meia". "10 horas" sem "as" e duracao no rascunho ("24 horas
      // de antecedencia"); na fonte, conta.
      const ehHora =
        doisPontos ||
        comH ||
        mmDoE === "meia" ||
        comPeriodoDepois ||
        (emHoras && !rascunho);
      if (!ehHora) {
        continue;
      }
      if (
        rascunho &&
        !comPeriodoDepois &&
        (h <= MAIOR_HORA_QUE_E_DURACAO ||
          ANTES_DE_DURACAO.test(antes(inicio)) ||
          DEPOIS_DE_DURACAO.test(depoisDela))
      ) {
        continue;
      }
    } else if (
      rascunho &&
      unidade === undefined &&
      !doisPontos &&
      !comE &&
      QUANTIDADE_DEPOIS.test(depoisDela)
    ) {
      continue;
    }
    const minutos =
      mmDoE === "meia" ? 30 : Number(mmDosPontos ?? mmDoH ?? mmDoE ?? "0");
    comHora(inicio, fim, hora(comPeriodo(h, depoisDela), minutos));
  }
  for (const m of base.matchAll(INICIO_DE_FAIXA)) {
    const fim = (m.index ?? 0) + m[0].length;
    comHora(fim - (m[1]?.length ?? 0), fim, hora(Number(m[1]), 0));
  }
  for (const m of base.matchAll(MEIO_DIA)) {
    const indice = m.index ?? 0;
    comHora(indice, indice + m[0].length, "12:00");
  }
  for (const m of base.matchAll(MEIA_NOITE)) {
    const indice = m.index ?? 0;
    comHora(indice, indice + m[0].length, "00:00");
  }
  return lidos;
}

/**
 * As datas e as horas de um texto JA NORMALIZADO (normalizarBase). No modo
 * "fonte" (de onde o fato vale), tudo que tem cara de hora conta; no modo
 * "rascunho" (o que o modelo escreveu), duracao ("dura 1h", "24h de
 * antecedencia", "48h antes", "10 horas"), quantidade ("as 3 opcoes") e
 * data que e nome de rua ("Rua 7 de Setembro") ficam de fora. Numero solto
 * ("30 minutos", "R$ 150", "3o andar") nunca e hora.
 */
export function datasEHorasDoTexto(
  base: string,
  modo: ModoDaLeitura,
): DatasEHoras {
  const lidos = temporaisDoTexto(base, modo);
  return {
    datas: lidos.flatMap((l) => (l.tipo === "data" ? [l.data] : [])),
    horas: lidos.flatMap((l) => (l.tipo === "hora" ? [l.hora] : [])),
  };
}

function dataNosFatos(
  data: DataLida,
  fatos: readonly DataLida[],
  anoCorrente: number,
): boolean {
  return fatos.some(
    (f) =>
      f.dia === data.dia &&
      (data.mes === null || f.mes === null || f.mes === data.mes) &&
      (data.ano === null ||
        (f.ano === null ? data.ano === anoCorrente : f.ano === data.ano)),
  );
}

// ---------------------------------------------------------------------------
// Frases com a posicao (data, hora e convenio)
// ---------------------------------------------------------------------------

/**
 * Abreviacoes que terminam em ponto sem fechar a frase ("Dra. Ana", "Av.
 * Brasil", "R. Dr. Jose"). Ja sem acento e minusculas.
 */
const ABREVIACOES: ReadonlySet<string> = new Set([
  "dr",
  "dra",
  "drs",
  "dras",
  "sr",
  "sra",
  "srta",
  "av",
  "r",
  "n",
  "no",
  "nr",
  "prof",
  "profa",
  "eng",
  "sto",
  "sta",
  "al",
  "pca",
  "tv",
  "trav",
  "rod",
  "estr",
  "s",
  "km",
  "ex",
  "obs",
  "aprox",
  "tel",
  "cel",
  "ltda",
  "cia",
  "jd",
  "pq",
  "vl",
  "ed",
  "bl",
  "ap",
  "apto",
  "cj",
  "qd",
  "lt",
]);

/**
 * O que fecha uma frase: "!" e "?", o ponto seguido de espaco (nao o da
 * abreviacao nem o do numero, "1.500") e as conjuncoes que viram a frase
 * ("15:00 nao tenho, mas as 16h tenho": a segunda parte afirma). O ";" nao
 * fecha: e a lista de horarios ("terca as 14h; quarta as 9h").
 */
const FIM_DE_FRASE =
  /[!?]+|\.+(?=\s|$)|\s+(?:mas|porem|contudo|entretanto|no entanto)\s+/g;

type Frase = { inicio: number; fim: number; texto: string };

/** As frases de um texto JA NORMALIZADO, com a posicao. */
function frasesComPosicao(base: string): Frase[] {
  const frases: Frase[] = [];
  let inicio = 0;
  const fechar = (fim: number, proximo: number) => {
    const texto = base.slice(inicio, fim);
    if (texto.trim() !== "") {
      frases.push({ inicio, fim, texto });
    }
    inicio = proximo;
  };
  for (const m of base.matchAll(FIM_DE_FRASE)) {
    const indice = m.index ?? 0;
    const trecho = m[0];
    if (/^\s/.test(trecho)) {
      // A conjuncao abre a frase seguinte.
      fechar(indice, indice + 1);
      continue;
    }
    if (trecho.startsWith(".")) {
      const palavra = /([a-z]+)$/.exec(base.slice(0, indice))?.[1];
      if (palavra !== undefined && ABREVIACOES.has(palavra)) {
        continue;
      }
    }
    fechar(indice + trecho.length, indice + trecho.length);
  }
  fechar(base.length, base.length);
  return frases;
}

function fraseNoIndice(
  frases: readonly Frase[],
  indice: number,
): Frase | undefined {
  return frases.find((f) => indice >= f.inicio && indice < f.fim);
}

// ---------------------------------------------------------------------------
// Horario livre (revisao da AG2)
// ---------------------------------------------------------------------------

/** Hora ou data logo depois do verbo ("tenho 10:30", "temos 21/10"). */
const HORA_OU_DATA_LOGO_DEPOIS =
  "\\d{1,2}(?:\\s?:\\s?\\d{2}|\\s?h(?![a-z])|\\s?hs\\b|\\s?horas?\\b|\\s?\\/\\s?\\d)";
/** A vaga da agenda ("vaga de estacionamento" nao e). */
const VAGA_DA_AGENDA =
  "vag(?:a|as|o|os)\\b(?!\\s+(?:de|do|no|na)\\s+(?:estacionamento|garagem|carro|moto))";
/** O que vem depois de "tenho", "temos" e "tem" numa oferta de horario. */
const DEPOIS_DE_TER = `(?:horarios?(?!\\s+(?:ja\\s+)?(?:marcad|agendad|reservad|confirmad))|${VAGA_DA_AGENDA}|disponibilidade|encaixes?|agenda|as\\b|a partir|depois d|antes d|para\\b|pra\\b|na\\b|no\\b|nesta|nessa|neste|nesse|dia\\b|dias\\b|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|${HORA_OU_DATA_LOGO_DEPOIS}|de manha|de tarde|de noite|a tarde|a noite|pela manha|pela tarde|pela noite|com\\s+(?:a|o)\\b|livres?\\b|\\u00a7)`;
const QUANTIFICADORES_DA_OFERTA =
  "(?:(?:sim|ainda|so|apenas|tambem|a|o|as|os|um|uma|uns|umas|outro|outra|outros|outras|mais|disponivel|livre|estes|estas|esses|essas|os seguintes|as seguintes|alguns|algumas|dois|duas|tres)\\s+)*";
const PERIODOS_DA_OFERTA = `(?:as\\b|a partir|depois|antes|na\\b|no\\b|dia\\b|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|${HORA_OU_DATA_LOGO_DEPOIS}|de manha|de tarde|de noite|a tarde|a noite|pela manha|pela tarde|nesse|nesta|neste|nessa)`;
/**
 * O que esta livre ou disponivel sem ser a agenda ("o estacionamento e
 * livre das 7h as 19h", "o laudo fica disponivel as 14h").
 */
const LIVRE_QUE_NAO_E_AGENDA =
  "(?<!\\b(?:estacionamento|garagem|acesso|entrada|wi-?fi|internet|banheiro|elevador|rampa|cafe|agua|area|espaco|sala de espera|recepcao|resultado|laudo|exame|documento|recibo|nota|guia|boleto|link|pix|cardapio|material)\\s+(?:\\S+\\s+){0,3})";
/** Quem abre e fecha ("a clinica abre apenas as 8h") nao oferece horario. */
const SO_AS_QUE_NAO_E_OFERTA =
  "(?<!\\b(?:abre|abrimos|abrem|abrindo|fecha|fechamos|fecham|fechando|funciona|funcionamos|funcionam|atende|atendemos|atendem|chegar|chegue|cheguem)\\s+)";

/**
 * A frase afirma horario livre: "tenho as 14h", "temos vaga", "esta
 * livre", "pode ser as 10 e meia", "as 15h30 consigo", "da pra ser
 * amanha", "esta disponivel", "so as 16h", "tenho estes horarios: ...",
 * "encontrei terca as 14h", "que tal terca as 14h?". Lido frase a frase; a
 * negacao logo antes ("nao tenho", "sem vaga", "nao da pra") desfaz.
 */
const AFIRMA_HORARIO_LIVRE = new RegExp(
  [
    // "Voce tem horario as 14h" e a consulta da pessoa, nao horario livre.
    `(?<!\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?)\\b(?:tenho|temos|tem|teria|teriamos|terei|teremos)\\s+${QUANTIFICADORES_DA_OFERTA}${DEPOIS_DE_TER}`,
    // "As 16h tenho", "as 16h tenho, sim": o verbo no fim da oracao.
    "(?<!\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?)\\b(?:tenho|temos|tem)\\s*(?:,?\\s*sim\\b|[,.!?;]|$)",
    `\\bha\\s+${QUANTIFICADORES_DA_OFERTA}(?:horarios?|${VAGA_DA_AGENDA}|disponibilidade|encaixes?)`,
    `\\b${VAGA_DA_AGENDA}`,
    `${LIVRE_QUE_NAO_E_AGENDA}\\blivres?\\b`,
    `${LIVRE_QUE_NAO_E_AGENDA}(?:\\bdisponive(?:l|is)\\b|\\bdisponibilidade\\b)`,
    `\\bpode ser\\s+(?:sim\\s*,?\\s*)?${PERIODOS_DA_OFERTA}`,
    "(?<!\\b(?:traga|traz|trazer|leve|levar|levem|tragam|levando|trazendo)\\s)\\b(?:consigo|conseguimos|conseguiria|conseguiriamos)\\b",
    "\\bda\\s+(?:pra|para|sim|certo)\\b",
    "\\b(?:encaixo|encaixamos|encaixar|encaixe)\\b",
    "\\b(?:posso|podemos)\\s+(?:te\\s+|lhe\\s+)?oferecer\\b|\\bofereco\\b",
    `${SO_AS_QUE_NAO_E_OFERTA}\\b(?:so|somente|apenas)\\s+(?:as|a partir das|depois das|antes das)\\s+\\d`,
    "\\b(?:abriu|abriram|sobrou|sobraram|surgiu|surgiram|apareceu|liberou|liberaram)\\s+(?:uma?\\s+|um\\s+|outr[oa]\\s+|mais\\s+)?(?:vagas?|horarios?|encaixes?)\\b",
    "\\b(?:encontrei|achei|localizei)\\b",
    "\\bproxim[oa]s?\\s+(?:horarios?|vagas?|datas?)\\b",
    // "Que tal sexta?" propoe procurar; "que tal sexta as 14h?" oferece o
    // horario (com a hora na frase).
    "\\b(?:opc(?:ao|oes)|que tal|possivel)\\b(?=[^.!?;]*\\d)",
    "\\bposso\\s+(?:te\\s+|lhe\\s+)?(?:marcar|agendar|reservar|encaixar)\\b",
  ].join("|"),
  "g",
);
/** A oferta que fala de agenda e passa para a frase seguinte. */
const FALA_DE_AGENDA =
  /\b(?:horarios?|vagas?|disponibilidade|encaixes?|opcoes|datas)\b/;

/** A negacao da oferta, ate quatro palavras antes e sem passar de virgula. */
const NEGACAO_DA_OFERTA =
  /\b(?:nao|nem|nunca|sem|nenhum|nenhuma)\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;
const NEGACAO_NA_FRASE = /\b(?:nao|nem|nunca|nenhum|nenhuma)\b/;

function afirmaHorarioLivre(frase: string): boolean {
  for (const m of frase.matchAll(AFIRMA_HORARIO_LIVRE)) {
    if (!NEGACAO_DA_OFERTA.test(frase.slice(0, m.index ?? 0))) {
      return true;
    }
  }
  return false;
}

/**
 * A data, a hora e o endereco que so o paciente disse valem na frase que
 * nega ou pergunta ("15:00 nao tenho", "prefere as 15:00?"), nunca na que
 * afirma horario livre.
 */
function aceitaODitoPeloPaciente(frase: Frase): boolean {
  return (
    (frase.texto.trimEnd().endsWith("?") ||
      NEGACAO_NA_FRASE.test(frase.texto)) &&
    !afirmaHorarioLivre(frase.texto)
  );
}

/** Os dias da semana, de domingo (0) a sabado (6), sem acento. */
const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
] as const;
// "Terca", "terca-feira", "aos sabados". "Segunda opcao" e "quinta vez" sao
// ordinais, nao dias; "a primeira as 14h e a segunda as 15h" tambem ("a
// segunda" sem "-feira" nem data depois).
const DIA_DA_SEMANA = new RegExp(
  `\\b(${DIAS_DA_SEMANA.join("|")})(?:s|-feira|-feiras|\\s+feira|\\s+feiras)?\\b(?!\\s+(?:opcao|opcoes|vez|vezes|via|parte|sessao|sessoes|consulta|consultas|alternativa|data|semana|quinzena|etapa|dose|aplicacao|feira\\b))`,
  "g",
);
const ORDINAL_E_NAO_DIA = /(?:^|\s)(?:a|o)\s+$/;
const DIA_DEPOIS_DO_ORDINAL = /^(?:-feira|\s*,?\s*(?:dia\s+)?\d{1,2}\s?\/)/;
const DIA_RELATIVO = /\b(depois de amanha|amanha|hoje)\b/g;
const DESLOCAMENTO_DO_DIA: Readonly<Record<string, number>> = {
  hoje: 0,
  amanha: 1,
  "depois de amanha": 2,
};
// "dia 30" sem hora, so na frase que afirma horario livre ("tenho vaga dia
// 30").
const DIA_SOLTO = new RegExp(
  `\\bdia\\s+(\\d{1,2})\\b(?!\\s*(?:\\/|:|h\\b|de\\s+${NOME_DO_MES}))`,
  "g",
);
type PeriodoDoDia = "manha" | "tarde" | "noite";
// "de manha", "a tarde", "pela noite", "na parte da tarde".
const PERIODO_DO_DIA =
  /\b(?:de|pela|na|a|durante a|no periodo da|na parte da|periodo da|parte da)\s+(manha|tarde|noite)\b/g;
/** As faixas de buscar_horario (FAIXA_DO_PERIODO), em minutos do dia. */
const FAIXA_DO_PERIODO: Readonly<Record<PeriodoDoDia, [number, number]>> = {
  manha: [0, 12 * 60],
  tarde: [12 * 60, 18 * 60],
  noite: [18 * 60, 24 * 60],
};
// Entre duas partes da mesma data ("terca, 21/10", "amanha (quarta)",
// "quarta, dia 22").
const ENTRE_PARTES_DA_DATA = /^[\s,()-]*$/;

/** Uma data da oferta: cada parte nula vale qualquer uma. */
type DataDaOferta = {
  dia: number | null;
  mes: number | null;
  ano: number | null;
  semana: number | null;
  /** "amanha" sem saber hoje: nunca bate com nada. */
  impossivel: boolean;
};

type ParteDaOferta =
  | {
      tipo: "data";
      indice: number;
      fim: number;
      data: DataDaOferta;
      periodo: PeriodoDoDia | null;
    }
  | { tipo: "hora"; indice: number; fim: number; hora: string }
  | { tipo: "periodo"; indice: number; fim: number; periodo: PeriodoDoDia };

/** O par que a frase afirma: o dia com a hora dele (ou so um dos dois). */
type ParDaOferta = {
  data: DataDaOferta | null;
  hora: string | null;
  periodo: PeriodoDoDia | null;
};

function somarDias(hoje: DiaDaClinica, dias: number): DataDaOferta {
  const data = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + dias));
  return {
    dia: data.getUTCDate(),
    mes: data.getUTCMonth() + 1,
    ano: data.getUTCFullYear(),
    semana: null,
    impossivel: false,
  };
}

/** Junta duas partes da mesma data, se nao se contradizem. */
function juntarDatas(a: DataDaOferta, b: DataDaOferta): DataDaOferta | null {
  const campo = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  if (
    !campo(a.dia, b.dia) ||
    !campo(a.mes, b.mes) ||
    !campo(a.ano, b.ano) ||
    !campo(a.semana, b.semana)
  ) {
    return null;
  }
  return {
    dia: a.dia ?? b.dia,
    mes: a.mes ?? b.mes,
    ano: a.ano ?? b.ano,
    semana: a.semana ?? b.semana,
    impossivel: a.impossivel || b.impossivel,
  };
}

/**
 * As partes de data, hora e periodo de uma frase que afirma horario livre
 * (o texto inteiro ja normalizado e a frase dentro dele). Alem do que
 * temporaisDoTexto le, o dia da semana, "hoje" e "amanha", "dia 30" sem
 * hora e o periodo do dia; as partes coladas da mesma data ("terca, 21/10")
 * viram uma so, e o periodo logo depois da data e dela ("amanha de manha").
 */
function partesDaOferta(
  base: string,
  frase: Frase,
  hoje: DiaDaClinica | null,
): ParteDaOferta[] {
  const dentro = (indice: number) =>
    indice >= frase.inicio && indice < frase.fim;
  const datas: { indice: number; fim: number; data: DataDaOferta }[] = [];
  const horas: ParteDaOferta[] = [];
  for (const lido of temporaisDoTexto(base, "rascunho")) {
    if (!dentro(lido.indice)) {
      continue;
    }
    if (lido.tipo === "hora") {
      horas.push(lido);
    } else {
      datas.push({
        indice: lido.indice,
        fim: lido.fim,
        data: { ...lido.data, semana: null, impossivel: false },
      });
    }
  }
  const trecho = base.slice(frase.inicio, frase.fim);
  const ocupado = (indice: number) =>
    datas.some((d) => indice >= d.indice && indice < d.fim);
  for (const m of trecho.matchAll(DIA_DA_SEMANA)) {
    const indice = frase.inicio + (m.index ?? 0);
    const fim = indice + m[0].length;
    if (
      ORDINAL_E_NAO_DIA.test(base.slice(Math.max(0, indice - 4), indice)) &&
      !DIA_DEPOIS_DO_ORDINAL.test(base.slice(fim, fim + 12)) &&
      m[0] === m[1]
    ) {
      continue;
    }
    datas.push({
      indice,
      fim: indice + m[0].length,
      data: {
        dia: null,
        mes: null,
        ano: null,
        semana: DIAS_DA_SEMANA.indexOf(m[1] as (typeof DIAS_DA_SEMANA)[number]),
        impossivel: false,
      },
    });
  }
  for (const m of trecho.matchAll(DIA_RELATIVO)) {
    const indice = frase.inicio + (m.index ?? 0);
    const deslocamento = DESLOCAMENTO_DO_DIA[m[1] ?? ""] ?? 0;
    datas.push({
      indice,
      fim: indice + m[0].length,
      data:
        hoje === null
          ? {
              dia: null,
              mes: null,
              ano: null,
              semana: null,
              impossivel: true,
            }
          : somarDias(hoje, deslocamento),
    });
  }
  for (const m of trecho.matchAll(DIA_SOLTO)) {
    const indice = frase.inicio + (m.index ?? 0);
    const dia = Number(m[1]);
    if (!ocupado(indice) && dataValida(dia, null)) {
      datas.push({
        indice,
        fim: indice + m[0].length,
        data: { dia, mes: null, ano: null, semana: null, impossivel: false },
      });
    }
  }
  datas.sort((a, b) => a.indice - b.indice);

  // As partes coladas da mesma data viram uma so.
  const juntas: {
    indice: number;
    fim: number;
    data: DataDaOferta;
    periodo: PeriodoDoDia | null;
  }[] = [];
  for (const parte of datas) {
    const anterior = juntas[juntas.length - 1];
    if (
      anterior !== undefined &&
      parte.indice >= anterior.fim &&
      ENTRE_PARTES_DA_DATA.test(base.slice(anterior.fim, parte.indice))
    ) {
      const junta = juntarDatas(anterior.data, parte.data);
      if (junta !== null) {
        anterior.data = junta;
        anterior.fim = Math.max(anterior.fim, parte.fim);
        continue;
      }
    }
    if (anterior !== undefined && parte.indice < anterior.fim) {
      continue;
    }
    juntas.push({ ...parte, periodo: null });
  }

  // O periodo logo depois da data e dela; logo depois da hora e da hora
  // ("as 9 de manha") e ja foi lido nela; o resto fica solto.
  const periodos: ParteDaOferta[] = [];
  for (const m of trecho.matchAll(PERIODO_DO_DIA)) {
    const indice = frase.inicio + (m.index ?? 0);
    const periodo = m[1] as PeriodoDoDia;
    const daData = juntas.find(
      (d) => d.fim <= indice && /^[\s,]*$/.test(base.slice(d.fim, indice)),
    );
    if (daData !== undefined) {
      daData.periodo = daData.periodo ?? periodo;
      continue;
    }
    if (
      horas.some(
        (h) => h.fim <= indice && /^[\s,]*$/.test(base.slice(h.fim, indice)),
      )
    ) {
      continue;
    }
    periodos.push({
      tipo: "periodo",
      indice,
      fim: indice + m[0].length,
      periodo,
    });
  }
  return [
    ...juntas.map((d) => ({ tipo: "data" as const, ...d })),
    ...horas,
    ...periodos,
  ].sort((a, b) => a.indice - b.indice);
}

/**
 * Os pares que a frase afirma. A hora vai com a data do mesmo lado em que a
 * frase comecou: "terca, 21/10 as 14h e quarta, 22/10 as 9h" (data antes)
 * e "as 14h na terca, 21/10, ou as 9h na quarta" (hora antes); sem data
 * desse lado, a do outro. A data sem hora e o periodo solto (sem hora na
 * frase) tambem sao pares.
 */
function paresDaOferta(partes: readonly ParteDaOferta[]): ParDaOferta[] {
  const datas = partes.filter(
    (p): p is Extract<ParteDaOferta, { tipo: "data" }> => p.tipo === "data",
  );
  const horas = partes.filter(
    (p): p is Extract<ParteDaOferta, { tipo: "hora" }> => p.tipo === "hora",
  );
  const primeira = partes.find((p) => p.tipo !== "periodo");
  const dataAntes = primeira?.tipo === "data";
  const usadas = new Set<number>();
  const pares: ParDaOferta[] = [];
  for (const h of horas) {
    const antes = [...datas].reverse().find((d) => d.indice < h.indice);
    const depois = datas.find((d) => d.indice > h.indice);
    const d = dataAntes ? (antes ?? depois) : (depois ?? antes);
    if (d !== undefined) {
      usadas.add(d.indice);
    }
    pares.push({
      data: d?.data ?? null,
      hora: h.hora,
      periodo: d?.periodo ?? null,
    });
  }
  for (const d of datas) {
    if (!usadas.has(d.indice)) {
      pares.push({ data: d.data, hora: null, periodo: d.periodo });
    }
  }
  if (horas.length === 0) {
    for (const p of partes) {
      if (p.tipo === "periodo") {
        pares.push({ data: null, hora: null, periodo: p.periodo });
      }
    }
  }
  return pares;
}

type HorarioLivreLido = { data: DataDaOferta; hora: string };

/**
 * O horario livre que a ferramenta devolveu, lido com as mesmas regras do
 * rascunho ("terca, 21/10" e "14:00"). O dia da semana e o que a
 * ferramenta escreveu. Fora do formato: nulo (nao prova nada).
 */
function horarioLivreLido(
  horario: HorarioLivreDoTurno,
  anoCorrente: number,
): HorarioLivreLido | null {
  const dia = normalizarBase(horario.dia);
  const datas = temporaisDoTexto(dia, "fonte").filter(
    (l): l is Extract<TemporalLido, { tipo: "data" }> => l.tipo === "data",
  );
  const lidaAHora = temporaisDoTexto(
    normalizarBase(horario.hora),
    "fonte",
  ).find(
    (l): l is Extract<TemporalLido, { tipo: "hora" }> => l.tipo === "hora",
  );
  const data = datas[0]?.data;
  if (datas.length !== 1 || data === undefined || lidaAHora === undefined) {
    return null;
  }
  const semana = /^\s*([a-z]+)/.exec(dia)?.[1];
  const indiceDaSemana = DIAS_DA_SEMANA.indexOf(
    semana as (typeof DIAS_DA_SEMANA)[number],
  );
  return {
    data: {
      dia: data.dia,
      mes: data.mes,
      ano: data.ano ?? anoCorrente,
      semana: indiceDaSemana === -1 ? null : indiceDaSemana,
      impossivel: false,
    },
    hora: lidaAHora.hora,
  };
}

function minutosDa(horaLida: string): number {
  const [h = "0", m = "0"] = horaLida.split(":");
  return Number(h) * 60 + Number(m);
}

function mesmaData(rascunho: DataDaOferta, livre: DataDaOferta): boolean {
  const igual = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  return (
    !rascunho.impossivel &&
    (rascunho.dia === null || rascunho.dia === livre.dia) &&
    igual(rascunho.mes, livre.mes) &&
    (rascunho.ano === null || rascunho.ano === livre.ano) &&
    igual(rascunho.semana, livre.semana)
  );
}

function parNoHorarioLivre(par: ParDaOferta, livre: HorarioLivreLido) {
  const [de, ate] =
    par.periodo === null ? [0, 24 * 60] : FAIXA_DO_PERIODO[par.periodo];
  const minutos = minutosDa(livre.hora);
  return (
    (par.data === null || mesmaData(par.data, livre.data)) &&
    (par.hora === null || par.hora === livre.hora) &&
    minutos >= de &&
    minutos < ate
  );
}

// ---------------------------------------------------------------------------
// Endereco
// ---------------------------------------------------------------------------

/**
 * O tipo do logradouro, com a abreviacao. A abreviacao curta que e palavra
 * comum ("r", "al", "rod") so vale com o ponto; "av" e "pca" valem sem.
 */
const TIPOS_DE_LOGRADOURO: ReadonlyMap<string, string> = new Map([
  ["rua", "rua"],
  ["r.", "rua"],
  ["avenida", "avenida"],
  ["av", "avenida"],
  ["av.", "avenida"],
  ["travessa", "travessa"],
  ["trav.", "travessa"],
  ["tv.", "travessa"],
  ["alameda", "alameda"],
  ["al.", "alameda"],
  ["rodovia", "rodovia"],
  ["rod.", "rodovia"],
  ["praca", "praca"],
  ["pca", "praca"],
  ["pca.", "praca"],
  ["estrada", "estrada"],
  ["estr.", "estrada"],
  ["largo", "largo"],
  ["ladeira", "ladeira"],
  ["beco", "beco"],
  ["viela", "viela"],
]);

/** Palavras do nome que nao distinguem ("Rua DAS Flores"). */
const LIGACOES_DO_NOME: ReadonlySet<string> = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "d'",
]);

/** O que vem antes do numero da porta ("no 1500", "n. 1500", "numero 1500"). */
const ANTES_DO_NUMERO: ReadonlySet<string> = new Set([
  "n",
  "n.",
  "no",
  "no.",
  "n°",
  "numero",
]);

/** Numero que e medida, andar ou quantidade, nao numero da porta. */
const UNIDADE_DEPOIS_DO_NUMERO =
  /^(?:metros?|m|km|quilometros?|minutos?|min|horas?|h|andar|andares|o|a|reais|%|x|vezes|dias?|semanas?|meses|anos?|vagas?|salas?|pessoas?)$/;

/** Quantas palavras de nome, no maximo, entre o tipo e o numero. */
const MAXIMO_DE_PALAVRAS_DO_NOME = 8;

export type EnderecoLido = {
  tipo: string;
  /** As palavras do nome, sem as de ligacao (abreviacao termina em "."). */
  nome: string[];
  numero: string;
};

type EnderecoComPosicao = EnderecoLido & { inicio: number; fim: number };

/**
 * Pontuacao da borda da palavra, guardando o ponto da abreviacao ("av.",
 * "dr."); o ponto final do numero sai ("1500." e o fim da frase).
 */
function nucleo(token: string): string {
  const semBorda = token.replace(/^[("'[]+/, "").replace(/[,;:!?)"'\]]+$/, "");
  return /^\d{1,5}[a-z]?\.$/.test(semBorda) ? semBorda.slice(0, -1) : semBorda;
}

function ehNumeroDaPorta(texto: string): boolean {
  return /^\d{1,5}[a-z]?$/.test(texto);
}

/** "Dr.", "Eng.", "Av.": ponto de abreviacao, nao fim de frase. */
function ehAbreviacao(texto: string): boolean {
  return /^[a-z]{1,4}\.$/.test(texto);
}

type Palavra = { texto: string; inicio: number; fim: number };

/** O fim do nucleo da palavra no texto ("1500," termina antes da virgula). */
function fimDoNucleo(palavra: Palavra): number {
  const miolo = nucleo(palavra.texto);
  const onde = palavra.texto.indexOf(miolo);
  return onde === -1 ? palavra.fim : palavra.inicio + onde + miolo.length;
}

/**
 * Os logradouros com numero de um texto JA NORMALIZADO, com o trecho do
 * tipo ao numero.
 */
function enderecosComPosicao(base: string): EnderecoComPosicao[] {
  const tokens: Palavra[] = Array.from(base.matchAll(/\S+/g), (m) => ({
    texto: m[0],
    inicio: m.index ?? 0,
    fim: (m.index ?? 0) + m[0].length,
  }));
  const texto = (indice: number) => tokens[indice]?.texto ?? "";
  const enderecos: EnderecoComPosicao[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tipo = TIPOS_DE_LOGRADOURO.get(nucleo(texto(i)));
    if (tipo === undefined) {
      continue;
    }
    const nome: string[] = [];
    let numero: string | null = null;
    let ultimo = i;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const anterior = texto(j - 1);
      if (j > i + 1) {
        // Fim de frase encerra a busca; o ponto de abreviacao, nao.
        if (/[!?;]$/.test(anterior)) {
          break;
        }
        const semVirgula = anterior.replace(/[,)"']+$/, "");
        if (semVirgula.endsWith(".") && !ehAbreviacao(semVirgula)) {
          break;
        }
      }
      const token = nucleo(texto(j));
      const seguinte = nucleo(texto(j + 1));
      const depoisDoSeguinte = nucleo(texto(j + 2));
      if (token === "") {
        continue;
      }
      if (/^(?:s\/n[o.]?|sn)$/.test(token)) {
        numero = "sn";
        ultimo = j;
        break;
      }
      if (token === "km" && ehNumeroDaPorta(seguinte)) {
        numero = `km${seguinte}`;
        ultimo = j + 1;
        break;
      }
      if (ANTES_DO_NUMERO.has(token) && ehNumeroDaPorta(seguinte)) {
        numero = seguinte;
        ultimo = j + 1;
        break;
      }
      if (ehNumeroDaPorta(token)) {
        // "7 de Setembro": o numero e parte do nome.
        if (
          seguinte === "de" &&
          (MESES as readonly string[]).includes(depoisDoSeguinte)
        ) {
          nome.push(token, depoisDoSeguinte);
          j += 2;
          continue;
        }
        // "Rua 15, 230" e "Rua 15, no 230": o primeiro numero e o nome.
        if (
          /,$/.test(texto(j)) &&
          (ehNumeroDaPorta(seguinte) ||
            (ANTES_DO_NUMERO.has(seguinte) &&
              ehNumeroDaPorta(depoisDoSeguinte)))
        ) {
          nome.push(token);
          continue;
        }
        // "1500, sala 302": com a virgula, o que vem depois e o
        // complemento. Sem ela, "300 metros" e "3 salas" sao medida.
        if (/,$/.test(texto(j)) || !UNIDADE_DEPOIS_DO_NUMERO.test(seguinte)) {
          numero = token;
          ultimo = j;
        }
        break;
      }
      if (!/[a-z]/.test(token)) {
        break;
      }
      if (!LIGACOES_DO_NOME.has(token)) {
        nome.push(token);
      }
      if (nome.length > MAXIMO_DE_PALAVRAS_DO_NOME) {
        break;
      }
    }
    const primeiro = tokens[i];
    const final = tokens[ultimo];
    if (
      numero !== null &&
      nome.length > 0 &&
      primeiro !== undefined &&
      final !== undefined
    ) {
      enderecos.push({
        tipo,
        nome,
        numero,
        inicio: primeiro.inicio,
        fim: fimDoNucleo(final),
      });
    }
  }
  return enderecos;
}

/**
 * Os logradouros com numero de um texto JA NORMALIZADO (normalizarBase, sem
 * mascara): "Av. Santos Dumont, 1500", "Rua 7 de Setembro, 45", "Rodovia
 * CE-040, km 12", "Rua X, s/n". Sem numero nao e lido: a regra e sobre o
 * endereco que leva a pessoa a uma porta.
 */
export function enderecosDoTexto(base: string): EnderecoLido[] {
  return enderecosComPosicao(base).map(({ tipo, nome, numero }) => ({
    tipo,
    nome,
    numero,
  }));
}

function palavraBate(doRascunho: string, doFato: string): boolean {
  const r = doRascunho.replace(/\.$/, "");
  const f = doFato.replace(/\.$/, "");
  if (r === f) {
    return true;
  }
  // Abreviacao de um lado ("Eng." e "Engenheiro").
  if (doRascunho.endsWith(".") && f.startsWith(r)) {
    return true;
  }
  return doFato.endsWith(".") && r.startsWith(f);
}

/**
 * O endereco do rascunho esta nos fatos: o mesmo tipo, o mesmo numero e
 * toda palavra do nome no nome do fato (pode faltar palavra, nunca sobrar).
 */
function enderecoNosFatos(
  endereco: EnderecoLido,
  fatos: readonly EnderecoLido[],
): boolean {
  return fatos.some(
    (f) =>
      f.tipo === endereco.tipo &&
      f.numero === endereco.numero &&
      endereco.nome.every((palavra) =>
        f.nome.some((doFato) => palavraBate(palavra, doFato)),
      ),
  );
}

/** Na saida da ferramenta, a pontuacao do JSON vira espaco. */
function semPontuacaoDoJson(texto: string): string {
  return texto.replace(/["{}[\]:]/g, " ");
}

function enderecosDasFontes(textos: readonly string[]): EnderecoLido[] {
  return textos.flatMap((texto) =>
    enderecosDoTexto(normalizarBase(semPontuacaoDoJson(texto))),
  );
}

/** Os campos "endereco" (texto) de uma saida de ferramenta em JSON. */
function camposDeEndereco(saida: string): string[] {
  let lido: unknown;
  try {
    lido = JSON.parse(saida);
  } catch {
    return [];
  }
  const achados: string[] = [];
  const visitar = (valor: unknown, profundidade: number) => {
    if (profundidade > 6 || typeof valor !== "object" || valor === null) {
      return;
    }
    if (Array.isArray(valor)) {
      for (const item of valor) {
        visitar(item, profundidade + 1);
      }
      return;
    }
    for (const [chave, item] of Object.entries(valor)) {
      if (chave === "endereco" && typeof item === "string") {
        achados.push(item);
      } else {
        visitar(item, profundidade + 1);
      }
    }
  };
  visitar(lido, 0);
  return achados;
}

/**
 * Palavras que as regras clinicas leem como sintoma ou remedio e que sao
 * nome de lugar no Brasil ("Rua das Dores", "Nossa Senhora dos Remedios",
 * "Bairro das Dores"). Lista fechada e curta, ja sem acento: e a unica
 * excecao que o endereco do Cadastro ganha, e so como a ULTIMA palavra do
 * nome (cadastro-do-agente.ts troca a ultima palavra por uma neutra no
 * logradouro, no bairro e na cidade e confere o endereco inteiro de novo;
 * "Rua Tome Dipirona" e "Rua Dores de Cabeca Passam" continuam fora).
 */
export const PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR: readonly string[] = [
  "dor",
  "dores",
  "remedio",
  "remedios",
];
const PALAVRAS_CLINICAS_DE_LUGAR: ReadonlySet<string> = new Set(
  PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR,
);

/**
 * O nome de lugar com a ULTIMA palavra trocada por "Lugar" quando ela esta
 * em PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR ("Rua das Dores" vira "Rua das
 * Lugar"), para conferir o texto inteiro com as regras de sempre. A palavra
 * no meio do nome fica como esta (e continua barrando).
 */
export function semPalavrasClinicasDeLugar(texto: string): string {
  return texto.replace(
    /(\p{L}+)(\P{L}*)$/u,
    (inteiro, palavra: string, resto: string) =>
      PALAVRAS_CLINICAS_DE_LUGAR.has(normalizarBase(palavra))
        ? `Lugar${resto}`
        : inteiro,
  );
}

/**
 * Os trechos do rascunho (ja normalizados) que sao o endereco que uma
 * ferramenta do turno trouxe (consultar_unidades): o campo "endereco"
 * inteiro, quando o rascunho o repete, e o logradouro com o numero que bate
 * com um endereco dela ("Rua das Dores, 100"). Sao nome de lugar: o filtro
 * deterministico (filtro-deterministico.ts) tira estes trechos so das
 * vedacoes clinicas que a mascara do catalogo cobre, e o resto do rascunho
 * continua lido ("Rua das Dores, 100. Tome dipirona" barra). O endereco da
 * ferramenta ja passou pelas regras do filtro no carregamento, com a unica
 * excecao de PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR.
 */
export function trechosDeEnderecoDasFerramentas(
  rascunho: string,
  fatos: FatosDoTurno,
): string[] {
  const base = normalizarBase(rascunho);
  const completos = fatos.saidasDasFerramentas
    .flatMap(camposDeEndereco)
    .map((endereco) => normalizarBase(endereco))
    .filter(
      (endereco) =>
        endereco.length >= 3 &&
        new RegExp(`(?<![a-z0-9])${escaparRegex(endereco)}(?![a-z0-9])`).test(
          base,
        ),
    );
  const dasFerramentas = enderecosDasFontes(fatos.saidasDasFerramentas);
  const logradouros = enderecosComPosicao(base)
    .filter((e) => enderecoNosFatos(e, dasFerramentas))
    .map((e) => base.slice(e.inicio, e.fim));
  return [...new Set([...completos, ...logradouros])];
}

// ---------------------------------------------------------------------------
// Acao e estado da consulta
// ---------------------------------------------------------------------------

function alternativas(termos: readonly string[]): string {
  return `(?:${termos.join("|")})`;
}

/**
 * O objeto da agenda ("sua consulta", "seu horario") e o marcador do nome
 * do catalogo mascarado. O marcador nao e letra: antes dele, a fronteira e
 * "(?<![a-z0-9])", nunca a de palavra.
 */
const OBJETOS_DA_AGENDA = [
  "consulta",
  "consultas",
  "horario",
  "agendamento",
  "atendimento",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "reserva",
  "vaga",
  "\\u00a7",
];
const OBJETO = alternativas(OBJETOS_DA_AGENDA);
/** A consulta como compromisso da pessoa (sem horario, vaga e reserva). */
const CONSULTA = alternativas([
  "consulta",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "agendamento",
  "atendimento",
  "\\u00a7",
]);
/** O compromisso com o possessivo: tambem "seu horario" (revisao da AG2). */
const CONSULTA_OU_HORARIO = alternativas([CONSULTA, "horarios?"]);
/**
 * O objeto da agenda no singular, sem artigo, no comeco da frase
 * ("Consulta cancelada", "Horario marcado: ..."). O plural sem artigo e
 * regra ("Consultas canceladas em cima da hora sao cobradas").
 */
const OBJETO_NO_SINGULAR = alternativas([
  "consulta",
  "horario",
  "agendamento",
  "atendimento",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "reserva",
  "vaga",
  "presenca",
  "\\u00a7",
]);
const POSSESSIVO = "(?:(?:o|a)\\s+)?(?:seu|sua|teu|tua)";
/** O auxiliar que diz que a coisa ja aconteceu ("ficou marcada"). */
const JA_ACONTECEU = [
  "ficou",
  "ficaram",
  "foi",
  "foram",
  "ja foi",
  "ja foram",
  "acabou de ser",
  "acabaram de ser",
];
/** O auxiliar do estado ("esta marcada"). */
const ESTA = [
  "esta",
  "estao",
  "ta",
  "ja esta",
  "ja estao",
  "continua",
  "segue",
];
const FEITO = "(?:feit|realizad|concluid|efetuad)[oa]s?";
/**
 * "O sabado fica reservado para retornos" e regra da agenda, nao a reserva
 * de 10 minutos.
 */
const RESERVA_QUE_E_REGRA =
  "(?!\\s+(?:para|pra|aos?|as?)\\s+(?:os\\s+|as\\s+)?(?:retornos?|pacientes?|convenios?|urgencias?|encaixes?|procedimentos?|cirurgias?|exames?|avaliac\\w*|criancas?|idosos?|gestantes?)\\b)";
/**
 * O comeco da frase, com as interjeicoes de quem acabou de fazer ("Pronto,
 * cancelada", "Prontinho! Agendado", "Ok, consulta marcada") e o "ja" e o
 * "tudo" ("Ja agendado", "Tudo marcado").
 */
const NO_COMECO_DA_FRASE =
  "(?<=(?:^|[.!?;:])\\s*)(?:(?:pronto|prontinho|prontissimo|feito|perfeito|tudo certo|tudo pronto|tudo ok|certo|certinho|ok|okay|otimo|combinado|beleza|show|maravilha|excelente|isso|entao|sim|claro|oba|legal|muito bem|bom)\\s*[,!.]*\\s+)*(?:ja\\s+)?(?:tudo\\s+)?";
/** O objeto sem artigo antes do participio ("Consulta com a Dra. Ana marcada"). */
const OBJETO_ANTES_DO_PARTICIPIO = `(?:${OBJETO_NO_SINGULAR}(?:\\s+(?:de|do|da|com)\\s+(?:\\S+\\s+){0,2}?)?\\s+)?`;
/**
 * O participio que descreve a regra, e nao a acao ("Cancelada com menos de
 * 24 horas, a consulta e cobrada", "Agendado so depois da sua
 * confirmacao").
 */
const PARTICIPIO_DA_REGRA =
  "(?!\\s+(?:com\\s+(?:menos|mais|antecedencia|no minimo|pelo menos|ate|\\d)|em cima da hora|fora do prazo|sem aviso|sem antecedencia|no mesmo dia|ate\\s+\\d|so\\s+(?:depois|quando|apos|com)|apos\\b|depois\\b|quando\\b|assim que|antes\\s+d|(?:pelo|pela|por)\\s+(?:whatsapp|site|app|aplicativo|telefone|internet|aqui)\\s+(?:precisa|precisam|fica|ficam|passa|passam|depende|dependem|tem|e|sao|sera|serao)\\b))";

type PadraoDeAcao = {
  nome: string;
  /** null: o estado da consulta (vale com consultaLida ou marcou). */
  acao: AcaoDoTurno | null;
  regex: RegExp;
};

function padraoDeAcao(
  nome: string,
  alvo: AcaoDoTurno | null,
  fonte: string,
): PadraoDeAcao {
  return { nome, acao: alvo, regex: new RegExp(fonte, "g") };
}

/** O participio no comeco da frase, com ou sem o objeto. */
function participioNoComeco(participio: string, depois = ""): string {
  return `${NO_COMECO_DA_FRASE}${OBJETO_ANTES_DO_PARTICIPIO}${participio}[oa]s?\\b${depois}${PARTICIPIO_DA_REGRA}`;
}

const PADROES_DE_ACAO: readonly PadraoDeAcao[] = [
  // Marcar.
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\b(?:marquei|agendei|acabei de marcar|acabei de agendar)\\b",
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b(?:marcamos|agendamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b${alternativas(JA_ACONTECEU)}\\s+(?:\\w+\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b(?:agendamento|marcacao)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?${FEITO}\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `(?<![a-z0-9])${OBJETO}\\s+(?:marcad|agendad)[oa]s?\\s+com\\s+sucesso\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `(?:^|[.!?]\\s*)(?:pronto|prontinho|feito|tudo certo|perfeito)[,!.]?\\s+(?:${POSSESSIVO}\\s+)?(?:${OBJETO}\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  // Revisao da AG2: "Ja deixei agendado", "deixamos tudo marcado".
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\b(?:deixei|deixamos)\\s+(?:\\S+\\s+){0,2}?(?:marcad|agendad)[oa]s?\\b",
  ),
  // Revisao da AG2: o participio no comeco da frase ("Agendado!", "Consulta
  // marcada para quinta", "Horario marcado: ..."). E o estado da consulta:
  // vale com a consulta marcada neste turno ou lida por ferramenta.
  padraoDeAcao("marcacao", null, participioNoComeco("(?:marcad|agendad)")),
  // Reservar.
  padraoDeAcao("reserva", "reservou", "\\b(?:reservei|segurei)\\b"),
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\b(?:reservamos|seguramos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA, "fica", "ficara", "vai ficar", "deixei", "deixamos"])}\\s+(?:\\w+\\s+){0,2}reservad[oa]s?\\b${RESERVA_QUE_E_REGRA}`,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    participioNoComeco("reservad", RESERVA_QUE_E_REGRA),
  ),
  // Confirmar presenca.
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    "\\bconfirmei\\b(?!\\s+com\\b)",
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\bconfirmamos\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?confirmad[oa]s?\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `(?<![a-z0-9])${alternativas(["presenca", ...OBJETOS_DA_AGENDA])}\\s+confirmad[oa]s?\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    participioNoComeco("confirmad"),
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\bconfirmo\\s+(?:entao\\s+)?(?:para|pra|${POSSESSIVO}|o horario|a consulta|a presenca)\\b`,
  ),
  // Cancelar.
  padraoDeAcao("cancelamento", "cancelou", "\\b(?:cancelei|desmarquei)\\b"),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b(?:cancelamos|desmarcamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?(?:cancelad|desmarcad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b(?:cancelamento|desmarcacao)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?(?:${FEITO}|confirmad[oa]s?)\\b`,
  ),
  // Revisao da AG2: "Cancelado, Maria", "Consulta cancelada", "Pronto,
  // cancelada".
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    participioNoComeco("(?:cancelad|desmarcad)"),
  ),
  // Remarcar.
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    "\\b(?:remarquei|reagendei|mudei (?:a|o) (?:sua|seu)|transferi (?:a|o) (?:sua|seu))\\b",
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b(?:remarcamos|reagendamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?(?:remarcad|reagendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b(?:remarcacao|reagendamento)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?(?:${FEITO}|confirmad[oa]s?)\\b`,
  ),
  // Revisao da AG2: "Remarcado para quinta".
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    participioNoComeco("(?:remarcad|reagendad)"),
  ),
  // Lista de espera.
  padraoDeAcao(
    "lista_de_espera",
    "lista_de_espera",
    "\\b(?:coloquei|inclui|adicionei|botei|anotei|cadastrei|inscrevi|registrei|pus|incluimos|colocamos|adicionamos|anotamos|cadastramos)\\s+(?:\\S+\\s+){0,3}?(?:na|em)\\s+(?:nossa\\s+|a\\s+)?lista de espera\\b",
  ),
  padraoDeAcao(
    "lista_de_espera",
    "lista_de_espera",
    "\\b(?:esta|estao|ta|ficou|ja esta|entrou|entrei|foi (?:incluid|colocad|adicionad|anotad)[oa])\\s+(?:\\S+\\s+){0,2}?(?:na|para a)\\s+(?:nossa\\s+)?lista de espera\\b",
  ),
  // O estado da consulta que ja existia (fora de pergunta: "voce tem
  // consulta amanha?" pergunta, nao afirma). Sem "horario" e "vaga" no
  // "voce tem": "voce tem horario amanha" e oferta.
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:\\S+\\s+){0,6}?${alternativas(ESTA)}\\s+(?:\\w+\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:marcad|agendad)[oa]s?\\s+(?:para|pra|no|na|em|dia|as|amanha|hoje)\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?tem\\s+(?:uma\\s+)?${CONSULTA}\\s+(?:marcad[oa]|agendad[oa]|amanha|hoje|depois de amanha|na\\b|no\\b|dia\\b|as\\b|para\\b|pra\\b)`,
  ),
  // Revisao da AG2: "Esta agendado para quinta", "Ta marcado", "Ja esta
  // tudo marcado" (sem o possessivo), "voce tem horario marcado" e "A
  // consulta marcada para quinta ...".
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${alternativas(ESTA)}\\s+(?:(?:tudo|ja|certinho|bem|sim)\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    "\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?tem\\s+(?:um\\s+)?horario\\s+(?:marcad|agendad)o\\b",
  ),
  // "Fica marcado para terca", fora da condicao ("assim que voce
  // confirmar, fica marcado" descreve o fluxo).
  padraoDeAcao(
    "consulta_existente",
    null,
    "(?<!\\b(?:se|assim que|quando|depois que|apos|caso|logo que)\\b[^.!?]{0,40})\\b(?:fica|ficara|vai ficar)\\s+(?:tudo\\s+|ja\\s+)?(?:marcad|agendad)[oa]s?\\b",
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `(?<=(?:^|[.!?;:])\\s*)(?:a|o)\\s+${OBJETO_NO_SINGULAR}\\s+(?:marcad|agendad)[oa]\\s+(?:para|pra|no|na|em|dia|as|amanha|hoje)\\b`,
  ),
];

/** "Agendadinho", "marcadinha": o participio no diminutivo. */
const PARTICIPIO_NO_DIMINUTIVO =
  /\b(marcad|agendad|cancelad|desmarcad|remarcad|reagendad|reservad|confirmad)inh([oa]s?)\b/g;

/** Negacao colada na afirmacao ("nao marquei", "ainda nao foi marcada"). */
const NEGACAO_ANTES =
  /\b(?:nao|nem|nunca)\s+(?:(?:te|lhe|me|se|a|o|ainda|tinha)\s+)?$/;

function negada(texto: string, indice: number): boolean {
  return NEGACAO_ANTES.test(texto.slice(Math.max(0, indice - 30), indice));
}

/** A frase que contem o indice termina em "?". */
function emPergunta(texto: string, indice: number): boolean {
  const resto = texto.slice(indice);
  const fim = resto.search(/[.!?\n]/);
  return fim !== -1 && resto[fim] === "?";
}

// ---------------------------------------------------------------------------
// Convenio
// ---------------------------------------------------------------------------

/**
 * As palavras genericas que apontam convenio e as operadoras mais comuns:
 * so para RECONHECER a afirmacao ("aceitamos Hapvida" com a Hapvida fora do
 * Cadastro tambem precisa de fato). Nao e dado de clinica nenhuma e nunca
 * libera nada; os nomes do Cadastro entram pelos fatos. Revisao da AG2: o
 * "Bradesco" sozinho e mais operadoras regionais; a operadora que nao esta
 * aqui nem no Cadastro e pega pelo objeto de "aceita", "atende pelo",
 * "trabalha com" e "cobre" (analisarObjeto).
 */
const OPERADORAS_CONHECIDAS = [
  "unimed",
  "bradesco saude",
  "bradesco",
  "amil",
  "sulamerica",
  "sul america",
  "hapvida",
  "notredame",
  "notre dame",
  "intermedica",
  "cassi",
  "geap",
  "golden cross",
  "mediservice",
  "omint",
  "care plus",
  "prevent senior",
  "camed",
  "porto seguro",
  "allianz",
  "sompo",
  "postal saude",
  "saude caixa",
  "petrobras",
  "assim saude",
  "medsenior",
  "planserv",
  "issec",
  "ipsemg",
  "iamspe",
  "cabesp",
  "fusex",
  "gama saude",
  "trasmontano",
  "ameplan",
];
const CONVENIO_GENERICO = `(?:convenios?|planos?(?!\\s+de\\s+(?:tratamento|pagamento|acao|saude bucal))|seguro saude|operadoras?|${OPERADORAS_CONHECIDAS.join("|")})`;

/** "cobre": precisa de "coberto"; "aceita": basta o convenio atender. */
type Alegacao = "cobre" | "aceita";

/** Ate dois artigos, possessivos ou demonstrativos ("o seu convenio"). */
const DETERMINANTES =
  "(?:(?:o|a|os|as|seu|sua|seus|suas|esse|essa|esses|essas|este|esta)\\s+){0,2}";

type PadraoDeCobertura = {
  nome: string;
  alegacao: Alegacao;
  /** A fonte, com o alvo (generico ou nome do Cadastro) no lugar dele. */
  fonte: (alvo: string) => string;
};

/** As afirmacoes lidas pelo convenio citado (o alvo). */
const PADROES_DE_COBERTURA: readonly PadraoDeCobertura[] = [
  {
    nome: "convenio_paga",
    alegacao: "cobre",
    fonte: (alvo) =>
      `\\b${alvo}(?:\\s+\\S+){0,4}?\\s+(?:paga|pagam|pagara|vai pagar|custeia|custeiam|reembolsa|reembolsam|arca com)\\b`,
  },
  {
    nome: "incluso_no_convenio",
    alegacao: "cobre",
    fonte: (alvo) =>
      `\\b(?:inclus|incluid)[oa]s?\\s+(?:no|na|pelo|pela|em)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "atende_por",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b(?:atende|atendem|atendemos|atendo)\\b(?:\\s+\\S+){0,3}?\\s+(?:por|com)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "credenciado",
    alegacao: "aceita",
    fonte: () => "\\bcredenciad[oa]s?\\b",
  },
  {
    nome: "convenio_aceito",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b${alvo}(?:\\s+\\S+){0,2}?\\s+(?:e|eh|esta|sao|estao|foi)\\s+(?:aceit|atendid)[oa]s?\\b`,
  },
];

type PadraoPeloObjeto = {
  nome: string;
  /**
   * "todo": todo objeto que nao e pagamento, "particular" nem palavra de
   * fora (horario, canal, gente, lugar) exige fato, inclusive a operadora
   * fora da lista. "convenio": so o objeto que cita convenio (o "atende"
   * direto: "atendemos adultos" nao e convenio).
   */
  objeto: "todo" | "convenio";
  regex: RegExp;
};

/**
 * Revisao da AG2: as afirmacoes lidas pelo OBJETO, ate o fim da oracao
 * ("Sim, aceitamos Bradesco.", "Atendemos pela Camed.", "Trabalhamos com
 * Unimed e cartao").
 */
const PADROES_PELO_OBJETO: readonly PadraoPeloObjeto[] = [
  {
    nome: "aceita",
    objeto: "todo",
    regex:
      /\baceit(?:a|am|amos|o)\b(?:\s+(?:sim|tambem|ainda|so|somente|apenas|normalmente))*/g,
  },
  {
    nome: "atende_pelo",
    objeto: "todo",
    regex:
      /\b(?:atende|atendem|atendemos|atendo)\b(?:\s+[^\s,;:.!?]+){0,3}?\s+pel[oa]s?\b/g,
  },
  {
    nome: "trabalha_com",
    objeto: "todo",
    regex:
      /\btrabalh(?:a|am|amos|o)\s+(?:sim\s+|tambem\s+|so\s+|somente\s+|apenas\s+)?com\b/g,
  },
  {
    nome: "atende",
    objeto: "convenio",
    regex:
      /\b(?:atende|atendem|atendemos|atendo)\b(?!\s+(?:\S+\s+){0,3}?pel[oa]s?\b)/g,
  },
];

/** Onde acaba o objeto: a pontuacao forte, a oracao seguinte e a preposicao. */
const FIM_DO_OBJETO =
  /[.;:!?]|,\s*(?=(?:e|mas|que|porque|pois|se|entao|ja|sim|nao|o|a|os|as|tudo|ok|certo|claro|pode|quer|posso|voce|so|apenas|inclusive|alem|caso)\b)|\s(?=(?:para|pra|no|na|nos|nas|em|se|mas|quando|porque|pois|ate|desde|via|caso|que|onde|so|apenas|somente|inclusive|exceto|menos|mediante|conforme)\b)/;

/** "plano de tratamento" e "plano de pagamento" nao sao convenio. */
const PLANO_QUE_NAO_E_CONVENIO =
  /\bplanos?\s+de\s+(?:tratamento|pagamento|acao|saude bucal)\b/g;

/** Lugar coberto ("estacionamento coberto", "area coberta"). */
const LUGAR_ANTES_DE_COBERTO =
  "(?<!\\b(?:estacionamento|garagem|vagas?|local|area|espaco|lugar|patio|corredor|acesso|ponto|toldo|teto)\\s(?:\\S+\\s){0,2})";
/** "Coberto pelo valor da consulta" e o preco, nao convenio. */
const COBERTO_PELO_PRECO =
  "(?!\\s+(?:pelo|pela)\\s+(?:valor|preco|pacote|taxa|sinal|investimento|orcamento)\\b)";
const COBERTO = new RegExp(
  `${LUGAR_ANTES_DE_COBERTO}\\bcobert[oa]s?\\b${COBERTO_PELO_PRECO}`,
  "g",
);
// "Na cobertura do predio" e o andar; "sem cobertura" e "fora da
// cobertura" sao a negativa (SEM_COBERTURA).
const COBERTURA =
  /(?<!\b(?:na|sem|fora da|fora de)\s)\bcobertura\b(?!\s+d[oa]\s+(?:predio|edificio|shopping|torre|bloco))/g;
/** "Coberto" com o verbo de ligacao: "e coberto", "sim, e coberta". */
const VERBO_ANTES_DE_COBERTO =
  /\b(?:e|eh|sao|esta|estao|fica|ficam|seria|sera|serao|foi|foram|sim)\s+(?:(?:sim|tambem|totalmente|integralmente|parcialmente)\s+)?$/;
/** "Tem cobertura", "com cobertura": a afirmacao sem a palavra convenio. */
const TER_COBERTURA =
  /\b(?:tem|ha|possui|possuem|com|inclui|incluid[oa]|dentro da)\s+(?:\S+\s+)?$/;
/** O paciente perguntou de convenio ou de cobertura. */
const CONVENIO_NA_MENSAGEM =
  /\b(?:convenios?|planos?(?!\s+de\s+(?:tratamento|pagamento))|operadoras?|carteirinha|seguro saude|cobre|cobrem|cobertura|coberto|coberta|credenciad\w*|reembolso)\b/;

/** A negacao da afirmacao de convenio, ate tres palavras antes. */
const NEGACAO_DO_CONVENIO =
  /\b(?:nao|nem|nenhum|nenhuma)\b(?:\s+[^\s,;:.!?]+){0,3}\s*$/;
/**
 * Pergunta indireta ou condicao ("ver se cobre", "se o plano cobre"). A
 * pontuacao fecha o alcance ("Nao, mas atendemos pelo X" afirma; "nao" e
 * a resposta de antes).
 */
const CONDICAO_ANTES = /\bse\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;
const SEM_COBERTURA =
  /\b(?:sem cobertura|fora da (?:cobertura|rede)|nao (?:faz|fazem) parte da (?:rede|cobertura))\b/;

type ConvenioNormalizado = { nome: string; plano: string | null };

function normalizarConvenio(c: ConvenioDosFatos): ConvenioNormalizado {
  return {
    nome: normalizarBase(c.nome),
    plano: c.plano === null ? null : normalizarBase(c.plano),
  };
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexDoNome(nome: string, flags = ""): RegExp {
  return new RegExp(`(?<![a-z0-9])${escaparRegex(nome)}(?![a-z0-9])`, flags);
}

function contem(frase: string, nome: string): boolean {
  return nome.length >= 2 && regexDoNome(nome).test(frase);
}

function semONome(frase: string, nome: string): string {
  return frase.replace(regexDoNome(nome, "g"), " ");
}

function palavrasDe(texto: string): string[] {
  return texto.split(/[^a-z0-9\u00a7]+/).filter((p) => p !== "");
}

/** O objeto de um verbo: do fim do verbo ate o fim da oracao. */
function objetoDepois(frase: string, desde: number): string {
  const resto = frase.slice(desde);
  const fim = resto.search(FIM_DO_OBJETO);
  return fim === -1 ? resto : resto.slice(0, fim);
}

/**
 * O sujeito de um verbo: da ultima virgula, do ultimo "que" ou da ultima
 * conjuncao (ou do comeco) ate o verbo ("a Dra. Ana disse que o plano
 * cobre": "o plano").
 */
function sujeitoAntes(frase: string, ate: number): string {
  const antes = frase.slice(0, ate);
  let corte = -1;
  // A virgula do numero ("R$ 250,00") nao corta.
  for (const m of antes.matchAll(
    /[,;:](?=\s)|\(|\s(?:que|ou|mas|porque|pois|quando|onde)(?=\s)/g,
  )) {
    corte = Math.max(corte, (m.index ?? 0) + m[0].length - 1);
  }
  return corte === -1 ? antes : antes.slice(corte + 1);
}

type AnaliseDoObjeto = {
  /** O objeto cita convenio (palavra generica, operadora ou Cadastro). */
  citaConvenio: boolean;
  /** Palavras que nao sao nada conhecido: a operadora fora da lista. */
  desconhecidas: string[];
  /** So palavra de funcao ("Aceitamos, sim!"): o objeto e o da pergunta. */
  vazio: boolean;
};

/**
 * O que o objeto de "aceita", "atende pelo", "trabalha com" (ou o sujeito
 * de "cobre") diz de convenio. Cada item da lista ("Pix, cartao e Unimed")
 * e lido sozinho: o que comeca com meio de pagamento ou "particular" nao e
 * convenio; o nome do Cadastro, a operadora conhecida e a palavra generica
 * citam convenio; o resto que nao e palavra de funcao nem de fora
 * (NAO_E_CONVENIO) e desconhecido, e nenhum fato sustenta o desconhecido.
 */
function analisarObjeto(
  objeto: string,
  nomesDeConvenio: readonly string[],
): AnaliseDoObjeto {
  let citaConvenio = false;
  const desconhecidas: string[] = [];
  const semPlanoDeTratamento = objeto.replace(
    PLANO_QUE_NAO_E_CONVENIO,
    " \u00a7 ",
  );
  const vazio = palavrasDe(semPlanoDeTratamento).every((p) =>
    FUNCAO_NO_OBJETO.has(p),
  );
  for (const item of semPlanoDeTratamento.split(/\s*,\s*|\s+(?:e|ou)\s+/)) {
    let resto = ` ${item} `;
    let citouNoItem = false;
    for (const nome of nomesDeConvenio) {
      if (contem(resto, nome)) {
        citouNoItem = true;
        resto = semONome(resto, nome);
      }
    }
    const conteudo = palavrasDe(resto).filter((p) => !FUNCAO_NO_OBJETO.has(p));
    const primeira = conteudo[0];
    if (
      !citouNoItem &&
      primeira !== undefined &&
      (MEIOS_DE_PAGAMENTO.has(primeira) || PARTICULAR.has(primeira))
    ) {
      continue;
    }
    if (citouNoItem) {
      citaConvenio = true;
    }
    for (const palavra of conteudo) {
      if (CONVENIO_NO_OBJETO.has(palavra)) {
        citaConvenio = true;
        continue;
      }
      if (
        MEIOS_DE_PAGAMENTO.has(palavra) ||
        PARTICULAR.has(palavra) ||
        NAO_E_CONVENIO.has(palavra) ||
        palavra.includes("\u00a7") ||
        /^\d/.test(palavra) ||
        palavra.length < 3 ||
        palavra.endsWith("mente")
      ) {
        continue;
      }
      desconhecidas.push(palavra);
    }
  }
  return { citaConvenio, desconhecidas, vazio };
}

/** As palavras do objeto de "cobre" que citam procedimento ("o ultrassom"). */
function procedimentoNoObjeto(objeto: string): string[] {
  return palavrasDe(objeto).filter(
    (p) =>
      !FUNCAO_NO_OBJETO.has(p) &&
      !OBJETO_GENERICO_DE_COBRE.has(p) &&
      !CONVENIO_NO_OBJETO.has(p) &&
      !p.includes("\u00a7") &&
      !/^\d/.test(p) &&
      !p.endsWith("mente") &&
      p.length >= 3,
  );
}

function regraDaCobertura(
  base: string,
  fatos: FatosDoTurno,
  contexto: {
    nomesDoCatalogo: readonly string[];
    mensagensDoPaciente: readonly string[];
  },
): Set<string> {
  const convenios = fatos.convenios.map(normalizarConvenio);
  const coberturas = fatos.coberturas.map((c) => ({
    ...normalizarConvenio(c),
    estado: c.estado,
    procedimento:
      c.procedimento === null
        ? null
        : palavrasDe(normalizarBase(c.procedimento)),
  }));
  const nomes = [
    ...new Set(
      convenios
        .flatMap((c) => [c.nome, ...(c.plano === null ? [] : [c.plano])])
        .filter((nome) => nome.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  const alvo = `(?:${[CONVENIO_GENERICO, ...nomes.map(escaparRegex)].join("|")})(?![a-z0-9])`;
  const citaConvenio = new RegExp(`(?<![a-z0-9])${alvo}`);
  const nomesDeConvenio = [...new Set([...nomes, ...OPERADORAS_CONHECIDAS])]
    .filter((nome) => nome.length >= 2)
    .sort((a, b) => b.length - a.length);
  // O catalogo que nao e convenio (procedimento, profissional, clinica) fica
  // mascarado no objeto: "trabalhamos com a Limpeza de pele" nao e convenio.
  // O nome que cita convenio (do Cadastro, operadora ou palavra generica)
  // nunca e mascarado.
  const naoConvenios = contexto.nomesDoCatalogo.filter(
    (nome) => !citaConvenio.test(normalizarBase(nome)),
  );
  const procedimentos = [
    ...new Set(fatos.procedimentos.map((p) => normalizarBase(p))),
  ]
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  const pacienteFalouDeConvenio = contexto.mensagensDoPaciente.some(
    (mensagem) => {
      const lida = normalizarBase(mensagem);
      return CONVENIO_NA_MENSAGEM.test(lida) || citaConvenio.test(lida);
    },
  );

  /**
   * Os convenios que a frase cita, em grupos: cada grupo e um nome citado
   * (uma operadora do Cadastro, ou uma operadora conhecida, que vale pelos
   * convenios do Cadastro com esse nome e, fora do Cadastro, por nenhum).
   */
  const operadorasDoCadastro = [...new Set(convenios.map((c) => c.nome))]
    .filter((nome) => nome.length >= 2)
    .sort((a, b) => b.length - a.length);
  const conhecidas = [...OPERADORAS_CONHECIDAS].sort(
    (a, b) => b.length - a.length,
  );
  const citados = (frase: string): ConvenioNormalizado[][] => {
    // O nome mais comprido primeiro, e o trecho citado sai do texto: "Unimed
    // Fortaleza" nao cita tambem a "Unimed" do Cadastro.
    let resto = frase;
    const grupos: ConvenioNormalizado[][] = [];
    for (const nome of operadorasDoCadastro) {
      if (contem(resto, nome)) {
        grupos.push(convenios.filter((c) => c.nome === nome));
        resto = semONome(resto, nome);
      }
    }
    // A operadora conhecida fora do Cadastro nao tem fato nenhum (o grupo
    // vazio nunca e sustentado); dentro dele, vale pelos convenios dela.
    for (const conhecida of conhecidas) {
      if (contem(resto, conhecida)) {
        grupos.push(convenios.filter((c) => contem(c.nome, conhecida)));
        resto = semONome(resto, conhecida);
      }
    }
    return grupos;
  };

  /** Os procedimentos do Cadastro que a frase cita (o mais comprido antes). */
  const procedimentosCitados = (frase: string): string[][] => {
    let resto = frase;
    const citadosNaFrase: string[][] = [];
    for (const procedimento of procedimentos) {
      if (contem(resto, procedimento)) {
        citadosNaFrase.push(palavrasDe(procedimento));
        resto = semONome(resto, procedimento);
      }
    }
    return citadosNaFrase;
  };

  /**
   * A afirmacao tem fato? Cada convenio citado precisa de um fato com o
   * estado pedido (com o plano, quando a frase cita o plano) e, quando a
   * frase cita procedimento, do fato desse procedimento. Sem nome, o turno
   * precisa de algum fato com o estado (do procedimento citado).
   */
  const sustentada = (
    frase: string,
    estados: readonly EstadoDaCobertura[],
    mencoes: readonly string[][],
  ): boolean => {
    const candidatas = coberturas.filter((c) => estados.includes(c.estado));
    const doProcedimento = (lista: typeof candidatas) =>
      mencoes.length === 0
        ? lista.length > 0
        : mencoes.every((mencao) =>
            lista.some(
              (c) =>
                c.procedimento !== null &&
                mencao.every((palavra) => c.procedimento?.includes(palavra)),
            ),
          );
    const grupos = citados(frase);
    if (grupos.length === 0) {
      return doProcedimento(candidatas);
    }
    return grupos.every((grupo) => {
      const nomesDoGrupo = new Set(grupo.map((c) => c.nome));
      const doGrupo = candidatas.filter((c) => nomesDoGrupo.has(c.nome));
      const planosCitados = grupo
        .filter((c) => c.plano !== null && contem(frase, c.plano))
        .map((c) => c.plano);
      return doProcedimento(
        planosCitados.length === 0
          ? doGrupo
          : doGrupo.filter((c) => planosCitados.includes(c.plano)),
      );
    });
  };
  /** Sem convenio ativo no Cadastro, a negativa e verdade sem ferramenta. */
  const negativaSustentada = (frase: string, mencoes: readonly string[][]) =>
    fatos.semConvenioAtivo || sustentada(frase, ["nao_atende"], mencoes);

  const regras = new Set<string>();
  const padroes = PADROES_DE_COBERTURA.map((padrao) => ({
    padrao,
    regex: new RegExp(padrao.fonte(alvo), "g"),
  }));
  for (const { texto: frase } of frasesComPosicao(base)) {
    const doCatalogo = procedimentosCitados(frase);
    const temContextoDeConvenio =
      citaConvenio.test(frase) || pacienteFalouDeConvenio;
    if (
      temContextoDeConvenio &&
      SEM_COBERTURA.test(frase) &&
      !negativaSustentada(frase, doCatalogo)
    ) {
      regras.add("negativa_sem_fato");
    }
    const afirmar = (
      antes: string,
      alegacao: Alegacao,
      mencoes: readonly string[][],
      desconhecidas: readonly string[],
    ) => {
      if (CONDICAO_ANTES.test(antes)) {
        return;
      }
      if (NEGACAO_DO_CONVENIO.test(antes)) {
        if (
          !fatos.semConvenioAtivo &&
          (desconhecidas.length > 0 || !negativaSustentada(frase, mencoes))
        ) {
          regras.add("negativa_sem_fato");
        }
        return;
      }
      const estados: readonly EstadoDaCobertura[] =
        alegacao === "cobre" ? ["coberto"] : ["coberto", "atende"];
      if (desconhecidas.length > 0 || !sustentada(frase, estados, mencoes)) {
        regras.add(
          alegacao === "cobre" ? "cobertura_sem_fato" : "aceitacao_sem_fato",
        );
      }
    };

    // Pelo convenio citado.
    for (const { padrao, regex } of padroes) {
      for (const m of frase.matchAll(regex)) {
        afirmar(frase.slice(0, m.index ?? 0), padrao.alegacao, doCatalogo, []);
      }
    }

    // Pelo objeto: "aceitamos Bradesco", "atendemos pela Camed".
    for (const padrao of PADROES_PELO_OBJETO) {
      for (const m of frase.matchAll(padrao.regex)) {
        const inicio = m.index ?? 0;
        const objeto = mascararNomes(
          objetoDepois(frase, inicio + m[0].length),
          naoConvenios,
        );
        const analise = analisarObjeto(objeto, nomesDeConvenio);
        // "Aceitamos, sim!" respondendo a quem perguntou do convenio: o
        // objeto e o da pergunta.
        const respondeAPergunta = analise.vazio && pacienteFalouDeConvenio;
        if (!analise.citaConvenio && !respondeAPergunta) {
          if (
            padrao.objeto === "convenio" ||
            analise.desconhecidas.length === 0
          ) {
            continue;
          }
        }
        afirmar(
          frase.slice(0, inicio),
          "aceita",
          doCatalogo,
          padrao.objeto === "todo" ? analise.desconhecidas : [],
        );
      }
    }

    // "Cobre": o sujeito diz se e convenio ("O valor de R$ 300 cobre a
    // consulta" nao e); sem sujeito ("Cobre, sim") e convenio. O objeto
    // diz o procedimento ("cobre o ultrassom").
    for (const m of frase.matchAll(/\bcobrem?\b/g)) {
      const inicio = m.index ?? 0;
      const sujeito = mascararNomes(sujeitoAntes(frase, inicio), naoConvenios);
      const palavrasDoSujeito = palavrasDe(
        sujeito.replace(PLANO_QUE_NAO_E_CONVENIO, " \u00a7 "),
      );
      if (palavrasDoSujeito.some((p) => SUJEITO_QUE_NAO_E_CONVENIO.has(p))) {
        continue;
      }
      const analise = analisarObjeto(sujeito, nomesDeConvenio);
      const noObjeto = procedimentoNoObjeto(
        mascararNomes(objetoDepois(frase, inicio + m[0].length), procedimentos),
      );
      afirmar(
        frase.slice(0, inicio),
        "cobre",
        noObjeto.length === 0 ? doCatalogo : [...doCatalogo, noObjeto],
        analise.desconhecidas,
      );
    }

    // "Coberto": com convenio na frase (ou na pergunta do paciente), ou com
    // o verbo de ligacao ("o procedimento e coberto"), fora de lugar e de
    // preco.
    for (const m of frase.matchAll(COBERTO)) {
      const inicio = m.index ?? 0;
      const antes = frase.slice(0, inicio);
      if (!temContextoDeConvenio) {
        if (!VERBO_ANTES_DE_COBERTO.test(antes)) {
          continue;
        }
        const sujeito = palavrasDe(sujeitoAntes(frase, inicio));
        if (sujeito.some((p) => LUGAR_OU_PRECO_COBERTO.has(p))) {
          continue;
        }
      }
      const agente = objetoDepois(frase, inicio + m[0].length);
      const analise = /^\s*pel[oa]s?\b/.test(agente)
        ? analisarObjeto(
            agente.replace(/^\s*pel[oa]s?\b/, " "),
            nomesDeConvenio,
          )
        : { citaConvenio: false, desconhecidas: [], vazio: true };
      afirmar(antes, "cobre", doCatalogo, analise.desconhecidas);
    }

    // "Cobertura": com convenio na frase (ou na pergunta do paciente), ou
    // "tem cobertura".
    for (const m of frase.matchAll(COBERTURA)) {
      const antes = frase.slice(0, m.index ?? 0);
      if (!temContextoDeConvenio && !TER_COBERTURA.test(antes)) {
        continue;
      }
      afirmar(antes, "cobre", doCatalogo, []);
    }
  }
  return regras;
}

// ---------------------------------------------------------------------------
// A regra
// ---------------------------------------------------------------------------

function semTextosColados(
  rascunho: string,
  colados: readonly string[],
): string {
  let texto = rascunho;
  for (const colado of colados) {
    const limpo = colado.trim();
    if (limpo !== "") {
      texto = texto.split(limpo).join("\n");
    }
  }
  return texto;
}

/**
 * As regras dos fatos no rascunho. Devolve os achados (vazio = nenhuma
 * regra dos fatos achou nada; isso NAO e aprovacao).
 */
export function regrasDosFatos(
  rascunho: string,
  contexto: {
    fatos: FatosDoTurno;
    nomesDoCatalogo: readonly string[];
    mensagensDoPaciente: readonly string[];
  },
): AchadoDosFatos[] {
  const { fatos } = contexto;
  const achados: AchadoDosFatos[] = [];
  const base = normalizarBase(semTextosColados(rascunho, fatos.textosColados));
  const mascarada = mascararNomes(base, contexto.nomesDoCatalogo);
  const frases = frasesComPosicao(mascarada);

  // Data e hora. A ferramenta e o texto publicado valem em qualquer frase;
  // a mensagem nova do paciente, so na que nega ou pergunta.
  const doRascunho = temporaisDoTexto(mascarada, "rascunho");
  if (doRascunho.length > 0) {
    const ler = (textos: readonly string[]) => {
      const lidos = textos.map((texto) =>
        datasEHorasDoTexto(normalizarBase(texto), "fonte"),
      );
      return {
        datas: lidos.flatMap((l) => l.datas),
        horas: new Set(lidos.flatMap((l) => l.horas)),
      };
    };
    const fortes = ler([
      ...fatos.saidasDasFerramentas,
      ...fatos.horariosLivres.map((h) => `${h.dia} ${h.hora}`),
      ...fatos.textosPublicados,
    ]);
    const doPaciente = ler(contexto.mensagensDoPaciente);
    const naFonte = (
      lido: TemporalLido,
      fonte: { datas: DataLida[]; horas: Set<string> },
    ) =>
      lido.tipo === "data"
        ? dataNosFatos(lido.data, fonte.datas, fatos.anoCorrente)
        : fonte.horas.has(lido.hora);
    const vale = (lido: TemporalLido) => {
      if (naFonte(lido, fortes)) {
        return true;
      }
      const frase = fraseNoIndice(frases, lido.indice);
      return (
        frase !== undefined &&
        aceitaODitoPeloPaciente(frase) &&
        naFonte(lido, doPaciente)
      );
    };
    const foraDosFatos = doRascunho.filter((lido) => !vale(lido));
    if (foraDosFatos.some((lido) => lido.tipo === "data")) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "data_fora_dos_fatos",
      });
    }
    if (foraDosFatos.some((lido) => lido.tipo === "hora")) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "hora_fora_dos_fatos",
      });
    }
  }

  // Horario livre: so com o horario livre da ferramenta, em par.
  const livres = fatos.horariosLivres
    .map((h) => horarioLivreLido(h, fatos.anoCorrente))
    .filter((h): h is HorarioLivreLido => h !== null);
  // A oferta de horario sem dia nem hora passa para a frase seguinte
  // ("Tenho estes horarios com a Dra. Ana. Terca as 14h ou quarta as 9h.").
  // So a que fala de agenda: "Temos sim, na rua ao lado" nao passa.
  let ofertaAnterior = false;
  const semFerramenta = frases.some((frase) => {
    const afirmaAqui = afirmaHorarioLivre(frase.texto);
    const afirma =
      afirmaAqui || (ofertaAnterior && !NEGACAO_NA_FRASE.test(frase.texto));
    if (!afirma) {
      ofertaAnterior = false;
      return false;
    }
    const pares = paresDaOferta(partesDaOferta(mascarada, frase, fatos.hoje));
    ofertaAnterior =
      pares.length === 0 && afirmaAqui && FALA_DE_AGENDA.test(frase.texto);
    return pares.some(
      (par) => !livres.some((livre) => parNoHorarioLivre(par, livre)),
    );
  });
  if (semFerramenta) {
    achados.push({
      categoria: "horario_nao_verificado",
      regra: "horario_livre_sem_ferramenta",
    });
  }

  // Endereco. Na fonte, a pontuacao do JSON da ferramenta vira espaco
  // ('"endereco":"Rua X, 100"' e '"logradouro":"Rua X","numero":"100"').
  const enderecos = enderecosDoTexto(base);
  if (enderecos.length > 0) {
    const dosFatos = enderecosDasFontes([
      ...fatos.saidasDasFerramentas,
      ...fatos.textosPublicados,
    ]);
    if (enderecos.some((e) => !enderecoNosFatos(e, dosFatos))) {
      achados.push({
        categoria: "endereco_nao_verificado",
        regra: "endereco_fora_dos_fatos",
      });
    }
  }

  // Acao e estado da consulta. O diminutivo e o participio ("ficou
  // agendadinho").
  const acoes = new Set(fatos.acoes);
  const acoesSemFerramenta = new Set<string>();
  const semDiminutivo = mascarada.replace(PARTICIPIO_NO_DIMINUTIVO, "$1$2");
  for (const padrao of PADROES_DE_ACAO) {
    for (const m of semDiminutivo.matchAll(padrao.regex)) {
      const inicio = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
      if (negada(semDiminutivo, inicio)) {
        continue;
      }
      if (padrao.acao === null && emPergunta(semDiminutivo, inicio)) {
        continue;
      }
      const sustentada =
        padrao.acao === null
          ? fatos.consultaLida || acoes.has("marcou")
          : acoes.has(padrao.acao);
      if (!sustentada) {
        acoesSemFerramenta.add(padrao.nome);
      }
    }
  }
  for (const nome of acoesSemFerramenta) {
    achados.push({
      categoria: "acao_nao_executada",
      regra: `${nome}_sem_ferramenta`,
    });
  }

  // Convenio.
  for (const regra of regraDaCobertura(base, fatos, contexto)) {
    achados.push({ categoria: "cobertura_nao_verificada", regra });
  }

  return achados;
}

/**
 * As regras dos fatos que vivem em codigo, para a versao das regras
 * (filtro.ts) mudar quando elas mudarem.
 */
export const FONTES_DOS_FATOS: readonly string[] = [
  DATA_COM_BARRA.source,
  DATA_COM_PONTO.source,
  DATA_POR_EXTENSO.source,
  DIA_COM_HORA.source,
  DATA_QUE_E_NOME.source,
  DEPOIS_DE_DATA_QUE_NAO_E.source,
  HORA.source,
  INICIO_DE_FAIXA.source,
  MEIO_DIA.source,
  MEIA_NOITE.source,
  QUANTIDADE_DEPOIS.source,
  ANTES_DE_DURACAO.source,
  DEPOIS_DE_DURACAO.source,
  PERIODO_DEPOIS.source,
  `hora sem "as" ate ${MAIOR_HORA_QUE_E_DURACAO} e duracao`,
  // Revisao da AG2: frases, horario livre, paciente so negando ou
  // perguntando.
  [...ABREVIACOES].join(","),
  FIM_DE_FRASE.source,
  AFIRMA_HORARIO_LIVRE.source,
  VAGA_DA_AGENDA,
  ORDINAL_E_NAO_DIA.source,
  DIA_DEPOIS_DO_ORDINAL.source,
  NEGACAO_DA_OFERTA.source,
  NEGACAO_NA_FRASE.source,
  "paciente: so na frase que nega ou pergunta e nao afirma horario livre",
  DIA_DA_SEMANA.source,
  DIA_RELATIVO.source,
  DIA_SOLTO.source,
  PERIODO_DO_DIA.source,
  JSON.stringify(FAIXA_DO_PERIODO),
  ENTRE_PARTES_DA_DATA.source,
  "horario livre: pares pela ordem da frase, dia da semana da ferramenta",
  "horario livre: a oferta sem dia nem hora vale para a frase seguinte",
  FALA_DE_AGENDA.source,
  [...TIPOS_DE_LOGRADOURO].map(([de, para]) => `${de}=${para}`).join(","),
  [...LIGACOES_DO_NOME].join(","),
  [...ANTES_DO_NUMERO].join(","),
  UNIDADE_DEPOIS_DO_NUMERO.source,
  `nome ate ${MAXIMO_DE_PALAVRAS_DO_NOME}`,
  // Revisao da AG2: o endereco da ferramenta fora das vedacoes clinicas.
  "endereco da ferramenta: campo endereco inteiro e logradouro com numero",
  PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR.join(","),
  ...PADROES_DE_ACAO.map(
    (p) => `${p.nome} ${p.acao ?? "estado"} ${p.regex.source}`,
  ),
  NEGACAO_ANTES.source,
  PARTICIPIO_NO_DIMINUTIVO.source,
  RESERVA_QUE_E_REGRA,
  CONVENIO_GENERICO,
  DETERMINANTES,
  ...PADROES_DE_COBERTURA.map(
    (p) => `${p.nome} ${p.alegacao} ${p.fonte("ALVO")}`,
  ),
  ...PADROES_PELO_OBJETO.map((p) => `${p.nome} ${p.objeto} ${p.regex.source}`),
  FIM_DO_OBJETO.source,
  [...FUNCAO_NO_OBJETO].join(","),
  [...MEIOS_DE_PAGAMENTO].join(","),
  [...PARTICULAR].join(","),
  [...NAO_E_CONVENIO].join(","),
  [...CONVENIO_NO_OBJETO].join(","),
  PLANO_QUE_NAO_E_CONVENIO.source,
  [...SUJEITO_QUE_NAO_E_CONVENIO].join(","),
  [...LUGAR_OU_PRECO_COBERTO].join(","),
  [...OBJETO_GENERICO_DE_COBRE].join(","),
  COBERTO.source,
  COBERTURA.source,
  VERBO_ANTES_DE_COBERTO.source,
  TER_COBERTURA.source,
  CONVENIO_NA_MENSAGEM.source,
  "convenio: procedimento citado so com o fato do procedimento",
  "convenio: objeto vazio com a pergunta do paciente sobre convenio",
  "convenio: sem convenio ativo, a negativa passa",
  NEGACAO_DO_CONVENIO.source,
  CONDICAO_ANTES.source,
  SEM_COBERTURA.source,
];
