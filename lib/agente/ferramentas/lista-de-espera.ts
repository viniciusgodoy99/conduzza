// Ferramentas pedir_lista_de_espera e entrar_na_lista_de_espera do agente de
// IA (AG5, 27/10/2026; D-11 do dono: a IA poe na lista de espera, encaixe
// nunca pela IA). Duas fases, como cancelar na AG4:
//  1. pedir_lista_de_espera({periodos, dias}): o procedimento, o
//     profissional (ou qualquer) e o pagamento vem do ESTADO do atendimento
//     (a ultima busca de horario), nunca do texto do modelo; a RPC
//     pedir_lista_de_espera_pela_ia confere tudo e grava o PEDIDO (um vivo
//     por conversa, ancorado pelo job do turno); o SISTEMA escreve a pergunta
//     fixa (T-E1). O modelo nao escreve nada.
//  2. entrar_na_lista_de_espera(), numa mensagem nova: so com o pedido vivo
//     lido no preparo e a T-E1 conferida como a saida logo antes da resposta;
//     o "sim" numa lista FECHADA propria (interpretarRespostaAListaDeEspera:
//     o "cancela" da lista do cancelamento nunca vira sim) e a RPC
//     entrar_na_lista_de_espera_pela_ia, que confere de novo e ancora o "sim"
//     na pergunta escrita pelo MESMO job do pedido. Deu certo: o sistema
//     responde com o texto fixo (T-E2).
// PURO: as definicoes, as entradas, os motivos das RPCs, a leitura defensiva
// das respostas e as conversoes dos dias. Quem chama as RPCs (com o job_id
// do turno) e lib/agente/agenda.ts; o executor do turno e
// lib/agente/ferramentas/espera-do-turno.ts.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const NOME_DO_PEDIDO_DE_ESPERA = "pedir_lista_de_espera";
export const NOME_DA_ENTRADA_NA_ESPERA = "entrar_na_lista_de_espera";

/** Os periodos da lista de espera (waitlist.preferred_shifts). */
export const PERIODOS_DA_ESPERA = ["manha", "tarde", "noite"] as const;
export type PeriodoDaEspera = (typeof PERIODOS_DA_ESPERA)[number];

/**
 * Os dias da semana como o modelo manda, na ordem de waitlist.preferred_
 * weekdays (0 = domingo a 6 = sabado, a convencao getDay do JS).
 */
export const DIAS_DA_ESPERA = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
] as const;
export type DiaDaEspera = (typeof DIAS_DA_ESPERA)[number];

/** O numero do dia (0 = domingo a 6 = sabado). */
export function numeroDoDia(dia: DiaDaEspera): number {
  return DIAS_DA_ESPERA.indexOf(dia);
}

/** Sem repetir (o strict da OpenAI nao garante uniqueItems). */
function semRepetir<T>(lista: readonly T[]): boolean {
  return new Set(lista).size === lista.length;
}

export const entradaDoPedidoDeEsperaSchema = z
  .object({
    periodos: z
      .array(z.enum(PERIODOS_DA_ESPERA))
      .max(PERIODOS_DA_ESPERA.length)
      .refine(semRepetir),
    dias: z
      .array(z.enum(DIAS_DA_ESPERA))
      .max(DIAS_DA_ESPERA.length)
      .refine(semRepetir),
  })
  .strict();

export const entradaDaEntradaNaEsperaSchema = z.object({}).strict();

export const FERRAMENTA_PEDIR_LISTA_DE_ESPERA: FunctionTool = {
  type: "function",
  name: NOME_DO_PEDIDO_DE_ESPERA,
  strict: true,
  description:
    "Pede a entrada da pessoa na lista de espera, com os períodos e os dias da semana que servem para ela. O procedimento, o profissional e o pagamento são os da última consulta de buscar_horario. O sistema confere e faz a pergunta de confirmação: depois de chamar, não escreva mais nada. Nada é gravado aqui.",
  parameters: {
    type: "object",
    properties: {
      periodos: {
        type: "array",
        description:
          "Os períodos que servem, sem repetir; vazio quando qualquer período serve.",
        items: { type: "string", enum: [...PERIODOS_DA_ESPERA] },
      },
      dias: {
        type: "array",
        description:
          "Os dias da semana que servem, sem repetir; vazio quando qualquer dia serve.",
        items: { type: "string", enum: [...DIAS_DA_ESPERA] },
      },
    },
    required: ["periodos", "dias"],
    additionalProperties: false,
  },
};

export const FERRAMENTA_ENTRAR_NA_LISTA_DE_ESPERA: FunctionTool = {
  type: "function",
  name: NOME_DA_ENTRADA_NA_ESPERA,
  strict: true,
  description:
    'Coloca a pessoa na lista de espera da pergunta que o sistema fez. Use só quando a pessoa responder que confirma, numa mensagem nova depois da pergunta "Confirma a sua entrada na lista de espera ...?". O sistema confere a resposta e responde (se a pergunta não valer mais, ele pergunta de novo): depois de chamar, não escreva mais nada.',
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/**
 * Os motivos de pedir_lista_de_espera_pela_ia (desenho da AG5, 3.3 b, e o
 * contrato da frente de banco), lista FECHADA, na ordem do banco. Os erros
 * de quem chama (22004, 22023 job_invalido, job_de_outro_pedido,
 * preferencia_invalida, pagamento_invalido, cadastro_invalido) chegam como
 * erro da RPC: falha fechada.
 */
export const MOTIVOS_DO_PEDIDO_DE_ESPERA = [
  "ia_desligada",
  "lista_de_espera_desligada",
  "mais_de_uma_unidade",
  "so_com_a_equipe",
  "sem_autorizacao",
  "ja_na_lista",
  "consulta_para_outra_pessoa",
  "menor_de_idade",
  "ja_tem_consulta",
] as const;
export type MotivoDoPedidoDeEspera =
  (typeof MOTIVOS_DO_PEDIDO_DE_ESPERA)[number];

/**
 * Os motivos de entrar_na_lista_de_espera_pela_ia (desenho da AG5, 3.3 c),
 * na ordem do banco: R13 da AG4, as estruturais antes da mensagem nova; o
 * que depende da pessoa depois.
 */
export const MOTIVOS_DA_ENTRADA_NA_ESPERA = [
  "ia_desligada",
  "lista_de_espera_desligada",
  "sem_pedido_de_espera",
  "mais_de_uma_unidade",
  "so_com_a_equipe",
  "sem_autorizacao",
  "ja_na_lista",
  "mensagem_nova_do_paciente",
  "consulta_para_outra_pessoa",
  "menor_de_idade",
  "ja_tem_consulta",
  "pedido_vencido",
  "sem_confirmacao_do_paciente",
] as const;
export type MotivoDaEntradaNaEspera =
  (typeof MOTIVOS_DA_ENTRADA_NA_ESPERA)[number];

/**
 * A entrada que ja existe (ja_na_lista): o profissional (nome do Cadastro;
 * null = qualquer) e a preferencia dela. Revisao da AG5 (contrato da frente
 * de banco, C1): ja_na_lista vale para QUALQUER entrada ativa do contato do
 * mesmo procedimento (de qualquer profissional, ou de outro) ou de qualquer
 * procedimento; o profissional pode ser outro que o do pedido, e o
 * procedimento vem tambem (null = qualquer procedimento; ausente = a
 * resposta de antes, sem o campo).
 */
export type EntradaQueJaExiste = {
  procedimento?: string | null;
  profissional: string | null;
  turnos: PeriodoDaEspera[];
  dias: number[];
};

/** O que as duas fases devolvem quando deu certo (os nomes do Cadastro). */
export type PedidoDeEsperaFeito = {
  /** Repetir o job devolve o mesmo pedido (ou a mesma entrada). */
  reutilizado: boolean;
  procedimento: string | null;
  /** null: qualquer profissional. */
  profissional: string | null;
  /** null: particular. */
  convenio: string | null;
  plano: string | null;
  particular: boolean;
  turnos: PeriodoDaEspera[];
  dias: number[];
};

export type RecusaDaEspera<M extends string> = {
  ok: false;
  motivo: M;
  /** So em ja_na_lista: a entrada que ja existe (ou null, sem ela). */
  entrada?: EntradaQueJaExiste | null;
  /** So em ja_tem_consulta: o inicio da consulta (ISO, UTC), ou null. */
  inicio?: string | null;
};

export type RespostaDoPedidoDeEspera =
  | ({ ok: true } & PedidoDeEsperaFeito)
  | RecusaDaEspera<MotivoDoPedidoDeEspera>;

export type RespostaDaEntradaNaEspera =
  | ({ ok: true } & PedidoDeEsperaFeito)
  | RecusaDaEspera<MotivoDaEntradaNaEspera>;

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/**
 * Os periodos como o banco guarda, conferidos (null: fora do formato). O
 * banco normaliza (sem repetir, na ordem, os tres viram vazio); aqui so a
 * forma, sem confiar.
 */
export function periodosLidos(valor: unknown): PeriodoDaEspera[] | null {
  if (!Array.isArray(valor)) {
    return null;
  }
  const lidos: PeriodoDaEspera[] = [];
  for (const item of valor) {
    if (!(PERIODOS_DA_ESPERA as readonly unknown[]).includes(item)) {
      return null;
    }
    lidos.push(item as PeriodoDaEspera);
  }
  return semRepetir(lidos) ? lidos : null;
}

/** Os dias como o banco guarda (0 a 6), conferidos (null: fora do formato). */
export function diasLidos(valor: unknown): number[] | null {
  if (!Array.isArray(valor)) {
    return null;
  }
  const lidos: number[] = [];
  for (const item of valor) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 6) {
      return null;
    }
    lidos.push(item);
  }
  return semRepetir(lidos) ? lidos : null;
}

function ehInstante(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

/** O ok das duas fases (os nomes e a preferencia), ou null fora do formato. */
function feitoLido(r: Record<string, unknown>): PedidoDeEsperaFeito | null {
  const turnos = periodosLidos(r.turnos);
  const dias = diasLidos(r.dias);
  if (
    typeof r.particular !== "boolean" ||
    turnos === null ||
    dias === null ||
    // O par do pagamento: particular sem convenio; convenio com o nome.
    (r.particular && textoOuNulo(r.convenio) !== null)
  ) {
    return null;
  }
  return {
    reutilizado: r.reutilizado === true,
    procedimento: textoOuNulo(r.procedimento),
    profissional: textoOuNulo(r.profissional),
    convenio: textoOuNulo(r.convenio),
    plano: textoOuNulo(r.plano),
    particular: r.particular,
    turnos,
    dias,
  };
}

/** A entrada de ja_na_lista, lida sem confiar (null: sem ela ou fora do formato). */
function entradaQueJaExiste(valor: unknown): EntradaQueJaExiste | null {
  if (!ehObjeto(valor)) {
    return null;
  }
  const turnos = periodosLidos(valor.turnos);
  const dias = diasLidos(valor.dias);
  if (
    turnos === null ||
    dias === null ||
    (valor.procedimento !== undefined &&
      valor.procedimento !== null &&
      typeof valor.procedimento !== "string")
  ) {
    return null;
  }
  return {
    ...(valor.procedimento === undefined
      ? {}
      : { procedimento: textoOuNulo(valor.procedimento) }),
    profissional: textoOuNulo(valor.profissional),
    turnos,
    dias,
  };
}

function recusaLida<M extends string>(
  r: Record<string, unknown>,
  motivos: readonly M[],
): RecusaDaEspera<M> | null {
  if (
    r.ok !== false ||
    typeof r.motivo !== "string" ||
    !(motivos as readonly string[]).includes(r.motivo)
  ) {
    return null;
  }
  const motivo = r.motivo as M;
  if (motivo === "ja_na_lista") {
    return { ok: false, motivo, entrada: entradaQueJaExiste(r.entrada) };
  }
  if (motivo === "ja_tem_consulta") {
    return {
      ok: false,
      motivo,
      inicio: ehInstante(r.starts_at) ? r.starts_at : null,
    };
  }
  return { ok: false, motivo };
}

/**
 * O jsonb de pedir_lista_de_espera_pela_ia, lido sem confiar no formato.
 * null = fora do formato (motivo desconhecido inclusive): quem chama falha
 * fechado, porque nao sabe o que o banco fez.
 */
export function lerRespostaDoPedidoDeEspera(
  dado: unknown,
): RespostaDoPedidoDeEspera | null {
  if (!ehObjeto(dado)) {
    return null;
  }
  if (dado.ok === true) {
    const feito = feitoLido(dado);
    return feito === null ? null : { ok: true, ...feito };
  }
  return recusaLida(dado, MOTIVOS_DO_PEDIDO_DE_ESPERA);
}

/** O jsonb de entrar_na_lista_de_espera_pela_ia, lido sem confiar. */
export function lerRespostaDaEntradaNaEspera(
  dado: unknown,
): RespostaDaEntradaNaEspera | null {
  if (!ehObjeto(dado)) {
    return null;
  }
  if (dado.ok === true) {
    const feito = feitoLido(dado);
    return feito === null ? null : { ok: true, ...feito };
  }
  return recusaLida(dado, MOTIVOS_DA_ENTRADA_NA_ESPERA);
}

// ---------------------------------------------------------------------------
// O pedido e a entrada desta conversa, como a porta le (ia_pedido_de_espera)
// ---------------------------------------------------------------------------

/**
 * Um pedido da lista de espera desta conversa, na janela atual da IA (so
 * ids, listas fechadas e instantes; nunca texto do paciente).
 */
export type PedidoDeEsperaLido = {
  id: string;
  /** O job que pediu e escreveu a pergunta T-E1 (a ancora do "sim"). */
  jobId: string;
  procedimentoId: string;
  /** null: qualquer profissional. */
  profissionalId: string | null;
  /** null: particular. */
  convenioId: string | null;
  particular: boolean;
  turnos: PeriodoDaEspera[];
  dias: number[];
  /** ISO (UTC). */
  criadoEm: string;
};

/** O que a porta le no preparo (lerPedidoDeEspera). */
export type EsperaDaConversa = {
  /** O pedido vivo (sem consumo) da janela atual, ou null. */
  vivo: PedidoDeEsperaLido | null;
  /**
   * Os pedidos consumidos nesta janela cuja entrada continua ativa: a pessoa
   * entrou na lista de espera NESTA conversa (o fato do turno seguinte).
   */
  entradas: PedidoDeEsperaLido[];
};

/** Uma linha de ia_pedido_de_espera como a porta le (sem confiar). */
export function pedidoDeEsperaLido(linha: unknown): PedidoDeEsperaLido | null {
  if (!ehObjeto(linha)) {
    return null;
  }
  const turnos = periodosLidos(linha.preferred_shifts);
  const dias = diasLidos(linha.preferred_weekdays);
  const particular = linha.particular;
  const convenioId = textoOuNulo(linha.insurance_id);
  if (
    textoOuNulo(linha.id) === null ||
    textoOuNulo(linha.job_id) === null ||
    textoOuNulo(linha.procedure_id) === null ||
    typeof particular !== "boolean" ||
    particular !== (convenioId === null) ||
    turnos === null ||
    dias === null ||
    !ehInstante(linha.created_at)
  ) {
    return null;
  }
  return {
    id: String(linha.id),
    jobId: String(linha.job_id),
    procedimentoId: String(linha.procedure_id),
    profissionalId: textoOuNulo(linha.professional_id),
    convenioId,
    particular,
    turnos,
    dias,
    criadoEm: new Date(Date.parse(String(linha.created_at))).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// O teto da saida (a reserva do gasto, lib/agente/laco.ts)
// ---------------------------------------------------------------------------

/**
 * Teto, em bytes, de UMA saida das ferramentas da lista de espera ao modelo
 * (a maior e a de ja_na_lista, com a preferencia em texto). Cabe no teto de
 * buscar_horario, que a reserva do gasto ja usa quando a agenda esta ligada
 * (um teste confere).
 */
export function limiteDaSaidaDaListaDeEspera(): number {
  return 640;
}
