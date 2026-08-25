import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Trilha de LEITURA de dado de paciente (regra 3.1 do CLAUDE.md: toda leitura
// de dado de paciente por usuario humano vai para audit_log). Duas
// granularidades: por ABERTURA DE TELA (agenda do dia, inbox, lista de leads),
// sem id, e por ABERTURA DE FICHA, com o id do contato lido. Nunca grava
// conteudo, so o que a LGPD pede: quem, quando, que superficie, de quem.
//
// O throttle (5 min) dedupica por usuario + entidade + ID: sem o id na chave,
// abrir trinta fichas seguidas gravaria uma linha so e a trilha nao diria de
// quem foi a leitura. Tela de lista nao tem id e segue deduplicada so por
// entidade, como antes.
//
// Na carga de pagina nao bloqueia a renderizacao (chamada sem await); na
// abertura de ficha e aguardada, para a linha existir antes de o dado sair do
// servidor. Um erro de auditoria nunca derruba a tela.

const JANELA_MS = 5 * 60_000;

export async function auditarLeituraDePaciente(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    userId: string;
    entity:
      | "agenda_dia"
      | "inbox"
      | "historico_agenda"
      | "leads"
      | "pacientes"
      | "ficha_paciente"
      | "confirmacoes"
      | "lista_espera";
    entityId?: string | null;
  },
): Promise<void> {
  try {
    // Nao repete a leitura do MESMO alvo pelo MESMO usuario dentro da janela:
    // a recepcao que troca de dia o tempo todo nao gera uma linha por clique.
    const entityId = params.entityId ?? null;
    const desde = new Date(Date.now() - JANELA_MS).toISOString();
    let consulta = supabase
      .from("audit_log")
      .select("id")
      .eq("clinic_id", params.clinicId)
      .eq("user_id", params.userId)
      .eq("action", "leu")
      .eq("entity", params.entity)
      .gte("created_at", desde);
    // Com id, a janela e por ficha: a segunda ficha aberta no mesmo minuto
    // tem a propria linha. Sem id (telas de lista) fica como sempre foi.
    if (entityId !== null) {
      consulta = consulta.eq("entity_id", entityId);
    }
    const { data: recente } = await consulta.limit(1);
    if (recente && recente.length > 0) {
      return;
    }
    await supabase.from("audit_log").insert({
      clinic_id: params.clinicId,
      user_id: params.userId,
      action: "leu",
      entity: params.entity,
      entity_id: entityId,
    });
  } catch {
    // Auditoria nunca derruba a tela; o proprio audit_log e best-effort aqui.
  }
}
