import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import { diaCivil, somarDias } from "@/lib/domain/horarios";
import type { PapelDeEtapa } from "@/lib/domain/jornada";

// Automacoes de fluxo (pedido do dono em 02/10/2026; migration
// 20261002130000_automacoes_de_fluxo.sql). Modulo puro, serve cliente e
// servidor: as opcoes da tela, a frase em portugues de cada regra, os vetos e
// o detector de ciclo que ESPELHAM o banco (validar_automacao_de_fluxo e os
// checks de automacao_fluxo), a traducao das recusas e os textos do
// historico. O banco continua sendo a garantia: o espelho so serve para a
// tela avisar antes de salvar.
//
// Regra em colunas fixas (CLAUDE.md 4): QUANDO o lead esta na ETAPA e
// acontece o GATILHO, FAZ a ACAO. Nao existe acao de mensagem para o
// paciente: isso e a regua de follow-up da etapa (Automacoes > Follow-up).

// ---------------------------------------------------------------------------
// Vocabulario (checks gatilho_de_automacao_valido e acao_de_automacao_valida)

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

/** Check status_de_execucao_valido de automacao_execucao. */
export const STATUS_DE_EXECUCAO = [
  "pendente",
  "executada",
  "pulada",
  "falhou",
] as const;

export type StatusDaExecucao = (typeof STATUS_DE_EXECUCAO)[number];

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

/** Uma linha de automacao_fluxo, como a tela usa. */
export type AutomacaoDeFluxo = {
  id: string;
  nome: string;
  ativa: boolean;
  gatilho: GatilhoDeAutomacao;
  etapa: string;
  espera_minutos: number | null;
  acao: AcaoDeAutomacao;
  etapa_destino: string | null;
  motivo_perda: typeof MOTIVO_DA_PERDA_DA_AUTOMACAO | null;
  etiqueta: string | null;
  atividade_titulo: string | null;
  atividade_prazo_dias: number | null;
  nota_texto: string | null;
  vigente_desde: string;
  created_at: string;
  updated_at: string;
};

/**
 * Valida a linha lida do banco: os tipos gerados dizem "string" para gatilho
 * e acao, e a tela precisa saber que e um dos valores conhecidos.
 */
export const automacaoDeFluxoLinhaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  ativa: z.boolean(),
  gatilho: z.enum(GATILHOS),
  etapa: z.string(),
  espera_minutos: z.number().int().nullable(),
  acao: z.enum(ACOES),
  etapa_destino: z.string().nullable(),
  motivo_perda: z.literal(MOTIVO_DA_PERDA_DA_AUTOMACAO).nullable(),
  etiqueta: z.string().nullable(),
  atividade_titulo: z.string().nullable(),
  atividade_prazo_dias: z.number().int().nullable(),
  nota_texto: z.string().nullable(),
  vigente_desde: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

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
   * execucao que nao rodou ou gravada sem o retrato.
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

/** Os avisos fixos da aba: o que a automacao nunca faz e onde ela para. */
export const AVISOS_FIXOS: readonly string[] = [
  "Só leads: paciente nunca é movido por automação.",
  "Agendou e Compareceu não são destino: quem leva o lead para essas etapas é a Agenda.",
  "Mover o lead para fora de uma etapa encerra o follow-up daquela etapa.",
  `Automações em cadeia param no ${SALTOS_EM_CADEIA}º salto, e um lead é movido por automação no máximo ${MOVIMENTOS_POR_DIA} vezes em 24 horas.`,
  "Não é retroativa: vale para o que acontecer depois de ligada (ou de mudar o gatilho, a etapa ou o tempo).",
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
// A regra em portugues

type ResolverNome = (chave: string) => string;

/** Nome pela chave; chave desconhecida (cache velho) aparece crua. */
export function resolvedorDeNomes(
  itens: readonly { chave: string; nome: string }[] | null | undefined,
): ResolverNome {
  const mapa = new Map((itens ?? []).map((item) => [item.chave, item.nome]));
  return (chave) => mapa.get(chave) ?? chave;
}

/**
 * "Ficou 3 dias em Em contato", "Ficou 48 h sem responder em Aguardando
 * resposta", "Entrou em Agendou", "Mandou mensagem estando em Novo".
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

/**
 * "Move para Perdido (Não respondeu)", "Etiqueta: Retorno", "Cria atividade:
 * Ligar para o paciente, em 2 dias", "Nota interna".
 */
export function descreverAcao(
  regra: Pick<
    AutomacaoDeFluxo,
    | "acao"
    | "etapa_destino"
    | "motivo_perda"
    | "etiqueta"
    | "atividade_titulo"
    | "atividade_prazo_dias"
  >,
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): string {
  switch (regra.acao) {
    case "mover_etapa": {
      const destino = regra.etapa_destino
        ? nomes.etapa(regra.etapa_destino)
        : "outra etapa";
      return regra.motivo_perda
        ? `Move para ${destino} (Não respondeu)`
        : `Move para ${destino}`;
    }
    case "etiquetar":
      return `Etiqueta: ${regra.etiqueta ? nomes.etiqueta(regra.etiqueta) : "sem etiqueta"}`;
    case "criar_atividade":
      return `Cria atividade: ${regra.atividade_titulo ?? ""}, ${textoDoPrazo(regra.atividade_prazo_dias ?? 0)}`;
    case "nota_interna":
      return "Nota interna";
  }
}

// ---------------------------------------------------------------------------
// Vetos de destino (espelho de validar_automacao_de_fluxo e dos checks)

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
// Detector de ciclo (espelho do with recursive de validar_automacao_de_fluxo)

export type RegraParaCiclo = Pick<
  AutomacaoDeFluxo,
  "ativa" | "gatilho" | "acao" | "etapa" | "etapa_destino"
> & { id: string | null };

/**
 * So regra LIGADA de mover, com gatilho que nao e de mensagem, vira aresta:
 * a de mensagem so anda se o lead escrever, entao o vai e volta depende dele.
 */
export function viraAresta(regra: RegraParaCiclo): boolean {
  return (
    regra.ativa &&
    regra.acao === "mover_etapa" &&
    regra.gatilho !== "mensagem_recebida" &&
    regra.etapa_destino !== null
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
  if (!viraAresta(regra) || regra.etapa_destino === null) {
    return null;
  }
  const saidas = new Map<string, string[]>();
  for (const outra of outras) {
    if (regra.id !== null && outra.id === regra.id) {
      continue;
    }
    if (!viraAresta(outra) || outra.etapa_destino === null) {
      continue;
    }
    const lista = saidas.get(outra.etapa) ?? [];
    lista.push(outra.etapa_destino);
    saidas.set(outra.etapa, lista);
  }

  // Busca em largura a partir do destino, guardando de onde veio cada etapa
  // para remontar o caminho.
  const veioDe = new Map<string, string | null>([[regra.etapa_destino, null]]);
  const fila = [regra.etapa_destino];
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
    acao: z.enum(ACOES, { error: "Escolha o que a automação faz." }),
    etapa_destino: chaveSchema.nullable(),
    etiqueta: chaveSchema.nullable(),
    atividade_titulo: z.string().trim().nullable(),
    atividade_prazo_dias: z
      .number()
      .int({ error: "O prazo vai de 0 a 365 dias." })
      .min(0, { error: "O prazo vai de 0 a 365 dias." })
      .max(PRAZO_MAXIMO_DIAS, { error: "O prazo vai de 0 a 365 dias." })
      .nullable(),
    nota_texto: z.string().trim().nullable(),
  })
  .superRefine((dados, ctx) => {
    if (ehGatilhoDeTempo(dados.gatilho) && dados.espera_minutos === null) {
      ctx.addIssue({
        code: "custom",
        path: ["espera_minutos"],
        message: "Diga quanto tempo o lead fica antes de a automação rodar.",
      });
    }
    if (dados.acao === "mover_etapa" && dados.etapa_destino === null) {
      ctx.addIssue({
        code: "custom",
        path: ["etapa_destino"],
        message: MENSAGENS_DO_VETO.sem_destino,
      });
    }
    if (dados.acao === "mover_etapa" && dados.etapa_destino === dados.etapa) {
      ctx.addIssue({
        code: "custom",
        path: ["etapa_destino"],
        message: MENSAGENS_DO_VETO.destino_igual_origem,
      });
    }
    if (dados.acao === "etiquetar" && dados.etiqueta === null) {
      ctx.addIssue({
        code: "custom",
        path: ["etiqueta"],
        message: "Escolha a etiqueta.",
      });
    }
    if (dados.acao === "criar_atividade") {
      const titulo = dados.atividade_titulo ?? "";
      if (
        titulo.length < TITULO_DA_ATIVIDADE_MINIMO ||
        titulo.length > TITULO_DA_ATIVIDADE_MAXIMO
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["atividade_titulo"],
          message: "O que fazer vai de 2 a 120 caracteres.",
        });
      }
      if (dados.atividade_prazo_dias === null) {
        ctx.addIssue({
          code: "custom",
          path: ["atividade_prazo_dias"],
          message: "Diga em quantos dias a atividade vence.",
        });
      }
    }
    if (dados.acao === "nota_interna") {
      const nota = dados.nota_texto ?? "";
      if (nota.length === 0 || nota.length > NOTA_MAXIMA) {
        ctx.addIssue({
          code: "custom",
          path: ["nota_texto"],
          message: "A nota vai de 1 a 2000 caracteres.",
        });
      }
    }
  });

export type EntradaDaAutomacao = z.infer<typeof automacaoDeFluxoSchema>;

/**
 * As colunas para gravar: so os campos da acao escolhida; os das outras vao
 * null (os checks acao_*_tem_* recusam campo sobrando). O motivo da perda
 * vem do papel do destino lido do banco, nunca do cliente. Sem created_by,
 * updated_by nem vigente_desde: o banco carimba.
 */
export function camposParaGravar(
  dados: EntradaDaAutomacao,
  jornada: readonly EtapaParaAutomacao[],
) {
  const mover = dados.acao === "mover_etapa";
  const destino = mover ? dados.etapa_destino : null;
  return {
    nome: dados.nome,
    ativa: dados.ativa,
    gatilho: dados.gatilho,
    etapa: dados.etapa,
    espera_minutos: ehGatilhoDeTempo(dados.gatilho)
      ? dados.espera_minutos
      : null,
    acao: dados.acao,
    etapa_destino: destino,
    motivo_perda: mover ? motivoDaPerdaPara(destino, jornada) : null,
    etiqueta: dados.acao === "etiquetar" ? dados.etiqueta : null,
    atividade_titulo:
      dados.acao === "criar_atividade" ? dados.atividade_titulo : null,
    atividade_prazo_dias:
      dados.acao === "criar_atividade" ? dados.atividade_prazo_dias : null,
    nota_texto: dados.acao === "nota_interna" ? dados.nota_texto : null,
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
    acao: z.enum(ACOES),
    etapa_destino: z.string(),
    etiqueta: z.string(),
    atividade_titulo: z.string(),
    atividade_prazo_dias: z.string(),
    nota_texto: z.string(),
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
    if (valores.acao === "mover_etapa") {
      if (valores.etapa_destino === "") {
        ctx.addIssue({
          code: "custom",
          path: ["etapa_destino"],
          message: MENSAGENS_DO_VETO.sem_destino,
        });
      } else if (valores.etapa_destino === valores.etapa) {
        ctx.addIssue({
          code: "custom",
          path: ["etapa_destino"],
          message: MENSAGENS_DO_VETO.destino_igual_origem,
        });
      }
    }
    if (valores.acao === "etiquetar" && valores.etiqueta === "") {
      ctx.addIssue({
        code: "custom",
        path: ["etiqueta"],
        message: "Escolha a etiqueta.",
      });
    }
    if (valores.acao === "criar_atividade") {
      const titulo = valores.atividade_titulo.trim();
      if (
        titulo.length < TITULO_DA_ATIVIDADE_MINIMO ||
        titulo.length > TITULO_DA_ATIVIDADE_MAXIMO
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["atividade_titulo"],
          message: "O que fazer vai de 2 a 120 caracteres.",
        });
      }
      const prazo = inteiroDoTexto(valores.atividade_prazo_dias);
      if (prazo === null || prazo < 0 || prazo > PRAZO_MAXIMO_DIAS) {
        ctx.addIssue({
          code: "custom",
          path: ["atividade_prazo_dias"],
          message: "O prazo vai de 0 a 365 dias.",
        });
      }
    }
    if (valores.acao === "nota_interna") {
      const nota = valores.nota_texto.trim();
      if (nota.length === 0 || nota.length > NOTA_MAXIMA) {
        ctx.addIssue({
          code: "custom",
          path: ["nota_texto"],
          message: "A nota vai de 1 a 2000 caracteres.",
        });
      }
    }
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
      acao: "mover_etapa",
      etapa_destino: "",
      etiqueta: "",
      atividade_titulo: "",
      atividade_prazo_dias: "1",
      nota_texto: "",
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
    acao: regra.acao,
    etapa_destino: regra.etapa_destino ?? "",
    etiqueta: regra.etiqueta ?? "",
    atividade_titulo: regra.atividade_titulo ?? "",
    atividade_prazo_dias: String(regra.atividade_prazo_dias ?? 1),
    nota_texto: regra.nota_texto ?? "",
  };
}

/** Do formulario para a entrada da Server Action (so os campos da acao). */
export function entradaDoFormulario(
  valores: ValoresDaAutomacao,
  id: string | null,
): EntradaDaAutomacao {
  const acao = valores.acao;
  return {
    id,
    nome: valores.nome.trim(),
    ativa: valores.ativa,
    gatilho: valores.gatilho,
    etapa: valores.etapa,
    espera_minutos: ehGatilhoDeTempo(valores.gatilho)
      ? minutosDoFormulario(valores)
      : null,
    acao,
    etapa_destino:
      acao === "mover_etapa" && valores.etapa_destino !== ""
        ? valores.etapa_destino
        : null,
    etiqueta:
      acao === "etiquetar" && valores.etiqueta !== "" ? valores.etiqueta : null,
    atividade_titulo:
      acao === "criar_atividade" ? valores.atividade_titulo.trim() : null,
    atividade_prazo_dias:
      acao === "criar_atividade"
        ? inteiroDoTexto(valores.atividade_prazo_dias)
        : null,
    nota_texto: acao === "nota_interna" ? valores.nota_texto.trim() : null,
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
  automacao_ciclo:
    "Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.",
};

// A ordem importa onde um nome contem outro: o do destino vem antes do da
// origem (automacao_fluxo_etapa_fkey nao e trecho do de destino, mas a lista
// fica a prova de nome novo).
const RECUSAS_POR_CONSTRAINT: readonly { trecho: string; mensagem: string }[] =
  [
    {
      trecho: "automacao_fluxo_etapa_destino_fkey",
      mensagem: MENSAGENS_DO_VETO.destino_inexistente,
    },
    {
      trecho: "automacao_fluxo_etapa_fkey",
      mensagem:
        "A etapa escolhida não existe mais na jornada. Recarregue a página e escolha outra.",
    },
    {
      trecho: "automacao_fluxo_etiqueta_fkey",
      mensagem:
        "A etiqueta escolhida não existe mais. Recarregue a página e escolha outra.",
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
      mensagem: "O que fazer vai de 2 a 120 caracteres.",
    },
    {
      trecho: "prazo_de_atividade_da_automacao",
      mensagem: "O prazo vai de 0 a 365 dias.",
    },
    { trecho: "acao_nota_tem_texto", mensagem: "Escreva o texto da nota." },
    {
      trecho: "nota_da_automacao_com_tamanho",
      mensagem: "A nota vai de 1 a 2000 caracteres.",
    },
  ];

export const DICA_SEM_PERMISSAO =
  "Somente administradores e gestores mudam as automações de fluxo.";

/**
 * Excluir etiqueta usada por automacao: proteger_etiqueta_de_conversa recusa
 * com o hint etiqueta_usada_por_automacao (migration 20261002130000). A aba
 * Etiquetas mostra este texto, que diz onde resolver.
 */
export const RECUSA_DA_ETIQUETA_USADA =
  "Esta etiqueta é usada por uma automação de fluxo. Exclua a automação ou troque a etiqueta dela na aba Automações de fluxo antes de excluir a etiqueta.";

/** A recusa de excluir etiqueta usada por automacao, ou null se for outra. */
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
  return null;
}

/**
 * Excluir etapa usada por automacao (como origem ou destino): proteger_jornada
 * recusa com o hint etapa_usada_por_automacao (migration 20261002130000). A
 * aba Jornada mostra este texto. O mesmo texto esta em RECUSAS_DA_JORNADA
 * (lib/domain/jornada.ts), para quem traduz so pela mensagem; um teste de
 * unidade confere que os dois nao se desencontram.
 */
export const RECUSA_DA_ETAPA_USADA =
  "Esta etapa é usada por uma automação de fluxo. Exclua a automação ou troque a etapa dela na aba Automações de fluxo antes de excluir a etapa.";

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
  if (erro.code === "23514" || erro.code === "23503") {
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
 * diz a verdade; editar o nome ou a acao de uma regra ligada nao recomeca.
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
};

/** O motivo da pulada em portugues (codigo novo cai num texto neutro). */
export function textoDoMotivo(motivo: string | null): string {
  if (!motivo) {
    return "sem motivo registrado";
  }
  return MOTIVOS_DA_PULADA[motivo] ?? "motivo não reconhecido";
}

/**
 * A frase de uma execucao: o que fez (de/para quando moveu), por que pulou
 * ou que falhou. Nunca conteudo de mensagem.
 *
 * O que fez sai do RETRATO gravado na execucao (acao, etiqueta e o nome dela
 * na hora), nunca da regra como esta hoje: a regra pode ter trocado de acao
 * ou de etiqueta depois, e o historico contaria algo que nao aconteceu.
 * Execucao sem o retrato cai num texto neutro.
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
  >,
  nomes: { etapa: ResolverNome; etiqueta: ResolverNome },
): { texto: string; codigo: string | null } {
  const origem = nomes.etapa(execucao.de_etapa);
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
