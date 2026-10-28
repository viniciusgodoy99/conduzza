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
import { VERSAO_DO_PROMPT } from "@/lib/agente/prompt";
import { lerPrecos } from "@/lib/agente/uso";
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
//  8. Teto de respostas da conversa na ultima hora.
//  9. Reserva do custo maximo do turno (origem whatsapp).
//  8b. (AG3) O estado do atendimento (ler_atendimento_da_ia, pelo job):
//     fora_da_ia encerra sem envio, job_antigo so conclui, e erro ou
//     resposta fora do formato e falha fechada (a frase fixa e a equipe,
//     sem chamar o modelo). E o nascimento informado na conversa (so para a
//     idade atendida do profissional, nunca para o modelo).
// 10. O turno (portao, classificador, agente, filtro), com a trava do
//     WhatsApp entre as rodadas e o prazo da invocacao menos o envio. As
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
//     Erro na passagem nunca e engolido: o turno fica onde esta e o job
//     tenta de novo (a retentativa passa e manda a frase).
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
};

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
  let cliente: ClienteDoAgente | null | undefined;
  const clienteDoAgente = (): ClienteDoAgente | null => {
    if (cliente === undefined) {
      cliente = clienteOpenAiDoAmbiente(env);
    }
    return cliente;
  };
  const modeloDosClassificadores = modeloDoVerificador(env);
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
    return retomarAvisoDaFrase(c);
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
  const prazoDoTurno = Math.min(
    PRAZO_DO_TURNO_MS,
    restanteMs(c) - RESERVA_DO_ENVIO_MS - RESERVA_DAS_GRAVACOES_MS,
  );
  if (prazoDoTurno < PRAZO_MINIMO_DO_TURNO_MS) {
    return { reagendar: agoraIso(c), motivo: "orcamento_da_passagem" };
  }

  const [precos, catalogo] = await Promise.all([
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
  if (cliente !== null && modelo !== null && identificador !== null) {
    const custoMaximo = custoMaximoDoTurno({
      config,
      catalogo,
      mensagens: historico.mensagens,
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
    });
    if (custoMaximo === null) {
      log.warn("ia_preco_ausente", idsDoLog(c));
      return falharSemModelo(c, base, destino, config);
    }
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
      mensagens: historico.mensagens,
      agoraMs,
      fuso,
      verificador: c.deps.criarVerificador(identificador ?? ""),
      classificador: c.deps.criarClassificador(identificador ?? ""),
      dataDeNascimento: contato.birth_date,
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
      agora: c.deps.agora,
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
  }

  if (resultado === null) {
    return falharSemModelo(c, { ...base, reservaId }, destino, config);
  }

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
    return enviarResposta(c, destino, resultado.resposta, decisionId);
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

/**
 * A passagem do job, com D-A conferido aqui tambem (o banco confere de
 * novo): job anterior a janela atual devolve "job_antigo" sem chamar a
 * passagem. Lanca ErroComCodigoDeJob se a janela nao puder ser lida (o job
 * tenta de novo; o turno continua onde estava).
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
  return passarParaAEquipe(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    workerId: c.workerId,
    motivo,
  });
}

/**
 * A passagem e, so se ela aconteceu AGORA, a frase fixa. Tentativa unica:
 * slot adiado ou qualquer falha da frase grava o evento "O aviso automatico
 * ao contato nao foi enviado." e o job conclui (nunca reagenda: a conversa
 * ja saiu da IA). Na RETOMADA de um turno 'decidido' com a frase, a
 * conversa ja fora da IA pode ser a passagem da tentativa que caiu antes de
 * fechar o turno: sem a frase na linha do job, fica o evento do aviso.
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
  return enviarAFrase(c, destino);
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

async function enviarResposta(
  c: Contexto,
  destino: Destino,
  texto: TextoAprovado,
  decisionId: string | null,
): Promise<ResultadoDeJob> {
  // Sem tempo para o envio inteiro: o texto aprovado fica no turno e o job
  // volta ja, sem queimar tentativa (o indice so junta job que nunca rodou).
  if (restanteMs(c) < RESERVA_DO_ENVIO_MS) {
    return { reagendar: agoraIso(c), motivo: "retomar_envio" };
  }
  const resultado = await c.deps.enviarResposta(c.admin, {
    clinicId: c.clinicId,
    conversationId: c.conversationId,
    contactId: destino.contactId,
    jobId: c.job.id,
    workerId: c.workerId,
    whatsappAccountId: destino.whatsappAccountId,
    texto,
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
  if (code === "ia_sem_aprovacao") {
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
  if (await fraseJaSaiu(c)) {
    return CONCLUIR;
  }
  await gravarEventoDaIa(c.admin, {
    clinicId: c.clinicId,
    jobId: c.job.id,
    workerId: c.workerId,
    motivo: "aviso_nao_enviado",
  });
  return CONCLUIR;
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
  return enviarResposta(c, destino, texto, turno.decisionId);
}

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
