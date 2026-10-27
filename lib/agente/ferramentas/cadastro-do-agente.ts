// O Cadastro que as consultas do agente de IA leem (AG2, 27/10/2026): as
// unidades (endereco montado num campo so, horario de funcionamento em texto
// curto e os textos ao paciente), o que cada procedimento exige do paciente
// (procedure_requirement), a matriz de vinculos ATIVOS (so ids, nunca
// preco), quem atende em cada unidade (pela jornada, so a unidade, nunca a
// hora), os convenios de cada profissional (professional_insurance) e a
// idade atendida. PURO: o servidor carrega as linhas (lib/agente/contexto.ts)
// com o clinic_id explicito e as colunas explicitas; nada daqui le o banco
// nem a rede.
//
// Regras:
//  - Nada de paciente: so Cadastro (LGPD). Nada daqui vai para log, so a
//    contagem do que ficou de fora.
//  - Nunca CEP, telefone, link do mapa nem o `address` de texto livre: o
//    filtro de saida barra os tres primeiros, e o texto livre nunca passou
//    pelas regras. O endereco e montado dos campos estruturados, num campo
//    so ("Av. Santos Dumont, 1500, sala 302, Aldeota, Fortaleza, CE"), para a
//    regra de endereco dos fatos do turno reconhecer o logradouro com o
//    numero (lib/domain/conformidade/fatos-do-turno.ts).
//  - Todo texto que pode ir ao paciente (o endereco montado, o ponto de
//    referencia, o estacionamento, a acessibilidade, a observacao e o texto
//    do requisito) passa de novo pelas regras deterministicas do filtro
//    (problemaNoTextoDoAgente): e a segunda trava, depois da tela de
//    Cadastros, para um texto gravado direto no banco. O que nao passa fica
//    de fora e so conta (descartados).
//  - Preparo clinico nunca entra: procedure.prep_instructions nem e lido
//    (decisao D-4, opcao A: jejum e cuidados continuam com a equipe).
//  - A faixa de jornada sem unidade (unit_id nulo) vale para QUALQUER
//    unidade, como na Agenda e no cadastro do profissional ("Qualquer
//    unidade").

import { problemaNoTextoDoAgente } from "@/lib/domain/agente/config";
import {
  descricaoDoRequisito,
  ehTipoDeRequisito,
  lerHorarioDeFuncionamento,
  TIPOS_DE_REQUISITO,
  type DiaDoHorario,
  type FaixaDeFuncionamento,
  type HorarioDeFuncionamento,
  type TipoDeRequisito,
} from "@/lib/domain/cadastro-para-o-agente";

import type { CatalogoDoAgente, VinculoDoAgente } from "./buscar-procedimento";

// ---------------------------------------------------------------------------
// O que o catalogo guarda
// ---------------------------------------------------------------------------

/** Uma unidade ATIVA da clinica, com o codigo curto (u1, u2...) do modelo. */
export type UnidadeDoAgente = {
  codigo: string;
  id: string;
  nome: string;
  /**
   * O endereco montado num campo so, sem CEP ("Av. Santos Dumont, 1500,
   * sala 302, Aldeota, Fortaleza, CE"). Nulo sem logradouro, ou quando o
   * texto montado nao passa nas regras do filtro.
   */
  endereco: string | null;
  referencia: string | null;
  estacionamento: string | null;
  acessibilidade: string | null;
  observacao: string | null;
  /**
   * Uma linha por grupo de dias seguidos com as mesmas faixas, de segunda a
   * domingo ("segunda a sexta: 08:00 às 18:00", "domingo: fechado"). Nulo =
   * horario nao informado.
   */
  horario: string[] | null;
};

/** Um requisito ATIVO de um procedimento (o que o paciente precisa). */
export type RequisitoDoAgente = {
  procedimentoId: string;
  /** Nulo: vale para todos (particular e qualquer convenio). */
  convenioId: string | null;
  tipo: TipoDeRequisito;
  /** Minutos (chegar antes) ou anos (idade minima); nulo nos outros. */
  valor: number | null;
  /** O texto ao paciente, saneado; nulo sem texto (ou descartado). */
  texto: string | null;
};

/**
 * Um vinculo ATIVO da matriz (procedimento, profissional e convenio), so com
 * ids: de qualquer procedimento ativo, com ou sem "IA pode agendar". Diz quem
 * faz o que e por qual convenio; nunca preco.
 */
export type VinculoDaMatriz = {
  procedimentoId: string;
  profissionalId: string;
  /** Nulo: particular. */
  convenioId: string | null;
};

/**
 * Onde o profissional atende, pela jornada (professional_schedule): so a
 * unidade, nunca a hora. Unidade nula = qualquer unidade.
 */
export type JornadaDaUnidade = {
  profissionalId: string;
  unidadeId: string | null;
};

/** O convenio que o profissional atende (professional_insurance). */
export type ConvenioDoProfissional = {
  profissionalId: string;
  convenioId: string;
};

// ---------------------------------------------------------------------------
// As linhas cruas do banco (contexto.ts le com colunas explicitas)
// ---------------------------------------------------------------------------

/** unit: nunca cep, phone, link_do_mapa nem address. */
export type LinhaDaUnidade = {
  id: string;
  name: string;
  active?: boolean;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  referencia?: string | null;
  estacionamento?: string | null;
  acessibilidade?: string | null;
  horario_de_funcionamento?: unknown;
  observacao_ao_paciente?: string | null;
};

/** professional_schedule: so o profissional e a unidade. */
export type LinhaDaJornada = {
  professional_id: string;
  unit_id: string | null;
};

/** procedure_requirement (os ativos). */
export type LinhaDoRequisito = {
  procedure_id: string;
  insurance_id: string | null;
  tipo: string;
  valor_inteiro: number | null;
  texto_ao_paciente: string | null;
  ativo?: boolean;
};

/** professional_insurance. */
export type LinhaDoConvenioDoProfissional = {
  professional_id: string;
  insurance_id: string;
};

// ---------------------------------------------------------------------------
// Texto que vai ao paciente
// ---------------------------------------------------------------------------

/** Teto do nome da unidade que vai ao modelo. */
export const LIMITE_DO_NOME_DA_UNIDADE = 80;

/** Numa linha, sem sinal de bloco ("<", ">", marcador duplo) e aparado. */
function numaLinhaSoh(texto: string): string {
  return texto
    .replace(/[\r\n\u2028\u2029\u0085\v\f]+/g, " ")
    .replace(/<{2,}|>{2,}/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Um texto do Cadastro que pode ir ao paciente: numa linha e aparado, e so
 * se passar nas regras deterministicas do filtro de saida (o mesmo
 * problemaNoTextoDoAgente da tela). Vazio: sem texto, sem descarte. O que
 * nao passa: nulo e `descartado` (so a contagem vai para log).
 */
export function textoAoPacienteParaOAgente(valor: unknown): {
  texto: string | null;
  descartado: boolean;
} {
  if (typeof valor !== "string") {
    return { texto: null, descartado: false };
  }
  const limpo = numaLinhaSoh(valor);
  if (limpo === "") {
    return { texto: null, descartado: false };
  }
  return problemaNoTextoDoAgente(limpo, "resposta") === null
    ? { texto: limpo, descartado: false }
    : { texto: null, descartado: true };
}

/**
 * O endereco montado dos campos estruturados, num campo so e sem CEP:
 * logradouro, numero, complemento, bairro, cidade e UF, separados por
 * virgula, so com o que foi preenchido. Sem logradouro nao ha endereco.
 */
export function enderecoMontado(unidade: LinhaDaUnidade): string | null {
  const parte = (valor: unknown) =>
    typeof valor === "string" ? numaLinhaSoh(valor) : "";
  const logradouro = parte(unidade.logradouro);
  if (logradouro === "") {
    return null;
  }
  return [
    logradouro,
    parte(unidade.numero),
    parte(unidade.complemento),
    parte(unidade.bairro),
    parte(unidade.cidade),
    parte(unidade.uf),
  ]
    .filter((p) => p !== "")
    .join(", ");
}

// ---------------------------------------------------------------------------
// Horario de funcionamento em texto curto
// ---------------------------------------------------------------------------

/** De segunda a domingo (o jeito de falar), com a chave do jsonb. */
const DIAS_DE_SEGUNDA_A_DOMINGO: readonly DiaDoHorario[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "0",
];

const NOME_DO_DIA: Readonly<Record<DiaDoHorario, string>> = {
  "0": "domingo",
  "1": "segunda",
  "2": "terça",
  "3": "quarta",
  "4": "quinta",
  "5": "sexta",
  "6": "sábado",
};

/** O texto do dia fechado e o que liga as faixas e os dias. */
export const FRASES_DO_HORARIO = {
  fechado: "fechado",
  ate: "às",
} as const;

function faixasDoDia(faixas: readonly FaixaDeFuncionamento[]): string {
  if (faixas.length === 0) {
    return FRASES_DO_HORARIO.fechado;
  }
  const partes = faixas.map(
    (faixa) => `${faixa.inicio} ${FRASES_DO_HORARIO.ate} ${faixa.fim}`,
  );
  return partes.length === 1
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function rotuloDosDias(dias: readonly DiaDoHorario[]): string {
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  if (primeiro === undefined || ultimo === undefined) {
    return "";
  }
  if (dias.length === 1) {
    return NOME_DO_DIA[primeiro];
  }
  if (dias.length === 2) {
    return `${NOME_DO_DIA[primeiro]} e ${NOME_DO_DIA[ultimo]}`;
  }
  return `${NOME_DO_DIA[primeiro]} a ${NOME_DO_DIA[ultimo]}`;
}

/**
 * O horario de funcionamento em linhas curtas, de segunda a domingo: os
 * dias SEGUIDOS com as mesmas faixas viram uma linha ("segunda a sexta:
 * 08:00 às 12:00 e 14:00 às 18:00"); o dia sem faixa e "fechado" (dia
 * fechado = chave ausente no jsonb). As horas saem em HH:MM, como no
 * Cadastro: sao os fatos de hora do turno.
 */
export function horarioEmTexto(horario: HorarioDeFuncionamento): string[] {
  const linhas: string[] = [];
  let grupo: { dias: DiaDoHorario[]; texto: string } | null = null;
  for (const dia of DIAS_DE_SEGUNDA_A_DOMINGO) {
    const texto = faixasDoDia(horario[dia] ?? []);
    if (grupo !== null && grupo.texto === texto) {
      grupo.dias.push(dia);
      continue;
    }
    if (grupo !== null) {
      linhas.push(`${rotuloDosDias(grupo.dias)}: ${grupo.texto}`);
    }
    grupo = { dias: [dia], texto };
  }
  if (grupo !== null) {
    linhas.push(`${rotuloDosDias(grupo.dias)}: ${grupo.texto}`);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Montagem (contexto.ts carrega as linhas; montarCatalogoDoAgente chama)
// ---------------------------------------------------------------------------

function porNomeEId<T extends { nome: string; id: string }>(a: T, b: T) {
  return a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);
}

/**
 * As unidades ATIVAS, por nome (e id), com o codigo u1, u2... O nome entra
 * numa linha, ate 80 caracteres; a unidade cujo nome nao passa nas regras do
 * filtro (telefone, link, promessa) fica de fora inteira e conta. O endereco
 * montado e os textos ao paciente que nao passam ficam nulos e contam.
 */
export function unidadesParaOAgente(linhas: readonly LinhaDaUnidade[]): {
  unidades: UnidadeDoAgente[];
  descartados: number;
} {
  let descartados = 0;
  const texto = (valor: unknown): string | null => {
    const lido = textoAoPacienteParaOAgente(valor);
    if (lido.descartado) {
      descartados += 1;
    }
    return lido.texto;
  };
  const prontas: Omit<UnidadeDoAgente, "codigo">[] = [];
  for (const linha of linhas) {
    if (linha.active === false || typeof linha.id !== "string") {
      continue;
    }
    const nome = Array.from(numaLinhaSoh(linha.name ?? ""))
      .slice(0, LIMITE_DO_NOME_DA_UNIDADE)
      .join("")
      .trim();
    if (nome === "") {
      continue;
    }
    if (problemaNoTextoDoAgente(nome, "resposta") !== null) {
      descartados += 1;
      continue;
    }
    const horario = lerHorarioDeFuncionamento(
      linha.horario_de_funcionamento ?? null,
    );
    prontas.push({
      id: linha.id,
      nome,
      endereco: texto(enderecoMontado(linha)),
      referencia: texto(linha.referencia),
      estacionamento: texto(linha.estacionamento),
      acessibilidade: texto(linha.acessibilidade),
      observacao: texto(linha.observacao_ao_paciente),
      horario: horario === null ? null : horarioEmTexto(horario),
    });
  }
  return {
    unidades: prontas
      .sort(porNomeEId)
      .map((u, indice) => ({ codigo: `u${indice + 1}`, ...u })),
    descartados,
  };
}

/** Os limites do valor de cada tipo (os mesmos do CHECK do banco). */
const FAIXA_DO_VALOR: Readonly<
  Partial<Record<TipoDeRequisito, readonly [number, number]>>
> = {
  chegar_antes_minutos: [1, 480],
  idade_minima: [1, 120],
};

function valorDoRequisito(
  tipo: TipoDeRequisito,
  valor: unknown,
): number | null | undefined {
  const faixa = FAIXA_DO_VALOR[tipo];
  if (faixa === undefined) {
    return valor === null || valor === undefined ? null : undefined;
  }
  return typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= faixa[0] &&
    valor <= faixa[1]
    ? valor
    : undefined;
}

/**
 * Os requisitos ATIVOS de procedimento ativo, para todos ou de um convenio
 * ATIVO, na ordem dos tipos (e do texto). Fora do formato (tipo fora da
 * lista, numero incoerente) fica de fora e conta; o texto que nao passa nas
 * regras sai do requisito e conta; o "outro" sem texto valido fica de fora
 * inteiro (o texto e o requisito).
 */
export function requisitosParaOAgente(
  linhas: readonly LinhaDoRequisito[],
  ativos: {
    procedimentos: ReadonlySet<string>;
    convenios: ReadonlySet<string>;
  },
): { requisitos: RequisitoDoAgente[]; descartados: number } {
  let descartados = 0;
  const requisitos: RequisitoDoAgente[] = [];
  for (const linha of linhas) {
    if (
      linha.ativo === false ||
      !ativos.procedimentos.has(linha.procedure_id) ||
      (linha.insurance_id !== null && !ativos.convenios.has(linha.insurance_id))
    ) {
      continue;
    }
    if (!ehTipoDeRequisito(linha.tipo)) {
      descartados += 1;
      continue;
    }
    const valor = valorDoRequisito(linha.tipo, linha.valor_inteiro);
    if (valor === undefined) {
      descartados += 1;
      continue;
    }
    const lido = textoAoPacienteParaOAgente(linha.texto_ao_paciente);
    if (lido.descartado) {
      descartados += 1;
    }
    if (linha.tipo === "outro" && lido.texto === null) {
      continue;
    }
    requisitos.push({
      procedimentoId: linha.procedure_id,
      convenioId: linha.insurance_id,
      tipo: linha.tipo,
      valor,
      texto: lido.texto,
    });
  }
  const ordem = (tipo: TipoDeRequisito) => TIPOS_DE_REQUISITO.indexOf(tipo);
  requisitos.sort(
    (a, b) =>
      a.procedimentoId.localeCompare(b.procedimentoId) ||
      (a.convenioId ?? "").localeCompare(b.convenioId ?? "") ||
      ordem(a.tipo) - ordem(b.tipo) ||
      (a.texto ?? "").localeCompare(b.texto ?? "", "pt-BR"),
  );
  return { requisitos, descartados };
}

/**
 * As faixas de jornada de profissional ATIVO, so com a unidade: a de unidade
 * nula vale para qualquer unidade; a de unidade que nao esta entre as ativas
 * do agente fica de fora. Sem repetir.
 */
export function jornadasParaOAgente(
  linhas: readonly LinhaDaJornada[],
  ativos: {
    profissionais: ReadonlySet<string>;
    unidades: ReadonlySet<string>;
  },
): JornadaDaUnidade[] {
  const vistas = new Set<string>();
  const jornadas: JornadaDaUnidade[] = [];
  for (const linha of linhas) {
    const unidade = linha.unit_id ?? null;
    if (
      !ativos.profissionais.has(linha.professional_id) ||
      (unidade !== null && !ativos.unidades.has(unidade))
    ) {
      continue;
    }
    const chave = `${linha.professional_id}|${unidade ?? ""}`;
    if (vistas.has(chave)) {
      continue;
    }
    vistas.add(chave);
    jornadas.push({
      profissionalId: linha.professional_id,
      unidadeId: unidade,
    });
  }
  return jornadas;
}

/** Os convenios ATIVOS de profissional ATIVO, sem repetir. */
export function conveniosDosProfissionaisParaOAgente(
  linhas: readonly LinhaDoConvenioDoProfissional[],
  ativos: {
    profissionais: ReadonlySet<string>;
    convenios: ReadonlySet<string>;
  },
): ConvenioDoProfissional[] {
  const vistos = new Set<string>();
  const pares: ConvenioDoProfissional[] = [];
  for (const linha of linhas) {
    const chave = `${linha.professional_id}|${linha.insurance_id}`;
    if (
      vistos.has(chave) ||
      !ativos.profissionais.has(linha.professional_id) ||
      !ativos.convenios.has(linha.insurance_id)
    ) {
      continue;
    }
    vistos.add(chave);
    pares.push({
      profissionalId: linha.professional_id,
      convenioId: linha.insurance_id,
    });
  }
  return pares;
}

/** Idade (0 a 120, inteira) ou nulo, como o CHECK do profissional. */
export function idadeValida(valor: unknown): number | null {
  return typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor <= 120
    ? valor
    : null;
}

// ---------------------------------------------------------------------------
// Leituras sobre o catalogo
// ---------------------------------------------------------------------------

/**
 * As unidades onde o profissional atende, pela jornada (a faixa sem unidade
 * vale para todas), na ordem dos codigos.
 */
export function unidadesDoProfissional(
  catalogo: Pick<CatalogoDoAgente, "unidades" | "jornadas">,
  profissionalId: string,
): UnidadeDoAgente[] {
  const unidades = catalogo.unidades ?? [];
  const daJornada = (catalogo.jornadas ?? []).filter(
    (j) => j.profissionalId === profissionalId,
  );
  if (daJornada.some((j) => j.unidadeId === null)) {
    return unidades;
  }
  const ids = new Set(daJornada.map((j) => j.unidadeId));
  return unidades.filter((u) => ids.has(u.id));
}

/** Os profissionais que atendem na unidade, pela jornada. */
export function profissionaisDaUnidade(
  catalogo: Pick<CatalogoDoAgente, "jornadas">,
  unidadeId: string,
): Set<string> {
  return new Set(
    (catalogo.jornadas ?? [])
      .filter((j) => j.unidadeId === null || j.unidadeId === unidadeId)
      .map((j) => j.profissionalId),
  );
}

/**
 * As unidades onde o procedimento e feito: as dos profissionais que o fazem
 * (a matriz de vinculos ativos, de qualquer convenio), pela jornada.
 */
export function unidadesDoProcedimento(
  catalogo: Pick<CatalogoDoAgente, "unidades" | "jornadas" | "matriz">,
  procedimentoId: string,
): UnidadeDoAgente[] {
  const quemFaz = new Set(
    (catalogo.matriz ?? [])
      .filter((v) => v.procedimentoId === procedimentoId)
      .map((v) => v.profissionalId),
  );
  const ids = new Set<string>();
  for (const profissionalId of quemFaz) {
    for (const unidade of unidadesDoProfissional(catalogo, profissionalId)) {
      ids.add(unidade.id);
    }
  }
  return (catalogo.unidades ?? []).filter((u) => ids.has(u.id));
}

/** O item do requisito como vai ao modelo ("Chegar 15 minutos antes"). */
export function itemDoRequisito(requisito: RequisitoDoAgente): string {
  return requisito.tipo === "outro"
    ? (requisito.texto ?? "")
    : descricaoDoRequisito({
        tipo: requisito.tipo,
        valor_inteiro: requisito.valor,
      });
}

/**
 * Os requisitos do procedimento: os gerais (para todos) e, com o convenio,
 * os dele.
 */
export function requisitosDoProcedimento(
  catalogo: Pick<CatalogoDoAgente, "requisitos">,
  procedimentoId: string,
  convenioId: string | null,
): { gerais: RequisitoDoAgente[]; doConvenio: RequisitoDoAgente[] } {
  const doProcedimento = (catalogo.requisitos ?? []).filter(
    (r) => r.procedimentoId === procedimentoId,
  );
  return {
    gerais: doProcedimento.filter((r) => r.convenioId === null),
    doConvenio:
      convenioId === null
        ? []
        : doProcedimento.filter((r) => r.convenioId === convenioId),
  };
}

/** Algum convenio tem requisito proprio neste procedimento. */
export function temRequisitoPorConvenio(
  catalogo: Pick<CatalogoDoAgente, "requisitos">,
  procedimentoId: string,
): boolean {
  return (catalogo.requisitos ?? []).some(
    (r) => r.procedimentoId === procedimentoId && r.convenioId !== null,
  );
}

/**
 * A idade atendida em texto curto ("de 18 a 65 anos", "a partir de 12
 * anos", "até 17 anos"), ou nulo sem nenhum limite (sem limite cadastrado:
 * nada a dizer).
 */
export function idadeAtendidaEmTexto(
  minima: number | null | undefined,
  maxima: number | null | undefined,
): string | null {
  const anos = (n: number) => (n === 1 ? "1 ano" : `${n} anos`);
  const min = idadeValida(minima);
  const max = idadeValida(maxima);
  if (min !== null && max !== null) {
    return min <= max ? `de ${min} a ${anos(max)}` : null;
  }
  if (min !== null) {
    return `a partir de ${anos(min)}`;
  }
  if (max !== null) {
    return `até ${anos(max)}`;
  }
  return null;
}

/**
 * A duracao dos vinculos (minutos): uma so para todos, ou por profissional
 * quando muda. Sem duracao conhecida: nada.
 */
export function duracaoDosVinculos(
  vinculos: readonly VinculoDoAgente[],
): Record<string, unknown> {
  const comDuracao = vinculos.filter(
    (v): v is VinculoDoAgente & { duracaoMin: number } =>
      typeof v.duracaoMin === "number" && v.duracaoMin > 0,
  );
  const duracoes = [...new Set(comDuracao.map((v) => v.duracaoMin))];
  const [unica] = duracoes;
  if (unica === undefined) {
    return {};
  }
  if (duracoes.length === 1) {
    return { duracao_min: unica };
  }
  const vistos = new Set<string>();
  const porProfissional: { profissional: string; duracao_min: number }[] = [];
  for (const v of [...comDuracao].sort(
    (a, b) =>
      a.profissional.localeCompare(b.profissional, "pt-BR") ||
      a.duracaoMin - b.duracaoMin,
  )) {
    const chave = `${v.profissional}|${v.duracaoMin}`;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      porProfissional.push({
        profissional: v.profissional,
        duracao_min: v.duracaoMin,
      });
    }
  }
  return { duracao_min_por_profissional: porProfissional };
}
