"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  DIAS_PARADA,
  LOTE_DAS_PARADAS,
  TEXTOS_DAS_PARADAS,
  eventoDaConversaParada,
  instanteDoCorte,
  type ResultadoDasParadas,
} from "@/components/atendimento/conversas-paradas";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { log } from "@/lib/log";
import { abaDaIaVisivel } from "@/lib/queries/ia-liberacao";
import { createClient } from "@/lib/supabase/server";

// "Resolver as conversas paradas" no Atendimento (onda 2, decisao P11b do
// dono, opcao a): a conversa aberta com a equipe nunca entra na IA (D7),
// entao, antes da producao, a clinica resolve as antigas de uma vez. A
// pessoa escolhe na hora ha quantos dias a conversa esta parada (7, 15, 30
// ou 60; nenhuma opcao marcada de antemao), ve quantas sao e confirma.
//
// "Parada": aberta com a equipe (aguardando ou em atendimento, nunca a da
// IA) e sem NENHUMA mensagem (do paciente ou da clinica) ha mais de N dias
// (last_message_at; sem data, fica de fora: o lado seguro). Resolver e o
// mesmo do botao Resolver de cada conversa: status resolvida, sem espera de
// resposta, e o evento no fio de cada uma (com o motivo).
//
// Pela SESSAO (a RLS recorta a clinica e o que a pessoa ve). So o
// administrador e o gestor (resolver em lote e da chefia, como o resto da
// administracao), so nas clinicas com o agente habilitado (onde a acao
// aparece), e a acao confere de novo: esconder botao nao protege nada.
// Lote de no maximo 500 por vez, em pedacos de 100 (o filtro in.() vai na
// URL); o que sobrar, a pessoa resolve de novo. Nada de paciente vai para
// log nem para a trilha: so as contagens.

/** O maximo de conversas resolvidas numa vez (o dialogo diz o mesmo). */
const LOTE = LOTE_DAS_PARADAS;
/** Ids por update (o filtro in.() vai na URL do PostgREST). */
const PEDACO = 100;

const ABERTAS_COM_A_EQUIPE = ["aguardando_humano", "em_atendimento"];

const entradaSchema = z.object({ dias: z.literal(DIAS_PARADA) }).strict();

type Quem = { userId: string; clinicId: string };

async function guarda(): Promise<Quem | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: TEXTOS_DAS_PARADAS.sessaoExpirada };
  }
  const { clinicId, role } = context.active;
  if (role !== "admin" && role !== "gestor") {
    return { error: TEXTOS_DAS_PARADAS.semPermissao };
  }
  if (!(await abaDaIaVisivel(clinicId))) {
    return { error: TEXTOS_DAS_PARADAS.foraDoAgente };
  }
  return { userId: context.userId, clinicId };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Quantas estao paradas ha mais de `dias`. Nulo: a leitura falhou. */
async function contar(
  supabase: Supabase,
  clinicId: string,
  corte: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("conversation")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .in("status", ABERTAS_COM_A_EQUIPE)
    .lt("last_message_at", corte);
  return error || typeof count !== "number" ? null : count;
}

/**
 * Quantas conversas estao paradas ha mais de N dias (para o dialogo dizer
 * antes de confirmar). So contagem.
 */
export async function contarConversasParadasAction(
  entrada: unknown,
): Promise<ResultadoDasParadas> {
  const quem = await guarda();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DAS_PARADAS.dadosInvalidos };
  }
  const supabase = await createClient();
  const total = await contar(
    supabase,
    quem.clinicId,
    instanteDoCorte(parsed.data.dias, Date.now()),
  );
  if (total === null) {
    log.warn("conversas_paradas_nao_contadas", { clinic_id: quem.clinicId });
    return { ok: false, error: TEXTOS_DAS_PARADAS.naoContou };
  }
  return { ok: true, total };
}

/**
 * Resolve as conversas paradas ha mais de N dias (ate 500 por vez) e diz
 * quantas resolveu e quantas ainda restam. Cada uma ganha o evento no fio;
 * a trilha (audit_log) leva so os dias e a quantidade.
 */
export async function resolverConversasParadasAction(
  entrada: unknown,
): Promise<ResultadoDasParadas> {
  const quem = await guarda();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DAS_PARADAS.dadosInvalidos };
  }
  const { dias } = parsed.data;
  const corte = instanteDoCorte(dias, Date.now());
  const supabase = await createClient();

  const { data: paradas, error: erroDaLeitura } = await supabase
    .from("conversation")
    .select("id")
    .eq("clinic_id", quem.clinicId)
    .in("status", ABERTAS_COM_A_EQUIPE)
    .lt("last_message_at", corte)
    .order("last_message_at", { ascending: true })
    .limit(LOTE);
  if (erroDaLeitura) {
    log.warn("conversas_paradas_nao_resolvidas", {
      clinic_id: quem.clinicId,
      kind: "leitura",
      error_code: erroDaLeitura.code ?? null,
    });
    return { ok: false, error: TEXTOS_DAS_PARADAS.naoResolveu };
  }
  const ids = ((paradas ?? []) as { id: string }[]).map((linha) => linha.id);

  const resolvidas: string[] = [];
  for (let inicio = 0; inicio < ids.length; inicio += PEDACO) {
    const pedaco = ids.slice(inicio, inicio + PEDACO);
    // As mesmas condicoes de novo no UPDATE: a conversa que alguem
    // respondeu, assumiu para a IA ou resolveu no meio fica como esta.
    const { data, error } = await supabase
      .from("conversation")
      .update({ status: "resolvida", awaiting_reply: false })
      .in("id", pedaco)
      .eq("clinic_id", quem.clinicId)
      .in("status", ABERTAS_COM_A_EQUIPE)
      .lt("last_message_at", corte)
      .select("id");
    if (error) {
      log.warn("conversas_paradas_nao_resolvidas", {
        clinic_id: quem.clinicId,
        kind: "resolver",
        error_code: error.code ?? null,
        count: resolvidas.length,
      });
      break;
    }
    resolvidas.push(
      ...((data ?? []) as { id: string }[]).map((linha) => linha.id),
    );
  }

  if (resolvidas.length > 0) {
    const evento = eventoDaConversaParada(dias);
    const { error: erroDoEvento } = await supabase.from("message").insert(
      resolvidas.map((conversationId) => ({
        clinic_id: quem.clinicId,
        conversation_id: conversationId,
        direction: "saida",
        author: "sistema",
        content_type: "evento",
        body: evento,
      })),
    );
    if (erroDoEvento) {
      // As conversas ja foram resolvidas: so o evento no fio faltou.
      log.warn("conversas_paradas_sem_evento", {
        clinic_id: quem.clinicId,
        error_code: erroDoEvento.code ?? null,
        count: resolvidas.length,
      });
    }
    const { error: erroDaTrilha } = await supabase.from("audit_log").insert({
      clinic_id: quem.clinicId,
      user_id: quem.userId,
      action: "resolveu_conversas_paradas",
      entity: "conversation",
      entity_id: null,
      detalhes: { dias, quantas: resolvidas.length },
    });
    if (erroDaTrilha) {
      log.warn("conversas_paradas_sem_trilha", {
        clinic_id: quem.clinicId,
        error_code: erroDaTrilha.code ?? null,
      });
    }
    revalidatePath("/atendimento");
  }

  if (resolvidas.length === 0 && ids.length > 0) {
    // Leu, mas nada passou (o update falhou no primeiro pedaco).
    return { ok: false, error: TEXTOS_DAS_PARADAS.naoResolveu };
  }
  const restam = await contar(supabase, quem.clinicId, corte);
  return {
    ok: true,
    total: resolvidas.length,
    restam: restam ?? undefined,
  };
}
