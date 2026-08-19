import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { parseInboundEvent } from "@/lib/integrations/whatsapp/inbound";
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
    .select("webhook_secret")
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
      return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
    }
    // TODO(3.4): enfileirar process_inbound quando o agente existir.
    return NextResponse.json(data);
  }

  if (event.kind === "message_status") {
    await admin
      .from("message")
      .update({
        delivery_status: event.status,
        ...(event.errorCode ? { error_code: event.errorCode } : {}),
      })
      .eq("clinic_id", clinicId)
      .eq("wa_message_id", event.waMessageId);
    return NextResponse.json({ ok: true });
  }

  await admin
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
    .eq("clinic_id", clinicId);
  return NextResponse.json({ ok: true });
}
