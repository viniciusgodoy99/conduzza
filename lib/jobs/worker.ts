import type { SupabaseClient } from "@supabase/supabase-js";

import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import {
  falhaPermiteRetry,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { log } from "@/lib/log";
import { espacamentoDeMassaMs } from "./espacamento";
import { executarPassoDeRegua } from "./regua";

// Worker da job_queue (Etapa B da auditoria de escala). Executa disparo ativo
// (confirmacao de atendimento, reguas da Fase 4) e download de midia, fora do
// caminho de request do usuario e fora do webhook.
//
// O contrato (claim atomico, lease, retry com backoff) vive no banco, nas
// funcoes claim_jobs/concluir_job/falhar_job: este arquivo e um executor
// intercambiavel. Hoje roda como processo Node no servidor 24/7
// (scripts/worker.ts); uma Edge Function agendada pode assumir depois.
//
// GARANTIAS que este worker carrega (endurecidas na revisao adversarial):
// - Mensagem NUNCA e enviada duas vezes ao paciente: a posse do claim e
//   reconferida (com renovacao de lease) ANTES de cada job, a linha de
//   message nasce antes do envio amarrada ao job (unique de job_id), e falha
//   'envio_incerto' NAO entra em retry automatico.
// - Consentimento e conferido antes de criar conversa E a cada envio, dentro
//   de sendWhatsAppText, com reconferencia depois da espera do slot.
// - last_error recebe SO codigos curtos. Nunca conteudo de mensagem.

export const MIDIA_BUCKET = "midia-conversas";

// Tipos de arquivo aceitos no Storage; o mimetype vem do provedor e nao e
// confiavel, entao fora da lista vira binario generico.
const MIMETYPES_ACEITOS = /^(audio|image|video)\/[\w.+-]+$|^application\/pdf$/;

export type Job = {
  id: string;
  clinic_id: string;
  kind: "enviar_mensagem_ativa" | "baixar_midia" | "executar_passo_de_regua";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/**
 * Resultado de um job. O terceiro braco e o "ainda nao": o toque de regua caiu
 * FORA da janela de envio da clinica, o que nao e sucesso nem falha. O worker
 * chama reagendar_job com a data ISO devolvida, e a tentativa NAO e queimada
 * (fora da janela um toque de 72h morreria em 5 passagens do backoff).
 */
export type ResultadoDeJob =
  | { ok: true }
  | { ok: false; erro: string; definitivo?: boolean }
  // `motivo` alimenta job_queue.ultimo_motivo_devolucao: sem ele, um job que
  // vai e volta sem nunca executar fica indistinguivel de um job saudavel
  // esperando a hora.
  | { reagendar: string; motivo?: string };

async function executarEnvioAtivo(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  const contactId = job.payload.contact_id;
  const body = job.payload.body;
  if (
    typeof contactId !== "string" ||
    typeof body !== "string" ||
    !body.trim()
  ) {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }

  // Consentimento ANTES de qualquer efeito colateral: contato que revogou nao
  // ganha nem conversa aberta. sendWhatsAppText reconfere na hora do envio.
  const { data: vigente } = await admin.rpc("consentimento_vigente", {
    p_clinic_id: job.clinic_id,
    p_contact_id: contactId,
    p_channel: "whatsapp",
  });
  if (vigente !== true) {
    await admin.from("audit_log").insert({
      clinic_id: job.clinic_id,
      user_id: null,
      action: "envio_bloqueado_sem_autorizacao",
      entity: "contact",
      entity_id: contactId,
    });
    return { ok: false, erro: "sem_consentimento", definitivo: true };
  }

  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "garantir_conversa_aberta",
    { p_clinic_id: job.clinic_id, p_contact_id: contactId },
  );
  if (erroConversa || typeof conversationId !== "string") {
    return { ok: false, erro: "conversa_indisponivel" };
  }

  const resultado = await sendWhatsAppText(admin, {
    clinicId: job.clinic_id,
    conversationId,
    contactId,
    body,
    authorUserId: null,
    author: "sistema",
    espacamentoMs: espacamentoDeMassaMs(),
    // Teto CURTO de proposito. O piso do espacamento de massa e 10 segundos,
    // entao quase todo job concorrente cai em adiamento e nao em espera. Os 3
    // segundos cobrem so a poeira. Esperar de verdade nao cabe num ambiente
    // sem servidor, e o adiamento nao custa nada (nada e reservado).
    esperaMaximaMs: 3_000,
    jobId: job.id,
  });

  if (resultado.ok) {
    return { ok: true };
  }
  // Canal ocupado: devolve o job para quando o canal abre. Nao e falha e nao
  // queima tentativa; nenhuma reserva foi feita.
  if (resultado.reason === "slot_adiado") {
    return {
      reagendar: resultado.livreEm ?? new Date(Date.now() + 20_000).toISOString(),
      motivo: "canal_ocupado",
    };
  }
  // Retry de envio ja processado: nada a fazer, o job conclui.
  if (resultado.reason === "ja_enviado") {
    return { ok: true };
  }
  if (resultado.reason === "sem_consentimento") {
    return {
      ok: false,
      erro: resultado.code ?? "sem_consentimento",
      definitivo: true,
    };
  }
  // So entra em retry o que COM CERTEZA nao chegou ao paciente. O ambiguo
  // ('envio_incerto') morre definitivo e fica visivel para revisao humana.
  const podeRepetir =
    resultado.reason === "desconectado" || falhaPermiteRetry(resultado.code);
  return {
    ok: false,
    erro: resultado.code ?? resultado.reason,
    definitivo: !podeRepetir,
  };
}

async function executarDownloadDeMidia(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  const messageId = job.payload.message_id;
  const waMessageId = job.payload.wa_message_id;
  if (typeof messageId !== "string" || typeof waMessageId !== "string") {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }

  const { data: mensagem } = await admin
    .from("message")
    .select("id, content_type, transcript")
    .eq("clinic_id", job.clinic_id)
    .eq("id", messageId)
    .maybeSingle();
  if (!mensagem) {
    return { ok: false, erro: "mensagem_nao_encontrada", definitivo: true };
  }

  const [{ data: account }, { data: secret }] = await Promise.all([
    admin
      .from("whatsapp_account")
      .select("provider, server_url, instance_id")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
    admin
      .from("whatsapp_account_secret")
      .select("instance_token")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
  ]);

  const provider = getWhatsAppProvider(account?.provider);
  const baixado = await provider
    .downloadMedia(
      {
        clinicId: job.clinic_id,
        serverUrl: account?.server_url ?? null,
        instanceToken: secret?.instance_token ?? null,
        instanceId: account?.instance_id ?? null,
      },
      waMessageId,
      { transcribe: mensagem.content_type === "audio" },
    )
    .catch(() => ({
      ok: false as const,
      errorCode: "download_indisponivel",
      message: "",
    }));
  if (!baixado.ok) {
    // A midia expira no provedor em poucos dias: retry cedo vale a pena.
    return { ok: false, erro: `download:${baixado.errorCode}` };
  }

  const contentType = MIMETYPES_ACEITOS.test(baixado.mimetype)
    ? baixado.mimetype
    : "application/octet-stream";
  const caminho = `${job.clinic_id}/${messageId}`;
  const { error: erroUpload } = await admin.storage
    .from(MIDIA_BUCKET)
    .upload(caminho, Buffer.from(baixado.base64, "base64"), {
      contentType,
      upsert: true,
      // Sem isto o padrao do Supabase e uma hora, e foto ou audio de PACIENTE
      // ficaria no cache de disco do computador compartilhado da recepcao
      // mesmo depois de a pessoa sair do sistema. O no-store da rota de midia
      // so alcanca o redirecionamento, nao os bytes, que vem do Storage com o
      // cabecalho gravado aqui.
      cacheControl: "0",
    });
  if (erroUpload) {
    return { ok: false, erro: "storage_falhou" };
  }

  const { error: erroUpdate } = await admin
    .from("message")
    .update({
      media_url: `storage://${MIDIA_BUCKET}/${caminho}`,
      ...(baixado.transcript && !mensagem.transcript
        ? { transcript: baixado.transcript }
        : {}),
    })
    .eq("id", messageId);
  if (erroUpdate) {
    return { ok: false, erro: "atualizacao_falhou" };
  }
  return { ok: true };
}

async function executarJob(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  switch (job.kind) {
    case "enviar_mensagem_ativa":
      return executarEnvioAtivo(admin, job);
    case "baixar_midia":
      return executarDownloadDeMidia(admin, job);
    case "executar_passo_de_regua":
      return executarPassoDeRegua(admin, job);
    default:
      return { ok: false, erro: "tipo_desconhecido", definitivo: true };
  }
}

/**
 * Reivindica e executa um lote de jobs. Devolve quantos processou (0 quando a
 * fila esta vazia, para o laco de fora decidir a pausa).
 */
export async function processarLote(
  admin: SupabaseClient,
  workerId: string,
  opcoes: { limite?: number; deveParar?: () => boolean } = {},
): Promise<number> {
  const { limite = 3, deveParar } = opcoes;
  const { data: jobs, error } = await admin.rpc("claim_jobs", {
    p_worker: workerId,
    p_limit: limite,
  });
  if (error) {
    log.error("worker_claim_falhou", { error_code: error.code ?? null });
    return 0;
  }
  const lote = (jobs ?? []) as Job[];

  for (const job of lote) {
    // Parada limpa entre jobs: um SIGTERM nao espera o lote inteiro. O job
    // nao executado continua 'executando' ate o lease vencer e outro worker
    // assumir, sem perda (a posse dele sera conferivel).
    if (deveParar?.()) {
      break;
    }

    await executarJobComPosse(admin, workerId, job);
  }
  return lote.length;
}

/** O que aconteceu com um job depois de reivindicado. */
export type DesfechoDoJob =
  | "concluido"
  | "falhou"
  | "reagendado"
  | "sem_posse";

/**
 * Executa UM job ja reivindicado: confere a posse, roda, e fecha no banco.
 *
 * Vive separado do laco porque agora tem dois chamadores: o laco local
 * (processarLote) e a passagem do motor sem servidor (lib/jobs/motor.ts).
 * Duplicar isto seria duplicar a decisao de concluir, falhar ou devolver, que
 * e onde mora o risco de mandar a mesma mensagem duas vezes ao paciente.
 */
export async function executarJobComPosse(
  admin: SupabaseClient,
  workerId: string,
  job: Job,
): Promise<DesfechoDoJob> {
  // POSSE + HEARTBEAT: renova o lease e confirma que este worker ainda e o
  // dono. Se o lease venceu no meio do lote e outro worker assumiu, PULAR:
  // executar aqui seria a execucao dupla que duplica mensagem ao paciente.
  const { data: possui } = await admin.rpc("confirmar_posse_job", {
    p_id: job.id,
    p_worker: workerId,
  });
  if (possui !== true) {
    log.warn("job_pulado_sem_posse", {
      job_id: job.id,
      kind: job.kind,
      clinic_id: job.clinic_id,
    });
    return "sem_posse";
  }

  const inicio = Date.now();
  let resultado: ResultadoDeJob;
  try {
    resultado = await executarJob(admin, job);
  } catch {
    resultado = { ok: false, erro: "excecao_no_worker" };
  }

  if ("reagendar" in resultado) {
    // Fora da janela de envio, ou canal ocupado: devolve o job para depois SEM
    // contar como tentativa e SEM concluir (o toque ainda nao aconteceu).
    const { error: erroReagendar } = await admin.rpc("reagendar_job", {
      p_id: job.id,
      p_worker: workerId,
      p_run_at: resultado.reagendar,
      p_motivo: resultado.motivo ?? null,
    });
    if (erroReagendar) {
      log.warn("job_reagendar_falhou", {
        job_id: job.id,
        kind: job.kind,
        error_code: erroReagendar.code ?? null,
      });
      return "falhou";
    }
    log.info("job_reagendado", {
      job_id: job.id,
      kind: job.kind,
      clinic_id: job.clinic_id,
    });
    return "reagendado";
  }

  if (resultado.ok) {
    const { error: erroConcluir } = await admin.rpc("concluir_job", {
      p_id: job.id,
      p_worker: workerId,
    });
    if (erroConcluir) {
      // Nao seguir calado: um conclude perdido deixaria o job elegivel de
      // novo. A idempotencia por job_id segura o reenvio, mas o log avisa.
      log.error("worker_concluir_falhou", {
        job_id: job.id,
        error_code: erroConcluir.code ?? null,
      });
    }
    log.info("job_concluido", {
      job_id: job.id,
      kind: job.kind,
      clinic_id: job.clinic_id,
      duration_ms: Date.now() - inicio,
    });
    return "concluido";
  }

  await admin.rpc("falhar_job", {
    p_id: job.id,
    p_erro: resultado.erro,
    p_definitivo: resultado.definitivo ?? false,
    p_worker: workerId,
  });
  log.warn("job_falhou", {
    job_id: job.id,
    kind: job.kind,
    clinic_id: job.clinic_id,
    error_code: resultado.erro,
    attempt: job.attempts,
  });
  return "falhou";
}

/** Garante o bucket privado de midia (idempotente; roda na subida do worker). */
export async function garantirBucketDeMidia(
  admin: SupabaseClient,
): Promise<void> {
  const { error } = await admin.storage.createBucket(MIDIA_BUCKET, {
    public: false,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(
      `Não foi possível criar o bucket de mídia: ${error.message}`,
    );
  }
  if (error) {
    // Ja existia: confere que continua PRIVADO (midia de paciente).
    const { error: erroUpdate } = await admin.storage.updateBucket(
      MIDIA_BUCKET,
      { public: false },
    );
    if (erroUpdate) {
      throw new Error(
        `Não foi possível confirmar a privacidade do bucket de mídia: ${erroUpdate.message}`,
      );
    }
  }
}
