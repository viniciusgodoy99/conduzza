// Fatos do turno: o que a camada deterministica do filtro de saida aceita
// como verdade numa resposta da IA (etapa AG2, 27/10/2026). PURO, zero I/O.
//
// A regra de ouro: fato critico so vale se uma ferramenta do turno disse. O
// preco ja era assim desde o E2 (precosDoTurno, filtro-deterministico.ts);
// aqui entram as quatro categorias novas, no mesmo molde (entrada opcional:
// quando quem chama passa os fatos, a regra vale; os textos estaticos
// conferidos na publicacao da Tela 6 nao passam fatos e nao mudam):
//  - horario_nao_verificado: toda data e toda hora do rascunho tem de estar
//    nas saidas das ferramentas do turno, nos textos publicados que o modelo
//    recebe (base, instrucoes, nome da clinica, a hora na clinica) ou que vao
//    colados na resposta (saudacao, encerramento), ou nas mensagens novas do
//    paciente (para ele poder repetir "15:00 nao tenho"). Os formatos sao
//    normalizados antes de comparar ("14h", "14:00" e "as 2 da tarde" sao a
//    mesma hora; "21/10", "21/10/2026" e "21 de outubro", a mesma data).
//  - endereco_nao_verificado: logradouro com numero ("Av. Santos Dumont,
//    1500") so se veio de ferramenta do turno (as unidades da proxima etapa)
//    ou dos textos publicados. Nunca da mensagem do paciente.
//  - cobertura_nao_verificada: dizer que o convenio cobre, que e aceito ou
//    que a clinica atende por ele so com um resultado de cobertura do turno
//    (buscar_procedimento ou buscar_horario); negar tambem so com fato ("sem
//    informacao" nunca vira "nao cobre"). A base publicada NAO vale aqui: so
//    ferramenta.
//  - acao_nao_executada: dizer que marcou, reservou, confirmou, cancelou,
//    remarcou ou colocou na lista de espera so com o sucesso da ferramenta
//    correspondente neste turno. O estado de uma consulta que ja existia
//    ("sua consulta esta marcada para...") vale com a consulta lida por
//    ferramenta (confirmar_presenca) ou marcada neste turno.
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

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * O que uma ferramenta do turno disse de um convenio:
 *  - coberto: buscar_procedimento disse "coberto" para o convenio e plano;
 *  - atende: o convenio tem vinculo no procedimento (aceito), com ou sem
 *    valor (buscar_procedimento, buscar_horario);
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
};

/** O que uma ferramenta acrescenta aos fatos, alem da propria saida. */
export type FatosDaFerramenta = {
  coberturas?: readonly CoberturaDoTurno[];
  acao?: AcaoDoTurno;
  /** A ferramenta leu uma consulta que ja existia (confirmar_presenca). */
  consultaLida?: boolean;
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
    f.coberturas.every(
      (c) =>
        convenioValido(c) &&
        (ESTADOS_DA_COBERTURA as readonly unknown[]).includes(
          (c as { estado?: unknown }).estado,
        ),
    ) &&
    Array.isArray(f.acoes) &&
    f.acoes.every((a) => (ACOES_DO_TURNO as readonly unknown[]).includes(a)) &&
    typeof f.consultaLida === "boolean" &&
    typeof f.anoCorrente === "number" &&
    Number.isInteger(f.anoCorrente) &&
    f.anoCorrente >= 2000 &&
    f.anoCorrente <= 2200
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
  const datas: DataLida[] = [];
  const horas: string[] = [];
  const rascunho = modo === "rascunho";
  const antes = (indice: number) =>
    base.slice(Math.max(0, indice - 40), indice);
  const depois = (fim: number) => base.slice(fim, fim + 40);

  for (const m of base.matchAll(DATA_COM_BARRA)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const fim = (m.index ?? 0) + m[0].length;
    if (
      rascunho &&
      ((dia === 24 && mes === 7 && m[3] === undefined) ||
        DEPOIS_DE_DATA_QUE_NAO_E.test(depois(fim)))
    ) {
      continue;
    }
    if (dataValida(dia, mes)) {
      datas.push({ dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_COM_PONTO)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dataValida(dia, mes)) {
      datas.push({ dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_POR_EXTENSO)) {
    if (rascunho && DATA_QUE_E_NOME.test(antes(m.index ?? 0))) {
      continue;
    }
    const dia = Number(m[1]);
    const mes = MESES.indexOf(m[2] as (typeof MESES)[number]) + 1;
    if (dataValida(dia, mes)) {
      datas.push({ dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DIA_COM_HORA)) {
    const dia = Number(m[1]);
    if (dataValida(dia, null)) {
      datas.push({ dia, mes: null, ano: null });
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
    const lida = hora(comPeriodo(h, depoisDela), minutos);
    if (lida !== null) {
      horas.push(lida);
    }
  }
  for (const m of base.matchAll(INICIO_DE_FAIXA)) {
    const lida = hora(Number(m[1]), 0);
    if (lida !== null) {
      horas.push(lida);
    }
  }
  horas.push(...Array.from(base.matchAll(MEIO_DIA), () => "12:00"));
  horas.push(...Array.from(base.matchAll(MEIA_NOITE), () => "00:00"));
  return { datas, horas };
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

/**
 * Os logradouros com numero de um texto JA NORMALIZADO (normalizarBase, sem
 * mascara): "Av. Santos Dumont, 1500", "Rua 7 de Setembro, 45", "Rodovia
 * CE-040, km 12", "Rua X, s/n". Sem numero nao e lido: a regra e sobre o
 * endereco que leva a pessoa a uma porta.
 */
export function enderecosDoTexto(base: string): EnderecoLido[] {
  const tokens = base.split(/\s+/).filter((t) => t !== "");
  const enderecos: EnderecoLido[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tipo = TIPOS_DE_LOGRADOURO.get(nucleo(tokens[i] ?? ""));
    if (tipo === undefined) {
      continue;
    }
    const nome: string[] = [];
    let numero: string | null = null;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const anterior = tokens[j - 1] ?? "";
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
      const token = nucleo(tokens[j] ?? "");
      const seguinte = nucleo(tokens[j + 1] ?? "");
      const depoisDoSeguinte = nucleo(tokens[j + 2] ?? "");
      if (token === "") {
        continue;
      }
      if (/^(?:s\/n[o.]?|sn)$/.test(token)) {
        numero = "sn";
        break;
      }
      if (token === "km" && ehNumeroDaPorta(seguinte)) {
        numero = `km${seguinte}`;
        break;
      }
      if (ANTES_DO_NUMERO.has(token) && ehNumeroDaPorta(seguinte)) {
        numero = seguinte;
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
          /,$/.test(tokens[j] ?? "") &&
          (ehNumeroDaPorta(seguinte) ||
            (ANTES_DO_NUMERO.has(seguinte) &&
              ehNumeroDaPorta(depoisDoSeguinte)))
        ) {
          nome.push(token);
          continue;
        }
        // "1500, sala 302": com a virgula, o que vem depois e o
        // complemento. Sem ela, "300 metros" e "3 salas" sao medida.
        if (
          /,$/.test(tokens[j] ?? "") ||
          !UNIDADE_DEPOIS_DO_NUMERO.test(seguinte)
        ) {
          numero = token;
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
    if (numero !== null && nome.length > 0) {
      enderecos.push({ tipo, nome, numero });
    }
  }
  return enderecos;
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
    "(?:^|[.!?]\\s*)confirmad[oa]s?\\b",
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
  // consulta amanha?" pergunta, nao afirma). Sem "horario" e "vaga": "voce
  // tem horario amanha" e oferta.
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA}\\s+(?:\\S+\\s+){0,6}?${alternativas(ESTA)}\\s+(?:\\w+\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA}\\s+(?:marcad|agendad)[oa]s?\\s+(?:para|pra|no|na|em|dia|as|amanha|hoje)\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?tem\\s+(?:uma\\s+)?${CONSULTA}\\s+(?:marcad[oa]|agendad[oa]|amanha|hoje|depois de amanha|na\\b|no\\b|dia\\b|as\\b|para\\b|pra\\b)`,
  ),
];

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
 * As palavras genericas que apontam convenio e as operadoras nacionais mais
 * comuns: so para RECONHECER a afirmacao ("aceitamos Hapvida" com a Hapvida
 * fora do Cadastro tambem precisa de fato). Nao e dado de clinica nenhuma e
 * nunca libera nada; os nomes do Cadastro entram pelos fatos.
 */
const OPERADORAS_CONHECIDAS = [
  "unimed",
  "bradesco saude",
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

const PADROES_DE_COBERTURA: readonly PadraoDeCobertura[] = [
  { nome: "cobre", alegacao: "cobre", fonte: () => "\\bcobrem?\\b" },
  {
    // "Estacionamento coberto" e lugar, nao convenio.
    nome: "coberto",
    alegacao: "cobre",
    fonte: () =>
      "(?<!\\b(?:estacionamento|garagem|vagas?|local|area|espaco|lugar|patio|corredor|acesso|ponto)\\s(?:\\S+\\s){0,2})\\bcobert[oa]s?\\b",
  },
  {
    // "Na cobertura do predio" e o andar; "sem cobertura" e "fora da
    // cobertura" sao a negativa (SEM_COBERTURA).
    nome: "cobertura",
    alegacao: "cobre",
    fonte: () =>
      "(?<!\\b(?:na|sem|fora da|fora de)\\s)\\bcobertura\\b(?!\\s+d[oa]\\s+(?:predio|edificio|shopping|torre|bloco))",
  },
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
    nome: "aceita",
    alegacao: "aceita",
    fonte: (alvo) => `\\baceit(?:a|am|amos|o)\\b(?:\\s+\\S+){0,3}?\\s+${alvo}`,
  },
  {
    nome: "atende_pelo",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b(?:atende|atendem|atendemos|atendo)\\b(?:\\s+\\S+){0,3}?\\s+(?:pel[oa]s?|por|com)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "atende_o",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b(?:atende|atendem|atendemos|atendo)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "trabalha_com",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\btrabalh(?:a|am|amos|o)\\s+com\\s+${DETERMINANTES}${alvo}`,
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
  /\b(?:sem cobertura|fora da (?:cobertura|rede)|nao (?:faz|fazem) parte da (?:rede|cobertura))\b/g;

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

/**
 * As frases do texto normalizado. O ponto so fecha a frase depois de
 * palavra comprida ou numero: "Av." e "Dr." nao quebram.
 */
function frasesDe(base: string): string[] {
  return base
    .split(/(?<=[!?;\n])\s*|(?<=[a-z]{5}|\d)\.\s+/)
    .map((frase) => frase.trim())
    .filter((frase) => frase !== "");
}

function regraDaCobertura(base: string, fatos: FatosDoTurno): Set<string> {
  const convenios = fatos.convenios.map(normalizarConvenio);
  const coberturas = fatos.coberturas.map((c) => ({
    ...normalizarConvenio(c),
    estado: c.estado,
  }));
  const nomes = [
    ...new Set(
      convenios
        .flatMap((c) => [c.nome, ...(c.plano === null ? [] : [c.plano])])
        .filter((nome) => nome.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  const alvo = `(?:${[CONVENIO_GENERICO, ...nomes.map(escaparRegex)].join("|")})(?![a-z0-9])`;

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

  /**
   * A afirmacao tem fato? Cada convenio citado precisa de um fato com o
   * estado pedido (com o plano, quando a frase cita o plano). Sem nome, o
   * turno precisa de algum fato com o estado.
   */
  const sustentada = (
    frase: string,
    estados: readonly EstadoDaCobertura[],
  ): boolean => {
    const candidatas = coberturas.filter((c) => estados.includes(c.estado));
    const grupos = citados(frase);
    if (grupos.length === 0) {
      return candidatas.length > 0;
    }
    return grupos.every((grupo) => {
      const nomes = new Set(grupo.map((c) => c.nome));
      const doGrupo = candidatas.filter((c) => nomes.has(c.nome));
      const planosCitados = grupo
        .filter((c) => c.plano !== null && contem(frase, c.plano))
        .map((c) => c.plano);
      return planosCitados.length === 0
        ? doGrupo.length > 0
        : doGrupo.some((c) => planosCitados.includes(c.plano));
    });
  };

  const regras = new Set<string>();
  const padroes = PADROES_DE_COBERTURA.map((padrao) => ({
    padrao,
    regex: new RegExp(padrao.fonte(alvo), "g"),
  }));
  for (const frase of frasesDe(base)) {
    if (SEM_COBERTURA.test(frase) && !sustentada(frase, ["nao_atende"])) {
      regras.add("negativa_sem_fato");
    }
    SEM_COBERTURA.lastIndex = 0;
    for (const { padrao, regex } of padroes) {
      for (const m of frase.matchAll(regex)) {
        const antes = frase.slice(0, m.index ?? 0);
        if (CONDICAO_ANTES.test(antes)) {
          continue;
        }
        if (NEGACAO_DO_CONVENIO.test(antes)) {
          if (!sustentada(frase, ["nao_atende"])) {
            regras.add("negativa_sem_fato");
          }
          continue;
        }
        const estados: readonly EstadoDaCobertura[] =
          padrao.alegacao === "cobre" ? ["coberto"] : ["coberto", "atende"];
        if (!sustentada(frase, estados)) {
          regras.add(
            padrao.alegacao === "cobre"
              ? "cobertura_sem_fato"
              : "aceitacao_sem_fato",
          );
        }
      }
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

  // Data e hora.
  const doRascunho = datasEHorasDoTexto(mascarada, "rascunho");
  if (doRascunho.datas.length > 0 || doRascunho.horas.length > 0) {
    const fontes = [
      ...fatos.saidasDasFerramentas,
      ...fatos.textosPublicados,
      ...contexto.mensagensDoPaciente,
    ].map((texto) => datasEHorasDoTexto(normalizarBase(texto), "fonte"));
    const datas = fontes.flatMap((f) => f.datas);
    const horas = new Set(fontes.flatMap((f) => f.horas));
    if (
      doRascunho.datas.some(
        (data) => !dataNosFatos(data, datas, fatos.anoCorrente),
      )
    ) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "data_fora_dos_fatos",
      });
    }
    if (doRascunho.horas.some((h) => !horas.has(h))) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "hora_fora_dos_fatos",
      });
    }
  }

  // Endereco. Na fonte, a pontuacao do JSON da ferramenta vira espaco
  // ('"endereco":"Rua X, 100"' e '"logradouro":"Rua X","numero":"100"').
  const enderecos = enderecosDoTexto(base);
  if (enderecos.length > 0) {
    const dosFatos = [
      ...fatos.saidasDasFerramentas,
      ...fatos.textosPublicados,
    ].flatMap((texto) =>
      enderecosDoTexto(normalizarBase(texto.replace(/["{}[\]:]/g, " "))),
    );
    if (enderecos.some((e) => !enderecoNosFatos(e, dosFatos))) {
      achados.push({
        categoria: "endereco_nao_verificado",
        regra: "endereco_fora_dos_fatos",
      });
    }
  }

  // Acao e estado da consulta.
  const acoes = new Set(fatos.acoes);
  const semFerramenta = new Set<string>();
  for (const padrao of PADROES_DE_ACAO) {
    for (const m of mascarada.matchAll(padrao.regex)) {
      const inicio = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
      if (negada(mascarada, inicio)) {
        continue;
      }
      if (padrao.acao === null && emPergunta(mascarada, inicio)) {
        continue;
      }
      const sustentada =
        padrao.acao === null
          ? fatos.consultaLida || acoes.has("marcou")
          : acoes.has(padrao.acao);
      if (!sustentada) {
        semFerramenta.add(padrao.nome);
      }
    }
  }
  for (const nome of semFerramenta) {
    achados.push({
      categoria: "acao_nao_executada",
      regra: `${nome}_sem_ferramenta`,
    });
  }

  // Convenio.
  for (const regra of regraDaCobertura(base, fatos)) {
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
  [...TIPOS_DE_LOGRADOURO].map(([de, para]) => `${de}=${para}`).join(","),
  [...LIGACOES_DO_NOME].join(","),
  [...ANTES_DO_NUMERO].join(","),
  UNIDADE_DEPOIS_DO_NUMERO.source,
  `nome ate ${MAXIMO_DE_PALAVRAS_DO_NOME}`,
  ...PADROES_DE_ACAO.map(
    (p) => `${p.nome} ${p.acao ?? "estado"} ${p.regex.source}`,
  ),
  NEGACAO_ANTES.source,
  RESERVA_QUE_E_REGRA,
  CONVENIO_GENERICO,
  DETERMINANTES,
  ...PADROES_DE_COBERTURA.map(
    (p) => `${p.nome} ${p.alegacao} ${p.fonte("ALVO")}`,
  ),
  NEGACAO_DO_CONVENIO.source,
  CONDICAO_ANTES.source,
  SEM_COBERTURA.source,
];
