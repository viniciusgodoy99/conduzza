import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  atribuirOrigem,
  extrairToken,
  type CampaignRule,
  type SourceChannel,
} from "@/lib/domain/attribution";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { tentarMoverPorTermo } from "@/lib/integrations/whatsapp/termo-chave";
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
  /**
   * Presente quando a RPC NAO gravou nada de proposito, e isso nao e erro:
   * - numero_proprio: quem escreveu e um numero ativo da propria clinica
   *   (o numero A falando com o numero B nao e paciente);
   * - numero_removido: o numero que recebeu foi removido no meio do caminho
   *   (corrida com a remocao; a URL dele ja recebe 401).
   * Os ids vem nulos e inserted false.
   */
  ignorada?: "numero_proprio" | "numero_removido";
  contact_id: string | null;
  contact_created: boolean;
  conversation_id: string | null;
  message_id: string | null;
  /** O numero que recebeu. Nulo so em clinica sem numero ativo. */
  whatsapp_account_id: string | null;
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

/**
 * Grava a mensagem recebida pelo NUMERO `accountId` da clinica.
 *
 * O webhook sempre sabe o numero (resolvido pela URL). `accountId` nulo so
 * existe para teste e ferramenta de desenvolvimento sem numero: a RPC usa o
 * principal ativo da clinica (ou nenhum, em clinica sem numero), como antes
 * de existir mais de um numero.
 */
export async function ingerirMensagemRecebida(
  admin: SupabaseClient,
  clinicId: string,
  accountId: string | null,
  event: MensagemRecebida,
): Promise<{ data: IngestResultado | null; error: PostgrestError | null }> {
  const { data, error } = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_whatsapp_account_id: accountId,
    p_phone_e164: event.phone,
    p_name: event.name,
    p_wa_message_id: event.waMessageId,
    p_content_type: event.contentType,
    p_body: event.body,
    p_media_url: event.mediaUrl,
    p_transcript: null,
    // Nome e tipo do arquivo (migration 20260924100000). So vao quando
    // existem: assim o texto comum, que e quase tudo, continua casando com a
    // assinatura antiga da RPC se o codigo subir antes da migration.
    ...(event.mediaFilename ? { p_media_filename: event.mediaFilename } : {}),
    ...(event.mediaMimetype ? { p_media_mimetype: event.mediaMimetype } : {}),
  });
  if (error) {
    return { data: null, error };
  }

  const resultado = (data ?? null) as IngestResultado | null;

  // Numero proprio ou numero removido: nada foi gravado, entao nao ha
  // citacao, anuncio, jornada nem origem a mexer. Sai sem erro.
  if (resultado?.ignorada) {
    return { data: resultado, error: null };
  }

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
        whatsapp_account_id: resultado.whatsapp_account_id ?? accountId,
        message_id: resultado.message_id,
        error_code: erroCitacao.code ?? null,
      });
    }
  }

  // CAPTURA DO ANUNCIO (estrutura do R1, com o R0 dispensado pelo dono em
  // 08/09/2026): se o canal entregou qualquer vestigio do clique de anuncio,
  // grava no contato. PRIMEIRO CLIQUE VENCE: o update so acontece enquanto
  // ctwa_clid E source_ad_id estao nulos, no mesmo espirito da origem
  // imutavel. Melhor esforco: falha vira log sem conteudo de paciente, a
  // mensagem ja esta salva.
  if (event.anuncio && resultado?.contact_id) {
    const patch: Record<string, string> = {};
    if (event.anuncio.ctwaClid) patch.ctwa_clid = event.anuncio.ctwaClid;
    if (event.anuncio.adId) patch.source_ad_id = event.anuncio.adId;
    if (event.anuncio.adsetId) patch.source_adset_id = event.anuncio.adsetId;
    if (event.anuncio.campaignId) {
      patch.source_campaign_id = event.anuncio.campaignId;
    }
    if (Object.keys(patch).length > 0) {
      const { error: erroAnuncio } = await admin
        .from("contact")
        .update(patch)
        .eq("clinic_id", clinicId)
        .eq("id", resultado.contact_id)
        .is("ctwa_clid", null)
        // L8 (Fase 4): o referral sem clid nao pode deixar o anuncio de um
        // segundo clique trocar o primeiro. O casamento com o investimento
        // e pelo source_ad_id, e o primeiro anuncio vence.
        .is("source_ad_id", null);
      if (erroAnuncio) {
        log.error("captura_ctwa_falhou", {
          clinic_id: clinicId,
          whatsapp_account_id: resultado.whatsapp_account_id ?? accountId,
          contact_id: resultado.contact_id,
          error_code: erroAnuncio.code ?? null,
        });
      }
    }
  }

  // Termo-chave roda em TODA mensagem recebida com texto (diferente da
  // atribuicao, que e do nascimento): a jornada avanca ao longo da conversa.
  // So em mensagem que acabou de ser inserida: reentrega de webhook
  // (inserted=false) nao pode mover ninguem duas vezes. Quem escreveu e o
  // PACIENTE: so contam as etapas cujo termo e do paciente ou de qualquer um
  // (lib/integrations/whatsapp/termo-chave.ts).
  if (event.body && resultado?.inserted && resultado.contact_id) {
    try {
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId: resultado.contact_id,
        corpo: event.body,
        quemEscreveu: "paciente",
        userId: null,
      });
    } catch {
      log.error("termo_chave_falhou", {
        clinic_id: clinicId,
        contact_id: resultado.contact_id,
        kind: "paciente",
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
