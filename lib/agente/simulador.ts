import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  agenteAtendeAgora,
  type TipoDoContato,
} from "@/lib/domain/agente/config";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import {
  ambienteDaIaLigado,
  iaLiberadaNoAmbiente,
  lerClinicasHabilitadasDaIa,
  lerConfigDaIa,
  segredoDoIdentificadorValido,
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
} from "@/lib/integrations/llm/openai";
import {
  criarVerificador,
  modeloDoVerificador,
} from "@/lib/integrations/llm/verificador";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import { log } from "@/lib/log";

import {
  assinarEstadoDoSimulador,
  assinarResposta,
  chaveDaAssinatura,
  conferirEstadoDoSimulador,
  conferirHistorico,
  type FalaAssinavel,
} from "./assinatura";
import {
  portaDaAgendaDoSimulador,
  type MemoriaDoSimulador,
} from "./agenda";
import {
  dadosQueFaltam,
  dadosVazios,
  DADOS_DA_MARCACAO,
  estadoDoAtendimentoValido,
  estadoVazio,
  type DadosInformados,
  type EstadoDoAtendimento,
} from "./atendimento";
import { carregarCatalogoDoAgente, carregarConfigDoRascunho } from "./contexto";
import { acertarGasto, reservarGasto } from "./gasto";
import {
  atendimentoParaEstimativa,
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type MensagemDaConversa,
  type PassoDoTurno,
  type ResultadoDoTurno,
} from "./laco";
import { SEPARADOR_DA_RESPOSTA } from "./prompt";
import { lerPrecos, type PrecoDoModelo } from "./uso";

// Simulador da Tela 6 (E2): o MESMO turno do WhatsApp (portao de entrada,
// agente, filtro de saida), sobre o RASCUNHO da configuracao, sem caminho de
// envio: nada aqui grava em message, conversation nem ai_decision_log, e
// nenhuma funcao recebe telefone. So grava o gasto (ia_uso, origem
// "simulador"), que conta no teto diario da clinica.
//
// Travas, nesta ordem (plano de seguranca, secao 1): ambiente (T1 e T2,
// iaLiberadaNoAmbiente, com a lista das clinicas habilitadas lida do banco
// desde a onda 1) e banco (ia_pode_simular, service role: a mesma lista,
// interruptor geral, liberacao da clinica, pausa e teto das ultimas 24
// horas). A trava do banco e conferida de novo antes de cada rodada do
// modelo. Quando nao pode rodar, o motivo em texto de recepcionista.
//
// E4 (20/10/2026, contrato da E4 secao 2): com a habilidade Agendar consulta
// ligada no rascunho, buscar_horario le a Agenda de verdade (so horarios);
// reservar_horario, agendar e confirmar_presenca devolvem a resposta
// simulada e NAO gravam nada (portaDaAgendaDoSimulador, sem RPC). A trilha
// diz "No simulador, nada foi gravado.".
//
// Revisao de 06/10/2026:
//  - o historico que o navegador manda e conferido pela assinatura da
//    ultima resposta (lib/agente/assinatura.ts) e cada resposta volta
//    assinada; historico alterado nao roda;
//  - o custo maximo do turno e RESERVADO antes de qualquer chamada
//    (reservar_gasto_da_ia, atomico por clinica) e acertado no fim com uma
//    linha por chamada (lib/agente/gasto.ts); sem reserva, nada e chamado;
//  - o texto que o filtro barrou ("Ver o que o assistente ia responder") e
//    o passo do texto descartado so voltam para o super admin;
//  - conversa que ja recebeu a frase fixa (passou para a equipe) nao
//    continua: no WhatsApp quem responde dali em diante e a equipe, e a fala
//    seguinte do paciente pularia o portao e o classificador que barraram a
//    anterior (so as pendentes passam por eles). Recusa antes de reservar
//    gasto e de chamar o modelo; a tela ja trava no mesmo ponto.
//
// Onda 2:
//  - "Testar como" (item 4): Lead ou Paciente, que a acao valida no
//    servidor; vai na ultima linha das instrucoes, como o tipo do contato no
//    WhatsApp. Sem escolha: sem a linha;
//  - fora do assunto (item 5, P5b): a contagem da janela sao as falas do
//    assistente com a frase de fora do assunto, no historico assinado (a
//    conversa de teste e uma janela so).
//
// AG3 (27/10/2026), o agendamento completo no simulador, SEM GRAVAR NADA:
// o estado do atendimento (a etapa, os horarios oferecidos com o codigo, a
// reserva e a consulta SIMULADAS e SE os dados foram informados) volta para
// a tela num pacote assinado junto da resposta (assinarEstadoDoSimulador) e
// vem de volta na rodada seguinte; pacote alterado, ou de outra resposta, e
// recusado como o historico alterado. Os dados que a pessoa informa sao
// conferidos pelas regras do banco e o valor nao fica em lugar nenhum. A
// nota para a equipe, quando o turno passa a conversa, aparece na trilha.

type Ambiente = Readonly<Record<string, string | undefined>>;

export const TEXTOS_DO_SIMULADOR = {
  semChave: "A chave da OpenAI ainda não está configurada.",
  soEmProducao: "O simulador só responde no ambiente de produção.",
  clinicaForaDaFase:
    "O assistente ainda não está disponível para esta clínica.",
  interruptor: "O interruptor geral da IA está desligado.",
  // Onda 2 (item 8): a liberacao mudou para a Tela 6, aba WhatsApp.
  desligadoNaClinica:
    "O assistente está desligado nesta clínica. Ligue em Agente de IA, na aba WhatsApp.",
  pausado: "O assistente está pausado nesta clínica.",
  teto: "O teto de gasto de hoje acabou.",
  modeloInvalido:
    "O modelo do assistente configurado neste ambiente não é válido. Avise a equipe Conduzza.",
  semIdentificador:
    "A configuração de segurança da IA neste ambiente está incompleta. Avise a equipe Conduzza.",
  naoConferiu:
    "Não foi possível conferir se a IA pode responder. Tente de novo.",
  naoConferiuCusto:
    "Não foi possível conferir o custo da IA. Tente de novo em instantes.",
  naoCarregou:
    "Não foi possível carregar a configuração do assistente. Tente de novo.",
  foraDoHorario:
    "No WhatsApp, agora quem responderia é a equipe (fora do horário de operação do assistente). O simulador responde mesmo assim, para teste.",
  historicoAlterado: "A conversa de teste foi alterada. Reinicie o simulador.",
  conversaComAEquipe:
    "A conversa de teste passou para a equipe. Reinicie o simulador para testar de novo.",
  instrucoesDescartadas:
    "As instruções da equipe Conduzza ficaram de fora desta resposta: não passam mais nas regras de conformidade. Ajuste na aba Instruções do assistente.",
  // AG3: a nota interna que a equipe receberia na passagem.
  notaParaAEquipe: "No WhatsApp, a equipe receberia esta nota interna:",
} as const;

/** O passo do super admin sobre as perguntas que ficaram de fora. */
export function textoDasPerguntasDescartadas(quantas: number): string {
  return quantas === 1
    ? "1 pergunta ativa do Conhecimento ficou de fora desta resposta: não passa mais nas regras de conformidade."
    : `${quantas} perguntas ativas do Conhecimento ficaram de fora desta resposta: não passam mais nas regras de conformidade.`;
}

/**
 * A conversa ja passou para a equipe: alguma fala do assistente no trecho
 * conferido e a frase fixa (bloqueio e escalonamento sao a mesma frase,
 * lib/domain/conformidade/frase-fixa.ts). Basta a ultima para recusar; olhar
 * todas cobre tambem um historico assinado antes desta trava.
 */
export function conversaPassouParaAEquipe(
  falas: readonly FalaAssinavel[],
): boolean {
  return falas.some(
    (fala) =>
      fala.autor === "assistente" &&
      fala.texto.trim() === FRASE_DE_ESCALONAMENTO,
  );
}

/**
 * Onda 2 (item 5, P5b): quantas vezes o assistente ja respondeu fora do
 * assunto na conversa de teste: as falas dele que trazem a frase de fora do
 * assunto como um paragrafo (com a saudacao e o aviso colados na primeira,
 * ela vem depois deles).
 */
export function foraDoAssuntoNoSimulador(
  falas: readonly FalaAssinavel[],
): number {
  return falas.filter(
    (fala) =>
      fala.autor === "assistente" &&
      fala.texto
        .split(SEPARADOR_DA_RESPOSTA)
        .some((parte) => parte.trim() === FRASE_FORA_DO_ASSUNTO),
  ).length;
}

/** Prazo da trava do banco: sem resposta, nao pode (falha fechada). */
export const PRAZO_DA_TRAVA_MS = 3_000;

/**
 * T1 e T2 (o ambiente e a lista das clinicas habilitadas, ja lida do banco
 * por quem chama), com o motivo exato. null = o ambiente deixa. Nunca
 * devolve nem registra o valor de nenhuma variavel.
 */
export function motivoDoAmbiente(
  clinicId: string,
  clinicas: readonly string[],
  env: Ambiente = process.env,
): string | null {
  if (iaLiberadaNoAmbiente(lerConfigDaIa(clinicas, env), clinicId)) {
    return null;
  }
  if ((env.OPENAI_API_KEY ?? "").trim() === "") {
    return TEXTOS_DO_SIMULADOR.semChave;
  }
  if (env.VERCEL_ENV !== "production") {
    return TEXTOS_DO_SIMULADOR.soEmProducao;
  }
  // T1 tambem exige o segredo do identificador (lerConfigDaIa).
  if (!segredoDoIdentificadorValido(env)) {
    return TEXTOS_DO_SIMULADOR.semIdentificador;
  }
  return TEXTOS_DO_SIMULADOR.clinicaForaDaFase;
}

/**
 * ia_pode_simular pela service role (inclui o teto). Erro ou nenhuma
 * resposta em PRAZO_DA_TRAVA_MS = nao pode (o turno nao fica pendurado na
 * trava ate a funcao morrer).
 */
export async function iaPodeSimular(
  admin: SupabaseClient,
  clinicId: string,
): Promise<boolean> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc("ia_pode_simular", {
      p_clinic_id: clinicId,
    });
    return !error && data === true;
  }, PRAZO_DA_TRAVA_MS);
  return corrida.tipo === "resultado" && corrida.valor;
}

/**
 * Por que o banco nao deixa (so lido quando ia_pode_simular disse nao). As
 * condicoes de ia_liberacao_vigente na mesma ordem; a que sobra e o teto.
 */
async function motivoDoBanco(
  admin: SupabaseClient,
  clinicId: string,
): Promise<string> {
  try {
    const [interruptor, liberacao] = await Promise.all([
      admin.from("ia_interruptor").select("ligado").maybeSingle(),
      admin
        .from("ia_liberacao")
        .select("liberada, pausada_pela_clinica, modo")
        .eq("clinic_id", clinicId)
        .maybeSingle(),
    ]);
    if (interruptor.error || liberacao.error) {
      return TEXTOS_DO_SIMULADOR.naoConferiu;
    }
    if ((interruptor.data as { ligado?: unknown } | null)?.ligado !== true) {
      return TEXTOS_DO_SIMULADOR.interruptor;
    }
    const linha = liberacao.data as {
      liberada?: unknown;
      pausada_pela_clinica?: unknown;
      modo?: unknown;
    } | null;
    // Onda 2 (item 11): o modo da producao ("numero_inteiro") tambem deixa
    // simular; o leitor aceita o valor novo antes da migration.
    if (
      linha === null ||
      linha.liberada !== true ||
      (linha.modo !== "simulador" &&
        linha.modo !== "contatos" &&
        linha.modo !== "numero_inteiro")
    ) {
      return TEXTOS_DO_SIMULADOR.desligadoNaClinica;
    }
    if (linha.pausada_pela_clinica === true) {
      return TEXTOS_DO_SIMULADOR.pausado;
    }
    return TEXTOS_DO_SIMULADOR.teto;
  } catch {
    return TEXTOS_DO_SIMULADOR.naoConferiu;
  }
}

/**
 * Por que o simulador nao pode responder agora (ambiente, interruptor,
 * liberacao, pausa, teto), ou null. A pagina mostra antes; a acao confere
 * de novo a cada rodada.
 */
export async function motivoParaNaoSimular(
  admin: SupabaseClient,
  clinicId: string,
  env: Ambiente = process.env,
): Promise<string | null> {
  // T2 so e lida com T1 de pe (fora da producao, o motivo e o ambiente).
  // Lista que nao deu para ler, ou que nao respondeu no prazo da trava:
  // nao conferiu (falha fechada).
  let clinicas: readonly string[] = [];
  if (ambienteDaIaLigado(env)) {
    const lida = await correrComPrazo(
      () => lerClinicasHabilitadasDaIa(admin),
      PRAZO_DA_TRAVA_MS,
    );
    if (lida.tipo !== "resultado") {
      return TEXTOS_DO_SIMULADOR.naoConferiu;
    }
    clinicas = lida.valor;
  }
  const doAmbiente = motivoDoAmbiente(clinicId, clinicas, env);
  if (doAmbiente !== null) {
    return doAmbiente;
  }
  if (await iaPodeSimular(admin, clinicId)) {
    return null;
  }
  return motivoDoBanco(admin, clinicId);
}

export type ResultadoDoSimulador =
  | {
      ok: true;
      resposta: string;
      tipo: "resposta" | "frase_fixa";
      trilha: PassoDoTurno[];
      /**
       * O que o filtro barrou: SO para o super admin (nulo para os outros
       * papeis). Nunca vai a log.
       */
      rascunhoBloqueado: string | null;
      /**
       * A assinatura desta resposta (lib/agente/assinatura.ts): a tela guarda
       * e manda de volta na fala do assistente, no proximo pedido.
       */
      assinatura: string;
      /**
       * AG3: o estado do atendimento simulado, assinado e ligado a esta
       * resposta: a tela guarda e manda de volta no proximo pedido.
       */
      estado: string;
    }
  | { ok: false; error: string };

/** AG3: o que o pacote do estado do simulador guarda. */
type EstadoDoSimulador = {
  estado: EstadoDoAtendimento;
  dados: DadosInformados;
  memoria: MemoriaDoSimulador;
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function instante(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

/** O conteudo do pacote, conferido na forma (mesmo assinado). */
function estadoDoSimuladorLido(valor: unknown): EstadoDoSimulador | null {
  if (!ehObjeto(valor) || !estadoDoAtendimentoValido(valor.estado)) {
    return null;
  }
  const dados = valor.dados;
  const memoria = valor.memoria;
  if (
    !ehObjeto(dados) ||
    typeof dados.nome_completo !== "boolean" ||
    typeof dados.data_nascimento !== "boolean" ||
    typeof dados.cpf !== "boolean" ||
    typeof dados.carteirinha !== "boolean" ||
    !(dados.para_o_titular === null || typeof dados.para_o_titular === "boolean") ||
    !Array.isArray(dados.faltam) ||
    !dados.faltam.every((d) => (DADOS_DA_MARCACAO as readonly unknown[]).includes(d)) ||
    !ehObjeto(memoria)
  ) {
    return null;
  }
  const reserva = memoria.reserva;
  const consulta = memoria.consulta;
  const reservaValida =
    reserva === null ||
    (ehObjeto(reserva) &&
      typeof reserva.holdId === "string" &&
      UUID.test(reserva.holdId) &&
      typeof reserva.serviceLinkId === "string" &&
      instante(reserva.inicio) &&
      instante(reserva.fim) &&
      instante(reserva.expiraEm) &&
      (reserva.unidadeId === null || typeof reserva.unidadeId === "string"));
  const consultaSimuladaValida = (c: unknown): boolean =>
    ehObjeto(c) &&
    typeof c.appointmentId === "string" &&
    UUID.test(c.appointmentId) &&
    instante(c.inicio) &&
    // Revisao final da AG3: o vinculo da consulta simulada (opcional).
    (c.serviceLinkId === undefined ||
      (typeof c.serviceLinkId === "string" && UUID.test(c.serviceLinkId))) &&
    // Revisao curta das correcoes (achado 10): a unidade (opcional; a
    // mesma forma da unidade da reserva, de onde ela vem).
    (c.unidadeId === undefined ||
      c.unidadeId === null ||
      typeof c.unidadeId === "string");
  const consultaValida =
    consulta === null ||
    (consultaSimuladaValida(consulta) &&
      // AG4: a remarcacao simulada leva a consulta antiga (opcional), sem
      // outra dentro dela.
      ehObjeto(consulta) &&
      (consulta.remarcacaoDe === undefined ||
        (consultaSimuladaValida(consulta.remarcacaoDe) &&
          ehObjeto(consulta.remarcacaoDe) &&
          consulta.remarcacaoDe.remarcacaoDe === undefined)));
  if (!reservaValida || !consultaValida) {
    return null;
  }
  return {
    estado: valor.estado,
    dados: dados as unknown as DadosInformados,
    memoria: memoria as unknown as MemoriaDoSimulador,
  };
}

/** Dependencias trocaveis nos testes (nenhum teste chama a OpenAI). */
export type DependenciasDoSimulador = {
  cliente?: ClienteDoAgente | null;
  verificador?: Verificador;
  classificador?: ClassificadorDeEntrada;
  precos?: readonly PrecoDoModelo[];
};

/**
 * Uma rodada do simulador para quem a acao ja conferiu (sessao, clinica da
 * fase e papel). Confere as travas e o historico assinado, reserva o custo
 * maximo, roda o turno sobre o rascunho, acerta o gasto e assina a
 * resposta. O id de quem testa entra so nos HMAC (safety_identifier e
 * assinatura).
 */
export async function simularTurno(
  entrada: {
    admin: SupabaseClient;
    clinicId: string;
    userId: string;
    fuso: string;
    /** Como a tela mandou: a ultima e do paciente. */
    mensagens: readonly FalaAssinavel[];
    agoraMs: number;
    /** Super admin: ve o texto barrado e o passo do texto descartado. */
    superAdmin?: boolean;
    /**
     * Onda 2 (item 4): o "Testar como" da tela (Lead ou Paciente), ja
     * validado pela acao. Nulo ou ausente: sem a linha do contato.
     */
    contato?: TipoDoContato | null;
    /**
     * AG3: o pacote do estado do atendimento que a tela guardou da ultima
     * resposta (assinado). Ausente: o atendimento comeca do zero.
     */
    estado?: string | null;
    env?: Ambiente;
  },
  dependencias: DependenciasDoSimulador = {},
): Promise<ResultadoDoSimulador> {
  const { admin, clinicId } = entrada;
  const env = entrada.env ?? process.env;
  const superAdmin = entrada.superAdmin === true;

  const motivo = await motivoParaNaoSimular(admin, clinicId, env);
  if (motivo !== null) {
    return { ok: false, error: motivo };
  }

  const modelo = modeloDoAgente(env);
  if (modelo === null) {
    return { ok: false, error: TEXTOS_DO_SIMULADOR.modeloInvalido };
  }
  const segredo = segredoDoIdentificador(env);
  const identificador = identificadorDeSeguranca({
    clinicId,
    contactId: entrada.userId,
    segredo,
  });
  const chave = chaveDaAssinatura(segredo);
  if (identificador === null || chave === null) {
    return { ok: false, error: TEXTOS_DO_SIMULADOR.semIdentificador };
  }

  const conferido = conferirHistorico({
    chave,
    clinicId,
    userId: entrada.userId,
    falas: entrada.mensagens,
  });
  if (!conferido.ok) {
    log.warn("ia_simulador_historico_recusado", { clinic_id: clinicId });
    return { ok: false, error: TEXTOS_DO_SIMULADOR.historicoAlterado };
  }
  const falas = conferido.falas;
  // Depois da frase fixa a conversa e da equipe: nada de gasto nem modelo.
  if (conversaPassouParaAEquipe(falas)) {
    log.info("ia_simulador_conversa_com_a_equipe", { clinic_id: clinicId });
    return { ok: false, error: TEXTOS_DO_SIMULADOR.conversaComAEquipe };
  }
  const mensagens: MensagemDaConversa[] = falas.map((fala) => ({
    autor: fala.autor,
    texto: fala.texto,
  }));

  // AG3: o estado do atendimento simulado, ligado a ultima resposta.
  let anterior: EstadoDoSimulador = {
    estado: estadoVazio(),
    dados: dadosVazios(),
    memoria: { reserva: null, consulta: null },
  };
  const ultimaDoAssistente = [...falas]
    .reverse()
    .find((fala) => fala.autor === "assistente");
  if (
    entrada.estado !== undefined &&
    entrada.estado !== null &&
    entrada.estado !== "" &&
    ultimaDoAssistente?.assinatura
  ) {
    const lido = estadoDoSimuladorLido(
      conferirEstadoDoSimulador({
        chave,
        clinicId,
        userId: entrada.userId,
        assinaturaDaResposta: ultimaDoAssistente.assinatura,
        pacote: entrada.estado,
      }),
    );
    if (lido === null) {
      log.warn("ia_simulador_estado_recusado", { clinic_id: clinicId });
      return { ok: false, error: TEXTOS_DO_SIMULADOR.historicoAlterado };
    }
    anterior = lido;
  }

  const cliente =
    dependencias.cliente !== undefined
      ? dependencias.cliente
      : clienteOpenAiDoAmbiente(env);
  if (cliente === null) {
    return { ok: false, error: TEXTOS_DO_SIMULADOR.semChave };
  }

  let precos: readonly PrecoDoModelo[];
  try {
    precos = dependencias.precos ?? (await lerPrecos(admin));
  } catch {
    log.warn("ia_simulador_sem_preco", { clinic_id: clinicId });
    return { ok: false, error: TEXTOS_DO_SIMULADOR.naoConferiuCusto };
  }

  let contexto: Awaited<ReturnType<typeof carregarConfigDoRascunho>>;
  let catalogo: Awaited<ReturnType<typeof carregarCatalogoDoAgente>>;
  try {
    [contexto, catalogo] = await Promise.all([
      carregarConfigDoRascunho(admin, clinicId),
      carregarCatalogoDoAgente(admin, clinicId),
    ]);
  } catch {
    log.warn("ia_simulador_sem_contexto", { clinic_id: clinicId });
    return { ok: false, error: TEXTOS_DO_SIMULADOR.naoCarregou };
  }

  const modeloDosClassificadores = modeloDoVerificador(env);
  const verificador =
    dependencias.verificador ??
    criarVerificador({
      cliente,
      modelo: modeloDosClassificadores,
      identificadorDeSeguranca: identificador,
    });
  const classificador =
    dependencias.classificador ??
    criarClassificadorDeEntrada({
      cliente,
      modelo: modeloDosClassificadores,
      identificadorDeSeguranca: identificador,
    });

  // AG3: os dados que faltam agora (a configuracao do rascunho e a reserva
  // simulada viva), como o banco calcula no WhatsApp.
  const memoria: MemoriaDoSimulador = {
    reserva: anterior.memoria.reserva,
    consulta: anterior.memoria.consulta,
  };
  const reservaViva =
    memoria.reserva !== null && Date.parse(memoria.reserva.expiraEm) > entrada.agoraMs
      ? memoria.reserva
      : null;
  const vinculoDaReserva = catalogo.vinculos.find(
    (v) => v.id === reservaViva?.serviceLinkId,
  );
  const atendimento = {
    estado: anterior.estado,
    dados: {
      ...anterior.dados,
      faltam: dadosQueFaltam({
        exigidos: contexto.config.dadosExigidos,
        informados: anterior.dados,
        vinculo:
          vinculoDaReserva === undefined
            ? null
            : {
                procedimentoId: vinculoDaReserva.procedimentoId,
                convenioId: vinculoDaReserva.convenioId,
              },
        catalogo,
      }),
    },
  };

  // O custo maximo do turno, reservado antes de qualquer chamada.
  const contato =
    entrada.contato === "lead" || entrada.contato === "paciente"
      ? entrada.contato
      : null;
  const custoMaximo = custoMaximoDoTurno({
    config: contexto.config,
    catalogo,
    mensagens,
    agoraMs: entrada.agoraMs,
    fuso: entrada.fuso,
    modelo,
    modeloDosClassificadores,
    precos,
    contato,
    atendimento: atendimentoParaEstimativa({
      atendimento,
      config: contexto.config,
      catalogo,
      agoraMs: entrada.agoraMs,
      fuso: entrada.fuso,
    }),
  });
  if (custoMaximo === null) {
    log.warn("ia_simulador_sem_preco", { clinic_id: clinicId });
    return { ok: false, error: TEXTOS_DO_SIMULADOR.naoConferiuCusto };
  }
  const reserva = await reservarGasto(admin, {
    clinicId,
    origem: "simulador",
    custoMicrodolar: custoMaximo,
  });
  if (reserva.tipo === "teto") {
    // NULL e o teto ou uma trava que mudou depois da conferencia (a RPC
    // confere a liberacao de novo): o motivo exato, como antes.
    return { ok: false, error: await motivoDoBanco(admin, clinicId) };
  }
  if (reserva.tipo === "erro") {
    return { ok: false, error: TEXTOS_DO_SIMULADOR.naoConferiuCusto };
  }

  // Excecao no turno (nao deveria: ele tem a propria rede) deixa a reserva
  // inteira contando no teto, que e o lado seguro.
  const resultado: ResultadoDoTurno = await executarTurnoDoAgente({
    cliente,
    modelo,
    clinicId,
    identificadorDeSeguranca: identificador,
    config: contexto.config,
    catalogo,
    mensagens,
    agoraMs: entrada.agoraMs,
    fuso: entrada.fuso,
    verificador,
    classificador,
    contato,
    foraDoAssuntoNaJanela: foraDoAssuntoNoSimulador(falas),
    conferirTrava: () => iaPodeSimular(admin, clinicId),
    agenda: portaDaAgendaDoSimulador(admin, {
      clinicId,
      agora: () => entrada.agoraMs,
      memoria,
      atendimento,
      catalogo,
      config: contexto.config,
      fuso: entrada.fuso,
      contato,
    }),
    atendimento,
    modeloDosClassificadores,
  });

  await acertarGasto(admin, {
    reservaId: reserva.id,
    clinicId,
    origem: "simulador",
    usos: resultado.uso,
    precos,
  });

  // O horario de operacao decide no WhatsApp (E3). No simulador so avisa:
  // testar a resposta tem de funcionar a qualquer hora.
  const horario = agenteAtendeAgora(
    contexto.config.horario,
    entrada.agoraMs,
    entrada.fuso,
  );
  const trilha: PassoDoTurno[] = horario.atende
    ? [...resultado.trilha]
    : [
        { tipo: "outro", texto: TEXTOS_DO_SIMULADOR.foraDoHorario },
        ...resultado.trilha,
      ];
  // Texto da configuracao que deixou de passar nas regras: so a equipe
  // Conduzza fica sabendo pela trilha (o log ja registrou, sem texto).
  if (superAdmin && resultado.descartados.instrucoes) {
    trilha.push({
      tipo: "outro",
      texto: TEXTOS_DO_SIMULADOR.instrucoesDescartadas,
    });
  }
  if (superAdmin && resultado.descartados.itensDaBase > 0) {
    trilha.push({
      tipo: "outro",
      texto: textoDasPerguntasDescartadas(resultado.descartados.itensDaBase),
    });
  }

  // AG3: a nota que a equipe receberia na passagem (sem dado do paciente).
  if (resultado.notaParaAEquipe) {
    trilha.push({
      tipo: "equipe",
      texto: `${TEXTOS_DO_SIMULADOR.notaParaAEquipe} ${resultado.notaParaAEquipe.replace(/\n+/g, " ")}`,
    });
  }

  log.info("ia_simulador_rodou", {
    clinic_id: clinicId,
    kind: resultado.desfecho.tipo,
    count: resultado.uso.length,
  });

  const resposta: string = resultado.resposta;
  const assinatura = assinarResposta({
    chave,
    clinicId,
    userId: entrada.userId,
    falas: [...falas, { autor: "assistente", texto: resposta.trim() }],
  });
  const depois: EstadoDoSimulador = {
    estado: resultado.atendimento?.estado ?? atendimento.estado,
    dados: resultado.atendimento?.dados ?? atendimento.dados,
    memoria,
  };
  return {
    ok: true,
    resposta,
    tipo: resultado.tipo,
    trilha,
    rascunhoBloqueado: superAdmin ? resultado.rascunhoBloqueado : null,
    assinatura,
    estado: assinarEstadoDoSimulador({
      chave,
      clinicId,
      userId: entrada.userId,
      assinaturaDaResposta: assinatura,
      estado: depois,
    }),
  };
}
