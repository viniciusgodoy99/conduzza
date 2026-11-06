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
// [AG7 preparo] AG7 (03/11/2026; D-75 a D-80): a orientacao de preparo
// aprovada pelo responsavel tecnico. O modelo so escolhe o procedimento
// (enviar_preparo, que so vale SOZINHA no turno); o turno termina com o
// resultado "preparo", sem o filtro no texto do preparo (nada dele passa pelo
// modelo), e o executor manda a mensagem do sistema montada pelo banco. A
// introducao que o modelo pode mandar (decisao do dono de 06/11/2026) passa
// pela regra propria e pelo filtro inteiro; barrada, sai so o bloco. Depois de marcar
// um procedimento com texto em vigor, o sistema cola a frase F2 na resposta
// (pelo filtro inteiro). O historico que vai ao modelo troca a mensagem do
// preparo e todo trecho dos textos de preparo da clinica por marcadores; o
// filtro barra a resposta que copia um trecho deles. O classificador roda a
// variante da politica com a habilidade (comPreparo).
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
import type {
  FatoDoArquivo,
  FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import {
  filtrarSaida,
  type DecisaoDoFiltro,
} from "@/lib/domain/conformidade/filtro";
import {
  LIMITE_DO_RASCUNHO,
  // [AG7 preparo] A situacao da pessoa no pedido do preparo (CFM-6).
  situacaoPessoalNoPedidoDoPreparo,
} from "@/lib/domain/conformidade/filtro-deterministico";
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
// [AG7 preparo] início
import {
  problemaDaIntroducao,
  type ProblemaDaIntroducao,
} from "@/lib/domain/conformidade/preparo-aprovado";
import {
  CABECALHO_DO_PREPARO,
  FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
  partesDaMensagemDoPreparo,
  procedimentoDaMensagemDoPreparo,
  RODAPE_DO_PREPARO,
  semOPreparo,
  separarIntroducaoDoPreparo,
  SUBSTITUTO_DA_FALA_SEM_A_MASCARA,
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
  substitutoDaFalaNoFormatoDoPreparo,
  substitutoDaMensagemDoPreparo,
  trechosDoPreparo,
} from "@/lib/domain/preparo";
import { versaoDaPoliticaDoClassificador } from "@/lib/integrations/llm/classificador-de-entrada";
import {
  citacaoDoProcedimento,
  decidirEnvioDoPreparo,
  NOME_DO_ENVIO_DO_PREPARO,
  PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO,
  SAIDA_DO_PROCEDIMENTO_NAO_CONFIRMADO,
} from "./ferramentas/enviar-preparo";
// [AG7 preparo] fim
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
// [AG7 preparo] A mascara refeita depois da troca (CFM-1).
import {
  MARCA_DO_NOME,
  mascararNome,
  semAMarcaDoNome,
  trechosDoNome,
  type TrechoDoTexto,
} from "./marca-do-nome";
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
// [AG6b mídia] início
import type { MotivoDaLeitura } from "@/lib/domain/agente/config";
import type { TipoDeUrgencia } from "@/lib/domain/conformidade/urgencia";
import { MAXIMO_DE_CHAMADAS_DO_LEITOR } from "@/lib/integrations/llm/leitor-de-midia";
import {
  custoMaximoDaTranscricao,
  usoEstimadoDoLeitor,
} from "./gasto";
import {
  AVISO_DO_RESTO_DO_PEDIDO,
  conveniosDaLeitura,
  decidirPelaLeitura,
  mensagemDoArquivoLido,
  FRASE_DA_FIGURINHA,
  itensDoCatalogo,
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA,
  mensagensParaEstimativa,
  midiaNaoLida as mensagemComMidiaNaoLida,
  motivoMaisForte,
  PASSO_DO_MOTIVO_DA_LEITURA,
  PASSOS_DA_MIDIA,
  PREFIXO_DO_AUDIO,
  SEGUNDOS_NA_RESERVA,
  tokensDoArquivoNaReserva,
  type LeituraGravada,
  type MidiaDaConversa,
  type MidiaPronta,
  type PortaDaMidia,
  type ResultadoDaLeitura,
  type ResultadoDaTranscricao,
} from "./midia";
import { USO_ZERADO } from "./uso";
// [AG6b mídia] fim

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
// [AG6b mídia] início
/**
 * AG6b (revisao do prazo): a janela minima do agente que a midia (o preparo,
 * a transcricao e a leitura) nunca usa. O prazo da midia e o resto do turno
 * menos esta janela, a reserva do filtro e, quando o classificador ainda vem
 * depois (a transcricao, passo 2b), o prazo dele
 * (PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS). A midia lenta e cortada ANTES de
 * pagar o classificador e o agente, e o turno nunca passa de prazoEm (a
 * reserva das gravacoes e a do envio, no executor, ficam inteiras).
 * PROPOSTA, sem medir (a prova paga, D-100, foi dispensada pelo dono em 06/11/2026), como os prazos da midia;
 * a conta do minimo do turno com midia esta em
 * PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS (lib/jobs/responder-com-ia.ts).
 */
export const RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS = 3_000;
/**
 * AG6b (revisao do prazo): a porta da midia recebe o prazo menos isto (ela
 * corta ali, com o uso da chamada) e o laco corta de novo no prazo inteiro,
 * para a porta que nao cumprir o prazo nunca levar o turno alem dele. Os
 * cortes em ordem (revisao da juncao): a integracao do modelo corta
 * MARGEM_ENTRE_OS_CORTES_MS e RESERVA_DA_GRAVACAO_DA_LEITURA_MS antes da
 * porta (lib/agente/midia.ts, prazoParaAIntegracao; a fatia da gravacao e
 * da segunda rodada, R3 de d1a15f6), a porta corta esta folga antes do laco.
 */
export const FOLGA_DO_CORTE_DA_MIDIA_MS = 500;
// [AG6b mídia] fim
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

/**
 * Revisao da AG4: quem escreveu a mensagem que nao e do paciente, como o
 * banco guarda (message.author): a IA, a equipe (usuario, inclusive pelo
 * celular) ou o sistema (regua, campanha, mensagem agendada, a frase de
 * escalonamento).
 */
export type AutoriaDaClinica = "ia" | "usuario" | "sistema";

export type MensagemDaConversa = {
  autor: "paciente" | "assistente";
  /**
   * Revisao da AG4 (achado 1): a autoria REAL da mensagem do "assistente"
   * (o historico mostra a IA, a equipe e o sistema todos como
   * "assistente"). So o servidor le isto: a pergunta do cancelamento (T1) e
   * a da remarcacao (T3) so valem quando a mensagem logo antes das
   * pendentes e da IA. Nunca vai a OpenAI. Ausente ou nula: nao se sabe
   * (falha fechada: nao conta como da IA).
   */
  autoria?: AutoriaDaClinica | null;
  /**
   * Revisao final da AG7: message.created_at (ISO), so no historico do
   * WhatsApp; so o servidor le, para o corte de "desde a marcacao".
   */
  criadaEm?: string;
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
  // [AG7 preparo] início
  /**
   * Revisao da AG7 (CFM-1 e MOTOR-1): a fala da clinica de texto como saiu,
   * SEM a mascara do nome (so no historico do WhatsApp). So o laco le
   * (falaDaClinicaParaOModelo): troca nela o texto do preparo pelo marcador
   * e so DEPOIS refaz a mascara com o nome do contato. Nunca vai a OpenAI
   * nem para log. Ausente (o simulador, que nao mascara): a troca e no
   * `texto`.
   */
  textoOriginalDaClinica?: string | null;
  // [AG7 preparo] fim
  // [AG6 urgência] início
  /**
   * A legenda que o contato escreveu na midia (message.body da imagem, do
   * documento ou do video; nunca do audio), como chegou. So a URGENCIA le
   * (lib/domain/conformidade/urgencia.ts: o passo 7c do executor e o portao;
   * revisao de 28/10/2026). Local e sem rede: nunca vai para a OpenAI (a
   * midia vai aos modelos so como o marcador), nem para log, nem para a
   * coleta de dados. Ausente: a midia sem legenda (ou o texto).
   */
  legendaOriginal?: string | null;
  // [AG6 urgência] fim
  // [AG6b mídia] início
  /**
   * AG6b: de onde veio o texto do paciente. "audio": a transcricao (o
   * modelo le "(áudio) ..."; `textoOriginal` e a transcricao sem a mascara).
   * "arquivo": o pedido lido pelo leitor de midia (o modelo le a descricao e
   * a legenda; `texto` e a legenda mascarada). Ausente: o texto digitado.
   */
  origem?: "audio" | "arquivo";
  /**
   * AG6b: o pedido lido ("(a pessoa mandou um pedido de exame ou
   * procedimento com: p3 Hemograma)"), montado pelo servidor so com os
   * codigos e os nomes do Cadastro. So com origem "arquivo".
   */
  arquivo?: {
    descricao: string;
    /** O que o verificador fica sabendo (matriz do dono de 06/11/2026). */
    fato?: FatoDoArquivo;
    /** O pedido novo com o resto fora do Cadastro: o sistema cola o aviso. */
    avisarDoResto?: boolean;
  };
  /**
   * AG6b: a midia do paciente (audio, imagem ou documento) e a situacao dela
   * no turno. So o servidor le: nunca vai a OpenAI nem para log.
   */
  midia?: MidiaDaConversa;
  // [AG6b mídia] fim
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
  | "sistema"
  // [AG6b mídia] início
  // AG6b: o leitor de midia identificou o arquivo (so na trilha).
  | "leitor";
// [AG6b mídia] fim

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
  | { tipo: "falhou"; motivo: FalhaDoAgente }
  // [AG7 preparo] início
  /**
   * AG7: o sistema manda a orientacao de preparo aprovada pelo RT (a versao
   * em vigor do procedimento), sem texto do modelo e sem o filtro. Grava
   * ai_decision_log.desfecho 'enviou_preparo' com a versao e o hash da
   * mensagem que o banco montou.
   */
  | { tipo: "enviou_preparo"; versaoId: string; procedimentoId: string };
// [AG7 preparo] fim

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
  /**
   * Revisao final da AG4 (M1 e B1): o turno parou porque o banco disse
   * mensagem_nova_do_paciente (a pessoa escreveu, ou apagou o que o turno
   * leu, depois da leitura). O desfecho continua o do "sem mensagem" (nada
   * sai, ninguem assume, nenhuma falha); isto o separa do turno que nao
   * tinha mensagem a responder. O executor do WhatsApp NAO grava o estado
   * (ele nao mudou) e garante o job seguinte (enfileirar_resposta_da_ia),
   * para a conversa nunca ficar calada. Ausente: nao foi isso.
   */
  mensagemNova?: true;
  // [AG6b mídia] início
  /**
   * AG6b (D-96): a passagem deste turno tem midia do paciente que o
   * assistente nao leu (sem leitura, "sem fala", video, localizacao). O
   * executor do WhatsApp nao pede a atribuicao ao responsavel (o banco
   * recusa de qualquer jeito, midia_nao_lida). Ausente: nao tem.
   */
  midiaNaoLida?: true;
  /**
   * AG6b (revisao, D-A): a gravacao da leitura da midia recusou com
   * job_antigo (o job e de antes da janela atual: alguem assumiu e devolveu
   * depois dele). O executor do WhatsApp so conclui o job: sem passagem,
   * sem evento, sem frase, sem envio e sem decisao (outro job, o da janela
   * nova, cuida da conversa). O desfecho fica o da liberacao perdida
   * (liberacao_suspensa, a passagem sem frase que confere o D-A de novo):
   * o lado seguro para quem nao conhece esta marca. Ausente: nao foi isso.
   */
  jobAntigo?: true;
  // [AG6b mídia] fim
  // [AG7 preparo] início
  /**
   * AG7: a versao da politica do classificador da variante deste turno
   * (versaoDaPoliticaDoClassificador: com a habilidade "Enviar orientacao de
   * preparo", a variante com preparo). Vai para ai_decision_log.versao_filtro
   * (lib/agente/whatsapp.ts). Ausente: a de sempre.
   */
  versaoDoClassificador?: string;
  // [AG7 preparo] fim
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
    })
  // [AG7 preparo] início
  /**
   * AG7: o turno terminou com enviar_preparo (sozinha) e um procedimento com
   * versao em vigor no catalogo. Nenhum texto do modelo: o executor le a
   * mensagem pronta do banco (ler_preparo_para_envio), confere o hash e a
   * envia como mensagem do sistema; o simulador a mostra. O texto do preparo
   * NUNCA passa por aqui.
   */
  | (Comum & {
      tipo: "preparo";
      preparo: { procedimentoId: string; versaoId: string; versao: number };
      /**
       * A introducao que passou pela regra propria e pelo filtro inteiro, para
       * ir antes do bloco exato (decisao do dono de 06/11/2026). null: sai so o
       * bloco (o modelo nao mandou, ou foi barrada: a trilha diz).
       */
      introducao: string | null;
      resposta: null;
      rascunhoBloqueado: null;
      /**
       * Revisao da AG7 (MOTOR-7): a nota interna da AG3 (procedimento,
       * profissional, reserva, lista de espera) para quando o preparo NAO
       * sai e o executor passa a conversa: pelo motivo da passagem (fora de
       * vigor: assunto_clinico; o texto com recusa: conformidade). No envio
       * ela nao e usada. Ausente: o turno sem estado.
       */
      notasSeOPreparoNaoSair?: Readonly<
        Record<"assunto_clinico" | "conformidade", string | null>
      >;
    });
// [AG7 preparo] fim

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
  // [AG7 preparo] início
  /**
   * Revisao da AG7 (CFM-1): contact.name, so no WhatsApp, o MESMO que o
   * historico usou na mascara. Refaz a mascara do nome na fala da clinica
   * DEPOIS de trocar o texto do preparo pelo marcador. Nunca vai a modelo nem
   * a log. Ausente com fala da clinica que tinha preparo: a fala inteira vira
   * SUBSTITUTO_DA_FALA_SEM_A_MASCARA (falha fechada).
   */
  nomeDoContato?: string | null;
  // [AG7 preparo] fim
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
   * Matriz do dono de 06/11/2026: ja houve leitura ilegivel nesta janela, fora
   * das mensagens deste turno (o ilegivel de agora vai para a equipe). Ausente:
   * nao houve.
   */
  ilegivelNaJanela?: boolean;
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
  /**
   * RR2 de 88e9560 (baixo 6): o INSTANTE em que o turno acaba, no relogio
   * `agora` (o mesmo de quem chama). O executor do WhatsApp conta o prazo do
   * turno ANTES de umas idas ao banco (o estado, o nascimento, a reserva e o
   * turno); contado do comeco do laco, o atraso delas saia da reserva das
   * gravacoes e, com o banco lento, da do envio. Com o instante, o laco e o
   * executor usam a mesma referencia, e essas idas ficam dentro da conta do
   * turno. O turno acaba no que vier primeiro: este instante ou o comeco do
   * laco mais `prazoMs`. Ausente (o simulador) ou invalido: so `prazoMs`.
   */
  prazoEmMs?: number;
  /** Relogio injetavel para teste. */
  agora?: () => number;
  // [AG6b mídia] início
  /**
   * AG6b: a porta da midia (ler o arquivo, transcrever, ler a foto ou o
   * PDF e gravar a leitura). O simulador passa null (D-62): toda midia
   * continua escalando como hoje. Ausente ou nula: nenhuma midia sai.
   */
  midia?: PortaDaMidia | null;
  /**
   * Revisao R3 de d1a15f6 (2): os tetos de tokens do leitor que o executor
   * injetou, os MESMOS do plano, da reserva e da porta (o pior caso do
   * arquivo quando o laco corta a leitura). Ausentes: as constantes do
   * leitor (TETO_DE_TOKENS_POR_IMAGEM e _POR_PAGINA), como na porta.
   */
  tetosDoLeitor?: { imagem: number | null; pagina: number | null };
  // [AG6b mídia] fim
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

/** Por que a introducao nao saiu, na trilha (nunca o texto dela). */
const ROTULO_DO_PROBLEMA_DA_INTRODUCAO: Record<ProblemaDaIntroducao, string> = {
  formato: "fora do formato",
  conteudo: "cita remédio, dose, número, como tomar ou sintoma",
  remedio_do_texto: "cita um remédio do texto aprovado",
};

// [AG7 preparo] início
/**
 * Revisao da AG7 (CFM-2): o passo da trilha quando o texto aprovado do
 * preparo tem o que nunca vai ao paciente (as recusas de
 * problemasDoTextoDoPreparo, reconferidas no envio). So os rotulos das
 * categorias, nunca o texto.
 */
export function passoDoPreparoRecusado(
  recusas: readonly CategoriaDeConformidade[],
): string {
  const rotulos = [...new Set(recusas.map(rotuloDoBloqueio))].join(", ");
  return `A orientação de preparo aprovada tem o que nunca vai ao paciente (${rotulos}): nada foi enviado.`;
}
// [AG7 preparo] fim

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
  // [AG6 urgência] início
  // AG6a: o sinal de emergencia (urgencia.ts) passa com o motivo proprio.
  urgencia: "urgencia",
  // [AG6 urgência] fim
};

// [AG6 urgência] início
/**
 * AG6a: o passo da conferencia da entrada (o mesmo texto dos outros
 * gatilhos do portao), para o executor do WhatsApp repetir na urgencia que
 * ele passa antes do teto e da reserva.
 */
export const PASSO_DA_CONFERENCIA_DA_ENTRADA =
  "A mensagem foi conferida antes de chegar ao assistente.";

/**
 * AG6a (desenho 5.3): o passo da urgencia na trilha ("Por que a IA
 * respondeu isso"). Nunca cita o sinal nem o texto do paciente.
 */
export const PASSO_DA_URGENCIA =
  "A mensagem descreve algo que pode ser uma emergência: passou para a equipe como urgente.";
// [AG6 urgência] fim

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
  // [AG7 preparo] início
  /**
   * AG7: os textos de preparo da clinica (catalogo.textosDePreparo). Na fala
   * da clinica que vai ao modelo, todo trecho igual a um deles vira o
   * marcador (semOPreparo). Ausente: so a mensagem do preparo inteira (pelo
   * cabecalho ou pelo rodape fixos) vira o substituto.
   */
  textosDePreparo?: readonly string[];
  /**
   * Revisao da AG7 (CFM-1): o nome do contato (EntradaDoTurno.nomeDoContato)
   * para refazer a mascara depois da troca. undefined: nao veio (falha
   * fechada na fala que tinha preparo); null: o contato sem nome.
   */
  nomeDoContato?: string | null;
  // [AG7 preparo] fim
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

// [AG7 preparo] início
/** O fim da mensagem do preparo (a linha em branco e o rodape fixo). */
const FIM_DA_MENSAGEM_DO_PREPARO = `\n\n${RODAPE_DO_PREPARO}`;

/**
 * AG7 (contrato, secao 0, item 9): a fala da clinica como o modelo a le.
 *  - A mensagem do preparo do SISTEMA (autoria 'sistema', no formato inteiro:
 *    cabecalho, linha do RT, texto e rodape) vira o substituto "Mensagem do
 *    sistema: a orientação de preparo de ..., aprovada pela clínica, foi
 *    enviada aqui.". Revisao da AG7 (CFM-10): so ela diz "aprovada".
 *  - Qualquer outra fala que comeca pelo cabecalho fixo ou termina no rodape
 *    fixo (a da equipe, a da IA, a de autoria desconhecida, a do sistema fora
 *    do formato) vira o substituto sem "aprovada"
 *    (substitutoDaFalaNoFormatoDoPreparo): o modelo nao le o texto e nao
 *    recebe uma aprovacao que ninguem conferiu.
 *  - Fora disso, todo trecho igual a um texto de preparo da clinica (o que a
 *    regua mandou no toque, o texto antigo) vira o marcador.
 * Recebe o texto SEM a mascara do nome quando ha (falaDaClinicaParaOModelo):
 * a troca vem antes da mascara (CFM-1). Nunca lanca. O modelo nunca le o
 * texto do preparo, nem quando a regua o mandou.
 */
export function falaDaClinicaSemOPreparo(
  texto: string,
  textosDePreparo: readonly string[],
  autoria: AutoriaDaClinica | null = null,
): string {
  return (
    substitutoDaFalaInteira(texto, autoria) ??
    (textosDePreparo.length === 0
      ? texto
      : semOPreparo(texto, textosDePreparo))
  );
}

/**
 * A fala inteira que o modelo nunca le, ou null: a mensagem do preparo do
 * sistema (o substituto "aprovada") e qualquer outra fala no formato (o
 * cabecalho ou o rodape fixos; o substituto sem "aprovada").
 */
function substitutoDaFalaInteira(
  texto: string,
  autoria: AutoriaDaClinica | null,
): string | null {
  // Com a introducao da IA antes do bloco, a fala inteira vira o substituto.
  const separada = separarIntroducaoDoPreparo(texto);
  const partes =
    separada === null ? null : partesDaMensagemDoPreparo(separada.bloco);
  if (partes !== null && autoria === "sistema") {
    return substitutoDaMensagemDoPreparo(partes.procedimento);
  }
  if (texto.startsWith(CABECALHO_DO_PREPARO)) {
    return substitutoDaFalaNoFormatoDoPreparo(
      procedimentoDaMensagemDoPreparo(texto) ?? "",
    );
  }
  if (texto.endsWith(FIM_DA_MENSAGEM_DO_PREPARO)) {
    return substitutoDaFalaNoFormatoDoPreparo("");
  }
  return null;
}

/**
 * O texto com os trechos do preparo trocados pelo marcador e os do nome do
 * contato pela marca, os dois achados no MESMO texto (o corpo como saiu): o
 * preparo vence onde os dois se cruzam, e o resto do nome que sobra fora
 * dele continua mascarado. O marcador nunca e mascarado.
 */
function trocarOPreparoEONome(
  texto: string,
  doPreparo: readonly TrechoDoTexto[],
  doNome: readonly TrechoDoTexto[],
): string {
  // Quem cobre cada posicao: o trecho do preparo (p) ou do nome (n), com o
  // indice dele; o preparo por cima.
  const dono: (string | null)[] = new Array<string | null>(texto.length).fill(
    null,
  );
  doNome.forEach(({ inicio, fim }, i) => {
    for (let k = inicio; k < fim; k += 1) {
      dono[k] = `n${i}`;
    }
  });
  doPreparo.forEach(({ inicio, fim }, i) => {
    for (let k = inicio; k < fim; k += 1) {
      dono[k] = `p${i}`;
    }
  });
  let saida = "";
  let k = 0;
  while (k < texto.length) {
    const atual = dono[k] ?? null;
    let fim = k + 1;
    while (fim < texto.length && (dono[fim] ?? null) === atual) {
      fim += 1;
    }
    saida +=
      atual === null
        ? texto.slice(k, fim)
        : atual.startsWith("p")
          ? SUBSTITUTO_DO_TEXTO_DO_PREPARO
          : MARCA_DO_NOME;
    k = fim;
  }
  return saida;
}

/**
 * Revisao da AG7 (CFM-1 e MOTOR-1): o texto da fala da clinica que vai ao
 * modelo, com a troca do preparo ANTES da mascara do nome do contato.
 *  - Com o corpo como saiu (textoOriginalDaClinica, o historico do
 *    WhatsApp): a fala inteira no formato do preparo vira o substituto; os
 *    trechos dos textos de preparo da clinica sao achados no corpo como saiu
 *    (em NFC) e viram o marcador, e o nome do contato e mascarado so no
 *    resto, nas mesmas posicoes de sempre. Sem trecho nenhum, o `texto` de
 *    sempre (a mascara do historico). Sem o nome (quem chamou nao o passou),
 *    a fala com preparo inteira vira SUBSTITUTO_DA_FALA_SEM_A_MASCARA: nem o
 *    preparo nem o nome vao ao modelo.
 *  - Sem o corpo como saiu (o simulador, que nao mascara; quem montou a
 *    mensagem a mao): a troca e no `texto`, procurando tambem cada texto de
 *    preparo com a mascara do nome aplicada (casa sem depender dela).
 */
export function falaDaClinicaParaOModelo(
  mensagem: MensagemDaConversa,
  opcoes: OpcoesDoTextoParaOsModelos = {},
): string {
  const textos = opcoes.textosDePreparo ?? [];
  const autoria = mensagem.autoria ?? null;
  const mascarado = mensagem.texto ?? "";
  const original = mensagem.textoOriginalDaClinica;
  if (typeof original === "string") {
    const inteira = substitutoDaFalaInteira(original, autoria);
    if (inteira !== null) {
      return inteira;
    }
    const nfc = original.normalize("NFC");
    const doPreparo = trechosDoPreparo(nfc, textos);
    if (doPreparo.length === 0) {
      return mascarado;
    }
    if (opcoes.nomeDoContato === undefined) {
      return SUBSTITUTO_DA_FALA_SEM_A_MASCARA;
    }
    return trocarOPreparoEONome(
      nfc,
      doPreparo,
      trechosDoNome(nfc, opcoes.nomeDoContato),
    );
  }
  const nome = opcoes.nomeDoContato ?? null;
  return falaDaClinicaSemOPreparo(
    mascarado,
    nome === null
      ? textos
      : [...textos, ...textos.map((texto) => mascararNome(texto, nome))],
    autoria,
  );
}
// [AG7 preparo] fim

/** Mensagem pronta para o modelo: minimizada (LGPD), sem marcador, cortada. */
export function mensagemParaOModelo(
  mensagem: MensagemDaConversa,
  opcoes: OpcoesDoTextoParaOsModelos = {},
): string {
  // [AG6b mídia] início
  // AG6b (D-98): a figurinha do paciente, sem conteudo nenhum.
  if (mensagem.tipo === "figurinha" && mensagem.autor === "paciente") {
    return FRASE_DA_FIGURINHA;
  }
  // [AG6b mídia] fim
  if ((mensagem.tipo ?? "texto") !== "texto" || mensagem.texto === null) {
    return MARCADOR_DE_MIDIA[mensagem.autor];
  }
  // [AG7 preparo] início
  // AG7: a fala da clinica sem o preparo, ANTES da minimizacao e do corte (a
  // fala do paciente fica como esta). Revisao da AG7 (CFM-1): a troca e no
  // corpo como saiu, antes da mascara do nome.
  const daClinica =
    mensagem.autor === "assistente"
      ? { ...mensagem, texto: falaDaClinicaParaOModelo(mensagem, opcoes) }
      : mensagem;
  // [AG7 preparo] fim
  // [AG6b mídia] o corpo (era o retorno direto), para a marca e a descricao.
  const corpo = Array.from(
    // [AG7 preparo] daClinica (era mensagem)
    semMarcadores(minimizarParaLlm(textoParaOsModelos(daClinica, opcoes))),
  )
    .slice(0, CARACTERES_POR_MENSAGEM)
    .join("");
  // [AG6b mídia] início
  // AG6b: a transcricao vai marcada como audio; o pedido lido, com a
  // descricao do servidor antes da legenda. O corte e so no texto do
  // paciente (a marca e a descricao nunca sao cortadas).
  if (mensagem.autor === "paciente" && mensagem.origem === "audio") {
    return `${PREFIXO_DO_AUDIO} ${corpo}`;
  }
  if (
    mensagem.autor === "paciente" &&
    mensagem.origem === "arquivo" &&
    mensagem.arquivo !== undefined
  ) {
    return corpo.trim() === ""
      ? mensagem.arquivo.descricao
      : `${mensagem.arquivo.descricao} ${corpo}`;
  }
  // [AG6b mídia] fim
  return corpo;
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

// [AG6b mídia] início
/**
 * AG6b: a mensagem pendente como o portao de entrada a le (desenho 5.1, 1a
 * e 1c). O texto (e a transcricao ja aplicada) pelo original; a figurinha,
 * sem texto e sem escalar como midia; o audio a transcrever, um texto vazio
 * (conta na rajada e no numero de mensagens); o arquivo a ler (ou ja lido),
 * a legenda original. O resto (a midia fora, o audio sem fala, o video, a
 * localizacao) continua midia, e escala.
 */
export function entradaDoPortao(m: MensagemDaConversa): MensagemDeEntrada {
  const tipo = m.tipo ?? "texto";
  if (tipo === "texto") {
    return {
      tipo: "texto",
      texto: m.textoOriginal ?? m.texto,
      legenda: m.legendaOriginal ?? null,
    };
  }
  if (tipo === "figurinha") {
    return { tipo: "figurinha", texto: null };
  }
  const situacao = m.midia?.situacao;
  if (situacao === "a_transcrever") {
    return { tipo: "texto", texto: "" };
  }
  if (
    m.midia !== undefined &&
    m.midia.midia !== "audio" &&
    (situacao === "a_ler" || situacao === "lida")
  ) {
    return { tipo: "texto", texto: m.legendaOriginal ?? "" };
  }
  return {
    tipo,
    texto: m.textoOriginal ?? m.texto,
    // [AG6 urgência] A legenda da midia, so para a urgencia.
    legenda: m.legendaOriginal ?? null,
  };
}

// [AG7 preparo] início
/**
 * Revisao da AG7 (CFM-6 e CFM-7): os textos das mensagens da pessoa como
 * chegaram (o texto original, a transcricao, a legenda), para a conferencia
 * da situacao da pessoa e do procedimento pedido no envio do preparo. Local:
 * nunca vai a OpenAI nem para log.
 */
function textosOriginaisDoPaciente(
  pendentes: readonly MensagemDaConversa[],
): string[] {
  return pendentes.flatMap((m) => {
    const lida = entradaDoPortao(m);
    return [lida.texto, lida.legenda ?? null].filter(
      (texto): texto is string => typeof texto === "string" && texto !== "",
    );
  });
}

/**
 * A habilidade "Enviar orientacao de preparo" valendo nesta configuracao.
 * Configuracao que nao da para ler: sem a habilidade (o lado seguro).
 */
export function habilidadeDoPreparoValendo(config: ConfigDoAgente): boolean {
  try {
    return ferramentasDoAgente(
      config.habilidades,
      config.agenda,
      config.prazos,
    ).includes(NOME_DO_ENVIO_DO_PREPARO);
  } catch {
    return false;
  }
}

/** O passo da trilha do pedido do preparo com a situacao da pessoa. */
export const PASSO_DO_PEDIDO_COM_SITUACAO_PESSOAL =
  "O pedido da orientação de preparo veio junto de uma situação da pessoa: passa para a equipe, sem enviar.";
// [AG7 preparo] fim

/**
 * AG6b: o arquivo a ler (ou ja lido, ainda midia) visto pela legenda
 * mascarada, como texto: o classificador, o verificador e a carteirinha em
 * jogo leem a legenda (o arquivo so o leitor ve). O resto, como esta.
 */
export function vistaDaLegenda(m: MensagemDaConversa): MensagemDaConversa {
  const situacao = m.midia?.situacao;
  if (
    m.midia !== undefined &&
    m.midia.midia !== "audio" &&
    (m.tipo ?? "texto") !== "texto" &&
    m.tipo !== "figurinha" &&
    (situacao === "a_ler" || situacao === "lida")
  ) {
    return { ...m, tipo: "texto", texto: m.midia.legenda ?? "" };
  }
  return m;
}
// [AG6b mídia] fim

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
  // [AG7 preparo] início
  /**
   * AG7 (D-76): a frase F2, colada depois da mensagem e antes do
   * encerramento. Sai depois da saudacao e do encerramento quando a soma
   * passa do limite do filtro, e nunca vai no ultimo recurso.
   */
  depoisDaMensagem?: string | null;
  // [AG7 preparo] fim
}): string {
  const mensagem = entrada.mensagem.trim();
  // [AG7 preparo]
  const depois = entrada.depoisDaMensagem?.trim() || null;
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
    // [AG7 preparo] a F2 (depois) entre a mensagem e o encerramento; sai
    // por ultimo, antes do ultimo recurso.
    [saudacao, aviso, mensagem, depois, encerramento],
    [saudacao, aviso, mensagem, depois, null],
    [null, aviso, mensagem, depois, null],
    [null, aviso, mensagem, null, null],
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
  // [AG6b mídia] início
  /**
   * AG6b (desenho 5.3): a midia que o turno pode mandar aos modelos (o plano
   * do turno). Cada audio a transcrever conta SEGUNDOS_NA_RESERVA (120 s)
   * pelo preco por minuto do modelo; cada arquivo a ler, o pior caso do
   * leitor (o teto de tokens do arquivo, o envelope e a saida). Revisao da
   * AG6b (a juncao): com a nova tentativa propria das integracoes, o pior
   * caso honesto e MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO chamadas por audio e
   * MAXIMO_DE_CHAMADAS_DO_LEITOR por arquivo (cada uma pode ser cobrada); o
   * acerto continua cobrando o real. E a mensagem de cada um conta como
   * texto no agente, no classificador e no verificador
   * (mensagensParaEstimativa: a transcricao com 1.000 caracteres no pior
   * caso de bytes). Sem preco ou sem teto: null (quem chama falha fechado).
   */
  midia?: {
    aTranscrever: number;
    modeloDaTranscricao: string;
    aLer: readonly { tokensDoArquivo: number }[];
    modeloDoLeitor: string;
  } | null;
  // [AG6b mídia] fim
}): number | null {
  // AG3: com a carteirinha em jogo o texto vai com os codigos curtos
  // escondidos, que pode ficar uns caracteres mais longo ("1234" vira
  // "[numero]"): a conta usa o mais longo dos dois.
  const maisLongo = <T,>(a: T, b: T): T =>
    JSON.stringify(a).length >= JSON.stringify(b).length ? a : b;
  // [AG7 preparo] A conta nao vai a OpenAI: o nome nulo deixa a fala da
  // clinica com o tamanho da troca (sem o substituto da falha fechada).
  const escondido: OpcoesDoTextoParaOsModelos = {
    esconderCodigos: true,
    nomeDoContato: null,
  };
  // [AG6b mídia] início
  // As midias que vao aos modelos contam como texto (o pior caso).
  const itensDaLeitura = itensDoCatalogo(entrada.catalogo);
  const conveniosDoLeitor = conveniosDaLeitura(entrada.catalogo);
  const mensagensDaConta =
    entrada.midia === null || entrada.midia === undefined
      ? entrada.mensagens
      : mensagensParaEstimativa(
          entrada.mensagens,
          itensDaLeitura,
          conveniosDoLeitor,
        );
  // [AG6b mídia] fim
  const pendentes = mensagensPendentes(mensagensDaConta).map((m) =>
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
    // [AG6b mídia] mensagensDaConta (era entrada.mensagens).
    input: maisLongo(
      // [AG7 preparo] (era sem opcoes)
      historicoParaOModelo(mensagensDaConta, { nomeDoContato: null }),
      historicoParaOModelo(mensagensDaConta, escondido),
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
  // [AG6b mídia] início
  if (entrada.midia !== null && entrada.midia !== undefined) {
    for (let i = 0; i < entrada.midia.aTranscrever; i += 1) {
      const custo = custoMaximoDaTranscricao(
        SEGUNDOS_NA_RESERVA,
        entrada.midia.modeloDaTranscricao,
        entrada.precos,
      );
      if (custo === null) {
        return null;
      }
      // Revisao da AG6b: cada chamada da transcricao (a primeira e a nova
      // tentativa) pode ser cobrada.
      total += MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * custo;
    }
    for (const arquivo of entrada.midia.aLer) {
      const uso = usoEstimadoDoLeitor({
        catalogo: itensDaLeitura,
        convenios: conveniosDoLeitor,
        tokensDoArquivo: arquivo.tokensDoArquivo,
      });
      const custo =
        uso === null
          ? null
          : custoMaximoDaChamada(uso, entrada.midia.modeloDoLeitor, entrada.precos);
      if (custo === null) {
        return null;
      }
      // Revisao da AG6b: cada chamada do leitor (a primeira e a nova
      // tentativa) pode ser cobrada.
      total += MAXIMO_DE_CHAMADAS_DO_LEITOR * custo;
    }
  }
  // [AG6b mídia] fim
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
): {
  mascarado: string;
  original: string;
  // [AG6b mídia] AG6b (D-57): a origem, para o CPF e a carteirinha ditos
  // nunca serem lidos (so digitados). A descricao do arquivo nunca entra:
  // no pedido, o texto e so a legenda.
  origem?: "audio" | "arquivo";
}[] {
  return mensagens.flatMap((m) =>
    m.autor === "paciente" && (m.tipo ?? "texto") === "texto" && m.texto !== null
      ? [
          {
            mascarado: m.texto,
            original: m.textoOriginal ?? m.texto,
            // [AG6b mídia]
            ...(m.origem === undefined ? {} : { origem: m.origem }),
            // O audio transcrito traz o horario so na midia.
            ...((m.criadaEm ?? m.midia?.criadaEm) === undefined
              ? {}
              : { criadaEm: m.criadaEm ?? m.midia?.criadaEm }),
          },
        ]
      : [],
  );
}

// [AG6b mídia] início
/**
 * AG6b: os itens (nomes do Cadastro) de cada pedido lido que seguiu com a IA
 * nas mensagens do turno, para os fatos ("A pessoa mandou um pedido com:
 * Hemograma, Glicemia de jejum."). Nunca texto do arquivo.
 */
function pedidosDoTurno(
  mensagens: readonly MensagemDaConversa[],
  catalogo: CatalogoDoAgente,
): string[][] {
  const itens = itensDoCatalogo(catalogo);
  return mensagens.flatMap((m) => {
    const leitura = m.midia?.leitura;
    if (m.origem !== "arquivo" || leitura === undefined) {
      return [];
    }
    const decisao = decidirPelaLeitura(leitura, itens);
    return decisao.tipo === "segue" ? [decisao.itens.map((i) => i.nome)] : [];
  });
}
// [AG6b mídia] fim

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
    // [AG7 preparo] O envio do preparo nunca passa a conversa.
    case "enviou_preparo":
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

/**
 * Hoje (AAAA-MM-DD) no fuso da clinica, para a idade do portao. AG6b
 * (revisao): exportado para o portao da espera do download no executor
 * (lib/jobs/responder-com-ia.ts) usar a MESMA data que o laco usa.
 */
export function hojeNoFuso(agoraMs: number, fuso: string): string | null {
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
  // Revisao da AG4 (achado 1): a mensagem logo antes das pendentes, com a
  // autoria real (a pergunta do cancelamento e da remarcacao so vale quando
  // e ela, da IA).
  const antes =
    pendentes.length === 0
      ? undefined
      : entrada.mensagens[entrada.mensagens.length - pendentes.length - 1];
  // [AG6b mídia] início
  // AG6b: as mensagens do paciente da agenda sao VIVAS (os mesmos arrays,
  // trocados no lugar): a transcricao e o pedido lido entram nelas depois da
  // leitura, antes do agente (o "sim" falado, D-97; o nome e o nascimento
  // ditos, D-57). As ferramentas leem na hora da chamada.
  const mensagensDaAgenda = {
    doPaciente: mensagensDoPacienteParaOsDados(entrada.mensagens),
    pendentes: mensagensDoPacienteParaOsDados(pendentes),
  };
  const atualizarAgenda = (mensagens: readonly MensagemDaConversa[]) => {
    mensagensDaAgenda.doPaciente.splice(
      0,
      mensagensDaAgenda.doPaciente.length,
      ...mensagensDoPacienteParaOsDados(mensagens),
    );
    mensagensDaAgenda.pendentes.splice(
      0,
      mensagensDaAgenda.pendentes.length,
      ...mensagensDoPacienteParaOsDados(mensagensPendentes(mensagens)),
    );
  };
  // [AG6b mídia] fim
  const agendaDoTurno = criarAgendaDoTurno({
    porta: entrada.agenda ?? null,
    catalogo: entrada.catalogo,
    config: entrada.config,
    agoraMs: entrada.agoraMs,
    fuso: entrada.fuso,
    atendimento: entrada.atendimento ?? null,
    mensagens: {
      // [AG6b mídia] os arrays vivos
      doPaciente: mensagensDaAgenda.doPaciente,
      pendentes: mensagensDaAgenda.pendentes,
      antesDasPendentes:
        antes === undefined || antes.autor !== "assistente"
          ? null
          : {
              autoria: antes.autoria ?? null,
              texto: (antes.tipo ?? "texto") === "texto" ? antes.texto : null,
            },
    },
    nascimentos: [entrada.dataDeNascimento, entrada.nascimentoInformado].filter(
      (n): n is string => typeof n === "string" && n !== "",
    ),
    // Revisao final da AG3: o relogio do turno (a reserva que vence no meio
    // do turno conta como vencida). Sem relogio injetado, o instante do
    // comeco do turno mais o tempo que ja passou.
    agora: entrada.agora ?? relogioDesde(entrada.agoraMs),
  });
  const resultado = await turnoDoAgente(
    entrada,
    agendaDoTurno,
    // [AG6b mídia]
    atualizarAgenda,
  );
  if (!comEstado) {
    return resultado;
  }
  try {
    // Revisao curta das correcoes da AG4 (achado 1): o turno sem mensagem a
    // responder (inclusive a mensagem nova da pessoa no meio do turno) nao
    // sai e nao passa para a equipe (o executor fecha sem envio).
    const semEnvio =
      (resultado.desfecho.tipo === "falhou" &&
        resultado.desfecho.motivo === "sem_mensagem") ||
      // [AG6b mídia] O job antigo (D-A) so conclui: nada passa.
      resultado.jobAntigo === true;
    const passou = resultado.tipo === "frase_fixa" && !semEnvio;
    // [AG7 preparo] MOTOR-7: o preparo escolhido pode nao sair (fora de
    // vigor ou com recusa na hora do envio); o executor passa a conversa com
    // a nota de sempre.
    const preparoEscolhido = resultado.tipo === "preparo";
    // AG5: a lista de espera desta conversa mora fora do estado; na passagem
    // antes do preparo (o portao), le so para a nota (nunca lanca).
    if (passou || preparoEscolhido) {
      await agendaDoTurno.lerParaANota();
    }
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
      // [AG7 preparo] MOTOR-7
      ...(preparoEscolhido
        ? {
            notasSeOPreparoNaoSair: {
              assunto_clinico: agendaDoTurno.nota(
                ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.assunto_clinico,
              ),
              conformidade: agendaDoTurno.nota(
                ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.conformidade,
              ),
            },
          }
        : {}),
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
  // [AG6b mídia] AG6b: a agenda recebe as mensagens com a midia lida.
  atualizarAgenda: (mensagens: readonly MensagemDaConversa[]) => void = () =>
    undefined,
): Promise<ResultadoDoTurno> {
  const comEstado =
    entrada.atendimento !== null && entrada.atendimento !== undefined;
  const agora = entrada.agora ?? Date.now;
  const inicio = agora();
  const prazoPelaDuracao = inicio + (entrada.prazoMs ?? PRAZO_DO_TURNO_MS);
  // RR2 de 88e9560 (baixo 6): o instante de quem chama, na mesma referencia
  // (as idas ao banco antes do laco ficam dentro da conta do turno).
  const prazoEm =
    typeof entrada.prazoEmMs === "number" && Number.isFinite(entrada.prazoEmMs)
      ? Math.min(prazoPelaDuracao, entrada.prazoEmMs)
      : prazoPelaDuracao;
  const trilha: PassoDoTurno[] = [];
  const uso: UsoDoModelo[] = [];
  const ferramentasUsadas: FerramentaDoAgente[] = [];
  let filtro: DecisaoDoFiltro | null = null;
  let descartados: TextoDescartado = { instrucoes: false, itensDaBase: 0 };
  const modeloDosClassificadores =
    entrada.modeloDosClassificadores?.trim() || "desconhecido";
  // [AG7 preparo] início
  // AG7: a habilidade "Enviar orientacao de preparo" valendo nesta
  // configuracao: o classificador roda a variante com preparo e a versao
  // gravada e a dela. Configuracao que nao da para ler: sem a habilidade (o
  // lado seguro: o pedido de preparo passa para a equipe).
  const comPreparo = habilidadeDoPreparoValendo(entrada.config);
  const versaoDoClassificador = versaoDaPoliticaDoClassificador({
    comPreparo,
  });
  // [AG7 preparo] fim
  // [AG6b mídia] início
  // A copia das mensagens do turno: as pendentes com midia mudam aqui (a
  // transcricao, o pedido lido, a figurinha), nunca em entrada.mensagens.
  const mensagensDoTurno: MensagemDaConversa[] = [...entrada.mensagens];
  const inicioDasPendentes =
    mensagensDoTurno.length - mensagensPendentes(entrada.mensagens).length;
  const pendentesDoTurno = () => mensagensDoTurno.slice(inicioDasPendentes);
  /** O que o verificador e a passagem sabem dos arquivos da conversa. */
  const fatosDosArquivos = (): FatoDoArquivo[] =>
    mensagensDoTurno.flatMap((m) =>
      m.arquivo?.fato === undefined ? [] : [m.arquivo.fato],
    );
  const trocarPendente = (messageId: string, nova: MensagemDaConversa) => {
    const i = mensagensDoTurno.findIndex(
      (m, j) => j >= inicioDasPendentes && m.midia?.messageId === messageId,
    );
    if (i >= 0) {
      mensagensDoTurno[i] = nova;
    }
  };
  // [AG6b mídia] fim

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
    // [AG6b mídia] D-96: a passagem com midia do paciente que ninguem leu.
    ...(pendentesDoTurno().some(mensagemComMidiaNaoLida)
      ? { midiaNaoLida: true as const }
      : {}),
    // [AG7 preparo]
    versaoDoClassificador,
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

  // [AG6b mídia] início
  // A midia que fica fora (sem porta, o arquivo fora da regra, ou o preparo
  // de um audio do turno que deu fora): continua midia, e o portao escala.
  const marcarComoFora = (mensagens: readonly MensagemDaConversa[]) => {
    for (const m of mensagens) {
      if (m.midia !== undefined) {
        trocarPendente(m.midia.messageId, {
          ...m,
          midia: { ...m.midia, situacao: "fora" },
        });
      }
    }
  };
  /**
   * O prazo que a midia pode usar AGORA (revisao da AG6b): o resto do turno
   * menos a reserva do filtro (o verificador), a janela minima do agente e,
   * quando o classificador ainda vem depois (a transcricao, 2b), o prazo
   * dele. A midia nunca come o que vem depois dela, e o turno nunca passa
   * de prazoEm (a reserva das gravacoes e a do envio ficam inteiras).
   */
  const prazoParaAMidia = (classificadorDepois: boolean) =>
    prazoEm -
    agora() -
    RESERVA_DO_FILTRO_MS -
    RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS -
    (classificadorDepois ? PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS : 0);
  /**
   * O corte duro de um passo da midia (revisao da AG6b): a porta recebe o
   * prazo menos a folga e o sinal deste corte (ela corta ali, com o uso da
   * chamada); o laco corta no prazo inteiro, para a porta que nao cumprir.
   */
  const cortarAMidia = <T,>(
    executar: (prazoDaPortaMs: number, sinal: AbortSignal) => Promise<T>,
    prazoMs: number,
  ) =>
    correrComPrazo(
      (sinal) =>
        executar(Math.max(0, prazoMs - FOLGA_DO_CORTE_DA_MIDIA_MS), sinal),
      prazoMs,
    );
  /** O motivo do preparo que falhou: o prazo, ou o resto (falha fechada). */
  const motivoDoPreparo = (prontas: readonly MidiaPronta[]): FalhaDoAgente =>
    prontas.some((p) => p.tipo === "falhou" && p.codigo === "prazo")
      ? "timeout"
      : "desconhecida";
  /** O preparo que nem voltou (a porta que nao cumpriu o prazo). */
  const preparoCortado = (
    corrida: { tipo: "prazo" } | { tipo: "erro" },
    passo: string,
  ): ResultadoDoTurno => {
    log.warn("ia_midia_cortada", {
      kind: "preparo",
      clinic_id: entrada.clinicId,
      error_code: corrida.tipo === "prazo" ? "prazo" : "excecao",
    });
    trilha.push({ tipo: "equipe", texto: passo });
    return fraseFixa({
      tipo: "falhou",
      motivo: corrida.tipo === "prazo" ? "timeout" : "desconhecida",
    });
  };
  /**
   * A transcricao que a porta nao devolveu no prazo (ou que lancou): falha,
   * com o pior caso pelos segundos medidos (nao se sabe quantas chamadas
   * sairam: MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO, a mesma conta da reserva).
   */
  const transcricaoCortada = (
    audio: Extract<MidiaPronta, { tipo: "audio" }>,
    corrida: { tipo: "prazo" } | { tipo: "erro" },
  ): ResultadoDaTranscricao => ({
    tipo: "falhou",
    motivo: corrida.tipo === "prazo" ? "timeout" : "desconhecida",
    uso: {
      papel: "transcricao",
      modelo: "desconhecido",
      uso: { ...USO_ZERADO },
      segundosDeAudio:
        MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA *
        Math.max(1, Math.ceil(audio.segundos)),
    },
  });
  /**
   * A leitura que a porta nao devolveu no prazo (ou que lancou): falha, com
   * o pior caso do arquivo em cada chamada que pode ter saido
   * (MAXIMO_DE_CHAMADAS_DO_LEITOR, a mesma conta da reserva; a figurinha nao
   * chama modelo). Revisao R3 de d1a15f6 (2): pelos tetos INJETADOS
   * (entrada.tetosDoLeitor, os do plano, da reserva e da porta), nunca pelas
   * constantes do modulo quando o executor deu outros.
   */
  const leituraCortada = (
    arquivo: Extract<MidiaPronta, { tipo: "arquivo" | "figurinha" }>,
    corrida: { tipo: "prazo" } | { tipo: "erro" },
    catalogoDaLeitura: ReturnType<typeof itensDoCatalogo>,
  ): ResultadoDaLeitura => {
    const estimado =
      arquivo.tipo === "arquivo"
        ? usoEstimadoDoLeitor({
            catalogo: catalogoDaLeitura,
            convenios: conveniosDaLeitura(entrada.catalogo),
            tokensDoArquivo: tokensDoArquivoNaReserva(
              arquivo.midia,
              arquivo.arquivo.tipo === "pdf" ? "application/pdf" : "image/jpeg",
              entrada.tetosDoLeitor,
            ),
          })
        : null;
    return {
      tipo: "falhou",
      motivo: corrida.tipo === "prazo" ? "timeout" : "desconhecida",
      uso:
        estimado === null
          ? null
          : {
              papel: "leitor_de_midia",
              modelo: modeloDosClassificadores,
              uso: {
                tokensEntrada: MAXIMO_DE_CHAMADAS_DO_LEITOR * estimado.tokensEntrada,
                tokensSaida: MAXIMO_DE_CHAMADAS_DO_LEITOR * estimado.tokensSaida,
                tokensCacheLidos:
                  MAXIMO_DE_CHAMADAS_DO_LEITOR * estimado.tokensCacheLidos,
                tokensCacheGravados:
                  MAXIMO_DE_CHAMADAS_DO_LEITOR * estimado.tokensCacheGravados,
              },
            },
    };
  };
  /**
   * D-A (revisao da AG6b): a gravacao da leitura disse job_antigo. O job
   * so conclui (o executor ve a marca): a frase fixa daqui nunca sai.
   */
  const jobAntigo = (): ResultadoDoTurno => ({
    ...fraseFixa({ tipo: "falhou", motivo: "liberacao_suspensa" }),
    jobAntigo: true,
  });
  /**
   * Revisao R2 de d1a15f6 (M3): a transcricao leu urgencia no texto inteiro
   * de um audio do turno, inclusive no que as travas descartaram ("Quero
   * morrer." curto e incerto, "Socorro..." no ruido). So o tipo chegou (o
   * texto descartado nunca sai da integracao); o 1c passa a conversa como
   * urgente, pelo caminho de sempre. RR2 de 88e9560 (medio 2): tambem a
   * urgencia que veio na FALHA depois da transcricao (a gravacao da leitura
   * recusada, o corte durante a RPC).
   */
  let urgenciaNoAudio = false;
  /**
   * A urgencia que a porta devolveu com o audio (so o tipo), ou null: a do
   * texto inteiro do audio, inclusive o descartado, e a da falha depois da
   * transcricao. A do texto mantido e a da rajada o 1c le; nos caminhos que
   * nao chegam ao 1c, urgenciaNaRajada.
   */
  const urgenciaDoAudio = (
    feita: ResultadoDaTranscricao,
  ): TipoDeUrgencia | null => {
    switch (feita.tipo) {
      case "transcrita":
      case "sem_fala":
        return feita.urgencia;
      case "falhou":
        return feita.urgencia ?? null;
      default:
        return null;
    }
  };
  /**
   * RR2 de 88e9560 (rev4): a urgencia da RAJADA como o 1c a le, sem aplicar
   * nada ao turno: as pendentes como o portao as ve (entradaDoPortao: os
   * textos, as legendas, o audio ainda sem texto) com as transcricoes que
   * voltaram no lugar dos audios, cada mensagem sozinha e a juncao delas na
   * ordem (detectarGatilhosDeEntrada, a mesma lista). O caminho do audio
   * ruim (baixo 7) e o da falha de outro audio nunca chegam ao 1c, e o audio
   * lido sozinho perdia a juncao: "minha mae" escrito e "nao responde mais,
   * ta caida no chao" falado so sao urgencia juntos.
   */
  const urgenciaNaRajada = (
    transcritas: ReadonlyMap<string, string>,
  ): boolean => {
    const entradas = pendentesDoTurno().map((m): MensagemDeEntrada => {
      const transcrito =
        m.midia === undefined ? undefined : transcritas.get(m.midia.messageId);
      return transcrito === undefined
        ? entradaDoPortao(m)
        : { tipo: "texto", texto: transcrito };
    });
    return detectarGatilhosDeEntrada({
      mensagens: entradas,
      dataDeNascimento: entrada.dataDeNascimento ?? null,
      hojeNaClinica:
        entrada.hojeNaClinica ?? hojeNoFuso(entrada.agoraMs, entrada.fuso),
    }).includes("urgencia");
  };
  /**
   * A urgencia do portao (1a e 1c) e a do audio acima: a conferencia de
   * sempre, o passo da urgencia e a passagem com o motivo urgencia (o banco
   * marca como Urgente e nunca atribui).
   */
  const passarPorUrgencia = (): ResultadoDoTurno => {
    trilha.push({ tipo: "outro", texto: PASSO_DA_CONFERENCIA_DA_ENTRADA });
    trilha.push({ tipo: "equipe", texto: PASSO_DA_URGENCIA });
    return fraseFixa({
      tipo: "escalou",
      motivo: "urgencia",
      gatilho: "urgencia",
      origem: "portao",
    });
  };

  /**
   * 2b. Transcreve os audios a transcrever. Devolve o desfecho quando o
   * turno para aqui (falha fechada, a conversa saiu da IA, o prazo), ou null
   * para seguir (o 1c confere o texto transcrito, o sem fala, o fora e a
   * urgencia que a transcricao leu no audio).
   */
  const transcreverAsPendentes = async (
    lista: readonly MensagemDaConversa[],
  ): Promise<ResultadoDoTurno | null> => {
    const porta = entrada.midia ?? null;
    if (porta === null) {
      marcarComoFora(lista);
      return null;
    }
    // O classificador ainda vem depois da transcricao: o prazo dele fica.
    const prazoDoPreparo = prazoParaAMidia(true);
    if (prazoDoPreparo < 1_000) {
      return falhar("prazo");
    }
    const preparo = await cortarAMidia(
      (prazo, sinal) =>
        porta.preparar(
          lista.flatMap((m) => (m.midia === undefined ? [] : [m.midia])),
          prazo,
          sinal,
        ),
      prazoDoPreparo,
    );
    if (preparo.tipo !== "resultado") {
      return preparoCortado(preparo, PASSOS_DA_MIDIA.transcricaoFalhou);
    }
    const prontas = preparo.valor;
    const audios = prontas.filter(
      (p): p is Extract<MidiaPronta, { tipo: "audio" }> => p.tipo === "audio",
    );
    const algumPreparoFalhou = prontas.some((p) => p.tipo === "falhou");
    const todosProntos =
      !algumPreparoFalhou &&
      audios.length === prontas.length &&
      audios.length === lista.length;
    /**
     * O turno com um audio ruim, como sempre foi: o preparo que falhou (o
     * Storage) e a falha tecnica; o audio fora da regra (o limite, o
     * formato, os primeiros bytes) marca todos como fora, e o 1c escala como
     * midia. Nenhuma transcricao vale como texto neste turno.
     */
    const comUmAudioRuim = (): ResultadoDoTurno | null => {
      if (algumPreparoFalhou) {
        trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.transcricaoFalhou });
        return fraseFixa({ tipo: "falhou", motivo: motivoDoPreparo(prontas) });
      }
      marcarComoFora(lista);
      return null;
    };
    // RR2 de 88e9560 (baixo 7): um audio ruim no turno nao impede mais a
    // transcricao dos bons. Os bons sao transcritos SO para ler a urgencia
    // (no mesmo prazo e com o mesmo corte; a reserva do gasto ja conta todo
    // audio a transcrever do plano), e o turno passa para a equipe como
    // sempre (comUmAudioRuim), ou como urgente. Sem audio bom, ou sem prazo
    // para eles, fica como sempre.
    if (!todosProntos && audios.length === 0) {
      return comUmAudioRuim();
    }
    const prazo = prazoParaAMidia(true);
    if (prazo < 1_000) {
      return todosProntos ? falhar("prazo") : comUmAudioRuim();
    }
    const feitas = await Promise.all(
      audios.map(async (audio) => {
        const corrida = await cortarAMidia(
          (prazoDaPorta, sinal) => porta.transcrever(audio, prazoDaPorta, sinal),
          prazo,
        );
        return {
          audio,
          feita:
            corrida.tipo === "resultado"
              ? corrida.valor
              : transcricaoCortada(audio, corrida),
        };
      }),
    );
    for (const { feita } of feitas) {
      if (feita.uso !== null) {
        uso.push(feita.uso);
      }
    }
    // Antes da urgencia, de proposito (rev4, documentado no contrato): o
    // job_antigo (D-A) so conclui, sem passagem; e com a conversa ja fora da
    // IA a passagem do banco devolve ja_fora_da_ia SEM a marca (a marca so
    // nasce quando a passagem tira a conversa da IA). Passar pela urgencia
    // aqui nao marcaria nada e gravaria uma decisao de passagem que nao
    // houve. Marcar a conversa que ja esta com a equipe pede o banco.
    if (feitas.some(({ feita }) => feita.tipo === "job_antigo")) {
      return jobAntigo();
    }
    if (feitas.some(({ feita }) => feita.tipo === "fora_da_ia")) {
      return falhar("liberacao_suspensa");
    }
    // Revisao R2 de d1a15f6 (M3): a urgencia que a transcricao leu no audio
    // inteiro (so o tipo), no sem fala e na transcricao. RR2 de 88e9560
    // (medio 2): tambem a que veio na falha depois da transcricao.
    if (feitas.some(({ feita }) => urgenciaDoAudio(feita) !== null)) {
      urgenciaNoAudio = true;
    }
    /** As transcricoes que voltaram (o texto mantido, como foi falado). */
    const transcritas = new Map(
      feitas.flatMap(({ audio, feita }) =>
        feita.tipo === "transcrita"
          ? [[audio.messageId, feita.texto] as const]
          : [],
      ),
    );
    if (!todosProntos) {
      // RR2 de 88e9560 (baixo 7): a urgencia de um audio bom vence o audio
      // ruim (a falha do preparo ou o fora da regra), como vence a falha
      // tecnica de outro audio. Rev4: lida na rajada inteira, como no 1c.
      return urgenciaNoAudio || urgenciaNaRajada(transcritas)
        ? passarPorUrgencia()
        : comUmAudioRuim();
    }
    const falha = feitas.find(({ feita }) => feita.tipo === "falhou")?.feita;
    if (falha !== undefined && falha.tipo === "falhou") {
      // A urgencia de outro audio do turno vence a falha tecnica deste: a
      // conversa passa como urgente (o lado seguro; as duas passam). RR2 de
      // 88e9560 (medio 2): tambem a urgencia do proprio audio que falhou
      // depois de transcrito (a gravacao da leitura recusada, o corte
      // durante a RPC). Rev4: e a da rajada com as transcricoes que
      // voltaram, como no 1c (que este caminho nunca alcanca).
      if (urgenciaNoAudio || urgenciaNaRajada(transcritas)) {
        return passarPorUrgencia();
      }
      trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.transcricaoFalhou });
      return fraseFixa({ tipo: "falhou", motivo: falha.motivo });
    }
    for (const { audio, feita } of feitas) {
      const original = lista.find((m) => m.midia?.messageId === audio.messageId);
      if (original?.midia === undefined) {
        continue;
      }
      if (feita.tipo === "transcrita") {
        trilha.push({ tipo: "outro", texto: PASSOS_DA_MIDIA.transcreveu });
        trocarPendente(audio.messageId, {
          ...original,
          tipo: "texto",
          origem: "audio",
          texto: feita.textoParaOsModelos,
          textoOriginal: feita.texto,
          midia: { ...original.midia, situacao: "lida", leitura: feita.leitura },
        });
      } else if (feita.tipo === "sem_fala") {
        trocarPendente(audio.messageId, {
          ...original,
          midia: { ...original.midia, situacao: "lida", leitura: feita.leitura },
        });
      }
    }
    return null;
  };

  /**
   * 3b. Le os arquivos a ler (a figurinha, local) e decide pela leitura de
   * cada arquivo pendente (a tabela 1.2, com a prioridade: o clinico, o
   * documento do paciente, o nao identificado). Devolve o desfecho quando o
   * turno passa ou para aqui, ou null para seguir com o agente (o pedido
   * vira a descricao, a figurinha vira figurinha).
   */
  const lerOsArquivosPendentes = async (): Promise<ResultadoDoTurno | null> => {
    const catalogoDaLeitura = itensDoCatalogo(entrada.catalogo);
    const contextoDaLeitura = {
      convenios: conveniosDaLeitura(entrada.catalogo),
      ilegivelNaJanela: entrada.ilegivelNaJanela === true,
    };
    const aLer = pendentesDoTurno().filter(
      (m) => m.midia?.situacao === "a_ler",
    );
    if (aLer.length > 0) {
      const porta = entrada.midia ?? null;
      const passarComoMidia = () => {
        trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.arquivoFora });
        return fraseFixa({
          tipo: "escalou",
          motivo: MOTIVO_DO_GATILHO.midia,
          gatilho: "midia",
          origem: "portao",
        });
      };
      if (porta === null) {
        marcarComoFora(aLer);
        return passarComoMidia();
      }
      // O classificador ja leu a legenda: so o agente e o filtro depois.
      const prazoDoPreparo = prazoParaAMidia(false);
      if (prazoDoPreparo < 1_000) {
        return falhar("prazo");
      }
      const preparo = await cortarAMidia(
        (prazo, sinal) =>
          porta.preparar(
            aLer.flatMap((m) => (m.midia === undefined ? [] : [m.midia])),
            prazo,
            sinal,
          ),
        prazoDoPreparo,
      );
      if (preparo.tipo !== "resultado") {
        return preparoCortado(preparo, PASSOS_DA_MIDIA.leituraFalhou);
      }
      const prontas = preparo.valor;
      if (prontas.some((p) => p.tipo === "falhou")) {
        trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.leituraFalhou });
        return fraseFixa({ tipo: "falhou", motivo: motivoDoPreparo(prontas) });
      }
      const legiveis = prontas.filter(
        (p): p is Extract<MidiaPronta, { tipo: "arquivo" | "figurinha" }> =>
          p.tipo === "arquivo" || p.tipo === "figurinha",
      );
      if (legiveis.length !== prontas.length || legiveis.length !== aLer.length) {
        marcarComoFora(aLer);
        return passarComoMidia();
      }
      const prazo = prazoParaAMidia(false);
      if (prazo < 1_000) {
        return falhar("prazo");
      }
      const feitas = await Promise.all(
        legiveis.map(async (arquivo) => {
          const corrida = await cortarAMidia(
            (prazoDaPorta, sinal) =>
              porta.ler(
                arquivo,
                catalogoDaLeitura,
                prazoDaPorta,
                sinal,
                contextoDaLeitura,
              ),
            prazo,
          );
          return {
            arquivo,
            feita:
              corrida.tipo === "resultado"
                ? corrida.valor
                : leituraCortada(arquivo, corrida, catalogoDaLeitura),
          };
        }),
      );
      for (const { feita } of feitas) {
        if (feita.uso !== null) {
          uso.push(feita.uso);
        }
      }
      if (feitas.some(({ feita }) => feita.tipo === "job_antigo")) {
        return jobAntigo();
      }
      if (feitas.some(({ feita }) => feita.tipo === "fora_da_ia")) {
        return falhar("liberacao_suspensa");
      }
      const falha = feitas.find(({ feita }) => feita.tipo === "falhou")?.feita;
      if (falha !== undefined && falha.tipo === "falhou") {
        trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.leituraFalhou });
        return fraseFixa({ tipo: "falhou", motivo: falha.motivo });
      }
      for (const { arquivo, feita } of feitas) {
        const original = aLer.find(
          (m) => m.midia?.messageId === arquivo.messageId,
        );
        if (original?.midia !== undefined && feita.tipo === "lido") {
          trocarPendente(arquivo.messageId, {
            ...original,
            midia: {
              ...original.midia,
              situacao: "lida",
              leitura: feita.leitura,
            },
          });
          if (feita.carteirinhaNoCadastro !== undefined) {
            agendaDoTurno.carteirinhaNoCadastro(feita.carteirinhaNoCadastro);
          }
        }
      }
    }
    // A decisao do servidor por arquivo lido (os de agora e os que o job
    // repetido ja tinha gravado), com a prioridade.
    const lidas = pendentesDoTurno().filter(
      (m): m is MensagemDaConversa & {
        midia: MidiaDaConversa & { leitura: LeituraGravada };
      } =>
        m.midia !== undefined &&
        m.midia.midia !== "audio" &&
        m.midia.situacao === "lida" &&
        m.midia.leitura !== undefined &&
        (m.tipo ?? "texto") !== "texto" &&
        m.tipo !== "figurinha",
    );
    const decisoes = lidas.map((m) => ({
      mensagem: m,
      decisao: decidirPelaLeitura(
        m.midia.leitura,
        catalogoDaLeitura,
        contextoDaLeitura,
      ),
    }));
    const motivo = motivoMaisForte(
      decisoes.flatMap(({ decisao }): MotivoDaLeitura[] =>
        decisao.tipo === "escala" ? [decisao.motivo] : [],
      ),
    );
    if (motivo !== null) {
      trilha.push({ tipo: "equipe", texto: PASSO_DO_MOTIVO_DA_LEITURA[motivo] });
      return fraseFixa({
        tipo: "escalou",
        motivo,
        gatilho: null,
        origem: "leitor",
      });
    }
    for (const { mensagem, decisao } of decisoes) {
      if (decisao.tipo === "segue") {
        trilha.push({
          tipo: "outro",
          texto:
            decisao.foraDoCadastro > 0
              ? PASSOS_DA_MIDIA.leuPedidoParcial
                  .replace("{itens}", () => String(decisao.itens.length))
                  .replace("{fora}", () => String(decisao.foraDoCadastro))
              : PASSOS_DA_MIDIA.leuPedido.replace("{}", () =>
                  String(decisao.itens.length),
                ),
        });
        trocarPendente(
          mensagem.midia.messageId,
          mensagemDoArquivoLido(mensagem, decisao),
        );
      } else if (decisao.tipo === "responde") {
        trilha.push({ tipo: "outro", texto: decisao.passo });
        trocarPendente(
          mensagem.midia.messageId,
          mensagemDoArquivoLido(mensagem, decisao),
        );
      } else if (decisao.tipo === "figurinha") {
        trilha.push({ tipo: "outro", texto: PASSOS_DA_MIDIA.figurinha });
        trocarPendente(mensagem.midia.messageId, {
          ...mensagem,
          tipo: "figurinha",
          texto: null,
        });
      }
    }
    return null;
  };
  // [AG6b mídia] fim

  try {
    const pendentes = mensagensPendentes(entrada.mensagens);
    if (pendentes.length === 0) {
      return falhar("sem_mensagem");
    }

    // 1. Portao deterministico, no texto ORIGINAL do contato (local, sem
    // rede): a mascara do nome so existe para a OpenAI e nao pode esconder
    // um gatilho. Os passos 3, 4 e 6 continuam so com o texto mascarado.
    // [AG6b mídia] início
    // AG6b (desenho 5.1): o portao roda nas pendentes do TURNO, com a midia
    // pela situacao dela (entradaDoPortao): no 1a, o audio a transcrever e
    // um texto vazio (conta na rajada e no numero de mensagens, nunca como
    // midia) e o arquivo a ler (ou ja lido) e a legenda; a midia fora, o
    // audio sem fala e o video continuam midia. Gatilho: nada sai. No 1c
    // (depois da transcricao), roda de novo com o texto transcrito.
    const passarPeloPortao = (): ResultadoDoTurno | null => {
      const entradas = pendentesDoTurno().map(entradaDoPortao);
      const gatilhos = detectarGatilhosDeEntrada({
        mensagens: entradas,
        comPreparo,
        dataDeNascimento: entrada.dataDeNascimento ?? null,
        hojeNaClinica:
          entrada.hojeNaClinica ?? hojeNoFuso(entrada.agoraMs, entrada.fuso),
      });
      const gatilho = gatilhos[0];
      // [AG6 urgência] início
      // AG6a: o sinal de emergencia vem primeiro na ordem dos gatilhos. A
      // conversa passa com o motivo urgencia (o banco marca como Urgente e
      // nunca atribui) e a frase de sempre. No WhatsApp o executor ja passou
      // antes do teto e da reserva; aqui e a segunda trava, o simulador e
      // (AG6b) a urgencia falada no audio. Revisao R2 de d1a15f6 (M3): e a
      // urgencia que a transcricao leu no texto descartado do audio (o
      // portao nunca ve esse texto), pelo mesmo caminho.
      if (gatilho === "urgencia" || urgenciaNoAudio) {
        return passarPorUrgencia();
      }
      // [AG6 urgência] fim
      if (gatilho !== undefined) {
        trilha.push({
          tipo: "outro",
          texto: PASSO_DA_CONFERENCIA_DA_ENTRADA,
        });
        // O audio em que nao deu para entender fala (as travas da saida da
        // transcricao): o passo proprio, o motivo de sempre da midia.
        if (
          gatilho === "midia" &&
          pendentesDoTurno().some(
            (m) =>
              m.midia?.midia === "audio" &&
              m.midia.leitura?.tipo === "sem_fala",
          )
        ) {
          trilha.push({ tipo: "equipe", texto: PASSOS_DA_MIDIA.semFala });
          return fraseFixa({
            tipo: "escalou",
            motivo: MOTIVO_DO_GATILHO.midia,
            gatilho,
            origem: "portao",
          });
        }
        return escalar(
          MOTIVO_DO_GATILHO[gatilho],
          "portao",
          gatilho,
          textoDoGatilho(gatilho),
        );
      }
      // Revisao final da AG3 (achado 15, D-8): o pedido de consulta para
      // outra pessoa adulta ("para minha mae", "pro meu marido") passa para
      // a equipe antes do modelo, com o motivo do banco e sem gatilho (o
      // CHECK de gatilho_entrada nao muda). Filho e filha seguem pela regra
      // do menor. AG6b: nos textos, nas transcricoes e nas legendas.
      if (
        pedidoDeConsultaParaOutraPessoa(
          entradas
            .filter((e) => e.tipo === "texto")
            .map((e) => e.texto),
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
      return null;
    };
    const doPortao = passarPeloPortao();
    if (doPortao !== null) {
      return doPortao;
    }
    // [AG6b mídia] fim

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

    // [AG6b mídia] início
    // 2b. A transcricao dos audios a transcrever (a porta le o arquivo,
    // prepara, chama a transcricao e grava a leitura) e, 1c, o portao de
    // novo com o texto transcrito: a urgencia falada primeiro (a passagem
    // com o motivo urgencia marca no banco), depois os outros; o audio sem
    // fala ou fora da regra escala como midia.
    const aTranscrever = pendentesDoTurno().filter(
      (m) => m.midia?.situacao === "a_transcrever",
    );
    if (aTranscrever.length > 0) {
      const transcricao = await transcreverAsPendentes(aTranscrever);
      if (transcricao !== null) {
        return transcricao;
      }
      const doPortaoDeNovo = passarPeloPortao();
      if (doPortaoDeNovo !== null) {
        return doPortaoDeNovo;
      }
    }
    // [AG6b mídia] fim

    // 3. Classificador de entrada. AG3 (LGPD): com a carteirinha em jogo,
    // o codigo curto que a minimizacao deixa passar nao vai ao
    // classificador, ao agente nem ao verificador (o servidor acha a
    // carteirinha no texto original: registrar_dados_do_paciente).
    // [AG6b mídia] O turno com a transcricao e com a legenda do arquivo a
    // ler (vistaDaLegenda): a carteirinha falada ou escrita na legenda
    // tambem conta.
    const opcoesDoTexto: OpcoesDoTextoParaOsModelos = {
      esconderCodigos: esconderCodigosNoTurno({
        mensagens: mensagensDoTurno.map(vistaDaLegenda),
        atendimento: entrada.atendimento ?? null,
      }),
      // [AG7 preparo] O historico que vai ao modelo sem os textos de preparo.
      textosDePreparo: entrada.catalogo.textosDePreparo ?? [],
      // [AG7 preparo] A mascara refeita depois da troca (CFM-1). Ausente
      // quando quem chamou nao o passou (falha fechada na fala com preparo).
      ...(entrada.nomeDoContato === undefined
        ? {}
        : { nomeDoContato: entrada.nomeDoContato }),
    };
    // [AG6b mídia] As transcricoes e as legendas (mascaradas) vao ao
    // classificador e ao verificador; a midia sem leitura, como texto vazio.
    const textosPendentes = pendentesDoTurno().map((m) =>
      textoParaOsModelos(vistaDaLegenda(m), opcoesDoTexto),
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
      // [AG7 preparo] A variante da politica com a habilidade.
      { comPreparo },
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

    // [AG6b mídia] início
    // 3b. O leitor de midia: so DEPOIS do portao e do classificador lerem a
    // legenda (o arquivo nao sai quando a legenda ja passou a conversa).
    const doLeitor = await lerOsArquivosPendentes();
    if (doLeitor !== null) {
      return doLeitor;
    }
    // A agenda le a transcricao e a legenda do pedido (o "sim" falado, D-97;
    // o nome e o nascimento ditos, D-57; nunca a descricao do arquivo).
    atualizarAgenda(mensagensDoTurno);
    // [AG6b mídia] fim

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
      // [AG6b mídia] as mensagens do turno (a midia lida aplicada)
      mensagensDoTurno,
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
    // [AG7 preparo] início
    // AG7: a orientacao de preparo escolhida (enviar_preparo sozinha, com
    // versao em vigor), que encerrou o turno sem texto do modelo.
    let preparoEscolhido: {
      procedimentoId: string;
      versaoId: string;
      versao: number;
      introducao: string | null;
    } | null = null;
    /**
     * Revisao da AG7 (CFM-7): o procedimento escolhido pelo modelo e o que a
     * pessoa pediu? Na ordem: o que as pendentes citam (decide quando citam
     * algum); senao, o que as mensagens da pessoa na conversa citam; senao,
     * o procedimento da marcacao da conversa (o estado); senao, o unico com
     * orientacao em vigor entre as consultas futuras dela. Nunca lanca: a
     * leitura que falha nao confirma (o modelo pergunta).
     */
    const procedimentoConfirmado = async (
      procedimentoId: string,
    ): Promise<boolean> => {
      for (const textos of [
        textosOriginaisDoPaciente(pendentesDoTurno()),
        textosOriginaisDoPaciente(
          mensagensDoTurno.filter((m) => m.autor === "paciente"),
        ),
      ]) {
        const citado = citacaoDoProcedimento(
          entrada.catalogo,
          procedimentoId,
          textos,
        );
        if (citado !== "nenhum") {
          return citado === "confirmado";
        }
      }
      if (entrada.atendimento?.estado.procedure_id === procedimentoId) {
        return true;
      }
      const lerConsultas = entrada.agenda?.lerConsultasDoContato;
      if (lerConsultas === undefined) {
        return false;
      }
      try {
        const { consultas } = await lerConsultas();
        const vinculos = [
          ...entrada.catalogo.vinculos,
          ...(entrada.catalogo.vinculosDaEquipe ?? []),
        ];
        const comPreparo = new Set(
          consultas.flatMap((consulta) => {
            const vinculo = vinculos.find(
              (v) => v.id === consulta.serviceLinkId,
            );
            return vinculo !== undefined &&
              entrada.catalogo.preparosEmVigor?.has(vinculo.procedimentoId) ===
                true
              ? [vinculo.procedimentoId]
              : [];
          }),
        );
        return comPreparo.size === 1 && comPreparo.has(procedimentoId);
      } catch {
        return false;
      }
    };
    // [AG7 preparo] fim

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
        // [AG7 preparo] início
        // AG7: enviar_preparo so vale SOZINHA no turno (cada job manda uma
        // mensagem so): com outra chamada na rodada, ou outra ferramenta ja
        // usada no turno, volta ao modelo como vai_sozinha e o resto roda.
        // Com versao em vigor, encerra o turno (o resto da rodada nao roda);
        // sem ela, ou so com a equipe, passa para a equipe.
        if (nome === NOME_DO_ENVIO_DO_PREPARO) {
          const envio = decidirEnvioDoPreparo(
            entrada.catalogo,
            argumentosDe(chamada),
            {
              sozinhaNoTurno:
                chamadas.length === 1 &&
                ferramentasUsadas.every((f) => f === NOME_DO_ENVIO_DO_PREPARO),
              fuso: entrada.fuso,
            },
          );
          ferramentasUsadas.push(NOME_DO_ENVIO_DO_PREPARO);
          if (envio.tipo === "enviar") {
            // Revisao da AG7 (CFM-6): o pedido que vem junto de uma
            // situacao da pessoa (sintoma, doenca, remedio, o que comeu,
            // outra pessoa, a idade) passa para a equipe antes do envio.
            // Deterministico, nas pendentes como chegaram (o portao de
            // entrada nao muda, D-81).
            if (
              situacaoPessoalNoPedidoDoPreparo(
                textosOriginaisDoPaciente(pendentesDoTurno()),
                nomesDoCatalogo(entrada.catalogo),
              )
            ) {
              trilha.push({
                tipo: "cadastro",
                texto: PASSO_DO_PEDIDO_COM_SITUACAO_PESSOAL,
              });
              return escalar(
                "assunto_clinico",
                "ferramenta",
                null,
                ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.assunto_clinico,
              );
            }
            // Revisao da AG7 (CFM-7): o procedimento escolhido tem de ser o
            // que a pessoa pediu, o da marcacao da conversa ou o da
            // consulta dela; senao, nada sai e o modelo pergunta qual e.
            if (!(await procedimentoConfirmado(envio.procedimentoId))) {
              trilha.push({
                tipo: "cadastro",
                texto: PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO,
              });
              historico.push({
                type: "function_call_output",
                call_id: chamada.call_id,
                output: SAIDA_DO_PROCEDIMENTO_NAO_CONFIRMADO,
              });
              continue;
            }
            trilha.push({ tipo: "cadastro", texto: envio.passo });
            preparoEscolhido = {
              procedimentoId: envio.procedimentoId,
              versaoId: envio.versaoId,
              versao: envio.versao,
              introducao: envio.introducao,
            };
            break rodadas;
          }
          trilha.push({ tipo: "cadastro", texto: envio.passo });
          if (envio.tipo === "passar") {
            return escalar(
              envio.motivo,
              "ferramenta",
              null,
              ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[envio.motivo],
            );
          }
          historico.push({
            type: "function_call_output",
            call_id: chamada.call_id,
            output: envio.saida,
          });
          continue;
        }
        // [AG7 preparo] fim
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
        if (efeito.tipo === "mensagem_nova") {
          // Revisao curta das correcoes da AG4 (achado 1): a pessoa escreveu
          // de novo enquanto o turno rodava (mensagem_nova_do_paciente do
          // banco). Nada sai e a conversa NAO passa para a equipe: o desfecho
          // e o de "sem mensagem" (o executor fecha o turno sem envio e
          // conclui o job), e o proximo job responde lendo a mensagem nova.
          // O estado fica como no comeco (AgendaDoTurno.fechar). Revisao
          // final da AG4 (M1 e B1): marcado como mensagem nova, o executor
          // nao grava o estado e garante o job seguinte.
          trilha.push({ tipo: "agenda", texto: efeito.passo });
          return {
            ...fraseFixa({ tipo: "falhou", motivo: "sem_mensagem" }),
            mensagemNova: true,
          };
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

    // Os fatos do turno e o filtro, os mesmos da resposta e da introducao do
    // preparo. Os fatos: AG3, o estado entra como fonte de dia e hora (o que ja
    // foi oferecido), e so o reconferido agora e horario livre.
    const fatosPara = (
      ferramentas: readonly SaidaParaOsFatos[],
      respostasDaBase: readonly string[],
      fraseDoPreparo: string | null,
      avisoDoResto: string | null = null,
    ): FatosDoTurno => {
      const doEstado = agendaDoTurno.fatosDoEstado();
      return montarFatosDoTurno({
        config: entrada.config,
        catalogo: entrada.catalogo,
        agoraTexto,
        agoraMs: entrada.agoraMs,
        fuso: entrada.fuso,
        ferramentas:
          doEstado === null ? ferramentas : [...ferramentas, doEstado],
        respostasDaBase,
        // [AG6b mídia] Os pedidos lidos na conversa (so os nomes do
        // Cadastro), para o resumo dos fatos do verificador.
        pedidos: pedidosDoTurno(mensagensDoTurno, entrada.catalogo),
        // Matriz do dono de 06/11/2026: os outros arquivos da conversa e o
        // aviso do resto do pedido, so quando o turno o colou no rascunho.
        arquivos: fatosDosArquivos(),
        avisoDoResto,
        // [AG7 preparo] A F2, so quando o turno a colou no rascunho (MOTOR-3:
        // nunca a que o modelo escreveu sozinho).
        fraseDoPreparo,
      });
    };
    const passarNoFiltro = async (
      rascunho: string,
      fatos: FatosDoTurno,
      introducaoDoPreparo: boolean,
    ): Promise<DecisaoDoFiltro> => {
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
                mascararParaOVerificador(texto, {
                  anoCorrente,
                  nomesValidados,
                });
              return entrada.verificador({
                ...pedido,
                rascunho: copia(pedido.rascunho),
                mensagensDoPaciente: pedido.mensagensDoPaciente.map(copia),
              });
            }
          : entrada.verificador;
      const decisao = await filtrarSaida({
        rascunho,
        contexto: {
          precosDoTurno,
          nomesDoCatalogo: nomesDoCatalogo(entrada.catalogo),
          mensagensDoPaciente: textosPendentes,
          fatos,
          // [AG7 preparo] A resposta que copia um trecho dos textos de preparo
          // da clinica e barrada (trecho_do_preparo_da_clinica).
          textosDePreparo: entrada.catalogo.textosDePreparo ?? [],
          // [AG7 preparo] Revisao curta (CURTA-1): a resposta a pergunta de
          // preparo so e conferida com a habilidade (resposta_ao_preparo).
          comPreparo,
          introducaoDoPreparo,
        },
        verificador,
        prazoEm,
        agora,
      });
      const chamadaDoVerificador = decisao.verificador;
      if (chamadaDoVerificador?.uso) {
        uso.push({
          papel: "verificador",
          modelo: chamadaDoVerificador.modelo ?? modeloDosClassificadores,
          uso: chamadaDoVerificador.uso,
        });
      } else if (
        decisao.aprovado ||
        decisao.camada === "modelo" ||
        (decisao.camada === "falha" &&
          chamadaPodeTerSidoCobrada(decisao.motivoDaFalha))
      ) {
        // O verificador foi chamado e nao voltou com usage (prazo, rede): a
        // chamada pode ter sido cobrada; entra a estimativa maxima.
        uso.push({
          papel: "verificador",
          modelo: chamadaDoVerificador?.modelo ?? modeloDosClassificadores,
          uso: usoEstimadoDoVerificador(rascunho, textosPendentes),
        });
      }
      return decisao;
    };

    // [AG7 preparo] início
    // AG7: a orientacao de preparo escolhida. Sem comporResposta e sem o filtro
    // no texto do preparo (nada dele passa pelo modelo): o executor le a
    // mensagem que o banco monta da versao em vigor, confere o hash e envia
    // como mensagem do sistema. Sozinha no turno, nenhuma ferramenta de
    // agenda rodou (as falhas seguidas nao mudam).
    if (preparoEscolhido !== null) {
      // Decisao do dono de 06/11/2026: a introducao so vale com a regra propria
      // e o filtro inteiro. Barrada ou com falha, sai so o bloco: o paciente
      // nao fica sem resposta e nada escrito pela IA sai sem passar.
      let introducao: string | null = null;
      let filtroDaIntroducao: DecisaoDoFiltro | null = null;
      if (preparoEscolhido.introducao !== null) {
        const bruta = semAMarcaDoNome(preparoEscolhido.introducao);
        const problema = problemaDaIntroducao(
          bruta,
          entrada.catalogo.textosDePreparo ?? [],
        );
        if (problema !== null) {
          trilha.push({
            tipo: "bloqueio",
            texto: `A introdução da IA foi barrada (${ROTULO_DO_PROBLEMA_DA_INTRODUCAO[problema]}): saiu só a orientação aprovada.`,
          });
        } else {
          try {
            const consultas = await agendaDoTurno.fatosDasConsultasDoContato();
            filtroDaIntroducao = await passarNoFiltro(
              bruta,
              fatosPara(
                consultas === null
                  ? ferramentasDoTurno
                  : [...ferramentasDoTurno, consultas],
                [],
                null,
              ),
              true,
            );
          } catch {
            filtroDaIntroducao = null;
          }
          if (filtroDaIntroducao?.aprovado === true) {
            introducao = filtroDaIntroducao.texto;
            trilha.push({
              tipo: "outro",
              texto: "A introdução da IA passou na conformidade.",
            });
          } else {
            trilha.push({
              tipo: "bloqueio",
              texto: `A introdução da IA foi barrada pela conformidade${filtroDaIntroducao === null ? "" : ` (${rotuloDoBloqueio(filtroDaIntroducao.categoria)})`}: saiu só a orientação aprovada.`,
            });
          }
        }
      }
      return {
        tipo: "preparo",
        preparo: {
          procedimentoId: preparoEscolhido.procedimentoId,
          versaoId: preparoEscolhido.versaoId,
          versao: preparoEscolhido.versao,
        },
        introducao,
        resposta: null,
        rascunhoBloqueado: null,
        desfecho: {
          tipo: "enviou_preparo",
          versaoId: preparoEscolhido.versaoId,
          procedimentoId: preparoEscolhido.procedimentoId,
        },
        trilha,
        uso,
        versaoDoPrompt: VERSAO_DO_PROMPT,
        filtro: filtroDaIntroducao,
        descartados,
        ferramentasUsadas,
        versaoDoClassificador,
      };
    }
    // [AG7 preparo] fim

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
    // [AG7 preparo] Revisao da AG7 (MOTOR-3): o turno colou a F2 (a
    // marcacao de um procedimento com texto em vigor). So ela entra nos
    // textos colados dos fatos; a F2 que o modelo escreveu sozinho e
    // afirmacao dele, e o verificador a julga como tal.
    let comAF2 = false;
    // Matriz do dono de 06/11/2026: o pedido com o resto fora do Cadastro. O
    // sistema cola o aviso, como a F2, e ele passa pelo filtro inteiro.
    let comOAvisoDoResto = false;

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
          arquivoFicaComAEquipe: fatosDosArquivos().some(
            (fato) =>
              fato.tipo === "resto_do_pedido" || fato.tipo === "documento",
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
      // [AG7 preparo] início
      // AG7 (D-76): o turno marcou (nao a remarcacao) um procedimento com
      // orientacao de preparo em vigor, com a habilidade ligada: o sistema
      // cola a F2 depois da resposta, e ela passa pelo filtro inteiro.
      const marcado = agendaDoTurno.procedimentoMarcadoNoTurno();
      comAF2 =
        marcado !== null &&
        permitidas.has(NOME_DO_ENVIO_DO_PREPARO) &&
        entrada.catalogo.preparosEmVigor?.has(marcado) === true;
      // [AG7 preparo] fim
      comOAvisoDoResto = pendentesDoTurno().some(
        (m) => m.arquivo?.avisarDoResto === true,
      );
      rascunho = comporResposta({
        mensagem: mensagemSemMarca,
        saudacao: entrada.config.saudacao,
        encerramento: entrada.config.encerramento,
        primeiraResposta,
        encerra: final.encerra_a_conversa,
        aviso,
        // [AG7 preparo]
        depoisDaMensagem:
          [
            comOAvisoDoResto ? AVISO_DO_RESTO_DO_PEDIDO : null,
            comAF2 ? FRASE_DO_PREPARO_DEPOIS_DE_MARCAR : null,
          ]
            .filter((frase): frase is string => frase !== null)
            .join(" ") || null,
      });
    }

    // 6. Filtro de saida, com os fatos do turno (AG2). Montar os fatos que
    // lanca e falha fechada: a resposta nao sai e a conversa passa.
    let fatos: FatosDoTurno;
    try {
      fatos = fatosPara(
        ferramentasDoTurno,
        respostasDaBase,
        comAF2 && rascunho.includes(FRASE_DO_PREPARO_DEPOIS_DE_MARCAR)
          ? FRASE_DO_PREPARO_DEPOIS_DE_MARCAR
          : null,
        comOAvisoDoResto && rascunho.includes(AVISO_DO_RESTO_DO_PEDIDO)
          ? AVISO_DO_RESTO_DO_PEDIDO
          : null,
      );
    } catch {
      log.warn("ia_agente_fatos_falharam", {
        kind: "agente",
        clinic_id: entrada.clinicId,
      });
      return falhar("desconhecida");
    }
    filtro = await passarNoFiltro(rascunho, fatos, false);
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
      // [AG7 preparo]
      versaoDoClassificador,
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
