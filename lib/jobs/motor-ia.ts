import type { SupabaseClient } from "@supabase/supabase-js";

import { lerConfigDaIaDoBanco, type ConfigDaIa } from "@/lib/ia/liberacao";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  dependenciasPadraoDaIa,
  exigirForaDeProducao,
  type DependenciasDoExecutorDaIa,
} from "./responder-com-ia";
import { executarJobComPosse, type Job } from "./worker";

// Uma passagem do motor da IA (E3), chamada pela rota /api/webhooks/motor-ia
// (o pg_cron so a dispara quando ha trabalho devido de clinica da lista,
// disparar_ciclo_da_ia). Separada do motor principal: o turno da IA dura ate
// 45 s e nao pode atrasar regua, confirmacao nem midia.
//
//  - Sem T1 (producao com a chave da OpenAI) nada e reivindicado.
//  - T2 (onda 1): a lista das clinicas com o agente habilitado e lida do
//    banco UMA vez por passagem (ia_clinicas_da_fase_controlada, sem
//    clinica suspensa) e a MESMA lista vai ao claim e ao executor. Lista
//    que nao deu para ler: nada e reivindicado.
//  - claim_jobs_da_ia traz ate 4 jobs, no maximo um por conversa, so de
//    clinica da lista (T2 aqui e no banco) e nunca e_de_teste em
//    producao. Lease de 90 s.
//  - Um executor por invocacao ('motor-ia:<uuid>', criado pela rota): duas
//    invocacoes sobrepostas nunca se confundem na posse.
//  - Cada job roda no proprio grupo, em paralelo, por executarJobComPosse
//    (posse, conclusao, retry e fechamento num lugar so), com o prazo da
//    invocacao: o executor guarda 14 s para o envio.
//
// Log so com contagens e codigos.

/** Jobs por passagem (o banco limita a 8). */
const JOBS_POR_PASSAGEM = 4;

export type ResumoDaPassagemDaIa = {
  reivindicados: number;
  concluidos: number;
  falhos: number;
  reagendados: number;
  semPosse: number;
};

async function baterPonto(
  admin: SupabaseClient,
  ultimoLote: number,
): Promise<void> {
  const { error } = await admin.rpc("bater_ponto_do_worker", {
    p_worker_id: "motor-ia",
    p_ultimo_lote: ultimoLote,
  });
  if (error) {
    log.warn("motor_ia_batida_falhou", { error_code: error.code ?? null });
  }
}

/**
 * T1 e T2 da passagem: a config injetada (so as suites) ou o ambiente com a
 * lista lida do banco agora (sem T1, nem le). null: a lista nao deu para
 * ler (erro ou formato estranho).
 */
async function configDaPassagem(
  admin: SupabaseClient,
  injetada: ConfigDaIa | undefined,
): Promise<ConfigDaIa | null> {
  if (injetada !== undefined) {
    return injetada;
  }
  try {
    return await lerConfigDaIaDoBanco(admin);
  } catch {
    return null;
  }
}

export async function executarPassagemDaIa(opcoes: {
  executorId: string;
  prazoFinalMs: number;
  incluirClinicasDeTeste?: boolean;
  dependencias?: Partial<DependenciasDoExecutorDaIa>;
  /**
   * Padrao true (a rota de producao nao passa nada). As suites passam
   * false: a batida 'motor-ia' fica em worker_heartbeat, tabela global que
   * a higiene protege, e a saude da producao mostraria batida recente de um
   * teste (revisao do E3).
   */
  baterPonto?: boolean;
}): Promise<ResumoDaPassagemDaIa> {
  exigirForaDeProducao(opcoes.incluirClinicasDeTeste);
  const inicio = Date.now();
  const admin = opcoes.dependencias?.admin ?? createAdminClient();
  const resumo: ResumoDaPassagemDaIa = {
    reivindicados: 0,
    concluidos: 0,
    falhos: 0,
    reagendados: 0,
    semPosse: 0,
  };

  const deveBaterPonto = opcoes.baterPonto !== false;
  if (deveBaterPonto) {
    await baterPonto(admin, 0);
  }

  // T1 e T2 desta passagem (as suites injetam a config pronta). Lista que
  // nao deu para ler: nada e reivindicado, como sem T1.
  const config = await configDaPassagem(admin, opcoes.dependencias?.config);
  if (config === null) {
    log.error("motor_ia_lista_ilegivel", { count: 0 });
    return resumo;
  }

  // T1: fora da producao com a chave, ou sem nenhuma clinica na lista, nada
  // e reivindicado (o job continua pendente e a varredura devolve a
  // conversa para a equipe em 3 minutos).
  if (!config.ligado || config.clinicas.length === 0) {
    log.warn("motor_ia_fora_do_ambiente", { count: 0 });
    return resumo;
  }

  // O executor confere a MESMA lista que foi ao claim (iaLiberadaNoAmbiente).
  const dependencias: DependenciasDoExecutorDaIa = {
    ...dependenciasPadraoDaIa({ admin, prazoFinalMs: opcoes.prazoFinalMs }),
    ...opcoes.dependencias,
    admin,
    config,
    prazoFinalMs: opcoes.prazoFinalMs,
    incluirClinicasDeTeste: opcoes.incluirClinicasDeTeste === true,
  };

  const { data, error } = await admin.rpc("claim_jobs_da_ia", {
    p_worker: opcoes.executorId,
    p_max: JOBS_POR_PASSAGEM,
    p_clinic_ids: [...config.clinicas],
    p_incluir_teste: opcoes.incluirClinicasDeTeste === true,
  });
  if (error) {
    log.error("motor_ia_claim_falhou", { error_code: error.code ?? null });
    return resumo;
  }
  const jobs = ((data ?? []) as Job[]).slice(0, JOBS_POR_PASSAGEM);
  resumo.reivindicados = jobs.length;
  if (jobs.length === 0) {
    return resumo;
  }

  await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        const desfecho = await executarJobComPosse(
          admin,
          opcoes.executorId,
          job,
          {
            prazoFinalMs: opcoes.prazoFinalMs,
            dependenciasDaIa: dependencias,
          },
        );
        if (desfecho === "concluido") resumo.concluidos += 1;
        else if (desfecho === "falhou") resumo.falhos += 1;
        else if (desfecho === "reagendado") resumo.reagendados += 1;
        else resumo.semPosse += 1;
      } catch {
        // Falha de rede nas RPCs de fechamento: o job fica 'executando' e o
        // lease de 90 s o devolve para a fila.
        resumo.falhos += 1;
      }
    }),
  );

  if (deveBaterPonto) {
    await baterPonto(admin, resumo.concluidos);
  }
  log.info("motor_ia_passagem", {
    count: resumo.reivindicados,
    duration_ms: Date.now() - inicio,
  });
  return resumo;
}
