import type { SupabaseClient } from "@supabase/supabase-js";

// Contagens de mensagens agendadas para os dialogos de Configuracoes, lidas
// pela SESSAO (a RLS de mensagem_agendada recorta; administrador e gestor
// veem todas as da clinica). So a contagem: nenhum texto, nome ou telefone
// sai do banco por aqui.
//
// - Equipe (A5 do desenho final): quantas agendadas a pessoa ASSINA, isto e,
//   coalesce(editada_por, criada_por) = ela, ainda em 'agendada'.
// - Remover numero (secao 4.6): quantas deste numero ainda podem sair
//   ('agendada' e 'enviando'); remover_numero encerra as duas.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O filtro "a pessoa assina": editou por ultimo, ou criou e ninguem editou.
 * O id entra no texto do filtro do PostgREST, entao so passa uuid.
 */
export function filtroDoAssinante(userId: string): string | null {
  if (!UUID.test(userId)) {
    return null;
  }
  return `editada_por.eq.${userId},and(editada_por.is.null,criada_por.eq.${userId})`;
}

/** Quantas agendadas a pessoa assina na clinica. Lanca em erro de leitura. */
export async function contarAgendadasDaPessoa(
  supabase: SupabaseClient,
  clinicId: string,
  userId: string,
): Promise<number> {
  const filtro = filtroDoAssinante(userId);
  if (!filtro || !UUID.test(clinicId)) {
    throw new Error("agendadas_da_pessoa: identificador invalido");
  }
  const { count, error } = await supabase
    .from("mensagem_agendada")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("situacao", "agendada")
    .or(filtro);
  if (error) {
    throw new Error(`agendadas_da_pessoa: ${error.code ?? "erro"}`);
  }
  return count ?? 0;
}

/** Quantas agendadas deste numero ainda podem sair. Lanca em erro. */
export async function contarAgendadasDoNumero(
  supabase: SupabaseClient,
  whatsappAccountId: string,
): Promise<number> {
  if (!UUID.test(whatsappAccountId)) {
    throw new Error("agendadas_do_numero: identificador invalido");
  }
  const { count, error } = await supabase
    .from("mensagem_agendada")
    .select("id", { count: "exact", head: true })
    .eq("whatsapp_account_id", whatsappAccountId)
    .in("situacao", ["agendada", "enviando"]);
  if (error) {
    throw new Error(`agendadas_do_numero: ${error.code ?? "erro"}`);
  }
  return count ?? 0;
}

/** "Esta pessoa assina 3 mensagens agendadas." (A5) */
export function textoDasAgendadasDaPessoa(n: number): string {
  return n === 1
    ? "Esta pessoa assina 1 mensagem agendada."
    : `Esta pessoa assina ${n} mensagens agendadas.`;
}

/** A caixa de cancelar (A5), desmarcada por padrao. */
export function rotuloDeCancelarAgendadas(n: number): string {
  return n === 1
    ? "Cancelar essa mensagem agendada"
    : `Cancelar essas ${n} mensagens agendadas`;
}

/** A ajuda da caixa (A5). */
export const AJUDA_DE_CANCELAR_AGENDADAS =
  "Sem cancelar, elas saem em nome dela e a conversa fica Sem atendente.";

/** A ajuda da caixa com uma mensagem so. */
export function ajudaDeCancelarAgendadas(n: number): string {
  return n === 1
    ? "Sem cancelar, ela sai em nome dela e a conversa fica Sem atendente."
    : AJUDA_DE_CANCELAR_AGENDADAS;
}
