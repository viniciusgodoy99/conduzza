import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { agenteAtendeAgora } from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import { iaLiberadaNoAmbiente, lerConfigDaIa } from "@/lib/ia/liberacao";
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
  assinarResposta,
  chaveDaAssinatura,
  conferirHistorico,
  type FalaAssinavel,
} from "./assinatura";
import { carregarCatalogoDoAgente, carregarConfigDoRascunho } from "./contexto";
import { acertarGasto, reservarGasto } from "./gasto";
import {
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type MensagemDaConversa,
  type PassoDoTurno,
  type ResultadoDoTurno,
} from "./laco";
import { lerPrecos, type PrecoDoModelo } from "./uso";

// Simulador da Tela 6 (E2): o MESMO turno do WhatsApp (portao de entrada,
// agente, filtro de saida), sobre o RASCUNHO da configuracao, sem caminho de
// envio: nada aqui grava em message, conversation nem ai_decision_log, e
// nenhuma funcao recebe telefone. So grava o gasto (ia_uso, origem
// "simulador"), que conta no teto diario da clinica.
//
// Travas, nesta ordem (plano de seguranca, secao 1): ambiente (T1 e T2,
// iaLiberadaNoAmbiente) e banco (ia_pode_simular, service role: lista
// fechada, interruptor geral, liberacao da clinica, pausa e teto das ultimas
// 24 horas). A trava do banco e conferida de novo antes de cada rodada do
// modelo. Quando nao pode rodar, o motivo em texto de recepcionista.
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

type Ambiente = Readonly<Record<string, string | undefined>>;

export const TEXTOS_DO_SIMULADOR = {
  semChave: "A chave da OpenAI ainda não está configurada.",
  desligadoNoAmbiente: "O assistente de IA está desligado neste ambiente.",
  soEmProducao: "O simulador só responde no ambiente de produção.",
  clinicaForaDoAmbiente:
    "Esta clínica ainda não foi liberada para o assistente neste ambiente.",
  interruptor: "O interruptor geral da IA está desligado.",
  desligadoNaClinica:
    "O assistente está desligado nesta clínica. Ligue em Configurações, na aba Agente de IA.",
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

/** Prazo da trava do banco: sem resposta, nao pode (falha fechada). */
export const PRAZO_DA_TRAVA_MS = 3_000;

/**
 * T1 e T2 (so o ambiente), com o motivo exato. null = o ambiente deixa.
 * Nunca devolve nem registra o valor de nenhuma variavel.
 */
export function motivoDoAmbiente(
  clinicId: string,
  env: Ambiente = process.env,
): string | null {
  if (iaLiberadaNoAmbiente(lerConfigDaIa(env), clinicId)) {
    return null;
  }
  if ((env.OPENAI_API_KEY ?? "").trim() === "") {
    return TEXTOS_DO_SIMULADOR.semChave;
  }
  if (env.IA_AGENTE_LIGADO !== "sim") {
    return TEXTOS_DO_SIMULADOR.desligadoNoAmbiente;
  }
  if (env.VERCEL_ENV !== "production") {
    return TEXTOS_DO_SIMULADOR.soEmProducao;
  }
  return TEXTOS_DO_SIMULADOR.clinicaForaDoAmbiente;
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
    if (
      linha === null ||
      linha.liberada !== true ||
      (linha.modo !== "simulador" && linha.modo !== "contatos")
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
  const doAmbiente = motivoDoAmbiente(clinicId, env);
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
    }
  | { ok: false; error: string };

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

  // O custo maximo do turno, reservado antes de qualquer chamada.
  const custoMaximo = custoMaximoDoTurno({
    config: contexto.config,
    catalogo,
    mensagens,
    agoraMs: entrada.agoraMs,
    fuso: entrada.fuso,
    modelo,
    modeloDosClassificadores,
    precos,
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
    conferirTrava: () => iaPodeSimular(admin, clinicId),
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

  log.info("ia_simulador_rodou", {
    clinic_id: clinicId,
    kind: resultado.desfecho.tipo,
    count: resultado.uso.length,
  });

  const resposta: string = resultado.resposta;
  return {
    ok: true,
    resposta,
    tipo: resultado.tipo,
    trilha,
    rascunhoBloqueado: superAdmin ? resultado.rascunhoBloqueado : null,
    assinatura: assinarResposta({
      chave,
      clinicId,
      userId: entrada.userId,
      falas: [...falas, { autor: "assistente", texto: resposta.trim() }],
    }),
  };
}
