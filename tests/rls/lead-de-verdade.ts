import type { SupabaseClient } from "@supabase/supabase-js";

// Metricas certas (migration 20261123100000): lead e o contato que NASCEU de
// uma mensagem do paciente (contato_e_lead), isto e, com a autorizacao
// source 'conversa' que a ingestao grava na mesma transacao que cria o
// contato, com o MESMO created_at. O contato criado direto pelo teste nao a
// tem e deixa de contar como lead em Resultados. Esta funcao grava essa
// linha, como a ingestao faria, para os contatos da clinica (ou so os dados)
// que nao foram importados e ainda nao a tem. Idempotente.

export async function nascerDeMensagem(
  admin: SupabaseClient,
  clinicIds: readonly string[],
  contactIds?: readonly string[],
): Promise<void> {
  let consulta = admin
    .from("contact")
    .select("id, clinic_id, created_at")
    .in("clinic_id", [...clinicIds])
    .eq("criado_por_importacao", false);
  if (contactIds) {
    consulta = consulta.in("id", [...contactIds]);
  }
  const { data: contatos } = await consulta.throwOnError();
  const { data: existentes } = await admin
    .from("contact_consent")
    .select("contact_id, created_at")
    .in("clinic_id", [...clinicIds])
    .eq("source", "conversa")
    .throwOnError();
  const nascidos = new Set(
    ((existentes ?? []) as { contact_id: string; created_at: string }[]).map(
      (linha) => `${linha.contact_id}|${Date.parse(linha.created_at)}`,
    ),
  );
  const linhas = (
    (contatos ?? []) as { id: string; clinic_id: string; created_at: string }[]
  )
    .filter(
      (contato) =>
        !nascidos.has(`${contato.id}|${Date.parse(contato.created_at)}`),
    )
    .map((contato) => ({
      clinic_id: contato.clinic_id,
      contact_id: contato.id,
      channel: "whatsapp",
      source: "conversa",
      evidence: "Primeira mensagem recebida do contato",
      created_at: contato.created_at,
    }));
  if (linhas.length > 0) {
    await admin.from("contact_consent").insert(linhas).throwOnError();
  }
}
