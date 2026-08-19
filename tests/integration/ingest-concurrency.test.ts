import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Aceite da tarefa 1.3: reenviar o mesmo evento 3 vezes cria UMA mensagem, e
// 50 eventos simultaneos nao geram duplicata nem conversa dobrada. A
// concorrencia real e a do Postgres remoto: as chamadas vao direto na RPC
// ingest_inbound_message, exatamente como o webhook faz.
// Clinica descartavel propria: nao toca no seed nem colide com o e2e.

const suffix = crypto.randomUUID().slice(0, 8);
const admin = adminClient();

let clinicId: string;

async function ingest(phone: string, waMessageId: string, body: string) {
  return await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_phone_e164: phone,
    p_name: "Paciente Concorrente",
    p_wa_message_id: waMessageId,
    p_content_type: "texto",
    p_body: body,
    p_media_url: null,
    p_transcript: null,
  });
}

beforeAll(async () => {
  const { data, error } = await admin
    .from("clinic")
    .insert({ name: `Ingest ${suffix}`, slug: `ingest-${suffix}` })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar clínica: ${error?.message}`);
  }
  clinicId = data.id;
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
});

describe("idempotência", () => {
  it("o mesmo evento 3 vezes cria exatamente 1 mensagem", async () => {
    const phone = `+5584911${suffix.slice(0, 4)}01`;
    const results = [
      await ingest(phone, `it:${suffix}:rep`, "olá"),
      await ingest(phone, `it:${suffix}:rep`, "olá"),
      await ingest(phone, `it:${suffix}:rep`, "olá"),
    ];
    for (const result of results) {
      expect(result.error).toBeNull();
    }
    expect(
      results.map((r) => (r.data as { inserted: boolean }).inserted),
    ).toEqual([true, false, false]);

    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("wa_message_id", `it:${suffix}:rep`);
    expect(count).toBe(1);
  });
});

describe("concorrência", () => {
  it("50 eventos simultâneos: contagens exatas e uma conversa só por contato", async () => {
    const phone = `+5584911${suffix.slice(0, 4)}02`;
    // 20 ids unicos, cada um disparado de 2 a 3 vezes ao mesmo tempo = 50 chamadas.
    const calls: Promise<unknown>[] = [];
    const uniqueIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `it:${suffix}:conc:${i}`;
      uniqueIds.push(id);
      const repeats = i < 10 ? 3 : 2;
      for (let r = 0; r < repeats; r++) {
        calls.push(ingest(phone, id, `mensagem ${i}`));
      }
    }
    expect(calls).toHaveLength(50);
    const settled = await Promise.all(calls);
    for (const result of settled) {
      expect((result as { error: unknown }).error).toBeNull();
    }

    const { count: messageCount } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .like("wa_message_id", `it:${suffix}:conc:%`);
    expect(messageCount).toBe(uniqueIds.length);

    const { data: contact } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_e164", phone)
      .single();
    const { count: conversationCount } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("contact_id", contact!.id);
    expect(conversationCount).toBe(1);

    const { count: consentCount } = await admin
      .from("contact_consent")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("contact_id", contact!.id);
    expect(consentCount).toBeGreaterThanOrEqual(1);
  });

  it("contatos diferentes em paralelo geram uma conversa cada", async () => {
    const phones = Array.from(
      { length: 8 },
      (_, i) => `+5584912${suffix.slice(0, 4)}${String(i).padStart(2, "0")}`,
    );
    await Promise.all(
      phones.map((phone, i) => ingest(phone, `it:${suffix}:multi:${i}`, "oi")),
    );
    const { count } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    // 1 da repeticao + 1 da concorrencia + 8 destes contatos
    expect(count).toBe(10);
  });
});
