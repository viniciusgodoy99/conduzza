import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  atribuirOrigem,
  extrairToken,
  type CampaignRule,
  type SourceChannel,
} from "@/lib/domain/attribution";
import { etapaPorTermoChave } from "@/lib/domain/jornada";
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

// TERMO-CHAVE da jornada (fase 4): mensagem do paciente contendo um termo de
// etapa move o contato para ela. A decisao (mais longo vence, so para frente,
// nunca sai de nem entra em perda) e pura em lib/domain/jornada.ts; aqui e a
// leitura da jornada + o update guardado pela etapa atual, para duas mensagens
// simultaneas nao se atropelarem. Melhor esforco: falha vira log so com ids.
async function tentarMoverPorTermo(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
  corpo: string,
): Promise<void> {
  const [jornadaResult, contatoResult] = await Promise.all([
    admin
      .from("funnel_stage_def")
      .select("chave, posicao, papel, termos_chave")
      .eq("clinic_id", clinicId),
    admin
      .from("contact")
      .select("funnel_stage")
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .maybeSingle(),
  ]);
  if (jornadaResult.error || contatoResult.error || !contatoResult.data) {
    log.error("termo_chave_ler_jornada_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code:
        jornadaResult.error?.code ?? contatoResult.error?.code ?? null,
    });
    return;
  }

  const etapaAtual = contatoResult.data.funnel_stage as string;
  const destino = etapaPorTermoChave(
    corpo,
    etapaAtual,
    (jornadaResult.data ?? []) as {
      chave: string;
      posicao: number;
      papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
      termos_chave: string[];
    }[],
  );
  if (!destino) {
    return;
  }

  // Guardado pela etapa de origem: se outra mensagem moveu o contato no meio
  // tempo, este update afeta zero linhas e nada de errado acontece.
  const { data: movidas, error: erroMover } = await admin
    .from("contact")
    .update({ funnel_stage: destino.chave })
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .eq("funnel_stage", etapaAtual)
    .select("id");
  if (erroMover) {
    log.error("termo_chave_mover_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code: erroMover.code ?? null,
    });
    return;
  }
  if (!movidas || movidas.length === 0) {
    return;
  }

  // Trilha do movimento de SISTEMA (user_id nulo): registra que um termo
  // moveu o contato, nunca qual termo nem o texto da mensagem (regra 3.1).
  await admin.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: null,
    action: "termo_chave_moveu_etapa",
    entity: "contact",
    entity_id: contactId,
  });
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

  // CAPTURA DO ANUNCIO (estrutura do R1, com o R0 dispensado pelo dono em
  // 08/09/2026): se o canal entregou qualquer vestigio do clique de anuncio,
  // grava no contato. PRIMEIRO CLIQUE VENCE: o update so acontece enquanto
  // ctwa_clid esta nulo, no mesmo espirito da origem imutavel. Melhor esforco:
  // falha vira log sem conteudo de paciente, a mensagem ja esta salva.
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
        .is("ctwa_clid", null);
      if (erroAnuncio) {
        log.error("captura_ctwa_falhou", {
          clinic_id: clinicId,
          contact_id: resultado.contact_id,
          error_code: erroAnuncio.code ?? null,
        });
      }
    }
  }

  // Termo-chave roda em TODA mensagem recebida com texto (diferente da
  // atribuicao, que e do nascimento): a jornada avanca ao longo da conversa.
  // So em mensagem que acabou de ser inserida: reentrega de webhook
  // (inserted=false) nao pode mover ninguem duas vezes.
  if (event.body && resultado?.inserted && resultado.contact_id) {
    try {
      await tentarMoverPorTermo(
        admin,
        clinicId,
        resultado.contact_id,
        event.body,
      );
    } catch {
      log.error("termo_chave_falhou", {
        clinic_id: clinicId,
        contact_id: resultado.contact_id,
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
