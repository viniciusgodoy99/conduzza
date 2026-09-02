import type { SupabaseClient } from "@supabase/supabase-js";

import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

// Uma passagem do motor de automacao, sem processo continuo.
//
// POR QUE UM JOB POR CLINICA. O espacamento anti-banimento vive em
// whatsapp_account.next_send_at, chaveado por clinic_id: clinicas NAO competem
// entre si. Dentro de uma clinica, o segundo job em voo seria adiado de
// qualquer jeito, entao reivindica-lo e trabalho perdido, e e a origem da
// reserva queimada que a reservar_slot_envio_v2 corrige.
//
// Justica sai de graca: uma clinica com 200 toques cede UM job por passagem e
// a vizinha continua sendo servida na mesma passagem. Com o claim global por
// run_at, um lote inteiro sairia da mesma clinica.
//
// POR QUE TRILHO SEPARADO PARA MIDIA. Dois claims por passagem. Assim o
// download de audio nunca empurra uma confirmacao de consulta, e nunca passa
// fome: um desempate por prioridade condenaria o audio do paciente a
// inanicao silenciosa, porque job nunca tentado nao tem attempts, nao tem
// last_error e nao aparece em lugar nenhum.

/** Tipos que disputam o slot de envio da clinica. */
const KINDS_DE_ENVIO = ["enviar_mensagem_ativa", "executar_passo_de_regua"];
/** Mídia nao toca o slot de envio: trilho proprio. */
const KINDS_DE_MIDIA = ["baixar_midia"];

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
};
const CUSTO_PADRAO_MS = 25_000;

/**
 * Prazo para COMECAR um job. Nao e um timeout: abandonar um job em voo
 * deixaria uma mensagem saindo sem ninguem para gravar o resultado. O teto
 * real e o timeout do provedor, que e duro (AbortController).
 */
const ORCAMENTO_MS = 45_000;

export type ResultadoDaPassagem = {
  reivindicados: number;
  concluidos: number;
  falhados: number;
  reagendados: number;
  sem_posse: number;
  nao_couberam: number;
};

function agruparPorClinica(jobs: Job[]): Map<string, Job[]> {
  const grupos = new Map<string, Job[]>();
  for (const job of jobs) {
    const atual = grupos.get(job.clinic_id);
    if (atual) {
      atual.push(job);
    } else {
      grupos.set(job.clinic_id, [job]);
    }
  }
  return grupos;
}

async function reivindicar(
  admin: SupabaseClient,
  executorId: string,
  kinds: string[],
  maxClinicas: number,
  incluirTeste: boolean,
): Promise<Job[]> {
  const { data, error } = await admin.rpc("claim_jobs_por_clinica", {
    p_worker: executorId,
    p_max_clinicas: maxClinicas,
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
 * Executa uma passagem completa: reivindica, roda as clinicas em paralelo e
 * fecha tudo no banco. Compartilhada entre a rota HTTP (producao) e o laco
 * local (desenvolvimento e testes), para os dois rodarem o MESMO codigo.
 */
export async function executarPassagemDoMotor(
  admin: SupabaseClient,
  opcoes: {
    executorId: string;
    maxClinicas?: number;
    incluirClinicasDeTeste?: boolean;
  },
): Promise<ResultadoDaPassagem> {
  const inicio = Date.now();
  const {
    executorId,
    maxClinicas = Number(process.env.MOTOR_MAX_CLINICAS ?? 4),
    incluirClinicasDeTeste = false,
  } = opcoes;

  // Batida de ABERTURA. Prova a corrente inteira (o agendador disparou, a
  // chamada chegou, o segredo passou, o banco respondeu) mesmo que a passagem
  // seja cortada no meio. Bater so no fim faria todo corte acender a faixa de
  // motor parado, ou seja, o diagnostico erraria justamente durante um
  // incidente do provedor.
  await baterPonto(admin, 0);

  const [envios, midias] = await Promise.all([
    reivindicar(
      admin,
      executorId,
      KINDS_DE_ENVIO,
      maxClinicas,
      incluirClinicasDeTeste,
    ),
    reivindicar(admin, executorId, KINDS_DE_MIDIA, 2, incluirClinicasDeTeste),
  ]);

  const todos = [...envios, ...midias];
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

  const grupos = [...agruparPorClinica(todos).values()];

  // Grupos em paralelo, jobs em serie DENTRO do grupo (o slot da clinica e um
  // so). try/catch POR GRUPO: uma clinica que explode nao derruba as outras.
  await Promise.allSettled(
    grupos.map(async (jobsDaClinica) => {
      for (const job of jobsDaClinica) {
        const gasto = Date.now() - inicio;
        const custo = CUSTO_ESTIMADO_MS[job.kind] ?? CUSTO_PADRAO_MS;
        if (gasto + custo > ORCAMENTO_MS) {
          // Nao cabe: devolve sem executar e sem queimar tentativa. O proximo
          // tick pega. Na pratica isto quase nunca acontece (o claim traz um
          // job por clinica, entao todos comecam em t proximo de zero); existe
          // para o caso de uma RPC travar.
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
