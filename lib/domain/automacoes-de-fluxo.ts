import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import {
  chaveDaEtiqueta,
  etiquetaLimpa,
  recusaDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import type { PapelDeEtapa } from "@/lib/domain/jornada";
import type { Role } from "@/lib/domain/permissions";

// Automacoes de fluxo (pedido do dono em 02/10/2026; migration
// 20261002130000_automacoes_de_fluxo.sql). Modulo puro, serve cliente e
// servidor: as opcoes da tela, a frase em portugues de cada regra, os vetos e
// o detector de ciclo que ESPELHAM o banco (validar_automacao_de_fluxo e os
// checks), a traducao das recusas e os textos do historico. O banco continua
// sendo a garantia: o espelho so serve para a tela avisar antes de salvar.
//
// Desde a onda 4 (itens 14 e 15, decisoes do dono de 20/10/2026, D5 a D7 e
// D9; migration 20261024110000_automacoes_compostas.sql) a regra e
// composta: QUANDO o lead esta na ETAPA e acontece o GATILHO, SE as
// condicoes de etiqueta batem (todas ou qualquer uma; nenhuma condicao e
// "sempre"), FAZ as ACOES, de 1 a 5, na ordem, com no maximo um "mover" e
// sempre por ultimo. As condicoes ficam em automacao_condicao e as acoes em
// automacao_acao; a gravacao e uma RPC so (salvar_automacao_de_fluxo). As
// colunas de acao de automacao_fluxo viraram legado (a limpeza e a migration
// C): o codigo novo nao le nem grava nelas.
//
// Nao existe acao de mensagem para o paciente: isso e a regua de follow-up
// da etapa (Automacoes > Follow-up de leads).

// ---------------------------------------------------------------------------
// Quem acessa (decisao do dono de 20/10/2026, onda 4, item 13)

/**
 * Os papeis que veem e mudam as automacoes de fluxo. Desde 20/10/2026 elas
 * moram na tela Automacoes (aba "Automacoes de fluxo", ?aba=fluxo), e nao
 * mais em Configuracoes, mas continuam SO de administrador e gestor: a
 * recepcao ve o resto de Automacoes, nao esta aba; profissional e leitura
 * nem entram em Automacoes (o layout da rota redireciona).
 *
 * Lista propria, e nao a celula "automacoes" da matriz de permissao: ali a
 * recepcao tem "ver", e a aba de fluxo e excecao a isso. Fonte unica da
 * pagina (para os outros papeis a aba nem existe e nada dela e lido) e das
 * Server Actions (o papel e conferido antes de tocar o banco, regra 3.4).
 */
export const PAPEIS_DAS_AUTOMACOES_DE_FLUXO: readonly Role[] = [
  "admin",
  "gestor",
];

export function podeAcessarAutomacoesDeFluxo(role: Role): boolean {
  return PAPEIS_DAS_AUTOMACOES_DE_FLUXO.includes(role);
}

// ---------------------------------------------------------------------------
// Vocabulario (checks do banco)

export const GATILHOS = [
  "tempo_na_etapa",
  "sem_resposta_na_etapa",
  "entrou_na_etapa",
  "mensagem_recebida",
] as const;

export type GatilhoDeAutomacao = (typeof GATILHOS)[number];

export const ACOES = [
  "mover_etapa",
  "etiquetar",
  "criar_atividade",
  "nota_interna",
] as const;

export type AcaoDeAutomacao = (typeof ACOES)[number];

/** As condicoes da 1a versao (D5): a etiqueta do lead ou da conversa. */
export const TIPOS_DE_CONDICAO = ["tem_etiqueta", "nao_tem_etiqueta"] as const;

export type TipoDeCondicao = (typeof TIPOS_DE_CONDICAO)[number];

/** Como as condicoes se juntam (D6): uma escolha por automacao. */
export const COMBINAR = ["todas", "qualquer"] as const;

export type Combinar = (typeof COMBINAR)[number];

/** Check status_de_execucao_valido de automacao_execucao. */
export const STATUS_DE_EXECUCAO = [
  "pendente",
  "executada",
  "pulada",
  "falhou",
] as const;

export type StatusDaExecucao = (typeof STATUS_DE_EXECUCAO)[number];

/** Check do status de automacao_execucao_acao: o retrato de cada acao. */
export const STATUS_DA_ACAO = ["executada", "pulada", "falhou"] as const;

export type StatusDaAcao = (typeof STATUS_DA_ACAO)[number];

/** O unico motivo de perda que a automacao grava (decisao do dono). */
export const MOTIVO_DA_PERDA_DA_AUTOMACAO = "nao_respondeu" as const;

// Limites dos checks do banco.
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 80;
/** espera_na_faixa: de 1 hora a 90 dias, em minutos. */
export const ESPERA_MINIMA_MINUTOS = 60;
export const ESPERA_MAXIMA_MINUTOS = 129_600;
export const TITULO_DA_ATIVIDADE_MINIMO = 2;
export const TITULO_DA_ATIVIDADE_MAXIMO = 120;
export const PRAZO_MAXIMO_DIAS = 365;
export const NOTA_MAXIMA = 2000;
/** Travas da regra composta (D7): ate 5 acoes e ate 5 condicoes. */
export const MAXIMO_DE_ACOES = 5;
export const MAXIMO_DE_CONDICOES = 5;
/** Travas do motor (executar_automacoes_de_fluxo). */
export const SALTOS_EM_CADEIA = 3;
export const MOVIMENTOS_POR_DIA = 10;
/**
 * registrar_mensagem_para_automacao: as mensagens que chegam ate estes
 * minutos depois do nascimento do contato sao a primeira fala dele e nao
 * contam para "Mandou mensagem estando na etapa" (o interval do banco).
 */
export const PRIMEIRA_FALA_MINUTOS = 2;

const MINUTOS_POR_HORA = 60;
const MINUTOS_POR_DIA = 1440;

export function ehGatilhoDeTempo(gatilho: GatilhoDeAutomacao): boolean {
  return gatilho === "tempo_na_etapa" || gatilho === "sem_resposta_na_etapa";
}

// ---------------------------------------------------------------------------
// Formas

/** Uma linha de automacao_acao (o "Faz"), como a tela usa. */
export type AcaoDaAutomacao = {
  posicao: number;
  acao: AcaoDeAutomacao;
  etapa_destino: string | null;
  motivo_perda: typeof MOTIVO_DA_PERDA_DA_AUTOMACAO | null;
  etiqueta: string | null;
  atividade_titulo: string | null;
  atividade_prazo_dias: number | null;
  nota_texto: string | null;
};

/** Uma linha de automacao_condicao (o "Se"). A etiqueta e o NOME. */
export type CondicaoDaAutomacao = {
  posicao: number;
  tipo: TipoDeCondicao;
  etiqueta: string;
};

/** Uma regra, com as condicoes e as acoes dela, como a tela usa. */
export type AutomacaoDeFluxo = {
  id: string;
  nome: string;
  ativa: boolean;
  gatilho: GatilhoDeAutomacao;
  etapa: string;
  espera_minutos: number | null;
  combinar: Combinar;
  /** Em ordem de posicao; vazia: roda para todo lead (sem "Se"). */
  condicoes: CondicaoDaAutomacao[];
  /** Na ordem em que rodam: o mover, se houver, e sempre o ultimo. */
  acoes: AcaoDaAutomacao[];
  vigente_desde: string;
  created_at: string;
  updated_at: string;
};

const acaoDaLinhaSchema = z.object({
  posicao: z.number().int(),
  acao: z.enum(ACOES),
  etapa_destino: z.string().nullable(),
  motivo_perda: z.literal(MOTIVO_DA_PERDA_DA_AUTOMACAO).nullable(),
  etiqueta: z.string().nullable(),
  atividade_titulo: z.string().nullable(),
  atividade_prazo_dias: z.number().int().nullable(),
  nota_texto: z.string().nullable(),
});

const condicaoDaLinhaSchema = z.object({
  posicao: z.number().int(),
  tipo: z.enum(TIPOS_DE_CONDICAO),
  etiqueta: z.string(),
});

/**
 * Valida a linha lida do banco (a regra com as filhas embutidas): os tipos
 * gerados dizem "string" para gatilho e acao, e a tela precisa saber que e
 * um dos valores conhecidos. As filhas saem ordenadas pela posicao, e o
 * mover vai para o fim (o banco ja grava assim; aqui e defesa).
 */
export const automacaoDeFluxoLinhaSchema = z
  .object({
    id: z.string(),
    nome: z.string(),
    ativa: z.boolean(),
    gatilho: z.enum(GATILHOS),
    etapa: z.string(),
    espera_minutos: z.number().int().nullable(),
    combinar: z.enum(COMBINAR),
    vigente_desde: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    condicoes: z.array(condicaoDaLinhaSchema).nullable().optional(),
    acoes: z.array(acaoDaLinhaSchema).nullable().optional(),
  })
  .transform((linha): AutomacaoDeFluxo => ({
    ...linha,
    condicoes: [...(linha.condicoes ?? [])].sort(
      (a, b) => a.posicao - b.posicao,
    ),
    acoes: ordenarAcoes(
      [...(linha.acoes ?? [])].sort((a, b) => a.posicao - b.posicao),
    ),
  }));

/** O retrato de UMA acao numa execucao (automacao_execucao_acao). */
export type ExecucaoDaAcao = {
  posicao: number;
  acao: AcaoDeAutomacao;
  status: StatusDaAcao;
  motivo: string | null;
  para_etapa: string | null;
  etiqueta: string | null;
  etiqueta_nome: string | null;
  executada_em: string | null;
};

/** Uma linha do historico (automacao_execucao). Sem conteudo de mensagem. */
export type ExecucaoDeAutomacao = {
  id: string;
  automacao_id: string;
  status: StatusDaExecucao;
  motivo: string | null;
  de_etapa: string;
  para_etapa: string | null;
  /**
   * O retrato do que a regra fez NESTA execucao, gravado pelo motor (so em
   * executada): a regra pode mudar de acao ou de etiqueta depois. Nulo em
   * execucao que nao rodou, gravada sem o retrato, ou com varias acoes (ai
   * o retrato e por acao, em `acoes`).
   */
  acao: AcaoDeAutomacao | null;
  /** Chave da etiqueta posta (so quando acao = etiquetar). */
  etiqueta: string | null;
  /** Nome que a etiqueta tinha na hora. */
  etiqueta_nome: string | null;
  executada_em: string | null;
  created_at: string;
  /** Nome do contato (dado de paciente: a leitura e auditada). */
  contato: string | null;
  /**
   * O retrato de cada acao (onda 4), na ordem. Vazio nas execucoes de antes
   * da onda 4 e nas puladas por uma guarda antes da primeira acao.
   */
  acoes: ExecucaoDaAcao[];
};

/** Quantas vezes a regra fez o que manda, e quando foi a ultima. */
export type UsoDaAutomacao = { vezes: number; ultima: string | null };

/** RPC previa_da_automacao_de_fluxo: contagens, sem dado de paciente. */
export const previaDaAutomacaoSchema = z.object({
  na_etapa: z.number().int().min(0),
  ja_se_encaixam: z.number().int().min(0),
  importados_fora: z.number().int().min(0),
});

export type PreviaDaAutomacao = z.infer<typeof previaDaAutomacaoSchema>;

/** O que a tela e os vetos precisam de cada etapa da jornada. */
export type EtapaParaAutomacao = {
  chave: string;
  nome: string;
  papel: PapelDeEtapa | null;
};

// ---------------------------------------------------------------------------
// Opcoes da tela, em linguagem de recepcao

export const OPCOES_DE_GATILHO: readonly {
  valor: GatilhoDeAutomacao;
  rotulo: string;
  ajuda: string;
}[] = [
  {
    valor: "tempo_na_etapa",
    rotulo: "Ficou um tempo na etapa",
    ajuda: "O tempo conta a partir de quando o lead entrou na etapa.",
  },
  {
    valor: "sem_resposta_na_etapa",
    rotulo: "Ficou um tempo sem responder na etapa",
    // Espelho do greatest(funnel_stage_changed_at, last_contact_at) do banco.
    ajuda:
      "O tempo conta da entrada na etapa ou da última mensagem do lead, o que for mais recente. Mensagem da clínica não zera o tempo.",
  },
  {
    valor: "entrou_na_etapa",
    rotulo: "Entrou na etapa",
    ajuda:
      "Vale para qualquer entrada: pelo Kanban, pelo Atendimento, por outra automação e para o lead novo que chega pelo WhatsApp.",
  },
  {
    valor: "mensagem_recebida",
    rotulo: "Mandou mensagem estando na etapa",
    ajuda: `As mensagens dos primeiros ${PRIMEIRA_FALA_MINUTOS} minutos de um contato novo não contam: são a primeira fala dele, que costuma vir em várias mensagens. Se a mensagem tiver um termo da jornada, o termo vence.`,
  },
];

export const OPCOES_DE_ACAO: readonly {
  valor: AcaoDeAutomacao;
  rotulo: string;
  ajuda: string;
}[] = [
  {
    valor: "mover_etapa",
    rotulo: "Mover para outra etapa",
    ajuda:
      "Para a etapa de perda, o motivo é sempre Não respondeu, e quem tem consulta marcada fica onde está.",
  },
  {
    valor: "etiquetar",
    rotulo: "Colocar etiqueta na conversa",
    ajuda:
      "Na conversa mais recente do lead. Lead sem conversa fica sem a etiqueta, e o histórico mostra o motivo.",
  },
  {
    valor: "criar_atividade",
    rotulo: "Criar atividade",
    ajuda:
      "O responsável é quem atende a conversa mais recente do lead. Sem atendente, a atividade fica sem responsável.",
  },
  {
    valor: "nota_interna",
    rotulo: "Deixar nota interna",
    ajuda:
      "Na conversa mais recente do lead, assinada pelo sistema. O paciente nunca vê.",
  },
];

export const OPCOES_DE_CONDICAO: readonly {
  valor: TipoDeCondicao;
  rotulo: string;
}[] = [
  { valor: "tem_etiqueta", rotulo: "O lead tem a etiqueta" },
  { valor: "nao_tem_etiqueta", rotulo: "O lead não tem a etiqueta" },
];

export const OPCOES_DE_COMBINAR: readonly {
  valor: Combinar;
  rotulo: string;
}[] = [
  { valor: "todas", rotulo: "Só roda se todas forem verdade" },
  { valor: "qualquer", rotulo: "Só roda se qualquer uma for verdade" },
];

/** De onde vem a etiqueta que a condicao confere (D1). */
export const AJUDA_DAS_CONDICOES =
  "Vale a etiqueta do lead (Leads) e a da conversa (Atendimento), pelo nome, sem diferença de maiúscula e acento.";

/** A nota fixa da lista de acoes (D7). */
export const NOTA_DO_MOVER =
  "Mover roda sempre por último, depois das outras ações.";

/** Os avisos fixos da aba: o que a automacao nunca faz e onde ela para. */
export const AVISOS_FIXOS: readonly string[] = [
  "Só leads: paciente nunca é movido por automação.",
  "Agendou e Compareceu não são destino: quem leva o lead para essas etapas é a Agenda.",
  "Mover o lead para fora de uma etapa encerra o follow-up daquela etapa.",
  `Automações em cadeia param no ${SALTOS_EM_CADEIA}º salto, e um lead é movido por automação no máximo ${MOVIMENTOS_POR_DIA} vezes em 24 horas.`,
  "Não é retroativa: vale para o que acontecer depois de ligada (ou de mudar o gatilho, a etapa ou o tempo).",
  // D9: a condicao e conferida uma vez, quando o gatilho acontece.
  "As condições são conferidas na hora do gatilho: quem não bate fica de fora daquela vez.",
];

// ---------------------------------------------------------------------------
// Espera (horas ou dias na tela, minutos no banco)

export type UnidadeDaEspera = "horas" | "dias";

export function esperaEmMinutos(
  valor: number,
  unidade: UnidadeDaEspera,
): number {
  return valor * (unidade === "dias" ? MINUTOS_POR_DIA : MINUTOS_POR_HORA);
}

/**
 * Dias quando cabe em dias inteiros a partir de 3 (72 h vira "3 dias"); horas
 * no resto (24 h e 48 h ficam em horas, que e como a recepcao fala). A mesma
 * regra vale para a frase e para reabrir a regra no dialogo.
 */
function cabeEmDias(minutos: number): boolean {
  return minutos % MINUTOS_POR_DIA === 0 && minutos >= 3 * MINUTOS_POR_DIA;
}

export function esperaParaEdicao(minutos: number): {
  valor: number;
  unidade: UnidadeDaEspera;
} {
  if (cabeEmDias(minutos)) {
    return { valor: minutos / MINUTOS_POR_DIA, unidade: "dias" };
  }
  // Fracao de hora so nasce fora da tela (service role): arredonda, com piso
  // de 1 hora (o minimo do banco).
  return {
    valor: Math.max(1, Math.round(minutos / MINUTOS_POR_HORA)),
    unidade: "horas",
  };
}

/** "3 dias", "1 dia" (nunca, pela regra de cima), "48 h", "1 h 30 min". */
export function textoDaEspera(minutos: number): string {
  if (cabeEmDias(minutos)) {
    const dias = minutos / MINUTOS_POR_DIA;
    return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  }
  const horas = Math.floor(minutos / MINUTOS_POR_HORA);
  const resto = minutos % MINUTOS_POR_HORA;
  if (resto === 0) {
    return `${horas} h`;
  }
  return horas > 0 ? `${horas} h ${resto} min` : `${resto} min`;
}

/** Prazo da atividade: "para o mesmo dia", "em 1 dia", "em 2 dias". */
export function textoDoPrazo(dias: number): string {
  if (dias === 0) {
    return "para o mesmo dia";
  }
  return `em ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

// ---------------------------------------------------------------------------
// Ordem das acoes (D7): o mover, se houver, roda por ultimo

/**
 * As acoes na ordem em que rodam: as outras na ordem dada, e o mover no fim.
 * Mover antes tiraria o lead da etapa, e o CAS das outras derrubaria a
 * etiqueta, a atividade e a nota.
 */
export function ordenarAcoes<T extends { acao: AcaoDeAutomacao }>(
  acoes: readonly T[],
): T[] {
  return [
    ...acoes.filter((acao) => acao.acao !== "mover_etapa"),
    ...acoes.filter((acao) => acao.acao === "mover_etapa"),
  ];
}

/** O destino do mover da regra, ou null se a regra nao move. */
export function destinoDoMover(
  acoes: readonly Pick<AcaoDaAutomacao, "acao" | "etapa_destino">[],
): string | null {
  return (
    acoes.find((acao) => acao.acao === "mover_etapa")?.etapa_destino ?? null
  );
}

// ---------------------------------------------------------------------------
// A regra em portugues

type ResolverNome = (chave: string) => string;

/** Nome pela chave; chave desconhecida (cache velho) aparece crua. */
export function resolvedorDeNomes(
  itens: readonly { chave: string; nome: string }[] | null | undefined,
): ResolverNome {
  const mapa = new Map((itens ?? []).map((item) => [item.chave, item.nome]));
  return (chave) => mapa.get(chave) ?? chave;
}

function comMaiuscula(texto: string): string {
  return texto.replace(/^./, (letra) => letra.toUpperCase());
}

/**
 * "a, b e c" ou "a, b ou c". Com virgula dentro do penultimo item (a
 * atividade leva o prazo depois de uma virgula), a ligacao ganha virgula
 * tambem: "cria a atividade Ligar, para o mesmo dia, e move para Perdido".
 */
function juntar(partes: readonly string[], ligacao: "e" | "ou"): string {
  if (partes.length <= 1) {
    return partes[0] ?? "";
  }
  const penultima = partes[partes.length - 2] ?? "";
  const separador = penultima.includes(",") ? `, ${ligacao} ` : ` ${ligacao} `;
  return `${partes.slice(0, -1).join(", ")}${separador}${partes[partes.length - 1]}`;
}

/**
 * "Ficou 3 dias em Em contato", "Ficou 48 h sem responder em Em contato",
 * "Entrou em Aguardando resposta", "Mandou mensagem estando em Novo".
 */
export function descreverGatilho(
  regra: Pick<AutomacaoDeFluxo, "gatilho" | "etapa" | "espera_minutos">,
  nomeDaEtapa: ResolverNome,
): string {
  const etapa = nomeDaEtapa(regra.etapa);
  const espera =
    regra.espera_minutos === null ? "" : textoDaEspera(regra.espera_minutos);
  switch (regra.gatilho) {
    case "tempo_na_etapa":
      return `Ficou ${espera} em ${etapa}`;
    case "sem_resposta_na_etapa":
      return `Ficou ${espera} sem responder em ${etapa}`;
    case "entrou_na_etapa":
      return `Entrou em ${etapa}`;
    case "mensagem_recebida":
      return `Mandou mensagem estando em ${etapa}`;
  }
}

/** "tem a etiqueta Psiquiatria" ou "não tem a etiqueta Retorno". */
function fraseDaCondicao(
  condicao: Pick<CondicaoDaAutomacao, "tipo" | "etiqueta">,
): string {
  return condicao.tipo === "tem_etiqueta"
    ? `tem a etiqueta ${condicao.etiqueta}`
    : `não tem a etiqueta ${condicao.etiqueta}`;
}

/**
 * O "Se" da regra: "O lead tem a etiqueta Psiquiatria e não tem a etiqueta
 * Retorno". Sem condicao, null (a regra vale para todo lead do Quando).
 */
export function descreverCondicoes(
  regra: Pick<AutomacaoDeFluxo, "combinar"> & {
    condicoes: readonly Pick<CondicaoDaAutomacao, "tipo" | "etiqueta">[];
  },
): string | null {
  if (regra.condicoes.length === 0) {
    return null;
  }
  const frases = regra.condicoes.map(fraseDaCondicao);
  return `O lead ${juntar(frases, regra.combinar === "todas" ? "e" : "ou")}`;
}

type AcaoParaFrase = Pick<
  AcaoDaAutomacao,
  | "acao"
  | "etapa_destino"
  | "motivo_perda"
  | "etiqueta"
  | "atividade_titulo"
  | "atividade_prazo_dias"
>;

/**
 * Uma acao em minusculas, para entrar na frase da regra: "move para Perdido
 * (Não respondeu)", "etiqueta a conversa com Retorno", "cria a atividade
 * Ligar, para o mesmo dia", "deixa uma nota interna".
 */
export function fraseDaAcao(
  acao: AcaoParaFrase,
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): string {
  switch (acao.acao) {
    case "mover_etapa": {
      const destino = acao.etapa_destino
        ? nomes.etapa(acao.etapa_destino)
        : "outra etapa";
      return acao.motivo_perda
        ? `move para ${destino} (Não respondeu)`
        : `move para ${destino}`;
    }
    case "etiquetar":
      return acao.etiqueta
        ? `etiqueta a conversa com ${nomes.etiqueta(acao.etiqueta)}`
        : "etiqueta a conversa";
    case "criar_atividade":
      return `cria a atividade ${acao.atividade_titulo ?? ""}, ${textoDoPrazo(acao.atividade_prazo_dias ?? 0)}`;
    case "nota_interna":
      return "deixa uma nota interna";
  }
}

/**
 * O "Faz" da regra, na ordem em que roda: "Cria a atividade Ligar, para o
 * mesmo dia, e move para Follow 2". Sem acao (nao acontece pelo banco),
 * "Nenhuma ação".
 */
export function descreverAcoes(
  acoes: readonly AcaoParaFrase[],
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): string {
  if (acoes.length === 0) {
    return "Nenhuma ação";
  }
  return comMaiuscula(
    juntar(
      ordenarAcoes(acoes).map((acao) => fraseDaAcao(acao, nomes)),
      "e",
    ),
  );
}

/**
 * A regra numa frase so, para o dialogo de ligar: "Ficou 24 h em Follow 1,
 * se o lead tem a etiqueta X: cria a atividade Ligar, para o mesmo dia, e
 * move para Follow 2."
 */
export function descreverRegra(
  regra: Pick<
    AutomacaoDeFluxo,
    "gatilho" | "etapa" | "espera_minutos" | "combinar"
  > & {
    condicoes: readonly Pick<CondicaoDaAutomacao, "tipo" | "etiqueta">[];
    acoes: readonly AcaoParaFrase[];
  },
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): string {
  const quando = descreverGatilho(regra, nomes.etapa);
  const se = descreverCondicoes(regra);
  const faz = descreverAcoes(regra.acoes, nomes).replace(/^./, (letra) =>
    letra.toLowerCase(),
  );
  return se
    ? `${quando}, se ${se.replace(/^O /, "o ")}: ${faz}.`
    : `${quando}: ${faz}.`;
}

// ---------------------------------------------------------------------------
// Condicoes (espelho do executor; D9: conferidas uma vez, no gatilho)

/**
 * As condicoes batem com as etiquetas do lead (chaves do lead e das
 * conversas dele, pelo nome)? Sem condicao, sempre. "todas" exige cada uma;
 * "qualquer", ao menos uma. O banco decide; isto serve aos testes e a tela.
 */
export function condicoesCasam(
  condicoes: readonly Pick<CondicaoDaAutomacao, "tipo" | "etiqueta">[],
  chavesDoLead: readonly string[],
  combinar: Combinar,
): boolean {
  if (condicoes.length === 0) {
    return true;
  }
  const doLead = new Set(chavesDoLead);
  const resultados = condicoes.map((condicao) => {
    const tem = doLead.has(chaveDaEtiqueta(condicao.etiqueta));
    return condicao.tipo === "tem_etiqueta" ? tem : !tem;
  });
  return combinar === "todas"
    ? resultados.every(Boolean)
    : resultados.some(Boolean);
}

// ---------------------------------------------------------------------------
// Vetos de destino (espelho de validar_acao_de_automacao e dos checks)

export type VetoDoDestino =
  | "sem_destino"
  | "destino_inexistente"
  | "destino_igual_origem"
  | "destino_da_agenda"
  | "perdido_sem_motivo"
  | "motivo_sem_perdido";

export const MENSAGENS_DO_VETO: Record<VetoDoDestino, string> = {
  sem_destino: "Escolha a etapa para onde o lead vai.",
  destino_inexistente:
    "A etapa de destino não existe mais na jornada. Recarregue a página e escolha outra.",
  destino_igual_origem: "O destino precisa ser diferente da etapa de origem.",
  destino_da_agenda:
    "Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.",
  perdido_sem_motivo:
    'Para mover para a etapa de perda, a automação usa o motivo "Não respondeu".',
  motivo_sem_perdido:
    "O motivo da perda só vale quando o destino é a etapa de perda.",
};

/** Etapa que a Agenda marca: nunca destino (conversao falsa para a Meta). */
export function ehEtapaDaAgenda(papel: PapelDeEtapa | null): boolean {
  return papel === "agendou" || papel === "compareceu";
}

/** As etapas que podem receber o lead a partir da origem, na ordem da jornada. */
export function destinosPossiveis<T extends EtapaParaAutomacao>(
  jornada: readonly T[],
  origem: string,
): T[] {
  return jornada.filter(
    (etapa) => etapa.chave !== origem && !ehEtapaDaAgenda(etapa.papel),
  );
}

/** O motivo que a regra grava: so para destino de papel perdido. */
export function motivoDaPerdaPara(
  destino: string | null,
  jornada: readonly EtapaParaAutomacao[],
): typeof MOTIVO_DA_PERDA_DA_AUTOMACAO | null {
  if (destino === null) {
    return null;
  }
  const etapa = jornada.find((item) => item.chave === destino);
  return etapa?.papel === "perdido" ? MOTIVO_DA_PERDA_DA_AUTOMACAO : null;
}

/** O veto do banco para o destino desta regra, ou null se passa. */
export function vetoDoDestino(params: {
  etapa: string;
  etapaDestino: string | null;
  motivoPerda: string | null;
  jornada: readonly EtapaParaAutomacao[];
}): VetoDoDestino | null {
  const { etapa, etapaDestino, motivoPerda, jornada } = params;
  if (etapaDestino === null) {
    return "sem_destino";
  }
  if (etapaDestino === etapa) {
    return "destino_igual_origem";
  }
  const destino = jornada.find((item) => item.chave === etapaDestino);
  if (!destino) {
    return "destino_inexistente";
  }
  if (ehEtapaDaAgenda(destino.papel)) {
    return "destino_da_agenda";
  }
  if (destino.papel === "perdido" && motivoPerda === null) {
    return "perdido_sem_motivo";
  }
  if (destino.papel !== "perdido" && motivoPerda !== null) {
    return "motivo_sem_perdido";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detector de ciclo (espelho do with recursive de automacao_fecha_ciclo)

/** O que o detector precisa de cada regra: de onde e para onde ela move. */
export type RegraParaCiclo = {
  id: string | null;
  ativa: boolean;
  gatilho: GatilhoDeAutomacao;
  etapa: string;
  /** O destino da acao de mover da regra; null se ela nao move. */
  destino: string | null;
};

/** A regra como o detector a ve: o destino sai das acoes (automacao_acao). */
export function regraParaCiclo(
  regra: Pick<AutomacaoDeFluxo, "id" | "ativa" | "gatilho" | "etapa"> & {
    acoes: readonly Pick<AcaoDaAutomacao, "acao" | "etapa_destino">[];
  },
): RegraParaCiclo {
  return {
    id: regra.id,
    ativa: regra.ativa,
    gatilho: regra.gatilho,
    etapa: regra.etapa,
    destino: destinoDoMover(regra.acoes),
  };
}

/**
 * So regra LIGADA com acao de mover, e gatilho que nao e de mensagem, vira
 * aresta: a de mensagem so anda se o lead escrever, entao o vai e volta
 * depende dele. Regra com condicao conta do mesmo jeito (conservador: a
 * condicao pode bater).
 */
export function viraAresta(regra: RegraParaCiclo): boolean {
  return (
    regra.ativa &&
    regra.destino !== null &&
    regra.gatilho !== "mensagem_recebida"
  );
}

/**
 * O caminho do ciclo que a regra fecharia com as OUTRAS regras (a versao
 * antiga dela fica de fora pelo id), da origem ate voltar a ela, ou null. Ex.:
 * ["em_contato", "aguardando_resposta", "em_contato"].
 */
export function cicloDaAutomacao(
  regra: RegraParaCiclo,
  outras: readonly RegraParaCiclo[],
): string[] | null {
  if (!viraAresta(regra) || regra.destino === null) {
    return null;
  }
  const saidas = new Map<string, string[]>();
  for (const outra of outras) {
    if (regra.id !== null && outra.id === regra.id) {
      continue;
    }
    if (!viraAresta(outra) || outra.destino === null) {
      continue;
    }
    const lista = saidas.get(outra.etapa) ?? [];
    lista.push(outra.destino);
    saidas.set(outra.etapa, lista);
  }

  // Busca em largura a partir do destino, guardando de onde veio cada etapa
  // para remontar o caminho.
  const veioDe = new Map<string, string | null>([[regra.destino, null]]);
  const fila = [regra.destino];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    if (atual === regra.etapa) {
      const caminho: string[] = [];
      let passo: string | null = atual;
      while (passo !== null) {
        caminho.unshift(passo);
        passo = veioDe.get(passo) ?? null;
      }
      return [regra.etapa, ...caminho];
    }
    for (const proxima of saidas.get(atual) ?? []) {
      if (!veioDe.has(proxima)) {
        veioDe.set(proxima, atual);
        fila.push(proxima);
      }
    }
  }
  return null;
}

/** "Em contato, Aguardando resposta e de volta a Em contato". */
export function textoDoCiclo(
  caminho: readonly string[],
  nomeDaEtapa: ResolverNome,
): string {
  const nomes = caminho.map(nomeDaEtapa);
  const ida = nomes.slice(0, -1);
  const volta = nomes[nomes.length - 1] ?? "";
  return `${ida.join(", ")} e de volta a ${volta}`;
}

// ---------------------------------------------------------------------------
// Entrada da Server Action (o banco confere de novo)

const chaveSchema = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/, { error: "Escolha uma opção da lista." });

const ERRO_DA_ESPERA = "O tempo vai de 1 hora a 90 dias.";
const ERRO_DO_TITULO = "O que fazer vai de 2 a 120 caracteres.";
const ERRO_DO_PRAZO = "O prazo vai de 0 a 365 dias.";
const ERRO_DA_NOTA = "A nota vai de 1 a 2000 caracteres.";
export const ERRO_DE_DOIS_MOVERES = "Uma automação move o lead uma vez só.";
const ERRO_DA_ETIQUETA_DA_CONDICAO = "Escolha a etiqueta da condição.";

/** Uma acao da regra composta: os campos so da acao escolhida. */
const acaoDaEntradaSchema = z.discriminatedUnion(
  "acao",
  [
    z.object({
      acao: z.literal("mover_etapa"),
      etapa_destino: chaveSchema,
    }),
    z.object({
      acao: z.literal("etiquetar"),
      etiqueta: chaveSchema,
    }),
    z.object({
      acao: z.literal("criar_atividade"),
      atividade_titulo: z
        .string()
        .trim()
        .min(TITULO_DA_ATIVIDADE_MINIMO, { error: ERRO_DO_TITULO })
        .max(TITULO_DA_ATIVIDADE_MAXIMO, { error: ERRO_DO_TITULO }),
      atividade_prazo_dias: z
        .number({ error: ERRO_DO_PRAZO })
        .int({ error: ERRO_DO_PRAZO })
        .min(0, { error: ERRO_DO_PRAZO })
        .max(PRAZO_MAXIMO_DIAS, { error: ERRO_DO_PRAZO }),
    }),
    z.object({
      acao: z.literal("nota_interna"),
      nota_texto: z
        .string()
        .trim()
        .min(1, { error: ERRO_DA_NOTA })
        .max(NOTA_MAXIMA, { error: ERRO_DA_NOTA }),
    }),
  ],
  { error: "Escolha o que a automação faz." },
);

export type AcaoDaEntrada = z.infer<typeof acaoDaEntradaSchema>;

const condicaoDaEntradaSchema = z.object({
  tipo: z.enum(TIPOS_DE_CONDICAO, { error: "Escolha a condição." }),
  etiqueta: z
    .string()
    .transform(etiquetaLimpa)
    .superRefine((etiqueta, ctx) => {
      const recusa =
        etiqueta === ""
          ? ERRO_DA_ETIQUETA_DA_CONDICAO
          : recusaDasEtiquetas([etiqueta], 1);
      if (recusa) {
        ctx.addIssue({ code: "custom", message: recusa });
      }
    }),
});

export const automacaoDeFluxoSchema = z
  .object({
    /** nulo cria; preenchido edita */
    id: z.uuid().nullable(),
    nome: z
      .string()
      .trim()
      .min(NOME_MINIMO, { error: "Dê um nome com pelo menos 2 caracteres." })
      .max(NOME_MAXIMO, { error: "O nome vai até 80 caracteres." }),
    ativa: z.boolean(),
    gatilho: z.enum(GATILHOS, { error: "Escolha quando a automação roda." }),
    etapa: chaveSchema,
    espera_minutos: z
      .number()
      .int({ error: ERRO_DA_ESPERA })
      .min(ESPERA_MINIMA_MINUTOS, { error: ERRO_DA_ESPERA })
      .max(ESPERA_MAXIMA_MINUTOS, { error: ERRO_DA_ESPERA })
      .nullable(),
    combinar: z.enum(COMBINAR, {
      error: "Escolha como as condições se juntam.",
    }),
    condicoes: z.array(condicaoDaEntradaSchema).max(MAXIMO_DE_CONDICOES, {
      error: `Até ${MAXIMO_DE_CONDICOES} condições por automação.`,
    }),
    acoes: z
      .array(acaoDaEntradaSchema)
      .min(1, { error: "Escolha pelo menos uma ação." })
      .max(MAXIMO_DE_ACOES, {
        error: `Até ${MAXIMO_DE_ACOES} ações por automação.`,
      }),
  })
  .superRefine((dados, ctx) => {
    if (ehGatilhoDeTempo(dados.gatilho) && dados.espera_minutos === null) {
      ctx.addIssue({
        code: "custom",
        path: ["espera_minutos"],
        message: "Diga quanto tempo o lead fica antes de a automação rodar.",
      });
    }
    const movers = dados.acoes.filter((acao) => acao.acao === "mover_etapa");
    if (movers.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["acoes"],
        message: ERRO_DE_DOIS_MOVERES,
      });
    }
    for (const mover of movers) {
      if (mover.etapa_destino === dados.etapa) {
        ctx.addIssue({
          code: "custom",
          path: ["acoes"],
          message: MENSAGENS_DO_VETO.destino_igual_origem,
        });
      }
    }
  });

export type EntradaDaAutomacao = z.infer<typeof automacaoDeFluxoSchema>;

/** Uma acao como a RPC salvar_automacao_de_fluxo recebe. */
export type AcaoParaGravar = {
  acao: AcaoDeAutomacao;
  etapa_destino: string | null;
  etiqueta: string | null;
  atividade_titulo: string | null;
  atividade_prazo_dias: number | null;
  nota_texto: string | null;
};

/** O p_regra da RPC salvar_automacao_de_fluxo. */
export type RegraParaGravar = {
  nome: string;
  ativa: boolean;
  gatilho: GatilhoDeAutomacao;
  etapa: string;
  espera_minutos: number | null;
  combinar: Combinar;
  condicoes: { tipo: TipoDeCondicao; etiqueta: string }[];
  acoes: AcaoParaGravar[];
};

/**
 * O jsonb da RPC (no lugar das colunas de antes): a espera so nos gatilhos
 * de tempo; cada acao so com os proprios campos (os outros vao null) e o
 * mover no fim. Sem motivo da perda (o banco tira do papel do destino), sem
 * created_by, updated_by nem vigente_desde (o banco carimba).
 */
export function regraParaGravar(dados: EntradaDaAutomacao): RegraParaGravar {
  return {
    nome: dados.nome,
    ativa: dados.ativa,
    gatilho: dados.gatilho,
    etapa: dados.etapa,
    espera_minutos: ehGatilhoDeTempo(dados.gatilho)
      ? dados.espera_minutos
      : null,
    combinar: dados.combinar,
    condicoes: dados.condicoes.map((condicao) => ({
      tipo: condicao.tipo,
      etiqueta: condicao.etiqueta,
    })),
    acoes: ordenarAcoes(dados.acoes).map((acao) => ({
      acao: acao.acao,
      etapa_destino: acao.acao === "mover_etapa" ? acao.etapa_destino : null,
      etiqueta: acao.acao === "etiquetar" ? acao.etiqueta : null,
      atividade_titulo:
        acao.acao === "criar_atividade" ? acao.atividade_titulo : null,
      atividade_prazo_dias:
        acao.acao === "criar_atividade" ? acao.atividade_prazo_dias : null,
      nota_texto: acao.acao === "nota_interna" ? acao.nota_texto : null,
    })),
  };
}

/** Entrada da previa (a mesma faixa da RPC, que da 22023 fora dela). */
export const previaDaAutomacaoEntradaSchema = z
  .object({
    gatilho: z.enum(GATILHOS),
    etapa: chaveSchema,
    espera_minutos: z
      .number()
      .int()
      .min(ESPERA_MINIMA_MINUTOS)
      .max(ESPERA_MAXIMA_MINUTOS)
      .nullable(),
  })
  .refine(
    (dados) =>
      !ehGatilhoDeTempo(dados.gatilho) || dados.espera_minutos !== null,
    { message: ERRO_DA_ESPERA },
  );

// ---------------------------------------------------------------------------
// Formulario do dialogo (react-hook-form): tudo texto, convertido no envio

const acaoDoFormularioSchema = z.object({
  acao: z.enum(ACOES),
  etapa_destino: z.string(),
  etiqueta: z.string(),
  atividade_titulo: z.string(),
  atividade_prazo_dias: z.string(),
  nota_texto: z.string(),
});

export type ValoresDaAcao = z.infer<typeof acaoDoFormularioSchema>;

const condicaoDoFormularioSchema = z.object({
  tipo: z.enum(TIPOS_DE_CONDICAO),
  etiqueta: z.string(),
});

export type ValoresDaCondicao = z.infer<typeof condicaoDoFormularioSchema>;

export const formularioDaAutomacaoSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(NOME_MINIMO, { error: "Dê um nome com pelo menos 2 caracteres." })
      .max(NOME_MAXIMO, { error: "O nome vai até 80 caracteres." }),
    ativa: z.boolean(),
    gatilho: z.enum(GATILHOS),
    etapa: z.string().min(1, { error: "Escolha a etapa." }),
    espera_valor: z.string(),
    espera_unidade: z.enum(["horas", "dias"]),
    combinar: z.enum(COMBINAR),
    condicoes: z.array(condicaoDoFormularioSchema).max(MAXIMO_DE_CONDICOES, {
      error: `Até ${MAXIMO_DE_CONDICOES} condições por automação.`,
    }),
    acoes: z
      .array(acaoDoFormularioSchema)
      .min(1, { error: "Escolha pelo menos uma ação." })
      .max(MAXIMO_DE_ACOES, {
        error: `Até ${MAXIMO_DE_ACOES} ações por automação.`,
      }),
  })
  .superRefine((valores, ctx) => {
    if (ehGatilhoDeTempo(valores.gatilho)) {
      const minutos = minutosDoFormulario(valores);
      if (
        minutos === null ||
        minutos < ESPERA_MINIMA_MINUTOS ||
        minutos > ESPERA_MAXIMA_MINUTOS
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["espera_valor"],
          message: ERRO_DA_ESPERA,
        });
      }
    }
    if (
      valores.acoes.filter((acao) => acao.acao === "mover_etapa").length > 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["acoes"],
        message: ERRO_DE_DOIS_MOVERES,
      });
    }
    valores.acoes.forEach((acao, indice) => {
      const campo = (nome: keyof ValoresDaAcao) => ["acoes", indice, nome];
      if (acao.acao === "mover_etapa") {
        if (acao.etapa_destino === "") {
          ctx.addIssue({
            code: "custom",
            path: campo("etapa_destino"),
            message: MENSAGENS_DO_VETO.sem_destino,
          });
        } else if (acao.etapa_destino === valores.etapa) {
          ctx.addIssue({
            code: "custom",
            path: campo("etapa_destino"),
            message: MENSAGENS_DO_VETO.destino_igual_origem,
          });
        }
      }
      if (acao.acao === "etiquetar" && acao.etiqueta === "") {
        ctx.addIssue({
          code: "custom",
          path: campo("etiqueta"),
          message: "Escolha a etiqueta.",
        });
      }
      if (acao.acao === "criar_atividade") {
        const titulo = acao.atividade_titulo.trim();
        if (
          titulo.length < TITULO_DA_ATIVIDADE_MINIMO ||
          titulo.length > TITULO_DA_ATIVIDADE_MAXIMO
        ) {
          ctx.addIssue({
            code: "custom",
            path: campo("atividade_titulo"),
            message: ERRO_DO_TITULO,
          });
        }
        const prazo = inteiroDoTexto(acao.atividade_prazo_dias);
        if (prazo === null || prazo < 0 || prazo > PRAZO_MAXIMO_DIAS) {
          ctx.addIssue({
            code: "custom",
            path: campo("atividade_prazo_dias"),
            message: ERRO_DO_PRAZO,
          });
        }
      }
      if (acao.acao === "nota_interna") {
        const nota = acao.nota_texto.trim();
        if (nota.length === 0 || nota.length > NOTA_MAXIMA) {
          ctx.addIssue({
            code: "custom",
            path: campo("nota_texto"),
            message: ERRO_DA_NOTA,
          });
        }
      }
    });
    valores.condicoes.forEach((condicao, indice) => {
      const etiqueta = etiquetaLimpa(condicao.etiqueta);
      const recusa =
        etiqueta === ""
          ? ERRO_DA_ETIQUETA_DA_CONDICAO
          : recusaDasEtiquetas([etiqueta], 1);
      if (recusa) {
        ctx.addIssue({
          code: "custom",
          path: ["condicoes", indice, "etiqueta"],
          message: recusa,
        });
      }
    });
  });

export type ValoresDaAutomacao = z.infer<typeof formularioDaAutomacaoSchema>;

/** "12" vira 12; vazio, fracao ou texto viram null. */
function inteiroDoTexto(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,6}$/.test(limpo)) {
    return null;
  }
  return Number(limpo);
}

/** Os minutos do formulario, ou null quando o numero nao e inteiro. */
export function minutosDoFormulario(
  valores: Pick<ValoresDaAutomacao, "espera_valor" | "espera_unidade">,
): number | null {
  const valor = inteiroDoTexto(valores.espera_valor);
  if (valor === null) {
    return null;
  }
  return esperaEmMinutos(valor, valores.espera_unidade);
}

/** Uma acao em branco do tipo pedido, para "Adicionar ação". */
export function acaoEmBranco(acao: AcaoDeAutomacao): ValoresDaAcao {
  return {
    acao,
    etapa_destino: "",
    etiqueta: "",
    atividade_titulo: "",
    atividade_prazo_dias: "1",
    nota_texto: "",
  };
}

/** Uma condicao em branco, para "Adicionar condição". */
export function condicaoEmBranco(): ValoresDaCondicao {
  return { tipo: "tem_etiqueta", etiqueta: "" };
}

function acaoParaValores(acao: AcaoDaAutomacao): ValoresDaAcao {
  return {
    acao: acao.acao,
    etapa_destino: acao.etapa_destino ?? "",
    etiqueta: acao.etiqueta ?? "",
    atividade_titulo: acao.atividade_titulo ?? "",
    atividade_prazo_dias: String(acao.atividade_prazo_dias ?? 1),
    nota_texto: acao.nota_texto ?? "",
  };
}

/** Valores iniciais do dialogo: a regra existente ou uma em branco. */
export function valoresIniciais(
  regra: AutomacaoDeFluxo | null,
): ValoresDaAutomacao {
  if (!regra) {
    return {
      nome: "",
      ativa: false,
      gatilho: "tempo_na_etapa",
      etapa: "",
      espera_valor: "3",
      espera_unidade: "dias",
      combinar: "todas",
      condicoes: [],
      acoes: [acaoEmBranco("mover_etapa")],
    };
  }
  const espera =
    regra.espera_minutos === null
      ? { valor: 3, unidade: "dias" as const }
      : esperaParaEdicao(regra.espera_minutos);
  return {
    nome: regra.nome,
    ativa: regra.ativa,
    gatilho: regra.gatilho,
    etapa: regra.etapa,
    espera_valor: String(espera.valor),
    espera_unidade: espera.unidade,
    combinar: regra.combinar,
    condicoes: regra.condicoes.map((condicao) => ({
      tipo: condicao.tipo,
      etiqueta: condicao.etiqueta,
    })),
    acoes:
      regra.acoes.length > 0
        ? ordenarAcoes(regra.acoes).map(acaoParaValores)
        : [acaoEmBranco("mover_etapa")],
  };
}

/** Uma acao do formulario para a entrada da Server Action. */
function acaoDaEntrada(valores: ValoresDaAcao): AcaoDaEntrada {
  switch (valores.acao) {
    case "mover_etapa":
      return { acao: "mover_etapa", etapa_destino: valores.etapa_destino };
    case "etiquetar":
      return { acao: "etiquetar", etiqueta: valores.etiqueta };
    case "criar_atividade":
      return {
        acao: "criar_atividade",
        atividade_titulo: valores.atividade_titulo.trim(),
        atividade_prazo_dias:
          inteiroDoTexto(valores.atividade_prazo_dias) ?? -1,
      };
    case "nota_interna":
      return { acao: "nota_interna", nota_texto: valores.nota_texto.trim() };
  }
}

/** Do formulario para a entrada da Server Action (o mover vai no fim). */
export function entradaDoFormulario(
  valores: ValoresDaAutomacao,
  id: string | null,
): EntradaDaAutomacao {
  return {
    id,
    nome: valores.nome.trim(),
    ativa: valores.ativa,
    gatilho: valores.gatilho,
    etapa: valores.etapa,
    espera_minutos: ehGatilhoDeTempo(valores.gatilho)
      ? minutosDoFormulario(valores)
      : null,
    combinar: valores.combinar,
    condicoes: valores.condicoes.map((condicao) => ({
      tipo: condicao.tipo,
      etiqueta: etiquetaLimpa(condicao.etiqueta),
    })),
    acoes: ordenarAcoes(valores.acoes).map(acaoDaEntrada),
  };
}

// ---------------------------------------------------------------------------
// Recusas do banco, traduzidas pelo codigo, pelo hint e pela constraint

export type ErroDoBanco = {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
} | null;

const RECUSAS_POR_HINT: Record<string, string> = {
  automacao_destino_da_agenda: MENSAGENS_DO_VETO.destino_da_agenda,
  automacao_perdido_sem_motivo: MENSAGENS_DO_VETO.perdido_sem_motivo,
  automacao_motivo_sem_perdido: MENSAGENS_DO_VETO.motivo_sem_perdido,
  automacao_destino_igual_origem: MENSAGENS_DO_VETO.destino_igual_origem,
  automacao_ciclo:
    "Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.",
};

// A ordem importa onde um nome contem outro: o do destino vem antes do da
// origem. Os trechos casam com a constraint de automacao_fluxo (as de antes)
// e com as de automacao_acao e automacao_condicao (onda 4): o banco grava as
// acoes e as condicoes nas tabelas filhas, com os MESMOS checks por acao.
const RECUSAS_POR_CONSTRAINT: readonly { trecho: string; mensagem: string }[] =
  [
    {
      trecho: "etapa_destino_fkey",
      mensagem: MENSAGENS_DO_VETO.destino_inexistente,
    },
    {
      trecho: "automacao_fluxo_etapa_fkey",
      mensagem:
        "A etapa escolhida não existe mais na jornada. Recarregue a página e escolha outra.",
    },
    {
      trecho: "etiqueta_fkey",
      mensagem:
        "A etiqueta escolhida não existe mais. Recarregue a página e escolha outra.",
    },
    {
      trecho: "automacao_acao_um_mover",
      mensagem: ERRO_DE_DOIS_MOVERES,
    },
    {
      trecho: "nome_de_automacao_com_tamanho",
      mensagem: "O nome vai de 2 a 80 caracteres.",
    },
    {
      trecho: "gatilho_de_automacao_valido",
      mensagem: "Escolha quando a automação roda.",
    },
    {
      trecho: "acao_de_automacao_valida",
      mensagem: "Escolha o que a automação faz.",
    },
    {
      trecho: "espera_so_nos_gatilhos_de_tempo",
      mensagem: "O tempo de espera só vale para os gatilhos de tempo.",
    },
    { trecho: "espera_na_faixa", mensagem: ERRO_DA_ESPERA },
    {
      trecho: "acao_mover_tem_destino",
      mensagem: MENSAGENS_DO_VETO.sem_destino,
    },
    {
      trecho: "destino_diferente_da_origem",
      mensagem: MENSAGENS_DO_VETO.destino_igual_origem,
    },
    {
      trecho: "motivo_de_perda_da_automacao",
      mensagem: MENSAGENS_DO_VETO.motivo_sem_perdido,
    },
    {
      trecho: "acao_etiquetar_tem_etiqueta",
      mensagem: "Escolha a etiqueta.",
    },
    {
      trecho: "acao_atividade_tem_titulo_e_prazo",
      mensagem: "Diga o que fazer e em quantos dias a atividade vence.",
    },
    {
      trecho: "titulo_de_atividade_da_automacao",
      mensagem: ERRO_DO_TITULO,
    },
    {
      trecho: "prazo_de_atividade_da_automacao",
      mensagem: ERRO_DO_PRAZO,
    },
    { trecho: "acao_nota_tem_texto", mensagem: "Escreva o texto da nota." },
    {
      trecho: "nota_da_automacao_com_tamanho",
      mensagem: ERRO_DA_NOTA,
    },
    {
      trecho: "combinar",
      mensagem: "Escolha como as condições se juntam.",
    },
    {
      // Qualquer check de automacao_condicao (etiquetas_validas, tipo,
      // posicao): o que a pessoa pode mudar e a etiqueta.
      trecho: "automacao_condicao",
      mensagem:
        "Confira as condições: cada etiqueta vai de 1 a 40 caracteres, e são até 5 condições.",
    },
  ];

export const DICA_SEM_PERMISSAO =
  "Somente administradores e gestores mudam as automações de fluxo.";

/**
 * Excluir etiqueta usada por automacao: proteger_etiqueta_de_conversa recusa
 * com o hint etiqueta_usada_por_automacao (migration 20261002130000). A aba
 * Etiquetas mostra este texto, que diz onde resolver: desde 20/10/2026 a aba
 * de automacoes de fluxo mora na tela Automacoes, e nao em Configuracoes.
 */
export const RECUSA_DA_ETIQUETA_USADA =
  "Esta etiqueta é usada por uma automação de fluxo. Exclua a automação ou troque a etiqueta dela em Automações, na aba Automações de fluxo, antes de excluir a etiqueta.";

/**
 * Excluir ou renomear etiqueta do catalogo cujo NOME esta num filtro (uma
 * condicao de automacao ou uma regua de follow-up por etiqueta; onda 4, D1:
 * a etiqueta da conversa conta pelo nome, e o filtro deixaria de casar em
 * silencio). O banco recusa com a mensagem dele; quando ela nao vem
 * (formato inesperado), este texto diz onde trocar.
 */
export const RECUSA_DA_ETIQUETA_EM_FILTRO =
  "Esta etiqueta está no filtro de uma automação de fluxo ou de uma régua de follow-up. Troque a etiqueta em Automações antes de excluir ou renomear.";

/**
 * A recusa de mexer em etiqueta usada por automacao (ou num filtro), ou
 * null se for outra. A recusa de filtro (P0001 com hint de etiqueta, onda 4)
 * passa a mensagem do banco, que ja diz onde trocar.
 */
export function recusaDaEtiquetaUsadaPorAutomacao(
  erro: ErroDoBanco,
): string | null {
  if (!erro) {
    return null;
  }
  if (
    erro.hint === "etiqueta_usada_por_automacao" ||
    (erro.message ?? "").includes(
      "Esta etiqueta é usada por uma automação de fluxo",
    )
  ) {
    return RECUSA_DA_ETIQUETA_USADA;
  }
  const hint = erro.hint ?? "";
  if (
    erro.code === "P0001" &&
    hint.startsWith("etiqueta_") &&
    (hint.includes("filtro") || hint.includes("regua"))
  ) {
    const mensagem = (erro.message ?? "").trim();
    return mensagem.length > 0 && !/[\u2013\u2014]/.test(mensagem)
      ? mensagem
      : RECUSA_DA_ETIQUETA_EM_FILTRO;
  }
  return null;
}

/**
 * Excluir etapa usada por automacao (como origem ou destino): proteger_jornada
 * recusa com o hint etapa_usada_por_automacao (migration 20261002130000). A
 * aba Jornada mostra este texto. O mesmo texto esta em RECUSAS_DA_JORNADA
 * (lib/domain/jornada.ts), para quem traduz so pela mensagem; um teste de
 * unidade confere que os dois nao se desencontram. Desde 20/10/2026 diz que
 * a aba fica em Automacoes.
 */
export const RECUSA_DA_ETAPA_USADA =
  "Esta etapa é usada por uma automação de fluxo. Exclua a automação ou troque a etapa dela em Automações, na aba Automações de fluxo, antes de excluir a etapa.";

/** A recusa de excluir etapa usada por automacao, ou null se for outra. */
export function recusaDaEtapaUsadaPorAutomacao(
  erro: ErroDoBanco,
): string | null {
  if (!erro) {
    return null;
  }
  if (
    erro.hint === "etapa_usada_por_automacao" ||
    (erro.message ?? "").includes(
      "Esta etapa é usada por uma automação de fluxo",
    )
  ) {
    return RECUSA_DA_ETAPA_USADA;
  }
  return null;
}

/** A mensagem que a tela mostra para a recusa do banco, ou o padrao. */
export function mensagemDaRecusaDaAutomacao(
  erro: ErroDoBanco,
  padrao: string,
): string {
  if (!erro) {
    return padrao;
  }
  if (erro.code === "42501") {
    return DICA_SEM_PERMISSAO;
  }
  if (erro.code === "22023") {
    return ERRO_DA_ESPERA;
  }
  const hint = erro.hint ?? "";
  if (erro.code === "23514" && RECUSAS_POR_HINT[hint]) {
    return RECUSAS_POR_HINT[hint];
  }
  if (erro.code === "23514" || erro.code === "23503" || erro.code === "23505") {
    const texto = `${erro.message ?? ""} ${erro.details ?? ""}`;
    const recusa = RECUSAS_POR_CONSTRAINT.find(({ trecho }) =>
      texto.includes(trecho),
    );
    if (recusa) {
      return recusa.mensagem;
    }
  }
  return padrao;
}

/** Codigos de "a funcao ainda nao existe no banco" (PostgREST e Postgres). */
export const FUNCAO_AUSENTE = new Set(["PGRST202", "42883"]);

/** Codigos do "Salvar" que nao sao do mensagemDaRecusaDaAutomacao. */
export const RECUSAS_AO_SALVAR = {
  /** 22023 da RPC: contagem de acoes e condicoes fora do limite. */
  limites: `Uma automação tem de 1 a ${MAXIMO_DE_ACOES} ações, até ${MAXIMO_DE_CONDICOES} condições e move o lead uma vez só.`,
  /** 22023 com hint automacao_acoes. */
  acoes: `Uma automação tem de 1 a ${MAXIMO_DE_ACOES} ações.`,
  /** 22023 com hint automacao_condicoes. */
  condicoes: `Uma automação tem até ${MAXIMO_DE_CONDICOES} condições.`,
  /** 22023 com hint automacao_regra_invalida: a forma do jsonb. */
  invalida: "Confira os campos da automação e salve de novo.",
  /** P0002: id que nao e desta clinica, ou que foi excluido. */
  naoExiste:
    "Esta automação não existe mais. Recarregue a página para ver a lista atual.",
  /**
   * A RPC nao respondeu como funcao que existe (PGRST202 ou 42883: o cache
   * do PostgREST atrasado, ou o banco sem a migration 20261024110000). Nada
   * foi gravado: falha fechada, sem caminho de escrita alternativo
   * (correcao de 22/10/2026).
   */
  indisponivel:
    "Não foi possível salvar a automação agora. Nada foi alterado. Tente de novo em alguns minutos.",
} as const;

/**
 * A recusa do "Salvar" (RPC salvar_automacao_de_fluxo): 22023 sao os
 * limites da regra composta (e nao a faixa da previa), P0002 a regra que nao
 * existe (sem dizer se existe em outra clinica), funcao ausente (falha
 * fechada: nada foi gravado); o resto como as outras escritas.
 */
export function mensagemDaRecusaAoSalvar(
  erro: ErroDoBanco,
  padrao: string,
): string {
  if (!erro) {
    return padrao;
  }
  if (erro.code === "22023") {
    switch (erro.hint) {
      case "automacao_acoes":
        return RECUSAS_AO_SALVAR.acoes;
      case "automacao_condicoes":
        return RECUSAS_AO_SALVAR.condicoes;
      case "automacao_um_mover":
        return ERRO_DE_DOIS_MOVERES;
      case "automacao_regra_invalida":
        return RECUSAS_AO_SALVAR.invalida;
      default:
        return RECUSAS_AO_SALVAR.limites;
    }
  }
  if (erro.code === "P0002") {
    return RECUSAS_AO_SALVAR.naoExiste;
  }
  if (erro.code && FUNCAO_AUSENTE.has(erro.code)) {
    return RECUSAS_AO_SALVAR.indisponivel;
  }
  return mensagemDaRecusaDaAutomacao(erro, padrao);
}

// ---------------------------------------------------------------------------
// Previa (a regra nao e retroativa)

type QuandoRoda = Pick<
  AutomacaoDeFluxo,
  "ativa" | "gatilho" | "etapa" | "espera_minutos"
>;

/**
 * Espelho de validar_automacao_de_fluxo: vigente_desde volta a now() na
 * regra nova, ao ligar (desligada para ligada) e ao mudar gatilho, etapa ou
 * espera. So entao a previa ("ja passaram do ponto e nao serao afetados")
 * diz a verdade; editar o nome, as condicoes ou as acoes de uma regra ligada
 * nao recomeca.
 */
export function recomecaAVigencia(
  antes: QuandoRoda | null,
  depois: QuandoRoda,
): boolean {
  if (!antes) {
    return true;
  }
  return (
    (depois.ativa && !antes.ativa) ||
    depois.gatilho !== antes.gatilho ||
    depois.etapa !== antes.etapa ||
    depois.espera_minutos !== antes.espera_minutos
  );
}

function leads(n: number): string {
  return n === 1 ? "1 lead" : `${n} leads`;
}

/**
 * O que a tela diz antes de ligar ou salvar. Gatilho de tempo: "N leads ja
 * passaram do tempo e nao serao afetados". Entrada: os que ja estao na
 * etapa. Mensagem: vale a proxima.
 */
export function textoDaPrevia(
  previa: PreviaDaAutomacao,
  gatilho: GatilhoDeAutomacao,
  nomeDaEtapa: string,
): { principal: string; importados: string | null } {
  const importados =
    previa.importados_fora > 0
      ? `${leads(previa.importados_fora)} ${previa.importados_fora === 1 ? "importado que nunca mudou" : "importados que nunca mudaram"} de etapa ${previa.importados_fora === 1 ? "fica" : "ficam"} de fora.`
      : null;
  const n = previa.ja_se_encaixam;
  let principal: string;
  if (ehGatilhoDeTempo(gatilho)) {
    principal =
      n === 0
        ? `Nenhum lead de ${nomeDaEtapa} passou do tempo ainda: a automação vale para todos quando o tempo vencer.`
        : `${leads(n)} já ${n === 1 ? "passou" : "passaram"} do tempo e não ${n === 1 ? "será afetado" : "serão afetados"}.`;
  } else if (gatilho === "entrou_na_etapa") {
    principal =
      n === 0
        ? `Nenhum lead está em ${nomeDaEtapa} agora: a automação vale para quem entrar daqui em diante.`
        : `${leads(n)} já ${n === 1 ? "está" : "estão"} em ${nomeDaEtapa} e não ${n === 1 ? "será afetado" : "serão afetados"}: a automação vale para quem entrar daqui em diante.`;
  } else {
    principal =
      "A automação vale a partir da próxima mensagem de cada lead. Mensagens que já chegaram não contam.";
  }
  return { principal, importados };
}

// ---------------------------------------------------------------------------
// Historico

const MOTIVOS_DA_PULADA: Record<string, string> = {
  regra_desligada: "a automação foi desligada antes",
  regra_alterada: "a automação foi alterada depois",
  etapa_mudou: "o lead já tinha mudado de etapa",
  nao_e_lead: "o contato já é paciente",
  importado: "contato importado que nunca mudou de etapa",
  lead_respondeu: "o lead respondeu antes do tempo",
  limite_de_cascata: `parou no limite de ${SALTOS_EM_CADEIA} automações em cadeia`,
  limite_diario: `o lead já tinha sido movido ${MOVIMENTOS_POR_DIA} vezes por automação em 24 horas`,
  destino_invalido: "a etapa de destino não pode mais receber o lead",
  tem_consulta_futura: "o lead tem consulta marcada",
  sem_conversa: "o lead não tem conversa",
  ja_tinha_etiqueta: "a conversa já tinha a etiqueta",
  limite_de_etiquetas: "a conversa já tem o máximo de etiquetas",
  // Onda 4 (migration 20261024110000).
  condicoes_nao_atendidas: "o lead não batia com as condições na hora",
  acoes_puladas: "nenhuma das ações pôde ser feita",
  clinica_suspensa: "a conta da clínica estava suspensa",
};

/** O motivo da pulada em portugues (codigo novo cai num texto neutro). */
export function textoDoMotivo(motivo: string | null): string {
  if (!motivo) {
    return "sem motivo registrado";
  }
  return MOTIVOS_DA_PULADA[motivo] ?? "motivo não reconhecido";
}

/** Uma acao do retrato, como a tela mostra (o "Fez:" ou o "Não fez:"). */
export type LinhaDaAcaoNoHistorico = {
  posicao: number;
  status: StatusDaAcao;
  texto: string;
  /** O codigo da falha (erro_<sqlstate>), so em falhou. */
  codigo: string | null;
};

/** O que a tela mostra de uma execucao: a frase e, com varias acoes, cada uma. */
export type FraseDaExecucao = {
  texto: string;
  codigo: string | null;
  acoes: LinhaDaAcaoNoHistorico[];
};

/** O que a acao era para fazer, para o "Não fez:": "mover o lead". */
function intencaoDaAcao(acao: ExecucaoDaAcao, nomeDaEtiqueta: string | null) {
  switch (acao.acao) {
    case "mover_etapa":
      return "mover o lead";
    case "etiquetar":
      return nomeDaEtiqueta
        ? `etiquetar a conversa com ${nomeDaEtiqueta}`
        : "etiquetar a conversa";
    case "criar_atividade":
      return "criar a atividade";
    case "nota_interna":
      return "deixar a nota interna";
  }
}

/** O que a acao fez, pelo retrato: "moveu de Em contato para Perdido". */
function feitoDaAcao(
  acao: ExecucaoDaAcao,
  origem: string,
  nomes: { etapa: ResolverNome },
  nomeDaEtiqueta: string | null,
): string {
  switch (acao.acao) {
    case "mover_etapa":
      return acao.para_etapa
        ? `moveu de ${origem} para ${nomes.etapa(acao.para_etapa)}`
        : `moveu o lead (de ${origem})`;
    case "etiquetar":
      return nomeDaEtiqueta
        ? `etiquetou a conversa com ${nomeDaEtiqueta}`
        : "etiquetou a conversa";
    case "criar_atividade":
      return "criou uma atividade";
    case "nota_interna":
      return "deixou uma nota interna na conversa";
  }
}

/** Cada acao do retrato numa linha: "Fez: ...", "Não fez: ... (motivo)". */
function linhasDasAcoes(
  acoes: readonly ExecucaoDaAcao[],
  origem: string,
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): LinhaDaAcaoNoHistorico[] {
  return [...acoes]
    .sort((a, b) => a.posicao - b.posicao)
    .map((acao) => {
      // O nome da hora; sem ele (nao acontece pelo motor), o de hoje.
      const nomeDaEtiqueta =
        acao.etiqueta_nome ??
        (acao.etiqueta ? nomes.etiqueta(acao.etiqueta) : null);
      switch (acao.status) {
        case "executada":
          return {
            posicao: acao.posicao,
            status: acao.status,
            texto: `Fez: ${feitoDaAcao(acao, origem, nomes, nomeDaEtiqueta)}`,
            codigo: null,
          };
        case "pulada":
          return {
            posicao: acao.posicao,
            status: acao.status,
            texto: `Não fez: ${intencaoDaAcao(acao, nomeDaEtiqueta)} (${textoDoMotivo(acao.motivo)})`,
            codigo: null,
          };
        case "falhou":
          return {
            posicao: acao.posicao,
            status: acao.status,
            texto: `Não conseguiu: ${intencaoDaAcao(acao, nomeDaEtiqueta)}`,
            codigo: acao.motivo,
          };
      }
    });
}

/** A frase de antes da onda 4: o retrato do pai (uma acao so). */
function fraseDoRetratoDoPai(
  execucao: Pick<
    ExecucaoDeAutomacao,
    "status" | "motivo" | "para_etapa" | "acao" | "etiqueta" | "etiqueta_nome"
  >,
  origem: string,
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): { texto: string; codigo: string | null } {
  switch (execucao.status) {
    case "pendente":
      return {
        texto: `Na fila, roda em até 1 minuto (em ${origem})`,
        codigo: null,
      };
    case "falhou":
      return {
        texto: `Não conseguiu executar (em ${origem}). Se repetir, fale com o suporte.`,
        codigo: execucao.motivo,
      };
    case "pulada":
      return {
        texto: `Não fez nada: ${textoDoMotivo(execucao.motivo)} (em ${origem})`,
        codigo: null,
      };
    case "executada": {
      if (execucao.para_etapa) {
        return {
          texto: `Moveu de ${origem} para ${nomes.etapa(execucao.para_etapa)}`,
          codigo: null,
        };
      }
      switch (execucao.acao) {
        case "etiquetar": {
          // O nome da hora; sem ele (nao acontece pelo motor), o de hoje.
          const etiqueta =
            execucao.etiqueta_nome ??
            (execucao.etiqueta ? nomes.etiqueta(execucao.etiqueta) : null);
          return {
            texto: etiqueta
              ? `Etiquetou a conversa com ${etiqueta} (em ${origem})`
              : `Etiquetou a conversa (em ${origem})`,
            codigo: null,
          };
        }
        case "mover_etapa":
          // Moveu sem para_etapa nao acontece pelo motor: texto neutro.
          return { texto: `Moveu o lead (de ${origem})`, codigo: null };
        case "criar_atividade":
          return { texto: `Criou uma atividade (em ${origem})`, codigo: null };
        case "nota_interna":
          return {
            texto: `Deixou uma nota interna na conversa (em ${origem})`,
            codigo: null,
          };
        default:
          // Sem o retrato da acao: nao da para dizer o que fez.
          return {
            texto: `Executou a automação (em ${origem})`,
            codigo: null,
          };
      }
    }
  }
}

/**
 * A frase de uma execucao: o que fez (de/para quando moveu), por que pulou
 * ou que falhou, e, com varias acoes, o que cada uma fez ou nao fez. Nunca
 * conteudo de mensagem.
 *
 * O que fez sai do RETRATO gravado na execucao (o do pai, com uma acao so,
 * igual a antes da onda 4; o de cada acao, com varias), nunca da regra como
 * esta hoje: a regra pode ter trocado de acao ou de etiqueta depois, e o
 * historico contaria algo que nao aconteceu.
 */
export function descreverExecucao(
  execucao: Pick<
    ExecucaoDeAutomacao,
    | "status"
    | "motivo"
    | "de_etapa"
    | "para_etapa"
    | "acao"
    | "etiqueta"
    | "etiqueta_nome"
  > & { acoes?: readonly ExecucaoDaAcao[] },
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): FraseDaExecucao {
  const origem = nomes.etapa(execucao.de_etapa);
  const acoes = execucao.acoes ?? [];
  // Uma acao so (ou nenhuma: a execucao de antes da onda 4, ou a pulada
  // por uma guarda antes da primeira acao): o pai tem o retrato, e a frase e
  // a mesma de sempre.
  if (acoes.length <= 1) {
    return { ...fraseDoRetratoDoPai(execucao, origem, nomes), acoes: [] };
  }
  const linhas = linhasDasAcoes(acoes, origem, nomes);
  const feitas = acoes.filter((acao) => acao.status === "executada").length;
  switch (execucao.status) {
    case "pendente":
      return {
        texto: `Na fila, termina em até 1 minuto (em ${origem})`,
        codigo: null,
        acoes: linhas,
      };
    case "executada":
      return {
        texto: `Fez ${feitas} de ${acoes.length} ações (em ${origem})`,
        codigo: null,
        acoes: linhas,
      };
    case "pulada":
      return {
        texto: `Não fez nada: ${textoDoMotivo(execucao.motivo)} (em ${origem})`,
        codigo: null,
        acoes: linhas,
      };
    case "falhou":
      return {
        texto: `Não conseguiu executar (em ${origem}). Se repetir, fale com o suporte.`,
        codigo: execucao.motivo,
        acoes: linhas,
      };
  }
}

/** "Rodou 12 vezes" ou "Ainda não rodou". */
export function textoDoUso(uso: UsoDaAutomacao): string {
  if (uso.vezes === 0) {
    return "Ainda não rodou";
  }
  return `Rodou ${uso.vezes} ${uso.vezes === 1 ? "vez" : "vezes"}`;
}

/**
 * Quando, no relogio e no calendario DA CLINICA (regra 3.6): "hoje, 14:05",
 * "ontem, 09:10", "22/09, 14:05" ou "22/09/2025, 14:05" em outro ano.
 */
export function quandoNaClinica(
  instante: string,
  timezone: string,
  agora: Date,
): string {
  const local = new TZDate(new Date(instante).getTime(), timezone);
  const hora = format(local, "HH:mm");
  const dia = diaCivil(timezone, new Date(instante));
  const hoje = diaCivil(timezone, agora);
  if (dia === hoje) {
    return `hoje, ${hora}`;
  }
  if (dia === somarDias(hoje, -1)) {
    return `ontem, ${hora}`;
  }
  const mesmoAno = dia.slice(0, 4) === hoje.slice(0, 4);
  return `${format(local, mesmoAno ? "dd/MM" : "dd/MM/yyyy")}, ${hora}`;
}
