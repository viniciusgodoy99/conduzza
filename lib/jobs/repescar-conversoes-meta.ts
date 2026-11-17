import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Repescagem da janela da API de Conversoes: o que esta 'registrado' (e o que
 * 'falhou' por token, Pixel ou instabilidade) nos ultimos 7 dias entra na
 * fila; o registrado mais antigo e descartado com codigo. Escrita de sistema
 * (conversion_event e job_queue nao tem policy de escrita): so depois do
 * guard de papel de quem chama.
 *
 * ORDEM IMPORTA (achado da revisao adversarial de 09/09/2026): o job nasce
 * ANTES de o status virar 'enfileirado'. Se o insert do job falhar, o evento
 * continua 'registrado' e a proxima repescagem o pega; 'enfileirado' sem job
 * seria orfao para sempre. O job aceita evento 'registrado' numa boa.
 */
export async function repescarConversoesDaMeta(
  admin: SupabaseClient,
  clinicId: string,
): Promise<{ ok: true } | { ok: false; falhas: number | null }> {
  const corte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Falha recente nao e definitiva: token errado, Pixel errado e Meta fora do
  // ar se consertam. So o payload recusado fica: repetir nao muda o payload.
  const { error: erroVoltar } = await admin
    .from("conversion_event")
    .update({ status: "registrado", erro: null })
    .eq("clinic_id", clinicId)
    .eq("status", "falhou")
    .gte("created_at", corte)
    .or("erro.is.null,erro.neq.payload_recusado");
  const { error: erroDescarte } = await admin
    .from("conversion_event")
    .update({ status: "descartado", erro: "fora_da_janela_capi" })
    .eq("clinic_id", clinicId)
    .eq("status", "registrado")
    .lt("created_at", corte);
  // shortcut: 1000 por repescagem, o resto fica 'registrado' ate a proxima; paginar se uma clinica passar disso em 7 dias.
  const { data: recentes, error: erroLeitura } = await admin
    .from("conversion_event")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("status", "registrado")
    .gte("created_at", corte)
    .limit(1000);
  if (erroVoltar || erroDescarte || erroLeitura) {
    return { ok: false, falhas: null };
  }
  let falhas = 0;
  for (const evento of recentes ?? []) {
    const { error: erroJob } = await admin.from("job_queue").insert({
      clinic_id: clinicId,
      kind: "enviar_conversao_meta",
      payload: { conversion_event_id: evento.id },
    });
    if (erroJob) {
      falhas += 1;
      continue;
    }
    await admin
      .from("conversion_event")
      .update({ status: "enfileirado" })
      .eq("id", evento.id)
      .eq("status", "registrado");
  }
  return falhas > 0 ? { ok: false, falhas } : { ok: true };
}
