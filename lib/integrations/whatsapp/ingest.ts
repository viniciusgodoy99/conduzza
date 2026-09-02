import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  atribuirOrigem,
  extrairToken,
  type CampaignRule,
  type SourceChannel,
} from "@/lib/domain/attribution";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { log } from "@/lib/log";

// Gancho de ingestao de mensagem recebida. Chama a RPC ingest_inbound_message
// (idempotencia e concorrencia vivem no banco) e, SO quando o contato acabou
// de nascer, roda a atribuicao de origem (tarefa 4.2). A atribuicao inteira e
// melhor esforco: qualquer falha vira log e a ingestao segue, porque a
// mensagem ja esta salva quando ela roda.
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem de paciente em log. So ids.

export type IngestResultado = {
  inserted: boolean;
  contact_id: string | null;
  contact_created: boolean;
  conversation_id: string | null;
  message_id: string | null;
};

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

type LinhaCampanha = {
  id: string;
  token: string | null;
  channel: SourceChannel;
  origin: string | null;
  medium: string | null;
  campaign: string | null;
  default_message: string | null;
  keywords: string[] | null;
};

async function tentarAtribuirOrigem(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
  corpo: string,
  contatoRecemCriado: boolean,
): Promise<void> {
  const { data, error } = await admin
    .from("campaign_link")
    .select(
      "id, token, channel, origin, medium, campaign, default_message, keywords",
    )
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) {
    log.error("atribuicao_buscar_campanhas_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code: error.code ?? null,
    });
    return;
  }

  const regras: CampaignRule[] = ((data ?? []) as LinhaCampanha[]).map(
    (linha) => ({
      id: linha.id,
      token: linha.token,
      channel: linha.channel,
      origin: linha.origin,
      medium: linha.medium,
      campaign: linha.campaign,
      defaultMessage: linha.default_message,
      keywords: linha.keywords ?? [],
    }),
  );

  // Contato pre-existente sem origem: SO o token atribui (sinal explicito e
  // valido a qualquer momento). Mensagem padrao e palavra-chave valem apenas
  // na primeira mensagem da vida do contato, senao conversa comum viraria
  // atribuicao errada.
  const atribuicao = atribuirOrigem(corpo, regras);
  if (!atribuicao) {
    return;
  }
  if (!contatoRecemCriado && atribuicao.method !== "link_token") {
    return;
  }

  // Primeira captura vence: o predicado source_channel is null mais o trigger
  // impedir_reatribuicao_de_origem garantem que origem preenchida nunca muda.
  const { error: erroGravacao } = await admin
    .from("contact")
    .update({
      source_channel: atribuicao.channel,
      source_origin: atribuicao.origin,
      source_medium: atribuicao.medium,
      source_campaign: atribuicao.campaign,
      source_method: atribuicao.method,
      source_captured_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .is("source_channel", null);
  if (erroGravacao) {
    log.error("atribuicao_gravar_origem_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code: erroGravacao.code ?? null,
    });
  }
}

export async function ingerirMensagemRecebida(
  admin: SupabaseClient,
  clinicId: string,
  event: MensagemRecebida,
): Promise<{ data: IngestResultado | null; error: PostgrestError | null }> {
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
    return { data: null, error };
  }

  const resultado = (data ?? null) as IngestResultado | null;

  // CITACAO, num passo separado da ingestao de proposito.
  //
  // Resolver a citada dentro de ingest_inbound_message obrigaria a reescrever
  // aquela funcao, que e a mais delicada do sistema (cria contato, consentimento
  // e conversa numa transacao so). Aqui e um update depois, com a mensagem ja
  // salva: se falhar, a conversa perde a marca de "respondendo a", nao a
  // mensagem.
  if (event.quotedWaMessageId && resultado?.inserted && resultado.message_id) {
    const { error: erroCitacao } = await admin.rpc(
      "vincular_citacao_recebida",
      {
        p_clinic_id: clinicId,
        p_message_id: resultado.message_id,
        p_quoted_wa_id: event.quotedWaMessageId,
      },
    );
    if (erroCitacao) {
      log.error("citacao_recebida_falhou", {
        clinic_id: clinicId,
        message_id: resultado.message_id,
        error_code: erroCitacao.code ?? null,
      });
    }
  }

  // Atribuicao roda no nascimento do contato (os 3 mecanismos) OU quando uma
  // mensagem posterior traz token de campanha (contato pre-existente sem
  // origem; o update e guardado por source_channel is null, entao e barato e
  // idempotente).
  const deveAtribuir =
    resultado?.contact_id &&
    event.body &&
    (resultado.contact_created || extrairToken(event.body) !== null);
  if (deveAtribuir && resultado?.contact_id && event.body) {
    try {
      await tentarAtribuirOrigem(
        admin,
        clinicId,
        resultado.contact_id,
        event.body,
        resultado.contact_created,
      );
    } catch {
      // Falha inesperada nao derruba a ingestao; a mensagem ja esta salva.
      log.error("atribuicao_origem_falhou", {
        clinic_id: clinicId,
        contact_id: resultado.contact_id,
      });
    }
  }

  return { data: resultado, error: null };
}
