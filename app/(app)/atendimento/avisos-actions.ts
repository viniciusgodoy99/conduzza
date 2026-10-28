"use server";

import { z } from "zod";

import {
  ehEventoDeAtribuicao,
  JANELA_DO_AVISO_MS,
} from "@/components/shell/avisos-da-conversa";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { formatarTelefone } from "@/lib/domain/telefone";
import { log } from "@/lib/log";
import { marcaDeUrgenciaDaLinha } from "@/lib/queries/conversations";
import { createClient } from "@/lib/supabase/server";

// [AG6 urgência e passagem] início O nome do contato para os avisos na tela da AG6a
// (components/shell/avisos-da-conversa.ts): "Conversa urgente de {nome}." e
// "A IA passou para você a conversa de {nome}.". O vigia do menu so sabe ids
// (o evento de conversa_urgente nao tem dado de paciente, e o do fio so tem
// o texto do sistema); o nome e dado de paciente e sai DAQUI, pela sessao
// (a RLS decide se a pessoa ve a conversa), depois de a leitura entrar na
// trilha (CLAUDE.md 3.1, como a abertura do Atendimento: entidade "inbox",
// uma linha por 5 minutos).
//
// O servidor confere de novo o que o aviso afirma, porque o navegador nao e
// confiavel e o evento pode estar atrasado:
// - urgente: a conversa da clinica ativa, em "Aguardando você", com a marca
//   aberta (alguem ja pegou: sem aviso);
// - atribuida: a mensagem e o evento da atribuicao (sistema, evento, o texto
//   do banco, recente) DESTA conversa, e a conversa esta em atendimento com
//   QUEM PEDE (a recepcao tambem recebe o evento da conversa passada para
//   outra pessoa: sem aviso para ela).
// Log so com a clinica, o tipo e o codigo do erro; nunca nome nem texto.

const entradaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("urgente"), conversationId: z.uuid() }).strict(),
  z
    .object({
      tipo: z.literal("atribuida"),
      conversationId: z.uuid(),
      messageId: z.uuid(),
    })
    .strict(),
]);

/**
 * aviso: o nome (ou o telefone) para o texto; nulo quando o aviso nao vale
 * mais (alguem pegou a conversa, ou ela nao e desta pessoa). ok falso: nao
 * deu para conferir (sessao, leitura); o vigia decide o que fazer.
 */
export type ResultadoDoAviso =
  { ok: true; aviso: { contato: string } | null } | { ok: false };

type LinhaDaConversa = {
  status: string;
  assignee_user_id: string | null;
  contact: unknown;
  urgencia: unknown;
};

/**
 * O nome do contato, ou o telefone formatado quando nao ha nome. Nao e
 * exportada: num arquivo "use server", toda funcao exportada vira endpoint.
 */
function contatoParaOAviso(contato: unknown): string | null {
  const linha = Array.isArray(contato) ? (contato[0] as unknown) : contato;
  if (typeof linha !== "object" || linha === null) {
    return null;
  }
  const { name, phone_e164: telefone } = linha as {
    name?: unknown;
    phone_e164?: unknown;
  };
  if (typeof name === "string" && name.trim() !== "") {
    return name.trim();
  }
  return typeof telefone === "string" && telefone !== ""
    ? formatarTelefone(telefone)
    : null;
}

export async function lerAvisoDaConversaAction(
  entrada: unknown,
): Promise<ResultadoDoAviso> {
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false };
  }
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    return { ok: false };
  }
  const pedido = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversation")
    .select(
      "status, assignee_user_id, contact:contact_id (name, phone_e164), urgencia:conversa_urgente (desde, encerrada_em)",
    )
    .eq("clinic_id", active.clinicId)
    .eq("id", pedido.conversationId)
    .maybeSingle();
  if (error) {
    log.warn("aviso_da_conversa_nao_lido", {
      clinic_id: active.clinicId,
      kind: pedido.tipo,
      error_code: error.code ?? null,
    });
    return { ok: false };
  }
  const conversa = data as LinhaDaConversa | null;
  if (!conversa) {
    // A RLS nao mostra (outra clinica, ou o profissional fora da conversa).
    return { ok: true, aviso: null };
  }

  if (pedido.tipo === "urgente") {
    if (
      conversa.status !== "aguardando_humano" ||
      marcaDeUrgenciaDaLinha(conversa.urgencia) === null
    ) {
      return { ok: true, aviso: null };
    }
  } else {
    if (
      conversa.status !== "em_atendimento" ||
      conversa.assignee_user_id !== context.userId
    ) {
      return { ok: true, aviso: null };
    }
    const { data: mensagem, error: erroDaMensagem } = await supabase
      .from("message")
      .select("author, content_type, body, created_at")
      .eq("id", pedido.messageId)
      .eq("conversation_id", pedido.conversationId)
      .maybeSingle();
    if (erroDaMensagem) {
      log.warn("aviso_da_conversa_nao_lido", {
        clinic_id: active.clinicId,
        kind: pedido.tipo,
        error_code: erroDaMensagem.code ?? null,
      });
      return { ok: false };
    }
    const evento = mensagem as {
      author?: unknown;
      content_type?: unknown;
      body?: unknown;
      created_at?: unknown;
    } | null;
    const quando =
      typeof evento?.created_at === "string"
        ? Date.parse(evento.created_at)
        : Number.NaN;
    if (
      !evento ||
      evento.author !== "sistema" ||
      evento.content_type !== "evento" ||
      !ehEventoDeAtribuicao(evento.body) ||
      !Number.isFinite(quando) ||
      Date.now() - quando > JANELA_DO_AVISO_MS
    ) {
      return { ok: true, aviso: null };
    }
  }

  const contato = contatoParaOAviso(conversa.contact);
  if (contato === null) {
    return { ok: false };
  }
  // A trilha ANTES de o nome sair do servidor (regra 3.1).
  await auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "inbox",
  });
  return { ok: true, aviso: { contato } };
}
// [AG6 urgência e passagem] fim
