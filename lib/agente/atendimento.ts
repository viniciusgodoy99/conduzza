// O estado do atendimento da IA entre os turnos (AG3, 27/10/2026). PURO,
// zero I/O: a forma do estado (o espelho de ia_estado_do_atendimento_valido,
// migration 20261027120000_agendamento_completo_da_ia.sql), a leitura
// defensiva das respostas de ler_atendimento_da_ia e gravar_atendimento_da_ia,
// os horarios oferecidos que valem de uma mensagem para a outra, os dados que
// faltam para marcar, a pergunta "Confirma ...?", as falhas seguidas e a nota
// para a equipe na passagem.
//
// Quem le e grava e o servidor (lib/agente/atendimento-no-banco.ts, pelas
// RPCs, no WhatsApp; o simulador guarda o estado no historico assinado, sem
// gravar nada). O turno (lib/agente/laco.ts e ferramentas/agenda-do-turno.ts)
// parte do estado lido e devolve o estado novo.
//
// LGPD: o estado nunca tem texto do paciente nem dado pessoal. So listas
// fechadas, ids do Cadastro, instantes e booleanos. Os dados que o paciente
// informou ficam em dados_informados_na_marcacao; aqui so chega SE foram
// informados (nunca o valor) e o que falta.

import { datasEHorasDoTexto } from "@/lib/domain/conformidade/fatos-do-turno";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";

import type { CatalogoDoAgente } from "./ferramentas/buscar-procedimento";
import { CABECALHO_DA_NOTA_DA_PASSAGEM } from "./nota-da-passagem";

// ---------------------------------------------------------------------------
// Listas fechadas (as do CHECK de ia_atendimento)
// ---------------------------------------------------------------------------

export const ETAPAS_DO_ATENDIMENTO = [
  "informacao",
  "escolha",
  "oferta",
  "aguardando_confirmacao",
  "pos_marcacao",
  "remarcar",
  "cancelar",
] as const;
export type EtapaDoAtendimento = (typeof ETAPAS_DO_ATENDIMENTO)[number];

export const INTENCOES_DO_ATENDIMENTO = [
  "informacao",
  "agendar",
  "remarcar",
  "cancelar",
  "confirmar",
] as const;
export type IntencaoDoAtendimento = (typeof INTENCOES_DO_ATENDIMENTO)[number];

export const PEDIDOS_PENDENTES = ["cancelar", "remarcar"] as const;
export type PedidoPendente = (typeof PEDIDOS_PENDENTES)[number];

export const DESFECHOS_DO_ATENDIMENTO = [
  "marcou",
  "remarcou",
  "cancelou",
  "confirmou",
  "passou_para_equipe",
  "sem_marcacao",
] as const;
export type DesfechoDoAtendimento = (typeof DESFECHOS_DO_ATENDIMENTO)[number];

/** Os dados que a IA pode pedir para marcar (dados_que_faltam_para_marcar). */
export const DADOS_DA_MARCACAO = [
  "nome_completo",
  "data_nascimento",
  "cpf",
  "carteirinha",
] as const;
export type DadoDaMarcacao = (typeof DADOS_DA_MARCACAO)[number];

/** Ate 9 horarios oferecidos no estado (CHECK ia_horarios_oferecidos_validos). */
export const MAXIMO_DE_HORARIOS_NO_ESTADO = 9;
/** Os codigos vao de h1 a h99 (o CHECK). */
export const MAIOR_NUMERO_DO_CODIGO = 99;
/** falhas_seguidas de 0 a 20 (o CHECK). */
export const MAXIMO_DE_FALHAS_NO_ESTADO = 20;
/** Na segunda falha seguida, o turno passa para a equipe (item 9 da AG3). */
export const FALHAS_PARA_PASSAR = 2;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Um horario oferecido, como fica no estado (os instantes em UTC com Z). */
export type HorarioDoEstado = {
  codigo: string;
  service_link_id: string;
  professional_id: string;
  unit_id: string | null;
  starts_at: string;
  ends_at: string;
  oferecido_em: string;
};

/** As 14 chaves do estado (ia_estado_do_atendimento_valido). */
export type EstadoDoAtendimento = {
  etapa: EtapaDoAtendimento;
  intencao: IntencaoDoAtendimento | null;
  procedure_id: string | null;
  professional_id: string | null;
  insurance_id: string | null;
  particular: boolean | null;
  unit_id: string | null;
  horarios_oferecidos: HorarioDoEstado[];
  slot_hold_id: string | null;
  appointment_id: string | null;
  pedido_pendente: PedidoPendente | null;
  pedido_pendente_em: string | null;
  falhas_seguidas: number;
  desfecho: DesfechoDoAtendimento | null;
};

/**
 * O que o paciente ja informou para marcar (so SE informou, nunca o valor),
 * se a consulta e para ele e o que ainda falta (dados.faltam de
 * ler_atendimento_da_ia).
 */
export type DadosInformados = {
  nome_completo: boolean;
  data_nascimento: boolean;
  cpf: boolean;
  carteirinha: boolean;
  para_o_titular: boolean | null;
  faltam: DadoDaMarcacao[];
};

/** O que ler_atendimento_da_ia devolve quando deu certo. */
export type AtendimentoLido = {
  versao: number;
  janelaDesde: string;
  estado: EstadoDoAtendimento;
  dados: DadosInformados;
};

export type RespostaDaLeitura =
  | ({ ok: true } & AtendimentoLido)
  | { ok: false; motivo: "fora_da_ia" | "job_antigo" };

export type MotivoDaGravacao =
  "fora_da_ia" | "sem_posse" | "job_antigo" | "estado_mudou";

export type RespostaDaGravacao =
  | { ok: true; versao: number; reutilizado: boolean }
  | { ok: false; motivo: MotivoDaGravacao };

// ---------------------------------------------------------------------------
// A forma (o espelho do CHECK; nunca lanca)
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANTE_EM_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const CODIGO_DO_HORARIO = /^h[1-9]\d?$/;

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

function uuidOuNulo(valor: unknown): boolean {
  return valor === null || ehUuid(valor);
}

function ehInstanteEmUtc(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    INSTANTE_EM_UTC.test(valor) &&
    Number.isFinite(Date.parse(valor))
  );
}

function daLista<T extends string>(
  lista: readonly T[],
  valor: unknown,
): valor is T {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor);
}

const CHAVES_DO_HORARIO = [
  "codigo",
  "service_link_id",
  "professional_id",
  "unit_id",
  "starts_at",
  "ends_at",
  "oferecido_em",
] as const;

/** Um horario oferecido na forma do CHECK (7 chaves, sem texto livre). */
export function horarioDoEstadoValido(valor: unknown): valor is HorarioDoEstado {
  if (!ehObjeto(valor)) {
    return false;
  }
  const chaves = Object.keys(valor);
  if (
    chaves.length !== CHAVES_DO_HORARIO.length ||
    !CHAVES_DO_HORARIO.every((chave) => chave in valor)
  ) {
    return false;
  }
  return (
    typeof valor.codigo === "string" &&
    CODIGO_DO_HORARIO.test(valor.codigo) &&
    ehUuid(valor.service_link_id) &&
    ehUuid(valor.professional_id) &&
    uuidOuNulo(valor.unit_id) &&
    ehInstanteEmUtc(valor.starts_at) &&
    ehInstanteEmUtc(valor.ends_at) &&
    ehInstanteEmUtc(valor.oferecido_em) &&
    Date.parse(valor.ends_at) > Date.parse(valor.starts_at)
  );
}

/** A lista de horarios na forma do CHECK (ate 9, codigos sem repetir). */
export function horariosDoEstadoValidos(
  valor: unknown,
): valor is HorarioDoEstado[] {
  if (!Array.isArray(valor) || valor.length > MAXIMO_DE_HORARIOS_NO_ESTADO) {
    return false;
  }
  if (!valor.every(horarioDoEstadoValido)) {
    return false;
  }
  return new Set(valor.map((h) => h.codigo)).size === valor.length;
}

const CHAVES_DO_ESTADO = [
  "etapa",
  "intencao",
  "procedure_id",
  "professional_id",
  "insurance_id",
  "particular",
  "unit_id",
  "horarios_oferecidos",
  "slot_hold_id",
  "appointment_id",
  "pedido_pendente",
  "pedido_pendente_em",
  "falhas_seguidas",
  "desfecho",
] as const;

/**
 * O estado na forma de ia_estado_do_atendimento_valido: exatamente as 14
 * chaves, listas fechadas, ids em uuid minusculo e instantes em UTC com Z.
 * Forma errada e falso, nunca erro.
 */
export function estadoDoAtendimentoValido(
  valor: unknown,
): valor is EstadoDoAtendimento {
  if (!ehObjeto(valor)) {
    return false;
  }
  const chaves = Object.keys(valor);
  if (
    chaves.length !== CHAVES_DO_ESTADO.length ||
    !CHAVES_DO_ESTADO.every((chave) => chave in valor)
  ) {
    return false;
  }
  const v = valor;
  if (
    !daLista(ETAPAS_DO_ATENDIMENTO, v.etapa) ||
    !(v.intencao === null || daLista(INTENCOES_DO_ATENDIMENTO, v.intencao)) ||
    !(v.particular === null || typeof v.particular === "boolean") ||
    !(v.pedido_pendente === null || daLista(PEDIDOS_PENDENTES, v.pedido_pendente)) ||
    !(v.pedido_pendente_em === null || ehInstanteEmUtc(v.pedido_pendente_em)) ||
    !(v.desfecho === null || daLista(DESFECHOS_DO_ATENDIMENTO, v.desfecho)) ||
    typeof v.falhas_seguidas !== "number" ||
    !Number.isInteger(v.falhas_seguidas) ||
    v.falhas_seguidas < 0 ||
    v.falhas_seguidas > MAXIMO_DE_FALHAS_NO_ESTADO
  ) {
    return false;
  }
  for (const chave of [
    "procedure_id",
    "professional_id",
    "insurance_id",
    "unit_id",
    "slot_hold_id",
    "appointment_id",
  ] as const) {
    if (!uuidOuNulo(v[chave])) {
      return false;
    }
  }
  // O pedido pendente e o instante dele andam juntos; particular e convenio
  // nao andam juntos.
  if ((v.pedido_pendente === null) !== (v.pedido_pendente_em === null)) {
    return false;
  }
  if (v.particular === true && v.insurance_id !== null) {
    return false;
  }
  return horariosDoEstadoValidos(v.horarios_oferecidos);
}

/** O estado de quem ainda nao gravou nada nesta janela (versao 0). */
export function estadoVazio(): EstadoDoAtendimento {
  return {
    etapa: "informacao",
    intencao: null,
    procedure_id: null,
    professional_id: null,
    insurance_id: null,
    particular: null,
    unit_id: null,
    horarios_oferecidos: [],
    slot_hold_id: null,
    appointment_id: null,
    pedido_pendente: null,
    pedido_pendente_em: null,
    falhas_seguidas: 0,
    desfecho: null,
  };
}

/** Nada informado ainda (o simulador e o turno sem estado comecam daqui). */
export function dadosVazios(
  faltam: readonly DadoDaMarcacao[] = [],
): DadosInformados {
  return {
    nome_completo: false,
    data_nascimento: false,
    cpf: false,
    carteirinha: false,
    para_o_titular: null,
    faltam: [...faltam],
  };
}

function dadosLidos(valor: unknown): DadosInformados | null {
  if (!ehObjeto(valor)) {
    return null;
  }
  const faltam = valor.faltam;
  if (
    typeof valor.nome_completo !== "boolean" ||
    typeof valor.data_nascimento !== "boolean" ||
    typeof valor.cpf !== "boolean" ||
    typeof valor.carteirinha !== "boolean" ||
    !(valor.para_o_titular === null || typeof valor.para_o_titular === "boolean") ||
    !Array.isArray(faltam) ||
    !faltam.every((f) => daLista(DADOS_DA_MARCACAO, f))
  ) {
    return null;
  }
  return {
    nome_completo: valor.nome_completo,
    data_nascimento: valor.data_nascimento,
    cpf: valor.cpf,
    carteirinha: valor.carteirinha,
    para_o_titular: valor.para_o_titular,
    faltam: [...new Set(faltam as DadoDaMarcacao[])],
  };
}

/**
 * O jsonb de ler_atendimento_da_ia, lido sem confiar no formato. null =
 * fora do formato (motivo desconhecido inclusive): quem chama falha
 * fechado.
 */
export function lerRespostaDoAtendimento(dado: unknown): RespostaDaLeitura | null {
  if (!ehObjeto(dado)) {
    return null;
  }
  if (dado.ok === false) {
    return dado.motivo === "fora_da_ia" || dado.motivo === "job_antigo"
      ? { ok: false, motivo: dado.motivo }
      : null;
  }
  if (dado.ok !== true) {
    return null;
  }
  const versao = dado.versao;
  const janela = dado.janela_desde;
  const dados = dadosLidos(dado.dados);
  if (
    typeof versao !== "number" ||
    !Number.isInteger(versao) ||
    versao < 0 ||
    typeof janela !== "string" ||
    !Number.isFinite(Date.parse(janela)) ||
    dados === null ||
    !estadoDoAtendimentoValido(dado.estado)
  ) {
    return null;
  }
  return {
    ok: true,
    versao,
    janelaDesde: janela,
    estado: copiarEstado(dado.estado),
    dados,
  };
}

/** O jsonb de gravar_atendimento_da_ia, lido sem confiar no formato. */
export function lerRespostaDaGravacao(dado: unknown): RespostaDaGravacao | null {
  if (!ehObjeto(dado)) {
    return null;
  }
  if (dado.ok === true) {
    return typeof dado.versao === "number" &&
      Number.isInteger(dado.versao) &&
      dado.versao > 0
      ? { ok: true, versao: dado.versao, reutilizado: dado.reutilizado === true }
      : null;
  }
  if (
    dado.ok === false &&
    (dado.motivo === "fora_da_ia" ||
      dado.motivo === "sem_posse" ||
      dado.motivo === "job_antigo" ||
      dado.motivo === "estado_mudou")
  ) {
    return { ok: false, motivo: dado.motivo };
  }
  return null;
}

/** Uma copia funda (o turno muda a copia, nunca o lido). */
export function copiarEstado(estado: EstadoDoAtendimento): EstadoDoAtendimento {
  return {
    ...estado,
    horarios_oferecidos: estado.horarios_oferecidos.map((h) => ({ ...h })),
  };
}

// ---------------------------------------------------------------------------
// Os horarios oferecidos (valem entre as mensagens pelo codigo)
// ---------------------------------------------------------------------------

/** O numero do codigo (h7 -> 7), ou null. */
export function numeroDoCodigo(codigo: string): number | null {
  const lido = /^h([1-9]\d?)$/.exec(codigo);
  return lido ? Number(lido[1]) : null;
}

/**
 * O proximo numero de codigo livre: depois do maior que esta no estado; ao
 * passar de h99, o menor que nao esta na lista (a lista tem no maximo 9).
 */
export function proximoNumeroDoCodigo(
  emUso: readonly string[],
  depoisDe = 0,
): number {
  const usados = new Set(
    emUso.map(numeroDoCodigo).filter((n): n is number => n !== null),
  );
  const maior = Math.max(depoisDe, ...usados, 0);
  if (maior < MAIOR_NUMERO_DO_CODIGO) {
    return maior + 1;
  }
  for (let n = 1; n <= MAIOR_NUMERO_DO_CODIGO; n += 1) {
    if (!usados.has(n)) {
      return n;
    }
  }
  return 1;
}

/**
 * Os horarios oferecidos depois de uma busca: os novos no fim e, acima de 9,
 * saem os mais antigos (o horario reservado, quando esta na lista, fica).
 */
export function comHorariosOferecidos(
  atuais: readonly HorarioDoEstado[],
  novos: readonly HorarioDoEstado[],
  manter: string | null = null,
): HorarioDoEstado[] {
  const codigosNovos = new Set(novos.map((h) => h.codigo));
  const juntos = [
    ...atuais.filter((h) => !codigosNovos.has(h.codigo)),
    ...novos,
  ];
  while (juntos.length > MAXIMO_DE_HORARIOS_NO_ESTADO) {
    const indice = juntos.findIndex((h) => h.codigo !== manter);
    juntos.splice(indice < 0 ? 0 : indice, 1);
  }
  return juntos;
}

// ---------------------------------------------------------------------------
// Os dados que faltam para marcar (o espelho de dados_que_faltam_para_marcar)
// ---------------------------------------------------------------------------

/**
 * Os dados que faltam, na ordem do banco: os tres pela configuracao em uso
 * (nome completo, nascimento e CPF) e a carteirinha so na consulta pelo
 * convenio, quando o convenio tem "Carteirinha obrigatoria" ou o
 * procedimento tem o requisito carteirinha (para todos ou para esse
 * convenio). Quem decide de verdade e o banco (o agendar recusa com
 * faltam_dados); isto e para o turno saber o que pedir depois de reservar e
 * para o simulador, que nao grava.
 */
export function dadosQueFaltam(entrada: {
  exigidos: { nomeCompleto: boolean; nascimento: boolean; cpf: boolean };
  informados: Pick<
    DadosInformados,
    "nome_completo" | "data_nascimento" | "cpf" | "carteirinha"
  >;
  /** O vinculo da reserva viva; null sem reserva. */
  vinculo: { procedimentoId: string; convenioId: string | null } | null;
  catalogo: Pick<
    CatalogoDoAgente,
    "conveniosDoCadastro" | "convenios" | "requisitos"
  >;
}): DadoDaMarcacao[] {
  const { exigidos, informados, vinculo, catalogo } = entrada;
  const faltam: DadoDaMarcacao[] = [];
  if (exigidos.nomeCompleto && !informados.nome_completo) {
    faltam.push("nome_completo");
  }
  if (exigidos.nascimento && !informados.data_nascimento) {
    faltam.push("data_nascimento");
  }
  if (exigidos.cpf && !informados.cpf) {
    faltam.push("cpf");
  }
  if (
    !informados.carteirinha &&
    vinculo !== null &&
    exigeCarteirinha(catalogo, vinculo)
  ) {
    faltam.push("carteirinha");
  }
  return faltam;
}

/** A consulta por este vinculo pede a carteirinha. */
export function exigeCarteirinha(
  catalogo: Pick<
    CatalogoDoAgente,
    "conveniosDoCadastro" | "convenios" | "requisitos"
  >,
  vinculo: { procedimentoId: string; convenioId: string | null },
): boolean {
  const convenioId = vinculo.convenioId;
  if (convenioId === null) {
    return false;
  }
  const convenio = [...catalogo.conveniosDoCadastro, ...catalogo.convenios].find(
    (c) => c.id === convenioId,
  );
  if (convenio?.exigeCarteirinha === true) {
    return true;
  }
  return (catalogo.requisitos ?? []).some(
    (r) =>
      r.procedimentoId === vinculo.procedimentoId &&
      r.tipo === "carteirinha" &&
      (r.convenioId === null || r.convenioId === convenioId),
  );
}

/** "o nome completo", "a data de nascimento", "o CPF", "o número da carteirinha". */
export const ROTULO_DO_DADO: Readonly<Record<DadoDaMarcacao, string>> = {
  nome_completo: "o nome completo",
  data_nascimento: "a data de nascimento",
  cpf: "o CPF",
  carteirinha: "o número da carteirinha do convênio",
};

/** "o nome completo, a data de nascimento e o CPF". */
export function listaEmTexto(itens: readonly string[]): string {
  if (itens.length <= 1) {
    return itens[0] ?? "";
  }
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

// ---------------------------------------------------------------------------
// A pergunta de confirmacao ("Confirma ...?")
// ---------------------------------------------------------------------------

/** Minusculo e sem acento (so para achar a pergunta). */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * O comeco da pergunta de confirmacao: "Confirma", e (revisao final da AG3,
 * achado 11) tambem depois de uma interjeicao ("Otimo, confirma ...?",
 * "Obrigada! Confirma") ou de quem confirma ("Voce confirma ...?", "Entao,
 * a senhora confirma ...?"). Ja sem acento e minusculo.
 */
const COMECO_DA_CONFIRMACAO =
  /^\s*(?:(?:otimo|otima|perfeito|perfeita|certo|certinho|ok|okay|entao|obrigad[oa]|combinado|beleza|show|maravilha|tudo certo|anotado|anotei|pronto|prontinho|bom|boa|sim|claro|legal|excelente|agora|por fim|para finalizar|so para confirmar)\s*[,:;]?\s+)*(?:(?:voce|vc|a senhora|o senhor)\s+)?confirma\b/;

/**
 * As frases da resposta que perguntam "Confirma ...?": a frase (do comeco
 * do texto ou depois de um ponto, de uma exclamacao, de uma interrogacao ou
 * de uma quebra de linha) que comeca com COMECO_DA_CONFIRMACAO e termina
 * numa interrogacao. Sem acento e minusculas.
 */
export function frasesQueConfirmam(texto: string): string[] {
  return perguntasDoTexto(texto).filter((frase) =>
    COMECO_DA_CONFIRMACAO.test(frase),
  );
}

/**
 * As perguntas do texto (as frases que terminam em interrogacao), sem
 * acento e minusculas. O ponto das abreviacoes ("Dra. Ana", "Av. Santos
 * Dumont") e dos numeros ("1.500") nao fecha a frase.
 */
function perguntasDoTexto(texto: string): string[] {
  const base = semAcento(texto.trim())
    .replace(/\b(dra|dr|sra|sr|srta|av|prof|profa|dona|sto|sta|n)\./g, "$1")
    .replace(/(\d)\.(\d)/g, "$1$2");
  return [...base.matchAll(/[^.!?\n]+\?+/g)].map((m) => m[0].trim());
}

/**
 * A resposta pergunta "Confirma ...?" (frasesQueConfirmam). E o que deixa o
 * proximo turno marcar (etapa aguardando_confirmacao), junto da conferencia
 * da reserva (perguntaConfirmaAReserva): o agendar so vale numa mensagem
 * nova do paciente depois dessa pergunta.
 */
export function perguntaSeConfirma(texto: string): boolean {
  return frasesQueConfirmam(texto).length > 0;
}

/** A reserva viva que a pergunta "Confirma ...?" tem de mostrar. */
export type ReservaPerguntada = {
  /** Como a agenda escreve ("quarta, 21/10"). */
  dia: string;
  /** "14:00". */
  hora: string;
  /** O nome do Cadastro (null: nao se sabe). */
  profissional: string | null;
  /** O nome da unidade (null: sem unidade). */
  unidade: string | null;
  /** Os nomes de todos os profissionais do catalogo. */
  profissionais: readonly string[];
  /** Os nomes de todas as unidades do catalogo. */
  unidades: readonly string[];
  /**
   * Revisao curta das correcoes (achado 8): o dia da reserva no fuso da
   * clinica (aaaa-mm-dd). Com ele e com hojeNaClinica, "hoje", "amanha" e o
   * ano escrito sao conferidos. Ausente: a mensagem com "hoje", "amanha" ou
   * ano nao arma.
   */
  diaNaClinica?: string | null;
  /** Hoje no fuso da clinica (aaaa-mm-dd), para "hoje" e "amanha". */
  hojeNaClinica?: string | null;
};

const DIAS_DA_SEMANA_SEM_ACENTO = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
] as const;
const DIA_DA_SEMANA_NA_FRASE =
  /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/g;
/** Os titulos que nao fazem parte do nome ("Dra. Ana Lima" e "ana lima"). */
const TITULOS = new Set(["dr", "dra", "doutor", "doutora", "prof", "profa"]);
const TITULO_E_NOME = /\b(?:dr|dra|doutor|doutora)\b\.?\s+([a-z]+)/g;
/** As particulas, que nunca distinguem um nome de outro ("Ana DA Silva"). */
const PARTICULAS_DO_NOME = new Set(["da", "das", "de", "do", "dos", "e", "d"]);
/**
 * O dia dito em relacao a hoje (revisao curta, achado 8), com quantos dias
 * depois de hoje ele e. "depois de amanha" antes de "amanha".
 */
const DIA_RELATIVO = /\b(depois de amanha|amanha|hoje)\b/g;
const DIAS_DO_DIA_RELATIVO: Readonly<Record<string, number>> = {
  hoje: 0,
  amanha: 1,
  "depois de amanha": 2,
};

/** As palavras do nome, sem titulo e sem pontuacao ("dra. ana lima": ana lima). */
function palavrasDoNome(nome: string): string[] {
  return normalizarBase(nome)
    .split(/[^a-z0-9]+/)
    .filter((p) => p !== "" && !TITULOS.has(p));
}

/** A frase cita o nome inteiro (as palavras em sequencia). */
function citaONome(frase: string, palavras: readonly string[]): boolean {
  if (palavras.length === 0) {
    return false;
  }
  const escapadas = palavras.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![a-z0-9])${escapadas.join("[^a-z0-9]+")}(?![a-z0-9])`).test(
    frase,
  );
}

/**
 * Revisao curta das correcoes (achado 2): as palavras DISTINTIVAS dos outros
 * nomes do catalogo, o primeiro nome e o sobrenome (sem titulo e sem
 * particula) que nao estao no nome da reserva. "Bruno" e "Costa" de "Dr.
 * Bruno Costa" com a reserva da Dra. Ana Lima; com a Dra. Ana Costa no
 * catalogo, so "Costa" ("Ana" tambem e da reserva). Numero e letra solta
 * ("Unidade 2", "Bloco B") ficam de fora, para nao casar com a hora e a
 * data: esses nomes so contam inteiros (citaONome).
 */
function palavrasDistintivas(
  nomes: readonly string[],
  daReserva: readonly string[],
): string[] {
  const proprias = new Set(daReserva);
  return [
    ...new Set(
      nomes
        .flatMap(palavrasDoNome)
        .filter(
          (p) =>
            p.length > 1 &&
            !/^\d+$/.test(p) &&
            !PARTICULAS_DO_NOME.has(p) &&
            !proprias.has(p),
        ),
    ),
  ];
}

/** A mensagem cita a palavra inteira. */
function citaAPalavra(mensagem: string, palavra: string): boolean {
  return citaONome(mensagem, [palavra]);
}

/**
 * A mensagem inteira, sem acento e minuscula, para conferir a pergunta: o
 * ponto das abreviacoes ("Dra. Ana") e dos numeros ("R$ 1.500") sai, como
 * em perguntasDoTexto.
 */
function baseDaMensagem(texto: string): string {
  return normalizarBase(
    semAcento(texto)
      .replace(/\b(dra|dr|sra|sr|srta|av|prof|profa|dona|sto|sta|n)\./g, "$1")
      .replace(/(\d)\.(\d)/g, "$1$2"),
  );
}

/** Quantos dias de calendario vao de `de` ate `ate` (aaaa-mm-dd), ou null. */
function diasEntre(de: string, ate: string): number | null {
  const ler = (dia: string) => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
    return partes
      ? Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]))
      : null;
  };
  const inicio = ler(de);
  const fim = ler(ate);
  return inicio === null || fim === null
    ? null
    : Math.round((fim - inicio) / 86_400_000);
}

/**
 * Revisao final da AG3 (achado 1, ALTO): a pergunta "Confirma ...?" mostra
 * A RESERVA VIVA, e so ela. Sem isso, a etapa aguardando_confirmacao nao e
 * armada e o "sim" seguinte nao marca: marcar um horario diferente do que a
 * pessoa confirmou e o pior erro do agendamento.
 *
 * Revisao curta das correcoes (achados 2 e 8), pela MENSAGEM INTEIRA, nao so
 * pela frase da pergunta. Arma so quando:
 *  - a mensagem tem a pergunta que comeca com "Confirma" (frasesQueConfirmam;
 *    o resumo seguido de "Confirma?" curto vale);
 *  - TODO dia e TODA hora da mensagem sao os da reserva, com pelo menos o
 *    dd/mm e o HH:mm dela ("Ou prefere quinta, 22/10 as 13:00?" e o lembrete
 *    com outra hora nao armam: o "sim" ficaria ambiguo); o dia da semana, o
 *    ano escrito e "hoje", "amanha" e "depois de amanha" batem com o dia da
 *    reserva no fuso da clinica;
 *  - nenhum outro profissional nem outra unidade e citado: nem o nome
 *    inteiro, nem o titulo com outro primeiro nome, nem uma palavra
 *    distintiva (primeiro nome ou sobrenome) de outro do catalogo que nao
 *    esteja no nome da reserva ("com o Bruno", "com a Costa");
 *  - "unidade" so com a unidade da reserva.
 */
export function perguntaConfirmaAReserva(
  texto: string,
  reserva: ReservaPerguntada,
): boolean {
  if (frasesQueConfirmam(texto).length === 0) {
    return false;
  }
  const doDia = datasEHorasDoTexto(normalizarBase(reserva.dia), "fonte");
  const dataDaReserva = doDia.datas[0];
  const horaDaReserva = datasEHorasDoTexto(
    normalizarBase(reserva.hora),
    "fonte",
  ).horas[0];
  const semanaDaReserva = DIAS_DA_SEMANA_SEM_ACENTO.find((d) =>
    normalizarBase(reserva.dia).startsWith(d),
  );
  if (
    dataDaReserva === undefined ||
    dataDaReserva.mes === null ||
    horaDaReserva === undefined
  ) {
    return false;
  }
  const mensagem = baseDaMensagem(texto);

  // Os dias e as horas: so os da reserva, com o dd/mm e o HH:mm dela.
  const { datas, horas } = datasEHorasDoTexto(mensagem, "rascunho");
  if (
    !datas.some(
      (d) => d.dia === dataDaReserva.dia && d.mes === dataDaReserva.mes,
    ) ||
    datas.some(
      (d) =>
        d.dia !== dataDaReserva.dia ||
        (d.mes !== null && d.mes !== dataDaReserva.mes),
    ) ||
    !horas.includes(horaDaReserva) ||
    horas.some((h) => h !== horaDaReserva)
  ) {
    return false;
  }
  // O ano escrito e o do dia da reserva (sem saber o dia, nao arma).
  const anoDaReserva = reserva.diaNaClinica
    ? Number(reserva.diaNaClinica.slice(0, 4))
    : null;
  // (o leitor ja devolve o ano com quatro digitos: "21/10/26" e 2026)
  if (datas.some((d) => d.ano !== null && d.ano !== anoDaReserva)) {
    return false;
  }
  for (const m of mensagem.matchAll(DIA_DA_SEMANA_NA_FRASE)) {
    if (m[1] !== semanaDaReserva) {
      return false;
    }
  }
  // "hoje", "amanha", "depois de amanha": o dia da reserva no fuso da
  // clinica (sem saber hoje ou o dia da reserva, nao arma).
  const diasAteAReserva =
    reserva.diaNaClinica && reserva.hojeNaClinica
      ? diasEntre(reserva.hojeNaClinica, reserva.diaNaClinica)
      : null;
  for (const m of mensagem.matchAll(DIA_RELATIVO)) {
    if (
      diasAteAReserva === null ||
      DIAS_DO_DIA_RELATIVO[m[1] ?? ""] !== diasAteAReserva
    ) {
      return false;
    }
  }

  // O profissional: o titulo com o primeiro nome da reserva, e nenhum
  // outro profissional do catalogo, nem por uma palavra distintiva.
  const nomeDaReserva =
    reserva.profissional === null ? [] : palavrasDoNome(reserva.profissional);
  for (const m of mensagem.matchAll(TITULO_E_NOME)) {
    if (nomeDaReserva.length === 0 || m[1] !== nomeDaReserva[0]) {
      return false;
    }
  }
  const outrosProfissionais = reserva.profissionais
    .map(palavrasDoNome)
    .filter(
      (palavras) =>
        palavras.length > 0 && palavras.join(" ") !== nomeDaReserva.join(" "),
    );
  if (
    outrosProfissionais.some((nome) => citaONome(mensagem, nome)) ||
    palavrasDistintivas(reserva.profissionais, nomeDaReserva).some((p) =>
      citaAPalavra(mensagem, p),
    )
  ) {
    return false;
  }

  // A unidade: a da reserva, quando cita; nenhuma outra, nem por uma
  // palavra distintiva.
  const unidadeDaReserva =
    reserva.unidade === null ? [] : palavrasDoNome(reserva.unidade);
  const outrasUnidades = reserva.unidades
    .map(palavrasDoNome)
    .filter(
      (palavras) =>
        palavras.length > 0 && palavras.join(" ") !== unidadeDaReserva.join(" "),
    );
  if (
    outrasUnidades.some((nome) => citaONome(mensagem, nome)) ||
    palavrasDistintivas(reserva.unidades, unidadeDaReserva).some((p) =>
      citaAPalavra(mensagem, p),
    )
  ) {
    return false;
  }
  if (
    /\bunidade\b/.test(mensagem) &&
    (unidadeDaReserva.length === 0 || !citaONome(mensagem, unidadeDaReserva))
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// As falhas seguidas (item 9 da AG3)
// ---------------------------------------------------------------------------

/**
 * O que conta como FALHA de um turno (lista fechada, conservadora): a
 * ferramenta recusou o pedido do modelo ou o dado do paciente. Entrada fora
 * do formato, codigo que nao existe (procedimento, profissional, unidade,
 * horario), a segunda reserva ou marcacao na mesma resposta, marcar sem a
 * confirmacao do paciente, e o dado do paciente invalido ou que nao foi
 * achado na mensagem. Horario que deixou de estar livre, reserva vencida e
 * convenio que nao atende NAO contam: nao sao falha de ninguem.
 */
export const RESULTADOS_QUE_SAO_FALHA: ReadonlySet<string> = new Set([
  "entrada_invalida",
  "codigo_invalido",
  "procedimento_nao_encontrado",
  "profissional_nao_encontrado",
  "unidade_nao_encontrada",
  "uma_reserva_por_resposta",
  "uma_marcacao_por_resposta",
  "uma_confirmacao_por_resposta",
  "sem_confirmacao_do_paciente",
  "dados_invalidos",
  "nome_nao_encontrado",
  "data_nao_encontrada",
  "cpf_nao_encontrado",
  "cpf_invalido",
  "cpf_ambiguo",
  "carteirinha_nao_encontrada",
  "carteirinha_ambigua",
  // AG4: cancelar sem a pergunta feita antes, o "sim" que nao foi claro, o
  // horario da remarcacao de outro procedimento, profissional ou pagamento,
  // a busca da remarcacao sem a consulta e o segundo pedido na resposta.
  "sem_pergunta_de_cancelamento",
  "sem_confirmacao_clara",
  "horario_fora_da_remarcacao",
  "sem_consulta_para_remarcar",
  "um_cancelamento_por_resposta",
]);

/** O que conta como AVANCO: um passo do atendimento que deu certo. */
export const RESULTADOS_QUE_AVANCAM: ReadonlySet<string> = new Set([
  "horarios",
  "hora_pedida_livre",
  "hora_pedida_ocupada",
  "reservado",
  "registrado",
  "marcado",
  "confirmada",
  // AG4: as consultas lidas, o cancelamento e a remarcacao pedida.
  "consultas",
  "cancelada",
  "remarcado",
]);

/**
 * O contador depois do turno: avanco zera; falha sem avanco soma um; o
 * turno que usou ferramenta sem nenhuma falha tambem zera (a conversa
 * andou); o turno sem ferramenta (so conversa) nao muda o contador.
 */
export function falhasDepoisDoTurno(
  anterior: number,
  resultados: readonly string[],
): number {
  const avancou = resultados.some((r) => RESULTADOS_QUE_AVANCAM.has(r));
  const falhou = resultados.some((r) => RESULTADOS_QUE_SAO_FALHA.has(r));
  if (avancou) {
    return 0;
  }
  if (falhou) {
    return Math.min(MAXIMO_DE_FALHAS_NO_ESTADO, anterior + 1);
  }
  return resultados.length > 0 ? 0 : anterior;
}

// ---------------------------------------------------------------------------
// A nota para a equipe na passagem (item 8 da AG3)
// ---------------------------------------------------------------------------

/** Um horario ja com dia, hora e nomes do Cadastro (para a nota e o prompt). */
export type HorarioLegivel = {
  dia: string;
  hora: string;
  profissional: string | null;
  unidade: string | null;
};

export type EntradaDaNota = {
  estado: EstadoDoAtendimento;
  dados: DadosInformados;
  /** Os nomes do Cadastro (null: o id nao esta mais no catalogo). */
  procedimento: string | null;
  profissional: string | null;
  /** "particular", o nome do convenio (e plano) ou null (nao definido). */
  pagamento: string | null;
  unidade: string | null;
  /** O que a pessoa pediu na ultima busca deste turno (lista fechada). */
  preferencia: { periodo: string | null; hora: string | null } | null;
  /**
   * perdida (revisao final da AG3): o horario da reserva deixou de estar
   * livre.
   */
  reserva:
    | (HorarioLegivel & { viva: boolean | null; perdida?: boolean })
    | null;
  oferecidos: readonly HorarioLegivel[];
  /** Onde o atendimento parou, em texto de recepcao (rotulo fixo). */
  parouEm: string;
  /**
   * AG4: o pedido de cancelar ou remarcar uma consulta da pessoa (o dia, a
   * hora e os nomes do Cadastro, so na nota da equipe).
   */
  pedidoDaConsulta?: {
    acao: "cancelar" | "remarcar";
    dia: string;
    hora: string;
    procedimento: string | null;
    profissional: string | null;
  } | null;
  /** AG4: a remarcacao pedida pelo assistente nesta conversa. */
  remarcacao?: {
    de: { dia: string; hora: string } | null;
    para: { dia: string; hora: string };
  } | null;
};

const NOME_DO_PERIODO: Readonly<Record<string, string>> = {
  manha: "manhã",
  tarde: "tarde",
  noite: "noite",
};

function horarioEmTexto(h: HorarioLegivel): string {
  const com = h.profissional === null ? "" : `, ${h.profissional}`;
  const onde = h.unidade === null ? "" : `, unidade ${h.unidade}`;
  return `${h.dia} às ${h.hora}${com}${onde}`;
}

/** Tem o que contar para a equipe (a pessoa estava marcando)? */
export function temAtendimentoParaContar(
  estado: EstadoDoAtendimento,
  dados: DadosInformados,
): boolean {
  return (
    estado.intencao === "agendar" ||
    // AG4: o pedido de cancelar ou remarcar.
    estado.intencao === "cancelar" ||
    estado.intencao === "remarcar" ||
    estado.pedido_pendente !== null ||
    estado.procedure_id !== null ||
    estado.horarios_oferecidos.length > 0 ||
    estado.slot_hold_id !== null ||
    estado.appointment_id !== null ||
    dados.nome_completo ||
    dados.data_nascimento ||
    dados.cpf ||
    dados.carteirinha ||
    dados.para_o_titular === false
  );
}

/**
 * A nota interna da passagem, montada SO do estado e do Cadastro (nunca
 * texto do modelo nem do paciente, nunca o valor de um dado): o pedido, a
 * reserva, os horarios oferecidos, os dados que ja vieram e os que faltam, e
 * onde parou. Sem travessao (regra de interface). null quando a pessoa nao
 * estava marcando (nada a contar alem do evento da passagem).
 */
export function notaDaPassagem(entrada: EntradaDaNota): string | null {
  const { estado, dados } = entrada;
  const doPedido = entrada.pedidoDaConsulta ?? null;
  const remarcacao = entrada.remarcacao ?? null;
  if (
    !temAtendimentoParaContar(estado, dados) &&
    doPedido === null &&
    remarcacao === null
  ) {
    return null;
  }
  // D-20: o cabecalho fixo e o que faz o Atendimento assinar a nota como do
  // assistente (lib/agente/nota-da-passagem.ts).
  const linhas: string[] = [CABECALHO_DA_NOTA_DA_PASSAGEM];
  // AG4: o pedido de cancelar ou remarcar uma consulta que a pessoa ja tem.
  if (doPedido !== null) {
    const nomes = [doPedido.procedimento, doPedido.profissional].filter(
      (n): n is string => n !== null,
    );
    linhas.push(
      `Pedido: ${doPedido.acao} a consulta de ${doPedido.dia} às ${doPedido.hora}${nomes.length === 0 ? "" : ` (${nomes.join(", ")})`}.`,
    );
    if (entrada.reserva !== null && doPedido.acao === "remarcar") {
      const situacao =
        entrada.reserva.perdida === true
          ? "o horário deixou de estar livre"
          : entrada.reserva.viva === true
            ? "reserva de 10 minutos ainda valendo"
            : entrada.reserva.viva === false
              ? "a reserva de 10 minutos venceu"
              : "reserva de 10 minutos";
      linhas.push(
        `Horário reservado para a remarcação: ${horarioEmTexto(entrada.reserva)} (${situacao}).`,
      );
    }
    if (entrada.oferecidos.length > 0 && doPedido.acao === "remarcar") {
      linhas.push(
        `Horários oferecidos para a remarcação: ${entrada.oferecidos.map(horarioEmTexto).join("; ")}.`,
      );
    }
  }
  if (remarcacao !== null) {
    linhas.push(
      `Remarcação pedida pelo assistente nesta conversa, pendente da aprovação da equipe: ${remarcacao.de === null ? "" : `de ${remarcacao.de.dia} às ${remarcacao.de.hora} `}para ${remarcacao.para.dia} às ${remarcacao.para.hora}.`,
    );
  }
  if (doPedido !== null || remarcacao !== null) {
    linhas.push(`Parou em: ${entrada.parouEm}.`);
    return linhas.join("\n");
  }
  const pedido: string[] = [];
  if (entrada.procedimento !== null) {
    pedido.push(`marcar ${entrada.procedimento}`);
  } else if (estado.intencao === "agendar") {
    pedido.push("marcar consulta");
  }
  if (entrada.profissional !== null) {
    pedido.push(`com ${entrada.profissional}`);
  }
  if (entrada.pagamento !== null) {
    pedido.push(
      entrada.pagamento === "particular"
        ? "particular"
        : `pelo convênio ${entrada.pagamento}`,
    );
  }
  if (entrada.unidade !== null) {
    pedido.push(`unidade ${entrada.unidade}`);
  }
  const preferencias: string[] = [];
  const periodo = entrada.preferencia?.periodo ?? null;
  if (periodo !== null && NOME_DO_PERIODO[periodo] !== undefined) {
    preferencias.push(NOME_DO_PERIODO[periodo]);
  }
  if (entrada.preferencia?.hora) {
    preferencias.push(`às ${entrada.preferencia.hora}`);
  }
  if (preferencias.length > 0) {
    pedido.push(`preferência: ${preferencias.join(", ")}`);
  }
  if (pedido.length > 0) {
    linhas.push(`Pedido: ${pedido.join(", ")}.`);
  }
  if (entrada.reserva !== null) {
    const situacao =
      entrada.reserva.perdida === true
        ? "o horário deixou de estar livre"
        : entrada.reserva.viva === true
          ? "reserva de 10 minutos ainda valendo"
          : entrada.reserva.viva === false
            ? "a reserva de 10 minutos venceu"
            : "reserva de 10 minutos";
    linhas.push(
      `Horário reservado: ${horarioEmTexto(entrada.reserva)} (${situacao}).`,
    );
  }
  if (entrada.oferecidos.length > 0) {
    linhas.push(
      `Horários oferecidos: ${entrada.oferecidos.map(horarioEmTexto).join("; ")}.`,
    );
  }
  if (dados.para_o_titular === false) {
    linhas.push("A consulta é para outra pessoa.");
  } else {
    const informados = DADOS_DA_MARCACAO.filter((d) => dados[d]).map(
      (d) => ROTULO_DO_DADO[d],
    );
    const partes: string[] = [];
    if (informados.length > 0) {
      partes.push(
        `${listaEmTexto(informados)} ${informados.length === 1 ? "informado" : "informados"} (a equipe vê os valores na aprovação da consulta)`,
      );
    }
    if (dados.faltam.length > 0) {
      partes.push(
        `${dados.faltam.length === 1 ? "falta" : "faltam"} ${listaEmTexto(dados.faltam.map((d) => ROTULO_DO_DADO[d]))}`,
      );
    }
    if (partes.length > 0) {
      linhas.push(`Dados para marcar: ${partes.join("; ")}.`);
    }
  }
  if (estado.appointment_id !== null) {
    linhas.push(
      "Consulta marcada pelo assistente nesta conversa, pendente da aprovação da equipe.",
    );
  }
  linhas.push(`Parou em: ${entrada.parouEm}.`);
  return linhas.join("\n");
}
