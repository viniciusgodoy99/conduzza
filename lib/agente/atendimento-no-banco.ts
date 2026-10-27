import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import { log } from "@/lib/log";

import {
  lerRespostaDaGravacao,
  lerRespostaDoAtendimento,
  type EstadoDoAtendimento,
  type RespostaDaGravacao,
  type RespostaDaLeitura,
} from "./atendimento";

// O estado do atendimento da IA no banco (AG3, 27/10/2026), pelas RPCs da
// migration 20261027120000_agendamento_completo_da_ia.sql, pela service role
// e sempre com o clinic_id, a conversa e o job do servidor (nunca do
// modelo). O executor do WhatsApp (lib/jobs/responder-com-ia.ts) le no
// comeco do turno e grava no fim, ANTES de decidir e enviar.
//
// Falha fechada: erro, prazo ou resposta fora do formato devolvem
// { tipo: "erro" } e quem chama nao envia resposta construida sobre estado
// velho (a frase fixa e a equipe). Log so com ids e codigos, nunca o estado
// (que nao tem texto do paciente, mas tambem nao precisa ir a log).

/** Prazo de cada RPC do estado. */
export const PRAZO_DO_ESTADO_MS = 4_000;

type IdsDoEstado = {
  clinicId: string;
  conversationId: string;
  jobId: string;
};

export type LeituraDoAtendimento =
  | { tipo: "lido"; resposta: Extract<RespostaDaLeitura, { ok: true }> }
  | { tipo: "recusado"; motivo: "fora_da_ia" | "job_antigo" }
  | { tipo: "erro"; codigo: string };

export type GravacaoDoAtendimento =
  | { tipo: "gravado"; versao: number; reutilizado: boolean }
  | {
      tipo: "recusado";
      motivo: Extract<RespostaDaGravacao, { ok: false }>["motivo"];
    }
  | { tipo: "erro"; codigo: string };

async function rpc(
  admin: SupabaseClient,
  funcao: string,
  parametros: Record<string, unknown>,
): Promise<{ ok: true; valor: unknown } | { ok: false; codigo: string }> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc(funcao, parametros);
    if (error) {
      return {
        ok: false as const,
        codigo: (error as { code?: string }).code ?? "rpc",
      };
    }
    return { ok: true as const, valor: data as unknown };
  }, PRAZO_DO_ESTADO_MS);
  if (corrida.tipo !== "resultado") {
    return { ok: false, codigo: corrida.tipo };
  }
  return corrida.valor;
}

/**
 * ler_atendimento_da_ia: o estado da janela atual da conversa, para o job
 * (o mesmo job de novo recebe o estado de antes dele: idempotencia).
 */
export async function lerAtendimentoDaIa(
  admin: SupabaseClient,
  ids: IdsDoEstado,
): Promise<LeituraDoAtendimento> {
  const chamada = await rpc(admin, "ler_atendimento_da_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
  });
  if (!chamada.ok) {
    log.warn("ia_estado_nao_lido", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: chamada.codigo,
    });
    return { tipo: "erro", codigo: chamada.codigo };
  }
  const lida = lerRespostaDoAtendimento(chamada.valor);
  if (lida === null) {
    log.warn("ia_estado_nao_lido", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: "resposta_fora_do_formato",
    });
    return { tipo: "erro", codigo: "resposta_fora_do_formato" };
  }
  if (!lida.ok) {
    log.info("ia_estado_recusado", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: lida.motivo,
    });
    return { tipo: "recusado", motivo: lida.motivo };
  }
  return { tipo: "lido", resposta: lida };
}

/**
 * gravar_atendimento_da_ia com a versao que o job leu (otimista): outro job
 * que gravou depois da leitura recusa com estado_mudou.
 */
export async function gravarAtendimentoDaIa(
  admin: SupabaseClient,
  ids: IdsDoEstado & { versao: number; estado: EstadoDoAtendimento },
): Promise<GravacaoDoAtendimento> {
  const chamada = await rpc(admin, "gravar_atendimento_da_ia", {
    p_clinic_id: ids.clinicId,
    p_conversation_id: ids.conversationId,
    p_job_id: ids.jobId,
    p_versao: ids.versao,
    p_estado: ids.estado,
  });
  if (!chamada.ok) {
    log.warn("ia_estado_nao_gravado", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: chamada.codigo,
    });
    return { tipo: "erro", codigo: chamada.codigo };
  }
  const lida = lerRespostaDaGravacao(chamada.valor);
  if (lida === null) {
    log.warn("ia_estado_nao_gravado", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: "resposta_fora_do_formato",
    });
    return { tipo: "erro", codigo: "resposta_fora_do_formato" };
  }
  if (!lida.ok) {
    log.info("ia_estado_recusado", {
      clinic_id: ids.clinicId,
      conversation_id: ids.conversationId,
      job_id: ids.jobId,
      error_code: lida.motivo,
    });
    return { tipo: "recusado", motivo: lida.motivo };
  }
  return { tipo: "gravado", versao: lida.versao, reutilizado: lida.reutilizado };
}

/**
 * O nascimento que o paciente informou nesta conversa (a linha aberta de
 * dados_informados_na_marcacao do contato de agora), so para a idade
 * atendida do profissional na busca de horario. A service role le a tabela
 * (SELECT); o valor nunca vai ao modelo nem a log. Erro ou prazo: null (a
 * busca segue so com o nascimento do cadastro).
 */
export async function lerNascimentoInformado(
  admin: SupabaseClient,
  e: { clinicId: string; conversationId: string; contactId: string },
): Promise<string | null> {
  try {
    const corrida = await correrComPrazo(async () => {
      const { data, error } = await admin
        .from("dados_informados_na_marcacao")
        .select("data_nascimento")
        .eq("clinic_id", e.clinicId)
        .eq("conversation_id", e.conversationId)
        .eq("contact_id", e.contactId)
        .is("appointment_id", null)
        .eq("para_o_titular", true)
        .maybeSingle();
      if (error) {
        return null;
      }
      const valor = (data as { data_nascimento?: unknown } | null)
        ?.data_nascimento;
      return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)
        ? valor
        : null;
    }, PRAZO_DO_ESTADO_MS);
    return corrida.tipo === "resultado" ? corrida.valor : null;
  } catch {
    return null;
  }
}
