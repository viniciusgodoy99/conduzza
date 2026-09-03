import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { parseInboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
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
    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      event,
    );
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
    if (event.mediaUrl && data?.inserted && data.message_id) {
      const { error: erroJob } = await admin.from("job_queue").insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        payload: {
          message_id: data.message_id,
          wa_message_id: event.waMessageId,
        },
      });
      if (erroJob) {
        // A mensagem ja esta salva; so o arquivo fica pendente. Log e segue.
        log.error("webhook_enfileirar_midia_falhou", {
          clinic_id: clinicId,
          message_id: data.message_id,
          error_code: erroJob.code ?? null,
        });
      }
    }
    // Resposta ao toque de confirmacao (tarefa 4.7): "1", "Confirmar" ou um
    // joinha mudam o status da agenda sozinhos. Guardado por data.inserted
    // porque o provedor reentrega o mesmo evento, e reentrega nao pode
    // confirmar duas vezes. Nunca derruba o 200: a mensagem ja esta salva e
    // um erro aqui viraria reenvio em loop.
    if (data?.inserted && data.contact_id && data.conversation_id) {
      try {
        await interceptarRespostaDePaciente(admin, {
          clinicId,
          contactId: data.contact_id,
          conversationId: data.conversation_id,
          body: event.body,
          contentType: event.contentType,
        });
      } catch {
        log.error("webhook_interceptar_resposta_falhou", {
          clinic_id: clinicId,
          wa_message_id: event.waMessageId,
        });
      }
    }
    return NextResponse.json(data);
  }

  // A clinica respondeu pelo celular pareado, por fora do sistema. Nao vira
  // mensagem na conversa (nao temos o corpo de forma confiavel e ele nao passou
  // por aqui), mas a conversa PRECISA sair do contador de espera: senao outra
  // atendente ve a pergunta como "sem resposta" e responde de novo, e o
  // paciente recebe duas respostas para a mesma coisa.
  if (event.kind === "clinic_device_reply") {
    const { data: contato } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_e164", event.phone)
      .maybeSingle();
    if (contato) {
      await admin
        .from("conversation")
        .update({ awaiting_reply: false })
        .eq("clinic_id", clinicId)
        .eq("contact_id", contato.id)
        .neq("status", "resolvida");
    }
    return NextResponse.json({ ok: true });
  }

  // Uma mensagem foi apagada para todos no WhatsApp. A conversa da clinica
  // precisa acompanhar: continuar exibindo o texto faria a recepcao responder a
  // algo que, para quem escreveu, ja nao existe.
  //
  // Este evento chega para TODO MUNDO, inclusive quando fomos nos que apagamos.
  // Quem apagou e deduzido no banco a partir da direcao da mensagem, porque o
  // provedor nao diz: ninguem revoga para todos a mensagem de outra pessoa.
  if (event.kind === "message_deleted") {
    let houveFalha = false;
    for (const waMessageId of event.waMessageIds) {
      const { data: apagada, error } = await admin.rpc(
        "registrar_apagamento_do_whatsapp",
        { p_clinic_id: clinicId, p_wa_message_id: waMessageId },
      );
      if (error) {
        log.error("webhook_apagamento_falhou", {
          clinic_id: clinicId,
          wa_message_id: waMessageId,
          error_code: error.code ?? null,
        });
        houveFalha = true;
        continue;
      }
      // O arquivo sai do acervo junto. A policy de leitura ja o bloqueia
      // (ela exige deleted_at nulo), entao guardar os bytes seria manter foto
      // de paciente que ninguem mais consegue abrir nem auditar.
      const caminho = (apagada as { media_url?: string | null } | null)
        ?.media_url;
      const prefixo = "storage://midia-conversas/";
      if (caminho?.startsWith(prefixo)) {
        await admin.storage
          .from("midia-conversas")
          .remove([caminho.slice(prefixo.length)]);
      }
    }
    // 500 PROPOSITAL quando a RPC falhou. Este e o unico momento em que
    // ficamos sabendo que a mensagem sumiu do celular do paciente: nada mais no
    // sistema volta a conferir. Responder 200 aqui deixaria o texto revogado
    // visivel na conversa da clinica para sempre. O reenvio do provedor e
    // seguro porque a funcao pula linha ja apagada.
    if (houveFalha) {
      return NextResponse.json({ error: "apagamento_falhou" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
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
