import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarEventosCapi } from "@/lib/integrations/meta/capi";
import {
  montarEventoCapi,
  type ModoUserData,
} from "@/lib/integrations/meta/payload";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

// Job enviar_conversao_meta (R4): pega um conversion_event enfileirado e o
// devolve a Meta. TODA a configuracao e revalidada AQUI, na hora do envio,
// porque ela pode mudar entre o registro e a execucao (envio desligado, modo
// trocado, token removido).
//
// Retry e SEGURO neste job, ao contrario do envio de mensagem: a Meta
// deduplica por event_id + event_name. Evento ja 'enviado' responde ok
// (resposta perdida reenviada). Descartes sao definitivos e ganham codigo
// curto em conversion_event.erro, visiveis no painel de Resultados.
//
// REGRA ABSOLUTA: nenhum dado de paciente em log; o telefone e lido, hasheado
// em memoria pelo payload builder e esquecido.

const JANELA_CAPI_MS = 7 * 24 * 60 * 60 * 1000;

async function descartar(
  admin: SupabaseClient,
  eventoId: string,
  codigo: string,
): Promise<ResultadoDeJob> {
  await admin
    .from("conversion_event")
    .update({ status: "descartado", erro: codigo })
    .eq("id", eventoId);
  // Descarte e desfecho do EVENTO; para o job, e trabalho concluido.
  return { ok: true };
}

export async function executarEnvioDeConversao(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  const eventoId = job.payload.conversion_event_id;
  if (typeof eventoId !== "string") {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }

  const { data: evento, error: erroEvento } = await admin
    .from("conversion_event")
    .select(
      "id, clinic_id, contact_id, stage_chave, event_name, event_id, value_cents, currency, ctwa_clid, status, created_at",
    )
    .eq("id", eventoId)
    .eq("clinic_id", job.clinic_id)
    .maybeSingle();
  if (erroEvento) {
    return { ok: false, erro: "evento_indisponivel" };
  }
  if (!evento) {
    return { ok: false, erro: "evento_inexistente", definitivo: true };
  }
  if (evento.status === "enviado") {
    return { ok: true };
  }
  if (evento.status === "descartado" || evento.status === "falhou") {
    return { ok: true };
  }

  const [{ data: conta }, { data: secret }] = await Promise.all([
    admin
      .from("meta_ads_account")
      .select(
        "pixel_id, envio_ativado, modo_user_data, send_unmatched, test_event_code, whatsapp_business_account_id",
      )
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
    admin
      .from("meta_ads_account_secret")
      .select("capi_access_token")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
  ]);
  if (
    !conta?.envio_ativado ||
    !conta.pixel_id ||
    !conta.modo_user_data ||
    !secret?.capi_access_token
  ) {
    return descartar(admin, evento.id, "envio_desligado");
  }
  const modo = conta.modo_user_data as ModoUserData;

  if (Date.now() - new Date(evento.created_at).getTime() > JANELA_CAPI_MS) {
    return descartar(admin, evento.id, "fora_da_janela_capi");
  }

  // Sem identificador do anuncio, o evento so vale se a clinica aceitou
  // enviar conversao "sem casamento" (send_unmatched).
  if (!evento.ctwa_clid && !conta.send_unmatched) {
    return descartar(admin, evento.id, "sem_identificador");
  }

  let phoneE164: string | null = null;
  if (modo === "telefone_hasheado") {
    // Consentimento na hora do envio, como no envio de mensagem: contato que
    // revogou nao tem dado (nem hasheado) saindo daqui.
    const { data: vigente } = await admin.rpc("consentimento_vigente", {
      p_clinic_id: job.clinic_id,
      p_contact_id: evento.contact_id,
      p_channel: "whatsapp",
    });
    if (vigente !== true) {
      return descartar(admin, evento.id, "sem_consentimento");
    }
    const { data: contato } = await admin
      .from("contact")
      .select("phone_e164")
      .eq("id", evento.contact_id)
      .maybeSingle();
    phoneE164 = (contato?.phone_e164 as string | undefined) ?? null;
  }

  const montado = montarEventoCapi({
    eventName: evento.event_name,
    eventId: evento.event_id,
    eventTimeUnix: Math.floor(new Date(evento.created_at).getTime() / 1000),
    ctwaClid: evento.ctwa_clid,
    wabaId: conta.whatsapp_business_account_id ?? null,
    phoneE164,
    valueCents: evento.value_cents,
    currency: evento.currency,
    modo,
  });
  if (!montado.ok) {
    return descartar(admin, evento.id, montado.descarte);
  }

  const resultado = await enviarEventosCapi(
    {
      pixelId: conta.pixel_id,
      accessToken: secret.capi_access_token,
      testEventCode: conta.test_event_code ?? null,
    },
    [montado.evento],
  );

  if (resultado.ok) {
    await admin
      .from("conversion_event")
      .update({ status: "enviado", sent_at: new Date().toISOString(), erro: null })
      .eq("id", evento.id);
    return { ok: true };
  }

  if (!resultado.retryable) {
    // Erro nosso (token, pixel, payload): marcar e parar. So codigo em log.
    await admin
      .from("conversion_event")
      .update({ status: "falhou", erro: resultado.errorCode })
      .eq("id", evento.id);
    log.error("conversao_meta_recusada", {
      clinic_id: job.clinic_id,
      conversion_event_id: evento.id,
      error_code: resultado.errorCode,
    });
    return { ok: false, erro: resultado.errorCode, definitivo: true };
  }

  // Transitorio: o backoff do banco reagenda; o evento segue 'enfileirado'.
  return { ok: false, erro: resultado.errorCode };
}
