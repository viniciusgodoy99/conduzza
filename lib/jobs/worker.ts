import type { SupabaseClient } from "@supabase/supabase-js";

import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import {
  falhaPermiteRetry,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { log } from "@/lib/log";
import {
  classificarFalhaDeUpload,
  marcaDeIndisponivel,
  motivoDaDesistencia,
  normalizarMimetype,
} from "@/lib/domain/midia-recebida";
import { executarEnvioDeConversao } from "./conversao-meta";
import {
  executarOfertaDeEspera,
  situacaoDoEnvioDeOferta,
} from "./lista-espera";
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
  kind:
    | "enviar_mensagem_ativa"
    | "baixar_midia"
    | "executar_passo_de_regua"
    | "enviar_conversao_meta"
    | "oferecer_lista_espera";
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

  // Mensagem de uma onda da lista de espera: so sai enquanto a oferta vale
  // (aberta, metade da janela pela frente, vaga livre). Oferta cancelada,
  // preenchida, vencida no retry da desconexao ou com a vaga ocupada encerra
  // o envio sem mandar nada ao paciente, antes de qualquer efeito colateral.
  const offerId = job.payload.offer_id;
  if (offerId !== undefined && offerId !== null) {
    if (typeof offerId !== "string") {
      return { ok: false, erro: "payload_invalido", definitivo: true };
    }
    const situacao = await situacaoDoEnvioDeOferta(
      admin,
      job.clinic_id,
      offerId,
      contactId,
    );
    if (situacao === "leitura_falhou") {
      return { ok: false, erro: "leitura_falhou" };
    }
    if (situacao === "encerrada") {
      return { ok: false, erro: "oferta_encerrada", definitivo: true };
    }
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

  // Eco ao paciente ("Presença confirmada", "Tudo bem, sua consulta foi
  // cancelada"): responde a um toque do PROPRIO paciente, entao impoe ao
  // proximo envio so o espacamento curto do 1:1, e nao os 10 a 30 s da
  // massa. Continua no trilho automatico (espera o slot de massa em vez de
  // furar a fila das outras mensagens automaticas). A marca vem de
  // interceptar-resposta.ts; oferta de espera e aviso de remarcacao nao a
  // tem e seguem com o espacamento de massa.
  const respostaAoPaciente = job.payload.resposta_ao_paciente === true;
  const resultado = await sendWhatsAppText(admin, {
    clinicId: job.clinic_id,
    conversationId,
    contactId,
    body,
    authorUserId: null,
    author: "sistema",
    envioAutomatico: true,
    ...(respostaAoPaciente ? {} : { espacamentoMs: espacamentoDeMassaMs() }),
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
      reagendar:
        resultado.livreEm ?? new Date(Date.now() + 20_000).toISOString(),
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

// Falhas em que a mensagem nao tem o que marcar: sumiu, foi apagada (a lapide
// ja diz o que aconteceu) ou o payload nem aponta para uma.
const DESISTENCIAS_SEM_MARCA = new Set([
  "mensagem_apagada",
  "mensagem_nao_encontrada",
  "payload_invalido",
]);

/**
 * Baixa a midia e, quando o job DESISTE de vez, deixa isso escrito na
 * mensagem (media_url = indisponivel://<motivo>).
 *
 * Sem a marca, a bolha dizia "Baixando o arquivo" para sempre: o job morria
 * como 'falhou' na fila e nada voltava a olhar a linha. Desistir e o erro
 * definitivo ou a ultima tentativa (o claim ja somou esta em attempts).
 */
async function executarDownloadDeMidia(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  let resultado: ResultadoDeJob;
  try {
    resultado = await baixarEGuardarMidia(admin, job);
  } catch {
    resultado = { ok: false, erro: "excecao_no_worker" };
  }
  if (
    "ok" in resultado &&
    !resultado.ok &&
    !DESISTENCIAS_SEM_MARCA.has(resultado.erro) &&
    (resultado.definitivo === true || job.attempts >= job.max_attempts)
  ) {
    await marcarMidiaIndisponivel(admin, job, resultado.erro);
  }
  return resultado;
}

async function marcarMidiaIndisponivel(
  admin: SupabaseClient,
  job: Job,
  erro: string,
): Promise<void> {
  const messageId = job.payload.message_id;
  if (typeof messageId !== "string") {
    return;
  }
  // Releitura na hora: um arquivo que ja esta no balde (execucao dupla depois
  // de lease vencido) nunca e rebaixado a indisponivel, e mensagem apagada
  // fica como esta.
  const { data: atual } = await admin
    .from("message")
    .select("media_url, deleted_at")
    .eq("clinic_id", job.clinic_id)
    .eq("id", messageId)
    .maybeSingle();
  if (
    !atual ||
    atual.deleted_at ||
    (typeof atual.media_url === "string" &&
      atual.media_url.startsWith("storage://"))
  ) {
    return;
  }
  if (erro === "atualizacao_falhou") {
    // O arquivo subiu mas a linha nunca passou a apontar para ele: sem dono,
    // e arquivo de paciente guardado sem motivo e sem trilha.
    await admin.storage
      .from(MIDIA_BUCKET)
      .remove([`${job.clinic_id}/${messageId}`]);
  }
  const { error } = await admin
    .from("message")
    .update({ media_url: marcaDeIndisponivel(motivoDaDesistencia(erro)) })
    .eq("clinic_id", job.clinic_id)
    .eq("id", messageId)
    .is("deleted_at", null);
  if (error) {
    log.error("worker_midia_marca_falhou", {
      job_id: job.id,
      clinic_id: job.clinic_id,
      message_id: messageId,
      error_code: error.code ?? null,
    });
  }
}

async function baixarEGuardarMidia(
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
    .select("id, content_type, transcript, deleted_at")
    .eq("clinic_id", job.clinic_id)
    .eq("id", messageId)
    .maybeSingle();
  if (!mensagem) {
    return { ok: false, erro: "mensagem_nao_encontrada", definitivo: true };
  }
  // A mensagem foi apagada entre o enfileiramento e agora.
  //
  // Sem esta conferencia o download continuava: o paciente revogava a foto, o
  // worker a baixava segundos depois, gravava no acervo e devolvia media_url e
  // transcript para a linha que o apagamento acabara de anular. O resultado era
  // o contrario exato do pedido, e permanente, porque nada mais volta a olhar
  // essa linha. Definitivo, nao retry: apagada nao desapaga.
  if (mensagem.deleted_at) {
    return { ok: false, erro: "mensagem_apagada", definitivo: true };
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
    // A midia expira no provedor em poucos dias: retry cedo vale a pena. A
    // excecao e o arquivo acima do teto de download (413 local): o tamanho
    // nao muda na proxima tentativa.
    return {
      ok: false,
      erro: `download:${baixado.errorCode}`,
      definitivo: baixado.errorCode === "uazapi_download_413",
    };
  }

  // O tipo REAL fica na mensagem (media_mimetype), mesmo quando o Storage
  // recebe binario generico: e ele que escolhe foto ou video na bolha e a
  // extensao do download. Perde-lo fazia toda planilha baixar como .pdf.
  const tipoReal = normalizarMimetype(baixado.mimetype);
  // SVG fica de fora mesmo sendo image/*: aberto em navegacao de topo no
  // dominio do Storage, executa script.
  const contentType =
    tipoReal && tipoReal !== "image/svg+xml" && MIMETYPES_ACEITOS.test(tipoReal)
      ? tipoReal
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
    // O codigo real vai para last_error (so status e codigo do Storage, nunca
    // a mensagem): sem ele, 7 documentos morreram como 'storage_falhou' sem
    // pista nenhuma da causa. Erro do ARQUIVO (tamanho, pedido invalido) e
    // definitivo; repetir 8 vezes ao longo de uma hora nao muda nada.
    const falha = classificarFalhaDeUpload(erroUpload);
    log.error("worker_midia_upload_falhou", {
      job_id: job.id,
      clinic_id: job.clinic_id,
      message_id: messageId,
      error_code: falha.erro,
      attempt: job.attempts,
    });
    return { ok: false, erro: falha.erro, definitivo: falha.definitivo };
  }

  // O download demora dezenas de segundos, e alguem pode ter apagado a
  // mensagem nesse meio tempo. O `is deleted_at null` faz a escrita afetar
  // zero linhas nesse caso, em vez de repor o conteudo apagado.
  const { data: atualizadas, error: erroUpdate } = await admin
    .from("message")
    .update({
      media_url: `storage://${MIDIA_BUCKET}/${caminho}`,
      ...(tipoReal ? { media_mimetype: tipoReal } : {}),
      ...(baixado.transcript && !mensagem.transcript
        ? { transcript: baixado.transcript }
        : {}),
    })
    .eq("id", messageId)
    .is("deleted_at", null)
    .select("id");
  if (erroUpdate) {
    return { ok: false, erro: "atualizacao_falhou" };
  }
  if (!atualizadas || atualizadas.length === 0) {
    // Apagada durante o download: o arquivo que acabou de subir nao tem mais
    // dono, e arquivo de paciente sem linha apontando para ele e dado guardado
    // sem motivo e sem trilha.
    await admin.storage.from(MIDIA_BUCKET).remove([caminho]);
    return { ok: false, erro: "mensagem_apagada", definitivo: true };
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
    case "enviar_conversao_meta":
      return executarEnvioDeConversao(admin, job);
    case "oferecer_lista_espera":
      return executarOfertaDeEspera(admin, job);
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
export type DesfechoDoJob = "concluido" | "falhou" | "reagendado" | "sem_posse";

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
