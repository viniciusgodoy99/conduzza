import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, limitesDoDia, somarDias } from "@/lib/domain/horarios";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";

// As duas contagens dos contadores do menu, isomorficas: o layout (servidor)
// usa para o primeiro paint e o vigia do cliente (use-contadores-do-menu)
// usa para manter o numero vivo. Uma consulta so, nos dois lados, para o
// numero nunca mudar de criterio entre a carga e o tempo real. A RLS recorta
// por clinica e pelo papel (o profissional so conta o que e dele).
//
// Devolvem null quando a consulta falha: quem chama decide entre manter o
// numero anterior (cliente) ou nao mostrar contador (servidor). Contagem
// inventada nunca.

/**
 * Conversas esperando resposta da equipe. awaiting_reply, nao status e nao
 * unread_count: status sozinho contaria as conversas que a REGUA abriu para
 * enviar confirmacao (40 disparos = contador 40, com a mensagem de paciente
 * de verdade enterrada), e unread_count zera quando alguem so ABRE a
 * conversa para ler, o que faria o lembrete sumir sem ninguem ter respondido.
 */
export async function contarConversasAguardando(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("conversation")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("status", "aguardando_humano")
    .eq("awaiting_reply", true);
  return error ? null : (count ?? 0);
}

// [AG6 urgência] início
/**
 * Conversas marcadas como urgentes AGORA (D-53 e contrato da frente de
 * banco, secao 3): a marca aberta (conversa_urgente sem encerrada_em) COM a
 * conversa em "Aguardando você", a mesma regra da lista (urgenteAberta, em
 * lib/queries/conversations.ts). Sem olhar o status, uma marca presa (o
 * gatilho que fecha a marca falhou e virou WARNING) deixava o menu em
 * alerta sem chip nenhum na lista (revisao da AG6a). O contador do
 * Atendimento fica em alerta enquanto houver alguma. A RLS recorta o papel
 * nas duas tabelas (o profissional so conta a da conversa com ele, e a
 * urgente vai sempre para a fila); a clinica vem no filtro porque a pessoa
 * pode ser membro de mais de uma. Falha devolve null: o contador fica no
 * tom de sempre, nunca num alerta inventado.
 */
export async function contarConversasUrgentes(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("conversa_urgente")
    .select("conversation_id, conversation!inner(status)", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .is("encerrada_em", null)
    .eq("conversation.status", "aguardando_humano");
  return error ? null : (count ?? 0);
}
// [AG6 urgência] fim

/**
 * Confirmacoes pendentes de amanha, no fuso da CLINICA: o mesmo recorte que
 * a Tela 2 abre por padrao. `agora` entra de fora para o dia civil ser
 * calculado no fuso explicito (CLAUDE.md 3.6).
 */
export async function contarConfirmacoesDeAmanha(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  agora: Date,
): Promise<number | null> {
  const amanha = somarDias(diaCivil(timezone, agora), 1);
  const janela = limitesDoDia(timezone, amanha);
  const { count, error } = await supabase
    .from("appointment")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .in("status", STATUS_PENDENTES)
    .gte("starts_at", janela.inicio.toISOString())
    .lt("starts_at", janela.fim.toISOString());
  return error ? null : (count ?? 0);
}
