import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Trilha de LEITURA de dado de paciente (regra 3.1 do CLAUDE.md: toda leitura
// de dado de paciente por usuario humano vai para audit_log). Granularidade
// por ABERTURA DE TELA: uma linha quando um humano abre a agenda do dia ou o
// inbox, com throttle para nao inundar a trilha em navegacao rapida (uma
// linha a cada 5 min por usuario+entidade). Nunca grava conteudo, so o que a
// LGPD pede: quem, quando, que superficie.
//
// Nao bloqueia a renderizacao: e chamada sem await na carga da pagina; um
// erro de auditoria nao pode derrubar a tela, mas e logado.

const JANELA_MS = 5 * 60_000;

export async function auditarLeituraDePaciente(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    userId: string;
    entity: "agenda_dia" | "inbox" | "historico_agenda";
    entityId?: string | null;
  },
): Promise<void> {
  try {
    // Nao repete a leitura da MESMA superficie pelo MESMO usuario dentro da
    // janela: a recepcao que troca de dia o tempo todo nao gera uma linha por
    // clique.
    const desde = new Date(Date.now() - JANELA_MS).toISOString();
    const { data: recente } = await supabase
      .from("audit_log")
      .select("id")
      .eq("clinic_id", params.clinicId)
      .eq("user_id", params.userId)
      .eq("action", "leu")
      .eq("entity", params.entity)
      .gte("created_at", desde)
      .limit(1);
    if (recente && recente.length > 0) {
      return;
    }
    await supabase.from("audit_log").insert({
      clinic_id: params.clinicId,
      user_id: params.userId,
      action: "leu",
      entity: params.entity,
      entity_id: params.entityId ?? null,
    });
  } catch {
    // Auditoria nunca derruba a tela; o proprio audit_log e best-effort aqui.
  }
}
