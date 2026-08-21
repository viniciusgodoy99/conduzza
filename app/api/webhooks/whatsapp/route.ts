import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { parseInboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Webhook de entrada do WhatsApp (tarefa 1.3). O uazapi nao assina as
// chamadas, entao a validacao e pelo webhook_secret NOSSO, por clinica, na
// URL configurada na conexao. Idempotencia e concorrencia vivem no banco
// (RPC ingest_inbound_message + unique de wa_message_id).
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem de paciente em log. So ids.
//
// Quando houver SUPABASE_ACCESS_TOKEN e conta uazapi, este handler vira uma
// Edge Function fina reutilizando a MESMA RPC (ver supabase/functions/README).

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const clinicId = request.nextUrl.searchParams.get("clinic") ?? "";
  const secret = request.nextUrl.searchParams.get("secret") ?? "";
  if (!UUID_PATTERN.test(clinicId) || secret.length === 0) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: secretRow } = await admin
    .from("whatsapp_account_secret")
    .select("webhook_secret, instance_token")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!secretRow || !secretsMatch(secretRow.webhook_secret, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = parseInboundEvent(payload);
  if (!event) {
    // Evento que nao interessa (ou formato desconhecido): 200 para o
    // provedor nao reenviar em loop.
    return NextResponse.json({ ignored: true });
  }

  // Segunda camada de autenticacao: o uazapi nao assina a chamada, mas todo
  // evento carrega o token da instancia.
  //
  // A conferencia NAO pode ser opcional: antes ela so rodava se o evento
  // trouxesse o campo, entao bastava omitir `token` do corpo para pular a
  // camada inteira. Agora, se a clinica tem token guardado, o evento e
  // obrigado a trazer o token certo.
  if (secretRow.instance_token) {
    if (
      !event.instanceToken ||
      !secretsMatch(secretRow.instance_token, event.instanceToken)
    ) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (event.kind === "message_received") {
    const { data, error } = await admin.rpc("ingest_inbound_message", {
      p_clinic_id: clinicId,
      p_phone_e164: event.phone,
      p_name: event.name,
      p_wa_message_id: event.waMessageId,
      p_content_type: event.contentType,
      p_body: event.body,
      p_media_url: event.mediaUrl,
      p_transcript: null,
    });
    if (error) {
      // So ids e codigo de erro: nenhum conteudo de mensagem sai daqui.
      log.error("webhook_ingestao_falhou", {
        clinic_id: clinicId,
        wa_message_id: event.waMessageId,
        error_code: error.code ?? null,
      });
      return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
    }

    // Midia NUNCA e baixada aqui: a URL do provedor e criptografada e o
    // download demora segundos, o que estouraria o timeout do webhook e
    // provocaria reenvio. Vira job; o worker baixa e guarda no Storage.
    const resultado = data as {
      inserted?: boolean;
      message_id?: string | null;
    } | null;
    if (event.mediaUrl && resultado?.inserted && resultado.message_id) {
      const { error: erroJob } = await admin.from("job_queue").insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        payload: {
          message_id: resultado.message_id,
          wa_message_id: event.waMessageId,
        },
      });
      if (erroJob) {
        // A mensagem ja esta salva; so o arquivo fica pendente. Log e segue.
        log.error("webhook_enfileirar_midia_falhou", {
          clinic_id: clinicId,
          message_id: resultado.message_id,
          error_code: erroJob.code ?? null,
        });
      }
    }
    // TODO(3.4): enfileirar process_inbound quando o agente existir.
    return NextResponse.json(data);
  }

  if (event.kind === "message_status") {
    // O recibo do uazapi traz uma LISTA de ids por evento.
    await admin
      .from("message")
      .update({
        delivery_status: event.status,
        ...(event.errorCode ? { error_code: event.errorCode } : {}),
      })
      .eq("clinic_id", clinicId)
      .in("wa_message_id", event.waMessageIds);
    return NextResponse.json({ ok: true });
  }

  // So escreve quando o status MUDOU: o provedor reenvia o mesmo evento de
  // conexao varias vezes, e cada escrita gera evento de Realtime e linha
  // morta a toa. O filtro .neq faz o update afetar zero linhas no repeteco.
  const { data: mudou } = await admin
    .from("whatsapp_account")
    .update({
      connection_status: event.status,
      ...(event.status === "conectado"
        ? { connected_at: new Date().toISOString() }
        : {}),
      ...(event.status === "desconectado"
        ? { disconnected_at: new Date().toISOString() }
        : {}),
    })
    .eq("clinic_id", clinicId)
    .neq("connection_status", event.status)
    .select("clinic_id");

  if (mudou && mudou.length > 0) {
    // Desconexao e o proxy de qualidade neste canal (CLAUDE.md 3.3): o alerta
    // operacional nasce desta linha estruturada. Nenhum dado de paciente.
    if (event.status === "desconectado") {
      log.warn("whatsapp_desconectou", {
        clinic_id: clinicId,
        connection_status: event.status,
      });
    } else {
      log.info("whatsapp_conexao_mudou", {
        clinic_id: clinicId,
        connection_status: event.status,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
