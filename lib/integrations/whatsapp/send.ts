import type { SupabaseClient } from "@supabase/supabase-js";

import { canSendDecision } from "@/lib/domain/messaging";
import { getWhatsAppProvider } from "./provider";

// Orquestrador de envio (tarefa 1.4). Recebe o client por injecao: as Server
// Actions passam o admin client (service role) e por isso TODA consulta aqui
// re-filtra clinic_id explicitamente; os testes injetam o client do harness.
//
// Regras: sem consentimento ativo NAO cria message, grava audit_log e devolve
// erro tipado. Falha do provider vira message 'falhou' com error_code, para a
// UI mostrar e permitir reenviar. Custo no uazapi/fake e 0 e billable false;
// o calculo por message_pricing entra com o canal oficial (isOfficialChannel).

export type SendTextInput = {
  clinicId: string;
  conversationId: string;
  contactId: string;
  body: string;
  authorUserId: string;
};

export type SendTextResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      reason: "sem_consentimento" | "desconectado" | "falha_envio";
      message: string;
    };

export async function sendWhatsAppText(
  supabase: SupabaseClient,
  input: SendTextInput,
): Promise<SendTextResult> {
  // Consentimento VIGENTE: o registro mais recente manda. Perguntar "existe
  // alguma linha ativa" deixava o paciente que pediu descadastro voltar a
  // receber, bastando alguem inserir uma linha nova.
  const { data: consentimentoVigente } = await supabase.rpc(
    "consentimento_vigente",
    {
      p_clinic_id: input.clinicId,
      p_contact_id: input.contactId,
      p_channel: "whatsapp",
    },
  );

  const { data: account } = await supabase
    .from("whatsapp_account")
    .select("provider, server_url, instance_id, connection_status")
    .eq("clinic_id", input.clinicId)
    .maybeSingle();

  const decision = canSendDecision({
    consentActive: consentimentoVigente === true,
    accountStatus: account?.connection_status ?? null,
  });

  if (!decision.allowed) {
    if (decision.reason === "sem_consentimento") {
      await supabase.from("audit_log").insert({
        clinic_id: input.clinicId,
        user_id: input.authorUserId,
        action: "envio_bloqueado_sem_autorizacao",
        entity: "contact",
        entity_id: input.contactId,
      });
      return {
        ok: false,
        reason: "sem_consentimento",
        message:
          "Este contato não autorizou receber mensagens. O envio foi bloqueado e registrado.",
      };
    }
    return {
      ok: false,
      reason: "desconectado",
      message: "O WhatsApp da clínica não está conectado.",
    };
  }

  const { data: contact } = await supabase
    .from("contact")
    .select("phone_e164")
    .eq("clinic_id", input.clinicId)
    .eq("id", input.contactId)
    .single();
  if (!contact) {
    return {
      ok: false,
      reason: "falha_envio",
      message: "Contato não encontrado.",
    };
  }

  const { data: secret } = await supabase
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", input.clinicId)
    .maybeSingle();

  const provider = getWhatsAppProvider(account?.provider);
  const result = await provider
    .sendText(
      {
        clinicId: input.clinicId,
        serverUrl: account?.server_url ?? null,
        instanceToken: secret?.instance_token ?? null,
        instanceId: account?.instance_id ?? null,
      },
      contact.phone_e164,
      input.body,
    )
    .catch((erro: unknown) => {
      // Distinguir causas: antes tudo virava "provider_indisponivel", entao
      // "instancia sem token" (a clinica nunca conectou) e "servidor fora do
      // ar" ficavam indistinguiveis para quem precisa resolver.
      const texto = erro instanceof Error ? erro.message : "";
      if (texto.includes("Instância sem token")) {
        return {
          ok: false as const,
          errorCode: "sem_instancia",
          message:
            "O WhatsApp desta clínica ainda não foi conectado. Conecte em Conexão do WhatsApp.",
        };
      }
      if (
        texto.includes("UAZAPI_SERVER_URL") ||
        texto.includes("ADMIN_TOKEN")
      ) {
        return {
          ok: false as const,
          errorCode: "configuracao_ausente",
          message:
            "O canal de WhatsApp não está configurado no sistema. Fale com o suporte.",
        };
      }
      return {
        ok: false as const,
        errorCode: "provider_indisponivel",
        message:
          "Não conseguimos falar com o servidor do WhatsApp. A mensagem ficou marcada para reenviar.",
      };
    });

  const { data: messageRow, error: messageError } = await supabase
    .from("message")
    .insert({
      clinic_id: input.clinicId,
      conversation_id: input.conversationId,
      wa_message_id: result.ok ? result.waMessageId : null,
      direction: "saida",
      author: "usuario",
      author_user_id: input.authorUserId,
      content_type: "texto",
      body: input.body,
      billable: false,
      cost_cents: 0,
      delivery_status: result.ok ? "enviada" : "falhou",
      error_code: result.ok ? null : result.errorCode,
    })
    .select("id")
    .single();
  if (messageError || !messageRow) {
    return {
      ok: false,
      reason: "falha_envio",
      message: "Não foi possível registrar a mensagem.",
    };
  }

  await supabase
    .from("conversation")
    .update({ last_message_at: new Date().toISOString() })
    .eq("clinic_id", input.clinicId)
    .eq("id", input.conversationId);

  if (!result.ok) {
    // A causa vem do provider e ja esta em linguagem de quem atende. O
    // error_code fica gravado na mensagem para diagnostico, sem nenhum
    // conteudo de paciente sair daqui.
    return {
      ok: false,
      reason: "falha_envio",
      message: result.message,
    };
  }
  return { ok: true, messageId: messageRow.id };
}
