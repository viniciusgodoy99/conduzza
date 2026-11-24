import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoFalso, eUpdate, type Resposta } from "./banco-falso";

// O job que devolve a conversao para a Meta (lib/jobs/conversao-meta.ts).
// Revisao de 24/11/2026 (substitui a de 17/11): o lead do anuncio do
// WhatsApp sem a conta do WhatsApp Business VEIO do anuncio e sai pelo
// telefone protegido; "sem identificador" e so quem nao veio de anuncio.
// Nada de rede: o adaptador da CAPI e trocado.

const enviar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/meta/capi", () => ({ enviarEventosCapi: enviar }));

import { executarEnvioDeConversao } from "@/lib/jobs/conversao-meta";
import type { Job } from "@/lib/jobs/worker";

const JOB = {
  id: "job-1",
  clinic_id: "clinica-1",
  kind: "enviar_conversao_meta",
  payload: { conversion_event_id: "evento-1" },
  attempts: 1,
  max_attempts: 5,
} as Job;

function banco(conta: {
  waba: string | null;
  semIdentificador: boolean;
  modo?: "telefone_hasheado" | "ctwa_apenas";
  ctwa?: string | null;
}) {
  const ok = (data: unknown): Resposta => ({ data, error: null });
  return bancoFalso({
    tabelas: {
      conversion_event: (chamada) =>
        eUpdate(chamada)
          ? ok(null)
          : ok({
              id: "evento-1",
              clinic_id: "clinica-1",
              contact_id: "contato-1",
              stage_chave: "agendou",
              event_name: "Schedule",
              event_id: "9d3b2c1a-0000-4000-8000-000000000001",
              value_cents: null,
              currency: "BRL",
              ctwa_clid: null,
              status: "enfileirado",
              created_at: new Date().toISOString(),
            }),
      meta_ads_account: () =>
        ok({
          pixel_id: "123456789012345",
          envio_ativado: true,
          modo_user_data: conta.modo ?? "telefone_hasheado",
          send_unmatched: conta.semIdentificador,
          test_event_code: null,
          whatsapp_business_account_id: conta.waba,
        }),
      meta_ads_account_secret: () => ok({ capi_access_token: "token-de-teste" }),
      contact: () =>
        ok({
          phone_e164: "+5584999990000",
          ctwa_clid: conta.ctwa === undefined ? "clique-do-anuncio" : conta.ctwa,
        }),
      clique_do_site: () => ok(null),
    },
  });
}

describe("executarEnvioDeConversao: o que conta como identificador", () => {
  beforeEach(() => {
    enviar.mockReset();
    enviar.mockResolvedValue({ ok: true, eventsReceived: 1 });
  });

  it("lead do anúncio do WhatsApp sem a conta do WhatsApp Business (uazapi): sai pelo telefone protegido, sem precisar do envio sem identificador (24/11/2026)", async () => {
    const falso = banco({ waba: null, semIdentificador: false });
    const resultado = await executarEnvioDeConversao(falso.admin, JOB);
    expect(resultado).toEqual({ ok: true });
    expect(enviar).toHaveBeenCalledTimes(1);
    const [, eventos] = enviar.mock.calls[0]!;
    expect(eventos[0]).toMatchObject({
      event_name: "Schedule",
      action_source: "system_generated",
    });
    expect(eventos[0].user_data.ph).toHaveLength(1);
    expect(JSON.stringify(eventos)).not.toContain("5584999990000");
  });

  it("só o identificador, sem a conta do WhatsApp Business: não tem como sair, descarta com o código", async () => {
    const falso = banco({ waba: null, semIdentificador: false, modo: "ctwa_apenas" });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).not.toHaveBeenCalled();
    expect(falso.updatesEm("conversion_event")).toEqual([
      { status: "descartado", erro: "sem_waba_id" },
    ]);
  });

  it("quem não veio de anúncio nenhum só sai com o envio sem identificador ligado", async () => {
    const falso = banco({ waba: null, semIdentificador: false, ctwa: null });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).not.toHaveBeenCalled();
    expect(falso.updatesEm("conversion_event")).toEqual([
      { status: "descartado", erro: "sem_identificador" },
    ]);
  });

  it("com a conta do WhatsApp Business, o clique identifica e o evento sai com o nome de lá", async () => {
    const falso = banco({ waba: "109876543210987", semIdentificador: false });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).toHaveBeenCalledTimes(1);
    const [, eventos] = enviar.mock.calls[0]!;
    expect(eventos[0]).toMatchObject({
      event_name: "QualifiedLead",
      action_source: "business_messaging",
      user_data: { ctwa_clid: "clique-do-anuncio", whatsapp_business_account_id: "109876543210987" },
    });
  });

  it("com o envio sem identificador ligado, sai mesmo sem a conta do WhatsApp Business", async () => {
    const falso = banco({ waba: null, semIdentificador: true });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
