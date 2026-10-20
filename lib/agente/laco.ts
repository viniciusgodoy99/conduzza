// Um turno do agente de IA (E2): da mensagem do paciente ate a resposta
// aprovada ou a frase fixa. Laco MANUAL na Responses API da OpenAI (nada de
// Agents SDK, Conversations nem previous_response_id: CLAUDE.md, secao 2).
//
// Ordem (plano de seguranca, secao 3, e especificacao da Tela 6, secao 3):
//  1. Portao de entrada deterministico (gatilhos-de-entrada.ts) nas
//     mensagens do paciente ainda nao respondidas. Gatilho escala. No
//     WhatsApp ele le o texto ORIGINAL do contato (textoOriginal, sem a
//     mascara do nome; revisao de producao de 19/10/2026); classificador,
//     agente e verificador leem so o texto mascarado.
//  2. Configuracao: sem cliente, sem modelo valido ou com identificador de
//     seguranca fora do formato, falha fechada (frase fixa).
//  3. Classificador de entrada por modelo, com prazo duro. Gatilho, falha,
//     incoerencia ou confianca baixa escalam.
//  4. O agente, ate MAXIMO_DE_RODADAS rodadas: store false, historico
//     reenviado inteiro a cada rodada (com o raciocinio cifrado), ferramentas
//     pela habilidade ligada, prompt_cache_key por clinica, safety_identifier.
//     Antes de cada rodada, a trava (conferirTrava: ia_pode_simular ou
//     ia_pode_atender, que inclui o teto diario) e o prazo. escalar_humano
//     encerra na hora. Qualquer anomalia (erro, recusa, incompleta, item
//     inesperado, saida fora do formato, ferramenta desconhecida, rodadas
//     esgotadas) e falha fechada. Resposta final que promete passar para a
//     equipe sem ter chamado escalar_humano tambem passa (agente_pediu): o
//     texto nao sai (passagem-prometida.ts, revisao de 19/10/2026).
//  5. Saudacao (so na primeira resposta da conversa) e encerramento (so
//     quando o modelo diz que a conversa terminou) colados ANTES do filtro;
//     se a soma passar do limite do filtro, sai o encerramento e depois a
//     saudacao, nunca a resposta.
//  6. filtrarSaida (regras + verificador, falha fechada). So ele produz
//     TextoAprovado; bloqueio vira a frase fixa.
//
// E4 (agenda, contrato da E4 secao 2): as ferramentas de agenda
// (buscar_horario, reservar_horario, agendar e confirmar_presenca) rodam pela
// porta da agenda (entrada.agenda): no WhatsApp gravam pelas RPCs com o
// job_id do turno (a idempotencia), no simulador nao gravam. O turno que usa
// uma delas ganha ate MAXIMO_DE_RODADAS_COM_AGENDA rodadas; reservar, agendar
// e confirmar valem uma vez por turno (ferramentas/agenda-do-turno.ts).
//
// A trilha ("Por que a IA respondeu isso") diz o que foi consultado, com
// nomes do Cadastro e da base da clinica, NUNCA texto do paciente. Log so com
// ids, codigos, modelo e duracao.

import type OpenAI from "openai";
import type {
  FunctionTool,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { z } from "zod";

import {
  ehFerramentaDeAgenda,
  ferramentasDoAgente,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  type ConfigDoAgente,
  type FerramentaDoAgente,
  type MotivoDeEscalonamento,
} from "@/lib/domain/agente/config";
import type {
  CamadaDoFiltro,
  CategoriaDeConformidade,
  GatilhoDeEntrada,
} from "@/lib/domain/conformidade/categorias";
import {
  filtrarSaida,
  type DecisaoDoFiltro,
} from "@/lib/domain/conformidade/filtro";
import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  detectarGatilhosDeEntrada,
  LIMITE_DE_MENSAGEM,
  type MensagemDeEntrada,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { minimizarParaLlm } from "@/lib/domain/conformidade/minimizar";
import {
  classificarComPrazo,
  correrComPrazo,
  PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS,
} from "@/lib/domain/conformidade/prazo";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import {
  ehMotivoDaFalha,
  type MotivoDaFalha,
  type UsoDoLlm,
  type Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  decidirPeloClassificador,
  type ClassificadorDeEntrada,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  chaveDeCacheDaClinica,
  classificarErroDoLlm,
  idDaRequisicao,
  parametrosFixosDoAgente,
  type ModeloDoAgente,
} from "@/lib/integrations/llm/openai";
import {
  identificadorValido,
  semMarcadores,
  statusParaLog,
  usoDaResposta,
} from "@/lib/integrations/llm/verificador";
import { log } from "@/lib/log";

import {
  criarAgendaDoTurno,
  type PortaDaAgenda,
} from "./ferramentas/agenda-do-turno";
import { limiteDaSaidaDaBuscaDeHorario } from "./ferramentas/buscar-horario";
import {
  buscarProcedimento,
  limiteDaSaidaDaBusca,
  nomesDoCatalogo,
  NOME_DA_BUSCA,
  type CatalogoDoAgente,
} from "./ferramentas/buscar-procedimento";
import {
  motivoDoEscalonamento,
  NOME_DO_ESCALONAMENTO,
} from "./ferramentas/escalar-humano";
import {
  chamadaPodeTerSidoCobrada,
  custoMaximoDaChamada,
  FOLGA_DA_CHAMADA,
  usoEstimadoDaRodada,
  usoEstimadoDoClassificador,
  usoEstimadoDoVerificador,
} from "./gasto";
import { semAMarcaDoNome } from "./marca-do-nome";
import { prometePassagemParaAEquipe } from "./passagem-prometida";
import {
  agoraNaClinica,
  FORMATO_DA_RESPOSTA,
  ferramentasDaChamada,
  montarInstrucoes,
  perguntasParaOModelo,
  SEPARADOR_DA_RESPOSTA,
  tamanhoNoFiltro,
  textoDescartado,
  VERSAO_DO_PROMPT,
  type TextoDescartado,
} from "./prompt";
import type { PrecoDoModelo, UsoDoModelo } from "./uso";

// ---------------------------------------------------------------------------
// Parametros
// ---------------------------------------------------------------------------

/** Rodadas do modelo por turno (ferramenta, ferramenta, resposta...). */
export const MAXIMO_DE_RODADAS = 4;
/**
 * Rodadas do turno que usa uma ferramenta de agenda (contrato da E4): buscar
 * o preco, buscar o horario, buscar de novo, reservar e responder cabem.
 */
export const MAXIMO_DE_RODADAS_COM_AGENDA = 6;
/**
 * Prazo do turno inteiro. A rota que chama precisa de maxDuration acima
 * disto (a pagina /agente exporta 60 s).
 */
export const PRAZO_DO_TURNO_MS = 45_000;
/** Teto de uma chamada do agente. */
export const PRAZO_DA_RODADA_MS = 20_000;
/** Tempo guardado para o verificador do filtro depois do agente. */
export const RESERVA_DO_FILTRO_MS = 10_000;
/**
 * Teto de saida de UMA rodada do agente: o raciocinio (esforco low) mais a
 * resposta curta em JSON ou a chamada de ferramenta. Revisao de producao de
 * 19/10/2026: era 2.048, e o raciocinio conta dentro do teto. A resposta em
 * si cabe em uns 250 tokens (500 caracteres de mensagem e o JSON; uma
 * chamada de ferramenta, menos de 100), mas o raciocinio de uma rodada com o
 * texto fixo inteiro, a escolha da ferramenta e um convenio com opcoes pode
 * passar de 2 mil mesmo no esforco low, e o corte por max_output_tokens vem
 * antes de qualquer texto visivel: o turno falha (max_tokens, frase fixa) e o
 * raciocinio e cobrado do mesmo jeito. A OpenAI recomenda folga larga para
 * raciocinio e saida juntos. 8.192 da quatro vezes o teto antigo e fica no
 * que o modelo gera dentro do prazo da rodada (PRAZO_DA_RODADA_MS, 20 s):
 * acima disso o prazo corta antes do teto, e subir mais so engordaria a
 * reserva. A reserva do turno acompanha sozinha (custoMaximoDoTurno usa este
 * teto em toda rodada e no crescimento da entrada): no gpt-6-luna, cerca de
 * US$ 0,03 por turno no pior caso, contra o teto de US$ 5 por dia; cobrado e
 * so o uso real (acertarGasto).
 */
export const MAX_TOKENS_DO_AGENTE = 8_192;
/** Mensagens da conversa que vao ao modelo (as mais recentes). */
export const MENSAGENS_NO_HISTORICO = 20;
/** Uma mensagem no historico do modelo (o portao escala acima disto). */
const CARACTERES_POR_MENSAGEM = LIMITE_DE_MENSAGEM;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** So responses.create e usado; os testes injetam um falso com roteiro. */
export type ClienteDoAgente = Pick<OpenAI, "responses">;

export type MensagemDaConversa = {
  autor: "paciente" | "assistente";
  /**
   * null para midia sem texto. No historico do WhatsApp, com o nome do
   * contato trocado pela marca (lib/agente/historico.ts): e o texto que os
   * modelos da OpenAI (classificador, agente e verificador) leem.
   */
  texto: string | null;
  /** message.content_type; ausente = "texto". */
  tipo?: string;
  /**
   * O texto do contato como chegou, SEM a mascara do nome (so no historico
   * do WhatsApp, so nas mensagens de texto do contato). Quem le e so o
   * portao de entrada deterministico, local e sem rede: o nome mascarado
   * escondia o gatilho ("socorro, me ajuda" de uma contato chamada Socorro
   * chegava ao portao como "Fulano, me ajuda" e nao escalava). Nunca vai
   * para a OpenAI nem para log. Ausente (simulador, que nao mascara): o
   * portao le `texto`.
   */
  textoOriginal?: string | null;
};

/**
 * O tipo de cada passo, que escolhe o icone na tela (components/agente/
 * simulador.tsx): consulta de preco, pergunta da base, agenda (buscar,
 * reservar, marcar e confirmar presenca, E4), passagem para a equipe,
 * bloqueio da conformidade e o resto.
 */
export type TipoDoPasso =
  "preco" | "base" | "agenda" | "equipe" | "bloqueio" | "outro";

/** Um passo do "Por que a IA respondeu isso". Nunca texto do paciente. */
export type PassoDoTurno = { tipo: TipoDoPasso; texto: string };

/** Quem decidiu passar a conversa para a equipe. */
export type OrigemDoEscalonamento =
  "portao" | "classificador" | "agente" | "texto_do_agente";

/** Falhas do turno alem das do verificador e do classificador. */
export type FalhaDoAgente =
  | MotivoDaFalha
  | "rodadas_esgotadas"
  | "ferramenta_invalida"
  | "liberacao_suspensa"
  | "sem_identificador"
  | "sem_mensagem";

export type DesfechoDoTurno =
  | { tipo: "respondeu" }
  | {
      tipo: "escalou";
      motivo: MotivoDeEscalonamento;
      /** O gatilho de entrada, quando foi o portao (ai_decision_log). */
      gatilho: GatilhoDeEntrada | null;
      /**
       * "agente": chamou escalar_humano. "texto_do_agente": a resposta final
       * prometia passar para a equipe sem chamar a ferramenta (Q5 da revisao
       * de producao de 19/10/2026); o texto nao sai.
       */
      origem: OrigemDoEscalonamento;
    }
  | {
      tipo: "bloqueou";
      categoria: CategoriaDeConformidade;
      camada: CamadaDoFiltro;
      motivoDaFalha: MotivoDaFalha | null;
    }
  | { tipo: "falhou"; motivo: FalhaDoAgente };

type Comum = {
  desfecho: DesfechoDoTurno;
  trilha: PassoDoTurno[];
  /**
   * Toda chamada que pode ter sido cobrada, para ia_uso: o uso que a API
   * devolveu ou, na chamada abortada ou sem usage, a estimativa maxima
   * (lib/agente/gasto.ts).
   */
  uso: UsoDoModelo[];
  versaoDoPrompt: string;
  /** A decisao do filtro, quando ele rodou. */
  filtro: DecisaoDoFiltro | null;
  /**
   * Instrucoes e perguntas ativas que ficaram de fora do modelo por nao
   * passarem mais nas regras (so quando o agente rodou). So contagem.
   */
  descartados: TextoDescartado;
  /**
   * As ferramentas que rodaram no turno, na ordem (repetidas inclusive):
   * o tool_used de ai_decision_log sai daqui (lib/agente/whatsapp.ts).
   * Ausente = nenhuma.
   */
  ferramentasUsadas?: FerramentaDoAgente[];
};

export type ResultadoDoTurno =
  | (Comum & {
      tipo: "resposta";
      resposta: TextoAprovado;
      rascunhoBloqueado: null;
    })
  | (Comum & {
      tipo: "frase_fixa";
      resposta: typeof FRASE_DE_ESCALONAMENTO;
      /**
       * O texto que o filtro barrou (so quando bloqueou). Dado de saude em
       * potencial: o simulador mostra a quem testa; o E3 guarda no lugar
       * proprio. Nunca vai para log.
       */
      rascunhoBloqueado: string | null;
    });

export type EntradaDoTurno = {
  /** null = sem chave da OpenAI: falha fechada. */
  cliente: ClienteDoAgente | null;
  /** null = IA_MODELO_AGENTE fora da lista: falha fechada. */
  modelo: ModeloDoAgente | null;
  clinicId: string;
  /** HMAC de identificadorDeSeguranca (64 hex). Ausente: falha fechada. */
  identificadorDeSeguranca: string | null;
  config: ConfigDoAgente;
  catalogo: CatalogoDoAgente;
  /** A conversa em ordem; a ultima mensagem e do paciente. */
  mensagens: readonly MensagemDaConversa[];
  agoraMs: number;
  fuso: string;
  verificador: Verificador;
  classificador: ClassificadorDeEntrada;
  /** contact.birth_date (AAAA-MM-DD), quando houver contato. */
  dataDeNascimento?: string | null;
  /** Hoje no fuso da clinica (AAAA-MM-DD), para a data acima. */
  hojeNaClinica?: string | null;
  /** Antes de cada rodada do agente; false para o turno (teto, interruptor). */
  conferirTrava?: () => Promise<boolean>;
  /**
   * A porta da agenda (E4): a Agenda e as RPCs do WhatsApp, ou a do
   * simulador, que nao grava. Sem porta, ferramenta de agenda e falha
   * fechada.
   */
  agenda?: PortaDaAgenda | null;
  /**
   * O modelo do classificador e do verificador, para estimar o gasto da
   * chamada que falhou sem dizer o modelo (o corte por prazo).
   */
  modeloDosClassificadores?: string | null;
  prazoMs?: number;
  /** Relogio injetavel para teste. */
  agora?: () => number;
};

// ---------------------------------------------------------------------------
// Textos da trilha (linguagem de recepcao)
// ---------------------------------------------------------------------------

/** Igual ao cartao de bloqueio do Atendimento (message-bubble.tsx). */
const ROTULO_DO_BLOQUEIO: Readonly<Record<CategoriaDeConformidade, string>> = {
  triagem: "triagem de sintoma",
  diagnostico: "diagnóstico",
  orientacao_clinica: "orientação clínica",
  medicamento: "indicação de medicamento",
  dosagem: "indicação de dose",
  promessa_resultado: "promessa de resultado",
  oferta_casada: "oferta casada",
  antes_depois: "imagem de antes e depois",
  preco_nao_verificado: "preço fora do cadastro",
  formato_invalido: "formato de resposta não permitido",
  falha_verificador: "verificação de conformidade indisponível",
};

export function rotuloDoBloqueio(categoria: CategoriaDeConformidade): string {
  return ROTULO_DO_BLOQUEIO[categoria];
}

/** O motivo de escalonamento de cada gatilho do portao de entrada. */
const MOTIVO_DO_GATILHO: Readonly<
  Record<GatilhoDeEntrada, MotivoDeEscalonamento>
> = {
  sintoma: "sintoma",
  menor_de_idade: "menor_de_idade",
  assunto_clinico: "assunto_clinico",
  manipulacao: "tentativa_de_manipulacao",
  pedido_humano: "pedido_humano",
  insatisfacao: "insatisfacao",
  valor_fora_da_tabela: "valor_fora_da_tabela",
  midia: "midia_nao_suportada",
  // Sem codigo proprio em escalation_reason: o gatilho_entrada guarda
  // "mensagem_longa" e o motivo e o generico.
  mensagem_longa: "agente_pediu",
};

function textoDoGatilho(gatilho: GatilhoDeEntrada): string {
  return gatilho === "mensagem_longa"
    ? "a mensagem é longa demais para o assistente"
    : ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[MOTIVO_DO_GATILHO[gatilho]];
}

/**
 * O que a trilha diz de cada falha, um texto por motivo, que leve ao
 * problema certo (revisao de producao de 19/10/2026, achado A5: o 400 da
 * OpenAI aparecia como "a IA não está configurada neste ambiente" e mandava
 * procurar uma variavel que existia). Record inteiro: motivo novo sem texto
 * nao compila. O codigo HTTP fica entre parenteses, para a equipe Conduzza
 * achar a chamada no log (ia_agente_falhou, ia_classificador_falhou).
 */
export const TEXTO_DA_FALHA: Readonly<Record<FalhaDoAgente, string>> = {
  sem_cliente:
    "o servidor está sem a chave da OpenAI, ou a configuração dele recusou a chave",
  modelo_invalido:
    "o modelo de IA escolhido na configuração do servidor não é aceito",
  sem_identificador:
    "o servidor está sem o segredo do identificador de segurança da IA",
  requisicao_invalida:
    "a OpenAI recusou o pedido do assistente como inválido (erro 400)",
  autenticacao: "a OpenAI recusou a chave do servidor (erro 401)",
  permissao:
    "a chave do servidor não tem acesso a este modelo na OpenAI (erro 403)",
  nao_encontrado: "a OpenAI não encontrou o modelo pedido (erro 404)",
  cota: "a conta da OpenAI está sem crédito ou chegou ao limite de gasto (erro 429)",
  limite:
    "a OpenAI recebeu pedidos demais em pouco tempo e pediu para esperar (erro 429)",
  sobrecarga: "a OpenAI está sobrecarregada agora (erro 503)",
  servidor: "a OpenAI teve um erro interno",
  outro_http: "a OpenAI respondeu com um erro inesperado",
  conexao: "não foi possível conectar à OpenAI",
  abortado: "o pedido à OpenAI foi interrompido antes da resposta",
  liberacao_suspensa:
    "a IA deixou de estar liberada nesta clínica (teto de gasto ou interruptor)",
  rodadas_esgotadas: "o assistente não chegou a uma resposta",
  ferramenta_invalida: "o assistente pediu uma consulta que não existe",
  sem_mensagem: "não havia mensagem do paciente para responder",
  prazo: "o tempo de resposta acabou",
  timeout: "o tempo de resposta acabou",
  recusa: "o assistente se recusou a responder",
  max_tokens:
    "a resposta do assistente passou do tamanho máximo e ficou incompleta",
  parada_inesperada:
    "a resposta do assistente parou no meio ou veio com algo inesperado",
  saida_invalida: "a resposta do assistente veio fora do formato",
  incoerente: "a checagem da mensagem deu um resultado incoerente",
  confianca_baixa: "a checagem da mensagem ficou em dúvida",
  contexto_truncado: "havia mensagens demais sem resposta para conferir",
  desconhecida: "o assistente teve uma falha inesperada",
};

function textoDaFalha(motivo: FalhaDoAgente): string {
  // O tipo ja garante o texto; o "??" so protege de um codigo que chegue
  // de fora do tipo em tempo de execucao.
  return TEXTO_DA_FALHA[motivo] ?? TEXTO_DA_FALHA.desconhecida;
}

/**
 * O passo de quando o assistente respondeu sem consultar preco nem a base
 * (docs/02, Tela 6: "Sem consulta").
 */
export const PASSO_SEM_CONSULTA =
  "Respondeu só com a configuração, sem consultar nada.";

/**
 * O passo de quando a resposta do assistente prometia passar para a equipe
 * sem passar de fato (Q5): a resposta nao sai e a conversa passa.
 */
export const PASSO_DA_PASSAGEM_EM_TEXTO =
  "A resposta do assistente dizia que a conversa ia para a equipe. Ela não foi enviada, e a conversa passou para a equipe.";

const LIMITE_DO_TRECHO = 60;

function trecho(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, " ");
  const letras = Array.from(limpo);
  return letras.length <= LIMITE_DO_TRECHO
    ? limpo
    : `${letras
        .slice(0, LIMITE_DO_TRECHO - 1)
        .join("")
        .trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Leitura da resposta da API (defensiva: nada aqui confia no formato)
// ---------------------------------------------------------------------------

type ItemDaSaida = Record<string, unknown> & { type?: unknown };

type RespostaLida = {
  modelo: string;
  /** null quando a resposta veio sem usage (entra a estimativa). */
  uso: UsoDoLlm | null;
  requestId: string | undefined;
  status: string | undefined;
  itens: ItemDaSaida[];
};

const ITENS_ACEITOS: ReadonlySet<string> = new Set([
  "reasoning",
  "function_call",
  "message",
]);

function lerResposta(
  resposta: unknown,
  modeloPedido: string,
): RespostaLida | null {
  if (typeof resposta !== "object" || resposta === null) {
    return null;
  }
  const r = resposta as Record<string, unknown>;
  return {
    modelo:
      typeof r.model === "string" && r.model !== "" ? r.model : modeloPedido,
    uso: usoDaResposta(r.usage as Parameters<typeof usoDaResposta>[0]),
    requestId: idDaRequisicao(r._request_id) ?? undefined,
    status: statusParaLog(r.status),
    itens: Array.isArray(r.output)
      ? (r.output as unknown[]).filter(
          (item): item is ItemDaSaida =>
            typeof item === "object" && item !== null,
        )
      : [],
  };
}

/**
 * A resposta terminou do jeito esperado? null so com status "completed",
 * saida nao vazia, so itens conhecidos e nenhuma recusa.
 */
function anomalia(resposta: unknown, lida: RespostaLida): MotivoDaFalha | null {
  const r = resposta as Record<string, unknown>;
  if (r.status === "incomplete") {
    const detalhes = r.incomplete_details as { reason?: unknown } | null;
    if (detalhes?.reason === "max_output_tokens") {
      return "max_tokens";
    }
    if (detalhes?.reason === "content_filter") {
      return "recusa";
    }
    return "parada_inesperada";
  }
  if (r.status !== "completed" || lida.itens.length === 0) {
    return "parada_inesperada";
  }
  for (const item of lida.itens) {
    if (typeof item.type !== "string" || !ITENS_ACEITOS.has(item.type)) {
      return "parada_inesperada";
    }
    if (
      item.type === "message" &&
      Array.isArray(item.content) &&
      (item.content as unknown[]).some(
        (parte) =>
          typeof parte === "object" &&
          parte !== null &&
          (parte as { type?: unknown }).type === "refusal",
      )
    ) {
      return "recusa";
    }
  }
  return null;
}

/**
 * O texto da mensagem FINAL da rodada. Modelos novos podem mandar, antes
 * dela, mensagens de comentario (phase "commentary", "Vou conferir para
 * voce."): elas ficam no historico, mas nao sao a resposta. Final e a
 * mensagem com phase "final_answer" ou sem phase. Nenhuma ou mais de uma
 * final: null (saida_invalida, falha fechada).
 */
function textoDaMensagemFinal(itens: readonly ItemDaSaida[]): string | null {
  const finais = itens.filter(
    (item) =>
      item.type === "message" &&
      (item.phase === undefined ||
        item.phase === null ||
        item.phase === "final_answer"),
  );
  const [mensagem] = finais;
  if (
    finais.length !== 1 ||
    mensagem === undefined ||
    !Array.isArray(mensagem.content)
  ) {
    return null;
  }
  const partes: string[] = [];
  for (const parte of mensagem.content as unknown[]) {
    if (
      typeof parte === "object" &&
      parte !== null &&
      (parte as { type?: unknown }).type === "output_text" &&
      typeof (parte as { text?: unknown }).text === "string"
    ) {
      partes.push((parte as { text: string }).text);
    }
  }
  return partes.join("");
}

/**
 * A resposta final (FORMATO_DA_RESPOSTA). Mensagem vazia e formato errado
 * sao falha fechada; codigo de pergunta desconhecido so nao entra na
 * trilha (nao derruba a resposta).
 */
const respostaFinalSchema = z
  .object({
    mensagem: z.string().trim().min(1),
    encerra_a_conversa: z.boolean(),
    perguntas_da_base: z.array(z.string().max(200)).max(200),
  })
  .strict();

type RespostaFinal = z.infer<typeof respostaFinalSchema>;

function lerRespostaFinal(texto: string | null): RespostaFinal | null {
  if (texto === null) {
    return null;
  }
  try {
    const lido = respostaFinalSchema.safeParse(JSON.parse(texto));
    return lido.success ? lido.data : null;
  } catch {
    return null;
  }
}

function argumentosDe(item: ItemDaSaida): unknown {
  if (typeof item.arguments !== "string") {
    return null;
  }
  try {
    return JSON.parse(item.arguments);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Historico para o modelo
// ---------------------------------------------------------------------------

/** O marcador de midia (ou mensagem sem texto) de cada lado da conversa. */
export const MARCADOR_DE_MIDIA = {
  paciente: "(o paciente mandou um conteúdo que não é texto)",
  // No WhatsApp (E3) o historico traz tambem o que a clinica mandou (modelo
  // de mensagem, arquivo do Atendimento): nao foi o paciente quem mandou.
  assistente: "(a clínica mandou um conteúdo que não é texto)",
} as const;

/** Mensagem pronta para o modelo: minimizada (LGPD), sem marcador, cortada. */
export function mensagemParaOModelo(mensagem: MensagemDaConversa): string {
  if ((mensagem.tipo ?? "texto") !== "texto" || mensagem.texto === null) {
    return MARCADOR_DE_MIDIA[mensagem.autor];
  }
  return Array.from(semMarcadores(minimizarParaLlm(mensagem.texto)))
    .slice(0, CARACTERES_POR_MENSAGEM)
    .join("");
}

export function historicoParaOModelo(
  mensagens: readonly MensagemDaConversa[],
): ResponseInputItem[] {
  return mensagens.slice(-MENSAGENS_NO_HISTORICO).map((mensagem) => ({
    role: mensagem.autor === "paciente" ? "user" : "assistant",
    content: mensagemParaOModelo(mensagem),
  }));
}

/** As mensagens do paciente depois da ultima resposta (nao respondidas). */
export function mensagensPendentes(
  mensagens: readonly MensagemDaConversa[],
): MensagemDaConversa[] {
  const pendentes: MensagemDaConversa[] = [];
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const mensagem = mensagens[i];
    if (mensagem === undefined || mensagem.autor !== "paciente") {
      break;
    }
    pendentes.unshift(mensagem);
  }
  return pendentes;
}

/**
 * Saudacao (so na primeira resposta), mensagem e encerramento (so quando a
 * conversa terminou), com uma linha em branco entre eles. Se passar do
 * limite do filtro, tira o encerramento e depois a saudacao: a resposta
 * nunca e cortada (o filtro barra o que ainda passar).
 */
export function comporResposta(entrada: {
  mensagem: string;
  saudacao: string | null;
  encerramento: string | null;
  primeiraResposta: boolean;
  encerra: boolean;
}): string {
  const mensagem = entrada.mensagem.trim();
  const saudacao =
    entrada.primeiraResposta && entrada.saudacao?.trim()
      ? entrada.saudacao.trim()
      : null;
  const encerramento =
    entrada.encerra && entrada.encerramento?.trim()
      ? entrada.encerramento.trim()
      : null;
  const juntar = (partes: (string | null)[]) =>
    partes.filter((p): p is string => p !== null).join(SEPARADOR_DA_RESPOSTA);
  for (const partes of [
    [saudacao, mensagem, encerramento],
    [saudacao, mensagem, null],
    [null, mensagem, null],
  ]) {
    const texto = juntar(partes);
    if (tamanhoNoFiltro(texto) <= LIMITE_DO_RASCUNHO) {
      return texto;
    }
  }
  return mensagem;
}

// ---------------------------------------------------------------------------
// Custo maximo do turno (a reserva do gasto, lib/agente/gasto.ts)
// ---------------------------------------------------------------------------

/**
 * O teto do que um turno pode custar, em microdolar, para reservar ANTES de
 * chamar qualquer modelo: o classificador, o verificador (com o maior
 * rascunho) e MAXIMO_DE_RODADAS rodadas do agente (MAXIMO_DE_RODADAS_COM_
 * AGENDA quando a configuracao da as ferramentas de agenda), cada uma com o
 * corpo inteiro desta configuracao, o teto de saida e, a partir da segunda,
 * a saida das rodadas anteriores e a maior resposta possivel de uma
 * ferramenta. null quando nao ha preco (quem chama falha fechado).
 */
export function custoMaximoDoTurno(entrada: {
  config: ConfigDoAgente;
  catalogo: CatalogoDoAgente;
  mensagens: readonly MensagemDaConversa[];
  agoraMs: number;
  fuso: string;
  modelo: string;
  modeloDosClassificadores: string | null;
  precos: readonly PrecoDoModelo[];
}): number | null {
  const pendentes = mensagensPendentes(entrada.mensagens).map(
    (m) => m.texto ?? "",
  );
  const corpo = {
    instructions: montarInstrucoes({
      config: entrada.config,
      catalogo: entrada.catalogo,
      agoraTexto: agoraNaClinica(entrada.agoraMs, entrada.fuso),
    }),
    input: historicoParaOModelo(entrada.mensagens),
    tools: ferramentasDaChamada(entrada.config),
    text: { format: FORMATO_DA_RESPOSTA },
  };
  const primeira = usoEstimadoDaRodada(corpo, MAX_TOKENS_DO_AGENTE);
  const ferramentas = ferramentasDoAgente(
    entrada.config.habilidades,
    entrada.config.agenda,
  );
  const comAgenda = ferramentas.some(ehFerramentaDeAgenda);
  const crescimento =
    MAX_TOKENS_DO_AGENTE +
    Math.max(
      limiteDaSaidaDaBusca(entrada.catalogo),
      comAgenda ? limiteDaSaidaDaBuscaDeHorario(entrada.catalogo) : 0,
    ) +
    FOLGA_DA_CHAMADA;
  const rodadas = comAgenda ? MAXIMO_DE_RODADAS_COM_AGENDA : MAXIMO_DE_RODADAS;
  const classificadores =
    entrada.modeloDosClassificadores?.trim() || "desconhecido";
  const chamadas: [UsoDoLlm, string][] = [
    [usoEstimadoDoClassificador(pendentes), classificadores],
    [usoEstimadoDoVerificador(null, pendentes), classificadores],
  ];
  for (let rodada = 0; rodada < rodadas; rodada += 1) {
    chamadas.push([
      {
        ...primeira,
        tokensEntrada: primeira.tokensEntrada + rodada * crescimento,
      },
      entrada.modelo,
    ]);
  }
  let total = 0;
  for (const [uso, modelo] of chamadas) {
    const custo = custoMaximoDaChamada(uso, modelo, entrada.precos);
    if (custo === null) {
      return null;
    }
    total += custo;
  }
  return total;
}

// ---------------------------------------------------------------------------
// O turno
// ---------------------------------------------------------------------------

/** Hoje (AAAA-MM-DD) no fuso da clinica, para a idade do portao. */
function hojeNoFuso(agoraMs: number, fuso: string): string | null {
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(agoraMs));
    return /^\d{4}-\d{2}-\d{2}$/.test(partes) ? partes : null;
  } catch {
    return null;
  }
}

export async function executarTurnoDoAgente(
  entrada: EntradaDoTurno,
): Promise<ResultadoDoTurno> {
  const agora = entrada.agora ?? Date.now;
  const inicio = agora();
  const prazoEm = inicio + (entrada.prazoMs ?? PRAZO_DO_TURNO_MS);
  const trilha: PassoDoTurno[] = [];
  const uso: UsoDoModelo[] = [];
  const ferramentasUsadas: FerramentaDoAgente[] = [];
  let filtro: DecisaoDoFiltro | null = null;
  let descartados: TextoDescartado = { instrucoes: false, itensDaBase: 0 };
  const modeloDosClassificadores =
    entrada.modeloDosClassificadores?.trim() || "desconhecido";

  const fraseFixa = (
    desfecho: DesfechoDoTurno,
    rascunhoBloqueado: string | null = null,
  ): ResultadoDoTurno => ({
    tipo: "frase_fixa",
    resposta: FRASE_DE_ESCALONAMENTO,
    desfecho,
    trilha,
    uso,
    versaoDoPrompt: VERSAO_DO_PROMPT,
    filtro,
    descartados,
    ferramentasUsadas,
    rascunhoBloqueado,
  });
  const escalar = (
    motivo: MotivoDeEscalonamento,
    origem: OrigemDoEscalonamento,
    gatilho: GatilhoDeEntrada | null,
    texto: string,
  ) => {
    trilha.push({ tipo: "equipe", texto: `Passou para a equipe: ${texto}` });
    return fraseFixa({ tipo: "escalou", motivo, gatilho, origem });
  };
  const falhar = (motivo: FalhaDoAgente) => {
    trilha.push({
      tipo: "equipe",
      texto: `Passou para a equipe: ${textoDaFalha(motivo)}`,
    });
    return fraseFixa({ tipo: "falhou", motivo });
  };

  try {
    const pendentes = mensagensPendentes(entrada.mensagens);
    if (pendentes.length === 0) {
      return falhar("sem_mensagem");
    }

    // 1. Portao deterministico, no texto ORIGINAL do contato (local, sem
    // rede): a mascara do nome so existe para a OpenAI e nao pode esconder
    // um gatilho. Os passos 3, 4 e 6 continuam so com o texto mascarado.
    const gatilhos = detectarGatilhosDeEntrada({
      mensagens: pendentes.map((m): MensagemDeEntrada => ({
        tipo: m.tipo ?? "texto",
        texto: m.textoOriginal ?? m.texto,
      })),
      dataDeNascimento: entrada.dataDeNascimento ?? null,
      hojeNaClinica:
        entrada.hojeNaClinica ?? hojeNoFuso(entrada.agoraMs, entrada.fuso),
    });
    const gatilho = gatilhos[0];
    if (gatilho !== undefined) {
      trilha.push({
        tipo: "outro",
        texto: "A mensagem foi conferida antes de chegar ao assistente.",
      });
      return escalar(
        MOTIVO_DO_GATILHO[gatilho],
        "portao",
        gatilho,
        textoDoGatilho(gatilho),
      );
    }

    // 2. Configuracao.
    const { cliente, modelo } = entrada;
    if (cliente === null) {
      return falhar("sem_cliente");
    }
    if (modelo === null) {
      return falhar("modelo_invalido");
    }
    const identificador = identificadorValido(entrada.identificadorDeSeguranca);
    if (!identificador.ok || identificador.valor === null) {
      return falhar("sem_identificador");
    }

    // 3. Classificador de entrada.
    const textosPendentes = pendentes.map((m) => m.texto ?? "");
    const restanteDoPortao = prazoEm - agora();
    const classificacao = await classificarComPrazo(
      entrada.classificador,
      textosPendentes,
      Math.min(PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS, restanteDoPortao),
    );
    const usoDoClassificador = (classificacao as { uso?: unknown }).uso;
    const modeloDoClassificador = (classificacao as { modelo?: unknown })
      .modelo;
    const ehFalhaDoClassificador =
      (classificacao as { tipo?: unknown }).tipo === "falha";
    if (usoDoClassificador !== null && typeof usoDoClassificador === "object") {
      uso.push({
        papel: "classificador",
        modelo:
          typeof modeloDoClassificador === "string"
            ? modeloDoClassificador
            : modeloDosClassificadores,
        uso: usoDoClassificador as UsoDoLlm,
      });
    } else if (
      !ehFalhaDoClassificador ||
      chamadaPodeTerSidoCobrada((classificacao as { motivo?: unknown }).motivo)
    ) {
      // Sem usage (corte por prazo, erro de rede): a chamada pode ter sido
      // cobrada; entra a estimativa maxima.
      uso.push({
        papel: "classificador",
        modelo:
          typeof modeloDoClassificador === "string"
            ? modeloDoClassificador
            : modeloDosClassificadores,
        uso: usoEstimadoDoClassificador(textosPendentes),
      });
    }
    const decisao = decidirPeloClassificador(classificacao);
    trilha.push({
      tipo: "outro",
      texto: "A mensagem foi conferida antes de chegar ao assistente.",
    });
    if (decisao.escalar) {
      if (decisao.gatilho !== null) {
        return escalar(
          MOTIVO_DO_GATILHO[decisao.gatilho],
          "classificador",
          decisao.gatilho,
          textoDoGatilho(decisao.gatilho),
        );
      }
      if (
        decisao.motivo === "incoerente" ||
        decisao.motivo === "confianca_baixa"
      ) {
        return falhar(decisao.motivo);
      }
      // Falha do classificador (ou "gatilho" sem gatilho, que nao deveria
      // existir): o motivo que ele devolveu, se for um conhecido.
      const motivo = (classificacao as { motivo?: unknown }).motivo;
      return falhar(ehMotivoDaFalha(motivo) ? motivo : "desconhecida");
    }

    // 4. O agente.
    const ferramentas: FunctionTool[] = ferramentasDaChamada(entrada.config);
    const permitidas: ReadonlySet<string> = new Set(
      ferramentasDoAgente(entrada.config.habilidades, entrada.config.agenda),
    );
    const agendaDoTurno = criarAgendaDoTurno({
      porta: entrada.agenda ?? null,
      catalogo: entrada.catalogo,
      config: entrada.config,
      agoraMs: entrada.agoraMs,
      fuso: entrada.fuso,
    });
    // Sobe para MAXIMO_DE_RODADAS_COM_AGENDA quando o turno usa a agenda.
    let maximoDeRodadas = MAXIMO_DE_RODADAS;
    const fixos = parametrosFixosDoAgente(modelo);
    const instrucoes = montarInstrucoes({
      config: entrada.config,
      catalogo: entrada.catalogo,
      agoraTexto: agoraNaClinica(entrada.agoraMs, entrada.fuso),
    });
    const perguntas = perguntasParaOModelo(entrada.config.base);
    // Texto que deixou de passar nas regras fica de fora (segunda trava);
    // a equipe Conduzza fica sabendo pelo log, sem o texto.
    descartados = textoDescartado(entrada.config);
    if (descartados.instrucoes) {
      log.warn("agente_texto_descartado", {
        clinic_id: entrada.clinicId,
        kind: "instrucoes",
        count: 1,
      });
    }
    if (descartados.itensDaBase > 0) {
      log.warn("agente_texto_descartado", {
        clinic_id: entrada.clinicId,
        kind: "base",
        count: descartados.itensDaBase,
      });
    }
    const historico: ResponseInputItem[] = historicoParaOModelo(
      entrada.mensagens,
    );
    const precosDoTurno: number[] = [];
    let final: RespostaFinal | null = null;

    for (let rodada = 1; rodada <= maximoDeRodadas; rodada += 1) {
      if (entrada.conferirTrava) {
        const liberada = await entrada.conferirTrava().catch(() => false);
        if (!liberada) {
          return falhar("liberacao_suspensa");
        }
      }
      const restante = prazoEm - agora() - RESERVA_DO_FILTRO_MS;
      if (restante < 1_000) {
        return falhar("prazo");
      }
      const prazoDaChamada = Math.min(PRAZO_DA_RODADA_MS, restante);

      const corpo: ResponseCreateParamsNonStreaming = {
        model: fixos.model,
        reasoning: { effort: fixos.reasoning.effort },
        include: [...fixos.include],
        store: fixos.store,
        service_tier: fixos.service_tier,
        instructions: instrucoes,
        input: historico,
        tools: ferramentas,
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: MAX_TOKENS_DO_AGENTE,
        text: { format: FORMATO_DA_RESPOSTA },
        prompt_cache_key: chaveDeCacheDaClinica("agente", entrada.clinicId),
        safety_identifier: identificador.valor,
      };

      const inicioDaRodada = agora();
      const corrida = await correrComPrazo(async (sinal) => {
        try {
          const resposta: unknown = await cliente.responses.create(corpo, {
            timeout: prazoDaChamada,
            maxRetries: 1,
            signal: sinal,
          });
          return { ok: true as const, resposta };
        } catch (erro) {
          return { ok: false as const, erro };
        }
      }, prazoDaChamada + 500);
      const duracao = agora() - inicioDaRodada;
      // A chamada que nao voltou com usage pode ter sido cobrada.
      const estimarARodada = () =>
        uso.push({
          papel: "agente",
          modelo,
          uso: usoEstimadoDaRodada(corpo, MAX_TOKENS_DO_AGENTE),
        });

      if (corrida.tipo !== "resultado") {
        estimarARodada();
        log.warn("ia_agente_falhou", {
          provider: "openai",
          kind: "agente",
          clinic_id: entrada.clinicId,
          modelo,
          error_code: corrida.tipo === "prazo" ? "timeout" : "desconhecida",
          duration_ms: duracao,
        });
        return falhar(corrida.tipo === "prazo" ? "timeout" : "desconhecida");
      }
      if (!corrida.valor.ok) {
        const classificado = classificarErroDoLlm(corrida.valor.erro);
        if (chamadaPodeTerSidoCobrada(classificado.motivo)) {
          estimarARodada();
        }
        const campos = {
          provider: "openai",
          kind: "agente",
          clinic_id: entrada.clinicId,
          modelo,
          error_code: classificado.codigo ?? classificado.motivo,
          http_status: classificado.httpStatus ?? undefined,
          request_id: classificado.requestId ?? undefined,
          duration_ms: duracao,
        };
        if (classificado.grave) {
          log.error("ia_agente_falhou", campos);
        } else {
          log.warn("ia_agente_falhou", campos);
        }
        return falhar(classificado.motivo);
      }

      const lida = lerResposta(corrida.valor.resposta, modelo);
      if (lida === null) {
        estimarARodada();
        log.warn("ia_agente_saida_invalida", {
          provider: "openai",
          kind: "agente",
          clinic_id: entrada.clinicId,
          modelo,
        });
        return falhar("saida_invalida");
      }
      if (lida.uso === null) {
        estimarARodada();
      } else {
        uso.push({ papel: "agente", modelo: lida.modelo, uso: lida.uso });
      }

      const problema = anomalia(corrida.valor.resposta, lida);
      if (problema !== null) {
        log.warn("ia_agente_parada", {
          provider: "openai",
          kind: "agente",
          clinic_id: entrada.clinicId,
          modelo: lida.modelo,
          status: lida.status,
          stop_reason: problema,
          request_id: lida.requestId,
          duration_ms: duracao,
        });
        return falhar(problema);
      }

      const chamadas = lida.itens.filter(
        (item) => item.type === "function_call",
      );
      if (chamadas.length === 0) {
        final = lerRespostaFinal(textoDaMensagemFinal(lida.itens));
        if (final === null) {
          log.warn("ia_agente_saida_invalida", {
            provider: "openai",
            kind: "agente",
            clinic_id: entrada.clinicId,
            modelo: lida.modelo,
            request_id: lida.requestId,
          });
          return falhar("saida_invalida");
        }
        break;
      }

      // Escalar vence qualquer outra chamada da mesma rodada.
      const pedidoDeEscalar = chamadas.find(
        (c) => c.name === NOME_DO_ESCALONAMENTO,
      );
      if (pedidoDeEscalar !== undefined) {
        const motivo = motivoDoEscalonamento(argumentosDe(pedidoDeEscalar));
        return escalar(
          motivo,
          "agente",
          null,
          ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[motivo],
        );
      }

      // O historico da proxima rodada leva tudo o que o modelo produziu
      // (raciocinio cifrado inclusive) e a saida de cada ferramenta.
      historico.push(...(lida.itens as unknown as ResponseInputItem[]));
      for (const chamada of chamadas) {
        const nome = chamada.name;
        if (
          typeof nome !== "string" ||
          !permitidas.has(nome) ||
          typeof chamada.call_id !== "string"
        ) {
          return falhar("ferramenta_invalida");
        }
        if (nome === NOME_DA_BUSCA) {
          const busca = buscarProcedimento(
            entrada.catalogo,
            argumentosDe(chamada),
          );
          precosDoTurno.push(...busca.precos);
          trilha.push({ tipo: "preco", texto: busca.passo });
          ferramentasUsadas.push("buscar_procedimento");
          historico.push({
            type: "function_call_output",
            call_id: chamada.call_id,
            output: busca.saida,
          });
          continue;
        }
        if (!ehFerramentaDeAgenda(nome)) {
          return falhar("ferramenta_invalida");
        }
        // Agenda (E4): leitura e efeito pela porta; o turno ganha rodadas.
        maximoDeRodadas = MAXIMO_DE_RODADAS_COM_AGENDA;
        const efeito = await agendaDoTurno.executar(
          nome,
          argumentosDe(chamada),
        );
        ferramentasUsadas.push(nome);
        if (efeito.tipo === "liberacao_suspensa") {
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          return falhar("liberacao_suspensa");
        }
        if (efeito.tipo === "falha") {
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          log.warn("ia_agente_agenda_falhou", {
            kind: nome,
            clinic_id: entrada.clinicId,
          });
          return falhar("desconhecida");
        }
        precosDoTurno.push(...efeito.precos);
        trilha.push({ tipo: "agenda", texto: efeito.passo });
        historico.push({
          type: "function_call_output",
          call_id: chamada.call_id,
          output: efeito.saida,
        });
      }
    }

    if (final === null) {
      return falhar("rodadas_esgotadas");
    }

    // Q5 (revisao de producao de 19/10/2026): a resposta que promete passar
    // para a equipe sem ter chamado escalar_humano e uma passagem. O texto do
    // modelo nunca sai (a conversa ficaria na IA sem ninguem avisado); sai a
    // frase fixa, e a conversa vai para a equipe como em toda passagem.
    if (prometePassagemParaAEquipe(final.mensagem)) {
      trilha.push({ tipo: "outro", texto: PASSO_DA_PASSAGEM_EM_TEXTO });
      return escalar(
        "agente_pediu",
        "texto_do_agente",
        null,
        ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.agente_pediu,
      );
    }

    // A base que o modelo disse que usou (codigos conhecidos, sem repetir).
    const usadas = new Set<string>();
    for (const codigo of final.perguntas_da_base) {
      const pergunta = perguntas.find(
        (p) => p.codigo === codigo.trim().toLowerCase(),
      );
      if (pergunta !== undefined && !usadas.has(pergunta.codigo)) {
        usadas.add(pergunta.codigo);
        trilha.push({
          tipo: "base",
          texto: `Usou a pergunta da base: ${trecho(pergunta.item.pergunta)}`,
        });
      }
    }

    if (
      !trilha.some(
        (passo) =>
          passo.tipo === "preco" ||
          passo.tipo === "base" ||
          passo.tipo === "agenda",
      )
    ) {
      trilha.push({ tipo: "outro", texto: PASSO_SEM_CONSULTA });
    }

    // 5. Saudacao e encerramento antes do filtro. A marca do nome do
    // contato (historico do WhatsApp) nunca vira vocativo na resposta; se
    // so sobrar pontuacao ("Fulano!" vira "!"), falha fechada.
    const mensagemSemMarca = semAMarcaDoNome(final.mensagem);
    if (!/\p{L}/u.test(mensagemSemMarca)) {
      return falhar("saida_invalida");
    }
    const rascunho = comporResposta({
      mensagem: mensagemSemMarca,
      saudacao: entrada.config.saudacao,
      encerramento: entrada.config.encerramento,
      primeiraResposta: !entrada.mensagens.some(
        (m) => m.autor === "assistente",
      ),
      encerra: final.encerra_a_conversa,
    });

    // 6. Filtro de saida.
    filtro = await filtrarSaida({
      rascunho,
      contexto: {
        precosDoTurno,
        nomesDoCatalogo: nomesDoCatalogo(entrada.catalogo),
        mensagensDoPaciente: textosPendentes,
      },
      verificador: entrada.verificador,
      prazoEm,
      agora,
    });
    const chamadaDoVerificador = filtro.verificador;
    if (chamadaDoVerificador?.uso) {
      uso.push({
        papel: "verificador",
        modelo: chamadaDoVerificador.modelo ?? modeloDosClassificadores,
        uso: chamadaDoVerificador.uso,
      });
    } else if (
      filtro.aprovado ||
      filtro.camada === "modelo" ||
      (filtro.camada === "falha" &&
        chamadaPodeTerSidoCobrada(filtro.motivoDaFalha))
    ) {
      // O verificador foi chamado e nao voltou com usage (prazo, rede): a
      // chamada pode ter sido cobrada; entra a estimativa maxima.
      uso.push({
        papel: "verificador",
        modelo: chamadaDoVerificador?.modelo ?? modeloDosClassificadores,
        uso: usoEstimadoDoVerificador(rascunho, textosPendentes),
      });
    }
    if (!filtro.aprovado) {
      trilha.push({
        tipo: "bloqueio",
        texto: `A resposta foi bloqueada pela conformidade: ${rotuloDoBloqueio(filtro.categoria)}.`,
      });
      trilha.push({
        tipo: "equipe",
        texto: `Passou para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.conformidade}`,
      });
      return fraseFixa(
        {
          tipo: "bloqueou",
          categoria: filtro.categoria,
          camada: filtro.camada,
          motivoDaFalha: filtro.motivoDaFalha,
        },
        rascunho,
      );
    }
    trilha.push({
      tipo: "outro",
      texto: "A resposta passou na conformidade.",
    });
    return {
      tipo: "resposta",
      resposta: filtro.texto,
      desfecho: { tipo: "respondeu" },
      trilha,
      uso,
      versaoDoPrompt: VERSAO_DO_PROMPT,
      filtro,
      descartados,
      ferramentasUsadas,
      rascunhoBloqueado: null,
    };
  } catch {
    // Rede de seguranca: excecao inesperada vira frase fixa. Nunca olha a
    // mensagem do erro (pode ecoar texto do paciente).
    log.warn("ia_agente_falhou", {
      provider: "openai",
      kind: "agente",
      clinic_id: entrada.clinicId,
      error_code: "desconhecida",
    });
    return falhar("desconhecida");
  }
}
