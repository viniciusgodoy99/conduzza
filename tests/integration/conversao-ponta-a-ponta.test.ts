import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executarEnvioDeConversao } from "@/lib/jobs/conversao-meta";
import type { Job } from "@/lib/jobs/worker";

import { adminClient } from "../rls/stack";

// A conversao por etapa de ponta a ponta, contra o banco REAL (pedido do dono
// em 24/11/2026: "revise para realmente funcionar"). Do jeito que a clinica
// usa: as etapas com o evento que o passo "Conversoes por etapa" grava, o
// lead do anuncio que abre o WhatsApp (com o ctwa_clid, como o uazapi
// entrega) e o lead que nao veio de anuncio, os movimentos de etapa, o envio
// ligado e o job de verdade. So a chamada a Meta e interceptada.
//
// O envio e ligado DEPOIS dos movimentos: com ele desligado o gatilho so
// registra, entao nenhum job nasce na fila e o motor da producao (pg_cron a
// cada 20 s) nao disputa o evento com o teste. O job e chamado aqui.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

type Enviado = { url: string; corpo: { data: Record<string, unknown>[] } };
const enviados: Enviado[] = [];
const fetchOriginal = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof entrada === "string"
        ? entrada
        : entrada instanceof URL
          ? entrada.href
          : entrada.url;
    if (url.startsWith("https://graph.facebook.com/")) {
      enviados.push({ url, corpo: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = fetchOriginal;
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

async function montarClinica(
  nome: string,
  conta: { waba: string | null },
): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `ConvPonta ${nome} ${sufixo}`,
      slug: `convponta-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);

  // O recomendado, como o passo grava (salvarConversoesDasEtapasAction).
  for (const [chave, evento, valor] of [
    ["novo", "Lead", null],
    ["agendou", "Schedule", null],
    ["compareceu", "Purchase", "service_link"],
  ] as const) {
    await admin
      .from("funnel_stage_def")
      .update({
        meta_event_name: evento,
        conversao_ativa: true,
        value_source: valor,
        value_cents: null,
      })
      .eq("clinic_id", clinicId)
      .eq("chave", chave)
      .throwOnError();
  }

  await admin
    .from("meta_ads_account_secret")
    .insert({ clinic_id: clinicId, capi_access_token: "tok-ponta-a-ponta" })
    .throwOnError();
  await admin
    .from("meta_ads_account")
    .insert({
      clinic_id: clinicId,
      pixel_id: "123123123123123",
      whatsapp_business_account_id: conta.waba,
      modo_user_data: "telefone_hasheado",
      send_unmatched: false,
      envio_ativado: false,
    })
    .throwOnError();
  return clinicId;
}

async function lead(
  clinicId: string,
  telefone: string,
  ctwa: string | null,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Lead ponta a ponta",
      ctwa_clid: ctwa,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function mover(contactId: string, etapa: string): Promise<void> {
  await admin
    .from("contact")
    .update({ funnel_stage: etapa })
    .eq("id", contactId)
    .throwOnError();
}

/** Liga o envio e roda o job de cada conversao registrada, como o motor faria. */
async function ligarERodar(clinicId: string) {
  await admin
    .from("meta_ads_account")
    .update({ envio_ativado: true })
    .eq("clinic_id", clinicId)
    .throwOnError();
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id")
    .eq("clinic_id", clinicId);
  // Prova de que o motor da producao nao tinha nada desta clinica para pegar.
  expect(jobs).toHaveLength(0);

  const { data: eventos } = await admin
    .from("conversion_event")
    .select("id")
    .eq("clinic_id", clinicId)
    .throwOnError();
  for (const evento of eventos ?? []) {
    const job = {
      id: `teste-${evento.id}`,
      clinic_id: clinicId,
      kind: "enviar_conversao_meta",
      payload: { conversion_event_id: evento.id },
      attempts: 1,
      max_attempts: 5,
    } as Job;
    expect(await executarEnvioDeConversao(admin, job)).toEqual({ ok: true });
  }
  const { data: depois } = await admin
    .from("conversion_event")
    .select("contact_id, stage_chave, event_name, status, erro")
    .eq("clinic_id", clinicId)
    .order("created_at")
    .throwOnError();
  return depois ?? [];
}

function eventosParaAMeta(pixel = "123123123123123") {
  return enviados
    .filter((enviado) => enviado.url.includes(`/${pixel}/events`))
    .flatMap((enviado) => enviado.corpo.data);
}

describe("conversão por etapa de ponta a ponta, no banco real", () => {
  it("número sem a conta do WhatsApp Business (uazapi): o lead do anúncio sai pelo telefone em cada etapa; quem não veio de anúncio não sai", async () => {
    enviados.length = 0;
    const clinicId = await montarClinica("uazapi", { waba: null });
    const doAnuncio = await lead(clinicId, "+5584974310001", `Af-ctwa-${sufixo}`);
    const semAnuncio = await lead(clinicId, "+5584974310002", null);
    await mover(doAnuncio, "agendou");
    await mover(doAnuncio, "compareceu");
    await mover(semAnuncio, "agendou");

    const eventos = await ligarERodar(clinicId);
    const doLead = eventos.filter((e) => e.contact_id === doAnuncio);
    expect(doLead.map((e) => [e.stage_chave, e.event_name, e.status])).toEqual([
      ["novo", "Lead", "enviado"],
      ["agendou", "Schedule", "enviado"],
      ["compareceu", "Purchase", "enviado"],
    ]);
    const doOutro = eventos.filter((e) => e.contact_id === semAnuncio);
    expect(doOutro.map((e) => [e.stage_chave, e.status, e.erro])).toEqual([
      ["novo", "descartado", "sem_identificador"],
      ["agendou", "descartado", "sem_identificador"],
    ]);

    const paraAMeta = eventosParaAMeta();
    expect(paraAMeta.map((e) => e.event_name)).toEqual([
      "Lead",
      "Schedule",
      "Purchase",
    ]);
    for (const evento of paraAMeta) {
      expect(evento.action_source).toBe("system_generated");
      expect((evento.user_data as { ph: string[] }).ph[0]).toMatch(/^[0-9a-f]{64}$/);
    }
    // Compra sem preco de consulta: valor 0 e a moeda, como a Meta exige.
    expect(paraAMeta[2]!.custom_data).toEqual({ value: 0, currency: "BRL" });
    // O telefone nunca sai cru.
    expect(JSON.stringify(enviados)).not.toContain("5584974310001");
  });

  it("com a conta do WhatsApp Business: o lead do anúncio sai no formato do WhatsApp, com os nomes que a Meta aceita lá", async () => {
    enviados.length = 0;
    const clinicId = await montarClinica("oficial", { waba: "109876543210987" });
    const doAnuncio = await lead(clinicId, "+5584974310003", `Af-ctwa2-${sufixo}`);
    await mover(doAnuncio, "agendou");
    await mover(doAnuncio, "compareceu");

    const eventos = await ligarERodar(clinicId);
    expect(eventos.map((e) => e.status)).toEqual(["enviado", "enviado", "enviado"]);

    const paraAMeta = eventosParaAMeta();
    expect(paraAMeta.map((e) => e.event_name)).toEqual([
      "LeadSubmitted",
      "QualifiedLead",
      "Purchase",
    ]);
    for (const evento of paraAMeta) {
      expect(evento).toMatchObject({
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          ctwa_clid: `Af-ctwa2-${sufixo}`,
          whatsapp_business_account_id: "109876543210987",
        },
      });
    }
  });
});
