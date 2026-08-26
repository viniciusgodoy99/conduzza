import type { SupabaseClient } from "@supabase/supabase-js";

import { canSendDecision } from "@/lib/domain/messaging";
import { log } from "@/lib/log";
import { textoNumerado } from "./menu-texto";
import { getWhatsAppProvider } from "./provider";
import type {
  InstanceRef,
  MenuOption,
  SendResult,
  WhatsAppProvider,
} from "./provider";

// Orquestrador de envio (tarefa 1.4; endurecido na revisao da Etapa B).
// Recebe o client por injecao: as Server Actions passam o admin client
// (service role) e por isso TODA consulta aqui re-filtra clinic_id
// explicitamente; os testes injetam o client do harness.
//
// A ORDEM do fluxo e a defesa contra mensagem duplicada ao paciente:
//   1. consentimento vigente + conta conectada
//   2. a linha de message NASCE AQUI, 'enviando', amarrada ao job quando
//      houver (unique de job_id): um retry encontra a linha e nao reenvia o
//      que pode ja ter saido
//   3. reserva do slot anti-ban no banco (falha FECHADA: sem slot, sem envio)
//   4. espera do slot e RECONFERENCIA do consentimento (revogacao durante a
//      espera cancela o envio)
//   5. provider envia; a linha vira 'enviada' ou 'falhou'
//
// Custo no uazapi/fake e 0 e billable false; o calculo por message_pricing
// entra com o canal oficial (isOfficialChannel).
//
// Ha duas portas de entrada, sendWhatsAppText e sendWhatsAppMenu, e as duas
// passam pelo MESMO enviarPeloCanal: as garantias acima nao podem existir em
// duas copias, senao uma delas envelhece e vira mensagem duplicada.

export type SendTextInput = {
  clinicId: string;
  conversationId: string;
  contactId: string;
  body: string;
  /** null quando o autor e o sistema (disparo de confirmacao, regua) */
  authorUserId: string | null;
  /** default 'usuario'; disparo ativo do worker usa 'sistema' */
  author?: "usuario" | "sistema";
  /**
   * Espacamento anti-ban que ESTE envio impoe ao proximo, em ms. Resposta
   * 1:1 usa o padrao (1,5 a 4s); disparo em massa DEVE passar 10000 a 30000,
   * conforme a especificacao do canal nao oficial.
   */
  espacamentoMs?: number;
  /**
   * Teto de espera pelo slot. O 1:1 do atendente nao pode dormir um minuto
   * atras de uma campanha: acima do teto o envio falha com 'canal_ocupado'.
   * O worker passa um teto alto (a espera e o trabalho dele).
   */
  esperaMaximaMs?: number;
  /** id do job da fila, quando o envio vem do worker (chave de idempotencia) */
  jobId?: string;
};

// Espacamento padrao da resposta humana 1:1.
function espacamentoPadraoMs(): number {
  return 1_500 + Math.floor(Math.random() * 2_500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SendTextResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      reason:
        "sem_consentimento" | "desconectado" | "falha_envio" | "ja_enviado";
      /** codigo curto para o worker decidir retry; sem conteudo de paciente */
      code?: string;
      message: string;
    };

// Codigos de falha em que o provedor COM CERTEZA nao chegou a enviar: o retry
// e seguro. O unico ambiguo e 'envio_incerto' (a mensagem pode ter chegado e
// so a resposta se perdido): esse NUNCA entra em retry automatico.
const FALHAS_SEM_ENVIO = new Set([
  "slot_indisponivel",
  "canal_ocupado",
  "sem_consentimento_no_envio",
  "sem_instancia",
  "configuracao_ausente",
  "provider_indisponivel",
]);

export function falhaPermiteRetry(code: string | undefined): boolean {
  return code !== undefined && FALHAS_SEM_ENVIO.has(code);
}

async function marcarFalha(
  supabase: SupabaseClient,
  messageId: string,
  code: string,
): Promise<void> {
  await supabase
    .from("message")
    .update({ delivery_status: "falhou", error_code: code })
    .eq("id", messageId);
}

export type SendMenuInput = SendTextInput & {
  /** as opcoes do menu; o id e o que volta na resposta do botao */
  options: MenuOption[];
};

// O que muda entre um envio de texto e um envio de menu. As sete garantias
// acima sao IDENTICAS nos dois: so o corpo gravado e a chamada ao provedor
// mudam, e e exatamente isso que este tipo isola.
type Despacho = {
  /** o texto que fica em message.body, para o Inbox */
  bodyRegistrado: string;
  enviar(
    provider: WhatsAppProvider,
    ref: InstanceRef,
    to: string,
  ): Promise<SendResult>;
};

/** Envio simples de texto. */
export async function sendWhatsAppText(
  supabase: SupabaseClient,
  input: SendTextInput,
): Promise<SendTextResult> {
  return enviarPeloCanal(supabase, input, {
    bodyRegistrado: input.body,
    enviar: (provider, ref, to) => provider.sendText(ref, to, input.body),
  });
}

/**
 * Envio com opcoes de resposta (o toque de confirmacao da regua).
 *
 * As mesmas sete garantias do texto, com uma diferenca deliberada: o
 * message.body gravado carrega o corpo MAIS as opcoes numeradas. O uazapi
 * pode ter degradado o botao para lista numerada sem nos avisar, e quem le a
 * conversa depois precisa entender por que o paciente respondeu "1".
 */
export async function sendWhatsAppMenu(
  supabase: SupabaseClient,
  input: SendMenuInput,
): Promise<SendTextResult> {
  return enviarPeloCanal(supabase, input, {
    bodyRegistrado: textoNumerado(input.body, input.options),
    enviar: (provider, ref, to) =>
      provider.sendMenu(ref, to, input.body, input.options),
  });
}

async function enviarPeloCanal(
  supabase: SupabaseClient,
  input: SendTextInput,
  despacho: Despacho,
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
      code: "desconectado",
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
      code: "contato_inexistente",
      message: "Contato não encontrado.",
    };
  }

  // IDEMPOTENCIA POR JOB: se este job ja tem mensagem, um retry esta rodando.
  // So e seguro reenviar quando o codigo da falha anterior garante que o
  // provedor nao chegou a enviar; em qualquer outro estado, nao reenvia.
  let messageId: string | null = null;
  if (input.jobId) {
    const { data: existente } = await supabase
      .from("message")
      .select("id, delivery_status, error_code")
      .eq("job_id", input.jobId)
      .maybeSingle();
    if (existente) {
      const podeReusar =
        existente.delivery_status === "falhou" &&
        falhaPermiteRetry(existente.error_code as string | undefined);
      if (!podeReusar) {
        return {
          ok: false,
          reason: "ja_enviado",
          code: "ja_enviado",
          message:
            "Este envio já foi processado (ou não é seguro repetir). Nada foi reenviado.",
        };
      }
      messageId = existente.id as string;
      await supabase
        .from("message")
        .update({ delivery_status: "enviando", error_code: null })
        .eq("id", messageId);
    }
  }

  // A linha nasce ANTES do envio: se o processo morrer no meio, o registro
  // existe e um retry sabe que nao deve repetir.
  if (!messageId) {
    const { data: nova, error: erroInsert } = await supabase
      .from("message")
      .insert({
        clinic_id: input.clinicId,
        conversation_id: input.conversationId,
        direction: "saida",
        author: input.author ?? "usuario",
        author_user_id: input.authorUserId,
        content_type: "texto",
        body: despacho.bodyRegistrado,
        billable: false,
        cost_cents: 0,
        delivery_status: "enviando",
        ...(input.jobId ? { job_id: input.jobId } : {}),
      })
      .select("id")
      .single();
    if (erroInsert || !nova) {
      return {
        ok: false,
        reason: "falha_envio",
        code: "registro_falhou",
        message: "Não foi possível registrar a mensagem.",
      };
    }
    messageId = nova.id as string;
  }

  // ANTI-BAN: reserva atomica do slot deste numero, compartilhada entre o
  // servidor web e o worker (processos separados). A funcao devolve a ESPERA
  // em ms calculada no relogio do banco (imune a desvio de relogio local).
  // Falha FECHADA: sem reserva confirmada, nao ha envio sem espacamento.
  const { data: esperaMs, error: erroSlot } = await supabase.rpc(
    "reservar_slot_envio",
    {
      p_clinic_id: input.clinicId,
      p_espaco_ms: input.espacamentoMs ?? espacamentoPadraoMs(),
    },
  );
  if (erroSlot) {
    await marcarFalha(supabase, messageId, "slot_indisponivel");
    return {
      ok: false,
      reason: "falha_envio",
      code: "slot_indisponivel",
      message: "Não foi possível reservar o envio. Tente de novo.",
    };
  }
  const espera = typeof esperaMs === "number" ? esperaMs : 0;
  const teto = input.esperaMaximaMs ?? 8_000;
  if (espera > teto) {
    // O slot reservado fica sem uso (o proximo envio espera um pouco mais),
    // que e o preco certo por nao segurar um atendente por um minuto.
    await marcarFalha(supabase, messageId, "canal_ocupado");
    return {
      ok: false,
      reason: "falha_envio",
      code: "canal_ocupado",
      message:
        "O número está enviando outras mensagens agora. Tente de novo em instantes.",
    };
  }
  if (espera > 0) {
    await sleep(espera);
  }

  // RECONFERENCIA pos-espera: o paciente pode ter revogado o consentimento
  // durante os segundos de fila (o descadastro vale na hora, nao "a partir do
  // proximo envio").
  if (espera > 0) {
    const { data: aindaVigente } = await supabase.rpc("consentimento_vigente", {
      p_clinic_id: input.clinicId,
      p_contact_id: input.contactId,
      p_channel: "whatsapp",
    });
    if (aindaVigente !== true) {
      await marcarFalha(supabase, messageId, "sem_consentimento_no_envio");
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
        code: "sem_consentimento_no_envio",
        message:
          "Este contato não autoriza mais receber mensagens. O envio foi cancelado.",
      };
    }
  }

  const provider = getWhatsAppProvider(account?.provider);
  const { data: segredo } = await supabase
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", input.clinicId)
    .maybeSingle();
  const ref: InstanceRef = {
    clinicId: input.clinicId,
    serverUrl: account?.server_url ?? null,
    instanceToken: segredo?.instance_token ?? null,
    instanceId: account?.instance_id ?? null,
  };
  const result = await despacho
    .enviar(provider, ref, contact.phone_e164)
    .catch((erro: unknown) => {
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

  if (!result.ok) {
    await marcarFalha(supabase, messageId, result.errorCode);
    return {
      ok: false,
      reason: "falha_envio",
      code: result.errorCode,
      message: result.message,
    };
  }

  // Envio SAIU. Se a atualizacao do registro falhar agora, NADA pode reenviar:
  // o job conclui mesmo assim (a linha fica 'enviando' e o recibo do webhook
  // nao casa sem wa_message_id, perda menor e visivel no log).
  const { error: erroUpdate } = await supabase
    .from("message")
    .update({ delivery_status: "enviada", wa_message_id: result.waMessageId })
    .eq("id", messageId);
  if (erroUpdate) {
    log.error("envio_saiu_sem_confirmar_registro", {
      clinic_id: input.clinicId,
      message_id: messageId,
      error_code: erroUpdate.code ?? null,
    });
  }

  // awaiting_reply so cai quando quem escreveu foi GENTE. Toque automatico de
  // regua sai com author 'sistema' e nao pode apagar a pergunta que o paciente
  // fez e ninguem respondeu: seria a recepcao perdendo a conversa justamente
  // porque a maquina falou por cima.
  await supabase
    .from("conversation")
    .update({
      last_message_at: new Date().toISOString(),
      ...((input.author ?? "usuario") === "usuario"
        ? { awaiting_reply: false }
        : {}),
    })
    .eq("clinic_id", input.clinicId)
    .eq("id", input.conversationId);

  return { ok: true, messageId };
}
