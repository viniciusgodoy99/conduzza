import type { SupabaseClient } from "@supabase/supabase-js";

import { agruparPorRaia } from "@/lib/jobs/numero-de-envio";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

// Uma passagem do motor de automacao, sem processo continuo.
//
// POR QUE UM JOB POR RAIA. O espacamento anti-banimento vive em
// whatsapp_account.next_send_at, chaveado pelo NUMERO (uma linha por numero
// desde os varios numeros por clinica, docs/07): numeros NAO competem entre
// si. Dentro de um numero, o segundo job em voo seria adiado de qualquer
// jeito, entao reivindica-lo e trabalho perdido, e e a origem da reserva
// queimada que a reservar_slot_envio_v2 corrige.
//
// RAIA. A raia de um job e o numero dele, ou a clinica quando o job nao tem
// numero (integracoes, oferta da lista de espera, clinica sem numero ativo).
// O claim (claim_jobs_por_clinica, contrato da Fase 3) traz UM job por raia e
// trava a linha da raia (o numero ou a clinica) durante a propria chamada:
// dois numeros da mesma clinica andam na mesma passagem. A execucao agrupa
// do mesmo jeito (agruparPorRaia). MOTOR_MAX_CLINICAS conta RAIAS (o nome
// ficou para nao mudar a variavel de ambiente).
//
// Justica sai de graca: um numero com 200 toques cede UM job por passagem e o
// vizinho continua sendo servido na mesma passagem. Com o claim global por
// run_at, um lote inteiro sairia do mesmo numero.
//
// POR QUE TRILHO SEPARADO PARA MIDIA. Dois claims por passagem. Assim o
// download de audio nunca empurra uma confirmacao de consulta, e nunca passa
// fome: um desempate por prioridade condenaria o audio do paciente a
// inanicao silenciosa, porque job nunca tentado nao tem attempts, nao tem
// last_error e nao aparece em lugar nenhum.

/** Tipos que disputam o slot de envio do numero. */
const KINDS_DE_ENVIO = ["enviar_mensagem_ativa", "executar_passo_de_regua"];
/** Mídia nao toca o slot de envio: trilho proprio. */
const KINDS_DE_MIDIA = ["baixar_midia"];
/** Integracoes externas (Meta CAPI): nao disputam o slot anti-ban nem
 * atrasam confirmacao de consulta. */
const KINDS_DE_INTEGRACAO = ["enviar_conversao_meta", "oferecer_lista_espera"];

/**
 * Quanto tempo um job do tipo pode consumir, no pior caso analitico.
 * Serve para NAO comecar um job que nao caberia no orcamento da invocacao.
 *
 * Envio: 3s de espera curta de slot + ~0,2s de RPCs + 20s de provedor
 * (sendMenu faz DOIS requests de 10s quando o botao degrada para texto).
 * Midia: 25s de orcamento de download + parse + upload.
 */
const CUSTO_ESTIMADO_MS: Record<string, number> = {
  enviar_mensagem_ativa: 25_000,
  executar_passo_de_regua: 25_000,
  baixar_midia: 30_000,
  // 10s de timeout da CAPI + 2 retries com backoff curto + RPCs.
  enviar_conversao_meta: 15_000,
  // Orquestracao: consultas ao banco + 1 RPC; o envio sai por outro job.
  oferecer_lista_espera: 10_000,
};
const CUSTO_PADRAO_MS = 25_000;

/**
 * Prazo para COMECAR um job. Nao e um timeout: abandonar um job em voo
 * deixaria uma mensagem saindo sem ninguem para gravar o resultado. O teto
 * real e o timeout do provedor, que e duro (AbortController).
 *
 * Conta de tempo da passagem (maxDuration da rota: 60 s). As raias correm em
 * PARALELO e cada claim traz no maximo um job por raia, entao o numero de
 * raias nao alonga a passagem: o pior caso e o da raia mais cheia, com dois
 * jobs em serie (um envio e uma midia do mesmo numero, ou um envio sem numero
 * e uma integracao da mesma clinica). O primeiro comeca perto de 0 s e o
 * segundo so comeca se a estimativa dele (CUSTO_ESTIMADO_MS) ainda termina
 * ate 45 s; senao volta para a fila sem queimar tentativa. Sobram 15 s para
 * as RPCs de fechamento e a batida de ponto. Subir as raias de 4 para 8 so
 * aumenta o paralelismo: ate 8 envios, 2 midias e 2 integracoes ao mesmo
 * tempo numa invocacao.
 */
const ORCAMENTO_MS = 45_000;

/**
 * Quantas raias o claim de envio traz por passagem, sem MOTOR_MAX_CLINICAS.
 * Era 4 com a trava por clinica (cerca de 12 envios por minuto no produto
 * inteiro, achado 9 do docs/07); com a trava por numero, 8.
 */
const RAIAS_POR_PASSAGEM = 8;

/**
 * MOTOR_MAX_CLINICAS (que conta raias). Vazio, zero, negativo ou texto que
 * nao e inteiro caem no padrao: um valor torto no ambiente nao pode parar o
 * motor com um claim recusado a cada passagem.
 */
export function raiasDoAmbiente(
  valor: string | undefined = process.env.MOTOR_MAX_CLINICAS,
): number {
  const numero = Number(valor);
  return valor !== undefined &&
    valor.trim() !== "" &&
    Number.isInteger(numero) &&
    numero > 0
    ? numero
    : RAIAS_POR_PASSAGEM;
}

export type ResultadoDaPassagem = {
  reivindicados: number;
  concluidos: number;
  falhados: number;
  reagendados: number;
  sem_posse: number;
  nao_couberam: number;
};

async function reivindicar(
  admin: SupabaseClient,
  executorId: string,
  kinds: string[],
  /** Quantas raias (numero, ou clinica para job sem numero). */
  maxRaias: number,
  incluirTeste: boolean,
): Promise<Job[]> {
  const { data, error } = await admin.rpc("claim_jobs_por_clinica", {
    p_worker: executorId,
    // O nome do parametro ficou de quando a raia era a clinica.
    p_max_clinicas: maxRaias,
    p_kinds: kinds,
    p_incluir_teste: incluirTeste,
  });
  if (error) {
    log.error("motor_claim_falhou", { error_code: error.code ?? null });
    return [];
  }
  return (data ?? []) as Job[];
}

async function baterPonto(
  admin: SupabaseClient,
  ultimoLote: number,
): Promise<void> {
  const { error } = await admin.rpc("bater_ponto_do_worker", {
    p_worker_id: "motor-fila",
    p_ultimo_lote: ultimoLote,
  });
  if (error) {
    log.warn("motor_batida_falhou", { error_code: error.code ?? null });
  }
}

/**
 * Executa uma passagem completa: reivindica, roda as raias em paralelo e
 * fecha tudo no banco. Compartilhada entre a rota HTTP (producao) e o laco
 * local (desenvolvimento e testes), para os dois rodarem o MESMO codigo.
 */
export async function executarPassagemDoMotor(
  admin: SupabaseClient,
  opcoes: {
    executorId: string;
    /** Raias do claim de envio; sem ele, MOTOR_MAX_CLINICAS ou 8. */
    maxRaias?: number;
    incluirClinicasDeTeste?: boolean;
  },
): Promise<ResultadoDaPassagem> {
  const inicio = Date.now();
  const {
    executorId,
    maxRaias = raiasDoAmbiente(),
    incluirClinicasDeTeste = false,
  } = opcoes;

  // Batida de ABERTURA. Prova a corrente inteira (o agendador disparou, a
  // chamada chegou, o segredo passou, o banco respondeu) mesmo que a passagem
  // seja cortada no meio. Bater so no fim faria todo corte acender a faixa de
  // motor parado, ou seja, o diagnostico erraria justamente durante um
  // incidente do provedor.
  await baterPonto(admin, 0);

  const [envios, midias, integracoes] = await Promise.all([
    reivindicar(
      admin,
      executorId,
      KINDS_DE_ENVIO,
      maxRaias,
      incluirClinicasDeTeste,
    ),
    reivindicar(admin, executorId, KINDS_DE_MIDIA, 2, incluirClinicasDeTeste),
    reivindicar(
      admin,
      executorId,
      KINDS_DE_INTEGRACAO,
      2,
      incluirClinicasDeTeste,
    ),
  ]);

  const todos = [...envios, ...midias, ...integracoes];
  const resultado: ResultadoDaPassagem = {
    reivindicados: todos.length,
    concluidos: 0,
    falhados: 0,
    reagendados: 0,
    sem_posse: 0,
    nao_couberam: 0,
  };

  if (todos.length === 0) {
    // Fila vazia responde em milissegundos. Isso nao e otimizacao: sao
    // milhares de invocacoes por dia, e a diferenca entre 250ms e 45s e o que
    // decide se a cota do plano cabe.
    await baterPonto(admin, 0);
    return resultado;
  }

  const grupos = [...agruparPorRaia(todos).values()];

  // Raias em paralelo, jobs em serie DENTRO da raia (o slot do numero e um
  // so). try/catch POR RAIA: um numero que explode nao derruba os outros.
  await Promise.allSettled(
    grupos.map(async (jobsDaRaia) => {
      for (const job of jobsDaRaia) {
        const gasto = Date.now() - inicio;
        const custo = CUSTO_ESTIMADO_MS[job.kind] ?? CUSTO_PADRAO_MS;
        if (gasto + custo > ORCAMENTO_MS) {
          // Nao cabe: devolve sem executar e sem queimar tentativa. O proximo
          // tick pega. Na pratica isto quase nunca acontece (cada claim traz
          // um job por raia, entao quase todos comecam em t proximo de zero);
          // existe para o segundo job da raia e para o caso de uma RPC travar.
          await admin.rpc("reagendar_job", {
            p_id: job.id,
            p_worker: executorId,
            p_run_at: new Date().toISOString(),
            p_motivo: "orcamento_da_passagem",
          });
          resultado.nao_couberam += 1;
          continue;
        }
        try {
          const desfecho = await executarJobComPosse(admin, executorId, job);
          if (desfecho === "concluido") resultado.concluidos += 1;
          else if (desfecho === "falhou") resultado.falhados += 1;
          else if (desfecho === "reagendado") resultado.reagendados += 1;
          else resultado.sem_posse += 1;
        } catch {
          // executarJobComPosse ja trata as excecoes de dentro do job; isto
          // cobre falha de rede nas proprias RPCs de fechamento. O job fica
          // 'executando' e o lease de 180s o devolve.
          resultado.falhados += 1;
        }
      }
    }),
  );

  // Batida de FECHAMENTO, com o que de fato saiu.
  await baterPonto(admin, resultado.concluidos);

  log.info("motor_passagem", {
    count: resultado.reivindicados,
    duration_ms: Date.now() - inicio,
  });

  return resultado;
}
