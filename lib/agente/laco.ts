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
//     TextoAprovado; bloqueio vira a frase fixa. Desde a AG2 (27/10/2026)
//     o filtro recebe os fatos do turno (lib/agente/fatos.ts): as saidas
//     das ferramentas, a configuracao publicada que vai ao modelo e o que
//     cada ferramenta afirmou de convenio e de acao. Data e hora, endereco,
//     convenio e acao de agenda so passam com fato; erro ao montar os fatos
//     e falha fechada. Revisao 2 da AG2: o filtro monta com os fatos um
//     resumo sem dado de paciente (resumo-dos-fatos.ts, com as respostas da
//     base que o modelo disse ter usado) e o verificador por modelo tambem
//     julga fato; resumo que nao monta e falha fechada.
//
// AG2 (27/10/2026): as consultas do Cadastro (consultar_unidades,
// consultar_requisitos e buscar_profissionais) leem so o catalogo carregado
// antes do turno, como buscar_procedimento: nao gravam, nao leem a Agenda e
// nao mudam o numero de rodadas. O que elas trazem (endereco, horario de
// funcionamento, o convenio que o profissional atende) entra nos fatos do
// turno; o passo da trilha e do tipo "cadastro".
//
// E4 (agenda, contrato da E4 secao 2): as ferramentas de agenda
// (buscar_horario, reservar_horario, agendar e confirmar_presenca) rodam pela
// porta da agenda (entrada.agenda): no WhatsApp gravam pelas RPCs com o
// job_id do turno (a idempotencia), no simulador nao gravam. O turno que usa
// uma delas ganha ate MAXIMO_DE_RODADAS_COM_AGENDA rodadas; reservar, agendar
// e confirmar valem uma vez por turno (ferramentas/agenda-do-turno.ts).
//
// Onda 2 (item 5, P5a, P5b e P5c; P11a):
//  - as ferramentas de frase fixa (fora_do_assunto e sou_assistente_virtual,
//    sem argumentos) encerram o turno: a resposta e a frase do dono
//    (lib/domain/conformidade/frase-fixa.ts), com a saudacao e o aviso
//    colados como numa resposta comum, e passa pelo filtro de saida INTEIRO
//    (regras e verificador, falha fechada: bloqueio vira a frase de
//    escalonamento). Decisao 'respondeu', tool_used da ferramenta;
//  - fora do assunto pela segunda vez na janela (entrada.
//    foraDoAssuntoNaJanela no limite, P5b: 1) passa para a equipe com o
//    motivo de sistema fora_do_assunto e a frase de escalonamento;
//  - o aviso de assistente virtual (P11a) vai antes da primeira resposta da
//    IA em cada janela, depois da saudacao e antes do filtro, e nunca sai
//    sozinho de uma resposta grande (a resposta grande e barrada inteira);
//  - o tipo do contato (lead ou paciente) vai na ultima linha das
//    instrucoes (item 4), fora do prefixo do cache.
//
// AG3 (27/10/2026), o agendamento completo, com o ESTADO DO ATENDIMENTO
// entre as mensagens (lib/agente/atendimento.ts; no WhatsApp, lido e
// gravado pelo executor, lib/jobs/responder-com-ia.ts; no simulador, no
// historico assinado):
//  - o turno parte do estado lido (entrada.atendimento) e devolve o novo
//    (resultado.atendimento); sem estado, roda como antes da AG3;
//  - antes da primeira rodada, a reconferencia leve (agenda-do-turno.ts,
//    preparar): os horarios ja oferecidos continuam livres? a reserva esta
//    viva? Vai ao modelo no bloco <atendimento_em_andamento>, e so o
//    reconferido agora e fato de horario livre (fatosDoEstado);
//  - as ferramentas novas (registrar_dados_do_paciente e
//    consultar_cadastro_do_contato) rodam pela porta da agenda; a recusa que
//    passa para a equipe (consulta para outra pessoa, menor de idade) para o
//    turno com o motivo do banco (origem "ferramenta");
//  - a segunda falha seguida do atendimento (RESULTADOS_QUE_SAO_FALHA) passa
//    para a equipe com falhas_seguidas (origem "sistema"), sem a resposta;
//  - na passagem, a nota interna para a equipe (notaParaAEquipe), montada so
//    do estado e do Cadastro.
//
// AG4 (27/10/2026), remarcar e cancelar: as ferramentas novas rodam pela
// porta da agenda; nos momentos que decidem (a pergunta e o resultado do
// cancelamento e da remarcacao) a ferramenta devolve uma FRASE FIXA (tipo
// "frase"), que encerra o turno como as frases da onda 2: o laco a compoe
// com a saudacao e o aviso e a manda pelo filtro INTEIRO, com os fatos dela
// (bloqueio vira a frase de escalonamento). As recusas que sao da equipe
// passam com pedido_de_agenda e a do prazo com fora_do_prazo (origem
// "ferramenta").
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
  ehFerramentaDoCadastro,
  ferramentasDoAgente,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  type ConfigDoAgente,
  type FerramentaDoAgente,
  type MotivoDeEscalonamento,
  type TipoDoContato,
} from "@/lib/domain/agente/config";
import type {
  CamadaDoFiltro,
  CategoriaDeConformidade,
  GatilhoDeEntrada,
} from "@/lib/domain/conformidade/categorias";
import type { FatosDoTurno } from "@/lib/domain/conformidade/fatos-do-turno";
import {
  filtrarSaida,
  type DecisaoDoFiltro,
} from "@/lib/domain/conformidade/filtro";
import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";
import {
  detectarGatilhosDeEntrada,
  LIMITE_DE_MENSAGEM,
  pedidoDeConsultaParaOutraPessoa,
  type MensagemDeEntrada,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  mascararParaOVerificador,
  minimizarParaLlm,
} from "@/lib/domain/conformidade/minimizar";
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

import { FALHAS_PARA_PASSAR } from "./atendimento";
import {
  criarAgendaDoTurno,
  type AgendaDoTurno,
  type AtendimentoDoTurno,
  type AtendimentoParaOModelo,
  type FechamentoDoTurno,
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
  executarConsultaDoCadastro,
  limiteDasConsultasDoCadastro,
} from "./ferramentas/consultas-do-cadastro";
import {
  motivoDoEscalonamento,
  NOME_DO_ESCALONAMENTO,
} from "./ferramentas/escalar-humano";
import {
  NOME_DO_ASSISTENTE_VIRTUAL,
  NOME_DO_FORA_DO_ASSUNTO,
  semArgumentos,
} from "./ferramentas/fora-do-assunto";
import { limiteDaSaidaDasMinhasConsultas } from "./ferramentas/minhas-consultas";
import {
  esconderCodigosCurtos,
  falaDaCarteirinha,
} from "./ferramentas/registrar-dados";
import {
  chamadaPodeTerSidoCobrada,
  custoMaximoDaChamada,
  FOLGA_DA_CHAMADA,
  usoEstimadoDaRodada,
  usoEstimadoDoClassificador,
  usoEstimadoDoVerificador,
} from "./gasto";
import { anoNaClinica, montarFatosDoTurno, type SaidaParaOsFatos } from "./fatos";
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
/**
 * Respostas educadas de fora do assunto por janela antes de passar para a
 * equipe (onda 2, decisao do dono P5b: 1). A segunda pergunta fora do
 * assunto na mesma janela passa com o motivo fora_do_assunto.
 */
export const LIMITE_DO_FORA_DO_ASSUNTO = 1;
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
 * reservar, marcar e confirmar presenca, E4), consulta do Cadastro
 * (unidades, o que o paciente precisa e quem atende, AG2), passagem para a
 * equipe, bloqueio da conformidade e o resto.
 */
export type TipoDoPasso =
  "preco" | "base" | "agenda" | "cadastro" | "equipe" | "bloqueio" | "outro";

/** Um passo do "Por que a IA respondeu isso". Nunca texto do paciente. */
export type PassoDoTurno = { tipo: TipoDoPasso; texto: string };

/**
 * Quem decidiu passar a conversa para a equipe. "insistencia" (onda 2, item
 * 5): o modelo escolheu fora_do_assunto de novo na janela e o sistema
 * passou pela contagem (P5b), sem escalar_humano.
 */
export type OrigemDoEscalonamento =
  | "portao"
  | "classificador"
  | "agente"
  | "texto_do_agente"
  | "insistencia"
  // AG3: a ferramenta recusou com um motivo que passa para a equipe
  // (consulta para outra pessoa, menor de idade, D-8).
  | "ferramenta"
  // AG3 (item 9): a segunda falha seguida do atendimento.
  | "sistema";

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
  /**
   * AG3: o estado do atendimento e os dados depois do turno (o executor do
   * WhatsApp grava com gravar_atendimento_da_ia; o simulador guarda no
   * historico assinado). Ausente: o turno rodou sem estado.
   */
  atendimento?: FechamentoDoTurno;
  /**
   * AG3 (item 8): a nota interna para a equipe quando o turno passa a
   * conversa, montada SO do estado e do Cadastro (nunca texto do modelo nem
   * do paciente). Nula: nada a contar.
   */
  notaParaAEquipe?: string | null;
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
   * Onda 2 (item 4): contact.kind do contato (no simulador, o "Testar
   * como"). Vai na ultima linha das instrucoes. Nulo ou ausente: sem linha.
   */
  contato?: TipoDoContato | null;
  /**
   * Onda 2 (item 5, P5b): quantas vezes a IA ja respondeu fora do assunto
   * nesta janela (no WhatsApp, as decisoes 'respondeu' com tool_used
   * fora_do_assunto desde o desde da janela; no simulador, as falas do
   * assistente com a frase). No limite (LIMITE_DO_FORA_DO_ASSUNTO), a
   * proxima passa para a equipe. Ausente: 0.
   */
  foraDoAssuntoNaJanela?: number;
  /**
   * Onda 2 (P11a): a IA ainda nao respondeu nesta janela, entao a resposta
   * leva o aviso de assistente virtual. Ausente: nenhuma fala do assistente
   * no historico (o mesmo criterio da saudacao; o simulador).
   */
  primeiraRespostaDaIa?: boolean;
  /**
   * A porta da agenda (E4): a Agenda e as RPCs do WhatsApp, ou a do
   * simulador, que nao grava. Sem porta, ferramenta de agenda e falha
   * fechada.
   */
  agenda?: PortaDaAgenda | null;
  /**
   * AG3: o estado do atendimento lido no comeco do turno (no WhatsApp,
   * ler_atendimento_da_ia; no simulador, o do historico assinado). Ausente
   * ou nulo: o turno roda como antes da AG3, sem estado.
   */
  atendimento?: AtendimentoDoTurno | null;
  /**
   * AG3: o nascimento que o paciente informou nesta conversa (aaaa-mm-dd),
   * so para a idade atendida do profissional. Nunca vai ao modelo nem a
   * log. Ausente: nenhum.
   */
  nascimentoInformado?: string | null;
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
  // AG2: os fatos do turno (lib/domain/conformidade/fatos-do-turno.ts).
  acao_nao_executada: "ação de agenda que não foi feita",
  cobertura_nao_verificada: "convênio sem confirmação no cadastro",
  horario_nao_verificado: "data ou horário sem confirmação na agenda",
  endereco_nao_verificado: "endereço fora do cadastro",
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

/** Onda 2 (item 5): a resposta educada de fora do assunto (contrato, 4.4). */
export const PASSO_DO_FORA_DO_ASSUNTO =
  "Respondeu que só ajuda com assuntos da clínica.";

/** Onda 2 (item 5, P5b): a segunda pergunta fora do assunto (contrato, 4.4). */
export const PASSO_DA_INSISTENCIA_FORA_DO_ASSUNTO =
  "A pessoa insistiu num assunto fora da clínica: passou para a equipe.";

/** Onda 2 (P5c): a resposta a "você é um robô?". */
export const PASSO_DO_ASSISTENTE_VIRTUAL =
  "Respondeu que é a assistente virtual da clínica e ofereceu uma pessoa da equipe.";

/** AG3 (item 9): a segunda falha seguida do atendimento. */
export const PASSO_DAS_FALHAS_SEGUIDAS =
  "O atendimento não avançou em duas tentativas seguidas: a resposta não foi enviada.";

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

/** AG3 (LGPD): o que muda no texto que vai aos modelos neste turno. */
export type OpcoesDoTextoParaOsModelos = {
  /**
   * Esconde tambem o codigo curto (4 a 7 digitos) que a minimizacao deixa
   * passar: a carteirinha em jogo (esconderCodigosNoTurno).
   */
  esconderCodigos?: boolean;
};

/**
 * AG3 (LGPD): a carteirinha esta em jogo neste turno quando o atendimento a
 * pede ou ja a tem, ou quando alguma mensagem do historico fala dela (a
 * pessoa que manda o numero antes de alguem pedir). Entao nenhum codigo
 * curto do historico vai a modelo nenhum (esconderCodigosCurtos): a
 * minimizacao so esconde 8 digitos ou mais, e a carteirinha nunca vai.
 */
export function esconderCodigosNoTurno(entrada: {
  mensagens: readonly MensagemDaConversa[];
  atendimento?: AtendimentoDoTurno | null;
}): boolean {
  const dados = entrada.atendimento?.dados ?? null;
  if (
    dados !== null &&
    (dados.carteirinha || dados.faltam.includes("carteirinha"))
  ) {
    return true;
  }
  return entrada.mensagens
    .slice(-MENSAGENS_NO_HISTORICO)
    .some(
      (m) =>
        (m.tipo ?? "texto") === "texto" &&
        m.texto !== null &&
        falaDaCarteirinha(m.texto),
    );
}

/**
 * O texto de uma mensagem para o classificador e o verificador (que
 * minimizam de novo, sem efeito): como esta, ou, com a carteirinha em jogo,
 * minimizado e com os codigos curtos escondidos.
 */
export function textoParaOsModelos(
  mensagem: MensagemDaConversa,
  opcoes: OpcoesDoTextoParaOsModelos = {},
): string {
  const texto = mensagem.texto ?? "";
  return opcoes.esconderCodigos === true
    ? esconderCodigosCurtos(minimizarParaLlm(texto))
    : texto;
}

/** Mensagem pronta para o modelo: minimizada (LGPD), sem marcador, cortada. */
export function mensagemParaOModelo(
  mensagem: MensagemDaConversa,
  opcoes: OpcoesDoTextoParaOsModelos = {},
): string {
  if ((mensagem.tipo ?? "texto") !== "texto" || mensagem.texto === null) {
    return MARCADOR_DE_MIDIA[mensagem.autor];
  }
  return Array.from(
    semMarcadores(minimizarParaLlm(textoParaOsModelos(mensagem, opcoes))),
  )
    .slice(0, CARACTERES_POR_MENSAGEM)
    .join("");
}

export function historicoParaOModelo(
  mensagens: readonly MensagemDaConversa[],
  opcoes: OpcoesDoTextoParaOsModelos = {},
): ResponseInputItem[] {
  return mensagens.slice(-MENSAGENS_NO_HISTORICO).map((mensagem) => ({
    role: mensagem.autor === "paciente" ? "user" : "assistant",
    content: mensagemParaOModelo(mensagem, opcoes),
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
 * Saudacao (so na primeira resposta), aviso de assistente virtual (onda 2,
 * P11a: quem chama manda so na primeira resposta da IA na janela), mensagem
 * e encerramento (so quando a conversa terminou), com uma linha em branco
 * entre eles. Se passar do limite do filtro, tira o encerramento e depois a
 * saudacao: a resposta nunca e cortada (o filtro barra o que ainda passar).
 * O aviso NUNCA sai: se nem ele com a mensagem cabe, vai assim mesmo, e o
 * filtro barra o texto longo (falha fechada: a conversa passa para a
 * equipe, e o paciente nunca recebe a resposta da IA sem o aviso).
 */
export function comporResposta(entrada: {
  mensagem: string;
  saudacao: string | null;
  encerramento: string | null;
  primeiraResposta: boolean;
  encerra: boolean;
  aviso?: string | null;
}): string {
  const mensagem = entrada.mensagem.trim();
  const saudacao =
    entrada.primeiraResposta && entrada.saudacao?.trim()
      ? entrada.saudacao.trim()
      : null;
  const aviso = entrada.aviso?.trim() ? entrada.aviso.trim() : null;
  const encerramento =
    entrada.encerra && entrada.encerramento?.trim()
      ? entrada.encerramento.trim()
      : null;
  const juntar = (partes: (string | null)[]) =>
    partes.filter((p): p is string => p !== null).join(SEPARADOR_DA_RESPOSTA);
  for (const partes of [
    [saudacao, aviso, mensagem, encerramento],
    [saudacao, aviso, mensagem, null],
    [null, aviso, mensagem, null],
  ]) {
    const texto = juntar(partes);
    if (tamanhoNoFiltro(texto) <= LIMITE_DO_RASCUNHO) {
      return texto;
    }
  }
  return juntar([null, aviso, mensagem, null]);
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
  /** Onda 2 (item 4): a linha do contato entra na conta da entrada. */
  contato?: TipoDoContato | null;
  /**
   * AG3: o estado do atendimento (o bloco <atendimento_em_andamento> entra
   * na conta). Use atendimentoParaEstimativa: sem a reconferencia, toda
   * situacao fica com o texto mais longo.
   */
  atendimento?: AtendimentoParaOModelo | null;
}): number | null {
  // AG3: com a carteirinha em jogo o texto vai com os codigos curtos
  // escondidos, que pode ficar uns caracteres mais longo ("1234" vira
  // "[numero]"): a conta usa o mais longo dos dois.
  const maisLongo = <T,>(a: T, b: T): T =>
    JSON.stringify(a).length >= JSON.stringify(b).length ? a : b;
  const escondido: OpcoesDoTextoParaOsModelos = { esconderCodigos: true };
  const pendentes = mensagensPendentes(entrada.mensagens).map((m) =>
    maisLongo(m.texto ?? "", textoParaOsModelos(m, escondido)),
  );
  const corpo = {
    instructions: montarInstrucoes({
      config: entrada.config,
      catalogo: entrada.catalogo,
      agoraTexto: agoraNaClinica(entrada.agoraMs, entrada.fuso),
      contato: entrada.contato ?? null,
      atendimento: entrada.atendimento ?? null,
    }),
    input: maisLongo(
      historicoParaOModelo(entrada.mensagens),
      historicoParaOModelo(entrada.mensagens, escondido),
    ),
    tools: ferramentasDaChamada(entrada.config),
    text: { format: FORMATO_DA_RESPOSTA },
  };
  const primeira = usoEstimadoDaRodada(corpo, MAX_TOKENS_DO_AGENTE);
  const ferramentas = ferramentasDoAgente(
    entrada.config.habilidades,
    entrada.config.agenda,
    entrada.config.prazos,
  );
  const comAgenda = ferramentas.some(ehFerramentaDeAgenda);
  const crescimento =
    MAX_TOKENS_DO_AGENTE +
    Math.max(
      limiteDaSaidaDaBusca(entrada.catalogo),
      comAgenda ? limiteDaSaidaDaBuscaDeHorario(entrada.catalogo) : 0,
      // AG2: as consultas do Cadastro vem sempre (habilidade travada).
      limiteDasConsultasDoCadastro(entrada.catalogo),
      // AG4: as consultas do contato (a busca da remarcacao cabe no teto de
      // buscar_horario).
      ferramentas.includes("consultar_minhas_consultas")
        ? limiteDaSaidaDasMinhasConsultas()
        : 0,
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

/**
 * AG3: o bloco do estado para a estimativa do gasto (custoMaximoDoTurno),
 * antes do turno: sem porta, nada e reconferido, e cada horario fica com a
 * situacao "nao conferido" (a mais longa). Nunca lanca.
 */
export function atendimentoParaEstimativa(entrada: {
  atendimento: AtendimentoDoTurno | null;
  config: ConfigDoAgente;
  catalogo: CatalogoDoAgente;
  agoraMs: number;
  fuso: string;
}): AtendimentoParaOModelo | null {
  if (entrada.atendimento === null) {
    return null;
  }
  try {
    return criarAgendaDoTurno({
      porta: null,
      catalogo: entrada.catalogo,
      config: entrada.config,
      agoraMs: entrada.agoraMs,
      fuso: entrada.fuso,
      atendimento: entrada.atendimento,
    }).paraOModelo();
  } catch {
    return null;
  }
}

/** As mensagens do paciente no formato de registrar_dados_do_paciente. */
function mensagensDoPacienteParaOsDados(
  mensagens: readonly MensagemDaConversa[],
): { mascarado: string; original: string }[] {
  return mensagens.flatMap((m) =>
    m.autor === "paciente" && (m.tipo ?? "texto") === "texto" && m.texto !== null
      ? [{ mascarado: m.texto, original: m.textoOriginal ?? m.texto }]
      : [],
  );
}

/** O que a nota para a equipe diz do motivo da passagem. */
function motivoParaANota(desfecho: DesfechoDoTurno): string {
  switch (desfecho.tipo) {
    case "escalou":
      return ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[desfecho.motivo];
    case "bloqueou":
      return ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.conformidade;
    case "falhou":
      return textoDaFalha(desfecho.motivo);
    case "respondeu":
      return "";
  }
}

// ---------------------------------------------------------------------------
// O turno
// ---------------------------------------------------------------------------

/** O relogio que parte de `agoraMs` e anda com o tempo de verdade. */
function relogioDesde(agoraMs: number): () => number {
  const inicio = Date.now();
  return () => agoraMs + (Date.now() - inicio);
}

/**
 * Revisao final da AG3 (achado 14): o turno da coleta de dados, em que a
 * pessoa pode mandar o nome completo e o nascimento: com o estado do
 * atendimento, uma reserva no estado (ou a pergunta "Confirma" feita) ou o
 * nome ou o nascimento ainda faltando para marcar. Revisao curta das
 * correcoes (achado 1): decide so se o NASCIMENTO some da copia do
 * verificador; o classificador le o texto inteiro sempre, e o nome so some
 * quando o servidor validou no turno (nomesValidados).
 */
export function turnoDaColetaDeDados(
  atendimento: AtendimentoDoTurno | null,
): boolean {
  if (atendimento === null) {
    return false;
  }
  const { estado, dados } = atendimento;
  return (
    estado.slot_hold_id !== null ||
    estado.etapa === "aguardando_confirmacao" ||
    dados.faltam.includes("nome_completo") ||
    dados.faltam.includes("data_nascimento")
  );
}

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

/**
 * Um turno do agente. AG3: com o estado do atendimento (entrada.atendimento),
 * o resultado traz o estado novo (atendimento) e, na passagem para a
 * equipe, a nota interna (notaParaAEquipe); quem grava e o executor do
 * WhatsApp (o simulador guarda no historico assinado).
 */
export async function executarTurnoDoAgente(
  entrada: EntradaDoTurno,
): Promise<ResultadoDoTurno> {
  const comEstado =
    entrada.atendimento !== null && entrada.atendimento !== undefined;
  const pendentes = mensagensPendentes(entrada.mensagens);
  const agendaDoTurno = criarAgendaDoTurno({
    porta: entrada.agenda ?? null,
    catalogo: entrada.catalogo,
    config: entrada.config,
    agoraMs: entrada.agoraMs,
    fuso: entrada.fuso,
    atendimento: entrada.atendimento ?? null,
    mensagens: {
      doPaciente: mensagensDoPacienteParaOsDados(entrada.mensagens),
      pendentes: mensagensDoPacienteParaOsDados(pendentes),
    },
    nascimentos: [entrada.dataDeNascimento, entrada.nascimentoInformado].filter(
      (n): n is string => typeof n === "string" && n !== "",
    ),
    // Revisao final da AG3: o relogio do turno (a reserva que vence no meio
    // do turno conta como vencida). Sem relogio injetado, o instante do
    // comeco do turno mais o tempo que ja passou.
    agora: entrada.agora ?? relogioDesde(entrada.agoraMs),
  });
  const resultado = await turnoDoAgente(entrada, agendaDoTurno);
  if (!comEstado) {
    return resultado;
  }
  try {
    const passou = resultado.tipo === "frase_fixa";
    const atendimento = agendaDoTurno.fechar({
      mensagemFinal: resultado.tipo === "resposta" ? resultado.resposta : null,
      passou,
    });
    return {
      ...resultado,
      atendimento,
      notaParaAEquipe: passou
        ? agendaDoTurno.nota(motivoParaANota(resultado.desfecho))
        : null,
    };
  } catch {
    // O fechamento nunca deveria lancar. Se lancar, o resultado volta SEM o
    // estado novo: o executor do WhatsApp (lib/jobs/responder-com-ia.ts,
    // passo 11b) grava o estado LIDO no comeco do turno, como estava (a
    // versao sobe), e segue com a resposta ja aprovada pelo filtro; o
    // simulador fica com o estado de antes. Nada do que o turno fez vira
    // etapa nova: sem a etapa aguardando_confirmacao, o agendar seguinte e
    // recusado (sem_confirmacao_do_paciente).
    log.warn("ia_agente_estado_falhou", {
      kind: "agente",
      clinic_id: entrada.clinicId,
    });
    return resultado;
  }
}

async function turnoDoAgente(
  entrada: EntradaDoTurno,
  agendaDoTurno: AgendaDoTurno,
): Promise<ResultadoDoTurno> {
  const comEstado =
    entrada.atendimento !== null && entrada.atendimento !== undefined;
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
    // Revisao final da AG3 (achado 15, D-8): o pedido de consulta para outra
    // pessoa adulta ("para minha mae", "pro meu marido") passa para a equipe
    // antes do modelo, com o motivo do banco e sem gatilho (o CHECK de
    // gatilho_entrada nao muda). Filho e filha seguem pela regra do menor.
    if (
      pedidoDeConsultaParaOutraPessoa(
        pendentes
          .filter((m) => (m.tipo ?? "texto") === "texto")
          .map((m) => m.textoOriginal ?? m.texto),
      )
    ) {
      trilha.push({
        tipo: "outro",
        texto: "A mensagem foi conferida antes de chegar ao assistente.",
      });
      return escalar(
        "consulta_para_outra_pessoa",
        "portao",
        null,
        ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.consulta_para_outra_pessoa,
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

    // 3. Classificador de entrada. AG3 (LGPD): com a carteirinha em jogo,
    // o codigo curto que a minimizacao deixa passar nao vai ao
    // classificador, ao agente nem ao verificador (o servidor acha a
    // carteirinha no texto original: registrar_dados_do_paciente).
    const opcoesDoTexto: OpcoesDoTextoParaOsModelos = {
      esconderCodigos: esconderCodigosNoTurno(entrada),
    };
    const textosPendentes = pendentes.map((m) =>
      textoParaOsModelos(m, opcoesDoTexto),
    );
    // Revisao curta das correcoes da AG3 (achado 1, ALTO, CFM): o
    // classificador le o texto SEM mascara de nome e de nascimento. A
    // mascara pela deixa ("me chamo", "meu nome e") escondia o sintoma dito
    // depois do nome ("me chamo ana e to com o dente mole" chegava como "me
    // chamo [nome]"); o agente ja le o texto inteiro do mesmo provedor, e
    // esconder sintoma do portao e o risco maior. A minimizacao de sempre
    // (CPF, telefone, e-mail, os codigos da carteirinha) continua.
    const naColeta = turnoDaColetaDeDados(entrada.atendimento ?? null);
    const anoCorrente = anoNaClinica(entrada.agoraMs, entrada.fuso);
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
      ferramentasDoAgente(
        entrada.config.habilidades,
        entrada.config.agenda,
        entrada.config.prazos,
      ),
    );
    // AG3: a reconferencia leve do estado (os horarios ja oferecidos, a
    // reserva e a consulta marcada nesta conversa), antes da primeira
    // rodada. Nunca lanca: o que nao deu para conferir fica "nao conferido".
    if (comEstado) {
      await agendaDoTurno.preparar();
    }
    // Sobe para MAXIMO_DE_RODADAS_COM_AGENDA quando o turno usa a agenda.
    let maximoDeRodadas = MAXIMO_DE_RODADAS;
    const fixos = parametrosFixosDoAgente(modelo);
    // A mesma linha da hora vai ao modelo e aos fatos do turno.
    const agoraTexto = agoraNaClinica(entrada.agoraMs, entrada.fuso);
    const instrucoes = montarInstrucoes({
      config: entrada.config,
      catalogo: entrada.catalogo,
      agoraTexto,
      contato: entrada.contato ?? null,
      atendimento: agendaDoTurno.paraOModelo(),
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
      opcoesDoTexto,
    );
    const precosDoTurno: number[] = [];
    // AG2: o que cada ferramenta do turno devolveu, para os fatos do turno.
    const ferramentasDoTurno: SaidaParaOsFatos[] = [];
    let final: RespostaFinal | null = null;
    // Onda 2 (item 5 e P5c): a ferramenta de frase fixa que encerrou o turno.
    let fraseEscolhida: "fora_do_assunto" | "sou_assistente_virtual" | null =
      null;
    // AG4: a frase fixa da agenda (a pergunta ou o resultado do cancelamento
    // e da remarcacao) que encerrou o turno.
    let fraseDaAgenda: string | null = null;

    rodadas: for (let rodada = 1; rodada <= maximoDeRodadas; rodada += 1) {
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

      // Onda 2 (item 5 e P5c): a ferramenta de frase fixa encerra o turno.
      // So vale sozinha na rodada e sem argumento (strict, sem
      // parametros): junto de outra chamada, com argumento ou fora das
      // permitidas, e anomalia e falha fechada.
      const pedidoDeFrase = chamadas.find(
        (c) =>
          c.name === NOME_DO_FORA_DO_ASSUNTO ||
          c.name === NOME_DO_ASSISTENTE_VIRTUAL,
      );
      if (pedidoDeFrase !== undefined) {
        const nome = pedidoDeFrase.name as
          "fora_do_assunto" | "sou_assistente_virtual";
        if (
          chamadas.length !== 1 ||
          !permitidas.has(nome) ||
          !semArgumentos(argumentosDe(pedidoDeFrase))
        ) {
          return falhar("ferramenta_invalida");
        }
        fraseEscolhida = nome;
        break;
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
          ferramentasDoTurno.push({ saida: busca.saida, fatos: busca.fatos });
          trilha.push({ tipo: "preco", texto: busca.passo });
          ferramentasUsadas.push("buscar_procedimento");
          historico.push({
            type: "function_call_output",
            call_id: chamada.call_id,
            output: busca.saida,
          });
          continue;
        }
        if (ehFerramentaDoCadastro(nome)) {
          // AG2: so le o catalogo do turno (nunca lanca; uma excecao cai na
          // rede de seguranca do turno, falha fechada).
          const consulta = executarConsultaDoCadastro(
            nome,
            entrada.catalogo,
            argumentosDe(chamada),
            {
              informarConvenio: permitidas.has(NOME_DA_BUSCA),
              agendaLigada: permitidas.has("buscar_horario"),
            },
          );
          ferramentasDoTurno.push({
            saida: consulta.saida,
            fatos: consulta.fatos,
          });
          trilha.push({ tipo: "cadastro", texto: consulta.passo });
          ferramentasUsadas.push(nome);
          historico.push({
            type: "function_call_output",
            call_id: chamada.call_id,
            output: consulta.saida,
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
        if (efeito.tipo === "passar") {
          // AG3 (D-8): a consulta e para outra pessoa, ou o paciente e menor
          // de idade. O servidor passa a conversa, com o motivo do banco; o
          // modelo nao escreve mais nada.
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          return escalar(
            efeito.motivo,
            "ferramenta",
            null,
            ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[efeito.motivo],
          );
        }
        if (efeito.tipo === "falha") {
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          log.warn("ia_agente_agenda_falhou", {
            kind: nome,
            clinic_id: entrada.clinicId,
          });
          return falhar("desconhecida");
        }
        if (efeito.tipo === "frase") {
          // AG4: a frase fixa encerra o turno (o resto da rodada nao roda).
          // Os fatos dela entram nos do turno, como uma saida de ferramenta.
          ferramentasDoTurno.push({ saida: efeito.saida, fatos: efeito.fatos });
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          fraseDaAgenda = efeito.texto;
          break rodadas;
        }
        precosDoTurno.push(...efeito.precos);
        ferramentasDoTurno.push({ saida: efeito.saida, fatos: efeito.fatos });
        trilha.push({ tipo: "agenda", texto: efeito.passo });
        historico.push({
          type: "function_call_output",
          call_id: chamada.call_id,
          output: efeito.saida,
        });
      }
    }

    // AG3 (item 9): a segunda falha seguida do atendimento passa para a
    // equipe (a resposta deste turno nao sai). Falha e o que
    // RESULTADOS_QUE_SAO_FALHA diz (lib/agente/atendimento.ts).
    if (comEstado && agendaDoTurno.falhasDepois() >= FALHAS_PARA_PASSAR) {
      trilha.push({
        tipo: "outro",
        texto: PASSO_DAS_FALHAS_SEGUIDAS,
      });
      return escalar(
        "falhas_seguidas",
        "sistema",
        null,
        ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.falhas_seguidas,
      );
    }

    const primeiraResposta = !entrada.mensagens.some(
      (m) => m.autor === "assistente",
    );
    // P11a: o aviso de assistente virtual na primeira resposta da IA na
    // janela (no WhatsApp, o executor diz; no simulador, a mesma regra da
    // saudacao).
    const aviso =
      (entrada.primeiraRespostaDaIa ?? primeiraResposta)
        ? FRASE_DO_ASSISTENTE_VIRTUAL
        : null;
    let rascunho: string;
    // Revisao 2 da AG2: as respostas da base que o modelo disse ter usado,
    // para o resumo dos fatos que vai ao verificador.
    const respostasDaBase: string[] = [];

    if (fraseDaAgenda !== null) {
      // AG4: a frase fixa da agenda, com a saudacao e o aviso colados como
      // numa resposta comum, pelo filtro inteiro (com os fatos dela).
      rascunho = comporResposta({
        mensagem: fraseDaAgenda,
        saudacao: entrada.config.saudacao,
        encerramento: null,
        primeiraResposta,
        encerra: false,
        aviso,
      });
    } else if (fraseEscolhida !== null) {
      ferramentasUsadas.push(fraseEscolhida);
      // P5b: a segunda pergunta fora do assunto na janela passa para a
      // equipe (motivo de sistema), com a frase de escalonamento.
      if (
        fraseEscolhida === "fora_do_assunto" &&
        (entrada.foraDoAssuntoNaJanela ?? 0) >= LIMITE_DO_FORA_DO_ASSUNTO
      ) {
        trilha.push({
          tipo: "equipe",
          texto: PASSO_DA_INSISTENCIA_FORA_DO_ASSUNTO,
        });
        return fraseFixa({
          tipo: "escalou",
          motivo: "fora_do_assunto",
          gatilho: null,
          origem: "insistencia",
        });
      }
      const ehForaDoAssunto = fraseEscolhida === "fora_do_assunto";
      trilha.push({
        tipo: "outro",
        texto: ehForaDoAssunto
          ? PASSO_DO_FORA_DO_ASSUNTO
          : PASSO_DO_ASSISTENTE_VIRTUAL,
      });
      // A frase do dono, com a saudacao e o aviso colados como numa
      // resposta comum (a do "você é um robô?" ja e o aviso: nao repete).
      rascunho = comporResposta({
        mensagem: ehForaDoAssunto
          ? FRASE_FORA_DO_ASSUNTO
          : FRASE_DO_ASSISTENTE_VIRTUAL,
        saudacao: entrada.config.saudacao,
        encerramento: null,
        primeiraResposta,
        encerra: false,
        aviso: ehForaDoAssunto ? aviso : null,
      });
    } else {
      if (final === null) {
        return falhar("rodadas_esgotadas");
      }

      // Q5 (revisao de producao de 19/10/2026): a resposta que promete
      // passar para a equipe sem ter chamado escalar_humano e uma passagem.
      // O texto do modelo nunca sai (a conversa ficaria na IA sem ninguem
      // avisado); sai a frase fixa, e a conversa vai para a equipe como em
      // toda passagem. Revisao da AG2: com o que o turno fez (o aviso da
      // aprovacao depois de marcar e informacao; "vou conferir a agenda"
      // sem ferramenta e promessa).
      if (
        prometePassagemParaAEquipe(final.mensagem, {
          usouFerramenta: ferramentasDoTurno.length > 0,
          acoes: ferramentasDoTurno.flatMap(({ fatos }) =>
            fatos?.acao === undefined ? [] : [fatos.acao],
          ),
        })
      ) {
        trilha.push({ tipo: "outro", texto: PASSO_DA_PASSAGEM_EM_TEXTO });
        return escalar(
          "agente_pediu",
          "texto_do_agente",
          null,
          ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.agente_pediu,
        );
      }

      // A base que o modelo disse que usou (codigos conhecidos, sem
      // repetir).
      const usadas = new Set<string>();
      for (const codigo of final.perguntas_da_base) {
        const pergunta = perguntas.find(
          (p) => p.codigo === codigo.trim().toLowerCase(),
        );
        if (pergunta !== undefined && !usadas.has(pergunta.codigo)) {
          usadas.add(pergunta.codigo);
          respostasDaBase.push(pergunta.item.resposta);
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
            passo.tipo === "agenda" ||
            passo.tipo === "cadastro",
        )
      ) {
        trilha.push({ tipo: "outro", texto: PASSO_SEM_CONSULTA });
      }

      // 5. Saudacao, aviso (P11a) e encerramento antes do filtro. A marca do
      // nome do contato (historico do WhatsApp) nunca vira vocativo na
      // resposta; se so sobrar pontuacao ("Fulano!" vira "!"), falha
      // fechada.
      const mensagemSemMarca = semAMarcaDoNome(final.mensagem);
      if (!/\p{L}/u.test(mensagemSemMarca)) {
        return falhar("saida_invalida");
      }
      rascunho = comporResposta({
        mensagem: mensagemSemMarca,
        saudacao: entrada.config.saudacao,
        encerramento: entrada.config.encerramento,
        primeiraResposta,
        encerra: final.encerra_a_conversa,
        aviso,
      });
    }

    // 6. Filtro de saida, com os fatos do turno (AG2). Montar os fatos que
    // lanca e falha fechada: a resposta nao sai e a conversa passa.
    let fatos: FatosDoTurno;
    try {
      // AG3: o estado entra como fonte de dia e hora (o que ja foi
      // oferecido), e so o reconferido agora e horario livre.
      const doEstado = agendaDoTurno.fatosDoEstado();
      fatos = montarFatosDoTurno({
        config: entrada.config,
        catalogo: entrada.catalogo,
        agoraTexto,
        agoraMs: entrada.agoraMs,
        fuso: entrada.fuso,
        ferramentas:
          doEstado === null
            ? ferramentasDoTurno
            : [...ferramentasDoTurno, doEstado],
        respostasDaBase,
      });
    } catch {
      log.warn("ia_agente_fatos_falharam", {
        kind: "agente",
        clinic_id: entrada.clinicId,
      });
      return falhar("desconhecida");
    }
    // Achado 14 e revisao curta das correcoes (achado 1): a copia do
    // verificador vai sem o nascimento (no turno da coleta) e sem os nomes
    // que o servidor VALIDOU neste turno e que parecem nome
    // (nomesValidados; nunca a heuristica da deixa, que engolia o sintoma).
    // O resto, sintoma inclusive, chega como esta. O texto aprovado continua
    // o rascunho, byte a byte.
    const nomesValidados = agendaDoTurno.nomesValidados();
    const verificador: Verificador =
      naColeta || nomesValidados.length > 0
        ? (pedido) => {
            const copia = (texto: string) =>
              mascararParaOVerificador(texto, { anoCorrente, nomesValidados });
            return entrada.verificador({
              ...pedido,
              rascunho: copia(pedido.rascunho),
              mensagensDoPaciente: pedido.mensagensDoPaciente.map(copia),
            });
          }
        : entrada.verificador;
    filtro = await filtrarSaida({
      rascunho,
      contexto: {
        precosDoTurno,
        nomesDoCatalogo: nomesDoCatalogo(entrada.catalogo),
        mensagensDoPaciente: textosPendentes,
        fatos,
      },
      verificador,
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
