import type { SupabaseClient } from "@supabase/supabase-js";

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  gravarAtendimentoDaIa,
  lerAtendimentoDaIa,
  lerNascimentoInformado,
} from "@/lib/agente/atendimento-no-banco";
import { nomesDoCatalogo } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  carregarCatalogoDoAgente,
  carregarConfigPublicada,
} from "@/lib/agente/contexto";
import { acertarGasto, reservarGasto } from "@/lib/agente/gasto";
import { carregarHistoricoDaConversa } from "@/lib/agente/historico";
import {
  atendimentoParaEstimativa,
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  PRAZO_DO_TURNO_MS,
  TEXTO_DA_FALHA,
  type ClienteDoAgente,
  type DesfechoDoTurno,
  type FalhaDoAgente,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
// [AG6 urgência] início
import {
  mensagensPendentes,
  PASSO_DA_CONFERENCIA_DA_ENTRADA,
  PASSO_DA_URGENCIA,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { detectarUrgencia } from "@/lib/domain/conformidade/urgencia";
// [AG6 urgência] fim
// [AG6 passagem] início
import {
  motivoPodeAtribuir,
  pedirAtribuicaoNaPassagem,
  type RegrasDaPassagem,
} from "@/lib/domain/agente/config";
// [AG6 passagem] fim
import { VERSAO_DO_PROMPT } from "@/lib/agente/prompt";
import { lerPrecos } from "@/lib/agente/uso";
// [AG6 passagem] início
import {
  atribuirConversaPassadaPelaIa,
  PRAZO_DA_TRAVA_MS,
} from "@/lib/agente/whatsapp";
// [AG6 passagem] fim
import {
  anotarPassagemParaAEquipe,
  conferirTravaDoWhatsapp,
  confirmarPosse,
  consentimentoVigente,
  fecharTurno,
  foraDoAssuntoNaJanela,
  gravarDecisao,
  gravarEventoDaIa,
  gravarRascunhoBloqueado,
  iaPodeFalarCom,
  janelaConfere,
  jobAnteriorAJanela,
  lerDecisaoParaRetomar,
  lerJanela,
  lerMensagemDoJob,
  lerTurno,
  ligarDecisaoAMensagem,
  passarParaAEquipe,
  RECIBOS_DE_ENVIADA,
  respostasDaIaDesde,
  salvarTurno,
  tetoDeRespostasPorHora,
  trocarSaidaParaFrase,
  type JanelaDaConversa,
  type ResultadoDaPassagem,
  type TurnoDaIa,
} from "@/lib/agente/whatsapp";
import {
  agenteAtendeAgora,
  MOTIVOS_DE_ESCALONAMENTO,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  tipoDoContatoDoBanco,
  type ConfigDoAgente,
  type MotivoDeEscalonamento,
  type MotivoDoEventoDaIa,
} from "@/lib/domain/agente/config";
import {
  retomarTextoAprovado,
  sha256DoTexto,
} from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  iaLiberadaNoAmbiente,
  lerConfigDaIa,
  type ConfigDaIa,
} from "@/lib/ia/liberacao";
import {
  criarClassificadorDeEntrada,
  type ClassificadorDeEntrada,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  clienteOpenAiDoAmbiente,
  identificadorDeSeguranca,
  modeloDoAgente,
  segredoDoIdentificador,
  type ModeloDoAgente,
} from "@/lib/integrations/llm/openai";
import {
  criarVerificador,
  modeloDoVerificador,
} from "@/lib/integrations/llm/verificador";
import {
  envioCertamenteNaoSaiu,
  falhaPermiteRetry,
} from "@/lib/integrations/whatsapp/falhas-do-envio";
import {
  enviarFraseFixaDaIa,
  enviarRespostaDaIa,
  type SendTextResult,
} from "@/lib/integrations/whatsapp/send";
import { log } from "@/lib/log";
// [AG7 preparo] início
import { lerPreparoParaEnvio } from "@/lib/agente/contexto";
import { PASSO_DO_PREPARO_FORA_DE_VIGOR } from "@/lib/agente/ferramentas/enviar-preparo";
import { lerDecisaoDoPreparo } from "@/lib/agente/whatsapp";
import { passoDoPreparoRecusado } from "@/lib/agente/laco";
import type { PreparoAprovado } from "@/lib/domain/conformidade/preparo-aprovado";
import { enviarPreparoAprovadoDaIa } from "@/lib/integrations/whatsapp/send";
// [AG7 preparo] fim

// [AG6b mídia] início
import { mascararNome } from "@/lib/agente/historico";
import {
  entradaDoPortao,
  hojeNoFuso,
  RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS,
  RESERVA_DO_FILTRO_MS,
} from "@/lib/agente/laco";
import { PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS } from "@/lib/domain/conformidade/prazo";
import {
  INTERVALO_DA_ESPERA_MS,
  itensDoCatalogo,
  lerLeiturasDoTurno,
  midiaNaoLida,
  planejarMidiasDoTurno,
  portaDaMidiaDoWhatsapp,
  semEspera,
  telefoneLiberadoParaMidia,
  type PlanoDaMidia,
  type PortaDaMidia,
} from "@/lib/agente/midia";
import {
  comPrecoDaTranscricao,
  lerPrecoDaTranscricao,
  linhasDoUso,
  type PrecoDoModelo,
} from "@/lib/agente/uso";
import {
  detectarGatilhosDeEntrada,
  pedidoDeConsultaParaOutraPessoa,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  lerArquivoComOModelo,
  PRAZO_DO_LEITOR_MS,
  TETO_DE_TOKENS_POR_IMAGEM,
  TETO_DE_TOKENS_POR_PAGINA,
} from "@/lib/integrations/llm/leitor-de-midia";
import {
  modeloDaTranscricao,
  PRAZO_DA_TRANSCRICAO_MS,
  TRANSCRICAO_CALIBRADA,
  transcreverAudio,
  VERSAO_DA_TRANSCRICAO,
} from "@/lib/integrations/llm/transcricao";
import {
  lerArquivoParaAIa,
  PRAZO_DO_ARQUIVO_NO_STORAGE_MS,
} from "@/lib/integrations/storage/arquivo-para-a-ia";
// [AG6b mídia] fim

import { ErroComCodigoDeJob } from "./erro-de-job";
import type { Job, ResultadoDeJob } from "./worker";

// Executor do job 'responder_com_ia' (E3): um turno da recepcionista de IA
// numa conversa do WhatsApp com um telefone da equipe (na producao da onda
// 2, item 11, com qualquer contato que caiba no publico: quem entra na IA
// e o banco, pelas travas; aqui nada muda). Desenho no plano do E3 (secao
// 2.1, passo 7, e tabela 5.3) e no contrato (secao 3.6).
//
// Ordem, cada passo com falha FECHADA:
//  1. Ambiente e lista (T1 e T2: iaLiberadaNoAmbiente, com a lista do banco
//     que o motor da IA leu nesta passagem) e clinica de teste.
//  2. Estado do turno (ai_turno): retomada sem chamar o modelo de novo.
//  3. Conversa na IA sem responsavel, contato, numero e fuso.
//  4. Janela da conversa (contato, telefone atual, job depois de `desde`).
//     Job ANTERIOR a janela atual (D-A da revisao: alguem assumiu e
//     devolveu depois dele) esta morto em qualquer estado: so conclui, sem
//     passagem, evento, frase nem envio.
//  5. ia_pode_falar_com (sem o teto: o teto decide na reserva, D44) e a
//     autorizacao para receber mensagens (consentimento_vigente), antes do
//     modelo: quem revogou nao manda texto a OpenAI nem recebe nada.
//  6. Versao PUBLICADA e horario de operacao.
//  7. Historico da janela e pendentes por id (sem pendente: nada a fazer).
//     Onda 2: quantas vezes a IA ja respondeu fora do assunto na janela
//     (P5b) e se ela ja respondeu na janela (o aviso de assistente virtual,
//     P11a); o tipo do contato (lead ou paciente, item 4) vai ao prompt.
//  7c. [AG6 urgência] A urgencia (AG6a, D-51 e D-52): o sinal de emergencia
//     da lista deterministica nos textos originais das pendentes e na
//     legenda da midia (cada um sozinho e a juncao deles, na ordem), ANTES
//     do teto e da reserva: decisao, passagem sem atribuir (a marca
//     Urgente) e a frase de sempre, sem modelo nenhum. A marca que nao
//     gravou (urgente falso) deixa o aviso no log, so com ids e o codigo.
//     [AG6b mídia] RR2 de 88e9560: de novo depois do plano da midia (7d),
//     com a transcricao ja gravada que o plano aplicou como texto (o job
//     repetido), ainda antes do teto e da reserva.
//  8. Teto de respostas da conversa na ultima hora.
//  9. Reserva do custo maximo do turno (origem whatsapp).
//  8b. (AG3) O estado do atendimento (ler_atendimento_da_ia, pelo job):
//     fora_da_ia encerra sem envio, job_antigo so conclui, e erro ou
//     resposta fora do formato e falha fechada (a frase fixa e a equipe,
//     sem chamar o modelo). E o nascimento informado na conversa (so para a
//     idade atendida do profissional, nunca para o modelo).
// 10. O turno (portao, classificador, agente, filtro), com a trava do
//     WhatsApp entre as rodadas e o prazo da invocacao menos o envio (e as
//     gravacoes; RR2 de 88e9560: o instante contado antes do passo 8b, que
//     o laco recebe em prazoEmMs, com as idas ao banco dentro dele; o minimo
//     conferido de novo logo antes do laco: abaixo dele, a fila, com a
//     reserva solta). As
//     ferramentas de agenda (E4) gravam pelas RPCs com o id DESTE job
//     (portaDaAgendaDoWhatsapp): repetir o job devolve a mesma reserva e a
//     mesma consulta, nunca uma segunda.
// 11. Acerto do gasto, com a conversa e o job.
// 11a. (Revisao final da AG4, M1 e B1) O turno parado pela mensagem nova da
//     pessoa (mensagem_nova_do_paciente do banco): o estado NAO e gravado
//     (nao mudou) e o job seguinte e garantido por enfileirar_resposta_da_ia
//     (junta com o pendente do webhook, ou cria quando nao ha: a mensagem do
//     interceptador e a lida que foi apagada), no maximo 2 vezes seguidas
//     (a contagem no payload); depois disso, ou sem a fila, a falha normal.
// 11b. (AG3) O estado novo, ANTES de decidir e enviar
//     (gravar_atendimento_da_ia, com a versao lida: otimista). Recusa ou
//     erro: a resposta construida sobre o estado velho nunca sai (falha
//     fechada: a frase fixa e a equipe; fora_da_ia, sem frase; sem_posse, o
//     job volta; job_antigo, so conclui).
// 12. ANTES de enviar: ai_decision_log (nunca blocked_draft), o rascunho
//     bloqueado no lugar restrito e ai_turno 'decidido'.
// 13. Saida: a resposta (enviarRespostaDaIa, so TextoAprovado), ou a
//     passagem para a equipe e a frase fixa (tentativa unica), ou nada.
//     [AG7 preparo] Ou a orientacao de preparo aprovada pelo RT
//     (enviarPreparoAprovadoDaIa, so PreparoAprovado): ler_preparo_para_envio
//     e aprovarParaEnvio ANTES da decisao (fora de vigor: a passagem com
//     assunto_clinico e a frase); a decisao 'enviou_preparo' com a versao e
//     o hash; o turno 'decidido' com a saida 'preparo'; o envio. A retomada
//     reconfere a aprovacao no executor (o reenvio nao passa pelo gatilho).
//     Erro na passagem nunca e engolido: o turno fica onde esta e o job
//     tenta de novo (a retentativa passa e manda a frase).
// 13b. [AG6 passagem] Depois da tentativa da frase (saiu ou nao), a conversa
//     que este job passou COM a frase vai ao responsavel do lead quando a
//     regra da versao publicada pede e o motivo pode atribuir
//     (atribuir_conversa_passada_pela_ia; contrato do banco, Revisao R1.3).
//     Revisao R2: a urgencia, o fora do horario, o sintoma, o assunto
//     clinico, a midia e a conformidade nunca atribuem (a chamada nem sai),
//     e o banco recusa tambem com mensagem_nova (o paciente escreveu o que o
//     job nao leu). Nunca antes da frase: a guarda do envio so deixa a frase
//     sair com a conversa na fila sem responsavel. Recusa ou erro: a fila,
//     so o log.
//
// REGRA ABSOLUTA: nenhum texto (do paciente, da resposta, do rascunho) em
// log. So ids, codigos e medidas.

/** O executor guarda isto do prazo da invocacao para o envio. */
export const RESERVA_DO_ENVIO_MS = 14_000;
/**
 * E isto para as gravacoes depois do turno (acerto do gasto, decisao,
 * rascunho, turno, passagem e fechamento), antes do envio: o turno que vai
 * ate o prazo ainda manda a frase (revisao do E3; com 100 ms por ida ao
 * banco, sobra folga de ~30 idas).
 */
export const RESERVA_DAS_GRAVACOES_MS = 3_000;
/** Abaixo disto de prazo para o turno, nem comeca: volta para a fila. */
export const PRAZO_MINIMO_DO_TURNO_MS = 20_000;
// [AG6b mídia] início
/**
 * AG6b (desenho 5.1): com audio a transcrever ou arquivo a ler, o turno
 * precisa de mais prazo (a transcricao e o leitor vem antes do agente e do
 * filtro). PROPOSTA, sem medir (a prova paga, D-100, foi dispensada pelo dono em 06/11/2026). Abaixo: volta para
 * a fila, sem custo (orcamento_da_passagem).
 *
 * Revisao da AG6b, a conta (era 30 s, e so a transcricao, o classificador e
 * a reserva do verificador no pior caso davam 30,5 s):
 *  - o que a midia nunca usa (lib/agente/laco.ts, prazoParaAMidia): a
 *    reserva do filtro (10 s), a janela minima do agente (3 s) e, no audio,
 *    o classificador que vem depois da transcricao (8 s): 21 s
 *    (TURNO_SEM_A_MIDIA_MS). No arquivo o classificador roda ANTES do leitor
 *    e gasta do mesmo turno ate os mesmos 8 s: a conta e a mesma;
 *  - o modelo da midia no pior caso: 12 s de prazo (PRAZO_DA_TRANSCRICAO_MS
 *    e PRAZO_DO_LEITOR_MS, propostas) mais os cortes em ordem: o corte duro
 *    da integracao (a folga dela, 0,5 s), a margem e a fatia da gravacao da
 *    leitura antes do corte da porta (MARGEM_ENTRE_OS_CORTES_MS, 0,5 s, e
 *    RESERVA_DA_GRAVACAO_DA_LEITURA_MS, 1,5 s; lib/agente/midia.ts) e o
 *    corte do laco (FOLGA_DO_CORTE_DA_MIDIA_MS, 0,5 s): 15 s;
 *  - 21 + 15 = 36 s. Revisao da juncao (30/10/2026): era 35 s, com o corte
 *    duro da integracao caindo junto com o do laco e DEPOIS do da porta (a
 *    porta cortava primeiro e o resultado da integracao, com a nova
 *    tentativa dela, se perdia). Segunda rodada (R3 de d1a15f6, 1): a fatia
 *    da gravacao da leitura (1,5 s) sai do prazo da integracao, e o minimo
 *    continua 36 s. No minimo exato o Storage sai do prazo da integracao
 *    (com 1,5 s de Storage, a transcricao tem 10,5 s); a integracao com os
 *    12 s inteiros e 1,5 s de Storage pede 37,5 s, e o maior turno (38 s)
 *    da os 12 s com ate 2 s de Storage.
 * A MARGEM DE 2 s ANTES DO TURNO (R3 de d1a15f6, 5), sem medir: o turno com
 * midia so comeca com 36 s, e o maior turno possivel e
 * 38 s (os 55 s da invocacao menos os 14 s do envio e os 3 s das
 * gravacoes). Tudo o que vem antes da conta do prazo do turno na invocacao
 * (o claim, o historico, o plano da midia e o teto) tem de caber nos 2 s do
 * comeco dela; senao o job volta para a fila (orcamento_da_passagem). RR2
 * de 88e9560 (baixo 6): o que vem DEPOIS da conta e antes do laco (os
 * precos e o catalogo sem midia, o estado, o nascimento, a reserva e o
 * turno) sai do prazo do turno (o laco recebe o instante, prazoEmMs), nunca
 * da reserva das gravacoes nem da do envio; e (rev4) o minimo e conferido
 * de novo logo antes do laco: abaixo dele, o job volta para a fila sem
 * custo (a reserva solta). Essas idas cabem, entao, na sobra do turno acima
 * do minimo (no maior turno, os mesmos 2 s, menos o que veio antes da
 * conta). Se esses 2 s bastam, e se o minimo fica em 36 s, so a medida diz. O
 * minimo nunca pode passar do maior turno (o turno com midia nunca
 * comecaria).
 * O que NAO cabe, e depende de medir o Storage e o modelo e baixar os prazos
 * ou de subir o maxDuration da rota da IA (decisao de
 * infraestrutura, desenho 12): o Storage no pior caso proposto (8 s) junto
 * com o modelo no pior caso, 44 s; e audio e arquivo no mesmo turno. Nesses
 * casos a midia e cortada no prazo dela (falha fechada, a frase de sempre),
 * sem pagar o agente, e a reserva das gravacoes e a do envio ficam
 * inteiras. O classificador so fica sem pagar quando o corte e no audio (a
 * transcricao vem antes dele, no 2b); no arquivo, sozinho ou com o audio no
 * mesmo turno, o classificador ja rodou (e foi pago) quando o leitor (3b)
 * falha por prazo.
 */
export const PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS = 36_000;
/**
 * Revisao da AG6b: a parte do turno que a midia nunca usa no pior caso (a
 * conta de cima, para o teste conferir que o minimo cobre o modelo da
 * midia no pior caso, com a fatia da gravacao, e cabe no maior turno
 * possivel).
 */
export const TURNO_SEM_A_MIDIA_MS =
  RESERVA_DO_FILTRO_MS +
  RESERVA_DO_AGENTE_DEPOIS_DA_MIDIA_MS +
  PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS;
// [AG6b mídia] fim
const UMA_HORA_MS = 60 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DependenciasDoExecutorDaIa = {
  admin: SupabaseClient;
  /**
   * T1 e T2: o ambiente e a lista das clinicas habilitadas que o motor da IA
   * leu do banco nesta passagem (executarPassagemDaIa). Sem T1/T2 o executor
   * falha definitivo 'ia_fora_do_ambiente'.
   */
  config: ConfigDaIa;
  /** Epoch ms do fim da invocacao (o executor reserva 14 s para o envio). */
  prazoFinalMs: number;
  agora: () => number;
  /** So suites: aceita clinica e_de_teste; LANCA com VERCEL_ENV=production. */
  incluirClinicasDeTeste?: boolean;
  clienteDoAgente: () => ClienteDoAgente | null;
  modeloDoAgente: () => ModeloDoAgente | null;
  segredoDoIdentificador: () => string | null;
  criarVerificador: (identificador: string) => Verificador;
  criarClassificador: (identificador: string) => ClassificadorDeEntrada;
  executarTurno: typeof executarTurnoDoAgente;
  enviarResposta: typeof enviarRespostaDaIa;
  enviarFrase: typeof enviarFraseFixaDaIa;
  // [AG6b mídia] início
  /**
   * AG6b: a midia do turno (a calibragem, os tetos, o modelo da transcricao
   * e a porta). Ausente: nenhuma midia sai (todo audio, foto e documento
   * continua passando para a equipe, como antes da AG6b).
   */
  midia?: DependenciasDaMidiaDoTurno;
  // [AG6b mídia] fim
  // [AG7 preparo] início
  /**
   * AG7: o envio da orientacao de preparo aprovada pelo RT (so
   * PreparoAprovado). Ausente: o de verdade (enviarPreparoAprovadoDaIa).
   */
  enviarPreparo?: typeof enviarPreparoAprovadoDaIa;
  // [AG7 preparo] fim
};

// [AG6b mídia] início
/** AG6b: o que o executor precisa para a midia do turno. */
export type DependenciasDaMidiaDoTurno = {
  /** TRANSCRICAO_CALIBRADA. */
  transcricaoCalibrada: boolean;
  /** Os tetos de tokens do leitor (nulos: nao le). */
  tetosDoLeitor: { imagem: number | null; pagina: number | null };
  /** O modelo da transcricao (IA_MODELO_TRANSCRICAO; null: fora da lista). */
  modeloDaTranscricao: string | null;
  /** O modelo do leitor (IA_MODELO_VERIFICADOR; null: fora da lista). */
  modeloDoLeitor: string | null;
  /** A porta da midia deste turno (o job, a posse e o HMAC do contato). */
  criarPorta: (entrada: {
    clinicId: string;
    conversationId: string;
    jobId: string;
    workerId: string;
    identificador: string | null;
    mascarar: (texto: string) => string;
  }) => PortaDaMidia;
};
// [AG6b mídia] fim

/**
 * incluirClinicasDeTeste existe so para as suites (clinica e_de_teste com
 * numero falso). Em producao da Vercel ele LANCA: clinica de teste nunca
 * chama a OpenAI de verdade.
 */
export function exigirForaDeProducao(
  incluirClinicasDeTeste: boolean | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (incluirClinicasDeTeste === true && env.VERCEL_ENV === "production") {
    throw new Error("incluirClinicasDeTeste recusado em producao");
  }
}

/** As dependencias de producao: o ambiente, a OpenAI e o envio de verdade. */
export function dependenciasPadraoDaIa(entrada: {
  admin: SupabaseClient;
  prazoFinalMs: number;
}): DependenciasDoExecutorDaIa {
  const env = process.env;
  // [AG6b mídia] O cliente inteiro (a transcricao usa audio; o agente,
  // responses): o mesmo cliente e a mesma chave (D-94).
  let cliente: ReturnType<typeof clienteOpenAiDoAmbiente> | undefined;
  const clienteDoAgente = (): ReturnType<typeof clienteOpenAiDoAmbiente> => {
    if (cliente === undefined) {
      cliente = clienteOpenAiDoAmbiente(env);
    }
    return cliente;
  };
  const modeloDosClassificadores = modeloDoVerificador(env);
  // [AG6b mídia] Revisao R3 de d1a15f6 (2): os tetos do leitor numa fonte
  // so, para o plano, a reserva, o corte do laco e a porta.
  const tetosDoLeitor = {
    imagem: TETO_DE_TOKENS_POR_IMAGEM,
    pagina: TETO_DE_TOKENS_POR_PAGINA,
  };
  return {
    admin: entrada.admin,
    // Sem a lista: nenhuma clinica passa (falha fechada). A lista vem do
    // banco, lida pelo motor da IA a cada passagem, que troca esta config
    // pela dele (executarPassagemDaIa); o claim legado nunca traz o kind.
    config: lerConfigDaIa([], env),
    prazoFinalMs: entrada.prazoFinalMs,
    agora: Date.now,
    clienteDoAgente,
    modeloDoAgente: () => modeloDoAgente(env),
    segredoDoIdentificador: () => segredoDoIdentificador(env),
    criarVerificador: (identificador) =>
      criarVerificador({
        cliente: clienteDoAgente(),
        modelo: modeloDosClassificadores,
        identificadorDeSeguranca: identificador,
      }),
    criarClassificador: (identificador) =>
      criarClassificadorDeEntrada({
        cliente: clienteDoAgente(),
        modelo: modeloDosClassificadores,
        identificadorDeSeguranca: identificador,
      }),
    executarTurno: executarTurnoDoAgente,
    enviarResposta: enviarRespostaDaIa,
    enviarFrase: enviarFraseFixaDaIa,
    // [AG7 preparo]
    enviarPreparo: enviarPreparoAprovadoDaIa,
    // [AG6b mídia] início
    midia: {
      transcricaoCalibrada: TRANSCRICAO_CALIBRADA,
      tetosDoLeitor,
      modeloDaTranscricao: modeloDaTranscricao(env),
      modeloDoLeitor: modeloDosClassificadores,
      criarPorta: (e) =>
        portaDaMidiaDoWhatsapp(entrada.admin, {
          clinicId: e.clinicId,
          conversationId: e.conversationId,
          jobId: e.jobId,
          workerId: e.workerId,
          mascarar: e.mascarar,
          // Revisao da AG6b: o Storage nunca recebe mais que o prazo dele
          // (a porta ja corta em PRAZO_MAXIMO_DO_STORAGE_MS; aqui de novo,
          // com a constante da integracao) e recebe o sinal do corte.
          lerArquivo: (a) =>
            lerArquivoParaAIa(entrada.admin, {
              clinicId: e.clinicId,
              messageId: a.messageId,
              mediaUrl: a.mediaUrl,
              maximoDeBytes: a.maximoDeBytes,
              prazoMs: Math.min(PRAZO_DO_ARQUIVO_NO_STORAGE_MS, a.prazoMs),
              sinal: a.sinal,
            }),
          transcrever: (t) =>
            transcreverAudio({
              cliente: clienteDoAgente(),
              modelo: modeloDaTranscricao(env),
              bytes: t.bytes,
              segundosMedidos: t.segundosMedidos,
              prazoMs: Math.min(PRAZO_DA_TRANSCRICAO_MS, t.prazoMs),
              ids: {
                clinicId: e.clinicId,
                conversationId: e.conversationId,
                jobId: e.jobId,
                messageId: t.messageId,
              },
              // Revisao da AG6b (a juncao): o sinal do corte da porta e do
              // laco; a requisicao nao fica rodando depois deles.
              sinal: t.sinal,
            }),
          lerComOModelo: (l) =>
            lerArquivoComOModelo({
              cliente: clienteDoAgente(),
              modelo: modeloDosClassificadores,
              identificadorDeSeguranca: e.identificador,
              arquivo: l.arquivo,
              catalogo: l.catalogo,
              prazoMs: Math.min(PRAZO_DO_LEITOR_MS, l.prazoMs),
              ids: {
                clinicId: e.clinicId,
                conversationId: e.conversationId,
                jobId: e.jobId,
                messageId: l.messageId,
                midia: l.midia,
              },
              // Revisao da AG6b: o sinal do corte da porta e do laco.
              sinal: l.sinal,
            }),
          versaoDaTranscricao: VERSAO_DA_TRANSCRICAO,
          modeloDoLeitor: modeloDosClassificadores ?? "desconhecido",
          // Revisao da AG6b: a estimativa da chamada cortada.
          modeloDaTranscricao: modeloDaTranscricao(env),
          tetosDoLeitor,
        }),
    },
    // [AG6b mídia] fim
  };
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type Conversa = {
  status: string;
  assignee_user_id: string | null;
  contact_id: string;
  whatsapp_account_id: string;
};

type Contato = {
  phone_key: string | null;
  name: string | null;
  birth_date: string | null;
  /** contact.kind (onda 2, item 4): lead ou paciente, para o prompt. */
  kind: string | null;
};

type Contexto = {
  deps: DependenciasDoExecutorDaIa;
  admin: SupabaseClient;
  job: Job;
  workerId: string;
  clinicId: string;
  conversationId: string;
  // [AG6 passagem] início
  /**
   * AG6a: para quem vai a conversa, da versao publicada que este turno leu
   * (passo 6). Ausente: ainda nao lida (a retomada le depois da frase, so
   * quando o motivo pode atribuir). Nulo: a leitura falhou (a fila, o lado
   * seguro).
   */
  regras?: RegrasDaPassagem | null;
  // [AG6 passagem] fim
  // [AG6b mídia] início
  /**
   * AG6b (D-96): o turno leu midia do paciente que o assistente nao leu
   * (sem leitura, sem fala, video): a atribuicao nem e pedida (o banco
   * recusa de qualquer jeito, midia_nao_lida). Ausente: nao se sabe (a
   * retomada; o banco decide).
   */
  midiaNaoLida?: boolean;
  // [AG6b mídia] fim
};

const CONCLUIR: ResultadoDeJob = { ok: true };

function idsDoLog(c: Contexto) {
  return {
    clinic_id: c.clinicId,
    conversation_id: c.conversationId,
    job_id: c.job.id,
  };
}

function restanteMs(c: Contexto): number {
  return c.deps.prazoFinalMs - c.deps.agora();
}

function agoraIso(c: Contexto): string {
  return new Date(c.deps.agora()).toISOString();
}

function conversaDoPayload(payload: Record<string, unknown>): string | null {
  const valor = payload.conversation_id;
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function executarRespostaComIa(
  job: Job,
  workerId: string,
  deps: DependenciasDoExecutorDaIa,
): Promise<ResultadoDeJob> {
  exigirForaDeProducao(deps.incluirClinicasDeTeste);

  // T1 e T2 antes de qualquer leitura: fora do ambiente ou da lista (a do
  // banco, lida pelo motor nesta passagem), nada e tocado.
  if (!iaLiberadaNoAmbiente(deps.config, job.clinic_id)) {
    log.warn("ia_job_fora_do_ambiente", {
      clinic_id: job.clinic_id,
      job_id: job.id,
    });
    return { ok: false, erro: "ia_fora_do_ambiente", definitivo: true };
  }
  const conversationId = conversaDoPayload(job.payload);
  if (conversationId === null) {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }
  const c: Contexto = {
    deps,
    admin: deps.admin,
    job,
    workerId,
    clinicId: job.clinic_id,
    conversationId,
  };
  try {
    return await executarTurno(c);
  } catch (erro) {
    if (erro instanceof ErroComCodigoDeJob) {
      log.warn("ia_job_leitura_falhou", {
        ...idsDoLog(c),
        error_code: erro.codigo,
      });
      return { ok: false, erro: erro.codigo };
    }
    throw erro;
  }
}

async function lerOuFalhar<T>(leitura: () => Promise<T>): Promise<T> {
  try {
    return await leitura();
  } catch (erro) {
    if (erro instanceof ErroComCodigoDeJob) {
      throw erro;
    }
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
}

async function executarTurno(c: Contexto): Promise<ResultadoDeJob> {
  const { admin, clinicId } = c;

  // 1. A clinica: o fuso e a marca de teste.
  const clinica = await admin
    .from("clinic")
    .select("timezone, e_de_teste")
    .eq("id", clinicId)
    .maybeSingle();
  if (clinica.error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const linhaDaClinica = clinica.data as {
    timezone: string | null;
    e_de_teste: boolean | null;
  } | null;
  if (
    !linhaDaClinica ||
    (linhaDaClinica.e_de_teste === true &&
      c.deps.incluirClinicasDeTeste !== true)
  ) {
    return { ok: false, erro: "ia_fora_do_ambiente", definitivo: true };
  }
  const fuso = linhaDaClinica.timezone || "America/Fortaleza";

  // 2. O estado do turno deste job.
  const turnoAtual = await lerTurno(admin, clinicId, c.job.id);
  if (turnoAtual?.estado === "enviado" || turnoAtual?.estado === "sem_envio") {
    return CONCLUIR;
  }

  // 3. A conversa.
  const lida = await admin
    .from("conversation")
    .select("status, assignee_user_id, contact_id, whatsapp_account_id")
    .eq("clinic_id", clinicId)
    .eq("id", c.conversationId)
    .maybeSingle();
  if (lida.error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const conversa = lida.data as Conversa | null;

  // 4. A janela, ANTES das retomadas (D-A): job anterior a janela atual
  // (alguem assumiu e devolveu depois dele) esta morto, em qualquer estado.
  const janela = await lerJanela(admin, clinicId, c.conversationId);
  if (jobAnteriorAJanela(janela, c.job.created_at)) {
    return concluirJobAntigo(c, turnoAtual);
  }

  // Retomadas que nao chamam o modelo.
  if (turnoAtual?.estado === "passou_para_equipe") {
    // [AG6 passagem] início
    return retomarAPassagem(c, turnoAtual);
    // [AG6 passagem] fim
  }
  if (turnoAtual?.estado === "decidido") {
    return retomarDecidido(c, turnoAtual, conversa);
  }

  // Turno novo (ou retomada de 'reservado': reserva nova, modelo de novo).
  if (
    !conversa ||
    conversa.status !== "ia_atendendo" ||
    conversa.assignee_user_id !== null
  ) {
    await encerrarSemEnvio(c, turnoAtual);
    return CONCLUIR;
  }

  const lidoContato = await admin
    .from("contact")
    .select("phone_key, name, birth_date, kind")
    .eq("clinic_id", clinicId)
    .eq("id", conversa.contact_id)
    .maybeSingle();
  if (lidoContato.error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const contato = lidoContato.data as Contato | null;

  if (
    !contato ||
    !janela ||
    !janelaConfere(janela, {
      contactId: conversa.contact_id,
      phoneKey: contato.phone_key,
      jobCriadoEm: c.job.created_at ?? "",
    })
  ) {
    return passarSemFrase(c, turnoAtual, "liberacao_perdida");
  }
  const telefone = contato.phone_key;
  if (telefone === null) {
    return passarSemFrase(c, turnoAtual, "liberacao_perdida");
  }

  // 5. A liberacao (sem o teto).
  const trava = {
    clinicId,
    whatsappAccountId: conversa.whatsapp_account_id,
    telefone,
  };
  if (!(await iaPodeFalarCom(admin, trava))) {
    return passarSemFrase(c, turnoAtual, "liberacao_perdida");
  }

  // 5b. A autorizacao para receber mensagens, ANTES do modelo (revisao do
  // E3): quem revogou nao manda texto a OpenAI nem recebe nada, nem a frase.
  // A conversa passa para a equipe sem frase, com o evento proprio.
  if (
    !(await consentimentoVigente(admin, {
      clinicId,
      contactId: conversa.contact_id,
    }))
  ) {
    return passarSemFrase(c, turnoAtual, "sem_autorizacao");
  }

  // 6. A versao publicada e o horario.
  const config = await lerOuFalhar(() =>
    carregarConfigPublicada(admin, clinicId),
  );
  if (config === null) {
    return passarSemFrase(c, turnoAtual, "sem_versao_publicada");
  }
  // [AG6 passagem] início
  // A regra da passagem da versao publicada lida agora (a atribuicao so
  // vale nas passagens com a frase; o banco confere de novo).
  c.regras = config.regras;
  // [AG6 passagem] fim
  const agoraMs = c.deps.agora();
  if (config.horario.modo === "fallback") {
    return passarSemFrase(c, turnoAtual, "horario_nao_suportado");
  }
  if (!agenteAtendeAgora(config.horario, agoraMs, fuso).atende) {
    return passarSemFrase(c, turnoAtual, "fora_do_horario");
  }

  // 7. O historico da janela e as pendentes.
  const historico = await carregarHistoricoDaConversa(admin, {
    clinicId,
    conversationId: c.conversationId,
    desde: janela.desde,
    abertaPor: janela.abertaPor,
    nomeDoContato: contato.name,
    jobId: c.job.id,
  });
  if (historico.pendentes.length === 0) {
    await encerrarSemEnvio(c, turnoAtual);
    return CONCLUIR;
  }
  // Onda 2 (item 5, P5b): a insistencia fora do assunto conta na janela.
  const foraDoAssunto = await foraDoAssuntoNaJanela(admin, {
    clinicId,
    conversationId: c.conversationId,
    desdeIso: janela.desde,
  });
  // Onda 2 (item 4): o tipo do contato AGORA (o lead que virou paciente no
  // meio da conversa ja vai como paciente; o banco so filtra na entrada).
  const tipoDoContato = tipoDoContatoDoBanco(contato.kind);

  const base: TurnoDaIa = {
    jobId: c.job.id,
    clinicId,
    conversationId: c.conversationId,
    estado: "reservado",
    reservaId: null,
    // A reserva de uma tentativa cortada nunca e acertada nem reaproveitada.
    reservasPerdidas: [
      ...(turnoAtual?.reservasPerdidas ?? []),
      ...(turnoAtual?.reservaId ? [turnoAtual.reservaId] : []),
    ],
    saida: null,
    texto: null,
    textoSha256: null,
    decisionId: null,
    mensagensLidas: historico.pendentes,
  };
  const destino = {
    contactId: conversa.contact_id,
    whatsappAccountId: conversa.whatsapp_account_id,
  };

  // [AG6 urgência] início
  // 7c. A urgencia (AG6a, D-51 e D-52): a lista deterministica de sinais de
  // emergencia nos textos ORIGINAIS das pendentes, ANTES do teto de
  // respostas, da reserva do gasto e de qualquer modelo. Achou: a decisao
  // (escalou, urgencia, origem portao, sem uso), a passagem SEM atribuir (o
  // banco marca a conversa como Urgente) e a frase de sempre.
  if (urgenciaNasPendentes(historico.mensagens)) {
    return passarPorUrgencia(c, base, destino, config);
  }
  // [AG6 urgência] fim

  // [AG6b mídia] início
  // 7d. O plano da midia (desenho 5.1): so com midia do paciente no
  // recorte. O portao do aviso (midia_da_ia_liberada, D-95), as leituras ja
  // gravadas (o job repetido nunca chama o modelo de novo), o preco por
  // minuto da transcricao e o catalogo; a situacao de cada midia pendente
  // (lib/agente/midia.ts). Arquivo ainda baixando, dentro de 90 s: antes de
  // esperar, o portao nos textos (a midia que baixa como texto vazio); se
  // ele escala, segue sem esperar (o laco escala no 1a); senao, volta em
  // 15 s, sem estado e sem reserva.
  c.midiaNaoLida = mensagensPendentes(historico.mensagens).some(midiaNaoLida);
  let mensagensDoTurno = historico.mensagens;
  let plano: PlanoDaMidia | null = null;
  let precosDaMidia: PrecoDoModelo[] | null = null;
  let catalogoDaMidia: Awaited<
    ReturnType<typeof carregarCatalogoDoAgente>
  > | null = null;
  if (historico.mensagens.some((m) => m.midia !== undefined)) {
    const [precosLidos, catalogoLido] = await Promise.all([
      lerOuFalhar(() => lerPrecos(admin)),
      lerOuFalhar(() => carregarCatalogoDoAgente(admin, clinicId)),
    ]);
    const midiaDeps = c.deps.midia;
    const modeloDoAudio = midiaDeps?.modeloDaTranscricao ?? null;
    const [liberado, leituras, porMinuto] = await Promise.all([
      telefoneLiberadoParaMidia(admin, { clinicId, telefone }),
      lerLeiturasDoTurno(admin, {
        clinicId,
        conversationId: c.conversationId,
        messageIds: historico.mensagens.flatMap((m) =>
          m.midia === undefined ? [] : [m.midia.messageId],
        ),
      }),
      modeloDoAudio === null
        ? Promise.resolve(null)
        : lerPrecoDaTranscricao(admin, modeloDoAudio),
    ]);
    precosDaMidia =
      modeloDoAudio === null
        ? precosLidos
        : comPrecoDaTranscricao(precosLidos, modeloDoAudio, porMinuto);
    catalogoDaMidia = catalogoLido;
    const modeloDoLeitor = midiaDeps?.modeloDoLeitor ?? null;
    plano = planejarMidiasDoTurno(
      {
        mensagens: historico.mensagens,
        pendentes: historico.pendentes,
        habilidades: config.habilidades,
        telefoneLiberado: midiaDeps !== undefined && liberado,
        leituras,
        transcricaoComPreco:
          modeloDoAudio !== null && (porMinuto ?? 0) > 0,
        transcricaoCalibrada: midiaDeps?.transcricaoCalibrada === true,
        leitorPronto:
          midiaDeps !== undefined &&
          modeloDoLeitor !== null &&
          precosDaMidia.some((p) => p.modelo === modeloDoLeitor),
        catalogo: itensDoCatalogo(catalogoLido),
        mascarar: (texto) => mascararNome(texto, contato.name),
        agoraMs,
      },
      midiaDeps?.tetosDoLeitor ?? { imagem: null, pagina: null },
    );
    mensagensDoTurno = plano.mensagens;
    c.midiaNaoLida = plano.midiaNaoLida;
    // RR2 de 88e9560 (medio 3): o 7c de novo, com a transcricao JA GRAVADA
    // que o plano aplicou como texto (o job repetido depois da excecao, da
    // posse perdida ou da invocacao que morreu; so com a habilidade e o
    // aviso valendo agora). A urgencia no texto mantido passa a conversa
    // ANTES do teto de respostas, da reserva e da leitura do estado, como no
    // 7c: o teto do dia que a reserva perdida da tentativa anterior encheu
    // nunca segura a marca Urgente. A urgencia so do texto descartado nunca
    // foi gravada: o laco transcreve de novo e acha de novo.
    if (urgenciaNasPendentes(mensagensDoTurno)) {
      return passarPorUrgencia(c, base, destino, config);
    }
    if (plano.esperar) {
      const pendentesNaEspera = mensagensPendentes(mensagensDoTurno).map((m) =>
        m.midia?.situacao === "baixando"
          ? { tipo: "texto", texto: "" }
          : entradaDoPortao(m),
      );
      const escala =
        detectarGatilhosDeEntrada({
          mensagens: pendentesNaEspera,
          dataDeNascimento: contato.birth_date,
          // Revisao da AG6b: a data de hoje no fuso da clinica, a mesma do
          // portao do laco (o menor pelo nascimento nao espera o download).
          hojeNaClinica: hojeNoFuso(agoraMs, fuso),
        }).length > 0 ||
        pedidoDeConsultaParaOutraPessoa(
          pendentesNaEspera
            .filter((e) => e.tipo === "texto")
            .map((e) => e.texto),
        );
      if (!escala) {
        log.info("ia_esperando_midia", idsDoLog(c));
        return {
          reagendar: new Date(
            c.deps.agora() + INTERVALO_DA_ESPERA_MS,
          ).toISOString(),
          motivo: "esperando_midia",
        };
      }
      mensagensDoTurno = semEspera(mensagensDoTurno);
    }
  }
  const comMidiaParaOModelo =
    plano !== null && (plano.aTranscrever > 0 || plano.aLer.length > 0);
  // [AG6b mídia] fim

  // 8. Teto de respostas da conversa na ultima hora.
  const teto = await tetoDeRespostasPorHora(admin, clinicId);
  if (teto !== null) {
    const respostas = await respostasDaIaDesde(admin, {
      clinicId,
      conversationId: c.conversationId,
      desdeIso: new Date(agoraMs - UMA_HORA_MS).toISOString(),
    });
    if (respostas >= teto) {
      return escalarSemModelo(c, base, destino, "teto_de_respostas", config);
    }
  }

  // O prazo do turno cabe? Senao, volta para a fila sem tocar em nada. O
  // turno para antes do prazo da invocacao menos o envio E as gravacoes
  // depois dele (acerto, decisao, rascunho, turno, passagem): o turno que
  // vai ate o fim ainda passa e manda a frase (CLAUDE.md 3.2).
  // RR2 de 88e9560 (baixo 6): o prazo conta DESTE instante, e o laco recebe
  // o instante em que ele acaba (prazoEmMs, no mesmo relogio): as idas ao
  // banco daqui ate o laco (os precos e o catalogo, o estado, o nascimento,
  // a reserva e o turno) saem do prazo do turno, nunca da reserva das
  // gravacoes nem da do envio. Antes o laco contava do proprio comeco.
  const contaDoTurnoDesde = c.deps.agora();
  const prazoDoTurno = Math.min(
    PRAZO_DO_TURNO_MS,
    c.deps.prazoFinalMs -
      contaDoTurnoDesde -
      RESERVA_DO_ENVIO_MS -
      RESERVA_DAS_GRAVACOES_MS,
  );
  const prazoDoTurnoEm = contaDoTurnoDesde + prazoDoTurno;
  // [AG6b mídia] Com midia para o modelo, o prazo minimo e o da midia.
  const prazoMinimoDoTurno = comMidiaParaOModelo
    ? PRAZO_MINIMO_DO_TURNO_COM_MIDIA_MS
    : PRAZO_MINIMO_DO_TURNO_MS;
  if (prazoDoTurno < prazoMinimoDoTurno) {
    return { reagendar: agoraIso(c), motivo: "orcamento_da_passagem" };
  }

  // [AG6b mídia] Os precos (com o da transcricao) e o catalogo ja lidos no
  // plano da midia, ou lidos agora.
  const [precos, catalogo] =
    precosDaMidia !== null && catalogoDaMidia !== null
      ? [precosDaMidia, catalogoDaMidia]
      : await Promise.all([
          lerOuFalhar(() => lerPrecos(admin)),
          lerOuFalhar(() => carregarCatalogoDoAgente(admin, clinicId)),
        ]);

  // 8b. (AG3) O estado do atendimento desta janela, pelo job.
  const leitura = await lerAtendimentoDaIa(admin, {
    clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
  });
  if (leitura.tipo === "recusado") {
    if (leitura.motivo === "job_antigo") {
      return concluirJobAntigo(c, turnoAtual);
    }
    // fora_da_ia: alguem assumiu (ou a janela trocou) agora mesmo.
    await encerrarSemEnvio(c, turnoAtual);
    return CONCLUIR;
  }
  if (leitura.tipo === "erro") {
    return falharSemModelo(c, base, destino, config, PASSO_DO_ESTADO_NAO_LIDO);
  }
  const lido = leitura.resposta;
  const atendimento = { estado: lido.estado, dados: lido.dados };
  const nascimentoInformado = await lerNascimentoInformado(admin, {
    clinicId,
    conversationId: c.conversationId,
    contactId: conversa.contact_id,
    // Revisao final da AG3: so a linha da janela atual.
    janelaDesde: lido.janelaDesde,
  });

  const cliente = c.deps.clienteDoAgente();
  const modelo = c.deps.modeloDoAgente();
  const identificador = identificadorDeSeguranca({
    clinicId,
    contactId: conversa.contact_id,
    segredo: c.deps.segredoDoIdentificador(),
  });
  const modeloDosClassificadores = modeloDoVerificador();

  // 9. A reserva do custo maximo (so quando o modelo pode ser chamado: sem
  // cliente, modelo ou identificador o laco falha antes de qualquer chamada).
  let reservaId: string | null = null;
  // [AG6b mídia] O que foi reservado (para o log do uso acima da reserva).
  let reservado: number | null = null;
  if (cliente !== null && modelo !== null && identificador !== null) {
    const custoMaximo = custoMaximoDoTurno({
      config,
      catalogo,
      // [AG6b mídia] as mensagens do turno (com a midia do plano)
      mensagens: mensagensDoTurno,
      agoraMs,
      fuso,
      modelo,
      modeloDosClassificadores,
      precos,
      contato: tipoDoContato,
      atendimento: atendimentoParaEstimativa({
        atendimento,
        config,
        catalogo,
        agoraMs,
        fuso,
      }),
      // [AG6b mídia] a transcricao e o leitor no pior caso (desenho 5.3)
      midia:
        plano === null || !comMidiaParaOModelo
          ? null
          : {
              aTranscrever: plano.aTranscrever,
              modeloDaTranscricao: c.deps.midia?.modeloDaTranscricao ?? "",
              aLer: plano.aLer,
              modeloDoLeitor: c.deps.midia?.modeloDoLeitor ?? "",
            },
    });
    if (custoMaximo === null) {
      log.warn("ia_preco_ausente", idsDoLog(c));
      return falharSemModelo(c, base, destino, config);
    }
    // [AG6b mídia]
    reservado = custoMaximo;
    const reserva = await reservarGasto(admin, {
      clinicId,
      origem: "whatsapp",
      custoMicrodolar: custoMaximo,
    });
    if (reserva.tipo === "erro") {
      throw new ErroComCodigoDeJob("reserva_falhou");
    }
    if (reserva.tipo === "teto") {
      // NULL junta o teto e a liberacao perdida: a trava sem o teto separa.
      if (await iaPodeFalarCom(admin, trava)) {
        return escalarSemModelo(c, base, destino, "teto_atingido", config);
      }
      return passarSemFrase(c, turnoAtual, "liberacao_perdida");
    }
    reservaId = reserva.id;
  }
  await salvarTurnoComReserva(c, { ...base, reservaId }, precos);

  // RR2 de 88e9560 (rev4): o minimo de novo, logo antes do laco. As idas ao
  // banco depois da conta (os precos e o catalogo sem midia, o estado, o
  // nascimento, a reserva e o turno) podem ter deixado o turno abaixo do
  // minimo, e o laco falharia por prazo (a frase de sempre, com a midia
  // cortada). Volta para a fila como no primeiro caso e sem custo: a reserva
  // desta tentativa e solta (o acerto sem uso, como na gravacao do turno que
  // falha) e fica nas reservas perdidas do turno (so auditoria); a
  // retentativa reserva de novo. Nada foi lido nem gravado da midia.
  if (prazoDoTurnoEm - c.deps.agora() < prazoMinimoDoTurno) {
    if (reservaId !== null) {
      const solta = await acertarGasto(admin, {
        reservaId,
        clinicId,
        origem: "whatsapp",
        usos: [],
        precos,
        conversationId: c.conversationId,
        jobId: c.job.id,
      });
      log.warn(solta ? "ia_reserva_solta" : "ia_reserva_orfa", {
        ...idsDoLog(c),
        status: "prazo_antes_do_laco",
      });
    }
    return { reagendar: agoraIso(c), motivo: "orcamento_da_passagem" };
  }

  // [AG6b mídia] início
  // A porta da midia so com audio a transcrever ou arquivo a ler (as
  // integracoes injetadas; a gravacao com a posse deste job).
  const portaDaMidia =
    comMidiaParaOModelo && c.deps.midia !== undefined
      ? c.deps.midia.criarPorta({
          clinicId,
          conversationId: c.conversationId,
          jobId: c.job.id,
          workerId: c.workerId,
          identificador,
          mascarar: (texto) => mascararNome(texto, contato.name),
        })
      : null;
  // [AG6b mídia] fim

  // 10. O turno.
  const inicio = c.deps.agora();
  let resultado: ResultadoDoTurno | null = null;
  try {
    resultado = await c.deps.executarTurno({
      cliente,
      modelo,
      clinicId,
      identificadorDeSeguranca: identificador,
      config,
      catalogo,
      // [AG6b mídia] as mensagens do turno (com a midia do plano)
      mensagens: mensagensDoTurno,
      agoraMs,
      fuso,
      verificador: c.deps.criarVerificador(identificador ?? ""),
      classificador: c.deps.criarClassificador(identificador ?? ""),
      dataDeNascimento: contato.birth_date,
      // [AG7 preparo] O nome da mascara do historico: o laco a refaz na fala
      // da clinica depois de trocar o texto do preparo (CFM-1).
      nomeDoContato: contato.name,
      contato: tipoDoContato,
      foraDoAssuntoNaJanela: foraDoAssunto,
      primeiraRespostaDaIa: !historico.iaRespondeuNaJanela,
      conferirTrava: () =>
        conferirTravaDoWhatsapp(admin, {
          clinicId,
          conversationId: c.conversationId,
          contactId: conversa.contact_id,
          whatsappAccountId: conversa.whatsapp_account_id,
          jobId: c.job.id,
          workerId: c.workerId,
          jobCriadoEm: c.job.created_at ?? "",
        }),
      agenda: portaDaAgendaDoWhatsapp(admin, {
        clinicId,
        conversationId: c.conversationId,
        contactId: conversa.contact_id,
        jobId: c.job.id,
        agora: c.deps.agora,
        // Revisao da revisao final da AG4 (o toque atrasado): as mensagens
        // que o job leu (a citacao da resposta e lida so nelas).
        mensagensLidas: historico.pendentes,
      }),
      atendimento,
      nascimentoInformado,
      modeloDosClassificadores,
      prazoMs: prazoDoTurno,
      // RR2 de 88e9560 (baixo 6): o instante da conta acima (a mesma
      // referencia do executor), nao o comeco do laco.
      prazoEmMs: prazoDoTurnoEm,
      agora: c.deps.agora,
      // [AG6b mídia]
      midia: portaDaMidia,
      // Revisao R3 de d1a15f6 (2): os tetos do leitor do plano e da reserva
      // tambem no corte da leitura pelo laco (uma fonte so).
      tetosDoLeitor: c.deps.midia?.tetosDoLeitor,
    });
  } catch {
    // O laco tem a propria rede; isto nao deveria acontecer. A reserva fica
    // inteira contando no teto (o lado seguro) e a conversa vai para a
    // equipe como falha tecnica.
    log.warn("ia_turno_excecao", idsDoLog(c));
  }
  const latenciaMs = c.deps.agora() - inicio;

  // 11. O gasto real.
  if (reservaId !== null && resultado !== null) {
    await acertarGasto(admin, {
      reservaId,
      clinicId,
      origem: "whatsapp",
      usos: resultado.uso,
      precos,
      conversationId: c.conversationId,
      jobId: c.job.id,
    });
    // [AG6b mídia] início
    // Desenho 5.3: o uso real com midia acima da reserva (o pior caso errou
    // para baixo) vira log, so com a contagem. O teto conta o real.
    if (comMidiaParaOModelo && reservado !== null) {
      const real = linhasDoUso({
        clinicId,
        origem: "whatsapp",
        usos: resultado.uso,
        precos,
      }).linhas.reduce((soma, linha) => soma + linha.custo_microdolar, 0);
      if (real > reservado) {
        log.warn("ia_midia_acima_da_reserva", {
          ...idsDoLog(c),
          count: resultado.uso.filter(
            (u) => u.papel === "transcricao" || u.papel === "leitor_de_midia",
          ).length,
        });
      }
    }
    // [AG6b mídia] fim
  }

  if (resultado === null) {
    return falharSemModelo(c, { ...base, reservaId }, destino, config);
  }
  // [AG6b mídia] início
  // Revisao da AG6b (D-A): a gravacao da leitura da midia disse job_antigo
  // (alguem assumiu e devolveu depois deste job). O gasto ja foi acertado
  // acima (a chamada saiu); o resto e o D-A de sempre: so conclui, sem
  // estado, decisao, passagem, evento, frase nem envio. O job da janela nova
  // cuida da conversa.
  if (resultado.jobAntigo === true) {
    return concluirJobAntigo(c, { ...base, reservaId });
  }
  // D-96: o que o turno deixou sem ler (a visao final do laco).
  c.midiaNaoLida = resultado.midiaNaoLida === true;
  // [AG6b mídia] fim

  // 11a. Revisao final da AG4 (M1 e B1): o turno parou pela mensagem nova
  // da pessoa (mensagem_nova_do_paciente). O estado NAO e gravado (nao
  // mudou; gravar o do comeco recarimbava o pedido vencido DEPOIS da
  // pergunta, e o job seguinte recebia sem_confirmacao_do_paciente) e o job
  // seguinte e garantido antes de fechar sem envio.
  if (resultado.mensagemNova === true) {
    return continuarDepoisDaMensagemNova(
      c,
      { ...base, reservaId },
      destino,
      config,
      resultado,
      latenciaMs,
    );
  }

  // 11b. (AG3) O estado novo, antes de decidir e enviar: o turno que nao
  // devolveu estado (nunca deveria) grava o lido, como esta.
  const gravacao = await gravarAtendimentoDaIa(admin, {
    clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    versao: lido.versao,
    estado: resultado.atendimento?.estado ?? lido.estado,
  });
  if (gravacao.tipo === "recusado" && gravacao.motivo === "sem_posse") {
    // Outro executor tem o job: ele faz o turno. Nada decidido, nada sai.
    return { ok: false, erro: "sem_posse" };
  }
  if (gravacao.tipo === "recusado" && gravacao.motivo === "job_antigo") {
    return concluirJobAntigo(c, { ...base, reservaId });
  }
  if (gravacao.tipo !== "gravado") {
    // fora_da_ia: a conversa saiu da IA no meio (sem frase). estado_mudou ou
    // erro: a resposta foi construida sobre um estado que ja nao e o do
    // banco; nao sai (a frase fixa e a equipe).
    resultado = comoFalha(
      resultado,
      gravacao.tipo === "recusado" && gravacao.motivo === "fora_da_ia"
        ? "liberacao_suspensa"
        : "desconhecida",
      PASSO_DO_ESTADO_NAO_GRAVADO,
    );
  }
  return decidirEEnviar(
    c,
    { ...base, reservaId },
    destino,
    config,
    resultado,
    latenciaMs,
  );
}

/** AG3: o passo da trilha quando o estado do atendimento nao foi lido. */
export const PASSO_DO_ESTADO_NAO_LIDO =
  "Não foi possível ler o andamento do atendimento desta conversa.";

/** AG3: o passo da trilha quando o estado novo nao foi gravado. */
export const PASSO_DO_ESTADO_NAO_GRAVADO =
  "O andamento do atendimento mudou ou não foi gravado: a resposta não foi enviada.";

/**
 * AG3: o turno vira falha (a resposta, se havia, nunca sai). Uma passagem
 * que ja ia acontecer (frase fixa) fica como esta: a conversa vai para a
 * equipe do mesmo jeito, com o motivo dela. Revisao final da AG4 (M1):
 * `forcar` vira falha tambem a frase fixa que nao ia sair (o turno parado
 * pela mensagem nova da pessoa, sem o job seguinte).
 */
function comoFalha(
  resultado: ResultadoDoTurno,
  motivo: FalhaDoAgente,
  passo: string,
  forcar = false,
): ResultadoDoTurno {
  const trilha = [
    ...resultado.trilha,
    { tipo: "outro" as const, texto: passo },
  ];
  if (
    !forcar &&
    resultado.tipo === "frase_fixa" &&
    motivo !== "liberacao_suspensa"
  ) {
    return { ...resultado, trilha };
  }
  return {
    ...resultado,
    mensagemNova: undefined,
    tipo: "frase_fixa",
    resposta: FRASE_DE_ESCALONAMENTO,
    rascunhoBloqueado: null,
    desfecho: { tipo: "falhou", motivo },
    trilha: [
      ...trilha,
      {
        tipo: "equipe",
        texto: `Passou para a equipe: ${TEXTO_DA_FALHA[motivo]}`,
      },
    ],
  };
}

/**
 * A reserva entra em ai_turno logo depois de feita. Se a gravacao do turno
 * falhar, a reserva nao pode ficar orfa somando no teto sem rastro de job
 * (revisao do E3): e solta (acerto sem uso) e o job volta para a fila. Se
 * nem soltar der, fica o log com o job (a reserva continua contando no
 * teto, o lado seguro).
 */
async function salvarTurnoComReserva(
  c: Contexto,
  turno: TurnoDaIa,
  precos: Awaited<ReturnType<typeof lerPrecos>>,
): Promise<void> {
  try {
    await salvarTurno(c.admin, turno);
  } catch (erro) {
    if (turno.reservaId !== null) {
      const solta = await acertarGasto(c.admin, {
        reservaId: turno.reservaId,
        clinicId: c.clinicId,
        origem: "whatsapp",
        usos: [],
        precos,
        conversationId: c.conversationId,
        jobId: c.job.id,
      });
      log.warn(solta ? "ia_reserva_solta" : "ia_reserva_orfa", {
        ...idsDoLog(c),
        status: "turno_nao_gravado",
      });
    }
    throw erro;
  }
}

/**
 * D-A: o job e anterior a janela atual. So conclui: o turno pendente fecha
 * sem envio (o texto sai da linha) e nada mais e tocado (sem passagem, sem
 * evento, sem frase, sem mexer na espera nem nos jobs da sessao nova).
 */
async function concluirJobAntigo(
  c: Contexto,
  turnoAtual: TurnoDaIa | null,
): Promise<ResultadoDeJob> {
  log.info("ia_job_anterior_a_janela", idsDoLog(c));
  if (
    turnoAtual !== null &&
    (turnoAtual.estado === "reservado" || turnoAtual.estado === "decidido")
  ) {
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "sem_envio",
    });
  }
  return CONCLUIR;
}

// ---------------------------------------------------------------------------
// A mensagem nova da pessoa (revisao final da AG4, M1 e B1)
// ---------------------------------------------------------------------------

/**
 * Revisao final da AG4 (M1): quantas vezes SEGUIDAS o turno pode parar pela
 * mensagem nova da pessoa e deixar a resposta para o job seguinte. A
 * contagem vai no payload do job seguinte (CHAVE_DAS_CONTINUACOES); no
 * limite, a falha normal (a frase fixa e a equipe), nunca um laco de jobs
 * que nao respondem.
 *
 * Revisao da revisao final da AG4 (27/10/2026): so conta a continuacao em
 * que a fila CRIOU o job seguinte (enfileirado: nenhum job da mensagem nova
 * pelo webhook, o laco que pode girar sem nada da pessoa, como a mensagem
 * que o interceptador tratou). No "juntou" a pessoa escreveu de novo pelo
 * webhook (atividade dela): o job dela fica como o webhook o deixou, sem a
 * contagem herdada.
 */
export const MAXIMO_DE_CONTINUACOES_DA_MENSAGEM_NOVA = 2;

/** A chave do payload de responder_com_ia com a contagem (M1). */
export const CHAVE_DAS_CONTINUACOES = "continuacoes_da_mensagem_nova";

/** M1: o passo da trilha quando o limite das continuacoes chegou. */
export const PASSO_DA_MENSAGEM_NOVA_NO_LIMITE =
  "A pessoa mandou outra mensagem enquanto o assistente respondia, várias vezes seguidas: a conversa passou para a equipe.";

/** M1: o passo da trilha quando a proxima resposta nao ficou na fila. */
export const PASSO_DA_MENSAGEM_NOVA_SEM_FILA =
  "Não foi possível deixar a próxima resposta na fila depois da mensagem nova da pessoa.";

/** M1: o passo da trilha quando a conversa saiu do assistente no meio. */
export const PASSO_DA_MENSAGEM_NOVA_FORA_DA_IA =
  "A conversa saiu do assistente antes da próxima resposta.";

/**
 * Os codigos de enfileirar_resposta_da_ia que dizem que a IA nao pode mais
 * responder esta conversa: a conversa saiu da IA, a clinica saiu da fase, a
 * janela nao confere ou a liberacao caiu.
 */
const FILA_FORA_DA_IA: ReadonlySet<string> = new Set([
  "conversa_fora_da_ia",
  "fora_da_fase",
  "janela_invalida",
  "nao_liberada",
]);

/**
 * A contagem do job. Sem a chave: 0. Valor que nao e inteiro de 0 em
 * diante: o limite (falha fechada; so o executor grava a chave).
 */
export function continuacoesDoJob(payload: Record<string, unknown>): number {
  const valor = payload[CHAVE_DAS_CONTINUACOES];
  if (valor === undefined) {
    return 0;
  }
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0
    ? valor
    : MAXIMO_DE_CONTINUACOES_DA_MENSAGEM_NOVA;
}

type JobSeguinte =
  | { tipo: "garantido"; codigo: "enfileirado" | "juntou" }
  | { tipo: "nada_a_responder" }
  | { tipo: "fora_da_ia"; codigo: string }
  | { tipo: "falhou"; codigo: string };

/**
 * Revisao final da AG4 (M1 e B1): o turno parou pela mensagem nova da
 * pessoa. Nada sai e o estado nao e gravado (nao mudou). A conversa nunca
 * fica calada: o job seguinte e garantido pela MESMA RPC do webhook
 * (enfileirar_resposta_da_ia, que confere a fase, a conversa na IA, a
 * mensagem, a janela e a liberacao, e junta com o job pendente que ja
 * existir: o da mensagem nova que veio pelo webhook). Ela cria o job quando
 * nao ha nenhum: a mensagem que o interceptador tratou (botao ou eco, sem
 * turno) e a lida que a pessoa apagou. Com a contagem no limite, ou sem
 * conseguir a fila, a falha normal (a frase fixa e a equipe); com a
 * conversa fora da IA, a passagem sem frase (como a liberacao que cai).
 *
 * Sem o gravar do estado, este caminho confere o que ele conferia: a posse
 * do job (outro executor com ele: nada decidido, o job volta) e o D-A (o
 * job anterior a janela atual so conclui: nada de fila na sessao nova).
 */
async function continuarDepoisDaMensagemNova(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  config: ConfigDoAgente,
  resultado: ResultadoDoTurno,
  latenciaMs: number,
): Promise<ResultadoDeJob> {
  if (!(await confirmarPosse(c.admin, c.job.id, c.workerId))) {
    return { ok: false, erro: "sem_posse" };
  }
  let janela: JanelaDaConversa | null = null;
  let janelaLida = true;
  try {
    janela = await lerJanela(c.admin, c.clinicId, c.conversationId);
  } catch {
    janelaLida = false;
  }
  if (jobAnteriorAJanela(janela, c.job.created_at)) {
    return concluirJobAntigo(c, turno);
  }
  const feitas = continuacoesDoJob(c.job.payload);
  if (feitas >= MAXIMO_DE_CONTINUACOES_DA_MENSAGEM_NOVA) {
    log.warn("ia_mensagem_nova_no_limite", { ...idsDoLog(c), count: feitas });
    return decidirEEnviar(
      c,
      turno,
      destino,
      config,
      comoFalha(resultado, "desconhecida", PASSO_DA_MENSAGEM_NOVA_NO_LIMITE, true),
      latenciaMs,
    );
  }
  const seguinte: JobSeguinte = !janelaLida
    ? { tipo: "falhou", codigo: "leitura_falhou" }
    : janela === null
      ? { tipo: "fora_da_ia", codigo: "janela_invalida" }
      : await garantirOJobSeguinte(c, janela, feitas + 1);
  if (seguinte.tipo === "garantido") {
    // Revisao da revisao final da AG4: a contagem so sobe quando a fila
    // criou o job (enfileirado); no "juntou" o job e o da pessoa (webhook).
    log.info("ia_mensagem_nova_continua", {
      ...idsDoLog(c),
      status: seguinte.codigo,
      count: seguinte.codigo === "enfileirado" ? feitas + 1 : 0,
    });
    return decidirEEnviar(c, turno, destino, config, resultado, latenciaMs);
  }
  if (seguinte.tipo === "nada_a_responder") {
    // A pessoa apagou tudo o que tinha mandado: nada a responder (como o
    // job sem pendente). Fecha sem envio.
    log.info("ia_mensagem_nova_continua", {
      ...idsDoLog(c),
      status: seguinte.tipo,
    });
    return decidirEEnviar(c, turno, destino, config, resultado, latenciaMs);
  }
  if (seguinte.tipo === "fora_da_ia") {
    log.info("ia_mensagem_nova_fora_da_ia", {
      ...idsDoLog(c),
      status: seguinte.codigo,
    });
    return decidirEEnviar(
      c,
      turno,
      destino,
      config,
      comoFalha(resultado, "liberacao_suspensa", PASSO_DA_MENSAGEM_NOVA_FORA_DA_IA),
      latenciaMs,
    );
  }
  log.warn("ia_mensagem_nova_sem_fila", {
    ...idsDoLog(c),
    error_code: seguinte.codigo,
  });
  return decidirEEnviar(
    c,
    turno,
    destino,
    config,
    comoFalha(resultado, "desconhecida", PASSO_DA_MENSAGEM_NOVA_SEM_FILA, true),
    latenciaMs,
  );
}

/**
 * A ultima mensagem do paciente da janela (a mesma regra do historico: so
 * a janela, menos a aberta pela ingestao, que le a conversa inteira), nao
 * apagada. null: nenhuma (a pessoa apagou tudo: nada a responder). Lanca na
 * leitura que falha.
 */
async function ultimaMensagemDoPaciente(
  c: Contexto,
  janela: JanelaDaConversa,
): Promise<string | null> {
  let consulta = c.admin
    .from("message")
    .select("id")
    .eq("clinic_id", c.clinicId)
    .eq("conversation_id", c.conversationId)
    .eq("direction", "entrada")
    .eq("author", "paciente")
    .is("deleted_at", null);
  if (janela.abertaPor !== "ingestao") {
    consulta = consulta.gte("created_at", janela.desde);
  }
  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error("leitura");
  }
  const id = ((data ?? []) as { id?: unknown }[])[0]?.id;
  return typeof id === "string" ? id : null;
}

/**
 * Pede o job seguinte a enfileirar_resposta_da_ia com a ultima mensagem do
 * paciente e marca a contagem nele. A mensagem apagada entre a leitura e a
 * fila (mensagem_invalida) e lida de novo uma vez. Nunca lanca.
 *
 * Revisao da revisao final da AG4: so o job que a fila criou (enfileirado)
 * leva a contagem. O "juntou" e o job pendente da mensagem nova que veio
 * pelo webhook (a pessoa escreveu de novo): ele fica sem a marca, e a
 * contagem recomeca nele (o laco sem nada da pessoa so existe no
 * enfileirado).
 */
async function garantirOJobSeguinte(
  c: Contexto,
  janela: JanelaDaConversa,
  continuacoes: number,
): Promise<JobSeguinte> {
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    let mensagemId: string | null;
    try {
      mensagemId = await ultimaMensagemDoPaciente(c, janela);
    } catch {
      return { tipo: "falhou", codigo: "leitura_falhou" };
    }
    if (mensagemId === null) {
      return { tipo: "nada_a_responder" };
    }
    let resposta: { data: unknown; error: { code?: string } | null };
    try {
      resposta = await c.admin.rpc("enfileirar_resposta_da_ia", {
        p_clinic_id: c.clinicId,
        p_conversation_id: c.conversationId,
        p_message_id: mensagemId,
        p_incluir_teste: c.deps.incluirClinicasDeTeste === true,
      });
    } catch {
      return { tipo: "falhou", codigo: "excecao" };
    }
    if (resposta.error) {
      return { tipo: "falhou", codigo: resposta.error.code ?? "erro" };
    }
    const dados = resposta.data as { codigo?: unknown; job_id?: unknown } | null;
    const codigo = typeof dados?.codigo === "string" ? dados.codigo : "";
    if (
      (codigo === "enfileirado" || codigo === "juntou") &&
      typeof dados?.job_id === "string" &&
      UUID.test(dados.job_id)
    ) {
      if (codigo === "enfileirado") {
        await marcarAsContinuacoes(c, dados.job_id, continuacoes);
      }
      return { tipo: "garantido", codigo };
    }
    if (codigo === "mensagem_invalida") {
      continue;
    }
    if (FILA_FORA_DA_IA.has(codigo)) {
      return { tipo: "fora_da_ia", codigo };
    }
    return { tipo: "falhou", codigo: codigo || "resposta_fora_do_formato" };
  }
  return { tipo: "falhou", codigo: "mensagem_invalida" };
}

/**
 * Grava a contagem no payload do job seguinte (o que a fila acabou de criar;
 * revisao da revisao final da AG4: nunca o pendente com que juntou).
 * Concorrencia otimista pelo updated_at: o webhook pode juntar outra
 * mensagem no meio (ele so troca a ultima_mensagem_id); a gravacao que nao
 * acha a linha le de novo. O maior valor fica. O job seguinte nao roda
 * enquanto este executa (ia_jobs_devidos: um por conversa). Nunca lanca:
 * sem a marca, fica o log (a contagem recomeca no job seguinte, o lado do
 * atendimento).
 */
async function marcarAsContinuacoes(
  c: Contexto,
  jobId: string,
  continuacoes: number,
): Promise<void> {
  try {
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const lido = await c.admin
        .from("job_queue")
        .select("payload, updated_at")
        .eq("clinic_id", c.clinicId)
        .eq("id", jobId)
        .eq("kind", "responder_com_ia")
        .eq("status", "pendente")
        .maybeSingle();
      const linha = lido.data as {
        payload?: unknown;
        updated_at?: unknown;
      } | null;
      if (
        lido.error ||
        linha === null ||
        typeof linha.payload !== "object" ||
        linha.payload === null ||
        Array.isArray(linha.payload) ||
        typeof linha.updated_at !== "string"
      ) {
        break;
      }
      const payload = linha.payload as Record<string, unknown>;
      const antes = payload[CHAVE_DAS_CONTINUACOES];
      const novo = {
        ...payload,
        [CHAVE_DAS_CONTINUACOES]: Math.max(
          continuacoes,
          typeof antes === "number" && Number.isInteger(antes) ? antes : 0,
        ),
      };
      const gravado = await c.admin
        .from("job_queue")
        .update({ payload: novo })
        .eq("clinic_id", c.clinicId)
        .eq("id", jobId)
        .eq("status", "pendente")
        .eq("updated_at", linha.updated_at)
        .select("id");
      if (gravado.error) {
        break;
      }
      if (((gravado.data ?? []) as unknown[]).length > 0) {
        return;
      }
    }
  } catch {
    // Cai no log abaixo.
  }
  log.warn("ia_mensagem_nova_contagem_nao_marcada", {
    ...idsDoLog(c),
    count: continuacoes,
  });
}

// ---------------------------------------------------------------------------
// Decisao e saida
// ---------------------------------------------------------------------------

type Destino = { contactId: string; whatsappAccountId: string };

/** O motivo do evento de passagem para cada desfecho que nao respondeu. */
function motivoDaPassagem(desfecho: DesfechoDoTurno): MotivoDoEventoDaIa {
  switch (desfecho.tipo) {
    case "escalou":
      return desfecho.motivo;
    case "bloqueou":
      return "conformidade";
    default:
      return "falha_tecnica";
  }
}

async function decidirEEnviar(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  config: ConfigDoAgente,
  resultado: ResultadoDoTurno,
  latenciaMs: number,
): Promise<ResultadoDeJob> {
  // [AG7 preparo] início
  if (resultado.tipo === "preparo") {
    return decidirEEnviarOPreparo(
      c,
      turno,
      destino,
      config,
      resultado,
      latenciaMs,
    );
  }
  // [AG7 preparo] fim
  const desfecho = resultado.desfecho;
  const textoSha256 =
    resultado.tipo === "resposta" ? sha256DoTexto(resultado.resposta) : null;

  // 12. A decisao ANTES de qualquer envio (o gatilho de message a le).
  const decisionId = await gravarDecisao(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    desfecho,
    textoSha256,
    filtro: resultado.filtro,
    trilha: resultado.trilha,
    uso: resultado.uso,
    versaoDoPrompt: resultado.versaoDoPrompt,
    configVersion: config.versao,
    latenciaMs,
    ferramentasUsadas: resultado.ferramentasUsadas ?? [],
    // [AG7 preparo] A versao da variante do classificador do turno.
    versaoDoClassificador: resultado.versaoDoClassificador,
  });
  if (desfecho.tipo === "bloqueou" && resultado.rascunhoBloqueado !== null) {
    await gravarRascunhoBloqueado(c.admin, {
      clinicId: c.clinicId,
      decisionId,
      conversationId: c.conversationId,
      jobId: c.job.id,
      texto: resultado.rascunhoBloqueado,
    });
  }
  log.info("ia_turno_decidido", {
    ...idsDoLog(c),
    status: desfecho.tipo,
    kind:
      desfecho.tipo === "escalou"
        ? desfecho.motivo
        : desfecho.tipo === "falhou"
          ? desfecho.motivo
          : desfecho.tipo === "bloqueou"
            ? desfecho.categoria
            : undefined,
    duration_ms: latenciaMs,
    count: resultado.uso.length,
  });

  if (resultado.tipo === "resposta") {
    await salvarTurno(c.admin, {
      ...turno,
      estado: "decidido",
      saida: "resposta",
      texto: resultado.resposta,
      textoSha256,
      decisionId,
    });
    // [AG7 preparo] O despacho generico (a resposta ou o preparo).
    return enviarResposta(
      c,
      destino,
      { tipo: "resposta", texto: resultado.resposta },
      decisionId,
    );
  }

  // A liberacao caiu no meio (Assumir, interruptor, telefone desligado,
  // janela trocada): NADA e enviado. Se a conversa ainda estiver na IA,
  // volta para a equipe com o evento. O turno fica 'decidido' com a saida
  // 'nenhuma' ate a passagem dar certo: se ela falhar, a retentativa passa
  // de novo (nunca conclui com a conversa presa na IA).
  if (desfecho.tipo === "falhou" && desfecho.motivo === "liberacao_suspensa") {
    await salvarTurno(c.admin, {
      ...turno,
      estado: "decidido",
      saida: "nenhuma",
      decisionId,
    });
    return passarSemFraseDepoisDeDecidir(c, "liberacao_perdida");
  }
  if (desfecho.tipo === "falhou" && desfecho.motivo === "sem_mensagem") {
    await salvarTurno(c.admin, {
      ...turno,
      estado: "sem_envio",
      saida: "nenhuma",
      decisionId,
    });
    return CONCLUIR;
  }

  await salvarTurno(c.admin, {
    ...turno,
    estado: "decidido",
    saida: "frase",
    decisionId,
  });
  return passarEAvisar(
    c,
    destino,
    motivoDaPassagem(desfecho),
    false,
    resultado.notaParaAEquipe ?? null,
  );
}

// [AG7 preparo] início
/**
 * AG7 (contrato, secao 3.1, EXEC): o turno escolheu enviar a orientacao de
 * preparo. Nesta ordem:
 *  1. ler_preparo_para_envio da versao do turno (a ultima versao publicada
 *     com a habilidade) e aprovarParaEnvio (o hash e o formato);
 *  2. nulo: a versao saiu de vigor entre o catalogo e a decisao. A decisao
 *     vira 'escalou' com assunto_clinico (origem "sistema", nunca atribui) e
 *     o passo; o turno 'decidido' com a frase; a passagem e a frase;
 *  3. senao: a decisao 'enviou_preparo' (a versao e o hash da mensagem que
 *     o banco montou) ANTES do envio (o gatilho de message a le), o turno
 *     'decidido' com a saida 'preparo' (sem texto) e o envio.
 * Erro da leitura: o job tenta de novo (leitura_falhou), como toda leitura.
 */
async function decidirEEnviarOPreparo(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  config: ConfigDoAgente,
  resultado: Extract<ResultadoDoTurno, { tipo: "preparo" }>,
  latenciaMs: number,
): Promise<ResultadoDeJob> {
  const leitura = await lerOuFalhar(() =>
    lerPreparoParaEnvio(c.admin, {
      clinicId: c.clinicId,
      versaoId: resultado.preparo.versaoId,
      procedimentoId: resultado.preparo.procedimentoId,
    }),
  );
  const comum = {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    filtro: null,
    uso: resultado.uso,
    versaoDoPrompt: resultado.versaoDoPrompt,
    configVersion: config.versao,
    latenciaMs,
    ferramentasUsadas: resultado.ferramentasUsadas ?? [],
    versaoDoClassificador: resultado.versaoDoClassificador,
  };
  // Revisao da AG7 (CFM-2): o texto aprovado com recusa (promessa, oferta
  // casada, antes e depois, preco, link) nunca sai. A decisao e um bloqueio
  // da conformidade (camada regra, a primeira categoria), com o passo so
  // com os rotulos; a passagem e a frase. Nada do texto em log nem na
  // decisao.
  if (leitura.tipo === "recusado") {
    const [categoria = "orientacao_clinica"] = leitura.recusas;
    const decisionId = await gravarDecisao(c.admin, {
      ...comum,
      desfecho: {
        tipo: "bloqueou",
        categoria,
        camada: "regra",
        motivoDaFalha: null,
      },
      textoSha256: null,
      trilha: [
        ...resultado.trilha,
        { tipo: "bloqueio", texto: passoDoPreparoRecusado(leitura.recusas) },
        {
          tipo: "equipe",
          texto: `Passou para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.conformidade}`,
        },
      ],
    });
    log.warn("ia_preparo_recusado", {
      ...idsDoLog(c),
      kind: leitura.recusas.join(","),
    });
    log.info("ia_turno_decidido", {
      ...idsDoLog(c),
      status: "bloqueou",
      kind: categoria,
      duration_ms: latenciaMs,
      count: resultado.uso.length,
    });
    await salvarTurno(c.admin, {
      ...turno,
      estado: "decidido",
      saida: "frase",
      decisionId,
    });
    // MOTOR-7: a nota da AG3 da passagem, como em toda passagem do turno.
    return passarEAvisar(
      c,
      destino,
      "conformidade",
      false,
      resultado.notasSeOPreparoNaoSair?.conformidade ?? null,
    );
  }
  if (leitura.tipo === "fora_de_vigor") {
    const decisionId = await gravarDecisao(c.admin, {
      ...comum,
      desfecho: {
        tipo: "escalou",
        motivo: "assunto_clinico",
        gatilho: null,
        origem: "sistema",
      },
      textoSha256: null,
      trilha: [
        ...resultado.trilha,
        { tipo: "cadastro", texto: PASSO_DO_PREPARO_FORA_DE_VIGOR },
        {
          tipo: "equipe",
          texto: `Passou para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.assunto_clinico}`,
        },
      ],
    });
    log.info("ia_turno_decidido", {
      ...idsDoLog(c),
      status: "escalou",
      kind: "assunto_clinico",
      duration_ms: latenciaMs,
      count: resultado.uso.length,
    });
    await salvarTurno(c.admin, {
      ...turno,
      estado: "decidido",
      saida: "frase",
      decisionId,
    });
    // Revisao da AG7 (MOTOR-7): a nota da AG3 da passagem (procedimento,
    // profissional, reserva, lista de espera), como na passagem pela
    // ferramenta.
    return passarEAvisar(
      c,
      destino,
      "assunto_clinico",
      false,
      resultado.notasSeOPreparoNaoSair?.assunto_clinico ?? null,
    );
  }
  const preparo = leitura.preparo;
  const decisionId = await gravarDecisao(c.admin, {
    ...comum,
    desfecho: resultado.desfecho,
    textoSha256: preparo.sha256,
    trilha: resultado.trilha,
  });
  log.info("ia_turno_decidido", {
    ...idsDoLog(c),
    status: "enviou_preparo",
    duration_ms: latenciaMs,
    count: resultado.uso.length,
  });
  await salvarTurno(c.admin, {
    ...turno,
    estado: "decidido",
    saida: "preparo",
    texto: null,
    textoSha256: preparo.sha256,
    decisionId,
  });
  return enviarResposta(c, destino, { tipo: "preparo", preparo }, decisionId);
}
// [AG7 preparo] fim

/**
 * Teto de respostas ou de gasto: a decisao (escalou) e gravada para toda
 * frase ter registro, a conversa passa para a equipe e a frase sai, sem
 * chamar modelo nenhum.
 */
async function escalarSemModelo(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  motivo: Extract<MotivoDeEscalonamento, "teto_de_respostas" | "teto_atingido">,
  config: ConfigDoAgente,
): Promise<ResultadoDeJob> {
  const decisionId = await gravarDecisao(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    desfecho: { tipo: "escalou", motivo, gatilho: null, origem: "portao" },
    textoSha256: null,
    filtro: null,
    trilha: [
      {
        tipo: "equipe",
        texto: `Passou para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[motivo]}`,
      },
    ],
    uso: [],
    versaoDoPrompt: VERSAO_DO_PROMPT,
    configVersion: config.versao,
    latenciaMs: null,
  });
  await salvarTurno(c.admin, {
    ...turno,
    estado: "decidido",
    saida: "frase",
    decisionId,
  });
  return passarEAvisar(c, destino, motivo);
}

/**
 * Falha tecnica sem chamada ao modelo (preco ausente, excecao inesperada
 * do turno): decisao 'falhou', passagem com o evento de falha tecnica e a
 * frase.
 */
async function falharSemModelo(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  config: ConfigDoAgente,
  /** AG3: o que deu errado, em texto de recepcao (o estado, por exemplo). */
  passo: string | null = null,
): Promise<ResultadoDeJob> {
  const decisionId = await gravarDecisao(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    desfecho: { tipo: "falhou", motivo: "desconhecida" },
    textoSha256: null,
    filtro: null,
    trilha: [
      ...(passo === null ? [] : [{ tipo: "outro" as const, texto: passo }]),
      {
        tipo: "equipe",
        texto: `Passou para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.falha_tecnica}`,
      },
    ],
    uso: [],
    versaoDoPrompt: VERSAO_DO_PROMPT,
    configVersion: config.versao,
    latenciaMs: null,
  });
  await salvarTurno(c.admin, {
    ...turno,
    estado: "decidido",
    saida: "frase",
    decisionId,
  });
  return passarEAvisar(c, destino, "falha_tecnica");
}

// [AG6 urgência] início
/**
 * AG6a (7c): algum texto ORIGINAL das pendentes (o texto do paciente, sem a
 * mascara do nome, e a legenda que ele escreveu na midia), sozinho ou na
 * juncao deles na ordem ("to com dor" e "no peito"; revisao de
 * 28/10/2026), traz um sinal de emergencia da lista deterministica
 * (urgencia.ts). Local, sem rede; nada vai para log.
 */
function urgenciaNasPendentes(
  mensagens: readonly MensagemDaConversa[],
): boolean {
  return (
    detectarUrgencia(
      mensagensPendentes(mensagens).map((m) =>
        (m.tipo ?? "texto") === "texto"
          ? (m.textoOriginal ?? m.texto)
          : (m.legendaOriginal ?? null),
      ),
    ) !== null
  );
}

/**
 * AG6a (7c): a urgencia, sem modelo nenhum e antes do teto e da reserva. A
 * decisao (escalou, motivo e gatilho urgencia, origem portao, sem uso) e
 * gravada ANTES da passagem, como em toda frase; a passagem nunca atribui
 * (D-54: a fila de todos) e o banco marca a conversa (conversa_urgente). O
 * contato recebe a frase de SEMPRE (a do 192 e da AG6c). A retomada em
 * 'decidido' le o motivo urgencia da decisao e passa do mesmo jeito.
 */
async function passarPorUrgencia(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
  config: ConfigDoAgente,
): Promise<ResultadoDeJob> {
  const decisionId = await gravarDecisao(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    desfecho: {
      tipo: "escalou",
      motivo: "urgencia",
      gatilho: "urgencia",
      origem: "portao",
    },
    textoSha256: null,
    filtro: null,
    trilha: [
      { tipo: "outro", texto: PASSO_DA_CONFERENCIA_DA_ENTRADA },
      { tipo: "equipe", texto: PASSO_DA_URGENCIA },
    ],
    uso: [],
    versaoDoPrompt: VERSAO_DO_PROMPT,
    configVersion: config.versao,
    latenciaMs: null,
  });
  await salvarTurno(c.admin, {
    ...turno,
    estado: "decidido",
    saida: "frase",
    decisionId,
  });
  log.info("ia_turno_decidido", {
    ...idsDoLog(c),
    status: "escalou",
    kind: "urgencia",
    count: 0,
  });
  return passarEAvisar(c, destino, "urgencia");
}
// [AG6 urgência] fim

// [AG6 passagem] início
/**
 * AG6a: as regras da passagem para pedir a atribuicao. O turno que leu a
 * versao publicada ja as tem (passo 6); a retomada le agora (a ultima
 * publicada, a mesma que o banco confere). Leitura que falha: a fila (o lado
 * seguro; a frase ja foi tentada), com o log.
 */
async function regrasParaAPassagem(
  c: Contexto,
): Promise<RegrasDaPassagem | null> {
  if (c.regras !== undefined) {
    return c.regras;
  }
  try {
    const publicada = await carregarConfigPublicada(c.admin, c.clinicId);
    c.regras = publicada?.regras ?? null;
  } catch {
    c.regras = null;
    log.warn("ia_regra_da_passagem_nao_lida", idsDoLog(c));
  }
  return c.regras;
}

/**
 * Abaixo disto de prazo depois da frase, a atribuicao nem e tentada: a
 * conversa fica na fila (o lado seguro), com o log "sem_tempo".
 */
export const PRAZO_MINIMO_DA_ATRIBUICAO_MS = 1_000;

/**
 * AG6a (contrato do banco, Revisao R1.3): DEPOIS da tentativa da frase (saiu
 * ou nao, inclusive depois do evento "O aviso automático ao contato não foi
 * enviado."), a conversa que este job passou COM a frase vai ao responsavel
 * do lead: so quando o motivo pode atribuir (nunca a urgencia, o fora do
 * horario e, pela Revisao R2 do contrato do banco, o sintoma, o assunto
 * clinico, a midia e a conformidade: MOTIVOS_QUE_NUNCA_ATRIBUEM; nesses a
 * chamada nem sai e a regra nem e lida) e a regra da versao publicada e
 * "responsavel_do_lead" (pedirAtribuicaoNaPassagem). Quem chama garante que a passagem deste job
 * devolveu "passou" com a frase (passarEAvisar, os tetos e a falha sem
 * modelo) ou que o turno ja esta 'passou_para_equipe' com a saida 'frase'
 * (a retomada); nunca na passagem sem frase nem no "ja_fora_da_ia" (outro
 * caminho tirou a conversa da IA). O banco confere tudo de novo
 * (atribuir_conversa_passada_pela_ia). Nunca lanca e nunca muda o resultado
 * do job: recusa, erro, rede, prazo ou a funcao ausente (PGRST202) so
 * deixam o log com ids e o codigo, e a conversa fica na fila.
 */
async function atribuirDepoisDaFrase(
  c: Contexto,
  motivo: MotivoDoEventoDaIa,
): Promise<void> {
  if (!motivoPodeAtribuir(motivo)) {
    return;
  }
  if (!pedirAtribuicaoNaPassagem(motivo, await regrasParaAPassagem(c))) {
    return;
  }
  // [AG6b mídia] início
  // AG6b (D-96): com midia do paciente que o assistente nao leu (o audio que
  // ninguem ouviu pode ser uma emergencia), a conversa fica na fila de
  // todos: a chamada nem sai (o banco recusa de qualquer jeito,
  // midia_nao_lida).
  if (c.midiaNaoLida === true) {
    log.info("ia_atribuicao_da_ia", { ...idsDoLog(c), status: "midia_nao_lida" });
    return;
  }
  // [AG6b mídia] fim
  const restante = restanteMs(c);
  if (restante < PRAZO_MINIMO_DA_ATRIBUICAO_MS) {
    log.warn("ia_atribuicao_falhou", {
      ...idsDoLog(c),
      error_code: "sem_tempo",
    });
    return;
  }
  await atribuirConversaPassadaPelaIa(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    jobId: c.job.id,
    workerId: c.workerId,
    prazoMs: Math.min(PRAZO_DA_TRAVA_MS, restante),
  });
}

/**
 * AG6a: a retomada do turno 'passou_para_equipe' (a passagem ja aconteceu e
 * a frase nao se repete). Sem a frase deste job na conversa, o evento do
 * aviso nao enviado, como antes, e nada de atribuicao: o turno tambem fica
 * 'passou_para_equipe' quando a passagem devolveu "ja_fora_da_ia" (outro
 * caminho tirou a conversa da IA) e a tentativa caiu antes de concluir, e
 * so a frase que saiu prova que a passagem foi DESTE job (ela so sai depois
 * de "passou"). Com a frase que saiu e a saida 'frase', a atribuicao que a
 * tentativa anterior pode nao ter feito (caiu entre a frase e a
 * atribuicao). A saida 'resposta' (a retomada recusada, passada sem frase)
 * nunca atribui. Leitura do motivo que falha: a fila, so o log.
 */
async function retomarAPassagem(
  c: Contexto,
  turno: TurnoDaIa,
): Promise<ResultadoDeJob> {
  if (!(await avisoDaFraseNaRetomada(c)) || turno.saida !== "frase") {
    return CONCLUIR;
  }
  let motivo: MotivoDoEventoDaIa;
  try {
    motivo = await motivoDaDecisao(c, turno.decisionId);
  } catch {
    log.warn("ia_atribuicao_falhou", {
      ...idsDoLog(c),
      error_code: "motivo_nao_lido",
    });
    return CONCLUIR;
  }
  await atribuirDepoisDaFrase(c, motivo);
  return CONCLUIR;
}
// [AG6 passagem] fim

/**
 * A passagem do job, com D-A conferido aqui tambem (o banco confere de
 * novo): job anterior a janela atual devolve "job_antigo" sem chamar a
 * passagem. Lanca ErroComCodigoDeJob se a janela nao puder ser lida (o job
 * tenta de novo; o turno continua onde estava).
 *
 * [AG6 passagem] AG6a (Revisao R1.1): sempre os tres parametros; a passagem
 * nunca atribui (a atribuicao vem depois da frase, atribuirDepoisDaFrase).
 *
 * [AG6 urgência] A passagem por urgencia que passou SEM a marca (o banco
 * devolveu `urgente: false`: a gravacao em conversa_urgente falhou e virou
 * WARNING la dentro) deixa o aviso no log, so com os ids e o codigo
 * (revisao de 28/10/2026). A passagem vale do mesmo jeito: a conversa esta
 * na fila e a frase sai; so a marca Urgente falta.
 */
async function passarDoJob(
  c: Contexto,
  motivo: MotivoDoEventoDaIa,
): Promise<ResultadoDaPassagem> {
  const janela = await lerJanela(c.admin, c.clinicId, c.conversationId);
  if (jobAnteriorAJanela(janela, c.job.created_at)) {
    log.info("ia_job_anterior_a_janela", idsDoLog(c));
    return "job_antigo";
  }
  const passagem = await passarParaAEquipe(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    workerId: c.workerId,
    motivo,
  });
  // [AG6 urgência] início
  if (
    motivo === "urgencia" &&
    passagem.resultado === "passou" &&
    !passagem.urgente
  ) {
    log.warn("ia_urgencia_sem_marca", {
      ...idsDoLog(c),
      error_code: "marca_nao_gravada",
    });
  }
  // [AG6 urgência] fim
  return passagem.resultado;
}

/**
 * A passagem e, so se ela aconteceu AGORA, a frase fixa. Tentativa unica:
 * slot adiado ou qualquer falha da frase grava o evento "O aviso automatico
 * ao contato nao foi enviado." e o job conclui (nunca reagenda: a conversa
 * ja saiu da IA). Na RETOMADA de um turno 'decidido' com a frase, a
 * conversa ja fora da IA pode ser a passagem da tentativa que caiu antes de
 * fechar o turno: sem a frase na linha do job, fica o evento do aviso.
 *
 * [AG6 passagem] AG6a: so a passagem que aconteceu AGORA ("passou"), depois
 * da tentativa da frase, pode levar a conversa ao responsavel do lead
 * (atribuirDepoisDaFrase). O "ja_fora_da_ia" nunca atribui.
 */
async function passarEAvisar(
  c: Contexto,
  destino: Destino,
  motivo: MotivoDoEventoDaIa,
  retomada = false,
  /**
   * AG3 (item 8): a nota interna para a equipe, so quando a passagem
   * acontece AGORA (a retomada nao tem a nota: fica so o evento).
   */
  nota: string | null = null,
): Promise<ResultadoDeJob> {
  const passagem = await passarDoJob(c, motivo);
  if (passagem === "sem_posse") {
    return { ok: false, erro: "sem_posse" };
  }
  if (passagem === "erro") {
    // O turno continua 'decidido' com a saida 'frase': a proxima tentativa
    // passa de novo (o motivo vem da decisao gravada).
    throw new ErroComCodigoDeJob("passagem_falhou");
  }
  if (passagem === "job_antigo") {
    // D-A: nada de frase nem de evento na sessao nova.
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "sem_envio",
    });
    return CONCLUIR;
  }
  await fecharTurno(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    estado: "passou_para_equipe",
  });
  if (passagem === "ja_fora_da_ia") {
    // Alguem assumiu (ou o servidor tirou) antes: a frase nao sai. Na
    // retomada, a passagem pode ter sido a desta mesma tentativa anterior.
    if (retomada) {
      return retomarAvisoDaFrase(c);
    }
    return CONCLUIR;
  }
  if (nota !== null) {
    // Nunca lanca: a passagem ja aconteceu, a nota e ajuda para a equipe.
    await anotarPassagemParaAEquipe(c.admin, {
      clinicId: c.clinicId,
      conversationId: c.conversationId,
      jobId: c.job.id,
      texto: nota,
    });
  }
  const resultado = await enviarAFrase(c, destino);
  // [AG6 passagem] início
  // A frase primeiro (a guarda do envio exige a conversa na fila sem
  // responsavel), a atribuicao depois (R1.3).
  await atribuirDepoisDaFrase(c, motivo);
  // [AG6 passagem] fim
  return resultado;
}

async function enviarAFrase(
  c: Contexto,
  destino: Destino,
): Promise<ResultadoDeJob> {
  let resultado: SendTextResult | null = null;
  if (restanteMs(c) >= RESERVA_DO_ENVIO_MS) {
    try {
      resultado = await c.deps.enviarFrase(c.admin, {
        clinicId: c.clinicId,
        conversationId: c.conversationId,
        contactId: destino.contactId,
        jobId: c.job.id,
        workerId: c.workerId,
        whatsappAccountId: destino.whatsappAccountId,
      });
    } catch {
      resultado = null;
    }
  }
  if (resultado?.ok) {
    return CONCLUIR;
  }
  if (resultado?.reason === "ja_enviado" && (await fraseJaSaiu(c))) {
    return CONCLUIR;
  }
  log.warn("ia_frase_nao_enviada", {
    ...idsDoLog(c),
    error_code: resultado ? (resultado.code ?? resultado.reason) : "sem_tempo",
  });
  await gravarEventoDaIa(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    workerId: c.workerId,
    motivo: "aviso_nao_enviado",
  });
  return CONCLUIR;
}

async function fraseJaSaiu(c: Contexto): Promise<boolean> {
  try {
    const linha = await lerMensagemDoJob(c.admin, c.clinicId, c.job.id);
    return (
      linha !== null &&
      linha.author === "sistema" &&
      // [AG7 preparo] A linha 'sistema' do job e a frase OU o preparo: so o
      // corpo da frase prova que ela saiu (contrato, secao 0, item 19).
      linha.body === FRASE_DE_ESCALONAMENTO &&
      linha.deliveryStatus !== null &&
      RECIBOS_DE_ENVIADA.has(linha.deliveryStatus)
    );
  } catch {
    return false;
  }
}

/**
 * Passagem sem frase depois da decisao (liberacao perdida no meio, guarda
 * que recusou, numero desconectado, envio que falhou de vez). A passagem vem
 * ANTES de fechar o turno: erro na passagem lanca 'passagem_falhou' com o
 * turno ainda 'decidido', e a retentativa passa de novo (nunca conclui com a
 * conversa presa na IA). "feito" quando a conversa saiu (agora ou antes);
 * "job_antigo" quando o job e anterior a janela atual (D-A: nada foi tocado,
 * e quem chama CONCLUI, nunca falha o job); o turno fecha 'sem_envio' nos
 * dois.
 */
async function passarSemFraseEFechar(
  c: Contexto,
  motivo: MotivoDoEventoDaIa,
): Promise<"feito" | "job_antigo" | "sem_posse"> {
  const passagem = await passarDoJob(c, motivo);
  if (passagem === "sem_posse") {
    return "sem_posse";
  }
  if (passagem === "erro") {
    throw new ErroComCodigoDeJob("passagem_falhou");
  }
  await fecharTurno(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    estado: "sem_envio",
  });
  return passagem === "job_antigo" ? "job_antigo" : "feito";
}

async function passarSemFraseDepoisDeDecidir(
  c: Contexto,
  motivo: MotivoDoEventoDaIa,
): Promise<ResultadoDeJob> {
  return (await passarSemFraseEFechar(c, motivo)) === "sem_posse"
    ? { ok: false, erro: "sem_posse" }
    : CONCLUIR;
}

/**
 * Antes do modelo, a conversa sai da IA por uma trava (janela, liberacao,
 * autorizacao, versao, horario): passa para a equipe com o evento, sem
 * frase e sem decisao. Um turno reservado de tentativa anterior fecha sem
 * envio.
 */
async function passarSemFrase(
  c: Contexto,
  turnoAtual: TurnoDaIa | null,
  motivo: MotivoDoEventoDaIa,
): Promise<ResultadoDeJob> {
  const passagem = await passarDoJob(c, motivo);
  if (passagem === "sem_posse") {
    return { ok: false, erro: "sem_posse" };
  }
  if (passagem === "erro") {
    throw new ErroComCodigoDeJob("passagem_falhou");
  }
  if (passagem !== "job_antigo") {
    log.info("ia_conversa_passou_sem_turno", {
      ...idsDoLog(c),
      status: motivo,
    });
  }
  await encerrarSemEnvio(c, turnoAtual);
  return CONCLUIR;
}

async function encerrarSemEnvio(
  c: Contexto,
  turnoAtual: TurnoDaIa | null,
): Promise<void> {
  if (turnoAtual !== null) {
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "sem_envio",
    });
  }
}

// ---------------------------------------------------------------------------
// Envio da resposta
// ---------------------------------------------------------------------------

/**
 * Codigos da linha do job (ou do envio) que querem dizer "liberacao caiu".
 * A conta suspensa (onda 1) tambem: suspender desliga a IA na clinica, e o
 * envio recusa antes de gravar qualquer coisa (corrida com a suspensao).
 */
const CODIGOS_DE_LIBERACAO: ReadonlySet<string> = new Set([
  "janela_invalida",
  "ia_nao_liberada",
  "clinica_suspensa",
]);

/** Codigos de numero fora (desconectado, removido, sem numero). */
const CODIGOS_DE_NUMERO: ReadonlySet<string> = new Set([
  "desconectado",
  "numero_removido",
  "sem_numero",
]);

// [AG7 preparo] início
/**
 * AG7: o que o despacho manda: a resposta da IA (so TextoAprovado) ou a
 * orientacao de preparo (so PreparoAprovado), com as mesmas recusas.
 */
type SaidaParaEnviar =
  | { tipo: "resposta"; texto: TextoAprovado }
  | { tipo: "preparo"; preparo: PreparoAprovado };
// [AG7 preparo] fim

async function enviarResposta(
  c: Contexto,
  destino: Destino,
  // [AG7 preparo] a resposta ou o preparo (era texto: TextoAprovado)
  saida: SaidaParaEnviar,
  decisionId: string | null,
): Promise<ResultadoDeJob> {
  // Sem tempo para o envio inteiro: o texto aprovado fica no turno e o job
  // volta ja, sem queimar tentativa (o indice so junta job que nunca rodou).
  if (restanteMs(c) < RESERVA_DO_ENVIO_MS) {
    return { reagendar: agoraIso(c), motivo: "retomar_envio" };
  }
  const ids = {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    contactId: destino.contactId,
    jobId: c.job.id,
    workerId: c.workerId,
    whatsappAccountId: destino.whatsappAccountId,
  };
  // [AG7 preparo] O despacho: a resposta ou o preparo.
  const resultado =
    saida.tipo === "resposta"
      ? await c.deps.enviarResposta(c.admin, { ...ids, texto: saida.texto })
      : await (c.deps.enviarPreparo ?? enviarPreparoAprovadoDaIa)(c.admin, {
          ...ids,
          preparo: saida.preparo,
        });

  if (resultado.ok) {
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "enviado",
    });
    if (decisionId !== null) {
      await ligarDecisaoAMensagem(c.admin, {
        clinicId: c.clinicId,
        decisionId,
        messageId: resultado.messageId,
      });
    }
    log.info("ia_resposta_enviada", idsDoLog(c));
    return CONCLUIR;
  }

  const code = resultado.code ?? resultado.reason;
  log.warn("ia_resposta_nao_enviada", { ...idsDoLog(c), error_code: code });

  if (resultado.reason === "slot_adiado") {
    return {
      reagendar:
        resultado.livreEm ?? new Date(c.deps.agora() + 20_000).toISOString(),
      motivo: "canal_ocupado",
    };
  }
  if (resultado.reason === "ja_enviado") {
    return fecharDepoisDeJaEnviado(c);
  }
  if (code === "sem_posse") {
    return { ok: false, erro: "sem_posse" };
  }
  if (code === "fora_da_ia") {
    // A conversa ja esta com a equipe (Assumir, desligar): nada a fazer.
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "sem_envio",
    });
    return CONCLUIR;
  }
  if (resultado.reason === "sem_consentimento") {
    // Revogou a autorizacao durante o turno: sem frase (quem revogou nao
    // recebe nada). A passagem vem antes de fechar o turno.
    return passarSemFraseDepoisDeDecidir(c, "sem_autorizacao");
  }
  if (CODIGOS_DE_LIBERACAO.has(code)) {
    // Liberacao ou janela cairam: sem frase.
    return passarSemFraseDepoisDeDecidir(c, "liberacao_perdida");
  }
  if (
    code === "ia_sem_aprovacao" ||
    // [AG7 preparo] O gatilho de message recusou o conteudo do preparo
    // (CZIA3: a versao saiu de vigor, ou a mensagem nao e a remontada): a
    // linha nao nasceu, como no ia_sem_aprovacao.
    (saida.tipo === "preparo" && code === "frase_divergente")
  ) {
    // O banco nao achou a decisao aprovada com o mesmo hash: nada saiu e a
    // linha nao nasceu, entao a frase pode usar o mesmo job. O turno passa
    // a esperar a frase ANTES da passagem: se ela falhar, a retentativa
    // passa e manda a frase (nunca a resposta de novo).
    await trocarSaidaParaFrase(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
    });
    return passarEAvisar(c, destino, "falha_tecnica");
  }
  if (resultado.reason === "desconectado" || code === "sem_numero") {
    const fechou = await passarSemFraseEFechar(c, "numero_desconectado");
    if (fechou === "sem_posse") {
      return { ok: false, erro: "sem_posse" };
    }
    // D-A: job anterior a janela atual so conclui (conferencia N3).
    return fechou === "job_antigo"
      ? CONCLUIR
      : { ok: false, erro: code, definitivo: true };
  }
  if (
    resultado.reason === "falha_envio" &&
    envioCertamenteNaoSaiu(resultado) &&
    (code === "leitura_falhou" ||
      code === "slot_indisponivel" ||
      code === "canal_ocupado" ||
      code === "provider_indisponivel" ||
      code === "sem_instancia" ||
      code === "configuracao_ausente")
  ) {
    // Nada saiu e repetir pode dar certo: retry (30 s, 60 s). Esgotou: o
    // fechamento do job tira a conversa da IA.
    return { ok: false, erro: code };
  }
  const motivo: MotivoDoEventoDaIa = envioCertamenteNaoSaiu(resultado)
    ? "falha_tecnica"
    : // Pode ter chegado (envio_incerto, resposta do provedor): nunca repete.
      "envio_incerto";
  const fechou = await passarSemFraseEFechar(c, motivo);
  if (fechou === "sem_posse") {
    return { ok: false, erro: "sem_posse" };
  }
  return fechou === "job_antigo"
    ? CONCLUIR
    : { ok: false, erro: code, definitivo: true };
}

/**
 * 'ja_enviado' (ou a retomada que acha a linha do job): le a linha para
 * saber o que aconteceu. Enviada: turno 'enviado'. 'falhou': o codigo da
 * linha diz o motivo da passagem (liberacao, numero, falha que com certeza
 * nao saiu, ou envio incerto). 'enviando' de uma tentativa cortada: pode ter
 * chegado. A passagem vem antes de fechar o turno (erro: retentativa).
 */
async function fecharDepoisDeJaEnviado(c: Contexto): Promise<ResultadoDeJob> {
  const linha = await lerMensagemDoJob(c.admin, c.clinicId, c.job.id);
  const saiu =
    linha !== null &&
    (linha.author === "ia" || linha.author === "sistema") &&
    linha.deliveryStatus !== null &&
    RECIBOS_DE_ENVIADA.has(linha.deliveryStatus);
  if (saiu) {
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: "enviado",
    });
    return CONCLUIR;
  }
  if (linha !== null && linha.deliveryStatus === "falhou") {
    const codigo = linha.errorCode ?? "";
    if (codigo === "fora_da_ia") {
      await fecharTurno(c.admin, {
        clinicId: c.clinicId,
        jobId: c.job.id,
        estado: "sem_envio",
      });
      return CONCLUIR;
    }
    const naoSaiu = envioCertamenteNaoSaiu({
      reason: "falha_envio",
      code: codigo,
    });
    const motivo: MotivoDoEventoDaIa = CODIGOS_DE_LIBERACAO.has(codigo)
      ? "liberacao_perdida"
      : CODIGOS_DE_NUMERO.has(codigo)
        ? "numero_desconectado"
        : naoSaiu
          ? "falha_tecnica"
          : "envio_incerto";
    const fechou = await passarSemFraseEFechar(c, motivo);
    if (fechou === "sem_posse") {
      return { ok: false, erro: "sem_posse" };
    }
    // Uma tentativa anterior ja recusou de vez e nada saiu: conclui. Pode
    // ter chegado: nunca repete. Job anterior a janela atual (D-A): conclui.
    return naoSaiu || fechou === "job_antigo"
      ? CONCLUIR
      : { ok: false, erro: "envio_incerto", definitivo: true };
  }
  // 'enviando' de uma tentativa cortada: pode ter chegado. Job anterior a
  // janela atual (D-A): conclui.
  const fechou = await passarSemFraseEFechar(c, "envio_incerto");
  if (fechou === "sem_posse") {
    return { ok: false, erro: "sem_posse" };
  }
  return fechou === "job_antigo"
    ? CONCLUIR
    : { ok: false, erro: "envio_incerto", definitivo: true };
}

// ---------------------------------------------------------------------------
// Retomadas
// ---------------------------------------------------------------------------

/**
 * Retomada em 'passou_para_equipe': a passagem ja aconteceu e a frase nao
 * se repete. Se ela nao saiu, fica o evento do aviso nao enviado.
 */
async function retomarAvisoDaFrase(c: Contexto): Promise<ResultadoDeJob> {
  await avisoDaFraseNaRetomada(c);
  return CONCLUIR;
}

/**
 * O aviso da retomada: a frase deste job saiu (true), ou o evento "O aviso
 * automático ao contato não foi enviado." foi pedido (false). Nunca lanca.
 */
async function avisoDaFraseNaRetomada(c: Contexto): Promise<boolean> {
  if (await fraseJaSaiu(c)) {
    return true;
  }
  await gravarEventoDaIa(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    workerId: c.workerId,
    motivo: "aviso_nao_enviado",
  });
  return false;
}

/** O motivo da passagem gravado na decisao (para retomar a frase). */
async function motivoDaDecisao(
  c: Contexto,
  decisionId: string | null,
): Promise<MotivoDoEventoDaIa> {
  if (decisionId === null) {
    return "falha_tecnica";
  }
  const { data, error } = await c.admin
    .from("ai_decision_log")
    .select("escalation_reason")
    .eq("clinic_id", c.clinicId)
    .eq("id", decisionId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const motivo = (data as { escalation_reason?: unknown } | null)
    ?.escalation_reason;
  return typeof motivo === "string" &&
    (MOTIVOS_DE_ESCALONAMENTO as readonly string[]).includes(motivo)
    ? (motivo as MotivoDeEscalonamento)
    : "falha_tecnica";
}

/** Retomada em 'decidido': o modelo nao e chamado de novo. */
async function retomarDecidido(
  c: Contexto,
  turno: TurnoDaIa,
  conversa: Conversa | null,
): Promise<ResultadoDeJob> {
  if (!conversa) {
    await encerrarSemEnvio(c, turno);
    return CONCLUIR;
  }
  const destino: Destino = {
    contactId: conversa.contact_id,
    whatsappAccountId: conversa.whatsapp_account_id,
  };
  if (turno.saida === "frase") {
    return passarEAvisar(
      c,
      destino,
      await motivoDaDecisao(c, turno.decisionId),
      true,
    );
  }
  if (turno.saida === "nenhuma") {
    // A liberacao caiu no meio do turno e a passagem nao deu certo na
    // tentativa anterior: passa agora, sem frase.
    return passarSemFraseDepoisDeDecidir(c, "liberacao_perdida");
  }
  // [AG7 preparo] início
  if (turno.saida === "preparo") {
    return retomarOPreparo(c, turno, destino);
  }
  // [AG7 preparo] fim
  if (
    turno.saida !== "resposta" ||
    turno.texto === null ||
    turno.textoSha256 === null
  ) {
    await encerrarSemEnvio(c, turno);
    return CONCLUIR;
  }
  // A tentativa anterior pode ter enviado e caido antes de fechar o turno:
  // a linha do job diz (a guarda nunca e consultada para o que ja saiu). A
  // linha 'falhou' com codigo de retry (o provedor com certeza nao enviou)
  // e o retry que o executor pediu: segue para o envio, que a reaproveita.
  const jaGravada = await lerMensagemDoJob(c.admin, c.clinicId, c.job.id);
  const retryDoEnvio =
    jaGravada !== null &&
    jaGravada.deliveryStatus === "falhou" &&
    falhaPermiteRetry(jaGravada.errorCode);
  if (jaGravada !== null && !retryDoEnvio) {
    return fecharDepoisDeJaEnviado(c);
  }
  if (restanteMs(c) < RESERVA_DO_ENVIO_MS) {
    return { reagendar: agoraIso(c), motivo: "retomar_envio" };
  }
  // A decisao APROVADA do job, lida de ai_decision_log (nunca de ai_turno),
  // e os nomes do Cadastro mascarados como na aprovacao (filtro.ts).
  const [decisao, catalogo] = await Promise.all([
    turno.decisionId === null
      ? Promise.resolve(null)
      : lerDecisaoParaRetomar(c.admin, {
          clinicId: c.clinicId,
          decisionId: turno.decisionId,
          jobId: c.job.id,
        }),
    lerOuFalhar(() => carregarCatalogoDoAgente(c.admin, c.clinicId)),
  ]);
  const texto = retomarTextoAprovado({
    jobId: c.job.id,
    texto: turno.texto,
    sha256DoTurno: turno.textoSha256,
    decisao,
    nomesDoCatalogo: nomesDoCatalogo(catalogo),
  });
  if (texto === null) {
    log.warn("ia_retomada_recusada", idsDoLog(c));
    const passagem = await passarDoJob(c, "falha_tecnica");
    if (passagem === "sem_posse") {
      return { ok: false, erro: "sem_posse" };
    }
    if (passagem === "erro") {
      // O turno continua 'decidido': a retentativa passa de novo.
      throw new ErroComCodigoDeJob("passagem_falhou");
    }
    // Sem frase (contrato 3.6). O texto sai da linha.
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: passagem === "job_antigo" ? "sem_envio" : "passou_para_equipe",
    });
    await apagarTextoDoTurno(c);
    return CONCLUIR;
  }
  // [AG7 preparo] O despacho generico (a resposta).
  return enviarResposta(
    c,
    destino,
    { tipo: "resposta", texto },
    turno.decisionId,
  );
}

// [AG7 preparo] início
/**
 * AG7 (contrato, secao 0, item 20): a retomada do turno 'decidido' com a
 * saida 'preparo'. O modelo nao e chamado de novo. A linha do job que ja
 * existe diz o que aconteceu (como na resposta); a que vai ser reaproveitada
 * (o retry de "nada saiu", um UPDATE que NAO passa pelo gatilho de message)
 * so sai depois da RECONFERENCIA aqui: a decisao 'enviou_preparo' do job, e
 * ler_preparo_para_envio da versao dela com o mesmo hash. Diferente, nulo
 * ou sem a decisao: a passagem sem frase (contrato 3.6), como a retomada
 * recusada da resposta.
 */
async function retomarOPreparo(
  c: Contexto,
  turno: TurnoDaIa,
  destino: Destino,
): Promise<ResultadoDeJob> {
  const jaGravada = await lerMensagemDoJob(c.admin, c.clinicId, c.job.id);
  const retryDoEnvio =
    jaGravada !== null &&
    jaGravada.deliveryStatus === "falhou" &&
    falhaPermiteRetry(jaGravada.errorCode);
  if (jaGravada !== null && !retryDoEnvio) {
    return fecharDepoisDeJaEnviado(c);
  }
  if (restanteMs(c) < RESERVA_DO_ENVIO_MS) {
    return { reagendar: agoraIso(c), motivo: "retomar_envio" };
  }
  const decisao =
    turno.decisionId === null
      ? null
      : await lerDecisaoDoPreparo(c.admin, {
          clinicId: c.clinicId,
          decisionId: turno.decisionId,
          jobId: c.job.id,
        });
  // Revisao da AG7 (CFM-2): a leitura reconfere tambem as recusas do texto
  // (recusado e fora de vigor nao saem).
  const leitura =
    decisao === null
      ? null
      : await lerOuFalhar(() =>
          lerPreparoParaEnvio(c.admin, {
            clinicId: c.clinicId,
            versaoId: decisao.versaoId,
          }),
        );
  const preparo = leitura?.tipo === "pronto" ? leitura.preparo : null;
  if (
    decisao === null ||
    preparo === null ||
    preparo.sha256 !== decisao.sha256 ||
    (turno.textoSha256 !== null && turno.textoSha256 !== decisao.sha256)
  ) {
    log.warn("ia_retomada_recusada", { ...idsDoLog(c), kind: "preparo" });
    const passagem = await passarDoJob(c, "falha_tecnica");
    if (passagem === "sem_posse") {
      return { ok: false, erro: "sem_posse" };
    }
    if (passagem === "erro") {
      // O turno continua 'decidido': a retentativa passa de novo.
      throw new ErroComCodigoDeJob("passagem_falhou");
    }
    // Sem frase (contrato 3.6).
    await fecharTurno(c.admin, {
      clinicId: c.clinicId,
      jobId: c.job.id,
      estado: passagem === "job_antigo" ? "sem_envio" : "passou_para_equipe",
    });
    return CONCLUIR;
  }
  return enviarResposta(
    c,
    destino,
    { tipo: "preparo", preparo },
    turno.decisionId,
  );
}
// [AG7 preparo] fim

/** Tira o texto pendente da linha do turno (retencao). Nunca lanca. */
async function apagarTextoDoTurno(c: Contexto): Promise<void> {
  try {
    await c.admin
      .from("ai_turno")
      .update({ texto: null })
      .eq("clinic_id", c.clinicId)
      .eq("job_id", c.job.id);
  } catch {
    // A varredura apaga o texto que sobrar em 1 hora.
  }
}
